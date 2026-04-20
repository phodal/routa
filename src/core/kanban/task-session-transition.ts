import type { Task, TaskLaneSessionStatus } from "../models/task";
import { markTaskLaneSessionStatus } from "./task-lane-history";

type TaskSessionArchiveState = Pick<Task, "triggerSessionId" | "sessionIds">;

type TaskSessionHistoryState = Pick<
  Task,
  "columnId" | "triggerSessionId" | "sessionIds" | "lastSyncError" | "laneSessions" | "laneHandoffs"
>;

export function archiveActiveTaskSession(task: TaskSessionArchiveState): void {
  if (!task.triggerSessionId) {
    return;
  }
  if (!task.sessionIds.includes(task.triggerSessionId)) {
    task.sessionIds.push(task.triggerSessionId);
  }
}

export function finalizeActiveTaskSession(
  task: TaskSessionHistoryState,
  status: Exclude<TaskLaneSessionStatus, "running"> = "completed",
): void {
  if (!task.triggerSessionId) {
    return;
  }

  archiveActiveTaskSession(task);
  markTaskLaneSessionStatus(task, task.triggerSessionId, status);
  task.triggerSessionId = undefined;
}

export function completeRunningSessionsOutsideColumn(
  task: Pick<Task, "columnId" | "triggerSessionId" | "laneSessions" | "laneHandoffs">,
  columnId: string | undefined,
  options?: { excludeSessionId?: string },
): boolean {
  let mutated = false;

  for (const entry of task.laneSessions ?? []) {
    if (entry.status !== "running") {
      continue;
    }
    if (entry.sessionId === options?.excludeSessionId) {
      continue;
    }
    if (entry.columnId === columnId) {
      continue;
    }

    markTaskLaneSessionStatus(task, entry.sessionId, "completed");
    mutated = true;
  }

  return mutated;
}

export function prepareTaskForColumnChange(
  previousColumnId: string | undefined,
  task: TaskSessionHistoryState,
): boolean {
  if (task.columnId === previousColumnId) {
    return false;
  }

  finalizeActiveTaskSession(task);
  task.lastSyncError = undefined;
  return true;
}
