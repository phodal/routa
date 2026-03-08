/**
 * LocalWorker — Worker implementation for local process execution.
 *
 * Wraps the existing `AcpProcessManager` to provide a unified Worker
 * interface for the Scheduler. Supports all local ACP providers:
 * opencode, claude, claude-code-sdk, workspace-agent, etc.
 *
 * This is Phase 1 of the Worker Orchestration architecture (#71).
 * LocalWorker delegates to AcpProcessManager — it does NOT replace it.
 */

import os from "os";
import type { BackgroundTask } from "@/core/models/background-task";
import type {
  Worker,
  WorkerType,
  WorkerStatus,
  WorkerCapability,
  WorkerHeartbeat,
  WorkerStatusInfo,
  TaskExecutionResult,
} from "./types";

// ─── Constants ───────────────────────────────────────────────────────────────

const LOCAL_WORKER_CAPABILITIES: readonly WorkerCapability[] = [
  "acp",
  "opencode",
  "claude",
  "claude-code-sdk",
  "workspace-agent",
] as const;

/**
 * Calculate max concurrency based on system CPU cores.
 * Uses floor(cores / 2), with a minimum of 1 and maximum of 8.
 */
function getDefaultMaxConcurrency(): number {
  const cpuCount = os.cpus().length;
  return Math.max(1, Math.min(8, Math.floor(cpuCount / 2)));
}

// ─── LocalWorker ─────────────────────────────────────────────────────────────

export class LocalWorker implements Worker {
  readonly id: string;
  readonly type: WorkerType = "local";
  readonly capabilities: readonly WorkerCapability[];
  readonly maxConcurrency: number;

  status: WorkerStatus = "REGISTERED";
  currentLoad = 0;

  /** taskId → sessionId mapping for active tasks */
  private activeTasks = new Map<string, string>();
  private lastHeartbeatTime?: Date;

  constructor(options?: {
    id?: string;
    capabilities?: WorkerCapability[];
    maxConcurrency?: number;
  }) {
    this.id = options?.id ?? `local-worker-${crypto.randomUUID().slice(0, 8)}`;
    this.capabilities = options?.capabilities ?? LOCAL_WORKER_CAPABILITIES;
    this.maxConcurrency = options?.maxConcurrency ?? getDefaultMaxConcurrency();
  }

  /**
   * Execute a background task by delegating to AcpProcessManager.
   *
   * Uses dynamic import to avoid circular dependencies — AcpProcessManager
   * is loaded lazily at execution time.
   */
  async execute(task: BackgroundTask): Promise<TaskExecutionResult> {
    if (this.currentLoad >= this.maxConcurrency) {
      return {
        sessionId: "",
        accepted: false,
        error: `Worker ${this.id} is at capacity (${this.currentLoad}/${this.maxConcurrency})`,
      };
    }

    try {
      const { getAcpProcessManager } = await import("@/core/acp/processer");
      const manager = getAcpProcessManager();

      // Determine session creation method based on task's agentId
      const sessionId = crypto.randomUUID();
      const cwd = process.cwd();
      const noopNotification = () => {};

      // Known ACP providers — mirrors BackgroundTaskWorker logic
      const KNOWN_PROVIDERS = new Set([
        "opencode",
        "gemini",
        "codex",
        "copilot",
        "auggie",
        "kimi",
        "kiro",
        "claude",
        "claude-code-sdk",
      ]);

      let acpSessionId: string;

      if (task.agentId === "claude" || task.agentId === "claude-code-sdk") {
        acpSessionId = await manager.createClaudeSession(
          sessionId,
          cwd,
          noopNotification,
        );
      } else if (task.agentId === "workspace-agent") {
        acpSessionId = await manager.createWorkspaceAgentSession(
          sessionId,
          cwd,
          noopNotification,
        );
      } else if (KNOWN_PROVIDERS.has(task.agentId)) {
        acpSessionId = await manager.createSession(
          sessionId,
          cwd,
          noopNotification,
          task.agentId,
          undefined,
          undefined,
          undefined,
          task.workspaceId,
        );
      } else {
        // Unknown agentId — try as a generic ACP session
        acpSessionId = await manager.createSession(
          sessionId,
          cwd,
          noopNotification,
          task.agentId,
          undefined,
          undefined,
          undefined,
          task.workspaceId,
        );
      }

      this.activeTasks.set(task.id, sessionId);
      this.currentLoad = this.activeTasks.size;
      this.status = "HEALTHY";

      return {
        sessionId: acpSessionId,
        accepted: true,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        sessionId: "",
        accepted: false,
        error: `LocalWorker execute failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Cancel a running task by killing its ACP session.
   */
  async cancel(taskId: string): Promise<boolean> {
    const sessionId = this.activeTasks.get(taskId);
    if (!sessionId) return false;

    try {
      const { getAcpProcessManager } = await import("@/core/acp/processer");
      const manager = getAcpProcessManager();
      manager.killSession(sessionId);

      this.activeTasks.delete(taskId);
      this.currentLoad = this.activeTasks.size;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Heartbeat — report current status and active tasks.
   */
  async heartbeat(): Promise<WorkerHeartbeat> {
    this.lastHeartbeatTime = new Date();
    if (this.status === "REGISTERED" || this.status === "SUSPECT") {
      this.status = "HEALTHY";
    }

    return {
      workerId: this.id,
      status: this.status,
      currentLoad: this.currentLoad,
      maxConcurrency: this.maxConcurrency,
      activeTasks: Array.from(this.activeTasks.keys()),
      timestamp: this.lastHeartbeatTime,
    };
  }

  /**
   * Get current status snapshot.
   */
  getStatus(): WorkerStatusInfo {
    return {
      id: this.id,
      type: this.type,
      status: this.status,
      capabilities: this.capabilities,
      currentLoad: this.currentLoad,
      maxConcurrency: this.maxConcurrency,
      activeTasks: Array.from(this.activeTasks.keys()),
      lastHeartbeat: this.lastHeartbeatTime,
    };
  }

  /**
   * Mark a task as completed (called externally when task finishes).
   * This updates the worker's internal bookkeeping.
   */
  completeTask(taskId: string): void {
    this.activeTasks.delete(taskId);
    this.currentLoad = this.activeTasks.size;
  }
}
