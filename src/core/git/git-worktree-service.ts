/**
 * GitWorktreeService — manages git worktrees for parallel agent isolation.
 *
 * Provides create/remove/list/validate operations with per-repository
 * concurrency locking to prevent .git/worktrees corruption.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { getServerBridge } from "@/core/platform";
import type { WorktreeStore } from "../db/pg-worktree-store";
import type { CodebaseStore } from "../db/pg-codebase-store";
import type { Worktree } from "../models/worktree";
import { createWorktree } from "../models/worktree";
import { GIT_DEFAULT_BRANCH } from "./git-defaults";

/**
 * Shell-escape a single argument for safe interpolation.
 *
 * Uses POSIX single-quotes on Unix and double-quotes on Windows (cmd.exe
 * does not recognise single-quote quoting).
 */
function shellEscape(arg: string): string {
  if (process.platform === "win32") {
    return `"${arg.replace(/"/g, '\\"')}"`;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Execute a git command via the platform bridge.
 * Arguments are properly shell-escaped to prevent injection.
 */
async function execGit(
  args: string[],
  cwd: string,
  timeout = 30_000
): Promise<{ stdout: string; stderr: string }> {
  const bridge = getServerBridge();
  const command = ["git", ...args.map(shellEscape)].join(" ");
  return bridge.process.exec(command, { cwd, timeout });
}

/**
 * Sanitize a branch name for use as a directory name.
 */
function branchToSafeDirName(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9._-]/g, "-");
}

/**
 * Get the base directory for worktrees: ~/.routa/worktrees/
 */
function getWorktreeBaseDir(): string {
  return path.join(os.homedir(), ".routa", "worktrees");
}

export class GitWorktreeService {
  /** Per-repository Promise chain for serializing worktree operations. */
  private repoLocks = new Map<string, Promise<void>>();

  constructor(
    private worktreeStore: WorktreeStore,
    private codebaseStore: CodebaseStore
  ) {}

  /**
   * Acquire a per-repo lock. Operations on the same repo are serialized
   * to prevent .git/worktrees directory corruption.
   */
  private async withRepoLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.repoLocks.get(repoPath) ?? Promise.resolve();

    let resolve: () => void;
    const newLock = new Promise<void>((r) => {
      resolve = r;
    });

    // Set new lock synchronously before any await
    this.repoLocks.set(repoPath, newLock);

    // Wait for previous operation to complete
    await existing;

