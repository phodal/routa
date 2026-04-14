import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getRoutaSystem } from "@/core/routa-system";
import { createKanbanBoard, getKanbanAutomationSteps } from "@/core/models/kanban";
import { ensureDefaultBoard } from "@/core/kanban/boards";
import { getKanbanAutoProvider } from "@/core/kanban/board-auto-provider";
import { getKanbanSessionConcurrencyLimit } from "@/core/kanban/board-session-limits";
import { getKanbanDevSessionSupervision } from "@/core/kanban/board-session-supervision";
import { getKanbanEventBroadcaster } from "@/core/kanban/kanban-event-broadcaster";
import { getKanbanSessionQueue } from "@/core/kanban/workflow-orchestrator-singleton";
import { processKanbanColumnTransition } from "@/core/kanban/workflow-orchestrator-singleton";
import { enqueueKanbanTaskSession } from "@/core/kanban/workflow-orchestrator-singleton";
import { getHttpSessionStore } from "@/core/acp/http-session-store";
import { getAcpProcessManager } from "@/core/acp/processer";
import { getAcpInstanceId, isExecutionLeaseActive } from "@/core/acp/execution-backend";
import {
  getTaskLaneSession,
  markTaskLaneSessionStatus,
} from "@/core/kanban/task-lane-history";
import { TaskStatus, type Task, type TaskLaneSessionStatus } from "@/core/models/task";
import { resolveCurrentLaneAutomationState } from "@/core/kanban/lane-automation-state";
import { resolveReviewLaneConvergenceTarget } from "@/core/kanban/review-lane-convergence";
import { columnIdToTaskStatus } from "@/core/models/kanban";

function isSessionActivelyRunning(
  taskSessionId: string | undefined,
  options: {
    sessionStore: ReturnType<typeof getHttpSessionStore>;
    processManager: ReturnType<typeof getAcpProcessManager>;
  },
): boolean {
  if (!taskSessionId) return false;

  if (options.processManager.hasActiveSession(taskSessionId)) {
    return true;
  }

  const session = options.sessionStore.getSession(taskSessionId);
  if (!session) {
    return false;
  }

  if (session.acpStatus === "ready" || session.acpStatus === "connecting") {
    return true;
  }

  if (session.acpStatus === "error") {
    return false;
  }

  // Hydrated sessions from the DB may not carry runtime ACP status after a restart.
  // In that case, only treat the session as active if its ownership lease is still
  // valid on this exact instance. Otherwise the lane should be revived instead of
  // staying blocked by a stale triggerSessionId.
  const ownerInstanceId = session.ownerInstanceId?.trim();
  if (ownerInstanceId && ownerInstanceId !== getAcpInstanceId()) {
    return false;
  }

  return isExecutionLeaseActive(session.leaseExpiresAt);
}

function resolveStaleLaneSessionTerminalStatus(task: Pick<Task, "verificationVerdict" | "verificationReport" | "completionSummary">): TaskLaneSessionStatus {
  return task.verificationVerdict || task.verificationReport || task.completionSummary
    ? "transitioned"
    : "timed_out";
}

async function sanitizeStaleCurrentLaneAutomation(
  system: ReturnType<typeof getRoutaSystem>,
  task: Task,
  options: {
    sessionStore: ReturnType<typeof getHttpSessionStore>;
    processManager: ReturnType<typeof getAcpProcessManager>;
  },
): Promise<Task> {
  let mutated = false;
  const nextTask: Task = {
    ...task,
    laneSessions: [...(task.laneSessions ?? [])],
    laneHandoffs: [...(task.laneHandoffs ?? [])],
    sessionIds: [...(task.sessionIds ?? [])],
    comments: [...(task.comments ?? [])],
    labels: [...(task.labels ?? [])],
    dependencies: [...(task.dependencies ?? [])],
    codebaseIds: [...(task.codebaseIds ?? [])],
  };

  if (nextTask.triggerSessionId && !isSessionActivelyRunning(nextTask.triggerSessionId, options)) {
    const triggerLaneSession = getTaskLaneSession(nextTask, nextTask.triggerSessionId);
    if (triggerLaneSession && triggerLaneSession.columnId === nextTask.columnId) {
      if (triggerLaneSession.status === "running") {
        markTaskLaneSessionStatus(
          nextTask,
          triggerLaneSession.sessionId,
          resolveStaleLaneSessionTerminalStatus(nextTask),
        );
      }
    }
    nextTask.triggerSessionId = undefined;
    mutated = true;
  }

  for (const entry of nextTask.laneSessions ?? []) {
    if (
      entry.columnId === nextTask.columnId
      && entry.status === "running"
      && !isSessionActivelyRunning(entry.sessionId, options)
    ) {
      markTaskLaneSessionStatus(
        nextTask,
        entry.sessionId,
        resolveStaleLaneSessionTerminalStatus(nextTask),
      );
      mutated = true;
    }
  }

  if (mutated) {
    nextTask.updatedAt = new Date();
    await system.taskStore.save(nextTask);
    return nextTask;
  }

  return task;
}

