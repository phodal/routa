/**
 * Workflow Orchestrator Singleton
 *
 * Provides a global instance of the KanbanWorkflowOrchestrator.
 * Initialized when the RoutaSystem is created.
 */

import {
  KanbanWorkflowOrchestrator,
  type AutomationSessionSupervisionContext,
} from "./workflow-orchestrator";
import type { RoutaSystem } from "../routa-system";
import type {
  KanbanAutomationStep,
  KanbanColumnAutomation,
  KanbanColumnStage,
} from "../models/kanban";
import { TaskStatus } from "../models/task";
import { GitWorktreeService } from "../git/git-worktree-service";
import {
  getDefaultWorkspaceWorktreeRoot,
  getEffectiveWorkspaceMetadata,
} from "../models/workspace";
import {
  resolveKanbanAutomationStep,
  resolveEffectiveTaskAutomation,
  type AutomationSpecialistSummary,
} from "./effective-task-automation";
import { getInternalApiOrigin, triggerAssignedTaskAgent } from "./agent-trigger";
import { KanbanSessionQueue } from "./kanban-session-queue";
import { getKanbanSessionConcurrencyLimit as getBoardSessionConcurrencyLimit } from "./board-session-limits";
import { getKanbanDevSessionSupervision } from "./board-session-supervision";
import { upsertTaskLaneSession } from "./task-lane-history";
import { getHttpSessionStore } from "../acp/http-session-store";
import { consumeAcpPromptResponse } from "../acp/prompt-response";
import { getSpecialistById } from "../orchestration/specialist-prompts";
import type { ColumnTransitionData } from "./column-transition";
import {
  buildTaskEvidenceSummary,
  buildTaskInvestValidation,
  buildTaskStoryReadiness,
} from "./task-derived-summary";

// Use globalThis to survive HMR in Next.js dev mode
const GLOBAL_KEY = "__routa_workflow_orchestrator__";
const STARTED_KEY = "__routa_workflow_orchestrator_started__";
const QUEUE_KEY = "__routa_kanban_session_queue__";

function resolveKanbanSpecialist(
  specialistId: string,
  locale?: string,
): AutomationSpecialistSummary | undefined {
  const specialist = (locale ? getSpecialistById(specialistId, locale) : undefined)
    ?? getSpecialistById(specialistId);
  if (!specialist) return undefined;
  return {
    name: specialist.name,
    role: specialist.role,
    defaultProvider: specialist.defaultProvider,
  };
}

async function createAutomationSession(
  system: RoutaSystem,
  params: {
    workspaceId: string;
    cardTitle: string;
    columnName: string;
    cardId: string;
    columnId: string;
    automation: KanbanColumnAutomation;
    step: KanbanAutomationStep;
    stepIndex: number;
    supervision?: AutomationSessionSupervisionContext;
  },
): Promise<string | null> {
  const task = await system.taskStore.get(params.cardId);
  if (!task?.boardId) return null;
  const resolvedStep = resolveKanbanAutomationStep(params.step, resolveKanbanSpecialist);
  const result = await enqueueKanbanTaskSession(system, {
    task,
    expectedColumnId: params.columnId,
    mutateTask: (nextTask) => {
      nextTask.assignedProvider =
        resolvedStep?.providerId ?? task.assignedProvider ?? "opencode";
      nextTask.assignedRole =
        resolvedStep?.role ?? task.assignedRole ?? "DEVELOPER";
      nextTask.assignedSpecialistId =
        resolvedStep?.specialistId ?? task.assignedSpecialistId;
      nextTask.assignedSpecialistName =
        resolvedStep?.specialistName ?? task.assignedSpecialistName;
    },
    step: params.step,
    stepIndex: params.stepIndex,
    supervision: params.supervision,
  });
  return result.sessionId ?? null;
}

export async function enqueueKanbanTaskSession(
  system: RoutaSystem,
  params: {
    task: Awaited<ReturnType<RoutaSystem["taskStore"]["get"]>>;
    expectedColumnId?: string;
    ignoreExistingTrigger?: boolean;
    mutateTask?: (task: NonNullable<Awaited<ReturnType<RoutaSystem["taskStore"]["get"]>>>) => void;
    step?: KanbanAutomationStep;
    stepIndex?: number;
    supervision?: AutomationSessionSupervisionContext;
  },
): Promise<{ sessionId?: string; queued: boolean; error?: string }> {
  const task = params.task;
  if (!task?.boardId) {
    return { queued: false, error: "Task is missing board context." };
  }
  if (task.triggerSessionId && !params.ignoreExistingTrigger) {
    return { sessionId: task.triggerSessionId, queued: false };
  }

  const queue = getKanbanSessionQueue(system);
  return queue.enqueue({
    cardId: task.id,
    cardTitle: task.title,
    boardId: task.boardId,
    workspaceId: task.workspaceId,
    columnId: params.expectedColumnId ?? task.columnId,
    start: async () => startKanbanTaskSession(system, task.id, params),
  });
}

