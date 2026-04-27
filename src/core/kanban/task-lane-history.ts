import type {
  Task,
  TaskLaneHandoff,
  TaskLaneHandoffRequestType,
  TaskLaneHandoffStatus,
  TaskLaneSession,
  TaskLaneSessionStatus,
} from "../models/task";
import type { KanbanBoard } from "../models/kanban";
import { refreshTaskLaneExperienceMemory } from "./task-lane-experience";

type TaskLaneHistoryState = Pick<Task, "laneSessions" | "laneHandoffs" | "triggerSessionId" | "columnId">
  & Partial<Pick<Task, "id" | "title" | "objective" | "contextSearchSpec" | "jitContextSnapshot">>;

export function ensureTaskLaneHistory(task: TaskLaneHistoryState): void {
  if (!task.laneSessions) {
    task.laneSessions = [];
  }
  if (!task.laneHandoffs) {
    task.laneHandoffs = [];
  }
}

export function upsertTaskLaneSession(
  task: TaskLaneHistoryState,
  session: Omit<TaskLaneSession, "startedAt" | "status"> & {
    startedAt?: string;
    status?: TaskLaneSessionStatus;
  },
): TaskLaneSession {
  ensureTaskLaneHistory(task);

  const existing = task.laneSessions.find((entry) => entry.sessionId === session.sessionId);
  if (existing) {
    Object.assign(existing, session);
    if (!existing.startedAt) {
      existing.startedAt = session.startedAt ?? new Date().toISOString();
    }
    if (!existing.status) {
      existing.status = session.status ?? "running";
    }
    refreshTaskLaneExperienceMemory(task);
    return existing;
  }

  const created: TaskLaneSession = {
    sessionId: session.sessionId,
    routaAgentId: session.routaAgentId,
    worktreeId: session.worktreeId,
    cwd: session.cwd,
    columnId: session.columnId,
    columnName: session.columnName,
    stepId: session.stepId,
    stepIndex: session.stepIndex,
    stepName: session.stepName,
    provider: session.provider,
    role: session.role,
    specialistId: session.specialistId,
    specialistName: session.specialistName,
    transport: session.transport,
    externalTaskId: session.externalTaskId,
    contextId: session.contextId,
    attempt: session.attempt,
    loopMode: session.loopMode,
    completionRequirement: session.completionRequirement,
    objective: session.objective,
    lastActivityAt: session.lastActivityAt,
    recoveredFromSessionId: session.recoveredFromSessionId,
    recoveryReason: session.recoveryReason,
    status: session.status ?? "running",
    startedAt: session.startedAt ?? new Date().toISOString(),
    completedAt: session.completedAt,
  };
  task.laneSessions.push(created);
  refreshTaskLaneExperienceMemory(task);
  return created;
}

export function markTaskLaneSessionStatus(
  task: TaskLaneHistoryState,
  sessionId: string | undefined,
  status: TaskLaneSessionStatus,
): TaskLaneSession | undefined {
  if (!sessionId) {
    return undefined;
  }

  ensureTaskLaneHistory(task);
  const entry = task.laneSessions.find((item) => item.sessionId === sessionId);
  if (!entry) {
    return undefined;
  }

  entry.status = status;
  if (status !== "running") {
    entry.completedAt = new Date().toISOString();
  }
  refreshTaskLaneExperienceMemory(task);
  return entry;
}

export function getTaskLaneSession(task: TaskLaneHistoryState, sessionId: string | undefined): TaskLaneSession | undefined {
  if (!sessionId) {
    return undefined;
  }
  ensureTaskLaneHistory(task);
  return task.laneSessions.find((entry) => entry.sessionId === sessionId);
}

export function getLatestLaneSessionForColumn(
  task: TaskLaneHistoryState,
  columnId: string | undefined,
): TaskLaneSession | undefined {
  if (!columnId) {
    return undefined;
  }
  ensureTaskLaneHistory(task);
  for (let index = task.laneSessions.length - 1; index >= 0; index -= 1) {
    const entry = task.laneSessions[index];
    if (entry.columnId === columnId) {
      return entry;
    }
  }
  return undefined;
}

export function getPreviousLaneSession(
  task: TaskLaneHistoryState,
  board: KanbanBoard,
  currentColumnId: string | undefined,
): TaskLaneSession | undefined {
  if (!currentColumnId) {
    return undefined;
  }

  const orderedColumns = board.columns.slice().sort((left, right) => left.position - right.position);
  const currentIndex = orderedColumns.findIndex((column) => column.id === currentColumnId);
  if (currentIndex <= 0) {
    return undefined;
  }

  const previousColumn = orderedColumns[currentIndex - 1];
  return getLatestLaneSessionForColumn(task, previousColumn.id);
}

export function getPreviousLaneRun(
  task: TaskLaneHistoryState,
  sessionId: string | undefined,
): TaskLaneSession | undefined {
  if (!sessionId) {
    return undefined;
  }

  ensureTaskLaneHistory(task);
  const currentIndex = task.laneSessions.findIndex((entry) => entry.sessionId === sessionId);
  if (currentIndex <= 0) {
    return undefined;
  }

  const currentSession = task.laneSessions[currentIndex];
  let fallback: TaskLaneSession | undefined;

  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const entry = task.laneSessions[index];
    if (entry.columnId !== currentSession.columnId) {
      continue;
    }
    if (!fallback) {
      fallback = entry;
    }
    if (
      typeof currentSession.stepIndex === "number"
      && currentSession.stepIndex > 0
      && typeof entry.stepIndex === "number"
      && entry.stepIndex < currentSession.stepIndex
    ) {
      return entry;
    }
  }

  return fallback;
}

export function createTaskLaneHandoff(params: {
  id: string;
  fromSessionId: string;
  toSessionId: string;
  fromColumnId?: string;
  toColumnId?: string;
  worktreeId?: string;
  cwd?: string;
  requestType: TaskLaneHandoffRequestType;
  request: string;
  status?: TaskLaneHandoffStatus;
}): TaskLaneHandoff {
  return {
    id: params.id,
    fromSessionId: params.fromSessionId,
    toSessionId: params.toSessionId,
    fromColumnId: params.fromColumnId,
    toColumnId: params.toColumnId,
    worktreeId: params.worktreeId,
    cwd: params.cwd,
    requestType: params.requestType,
    request: params.request,
    status: params.status ?? "requested",
    requestedAt: new Date().toISOString(),
  };
}

export function upsertTaskLaneHandoff(
  task: TaskLaneHistoryState,
  handoff: TaskLaneHandoff,
): TaskLaneHandoff {
  ensureTaskLaneHistory(task);
  const existing = task.laneHandoffs.find((entry) => entry.id === handoff.id);
  if (existing) {
    Object.assign(existing, handoff);
    refreshTaskLaneExperienceMemory(task);
    return existing;
  }
  task.laneHandoffs.push(handoff);
  refreshTaskLaneExperienceMemory(task);
  return handoff;
}

export function getTaskLaneHandoff(
  task: TaskLaneHistoryState,
  handoffId: string,
): TaskLaneHandoff | undefined {
  ensureTaskLaneHistory(task);
  return task.laneHandoffs.find((entry) => entry.id === handoffId);
}