    try {
      return await fn();
    } finally {
      resolve!();
      if (this.repoLocks.get(repoPath) === newLock) {
        this.repoLocks.delete(repoPath);
      }
    }
  }

  /**
   * Create a new git worktree for a codebase.
   */
  async createWorktree(
    codebaseId: string,
    options: {
      branch?: string;
      baseBranch?: string;
      label?: string;
      worktreeRoot?: string;
    } = {}
  ): Promise<Worktree> {
    const codebase = await this.codebaseStore.get(codebaseId);
    if (!codebase) {
      throw new Error(`Codebase not found: ${codebaseId}`);
    }

    const repoPath = codebase.repoPath;
    const baseBranch = options.baseBranch ?? codebase.branch ?? GIT_DEFAULT_BRANCH;

    // Fetch base branch ref before creating worktree to ensure up-to-date baseline
    await execGit(["fetch", "origin", baseBranch], repoPath).catch(() => {});

    // Generate branch name if not provided
    const shortId = crypto.randomUUID().slice(0, 8);
    const branch =
      options.branch ??
      `wt/${options.label ? branchToSafeDirName(options.label) : shortId}`;
    const directoryName = branchToSafeDirName(options.label?.trim() || branch);

    return this.withRepoLock(repoPath, async () => {
      // Fail fast if no process bridge (serverless environments)
      const bridge = getServerBridge();
      if (!bridge.process) {
        throw new Error("Git worktree operations require local process execution");
      }

      // Check if branch is already in use by another worktree
      const existingByBranch = await this.worktreeStore.findByBranch(codebaseId, branch);
      if (existingByBranch) {
        throw new Error(
          `Branch "${branch}" is already in use by worktree ${existingByBranch.id}`
        );
      }

      // Compute worktree path
      const worktreeRoot = options.worktreeRoot?.trim() || getWorktreeBaseDir();
      const worktreePath = path.join(
        worktreeRoot,
        codebaseId,
        directoryName
      );

      // Clean up stale error-status worktree at the same path before creating a new one.
      // A previous attempt may have failed (e.g. Windows filename length) leaving an
      // error record that blocks the unique constraint on worktree_path.
      const codebaseWorktrees = await this.worktreeStore.listByCodebase(codebaseId);
      const staleAtSamePath = codebaseWorktrees.find(
        (wt) => wt.worktreePath === worktreePath && wt.status === "error"
      );
      if (staleAtSamePath) {
        await this.worktreeStore.remove(staleAtSamePath.id);
      }

      // Create DB record
      const worktree = createWorktree({
        id: crypto.randomUUID(),
        codebaseId,
        workspaceId: codebase.workspaceId,
        worktreePath,
        branch,
        baseBranch,
        label: options.label,
      });
      await this.worktreeStore.add(worktree);

      try {
        // Ensure parent directory exists
        await fs.mkdir(path.dirname(worktreePath), { recursive: true });

        // Enable long paths on Windows to avoid MAX_PATH (260) failures.
        // Set both local (repo-level) and global (--global) so the worktree
        // checkout respects the setting even before the worktree gitconfig exists.
        if (process.platform === "win32") {
          await execGit(["config", "core.longPaths", "true"], repoPath).catch(() => {});
          await execGit(["config", "--global", "core.longPaths", "true"], repoPath).catch(() => {});
        }

        // Prune stale worktree references
        await execGit(["worktree", "prune"], repoPath).catch(() => {});

        // Check if branch already exists locally
        let branchExists = false;
        try {
          const { stdout } = await execGit(
            ["branch", "--list", branch],
            repoPath
          );
          branchExists = stdout.trim().length > 0;
        } catch {
          // ignore
        }

        if (branchExists) {
          // Branch exists — attach worktree to it
          await execGit(
            ["worktree", "add", worktreePath, branch],
            repoPath
          );
        } else {
          // Create new branch and worktree
          await execGit(
            ["worktree", "add", "-b", branch, worktreePath, baseBranch],
            repoPath
          );
        }

        // Mark as active
        await this.worktreeStore.updateStatus(worktree.id, "active");
        worktree.status = "active";
        return worktree;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.worktreeStore.updateStatus(worktree.id, "error", msg);
        worktree.status = "error";
        worktree.errorMessage = msg;
        throw new Error(`Failed to create worktree: ${msg}`, { cause: err });
      }
    });
  }

  /**
   * Remove a git worktree.
   */
  async removeWorktree(
    worktreeId: string,
    options: { deleteBranch?: boolean } = {}
  ): Promise<void> {
    const worktree = await this.worktreeStore.get(worktreeId);
    if (!worktree) {
      throw new Error(`Worktree not found: ${worktreeId}`);
    }

    const codebase = await this.codebaseStore.get(worktree.codebaseId);
    if (!codebase) {
      // Codebase gone — just clean up DB record
      await this.worktreeStore.remove(worktreeId);
      return;
    }

    const repoPath = codebase.repoPath;

    await this.withRepoLock(repoPath, async () => {
      await this.worktreeStore.updateStatus(worktreeId, "removing");

      try {
        await execGit(
          ["worktree", "remove", "--force", worktree.worktreePath],
          repoPath
        );
      } catch {
        // Path may already be gone
      }

      // Prune stale references
      await execGit(["worktree", "prune"], repoPath).catch(() => {});

      // Optionally delete the branch
      if (options.deleteBranch) {
        try {
          await execGit(["branch", "-D", worktree.branch], repoPath);
        } catch {
          // Branch may already be gone or is checked out elsewhere
        }

        // Also delete the remote branch if it was pushed.
        // Best-effort: the branch may not have been pushed, or the
        // remote may reject the delete (e.g. branch protection).
        try {
          await execGit(
            ["push", "origin", "--delete", worktree.branch],
            repoPath,
          );
        } catch {
          // Remote branch may not exist, or push access is denied — ignore
        }
      }

      await this.worktreeStore.remove(worktreeId);
    });
  }

  /**
   * List worktrees for a codebase.
   */
  async listWorktrees(codebaseId: string): Promise<Worktree[]> {
    return this.worktreeStore.listByCodebase(codebaseId);
  }

  /**
   * Validate a worktree's health on disk.
   */
  async validateWorktree(worktreeId: string): Promise<{
    healthy: boolean;
    error?: string;
  }> {
    const worktree = await this.worktreeStore.get(worktreeId);
    if (!worktree) {
      return { healthy: false, error: "Worktree record not found" };
    }

    const codebase = await this.codebaseStore.get(worktree.codebaseId);
    if (!codebase) {
      await this.worktreeStore.updateStatus(worktreeId, "error", "Parent codebase not found");
      return { healthy: false, error: "Parent codebase not found" };
    }

    // Check if worktree path exists
    try {
      const stat = await fs.stat(worktree.worktreePath);
      if (!stat.isDirectory()) {
        throw new Error("Not a directory");
      }
    } catch {
      await this.worktreeStore.updateStatus(worktreeId, "error", "Worktree directory missing");
      return { healthy: false, error: "Worktree directory missing" };
    }

    // Check if .git file exists (worktrees have a .git file, not directory)
    try {
      const gitStat = await fs.stat(path.join(worktree.worktreePath, ".git"));
      if (!gitStat.isFile()) {
        throw new Error("Not a file");
      }
    } catch {
      await this.worktreeStore.updateStatus(worktreeId, "error", "Not a valid worktree (.git file missing)");
      return { healthy: false, error: "Not a valid worktree (.git file missing)" };
    }

    // If status was error, restore to active
    if (worktree.status === "error") {
      await this.worktreeStore.updateStatus(worktreeId, "active");
    }

    return { healthy: true };
  }

  /**
   * Reset a worktree's working tree to match a base branch.
   * Keeps the worktree and branch intact, but discards all local commits/changes.
   */
  async resetWorktree(
    worktreeId: string,
    options: { baseBranch?: string } = {},
  ): Promise<void> {
    const worktree = await this.worktreeStore.get(worktreeId);
    if (!worktree) {
      throw new Error(`Worktree not found: ${worktreeId}`);
    }

    const codebase = await this.codebaseStore.get(worktree.codebaseId);
    if (!codebase) {
      throw new Error(`Codebase not found for worktree ${worktreeId}`);
    }

    const base = options.baseBranch ?? worktree.baseBranch ?? codebase.branch ?? GIT_DEFAULT_BRANCH;
    const cwd = worktree.worktreePath;
    const repoPath = codebase.repoPath;

    await this.withRepoLock(repoPath, async () => {
      // Fetch latest from remote
      await execGit(["fetch", "origin"], cwd).catch(() => {});

      // Clean untracked files and directories
      await execGit(["clean", "-fd"], cwd).catch(() => {});

      // Hard reset to base branch
      await execGit(["reset", "--hard", `origin/${base}`], cwd);
    });
  }

  /**
   * Remove all worktrees for a codebase (used during codebase deletion).
   */
  async removeAllForCodebase(codebaseId: string): Promise<void> {
    const worktreeList = await this.worktreeStore.listByCodebase(codebaseId);
    for (const wt of worktreeList) {
      try {
        await this.removeWorktree(wt.id, { deleteBranch: true });
      } catch {
        // Best-effort cleanup
      }
    }
  }
}
