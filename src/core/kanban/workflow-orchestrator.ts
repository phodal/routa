/**
 * KanbanWorkflowOrchestrator — Coordinates column automation and task progress.
 *
 * Listens for COLUMN_TRANSITION events and triggers the configured Column Agent
 * for the target column. Tracks active automations, supervises dev-lane ACP
 * sessions, and supports bounded recovery for watchdog/loop policies.
 */

import { getHttpSessionStore } from "../acp/http-session-store";
import { EventBus, AgentEventType, AgentEvent } from "../events/event-bus";
import type {
  KanbanAutomationStep,
  KanbanColumnAutomation,
  KanbanColumnStage,
  KanbanDevSessionCompletionRequirement,
  KanbanDevSessionSupervision,
  KanbanDevSessionSupervisionMode,
} from "../models/kanban";
import { getKanbanAutomationSteps, resolveTaskStatusForBoardColumn } from "../models/kanban";
import type { Task, TaskLaneSessionRecoveryReason } from "../models/task";
import type { KanbanBoardStore } from "../store/kanban-board-store";
import type { TaskStore } from "../store/task-store";
import type { ColumnTransitionData } from "./column-transition";
import { resolveTransitionAutomation } from "./column-transition";
import { getDefaultKanbanDevSessionSupervision } from "./board-session-supervision";
import { markTaskLaneSessionStatus, upsertTaskLaneSession } from "./task-lane-history";
import { checkDependencyGate } from "./dependency-gate";
import { getKanbanBranchRules, type KanbanBranchRules } from "./board-branch-rules";

const WATCHDOG_SCAN_INTERVAL_MS = 30_000;
const COMPLETED_AUTOMATION_CLEANUP_DELAY_MS = 30_000;

interface RecoveryNotificationParams {
  workspaceId: string;
  sessionId: string;
  cardId: string;
  cardTitle: string;
  boardId: string;
  columnId: string;
  reason: string;
  mode: KanbanDevSessionSupervisionMode;
}

export type SendKanbanSessionPrompt = (params: {
  workspaceId: string;
  sessionId: string;
  prompt: string;
}) => Promise<void>;

function getDisabledSupervisionConfig(): KanbanDevSessionSupervision {
  return {
    ...getDefaultKanbanDevSessionSupervision(),
    mode: "disabled",
  };
}

function shouldSuperviseStage(stage: KanbanColumnStage): boolean {
  return stage === "dev";
}

function isRecoveryMode(mode: KanbanDevSessionSupervisionMode): mode is "watchdog_retry" | "ralph_loop" {
  return mode === "watchdog_retry" || mode === "ralph_loop";
}

function getRecoveryReason(event: AgentEvent, completionSatisfied: boolean): TaskLaneSessionRecoveryReason {
  if (event.type === AgentEventType.AGENT_TIMEOUT) {
    return "watchdog_inactivity";
  }
  if (event.type === AgentEventType.AGENT_FAILED) {
    return "agent_failed";
  }
  if (event.type === AgentEventType.AGENT_COMPLETED && !completionSatisfied) {
    return "completion_criteria_not_met";
  }
  return "agent_failed";
}

function buildKanbanRecoveryPrompt(params: RecoveryNotificationParams): string {
  const mode = params.mode === "watchdog_retry" ? "watchdog_retry" : "ralph_loop";
  return [
    `hi，这里有一个 Agent（acp session id = ${params.sessionId}）很久没动了，你看看怎么回事，要不要继续？`,
    `Card: ${params.cardTitle} (${params.cardId})`,
    `Board: ${params.boardId}`,
    `Column: ${params.columnId}`,
    `Mode: ${mode}`,
    `Reason: ${params.reason}`,
    "如果 session 还在，请直接处理并继续任务；否则尽快确认下一步重建策略。",
  ].join("\\n");
}

function getAutomationStepLabel(step: KanbanAutomationStep | undefined, stepIndex: number): string {
  if (!step) {
    return `Step ${stepIndex + 1}`;
  }
  return step.specialistName ?? step.specialistId ?? step.role ?? `Step ${stepIndex + 1}`;
}

const NON_DEV_AUTOMATION_REPEAT_LIMIT = 3;

export function getNonDevAutomationRunCount(
  task: Pick<Task, "laneSessions"> | undefined,
  columnId: string,
  stage: KanbanColumnStage,
): number {
  if (!task || stage === "dev") {
    return 0;
  }

  const laneSessions = task.laneSessions ?? [];
  let runCount = 0;

  for (let index = laneSessions.length - 1; index >= 0; index -= 1) {
    const entry = laneSessions[index];
    if (entry.columnId !== columnId) {
      break;
    }
    runCount += 1;
  }

  return runCount;
}

