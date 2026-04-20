import type { RoutaSessionRecord } from "@/core/acp/http-session-store";
import type { Task, TaskLaneSession } from "@/core/models/task";

export type TaskRunKind = "embedded_acp" | "runner_acp" | "a2a_task";
export type TaskRunStatus = "running" | "completed" | "failed" | "timed_out" | "transitioned" | "unknown";

export interface TaskRunInfo {
  id: string;
  kind: TaskRunKind;
  status: TaskRunStatus;
  sessionId?: string;
  externalTaskId?: string;
  contextId?: string;
  columnId?: string;
  stepId?: string;
  stepName?: string;
  provider?: string;
  specialistName?: string;
  startedAt: string;
  completedAt?: string;
  ownerInstanceId?: string;
  resumeTarget?: {
    type: "session" | "external_task";
    id: string;
  };
}

type SessionLookup = Pick<
  RoutaSessionRecord,
  "sessionId" | "executionMode" | "ownerInstanceId" | "provider" | "createdAt" | "acpStatus"
>;

function toTimestamp(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function resolveKind(
  laneSession: TaskLaneSession,
  session?: SessionLookup,
): TaskRunKind {
  if (laneSession.transport === "a2a") {
    return "a2a_task";
  }

  return session?.executionMode === "runner" ? "runner_acp" : "embedded_acp";
}

function resolveStatus(
  laneSession: TaskLaneSession,
  session?: SessionLookup,
): TaskRunStatus {
  if (
    session?.acpStatus === "error"
    && (!laneSession.status || laneSession.status === "running")
  ) {
    return "failed";
  }

  if (laneSession.status) {
    return laneSession.status;
  }

  if (session?.acpStatus === "connecting" || session?.acpStatus === "ready") return "running";
  return "unknown";
}

function resolveResumeTarget(
  kind: TaskRunKind,
  laneSession: TaskLaneSession,
): TaskRunInfo["resumeTarget"] {
  if (kind === "a2a_task" && laneSession.externalTaskId) {
    return { type: "external_task", id: laneSession.externalTaskId };
  }

  if (laneSession.sessionId) {
    return { type: "session", id: laneSession.sessionId };
  }

  return undefined;
}

export function buildTaskRunLedger(
  task: Pick<Task, "laneSessions">,
  sessionsById: ReadonlyMap<string, SessionLookup>,
): TaskRunInfo[] {
  return [...(task.laneSessions ?? [])]
    .map((laneSession, index) => ({ laneSession, index }))
    .sort((left, right) => {
      const leftTime = toTimestamp(left.laneSession.startedAt, left.index);
      const rightTime = toTimestamp(right.laneSession.startedAt, right.index);
      return rightTime - leftTime;
    })
    .map(({ laneSession }) => {
      const session = sessionsById.get(laneSession.sessionId);
      const kind = resolveKind(laneSession, session);

      return {
        id: laneSession.sessionId,
        kind,
        status: resolveStatus(laneSession, session),
        sessionId: laneSession.sessionId,
        externalTaskId: laneSession.externalTaskId,
        contextId: laneSession.contextId,
        columnId: laneSession.columnId,
        stepId: laneSession.stepId,
        stepName: laneSession.stepName,
        provider: laneSession.provider ?? session?.provider,
        specialistName: laneSession.specialistName,
        startedAt: laneSession.startedAt ?? session?.createdAt ?? new Date(0).toISOString(),
        completedAt: laneSession.completedAt,
        ownerInstanceId: session?.ownerInstanceId,
        resumeTarget: resolveResumeTarget(kind, laneSession),
      } satisfies TaskRunInfo;
    });
}
