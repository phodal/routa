/**
 * WorkspaceTools — Git operations and workspace management tools.
 *
 * Provides MCP-exposed tools for:
 * - Git status, diff, and commit
 * - Workspace info and metadata
 * - Specialist listing
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { AgentStore } from "../store/agent-store";
import { TaskStore } from "../store/task-store";
import { NoteStore } from "../store/note-store";
import { loadSpecialists } from "../orchestration/specialist-prompts";
import { ToolResult, successResult, errorResult } from "./tool-result";

const execFileAsync = promisify(execFile);

export class WorkspaceTools {
  constructor(
    private agentStore: AgentStore,
    private taskStore: TaskStore,
    private noteStore: NoteStore,
    private defaultCwd?: string
  ) {}

  // ─── Git Status ────────────────────────────────────────────────────

  async gitStatus(params: { cwd?: string }): Promise<ToolResult> {
    const cwd = params.cwd ?? this.defaultCwd ?? process.cwd();
    try {
      const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1"], {
        cwd,
        timeout: 10000,
      });

      const lines = stdout.trim().split("\n").filter(Boolean);
      const staged: string[] = [];
      const unstaged: string[] = [];
      const untracked: string[] = [];

      for (const line of lines) {
        const x = line[0]; // index status
        const y = line[1]; // worktree status
        const file = line.slice(3);

        if (x === "?" && y === "?") {
          untracked.push(file);
        } else {
          if (x !== " " && x !== "?") {
            staged.push(`${x} ${file}`);
          }
          if (y !== " " && y !== "?") {
            unstaged.push(`${y} ${file}`);
          }
        }
      }

      // Also get branch info
      let branch = "";
      try {
        const branchResult = await execFileAsync("git", ["branch", "--show-current"], {
          cwd,
          timeout: 5000,
        });
        branch = branchResult.stdout.trim();
      } catch {
        // ignore
      }

      return successResult({
        branch,
        staged,
        unstaged,
        untracked,
        clean: lines.length === 0,
        raw: stdout.trim(),
      });
    } catch (err) {
      return errorResult(
        `git status failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ─── Git Diff ──────────────────────────────────────────────────────

  async gitDiff(params: {
    cwd?: string;
    staged?: boolean;
    file?: string;
  }): Promise<ToolResult> {
    const cwd = params.cwd ?? this.defaultCwd ?? process.cwd();
    try {
      const args = ["diff"];
      if (params.staged) args.push("--cached");
      args.push("--stat");
      if (params.file) args.push("--", params.file);

      const { stdout: statOutput } = await execFileAsync("git", args, {
        cwd,
        timeout: 15000,
      });

      // Also get the actual diff (limited to prevent huge output)
      const diffArgs = ["diff"];
      if (params.staged) diffArgs.push("--cached");
      if (params.file) diffArgs.push("--", params.file);

      const { stdout: diffOutput } = await execFileAsync("git", diffArgs, {
        cwd,
        timeout: 15000,
        maxBuffer: 512 * 1024,
      });

      const truncated = diffOutput.length > 50000;
      const diff = truncated ? diffOutput.slice(0, 50000) + "\n... (truncated)" : diffOutput;

      return successResult({
        stat: statOutput.trim(),
        diff: diff.trim(),
        truncated,
      });
    } catch (err) {
      return errorResult(
        `git diff failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ─── Git Commit ────────────────────────────────────────────────────

  async gitCommit(params: {
    message: string;
    cwd?: string;
    stageAll?: boolean;
  }): Promise<ToolResult> {
    const cwd = params.cwd ?? this.defaultCwd ?? process.cwd();
    try {
      // Optionally stage all changes
      if (params.stageAll) {
        await execFileAsync("git", ["add", "-A"], { cwd, timeout: 10000 });
      }

      // Check if there are staged changes
      const { stdout: staged } = await execFileAsync(
        "git",
        ["diff", "--cached", "--name-only"],
        { cwd, timeout: 5000 }
      );

      if (!staged.trim()) {
        return errorResult("Nothing to commit. No staged changes.");
      }

      // Commit
      const { stdout } = await execFileAsync(
        "git",
        ["commit", "-m", params.message],
        { cwd, timeout: 15000 }
      );

      // Get the commit hash
      const { stdout: hashOutput } = await execFileAsync(
        "git",
        ["rev-parse", "--short", "HEAD"],
        { cwd, timeout: 5000 }
      );

      return successResult({
        hash: hashOutput.trim(),
        message: params.message,
        output: stdout.trim(),
        filesCommitted: staged
          .trim()
          .split("\n")
          .filter(Boolean),
      });
    } catch (err) {
      return errorResult(
        `git commit failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ─── Workspace Info ────────────────────────────────────────────────

  async getWorkspaceInfo(params: {
    workspaceId: string;
  }): Promise<ToolResult> {
    const { workspaceId } = params;

    const agents = await this.agentStore.listByWorkspace(workspaceId);
    const tasks = await this.taskStore.listByWorkspace(workspaceId);
    const notes = await this.noteStore.listByWorkspace(workspaceId);

    return successResult({
      workspaceId,
      agents: {
        total: agents.length,
        byRole: {
          ROUTA: agents.filter((a) => a.role === "ROUTA").length,
          CRAFTER: agents.filter((a) => a.role === "CRAFTER").length,
          GATE: agents.filter((a) => a.role === "GATE").length,
          DEVELOPER: agents.filter((a) => a.role === "DEVELOPER").length,
        },
        byStatus: {
          ACTIVE: agents.filter((a) => a.status === "ACTIVE").length,
          COMPLETED: agents.filter((a) => a.status === "COMPLETED").length,
          PENDING: agents.filter((a) => a.status === "PENDING").length,
          ERROR: agents.filter((a) => a.status === "ERROR").length,
        },
      },
      tasks: {
        total: tasks.length,
        byStatus: {
          PENDING: tasks.filter((t) => t.status === "PENDING").length,
          IN_PROGRESS: tasks.filter((t) => t.status === "IN_PROGRESS").length,
          COMPLETED: tasks.filter((t) => t.status === "COMPLETED").length,
          NEEDS_FIX: tasks.filter((t) => t.status === "NEEDS_FIX").length,
          BLOCKED: tasks.filter((t) => t.status === "BLOCKED").length,
        },
      },
      notes: {
        total: notes.length,
        byType: {
          spec: notes.filter((n) => n.metadata.type === "spec").length,
          task: notes.filter((n) => n.metadata.type === "task").length,
          general: notes.filter((n) => n.metadata.type === "general").length,
        },
      },
    });
  }

  // ─── List Specialists ──────────────────────────────────────────────

  async listSpecialists(): Promise<ToolResult> {
    const specialists = loadSpecialists();
    return successResult(
      specialists.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        role: s.role,
        modelTier: s.defaultModelTier,
        source: s.source,
      }))
    );
  }
}