export function hasExceededNonDevAutomationRepeatLimit(
  task: Pick<Task, "laneSessions"> | undefined,
  columnId: string,
  stage: KanbanColumnStage,
): boolean {
  return getNonDevAutomationRunCount(task, columnId, stage) >= NON_DEV_AUTOMATION_REPEAT_LIMIT;
}

function buildNonDevAutomationRepeatLimitMessage(columnName: string, runCount: number): string {
  return `Stopped Kanban automation for "${columnName}" after ${runCount + 1} runs. `
    + `Non-dev lanes are limited to ${NON_DEV_AUTOMATION_REPEAT_LIMIT} automation runs to prevent loops.`;
}

/** Context persisted for a session attempt when supervision is enabled. */
export interface AutomationSessionSupervisionContext {
  attempt: number;
  mode: "watchdog_retry" | "ralph_loop";
  completionRequirement: KanbanDevSessionCompletionRequirement;
  objective: string;
  recoveredFromSessionId?: string;
  recoveryReason?: TaskLaneSessionRecoveryReason;
}

/** Represents an active column automation in progress */
export interface ActiveAutomation {
  cardId: string;
  cardTitle: string;
  boardId: string;
  workspaceId: string;
  columnId: string;
  columnName: string;
  stage: KanbanColumnStage;
  automation: KanbanColumnAutomation;
  steps: KanbanAutomationStep[];
  currentStepIndex: number;
  sessionId?: string;
  startedAt: Date;
  status: "queued" | "running" | "completed" | "failed";
  supervision: KanbanDevSessionSupervision;
  attempt: number;
  recoveryAttempts: number;
  signaledSessionIds: Set<string>;
}

/** Callback to create an agent session for a column automation */
export type CreateAutomationSession = (params: {
  workspaceId: string;
  cardId: string;
  cardTitle: string;
  columnId: string;
  columnName: string;
  automation: KanbanColumnAutomation;
  step: KanbanAutomationStep;
  stepIndex: number;
  supervision?: AutomationSessionSupervisionContext;
}) => Promise<string | null>;

/** Callback to clean up a card's session queue entry before auto-advancing or recovering */
export type CleanupCardSession = (cardId: string) => void;

export type ResolveDevSessionSupervision = (params: {
  workspaceId: string;
  boardId: string;
  columnId: string;
  stage: KanbanColumnStage;
}) => Promise<KanbanDevSessionSupervision>;

export type ResolveBranchRules = (params: {
  workspaceId: string;
  boardId: string;
}) => Promise<KanbanBranchRules>;

export class KanbanWorkflowOrchestrator {
  private handlerKey = "kanban-workflow-orchestrator";
  private activeAutomations = new Map<string, ActiveAutomation>();
  private started = false;
  private cleanupCardSession?: CleanupCardSession;
  private resolveDevSessionSupervision?: ResolveDevSessionSupervision;
  private resolveBranchRules?: ResolveBranchRules;
  private sendKanbanSessionPrompt?: SendKanbanSessionPrompt;
  private watchdogTimer?: ReturnType<typeof setInterval>;

  constructor(
    private eventBus: EventBus,
    private kanbanBoardStore: KanbanBoardStore,
    private taskStore: TaskStore,
    private createSession?: CreateAutomationSession,
  ) {}

  /** Start listening for column transition events */
  start(): void {
    if (this.started) {
      return;
    }
    this.eventBus.on(this.handlerKey, (event: AgentEvent) => {
      if (event.type === AgentEventType.COLUMN_TRANSITION) {
        void this.handleColumnTransition(event);
      }
      if (
        event.type === AgentEventType.AGENT_COMPLETED
        || event.type === AgentEventType.REPORT_SUBMITTED
        || event.type === AgentEventType.AGENT_FAILED
        || event.type === AgentEventType.AGENT_TIMEOUT
      ) {
        void this.handleAgentCompletion(event);
      }
    });
    this.watchdogTimer = setInterval(() => {
      void this.scanForInactiveSessions();
    }, WATCHDOG_SCAN_INTERVAL_MS);
    (this.watchdogTimer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
    this.started = true;
  }

  /** Stop listening */
  stop(): void {
    if (!this.started) {
      return;
    }
    this.eventBus.off(this.handlerKey);
    this.activeAutomations.clear();
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = undefined;
    }
    this.started = false;
  }

  /** Set the session creation callback */
  setCreateSession(fn: CreateAutomationSession): void {
    this.createSession = fn;
  }

