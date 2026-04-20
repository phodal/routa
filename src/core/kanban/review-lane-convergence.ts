import type { KanbanColumn, KanbanColumnStage } from "../models/kanban";
import type { Task } from "../models/task";
import { resolveCurrentLaneAutomationState } from "./lane-automation-state";

type ReviewConvergenceTask = Pick<
  Task,
  | "columnId"
  | "verificationVerdict"
  | "triggerSessionId"
  | "laneSessions"
  | "laneHandoffs"
  | "assignedProvider"
  | "assignedRole"
  | "assignedSpecialistId"
  | "assignedSpecialistName"
>;

function resolveColumnIdForStage(
  boardColumns: KanbanColumn[],
  stage: KanbanColumnStage,
): string | undefined {
  const match = boardColumns.find((column) => column.stage === stage);
  return match?.id;
}

function isReviewStage(task: ReviewConvergenceTask, boardColumns: KanbanColumn[]): boolean {
  const currentColumn = boardColumns.find((column) => column.id === task.columnId);
  return currentColumn?.stage === "review" || task.columnId === "review";
}

export function resolveReviewLaneConvergenceTarget(
  task: ReviewConvergenceTask,
  boardColumns: KanbanColumn[] = [],
): string | undefined {
  if (!task.verificationVerdict || !isReviewStage(task, boardColumns)) {
    return undefined;
  }

  const laneAutomationState = resolveCurrentLaneAutomationState(task, boardColumns);
  if (laneAutomationState.hasRemainingSteps) {
    return undefined;
  }

  switch (task.verificationVerdict) {
    case "APPROVED":
      return resolveColumnIdForStage(boardColumns, "done") ?? "done";
    case "NOT_APPROVED":
      return resolveColumnIdForStage(boardColumns, "dev") ?? "dev";
    case "BLOCKED":
      return resolveColumnIdForStage(boardColumns, "blocked") ?? "blocked";
    default:
      return undefined;
  }
}