async function reviveMissingEntryAutomations(
  system: ReturnType<typeof getRoutaSystem>,
  workspaceId: string,
  boardId: string,
  options: {
    sessionStore: ReturnType<typeof getHttpSessionStore>;
    processManager: ReturnType<typeof getAcpProcessManager>;
  },
): Promise<void> {
  const board = await system.kanbanBoardStore.get(boardId);
  if (!board) return;

  const tasks = await system.taskStore.listByWorkspace(workspaceId);
  for (const originalTask of tasks) {
    if (originalTask.boardId !== boardId || !originalTask.columnId) {
      continue;
    }

    const task = await sanitizeStaleCurrentLaneAutomation(system, originalTask, {
      sessionStore: options.sessionStore,
      processManager: options.processManager,
    });
    if (task.triggerSessionId) continue;

    const currentColumnId = task.columnId;
    if (!currentColumnId) continue;
    const column = board.columns.find((entry) => entry.id === currentColumnId);
    if (!column) continue;

    const convergenceColumnId = resolveReviewLaneConvergenceTarget(task, board.columns);
    if (convergenceColumnId && convergenceColumnId !== currentColumnId) {
      const nextTask: Task = {
        ...task,
        columnId: convergenceColumnId,
        status: columnIdToTaskStatus(convergenceColumnId) ?? TaskStatus.COMPLETED,
        updatedAt: new Date(),
      };
      await system.taskStore.save(nextTask);
      getKanbanEventBroadcaster().notify({
        workspaceId,
        entity: "task",
        action: "moved",
        resourceId: nextTask.id,
        source: "system",
      });
      continue;
    }

    const automation = column?.automation;
    const transitionType = automation?.transitionType ?? "entry";
    const hasLaneSessionForCurrentColumn = (task.laneSessions ?? []).some((entry) => (
      entry.columnId === currentColumnId
      && entry.status === "running"
      && isSessionActivelyRunning(entry.sessionId, options)
    ));
    if (
      !automation?.enabled
      || (transitionType !== "entry" && transitionType !== "both")
      || getKanbanAutomationSteps(automation).length === 0
      || hasLaneSessionForCurrentColumn
    ) {
      continue;
    }

    const laneState = resolveCurrentLaneAutomationState(task, board.columns);
    if (
      laneState.currentSession
      && laneState.currentSession.columnId === currentColumnId
      && (laneState.currentSession.status === "transitioned" || laneState.currentSession.status === "completed")
      && laneState.nextStep
      && typeof laneState.currentStepIndex === "number"
    ) {
      await enqueueKanbanTaskSession(system, {
        task,
        expectedColumnId: currentColumnId,
        ignoreExistingTrigger: true,
        step: laneState.nextStep,
        stepIndex: laneState.currentStepIndex + 1,
      });
      continue;
    }

    await processKanbanColumnTransition(system, {
      cardId: task.id,
      cardTitle: task.title,
      boardId,
      workspaceId,
      fromColumnId: "__revive__",
      toColumnId: currentColumnId,
      fromColumnName: "Revive",
      toColumnName: column.name,
    });
  }
}

export const dynamic = "force-dynamic";

function requireWorkspaceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function GET(request: NextRequest) {
  const workspaceId = requireWorkspaceId(request.nextUrl.searchParams.get("workspaceId"));
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  const system = getRoutaSystem();
  await ensureDefaultBoard(system, workspaceId);
  const boards = await system.kanbanBoardStore.listByWorkspace(workspaceId);
  const workspace = await system.workspaceStore.get(workspaceId);
  const queue = getKanbanSessionQueue(system);
  const sessionStore = getHttpSessionStore();
  const processManager = getAcpProcessManager();
  await sessionStore.hydrateFromDb();
  await Promise.all(boards.map((board) => reviveMissingEntryAutomations(system, workspaceId, board.id, {
    sessionStore,
    processManager,
  })));
  return NextResponse.json({
    boards: await Promise.all(boards.map(async (board) => ({
      ...board,
      autoProviderId: getKanbanAutoProvider(workspace?.metadata, board.id),
      sessionConcurrencyLimit: getKanbanSessionConcurrencyLimit(workspace?.metadata, board.id),
      devSessionSupervision: getKanbanDevSessionSupervision(workspace?.metadata, board.id),
      queue: await queue.getBoardSnapshot(board.id),
    }))),
  });
}

export async function POST(request: NextRequest) {
  let body: { workspaceId?: string; name?: string; columns?: ReturnType<typeof createKanbanBoard>["columns"]; isDefault?: boolean };
  try {
    body = await request.json() as { workspaceId?: string; name?: string; columns?: ReturnType<typeof createKanbanBoard>["columns"]; isDefault?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const workspaceId = body.workspaceId?.trim();
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const system = getRoutaSystem();
  const board = createKanbanBoard({
    id: uuidv4(),
    workspaceId,
    name: body.name.trim(),
    isDefault: body.isDefault ?? false,
    columns: body.columns,
  });
  await system.kanbanBoardStore.save(board);
  if (board.isDefault) {
    await system.kanbanBoardStore.setDefault(workspaceId, board.id);
  }
  getKanbanEventBroadcaster().notify({
    workspaceId,
    entity: "board",
    action: "created",
    resourceId: board.id,
    source: "user",
  });
  return NextResponse.json({ board }, { status: 201 });
}