  /** Set the cleanup callback for session queue entries */
  setCleanupCardSession(fn: CleanupCardSession): void {
    this.cleanupCardSession = fn;
  }

  /** Set the resolver for board-level dev session supervision config */
  setResolveDevSessionSupervision(fn: ResolveDevSessionSupervision): void {
    this.resolveDevSessionSupervision = fn;
  }

  /** Set the resolver for board-level branch rules */
  setResolveBranchRules(fn: ResolveBranchRules): void {
    this.resolveBranchRules = fn;
  }

  /** Set the callback used to send a prompt message into a live ACP session */
  setSendKanbanSessionPrompt(fn: SendKanbanSessionPrompt): void {
    this.sendKanbanSessionPrompt = fn;
  }

  /** Get all active automations */
  getActiveAutomations(): ActiveAutomation[] {
    return Array.from(this.activeAutomations.values());
  }

  /** Get active automation for a specific card */
  getAutomationForCard(cardId: string): ActiveAutomation | undefined {
    return this.activeAutomations.get(cardId);
  }

  async processColumnTransition(data: ColumnTransitionData): Promise<void> {
    await this.handleColumnTransitionData(data);
  }

  private async handleColumnTransition(event: AgentEvent): Promise<void> {
    await this.handleColumnTransitionData(event.data as unknown as ColumnTransitionData);
  }

  private async handleColumnTransitionData(data: ColumnTransitionData): Promise<void> {
    const board = await this.kanbanBoardStore.get(data.boardId);
    if (!board) return;
    const resolved = resolveTransitionAutomation(board, data);
    if (!resolved) return;
    const task = await this.taskStore.get(data.cardId);
    const laneObjective = task?.objective?.trim() || data.cardTitle;
    const targetColumn = resolved.column;
    const automation = resolved.automation;
    const steps = getKanbanAutomationSteps(automation);
    if (steps.length === 0) return;

    if (hasExceededNonDevAutomationRepeatLimit(task, targetColumn.id, targetColumn.stage)) {
      if (task) {
        task.lastSyncError = buildNonDevAutomationRepeatLimitMessage(
          targetColumn.name,
          getNonDevAutomationRunCount(task, targetColumn.id, targetColumn.stage),
        );
        task.updatedAt = new Date();
        await this.taskStore.save(task);
      }
      console.warn(
        `[WorkflowOrchestrator] Stopped repeated non-dev automation for card ${data.cardId} in column ${targetColumn.id}.`,
      );
      return;
    }

    // Dependency gate: block automation if any dependency is unfinished
    if (task && task.dependencies.length > 0) {
      const depCheck = await checkDependencyGate(task, board.columns, this.taskStore);
      if (depCheck.blocked) {
        task.lastSyncError = `Blocked by unfinished dependencies: ${depCheck.pendingDependencies.join(", ")}`;
        task.updatedAt = new Date();
        await this.taskStore.save(task);
        console.warn(
          `[WorkflowOrchestrator] Card ${data.cardId} blocked by dependencies: ${depCheck.pendingDependencies.join(", ")}`,
        );
        return;
      }
    }

    const supervision = shouldSuperviseStage(targetColumn.stage)
      ? (await this.resolveDevSessionSupervision?.({
        workspaceId: data.workspaceId,
        boardId: data.boardId,
        columnId: targetColumn.id,
        stage: targetColumn.stage,
      })) ?? getDefaultKanbanDevSessionSupervision()
      : getDisabledSupervisionConfig();

    const existingAutomation = this.activeAutomations.get(data.cardId);
    if (
      existingAutomation
      && existingAutomation.boardId === data.boardId
      && existingAutomation.columnId === targetColumn.id
      && (existingAutomation.status === "queued" || existingAutomation.status === "running")
    ) {
      return;
    }

    const automationEntry: ActiveAutomation = {
      cardId: data.cardId,
      cardTitle: data.cardTitle,
      boardId: data.boardId,
      workspaceId: data.workspaceId,
      columnId: targetColumn.id,
      columnName: targetColumn.name,
      stage: targetColumn.stage,
      automation,
      steps,
      currentStepIndex: 0,
      startedAt: new Date(),
      status: "queued",
      supervision,
      attempt: 1,
      recoveryAttempts: 0,
      signaledSessionIds: new Set(),
    };

    this.activeAutomations.set(data.cardId, automationEntry);

    // Trigger agent session if callback is available
    if (this.createSession) {
      try {
        const sessionId = await this.createSession({
          workspaceId: data.workspaceId,
          cardId: data.cardId,
          cardTitle: data.cardTitle,
          columnId: targetColumn.id,
          columnName: targetColumn.name,
          automation,
          step: steps[0],
          stepIndex: 0,
          supervision: this.buildSupervisionContext(automationEntry, laneObjective),
        });
        if (sessionId) {
          automationEntry.status = "running";
          automationEntry.sessionId = sessionId;
        }
      } catch (err) {
        automationEntry.status = "failed";
        console.error("[WorkflowOrchestrator] Failed to create session:", err);
      }
    }
  }