async function startKanbanTaskSession(
  system: RoutaSystem,
  taskId: string,
  params: {
    expectedColumnId?: string;
    ignoreExistingTrigger?: boolean;
    mutateTask?: (task: NonNullable<Awaited<ReturnType<RoutaSystem["taskStore"]["get"]>>>) => void;
    step?: KanbanAutomationStep;
    stepIndex?: number;
    supervision?: AutomationSessionSupervisionContext;
  },
): Promise<{ sessionId?: string | null; error?: string }> {
  const task = await system.taskStore.get(taskId);
  if (!task) return { error: "Task no longer exists." };
  if (params.expectedColumnId && task.columnId !== params.expectedColumnId) {
    return { error: `Task is no longer in column ${params.expectedColumnId}.` };
  }
  if (task.triggerSessionId && !params.ignoreExistingTrigger) {
    return { sessionId: task.triggerSessionId };
  }

  const nextTask = {
    ...task,
    updatedAt: new Date(),
  };
  params.mutateTask?.(nextTask);
  const board = await system.kanbanBoardStore.get(nextTask.boardId!);

  let preferredCodebase = (nextTask.codebaseIds?.length ?? 0) > 0
    ? await system.codebaseStore.get(nextTask.codebaseIds[0])
    : undefined;
  if (!preferredCodebase) {
    preferredCodebase = await system.codebaseStore.getDefault(nextTask.workspaceId);
  }

  let worktreeCwd = preferredCodebase?.repoPath ?? process.cwd();
  let worktreeBranch = preferredCodebase?.branch;
  if (params.expectedColumnId === "dev" && preferredCodebase && !nextTask.worktreeId) {
    try {
      const worktreeService = new GitWorktreeService(
        system.worktreeStore,
        system.codebaseStore,
      );
      const slugifiedTitle = nextTask.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40);
      const branch = `issue/${nextTask.id.slice(0, 8)}-${slugifiedTitle}`;
      const label = `${nextTask.id.slice(0, 8)}-${slugifiedTitle}`;
      const workspace = await system.workspaceStore.get(nextTask.workspaceId);
      const worktreeRoot = workspace
        ? getEffectiveWorkspaceMetadata(workspace).worktreeRoot
        : getDefaultWorkspaceWorktreeRoot(nextTask.workspaceId);
      const worktree = await worktreeService.createWorktree(preferredCodebase.id, {
        branch,
        baseBranch: preferredCodebase.branch ?? "main",
        label,
        worktreeRoot,
      });
      nextTask.worktreeId = worktree.id;
      worktreeCwd = worktree.worktreePath;
      worktreeBranch = worktree.branch;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      nextTask.status = TaskStatus.BLOCKED;
      nextTask.columnId = "blocked";
      nextTask.lastSyncError = `Worktree creation failed: ${message}`;
      await system.taskStore.save(nextTask);
      return { error: nextTask.lastSyncError };
    }
  } else if (nextTask.worktreeId) {
    const existingWorktree = await system.worktreeStore.get(nextTask.worktreeId);
    if (existingWorktree?.worktreePath) {
      worktreeCwd = existingWorktree.worktreePath;
      worktreeBranch = existingWorktree.branch ?? worktreeBranch;
    }
  }

  const effectiveAutomation = resolveEffectiveTaskAutomation(
    nextTask,
    board?.columns ?? [],
    resolveKanbanSpecialist,
  );
  const sessionStep = resolveKanbanAutomationStep(params.step, resolveKanbanSpecialist)
    ?? effectiveAutomation.step;
  const sessionStepIndex = params.stepIndex ?? effectiveAutomation.stepIndex;
  const taskForSession = {
    ...nextTask,
    assignedProvider: sessionStep?.providerId ?? effectiveAutomation.providerId,
    assignedRole: sessionStep?.role ?? effectiveAutomation.role,
    assignedSpecialistId: sessionStep?.specialistId ?? effectiveAutomation.specialistId,
    assignedSpecialistName: sessionStep?.specialistName ?? effectiveAutomation.specialistName,
  };
  const summaryContext = {
    evidenceSummary: await buildTaskEvidenceSummary(taskForSession, system),
    storyReadiness: await buildTaskStoryReadiness(taskForSession, system),
    investValidation: buildTaskInvestValidation(taskForSession),
  };

  const triggerResult = await triggerAssignedTaskAgent({
    origin: getInternalApiOrigin(),
    workspaceId: nextTask.workspaceId,
    cwd: worktreeCwd,
    branch: worktreeBranch,
    task: taskForSession,
    step: sessionStep,
    specialistLocale: sessionStep?.specialistLocale ?? effectiveAutomation.step?.specialistLocale,
    boardColumns: board?.columns ?? [],
    summaryContext,
    eventBus: system.eventBus,
  });

  if (triggerResult.sessionId) {
    nextTask.triggerSessionId = triggerResult.sessionId;
    // Track session in history
    if (!nextTask.sessionIds) nextTask.sessionIds = [];
    if (!nextTask.sessionIds.includes(triggerResult.sessionId)) {
      nextTask.sessionIds.push(triggerResult.sessionId);
    }
    const currentColumn = board?.columns.find((column) => column.id === nextTask.columnId);
    upsertTaskLaneSession(nextTask, {
      sessionId: triggerResult.sessionId,
      columnId: nextTask.columnId,
      columnName: currentColumn?.name,
      stepId: sessionStep?.id,
      stepIndex: sessionStepIndex,
      stepName: sessionStep?.specialistName ?? sessionStep?.specialistId ?? sessionStep?.role,
      provider: sessionStep?.providerId ?? effectiveAutomation.providerId,
      role: sessionStep?.role ?? effectiveAutomation.role,
      specialistId: sessionStep?.specialistId ?? effectiveAutomation.specialistId,
      specialistName: sessionStep?.specialistName ?? effectiveAutomation.specialistName,
      transport: triggerResult.transport ?? sessionStep?.transport ?? effectiveAutomation.transport,
      externalTaskId: triggerResult.externalTaskId,
      contextId: triggerResult.contextId,
      attempt: params.supervision?.attempt,
      loopMode: params.supervision?.mode,
      completionRequirement: params.supervision?.completionRequirement,
      objective: params.supervision?.objective ?? nextTask.objective,
      recoveredFromSessionId: params.supervision?.recoveredFromSessionId,
      recoveryReason: params.supervision?.recoveryReason,
      status: "running",
    });
    nextTask.lastSyncError = undefined;
    if (nextTask.worktreeId) {
      await system.worktreeStore.assignSession(nextTask.worktreeId, triggerResult.sessionId);
    }
  } else if (triggerResult.error) {
    nextTask.lastSyncError = triggerResult.error;
  }

  await system.taskStore.save(nextTask);
  return {
    sessionId: triggerResult.sessionId ?? null,
    error: triggerResult.error,
  };
}

