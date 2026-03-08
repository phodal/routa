/**
 * Worker Abstraction Layer — Public API
 *
 * Re-exports all public types and classes for the Worker module.
 * Import from "@/core/worker" to access the Worker abstraction layer.
 *
 * Phase 1 of the Worker Orchestration architecture (#71).
 */

// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  WorkerType,
  WorkerStatus,
  WorkerCapability,
  Worker,
  WorkerHeartbeat,
  WorkerStatusInfo,
  WorkerConstraints,
  TaskExecutionResult,
} from "./types";

// ─── Implementations ─────────────────────────────────────────────────────────
export { LocalWorker } from "./local-worker";
export { DockerWorker } from "./docker-worker";

// ─── Registry ────────────────────────────────────────────────────────────────
export { WorkerRegistry } from "./registry";