  private async handleAgentCompletion(event: AgentEvent): Promise<void> {
    for (const [cardId, automation] of this.activeAutomations.entries()) {
      if (automation.status === "completed" || automation.status === "failed") continue;

      const eventSessionId = typeof event.data?.sessionId === "string" ? event.data.sessionId : undefined;
      if (!eventSessionId) continue;

      const task = await this.taskStore.get(cardId);
      const sessionId = automation.sessionId ?? task?.triggerSessionId;
      if (!automation.sessionId && sessionId) {
        automation.sessionId = sessionId;
        automation.status = "running";
      }

      // Match only by the automation's own sessionId or the card's current triggerSessionId.
      const isRelated = Boolean(sessionId && eventSessionId === sessionId);
      if (!isRelated) continue;

      const sessionStore = getHttpSessionStore();
      const sessionActivity = sessionStore.getSessionActivity(eventSessionId);
      if (task) {
        upsertTaskLaneSession(task, {
          sessionId: eventSessionId,
          lastActivityAt: sessionActivity?.lastMeaningfulActivityAt ?? sessionActivity?.lastActivityAt,
        });
      }

      const successEvent =
        event.type !== AgentEventType.AGENT_FAILED
        && event.type !== AgentEventType.AGENT_TIMEOUT
        && event.data?.success !== false;
      const completionSatisfied = await this.isCompletionSatisfied(task, automation, successEvent);
      const shouldRecover = task
        ? await this.shouldRecover(task, automation, event, completionSatisfied)
        : false;

      if (task) {
        const nextStatus = event.type === AgentEventType.AGENT_TIMEOUT
          ? "timed_out"
          : successEvent && completionSatisfied
            ? "completed"
            : "failed";
        markTaskLaneSessionStatus(task, eventSessionId, nextStatus);
        if (!successEvent || !completionSatisfied) {
          upsertTaskLaneSession(task, {
            sessionId: eventSessionId,
            recoveryReason: getRecoveryReason(event, completionSatisfied),
          });
        }
      }

      const nextStepIndex = automation.currentStepIndex + 1;
      const hasNextStep = successEvent
        && completionSatisfied
        && nextStepIndex < automation.steps.length;
      let failedToAdvanceWithinLane = false;

      if (task && hasNextStep) {
        const startedNextStep = await this.startNextAutomationStep(cardId, automation, task, nextStepIndex);
        if (startedNextStep) {
          automation.signaledSessionIds.add(eventSessionId);
          return;
        }
        failedToAdvanceWithinLane = true;
      }

      if (task && shouldRecover) {
        const recoveryReason = getRecoveryReason(event, completionSatisfied);
        await this.notifyKanbanAgent({
          workspaceId: automation.workspaceId,
          sessionId: eventSessionId,
          cardId: automation.cardId,
          cardTitle: automation.cardTitle,
          boardId: automation.boardId,
          columnId: automation.columnId,
          reason: `Recovery reason: ${recoveryReason}.`,
          mode: automation.supervision.mode,
        });
        const recovered = await this.recoverAutomation(cardId, automation, task, recoveryReason);
        if (recovered) {
          return;
        }
      }

      automation.status = !failedToAdvanceWithinLane && successEvent && completionSatisfied ? "completed" : "failed";
      automation.signaledSessionIds.add(eventSessionId);

      // Unblock dependent tasks when this task successfully completes
      if (automation.status === "completed") {
        await this.unblockDependentTasks(cardId, automation);
      }

      // Schedule worktree cleanup for completed done-lane tasks
      if (automation.status === "completed" && automation.stage === "done") {
        this.scheduleWorktreeCleanup(cardId, automation);
      }

      // Auto-create PR if configured and task has no PR yet
      if (automation.status === "completed" && automation.stage === "done" && task && !task.pullRequestUrl) {
        const branchRules = this.resolveBranchRules
          ? await this.resolveBranchRules({ workspaceId: automation.workspaceId, boardId: automation.boardId })
          : undefined;
        if (branchRules?.lifecycle.autoCreatePullRequest) {
          this.triggerAutoPrCreation(cardId, automation, task);
        }
      }

      if (task) {
        if (!failedToAdvanceWithinLane && successEvent && completionSatisfied) {
          task.lastSyncError = undefined;
        } else if (!task.lastSyncError) {
          task.lastSyncError = this.buildFailureMessage(automation, event, completionSatisfied);
        }
        await this.taskStore.save(task);
      }

      // Auto-advance if configured and successful.
      if (!failedToAdvanceWithinLane && successEvent && completionSatisfied && automation.automation.autoAdvanceOnSuccess) {
        await this.autoAdvanceCard(cardId, automation);
      }

      const completedAutomation = automation;
      setTimeout(() => {
        if (this.activeAutomations.get(cardId) === completedAutomation) {
          this.activeAutomations.delete(cardId);
        }
      }, COMPLETED_AUTOMATION_CLEANUP_DELAY_MS);
      return;
    }
  }

