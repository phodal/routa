/**
 * WorkerRegistry — In-memory registry for tracking available workers.
 *
 * Provides methods to register, deregister, and query workers based on
 * type, capabilities, and availability. Used by the Scheduler to find
 * suitable workers for task dispatch.
 *
 * Phase 1: Pure in-memory Map. Phase 3 will add DB persistence for
 * cross-process/serverless state sharing.
 *
 * This is Phase 1 of the Worker Orchestration architecture (#71).
 */

import type {
  Worker,
  WorkerType,
  WorkerConstraints,
  WorkerStatusInfo,
} from "./types";

// ─── WorkerRegistry ──────────────────────────────────────────────────────────

export class WorkerRegistry {
  private workers = new Map<string, Worker>();

  /**
   * Register a worker in the registry.
   * If a worker with the same ID already exists, it will be replaced.
   *
   * @param worker - The worker to register
   */
  register(worker: Worker): void {
    this.workers.set(worker.id, worker);
    console.log(
      `[WorkerRegistry] Registered worker: ${worker.id} (type=${worker.type}, ` +
      `capabilities=[${worker.capabilities.join(", ")}], maxConcurrency=${worker.maxConcurrency})`
    );
  }

  /**
   * Remove a worker from the registry.
   *
   * @param workerId - The ID of the worker to remove
   * @returns true if the worker was found and removed
   */
  deregister(workerId: string): boolean {
    const removed = this.workers.delete(workerId);
    if (removed) {
      console.log(`[WorkerRegistry] Deregistered worker: ${workerId}`);
    }
    return removed;
  }

  /**
   * Get a specific worker by ID.
   *
   * @param workerId - The worker ID
   * @returns The worker, or undefined if not found
   */
  get(workerId: string): Worker | undefined {
    return this.workers.get(workerId);
  }

  /**
   * Get all registered workers.
   */
  getAllWorkers(): Worker[] {
    return Array.from(this.workers.values());
  }

  /**
   * Get workers filtered by type.
   *
   * @param type - The worker type to filter by
   */
  getWorkersByType(type: WorkerType): Worker[] {
    return Array.from(this.workers.values()).filter(
      (w) => w.type === type,
    );
  }

  /**
   * Get available workers that match the given constraints.
   *
   * A worker is "available" if:
   * 1. Its status is REGISTERED or HEALTHY
   * 2. It has spare capacity (currentLoad < maxConcurrency)
   * 3. It matches all constraint filters (type, capabilities)
   *
   * Results are sorted by load (least-loaded first), with affinity
   * preference applied when a preferredWorkerId is specified.
   *
   * @param constraints - Optional filtering constraints
   */
  getAvailable(constraints?: WorkerConstraints): Worker[] {
    let candidates = Array.from(this.workers.values());

    // Filter by health — only REGISTERED or HEALTHY workers can accept tasks
    candidates = candidates.filter(
      (w) => w.status === "REGISTERED" || w.status === "HEALTHY",
    );

    // Filter by capacity — must have at least 1 free slot
    candidates = candidates.filter(
      (w) => w.currentLoad < w.maxConcurrency,
    );

    if (constraints) {
      // Filter by type
      if (constraints.type) {
        candidates = candidates.filter((w) => w.type === constraints.type);
      }

      // Filter by capabilities — worker must have ALL required capabilities
      if (constraints.capabilities && constraints.capabilities.length > 0) {
        const required = new Set(constraints.capabilities);
        candidates = candidates.filter((w) =>
          [...required].every((cap) => w.capabilities.includes(cap)),
        );
      }
    }

    // Sort by load (least-loaded first for even distribution)
    candidates.sort((a, b) => {
      // If there's a preferred worker, prioritize it
      if (constraints?.preferredWorkerId) {
        if (a.id === constraints.preferredWorkerId) return -1;
        if (b.id === constraints.preferredWorkerId) return 1;
      }

      // Then sort by load ratio (currentLoad / maxConcurrency)
      const loadRatioA = a.currentLoad / a.maxConcurrency;
      const loadRatioB = b.currentLoad / b.maxConcurrency;
      return loadRatioA - loadRatioB;
    });

    return candidates;
  }

  /**
   * Get status info for all registered workers.
   */
  getStatusAll(): WorkerStatusInfo[] {
    return Array.from(this.workers.values()).map((w) => w.getStatus());
  }

  /**
   * Total number of registered workers.
   */
  get size(): number {
    return this.workers.size;
  }

  /**
   * Total available capacity across all healthy workers.
   */
  getTotalAvailableCapacity(): number {
    return Array.from(this.workers.values())
      .filter((w) => w.status === "REGISTERED" || w.status === "HEALTHY")
      .reduce((sum, w) => sum + (w.maxConcurrency - w.currentLoad), 0);
  }

  /**
   * Total current load across all workers.
   */
  getTotalCurrentLoad(): number {
    return Array.from(this.workers.values())
      .reduce((sum, w) => sum + w.currentLoad, 0);
  }
}
