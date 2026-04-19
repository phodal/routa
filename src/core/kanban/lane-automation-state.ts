import {
  getKanbanAutomationSteps,
  type KanbanAutomationStep,
  type KanbanColumn,
} from "../models/kanban";
import type { Task, TaskLaneSession } from "../models/task";
import { getTaskLaneSession } from "./task-lane-history";

export interface CurrentLaneAutomationState {
  currentColumnId: string;
  currentColumn?: KanbanColumn;
  steps: KanbanAutomationStep[];
  currentSession?: TaskLaneSession;
  currentStepIndex?: number;
  currentStep?: KanbanAutomationStep;
  nextStep?: KanbanAutomationStep;
  hasRemainingSteps: boolean;
}

function getStepMatchScore(
  step: KanbanAutomationStep,
  task: Pick<Task, "assignedProvider" | "assignedRole" | "assignedSpecialistId" | "assignedSpecialistName">,
): number {
  let score = 0;

  if (step.specialistId && task.assignedSpecialistId) {
    if (step.specialistId !== task.assignedSpecialistId) return -1;
    score += 8;
  }
  if (step.specialistName && task.assignedSpecialistName) {
    if (step.specialistName !== task.assignedSpecialistName) return -1;
    score += 4;
  }
  if (step.role && task.assignedRole) {
    if (step.role !== task.assignedRole) return -1;
    score += 2;
  }
  if (step.providerId && task.assignedProvider) {
    if (step.providerId !== task.assignedProvider) return -1;
    score += 1;
  }

  return score;
}

function findStepIndexFromTaskAssignment(
  steps: KanbanAutomationStep[],
  task: Pick<Task, "assignedProvider" | "assignedRole" | "assignedSpecialistId" | "assignedSpecialistName">,
): number | undefined {
  let bestIndex: number | undefined;
  let bestScore = -1;

  for (const [index, step] of steps.entries()) {
    const score = getStepMatchScore(step, task);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestScore > 0 ? bestIndex : undefined;
}

function findCurrentLaneSession(
  task: Pick<Task, "columnId" | "triggerSessionId" | "laneSessions" | "laneHandoffs">,
  currentColumnId: string,
  sessionId?: string,
): TaskLaneSession | undefined {
  const sessionCandidates = [sessionId, task.triggerSessionId].filter((value): value is string => Boolean(value));

  for (const candidate of sessionCandidates) {
    const session = getTaskLaneSession(task, candidate);
    if (session?.columnId === currentColumnId) {
      return session;
    }
  }

  return [...(task.laneSessions ?? [])]
    .reverse()
    .find((session) => (
      session.columnId === currentColumnId
      && (
        session.status === "running"
        || session.status === "transitioned"
        || session.status === "completed"
        || session.status === "timed_out"
        || session.status === "failed"
      )
    ));
}

export function resolveCurrentLaneAutomationState(
  task: Pick<
    Task,
    | "columnId"
    | "triggerSessionId"
    | "laneSessions"
    | "laneHandoffs"
    | "assignedProvider"
    | "assignedRole"
    | "assignedSpecialistId"
    | "assignedSpecialistName"
  >,
  boardColumns: KanbanColumn[] = [],
  options?: { currentSessionId?: string },
): CurrentLaneAutomationState {
  const currentColumnId = task.columnId ?? "backlog";
  const currentColumn = boardColumns.find((column) => column.id === currentColumnId);
  const steps = getKanbanAutomationSteps(currentColumn?.automation);
  const currentSession = findCurrentLaneSession(task, currentColumnId, options?.currentSessionId);

  let currentStepIndex = currentSession?.stepIndex;
  if (
    typeof currentStepIndex !== "number"
    || currentStepIndex < 0
    || currentStepIndex >= steps.length
  ) {
    currentStepIndex = findStepIndexFromTaskAssignment(steps, task);
  }
  if (
    (typeof currentStepIndex !== "number" || currentStepIndex < 0)
    && steps.length === 1
  ) {
    currentStepIndex = 0;
  }
  if ((typeof currentStepIndex !== "number" || currentStepIndex < 0) && steps.length > 1) {
    console.warn("[LaneAutomation] Could not resolve active step for multi-step lane", {
      currentColumnId,
      currentSessionId: currentSession?.sessionId,
      steps: steps.map((step) => step.id ?? step.specialistId ?? step.specialistName ?? step.role ?? "unknown"),
      assignedProvider: task.assignedProvider,
      assignedRole: task.assignedRole,
      assignedSpecialistId: task.assignedSpecialistId,
      assignedSpecialistName: task.assignedSpecialistName,
    });
  }

  const currentStep = typeof currentStepIndex === "number" ? steps[currentStepIndex] : undefined;
  const nextStep = typeof currentStepIndex === "number" ? steps[currentStepIndex + 1] : undefined;
  const hasRemainingSteps = typeof currentStepIndex === "number"
    ? currentStepIndex < steps.length - 1
    : steps.length > 1;

  return {
    currentColumnId,
    currentColumn,
    steps,
    currentSession,
    currentStepIndex,
    currentStep,
    nextStep,
    hasRemainingSteps,
  };
}

export function buildRemainingLaneStepsMessage(
  taskTitle: string,
  state: CurrentLaneAutomationState,
): string | undefined {
  if (!state.hasRemainingSteps || !state.nextStep) {
    return undefined;
  }

  const currentLabel = state.currentStep?.specialistName
    ?? state.currentStep?.specialistId
    ?? state.currentStep?.role
    ?? `step ${typeof state.currentStepIndex === "number" ? state.currentStepIndex + 1 : 1}`;
  const nextLabel = state.nextStep.specialistName
    ?? state.nextStep.specialistId
    ?? state.nextStep.role
    ?? `step ${typeof state.currentStepIndex === "number" ? state.currentStepIndex + 2 : 2}`;

  return `Cannot move "${taskTitle}" out of ${state.currentColumn?.name ?? state.currentColumnId} yet: ${currentLabel} is still active and ${nextLabel} must run next in the same lane.`;
}