  private async scanForInactiveSessions(): Promise<void> {
    const sessionStore = getHttpSessionStore();
    const now = Date.now();

    for (const automation of this.activeAutomations.values()) {
      if (automation.status !== "running" || !automation.sessionId) continue;
      if (!isRecoveryMode(automation.supervision.mode)) continue;

      const sessionId = automation.sessionId;
      if (automation.signaledSessionIds.has(sessionId)) continue;

      const sessionRecord = sessionStore.getSession(sessionId);
      if (sessionRecord?.acpStatus === "error") {
        automation.signaledSessionIds.add(sessionId);
        void this.notifyKanbanAgent({
          workspaceId: automation.workspaceId,
          sessionId,
          cardId: automation.cardId,
          cardTitle: automation.cardTitle,
          boardId: automation.boardId,
          columnId: automation.columnId,
          reason: sessionRecord.acpError ?? "ACP session entered error state.",
          mode: automation.supervision.mode,
        });
        this.eventBus.emit({
          type: AgentEventType.AGENT_FAILED,
          agentId: sessionId,
          workspaceId: automation.workspaceId,
          data: {
            sessionId,
            success: false,
            error: sessionRecord.acpError ?? "ACP session entered error state.",
            watchdog: true,
          },
          timestamp: new Date(),
        });
        continue;
      }

      const activity = sessionStore.getSessionActivity(sessionId);
      const lastActivityAt = activity?.lastMeaningfulActivityAt
        ?? activity?.lastActivityAt
        ?? sessionRecord?.createdAt
        ?? automation.startedAt.toISOString();
      const lastActivityMs = Date.parse(lastActivityAt);
      if (!Number.isFinite(lastActivityMs)) continue;

      const idleMs = now - lastActivityMs;
      const thresholdMs = automation.supervision.inactivityTimeoutMinutes * 60_000;
      if (idleMs < thresholdMs) continue;

      sessionStore.markSessionTimedOut(
        sessionId,
        `No ACP activity for ${automation.supervision.inactivityTimeoutMinutes} minutes.`,
      );
      automation.signaledSessionIds.add(sessionId);
      void this.notifyKanbanAgent({
        workspaceId: automation.workspaceId,
        sessionId,
        cardId: automation.cardId,
        cardTitle: automation.cardTitle,
        boardId: automation.boardId,
        columnId: automation.columnId,
        reason: `No ACP activity for ${automation.supervision.inactivityTimeoutMinutes} minutes.`,
        mode: automation.supervision.mode,
      });
      this.eventBus.emit({
        type: AgentEventType.AGENT_TIMEOUT,
        agentId: sessionId,
        workspaceId: automation.workspaceId,
        data: {
          sessionId,
          success: false,
          error: `No ACP activity for ${automation.supervision.inactivityTimeoutMinutes} minutes.`,
          inactivityMs: idleMs,
          lastActivityAt,
          watchdog: true,
        },
        timestamp: new Date(),
      });
    }
  }

  /**
   * When a task completes, scan for dependent tasks that may now be unblocked
   * and re-trigger their automation.
   */
  private async unblockDependentTasks(
    completedCardId: string,
    automation: ActiveAutomation,
  ): Promise<void> {
    const board = await this.kanbanBoardStore.get(automation.boardId);
    if (!board) return;

    const allTasks = await this.taskStore.listByWorkspace(automation.workspaceId);
    const newlyUnblocked: string[] = [];

    for (const t of allTasks) {
      if (!t.dependencies.includes(completedCardId)) continue;

      const depCheck = await checkDependencyGate(t, board.columns, this.taskStore);
      if (!depCheck.blocked && t.lastSyncError?.startsWith("Blocked by unfinished dependencies")) {
        t.lastSyncError = undefined;
        t.updatedAt = new Date();
        await this.taskStore.save(t);
        newlyUnblocked.push(t.id);

        this.eventBus.emit({
          type: AgentEventType.COLUMN_TRANSITION,
          agentId: "kanban-workflow-orchestrator",
          workspaceId: automation.workspaceId,
          data: {
            cardId: t.id,
            cardTitle: t.title,
            boardId: automation.boardId,
            workspaceId: automation.workspaceId,
            fromColumnId: t.columnId ?? "",
            toColumnId: t.columnId ?? "",
            fromColumnName: "",
            toColumnName: "",
          },
          timestamp: new Date(),
        });
      }
    }

    if (newlyUnblocked.length > 0) {
      console.log(
        `[WorkflowOrchestrator] Unblocked ${newlyUnblocked.length} dependent task(s) after ${completedCardId} completed.`,
      );
    }
  }

