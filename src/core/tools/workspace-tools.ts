/**
 * WorkspaceTools — Git operations and workspace management tools.
 *
 * Provides MCP-exposed tools for:
 * - Git status, diff, and commit
 * - Workspace info and metadata
 * - Specialist listing
 * - Workspace management (title, details, context)
 */

import { AgentStore } from "../store/agent-store";
import { TaskStore } from "../store/task-store";
import { NoteStore } from "../store/note-store";
import { WorkspaceStore } from "../db/pg-workspace-store";
import { EventBus, AgentEventType } from "../events/event-bus";
import { loadSpecialists } from "../orchestration/specialist-prompts";
import { ToolResult, successResult, errorResult } from "./tool-result";
import { getServerBridge } from "@/core/platform";

/**
 * Execute a git command via the platform bridge.
 * Returns { stdout, stderr } like child_process.execFile.
 */
async function execFileAsync(
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number; maxBuffer?: number }
): Promise<{ stdout: string; stderr: string }> {
  const bridge = getServerBridge();
  const fullCommand = [command, ...args].join(" ");
  return bridge.process.exec(fullCommand, {
    cwd: options?.cwd,
    timeout: options?.timeout,
  });
}

export class WorkspaceTools {
  private workspaceStore?: WorkspaceStore;
  private eventBus?: EventBus;

  constructor(
    private agentStore: AgentStore,
    private taskStore: TaskStore,
    private noteStore: NoteStore,
    private defaultCwd?: string
  ) {}

  setWorkspaceStore(store: WorkspaceStore): void {
    this.workspaceStore = store;
  }

  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus;
  }

  // ─── Git Status ────────────────────────────────────────────────────

  async gitStatus(params: { cwd?: string }): Promise<ToolResult> {
    const cwd = params.cwd ?? this.defaultCwd ?? getServerBridge().env.currentDir();
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
    const cwd = params.cwd ?? this.defaultCwd ?? getServerBridge().env.currentDir();
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
    const cwd = params.cwd ?? this.defaultCwd ?? getServerBridge().env.currentDir();
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

  // ─── Set Workspace Title ──────────────────────────────────────────

  async setWorkspaceTitle(params: {
    workspaceId: string;
    title: string;
    renameBranch?: boolean;
  }): Promise<ToolResult> {
    if (!this.workspaceStore) {
      return errorResult("Workspace store not configured.");
    }

    const workspace = await this.workspaceStore.get(params.workspaceId);
    if (!workspace) {
      return errorResult(`Workspace not found: ${params.workspaceId}`);
    }

    const oldTitle = workspace.title;
    await this.workspaceStore.updateTitle(params.workspaceId, params.title);

    // Optionally rename the Git branch
    if (params.renameBranch && workspace.repoPath) {
      const branchSlug = params.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      try {
        await execFileAsync("git", ["branch", "-m", branchSlug], {
          cwd: workspace.repoPath,
          timeout: 10000,
        });
        await this.workspaceStore.updateBranch(params.workspaceId, branchSlug);
      } catch (err) {
        return successResult({
          workspaceId: params.workspaceId,
          title: params.title,
          oldTitle,
          branchRenameError: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Emit workspace update event
    if (this.eventBus) {
      this.eventBus.emit({
        type: AgentEventType.WORKSPACE_UPDATED,
        agentId: "system",
        workspaceId: params.workspaceId,
        data: { field: "title", oldTitle, newTitle: params.title },
        timestamp: new Date(),
      });
    }

    return successResult({
      workspaceId: params.workspaceId,
      title: params.title,
      oldTitle,
    });
  }

  // ─── Get Workspace Details ────────────────────────────────────────

  async getWorkspaceDetails(params: {
    workspaceId: string;
  }): Promise<ToolResult> {
    if (!this.workspaceStore) {
      // Fallback to basic info if no workspace store
      return this.getWorkspaceInfo(params);
    }

    const workspace = await this.workspaceStore.get(params.workspaceId);
    if (!workspace) {
      return errorResult(`Workspace not found: ${params.workspaceId}`);
    }

    const agents = await this.agentStore.listByWorkspace(params.workspaceId);
    const tasks = await this.taskStore.listByWorkspace(params.workspaceId);
    const notes = await this.noteStore.listByWorkspace(params.workspaceId);

    // Get current Git branch if possible
    let currentBranch: string | undefined;
    const cwd = workspace.repoPath ?? this.defaultCwd;
    if (cwd) {
      try {
        const { stdout } = await execFileAsync("git", ["branch", "--show-current"], {
          cwd,
          timeout: 5000,
        });
        currentBranch = stdout.trim();
      } catch {
        // ignore
      }
    }

    return successResult({
      workspace: {
        id: workspace.id,
        title: workspace.title,
        repoPath: workspace.repoPath,
        branch: currentBranch ?? workspace.branch,
        status: workspace.status,
        metadata: workspace.metadata,
        createdAt: workspace.createdAt.toISOString(),
        updatedAt: workspace.updatedAt.toISOString(),
      },
      agents: {
        total: agents.length,
        active: agents.filter((a) => a.status === "ACTIVE").length,
        completed: agents.filter((a) => a.status === "COMPLETED").length,
        byRole: {
          ROUTA: agents.filter((a) => a.role === "ROUTA").length,
          CRAFTER: agents.filter((a) => a.role === "CRAFTER").length,
          GATE: agents.filter((a) => a.role === "GATE").length,
          DEVELOPER: agents.filter((a) => a.role === "DEVELOPER").length,
        },
      },
      tasks: {
        total: tasks.length,
        pending: tasks.filter((t) => t.status === "PENDING").length,
        inProgress: tasks.filter((t) => t.status === "IN_PROGRESS").length,
        completed: tasks.filter((t) => t.status === "COMPLETED").length,
        needsFix: tasks.filter((t) => t.status === "NEEDS_FIX").length,
      },
      notes: {
        total: notes.length,
        spec: notes.filter((n) => n.metadata.type === "spec").length,
        task: notes.filter((n) => n.metadata.type === "task").length,
        general: notes.filter((n) => n.metadata.type === "general").length,
      },
    });
  }

  // ─── List Workspaces ──────────────────────────────────────────────

  async listWorkspaces(): Promise<ToolResult> {
    if (!this.workspaceStore) {
      return errorResult("Workspace store not configured.");
    }

    const all = await this.workspaceStore.list();
    return successResult(
      all.map((ws) => ({
        id: ws.id,
        title: ws.title,
        status: ws.status,
        branch: ws.branch,
        createdAt: ws.createdAt.toISOString(),
      }))
    );
  }

  // ─── Create Workspace ─────────────────────────────────────────────

  async createWorkspace(params: {
    id: string;
    title: string;
    repoPath?: string;
    branch?: string;
  }): Promise<ToolResult> {
    if (!this.workspaceStore) {
      return errorResult("Workspace store not configured.");
    }

    const existing = await this.workspaceStore.get(params.id);
    if (existing) {
      return errorResult(`Workspace already exists: ${params.id}`);
    }

    const { createWorkspace: createWs } = await import("../models/workspace");
    const workspace = createWs(params);
    await this.workspaceStore.save(workspace);

    return successResult({
      workspaceId: workspace.id,
      title: workspace.title,
    });
  }
}
