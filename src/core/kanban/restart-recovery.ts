import { getAcpInstanceId, isExecutionLeaseActive } from "../acp/execution-backend";
import { getHttpSessionStore } from "../acp/http-session-store";
import { getAcpProcessManager } from "../acp/processer";
import type { RoutaSystem } from "../routa-system";
import { getKanbanAutomationSteps, resolveTaskStatusForBoardColumn } from "../models/kanban";
import type { Task, TaskLaneSessionStatus } from "../models/task";
import { getTaskLaneSession, markTaskLaneSessionStatus } from "./task-lane-history";
import { resolveCurrentLaneAutomationState } from "./lane-automation-state";
import { resolveReviewLaneConvergenceTarget } from "./review-lane-convergence";
import { getKanbanEventBroadcaster } from "./kanban-event-broadcaster";
import {
  enqueueKanbanTaskSession,
  processKanbanColumnTransition,
} from "./workflow-orchestrator-singleton";

export interface RestartRecoveryOptions {
  sessionStore: ReturnType<typeof getHttpSessionStore>;
  processManager: ReturnType<typeof getAcpProcessManager>;
}

function isSessionActivelyRunning(
  taskSessionId: string | undefined,
  options: RestartRecoveryOptions,
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

  // Hydrated sessions from storage only remain resumable when the current
  // instance still owns the execution lease.
  const ownerInstanceId = session.ownerInstanceId?.trim();
  if (!ownerInstanceId) {
    return false;
  }
  if (ownerInstanceId !== getAcpInstanceId()) {
    return false;
  }

  return isExecutionLeaseActive(session.leaseExpiresAt);
}

function resolveStaleLaneSessionTerminalStatus(
  task: Pick<Task, "verificationVerdict" | "verificationReport" | "completionSummary" | "pullRequestUrl">,
): TaskLaneSessionStatus {
  if (task.pullRequestUrl) return "completed";
  return task.verificationVerdict || task.verificationReport || task.completionSummary
    ? "transitioned"
    : "timed_out";
}

async function sanitizeStaleCurrentLaneAutomation(
  system: RoutaSystem,
  task: Task,
  options: RestartRecoveryOptions,
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

async function convergeRecoveredReviewTask(
  system: RoutaSystem,
  workspaceId: string,
  boardId: string,
  task: Task,
  currentColumnName: string,
  convergenceColumnId: string,
): Promise<boolean> {
  const board = await system.kanbanBoardStore.get(boardId);
  if (!board) {
    return false;
  }

  const convergenceColumn = board.columns.find((column) => column.id === convergenceColumnId);
  if (!convergenceColumn) {
    const nextTask: Task = {
      ...task,
      columnId: convergenceColumnId,
      status: resolveTaskStatusForBoardColumn(board.columns, convergenceColumnId),
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
    return true;
  }

  const nextTask: Task = {
    ...task,
    columnId: convergenceColumn.id,
    status: resolveTaskStatusForBoardColumn(board.columns, convergenceColumn.id),
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
  await processKanbanColumnTransition(system, {
    cardId: nextTask.id,
    cardTitle: nextTask.title,
    boardId,
    workspaceId,
    fromColumnId: task.columnId ?? "__revive__",
    toColumnId: convergenceColumn.id,
    fromColumnName: currentColumnName,
    toColumnName: convergenceColumn.name,
  });
  return true;
}

export async function reviveMissingEntryAutomations(
  system: RoutaSystem,
  workspaceId: string,
  boardId: string,
  options: RestartRecoveryOptions,
): Promise<void> {
  const board = await system.kanbanBoardStore.get(boardId);
  if (!board) return;

  const tasks = await system.taskStore.listByWorkspace(workspaceId);
  for (const originalTask of tasks) {
    if (originalTask.boardId !== boardId || !originalTask.columnId) {
      continue;
    }

    const task = await sanitizeStaleCurrentLaneAutomation(system, originalTask, options);
    if (task.triggerSessionId) continue;

    const currentColumnId = task.columnId;
    if (!currentColumnId) continue;
    const column = board.columns.find((entry) => entry.id === currentColumnId);
    if (!column) continue;

    const convergenceColumnId = resolveReviewLaneConvergenceTarget(task, board.columns);
    if (convergenceColumnId && convergenceColumnId !== currentColumnId) {
      const converged = await convergeRecoveredReviewTask(
        system,
        workspaceId,
        boardId,
        task,
        column.name,
        convergenceColumnId,
      );
      if (converged) {
        continue;
      }
    }

    const automation = column.automation;
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
    ) {
      if (laneState.nextStep && typeof laneState.currentStepIndex === "number") {
        await enqueueKanbanTaskSession(system, {
          task,
          expectedColumnId: currentColumnId,
          ignoreExistingTrigger: true,
          step: laneState.nextStep,
          stepIndex: laneState.currentStepIndex + 1,
        });
      }
      // Lane automation already completed (with or without remaining steps
      // that were skipped). Skip re-triggering to avoid duplicate sessions.
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