  private async isCompletionSatisfied(
    task: Task | undefined,
    automation: ActiveAutomation,
    successEvent: boolean,
  ): Promise<boolean> {
    if (!successEvent) {
      return false;
    }
    if (automation.supervision.mode !== "ralph_loop") {
      return true;
    }

    switch (automation.supervision.completionRequirement) {
      case "completion_summary":
        return Boolean(task?.completionSummary?.trim());
      case "verification_report":
        return Boolean(task?.verificationReport?.trim());
      case "turn_complete":
      default:
        return true;
    }
  }

  private async shouldRecover(
    task: Task,
    automation: ActiveAutomation,
    event: AgentEvent,
    completionSatisfied: boolean,
  ): Promise<boolean> {
    if (!isRecoveryMode(automation.supervision.mode)) {
      return false;
    }
    if (task.columnId !== automation.columnId) {
      return false;
    }
    if (automation.recoveryAttempts >= automation.supervision.maxRecoveryAttempts) {
      return false;
    }

    if (event.type === AgentEventType.AGENT_TIMEOUT || event.type === AgentEventType.AGENT_FAILED) {
      return true;
    }
    if (automation.supervision.mode === "ralph_loop" && event.type === AgentEventType.AGENT_COMPLETED) {
      return !completionSatisfied;
    }
    return false;
  }

  private async startNextAutomationStep(
    cardId: string,
    automation: ActiveAutomation,
    task: Task,
    nextStepIndex: number,
  ): Promise<boolean> {
    if (!this.createSession) {
      return false;
    }

    const nextStep = automation.steps[nextStepIndex];
    if (!nextStep) {
      return false;
    }

    const previousSessionId = automation.sessionId;
    if (previousSessionId) {
      if (!task.sessionIds.includes(previousSessionId)) {
        task.sessionIds.push(previousSessionId);
      }
      if (task.triggerSessionId === previousSessionId) {
        task.triggerSessionId = undefined;
      }
    }

    task.lastSyncError = undefined;
    task.updatedAt = new Date();
    await this.taskStore.save(task);

    this.cleanupCardSession?.(cardId);

    automation.currentStepIndex = nextStepIndex;
    automation.attempt = 1;
    automation.recoveryAttempts = 0;
    automation.status = "queued";
    automation.startedAt = new Date();
    automation.sessionId = undefined;
    automation.signaledSessionIds.clear();

    try {
      const sessionId = await this.createSession({
        workspaceId: automation.workspaceId,
        cardId,
        cardTitle: automation.cardTitle,
        columnId: automation.columnId,
        columnName: automation.columnName,
        automation: automation.automation,
        step: nextStep,
        stepIndex: nextStepIndex,
        supervision: this.buildSupervisionContext(automation, task.objective || automation.cardTitle),
      });

      if (!sessionId) {
        automation.status = "failed";
        return false;
      }

      automation.status = "running";
      automation.sessionId = sessionId;
      return true;
    } catch (error) {
      automation.status = "failed";
      task.lastSyncError = error instanceof Error ? error.message : String(error);
      task.updatedAt = new Date();
      await this.taskStore.save(task);
      return false;
    }
  }

