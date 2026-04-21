import type { KanbanBoard } from "../models/kanban";
import type { Task, TaskLaneHandoff, TaskLaneSession } from "../models/task";
import type { LearnedPlaybook } from "../trace/trace-playbook";
import { getPreviousLaneRun, getPreviousLaneSession, getTaskLaneSession } from "./task-lane-history";

export interface SessionRelatedLaneHandoff extends TaskLaneHandoff {
  direction: "incoming" | "outgoing";
  fromColumnName?: string;
  toColumnName?: string;
}

export interface SessionKanbanContext {
  taskId: string;
  taskTitle: string;
  boardId?: string;
  columnId?: string;
  learnedPlaybook?: LearnedPlaybook;
  triggerSessionId?: string;
  currentLaneSession?: TaskLaneSession;
  previousLaneSession?: TaskLaneSession;
  previousLaneRun?: TaskLaneSession;
  relatedHandoffs: SessionRelatedLaneHandoff[];
}

function toTimestamp(value: Date | string | undefined): number {
  if (!value) return 0;
  const normalized = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(normalized) ? normalized : 0;
}

function getTaskRelationScore(task: Task, sessionId: string): number {
  if (task.triggerSessionId === sessionId) return 50;
  if ((task.laneSessions ?? []).some((entry) => entry.sessionId === sessionId)) return 40;
  if ((task.laneHandoffs ?? []).some((handoff) => handoff.fromSessionId === sessionId || handoff.toSessionId === sessionId)) {
    return 30;
  }
  if ((task.sessionIds ?? []).includes(sessionId)) return 20;
  if (task.sessionId === sessionId) return 10;
  return 0;
}

export function findTaskForSession(tasks: Task[], sessionId: string): Task | undefined {
  return tasks
    .filter((task) => getTaskRelationScore(task, sessionId) > 0)
    .sort((left, right) => {
      const scoreDelta = getTaskRelationScore(right, sessionId) - getTaskRelationScore(left, sessionId);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt);
    })[0];
}

function enrichSessionHandoff(
  handoff: TaskLaneHandoff,
  sessionMap: Map<string, TaskLaneSession>,
  sessionId: string,
): SessionRelatedLaneHandoff {
  return {
    ...handoff,
    direction: handoff.toSessionId === sessionId ? "incoming" : "outgoing",
    fromColumnName: sessionMap.get(handoff.fromSessionId)?.columnName,
    toColumnName: sessionMap.get(handoff.toSessionId)?.columnName,
  };
}

export function buildSessionKanbanContext(
  task: Task,
  sessionId: string,
  board?: KanbanBoard,
): SessionKanbanContext {
  const currentLaneSession = getTaskLaneSession(task, sessionId);
  const previousLaneSession = currentLaneSession?.columnId && board
    ? getPreviousLaneSession(task, board, currentLaneSession.columnId)
    : undefined;
  const previousLaneRun = getPreviousLaneRun(task, sessionId);
  const sessionMap = new Map((task.laneSessions ?? []).map((entry) => [entry.sessionId, entry]));
  const relatedHandoffs = (task.laneHandoffs ?? [])
    .filter((handoff) => handoff.fromSessionId === sessionId || handoff.toSessionId === sessionId)
    .map((handoff) => enrichSessionHandoff(handoff, sessionMap, sessionId))
    .sort((left, right) => toTimestamp(right.requestedAt) - toTimestamp(left.requestedAt));

  return {
    taskId: task.id,
    taskTitle: task.title,
    boardId: task.boardId,
    columnId: task.columnId,
    triggerSessionId: task.triggerSessionId,
    currentLaneSession,
    previousLaneSession,
    previousLaneRun,
    relatedHandoffs,
  };
}
