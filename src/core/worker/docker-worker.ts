/**
 * DockerWorker — Worker implementation for Docker container execution.
 *
 * Wraps the existing `DockerProcessManager` + `AcpProcessManager.createDockerSession()`
 * to provide a unified Worker interface. Docker workers provide isolated
 * execution environments with their own filesystem and resource limits.
 *
 * This is Phase 1 of the Worker Orchestration architecture (#71).
 * DockerWorker delegates to existing managers — it does NOT replace them.
 */

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

const DOCKER_WORKER_CAPABILITIES: readonly WorkerCapability[] = [
  "acp",
  "opencode",
  "isolated",
] as const;

/**
 * Default max concurrency for Docker workers.
 * Conservative default — each container uses ~2 CPU + 2GB memory.
 */
const DEFAULT_DOCKER_MAX_CONCURRENCY = 3;

// ─── DockerWorker ────────────────────────────────────────────────────────────

export class DockerWorker implements Worker {
  readonly id: string;
  readonly type: WorkerType = "docker";
  readonly capabilities: readonly WorkerCapability[];
  readonly maxConcurrency: number;

  status: WorkerStatus = "REGISTERED";
  currentLoad = 0;

  /** taskId → sessionId mapping for active tasks */
  private activeTasks = new Map<string, string>();
  private lastHeartbeatTime?: Date;

  /** Optional Docker image override */
  private readonly image?: string;

  constructor(options?: {
    id?: string;
    capabilities?: WorkerCapability[];
    maxConcurrency?: number;
    image?: string;
  }) {
    this.id = options?.id ?? `docker-worker-${crypto.randomUUID().slice(0, 8)}`;
    this.capabilities = options?.capabilities ?? DOCKER_WORKER_CAPABILITIES;
    this.maxConcurrency = options?.maxConcurrency ?? DEFAULT_DOCKER_MAX_CONCURRENCY;
    this.image = options?.image;
  }

  /**
   * Execute a background task inside a Docker container.
   *
   * Uses dynamic import to avoid circular dependencies — AcpProcessManager
   * and DockerProcessManager are loaded lazily at execution time.
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

      const sessionId = crypto.randomUUID();
      const cwd = process.cwd();
      const noopNotification = () => {};

      const acpSessionId = await manager.createDockerSession(
        sessionId,
        cwd,
        noopNotification,
        this.image,
      );

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
        error: `DockerWorker execute failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Cancel a running task by killing the Docker session and stopping the container.
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
   * For Docker workers, also checks Docker daemon connectivity.
   */
  async heartbeat(): Promise<WorkerHeartbeat> {
    this.lastHeartbeatTime = new Date();

    // Check Docker daemon health via DockerDetector singleton
    try {
      const { getDockerDetector } = await import("@/core/acp/docker/detector");
      const detector = getDockerDetector();
      const dockerStatus = await detector.checkAvailability();
      if (!dockerStatus.available) {
        this.status = "UNHEALTHY";
      } else if (this.status === "REGISTERED" || this.status === "SUSPECT") {
        this.status = "HEALTHY";
      }
    } catch {
      // If we can't check Docker, mark as suspect
      if (this.status === "HEALTHY") {
        this.status = "SUSPECT";
      }
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