  private async recoverAutomation(
    cardId: string,
    automation: ActiveAutomation,
    task: Task,
    reason: TaskLaneSessionRecoveryReason,
  ): Promise<boolean> {
    if (!this.createSession || !isRecoveryMode(automation.supervision.mode)) {
      return false;
    }

    const previousSessionId = automation.sessionId;
    automation.recoveryAttempts += 1;
    automation.attempt += 1;
    automation.status = "queued";
    automation.startedAt = new Date();
    automation.sessionId = undefined;

    if (previousSessionId) {
      automation.signaledSessionIds.delete(previousSessionId);
      if (!task.sessionIds.includes(previousSessionId)) {
        task.sessionIds.push(previousSessionId);
      }
      if (task.triggerSessionId === previousSessionId) {
        task.triggerSessionId = undefined;
      }
    }

    task.lastSyncError = this.buildRecoveryMessage(automation, reason);
    task.updatedAt = new Date();
    await this.taskStore.save(task);

    this.cleanupCardSession?.(cardId);

    try {
      const currentStep = automation.steps[automation.currentStepIndex];
      const sessionId = await this.createSession({
        workspaceId: automation.workspaceId,
        cardId,
        cardTitle: automation.cardTitle,
        columnId: automation.columnId,
        columnName: automation.columnName,
        automation: automation.automation,
        step: currentStep,
        stepIndex: automation.currentStepIndex,
        supervision: this.buildSupervisionContext(automation, task.objective || automation.cardTitle, {
          recoveredFromSessionId: previousSessionId,
          recoveryReason: reason,
        }),
      });

      if (!sessionId) {
        automation.status = "failed";
        return false;
      }

      automation.status = "running";
      automation.sessionId = sessionId;
      return true;
    } catch (error) {
      automation.status = "failed";
      task.lastSyncError = error instanceof Error ? error.message : String(error);
      task.updatedAt = new Date();
      await this.taskStore.save(task);
      return false;
    }
  }

  private buildSupervisionContext(
    automation: ActiveAutomation,
    objective: string,
    recovery?: {
      recoveredFromSessionId?: string;
      recoveryReason?: TaskLaneSessionRecoveryReason;
    },
  ): AutomationSessionSupervisionContext | undefined {
    if (!isRecoveryMode(automation.supervision.mode)) {
      return undefined;
    }
    return {
      attempt: automation.attempt,
      mode: automation.supervision.mode,
      completionRequirement: automation.supervision.completionRequirement,
      objective,
      recoveredFromSessionId: recovery?.recoveredFromSessionId,
      recoveryReason: recovery?.recoveryReason,
    };
  }

  private buildRecoveryMessage(
    automation: ActiveAutomation,
    reason: TaskLaneSessionRecoveryReason,
  ): string {
    const stepLabel = getAutomationStepLabel(automation.steps[automation.currentStepIndex], automation.currentStepIndex);
    const reasonLabel = reason === "watchdog_inactivity"
      ? "inactive too long"
      : reason === "completion_criteria_not_met"
        ? "stopped before completion criteria were met"
        : "failed";
    return `${stepLabel} recovered after session ${reasonLabel}. Attempt ${automation.attempt}/${automation.supervision.maxRecoveryAttempts + 1}.`;
  }

  private buildFailureMessage(
    automation: ActiveAutomation,
    event: AgentEvent,
    completionSatisfied: boolean,
  ): string {
    const stepLabel = getAutomationStepLabel(automation.steps[automation.currentStepIndex], automation.currentStepIndex);
    if (event.type === AgentEventType.AGENT_TIMEOUT) {
      return `${stepLabel} timed out after ${automation.supervision.inactivityTimeoutMinutes} minutes without activity.`;
    }
    if (event.type === AgentEventType.AGENT_FAILED) {
      const error = typeof event.data?.error === "string" ? event.data.error : "ACP session failed.";
      return error;
    }
    if (event.type === AgentEventType.AGENT_COMPLETED && !completionSatisfied) {
      return `${stepLabel} completed but did not satisfy ${automation.supervision.completionRequirement}.`;
    }
    return "ACP session did not complete successfully.";
  }

  private async notifyKanbanAgent(params: RecoveryNotificationParams): Promise<void> {
    if (!this.sendKanbanSessionPrompt) {
      return;
    }
    const sessionStore = getHttpSessionStore();
    const sessionRecord = sessionStore.getSession(params.sessionId);
    if (!sessionRecord) {
      console.warn(
        `[WorkflowOrchestrator] ACP session ${params.sessionId} not found in local session store; skipping recovery prompt.`,
      );
      return;
    }
    if (sessionRecord.acpStatus === "error") {
      console.warn(
        `[WorkflowOrchestrator] ACP session ${params.sessionId} is already in error state; skipping recovery prompt.`,
      );
      return;
    }

    try {
      await this.sendKanbanSessionPrompt({
        workspaceId: params.workspaceId,
        sessionId: params.sessionId,
        prompt: buildKanbanRecoveryPrompt(params),
      });
    } catch (error) {
      console.error(
        `[WorkflowOrchestrator] Failed to notify agent session ${params.sessionId}:`,
        error,
      );
    }
  }

  private static readonly WORKTREE_CLEANUP_DELAY_MS = 60_000;