async function getBoardConcurrencyLimit(system: RoutaSystem, workspaceId: string, boardId: string): Promise<number> {
  const workspace = await system.workspaceStore.get(workspaceId);
  return getBoardSessionConcurrencyLimit(workspace?.metadata, boardId);
}

async function resolveDevSessionSupervision(
  system: RoutaSystem,
  workspaceId: string,
  boardId: string,
  _stage: KanbanColumnStage,
) {
  const workspace = await system.workspaceStore.get(workspaceId);
  return getKanbanDevSessionSupervision(workspace?.metadata, boardId);
}

async function sendPromptToKanbanSession(
  system: RoutaSystem,
  params: {
    workspaceId: string;
    sessionId: string;
    prompt: string;
  },
): Promise<void> {
  const sessionStore = getHttpSessionStore();
  const sessionRecord = sessionStore.getSession(params.sessionId);
  const targetAgentId = sessionRecord?.routaAgentId;

  if (targetAgentId) {
    const conversationResult = await system.tools.readAgentConversation({
      agentId: targetAgentId,
      lastN: 5,
    });

    if (conversationResult.success) {
      const messageCount = (conversationResult.data as { messages?: unknown[] } | undefined)?.messages?.length ?? 0;
      console.debug(
        `[WorkflowOrchestrator] Read ${messageCount} recent messages for agent ${targetAgentId} before recovery prompt.`,
      );
    } else {
      console.warn(
        `[WorkflowOrchestrator] Failed to read conversation for agent ${targetAgentId}: ${conversationResult.error}`,
      );
    }

    const toolResult = await system.tools.messageAgent({
      fromAgentId: targetAgentId,
      toAgentId: targetAgentId,
      message: params.prompt,
    });

    if (toolResult.success) {
      return;
    }

    console.warn(
      `[WorkflowOrchestrator] Failed to send recovery prompt via agent ${targetAgentId}: ${toolResult.error}. Falling back to session/prompt.`,
    );
  }

  const response = await fetch(`${getInternalApiOrigin()}/api/acp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: params.sessionId,
      method: "session/prompt",
      params: {
        sessionId: params.sessionId,
        workspaceId: params.workspaceId,
        prompt: [{ type: "text", text: params.prompt }],
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`session/prompt HTTP ${response.status}`);
  }
  await consumeAcpPromptResponse(response);
}

export function getKanbanSessionQueue(system: RoutaSystem): KanbanSessionQueue {
  const g = globalThis as Record<string, unknown>;
  let queue = g[QUEUE_KEY] as KanbanSessionQueue | undefined;

  if (queue && !queue.isCompatible(system.eventBus, system.taskStore)) {
    queue.stop();
    delete g[QUEUE_KEY];
    queue = undefined;
  }

  if (!queue) {
    queue = new KanbanSessionQueue(
      system.eventBus,
      system.taskStore,
      (workspaceId, boardId) => getBoardConcurrencyLimit(system, workspaceId, boardId),
    );
    g[QUEUE_KEY] = queue;
  }

  return queue;
}

/**
 * Get or create the global KanbanWorkflowOrchestrator instance.
 */
export function getWorkflowOrchestrator(system: RoutaSystem): KanbanWorkflowOrchestrator {
  const g = globalThis as Record<string, unknown>;
  let orchestrator = g[GLOBAL_KEY] as KanbanWorkflowOrchestrator | undefined;

  const isCompatible = orchestrator
    && typeof (orchestrator as KanbanWorkflowOrchestrator & { processColumnTransition?: unknown }).processColumnTransition === "function";

  if (orchestrator && !isCompatible) {
    orchestrator.stop();
    delete g[GLOBAL_KEY];
    delete g[STARTED_KEY];
    orchestrator = undefined;
  }

  if (!orchestrator) {
    orchestrator = new KanbanWorkflowOrchestrator(
      system.eventBus,
      system.kanbanBoardStore,
      system.taskStore,
    );
    g[GLOBAL_KEY] = orchestrator;
  }

  return orchestrator;
}

/**
 * Start the workflow orchestrator singleton. Idempotent across HMR restarts.
 */
export function startWorkflowOrchestrator(system: RoutaSystem): void {
  const g = globalThis as Record<string, unknown>;
  const orchestrator = getWorkflowOrchestrator(system);
  const queue = getKanbanSessionQueue(system);
  orchestrator.setCreateSession((params) => createAutomationSession(system, params));
  orchestrator.setCleanupCardSession((cardId) => queue.removeCardJob(cardId));
  orchestrator.setResolveDevSessionSupervision(({ workspaceId, boardId, stage }) =>
    resolveDevSessionSupervision(system, workspaceId, boardId, stage)
  );
  orchestrator.setSendKanbanSessionPrompt((params) => sendPromptToKanbanSession(system, {
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    prompt: params.prompt,
  }));
  orchestrator.start();
  queue.start();
  g[STARTED_KEY] = true;
}

export async function processKanbanColumnTransition(
  system: RoutaSystem,
  data: ColumnTransitionData,
): Promise<void> {
  startWorkflowOrchestrator(system);
  const orchestrator = getWorkflowOrchestrator(system);
  await orchestrator.processColumnTransition(data);
}

/**
 * Reset the orchestrator (for testing).
 */
export function resetWorkflowOrchestrator(): void {
  const g = globalThis as Record<string, unknown>;
  
  const orchestrator = g[GLOBAL_KEY] as KanbanWorkflowOrchestrator | undefined;
  if (orchestrator) {
    orchestrator.stop();
  }

  const queue = g[QUEUE_KEY] as KanbanSessionQueue | undefined;
  if (queue) {
    queue.stop();
  }
  
  delete g[GLOBAL_KEY];
  delete g[QUEUE_KEY];
  delete g[STARTED_KEY];
}
