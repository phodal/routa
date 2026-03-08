/**
 * Worker Abstraction Layer — Type definitions
 *
 * Defines the unified Worker interface that wraps different execution
 * environments (local processes, Docker containers, remote workers).
 *
 * This is Phase 1 of the Worker Orchestration architecture (#71).
 * Workers are a NEW abstraction layer on top of existing managers
 * (AcpProcessManager, DockerProcessManager) — they do NOT replace them.
 */

import type { BackgroundTask } from "@/core/models/background-task";

// ─── Worker Type & Status ────────────────────────────────────────────────────

/** The execution environment for a worker. */
export type WorkerType = "local" | "docker" | "remote";

/**
 * Worker health status, modeled as a state machine:
 *   REGISTERED → HEALTHY → SUSPECT → UNHEALTHY → DEAD
 *
 * - REGISTERED: Just created, not yet confirmed healthy
 * - HEALTHY:    Responding to heartbeats normally
 * - SUSPECT:    Missed 1 heartbeat
 * - UNHEALTHY:  Missed 3+ heartbeats, tasks should be reassigned
 * - DEAD:       Missed 6+ heartbeats (60s+), should be deregistered
 */
export type WorkerStatus =
  | "REGISTERED"
  | "HEALTHY"
  | "SUSPECT"
  | "UNHEALTHY"
  | "DEAD";

// ─── Capability ──────────────────────────────────────────────────────────────

/**
 * A string tag describing what a worker can do.
 * Examples: "acp", "opencode", "claude", "claude-code-sdk",
 *           "workspace-agent", "isolated"
 */
export type WorkerCapability = string;

// ─── Task Execution ──────────────────────────────────────────────────────────

/** Result returned after a worker starts executing a task. */
export interface TaskExecutionResult {
  /** The ACP session ID created for this task */
  sessionId: string;
  /** Whether the task was accepted and started successfully */
  accepted: boolean;
  /** Optional error message if the task was rejected */
  error?: string;
}

// ─── Worker Interface ────────────────────────────────────────────────────────

/**
 * Unified Worker interface.
 *
 * Each Worker wraps an execution environment and exposes a consistent API
 * for the Scheduler to dispatch tasks, check health, and manage lifecycle.
 */
export interface Worker {
  /** Unique identifier for this worker */
  readonly id: string;

  /** Execution environment type */
  readonly type: WorkerType;

  /** What this worker can do (used for constraint-based routing) */
  readonly capabilities: readonly WorkerCapability[];

  /** Current health status */
  status: WorkerStatus;

  /** Number of tasks currently being executed */
  currentLoad: number;

  /** Maximum number of concurrent tasks this worker can handle */
  readonly maxConcurrency: number;

  /**
   * Execute a background task on this worker.
   * The worker should create the appropriate ACP session and start processing.
   *
   * @param task - The background task to execute
   * @returns Result with the created session ID
   */
  execute(task: BackgroundTask): Promise<TaskExecutionResult>;

  /**
   * Cancel a running task on this worker.
   *
   * @param taskId - The background task ID to cancel
   * @returns true if the task was found and cancellation was initiated
   */
  cancel(taskId: string): Promise<boolean>;

  /**
   * Send a heartbeat signal. Updates the worker's internal health state
   * and returns current status information.
   *
   * @returns Current worker status snapshot
   */
  heartbeat(): Promise<WorkerHeartbeat>;

  /**
   * Get the current status of this worker.
   *
   * @returns Current worker status snapshot
   */
  getStatus(): WorkerStatusInfo;
}

// ─── Heartbeat & Status Info ─────────────────────────────────────────────────

/** Data returned from a heartbeat call. */
export interface WorkerHeartbeat {
  workerId: string;
  status: WorkerStatus;
  currentLoad: number;
  maxConcurrency: number;
  /** IDs of tasks currently being executed */
  activeTasks: string[];
  timestamp: Date;
}

/** Snapshot of a worker's current status. */
export interface WorkerStatusInfo {
  id: string;
  type: WorkerType;
  status: WorkerStatus;
  capabilities: readonly WorkerCapability[];
  currentLoad: number;
  maxConcurrency: number;
  activeTasks: string[];
  lastHeartbeat?: Date;
}

// ─── Worker Constraints ──────────────────────────────────────────────────────

/**
 * Constraints used to filter workers for task assignment.
 * The Scheduler uses these to find a suitable worker for a task.
 */
export interface WorkerConstraints {
  /** Required capabilities — worker must have ALL of these */
  capabilities?: WorkerCapability[];
  /** Required execution environment */
  type?: WorkerType;
  /** Preferred worker ID (for affinity-based routing) */
  preferredWorkerId?: string;
}