  /**
   * Schedule delayed worktree cleanup for a completed task.
   * Only cleans up if the PR has been merged (pullRequestMergedAt is set) and the
   * task is still in the done column.
   */
  private scheduleWorktreeCleanup(
    cardId: string,
    automation: ActiveAutomation,
  ): void {
    setTimeout(async () => {
      try {
        const task = await this.taskStore.get(cardId);
        if (!task?.worktreeId) return;

        if (!task.pullRequestMergedAt) {
          console.log(
            `[WorkflowOrchestrator] Skipping worktree cleanup for ${cardId}: PR not yet merged.`,
          );
          return;
        }

        const board = await this.kanbanBoardStore.get(automation.boardId);
        if (!board) return;
        const doneColumnIds = new Set(
          board.columns
            .filter((col) => col.stage === "done")
            .map((col) => col.id),
        );
        if (!doneColumnIds.has(task.columnId ?? "")) return;

        this.eventBus.emit({
          type: AgentEventType.WORKTREE_CLEANUP,
          agentId: "kanban-workflow-orchestrator",
          workspaceId: automation.workspaceId,
          data: {
            worktreeId: task.worktreeId,
            taskId: cardId,
            boardId: automation.boardId,
            deleteBranch: true,
          },
          timestamp: new Date(),
        });

        console.log(
          `[WorkflowOrchestrator] Scheduled worktree cleanup for task ${cardId}, worktree ${task.worktreeId}.`,
        );
      } catch (err) {
        console.error(
          `[WorkflowOrchestrator] Worktree cleanup scheduling failed for ${cardId}:`,
          err,
        );
      }
    }, KanbanWorkflowOrchestrator.WORKTREE_CLEANUP_DELAY_MS);
  }

  private async autoAdvanceCard(
    cardId: string,
    automation: ActiveAutomation,
  ): Promise<void> {
    try {
      const board = await this.kanbanBoardStore.get(automation.boardId);
      if (!board) return;

      // Check if the card was already moved by the specialist (via move_card tool).
      const task = await this.taskStore.get(cardId);
      if (!task) return;

      if (task.columnId !== automation.columnId) {
        return;
      }

      const currentColumn = board.columns.find((column) => column.id === automation.columnId);
      if (!currentColumn) return;

      const sortedColumns = board.columns
        .slice()
        .sort((left, right) => left.position - right.position);
      const currentIndex = sortedColumns.findIndex((column) => column.id === currentColumn.id);
      const nextColumn = sortedColumns[currentIndex + 1];
      if (!nextColumn) return;

      task.columnId = nextColumn.id;
      task.status = resolveTaskStatusForBoardColumn(board.columns, nextColumn.id);
      if (task.triggerSessionId) {
        if (!task.sessionIds) task.sessionIds = [];
        if (!task.sessionIds.includes(task.triggerSessionId)) {
          task.sessionIds.push(task.triggerSessionId);
        }
      }
      task.triggerSessionId = undefined;
      task.updatedAt = new Date();
      await this.taskStore.save(task);

      this.cleanupCardSession?.(cardId);

      this.eventBus.emit({
        type: AgentEventType.COLUMN_TRANSITION,
        agentId: "kanban-workflow-orchestrator",
        workspaceId: automation.workspaceId,
        data: {
          cardId,
          cardTitle: automation.cardTitle,
          boardId: automation.boardId,
          workspaceId: automation.workspaceId,
          fromColumnId: automation.columnId,
          toColumnId: nextColumn.id,
          fromColumnName: currentColumn.name,
          toColumnName: nextColumn.name,
        },
        timestamp: new Date(),
      });
    } catch (err) {
      console.error("[WorkflowOrchestrator] Auto-advance failed:", err);
    }
  }

  /**
   * Trigger automatic PR creation for a completed task.
   * Emits a PR_CREATE_REQUESTED event so downstream handlers can
   * create the PR using the task's worktree branch.
   */
  private triggerAutoPrCreation(
    cardId: string,
    automation: ActiveAutomation,
    task: Task,
  ): void {
    if (!task.worktreeId) {
      console.log(
        `[WorkflowOrchestrator] Skipping auto PR creation for ${cardId}: no worktree.`,
      );
      return;
    }

    console.log(
      `[WorkflowOrchestrator] Triggering auto PR creation for task ${cardId}.`,
    );
    this.eventBus.emit({
      type: AgentEventType.PR_CREATE_REQUESTED,
      agentId: "kanban-workflow-orchestrator",
      workspaceId: automation.workspaceId,
      data: {
        cardId,
        cardTitle: automation.cardTitle,
        boardId: automation.boardId,
        worktreeId: task.worktreeId,
      },
      timestamp: new Date(),
    });
  }
}
