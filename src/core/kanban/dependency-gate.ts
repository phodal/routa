/**
 * Dependency Gate
 *
 * Shared functions for checking, syncing, and updating task dependency state.
 * Used by the workflow orchestrator, API routes, and session queue.
 */

import { TaskStatus, type Task } from "../models/task";

export interface DependencyGateResult {
  blocked: boolean;
  pendingDependencies: string[];
}

export async function checkDependencyGate(
  task: { dependencies: string[] },
  boardColumns: Array<{ id: string; stage?: string }>,
  taskStore: { get(id: string): Promise<Task | undefined | null> },
): Promise<DependencyGateResult> {
  if (!task.dependencies || task.dependencies.length === 0) {
    return { blocked: false, pendingDependencies: [] };
  }

  const doneColumnIds = new Set(
    boardColumns
      .filter((col) => col.stage === "done")
      .map((col) => col.id),
  );

  const pending: string[] = [];
  for (const depId of task.dependencies) {
    const depTask = await taskStore.get(depId);
    if (!depTask) continue;
    const inDoneColumn = depTask.status === TaskStatus.COMPLETED
      || doneColumnIds.has(depTask.columnId ?? "");
    const prMerged = !depTask.pullRequestUrl || Boolean(depTask.pullRequestMergedAt);
    const isDone = inDoneColumn && prMerged;
    if (!isDone) {
      pending.push(depTask.title || depId);
    }
  }

  return { blocked: pending.length > 0, pendingDependencies: pending };
}

/**
 * Sync bidirectional dependency relations when a task's dependencies change.
 * Updates the `blocking` array on both the current task and the affected dependency tasks.
 */
export async function updateDependencyRelations(
  taskId: string,
  newDependencies: string[],
  taskStore: {
    get(id: string): Promise<Task | undefined | null>;
    save(task: Task): Promise<void>;
  },
): Promise<void> {
  const task = await taskStore.get(taskId);
  if (!task) return;

  const oldDeps = new Set(task.dependencies);
  const newDeps = new Set(newDependencies);

  const added = newDependencies.filter((id) => !oldDeps.has(id));
  const removed = task.dependencies.filter((id) => !newDeps.has(id));

  // Update the task's own blocking array by scanning workspace for reverse refs.
  // This is done lazily — callers should also set task.dependencies = newDependencies.

  // Add this task to blocking lists of newly-added dependencies
  for (const depId of added) {
    const depTask = await taskStore.get(depId);
    if (!depTask) continue;
    if (!depTask.blocking) depTask.blocking = [];
    if (!depTask.blocking.includes(taskId)) {
      depTask.blocking.push(taskId);
      await taskStore.save(depTask);
    }
  }

  // Remove this task from blocking lists of removed dependencies
  for (const depId of removed) {
    const depTask = await taskStore.get(depId);
    if (!depTask) continue;
    if (depTask.blocking) {
      depTask.blocking = depTask.blocking.filter((id) => id !== taskId);
      await taskStore.save(depTask);
    }
  }
}

/**
 * Update a task's dependencyStatus based on the gate check result.
 */
export function applyDependencyStatus(
  task: Task,
  gateResult: DependencyGateResult,
): void {
  if (gateResult.blocked) {
    task.dependencyStatus = "blocked";
  } else if (task.dependencies.length > 0) {
    task.dependencyStatus = "clear";
  } else {
    task.dependencyStatus = undefined;
  }
}

// ─── Parent-child hierarchy ─────────────────────────────────────

const MAX_PARENT_DEPTH = 8;

/**
 * Validate a parent-child relationship assignment.
 * Returns an error message if invalid, undefined if valid.
 */
export function validateParentAssignment(
  taskId: string,
  parentTaskId: string,
): string | undefined {
  if (taskId === parentTaskId) {
    return "A task cannot be its own parent.";
  }
  return undefined;
}

/**
 * Detect circular parent chains by walking up the parent hierarchy.
 * Returns true if a cycle is detected.
 */
export async function detectParentCycle(
  taskId: string,
  parentTaskId: string,
  taskStore: { get(id: string): Promise<Task | undefined | null> },
): Promise<boolean> {
  const visited = new Set<string>([taskId]);
  let currentId: string | undefined = parentTaskId;

  for (let depth = 0; depth < MAX_PARENT_DEPTH; depth++) {
    if (!currentId) return false;
    if (visited.has(currentId)) return true;
    visited.add(currentId);

    const current = await taskStore.get(currentId);
    currentId = current?.parentTaskId;
  }

  return false;
}

export interface ParentProgress {
  completed: number;
  total: number;
  label: string;
}

/**
 * Compute sub-task completion progress for a parent task.
 */
export async function computeParentProgress(
  parentTask: Task,
  taskStore: {
    listByWorkspace(workspaceId: string): Promise<Task[]>;
  },
): Promise<ParentProgress | undefined> {
  const allTasks = await taskStore.listByWorkspace(parentTask.workspaceId);
  const children = allTasks.filter((t) => t.parentTaskId === parentTask.id);

  if (children.length === 0) return undefined;

  const completed = children.filter((t) => t.status === "COMPLETED").length;
  return {
    completed,
    total: children.length,
    label: `${completed}/${children.length} sub-tasks completed`,
  };
}
