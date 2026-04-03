import { v4 as uuidv4 } from "uuid";
import type { Task, TaskEvidenceSummary, TaskInvestValidation, TaskStoryReadiness } from "../models/task";
import { getNextHappyPathColumnId, type KanbanColumn } from "../models/kanban";
import { AgentEventType, type EventBus } from "../events/event-bus";
import { isClaudeCodeSdkConfigured } from "../acp/claude-code-sdk-adapter";
import { consumeAcpPromptResponse } from "../acp/prompt-response";
import { getA2AOutboundClient } from "../a2a";
import { resolveA2AAuthConfig } from "../a2a/a2a-auth-config";
import { formatArtifactSummary, resolveKanbanTransitionArtifacts } from "./transition-artifacts";
import type { TaskLaneSession } from "../models/task";
import { resolveCurrentLaneAutomationState } from "./lane-automation-state";
import { getLatestLaneSessionForColumn, getPreviousLaneRun } from "./task-lane-history";
import type { KanbanAutomationStep, KanbanTransport } from "../models/kanban";

export interface TaskPromptSummaryContext {
  evidenceSummary?: TaskEvidenceSummary;
  storyReadiness?: TaskStoryReadiness;
  investValidation?: TaskInvestValidation;
}

function formatHandoffRequestType(
  value: "environment_preparation" | "runtime_context" | "clarification" | "rerun_command",
): string {
  switch (value) {
    case "environment_preparation":
      return "Environment preparation";
    case "runtime_context":
      return "Runtime context";
    case "clarification":
      return "Clarification";
    case "rerun_command":
      return "Rerun command";
    default:
      return value;
  }
}

function formatLaneSessionDescriptor(session: TaskLaneSession): string {
  const stepLabel = typeof session.stepIndex === "number"
    ? `Step ${session.stepIndex + 1}`
    : undefined;
  return [
    session.columnName ?? session.columnId ?? "unknown lane",
    session.stepName ?? stepLabel,
    session.provider ?? "unknown provider",
    session.role ?? "unknown role",
  ].filter(Boolean).join(" · ");
}

export function getInternalApiOrigin(): string {
  const configuredOrigin = process.env.ROUTA_INTERNAL_API_ORIGIN
    ?? process.env.ROUTA_BASE_URL
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

  if (configuredOrigin) {
    return configuredOrigin.replace(/\/$/, "");
  }

  const port = process.env.PORT ?? "3000";
  return `http://127.0.0.1:${port}`;
}

export function buildTaskPrompt(
  task: Task,
  boardColumns: KanbanColumn[] = [],
  options?: { currentSessionId?: string; summaryContext?: TaskPromptSummaryContext },
): string {
  const labels = task.labels.length > 0 ? `Labels: ${task.labels.join(", ")}` : "Labels: none";
  const currentColumnId = task.columnId ?? "backlog";
  const isBacklogPlanning = currentColumnId === "backlog";
  const transitionArtifacts = resolveKanbanTransitionArtifacts(boardColumns, currentColumnId);
  const orderedColumns = boardColumns.slice().sort((left, right) => left.position - right.position);
  const currentColumnIndex = orderedColumns.findIndex((column) => column.id === currentColumnId);
  const previousColumn = currentColumnIndex > 0 ? orderedColumns[currentColumnIndex - 1] : undefined;
  const previousLaneSession = previousColumn
    ? [...(task.laneSessions ?? [])].reverse().find((entry) => entry.columnId === previousColumn.id)
    : undefined;
  const previousLaneRun = !isBacklogPlanning
    ? getPreviousLaneRun(task, options?.currentSessionId) ?? getLatestLaneSessionForColumn(task, currentColumnId)
    : undefined;
  const pendingLaneHandoffs = options?.currentSessionId
    ? (task.laneHandoffs ?? []).filter((handoff) => handoff.toSessionId === options.currentSessionId && !handoff.respondedAt)
    : [];
  const laneAutomationState = resolveCurrentLaneAutomationState(task, boardColumns, options);
  const canAdvanceToNextColumn = !isBacklogPlanning && !laneAutomationState.hasRemainingSteps;
  const summaryContext = options?.summaryContext;

  // Determine the next column for move_card guidance
  const fallbackNextColumnId = getNextHappyPathColumnId(currentColumnId);
  const nextColumnId = transitionArtifacts.nextColumn?.id ?? fallbackNextColumnId;
  const boardId = task.boardId;

  const availableTools = isBacklogPlanning
    ? [
        `- **update_card**: Update this card's title, description, priority, or labels. Use cardId: "${task.id}"`,
        "- **search_cards**: Search the board for duplicates or related work before creating more tasks",
        "- **create_card**: Create exactly one follow-up backlog card if the current card must be refined into a single user story",
        "- **decompose_tasks**: Create multiple backlog cards when the current card clearly contains multiple independent stories",
        "- **create_note**: Create notes for planning or refinement context",
        "- **list_artifacts**: Check whether the required artifacts already exist for this card",
        "- **provide_artifact**: Save test results, code diffs, or other evidence as structured Kanban artifacts",
        "- **capture_screenshot**: Capture and store a screenshot artifact when visual proof is required",
        "- **update_card is not an artifact tool**: Use it for card metadata only, never as a substitute for evidence upload",
        `- **move_card**: Move this card to the next column when your work is complete. Use cardId: "${task.id}", targetColumnId: "${nextColumnId ?? "todo"}"`,
      ]
    : [
        `- **update_card**: Update this card's title, description, priority, or labels. Use cardId: "${task.id}"`,
        "- **create_note**: Create notes for documentation or progress tracking",
        "- **list_artifacts**: Check whether the required artifacts already exist for this card",
        "- **provide_artifact**: Save test results, code diffs, or other evidence as structured Kanban artifacts",
        "- **capture_screenshot**: Capture and store a screenshot artifact when visual proof is required",
        "- **update_card is not an artifact tool**: Use it for card metadata only, never as a substitute for evidence upload",
        "- **request_previous_lane_handoff**: Ask the immediately previous lane to prepare environment, rerun a command, or clarify setup for this card",
        "- **submit_lane_handoff**: Finish a lane handoff request after you complete the requested support work",
        ...(canAdvanceToNextColumn
          ? [`- **move_card**: Move this card to the next column when your work is complete. Use cardId: "${task.id}", targetColumnId: "${nextColumnId ?? "done"}"`]
          : []),
      ];
  const moveInstruction = !canAdvanceToNextColumn
    ? `Do not call \`move_card\` to leave ${currentColumnId} yet. Finish this step, then end your turn; the workflow will start ${laneAutomationState.nextStep?.specialistName ?? laneAutomationState.nextStep?.specialistId ?? laneAutomationState.nextStep?.role ?? "the next lane step"} automatically in the same column.`
    : nextColumnId
    ? `When your work for this column is complete, call \`move_card\` with cardId: "${task.id}" and targetColumnId: "${nextColumnId}" to advance the card. The next column's specialist will pick it up automatically.`
    : "This card is in the final column. Update the card with your completion summary.";

  const instructions = isBacklogPlanning
    ? [
        "1. Treat backlog as planning and refinement, not implementation",
        "2. Clarify or decompose the work into backlog-ready stories when needed",
        "3. Do not use native tools such as Bash, Read, Write, Edit, Glob, or Grep in backlog planning",
        "4. Do not use GitHub CLI commands such as gh issue create",
        "5. Do not start implementation work in this column",
        "6. Report what backlog story or stories were created or refined",
        `7. ${moveInstruction}`,
        "8. If the next transition is artifact-gated, create the required artifacts before calling `move_card`.",
      ]
    : [
        "1. Complete the work assigned to this column stage",
        canAdvanceToNextColumn
          ? "2. Start with direct task-scoped tools such as `list_artifacts`, `update_card`, `create_note`, and `move_card` before reaching for broader board queries."
          : "2. Start with direct task-scoped tools such as `list_artifacts`, `update_card`, and `create_note` before reaching for broader board queries.",
        "3. Keep changes focused on this task",
        `4. ${moveInstruction}`,
        canAdvanceToNextColumn
          ? "5. If the next transition requires artifacts, verify them with `list_artifacts` and create missing evidence with `provide_artifact` or `capture_screenshot` before moving the card."
          : "5. If the eventual next transition requires artifacts, collect or reference the needed evidence now, but do not move the card until this lane's remaining steps are finished.",
        currentColumnId === "review"
          ? "6. If verification depends on runtime setup from dev, use `request_previous_lane_handoff` instead of guessing the environment."
          : "6. If another lane requests support from this session, complete the requested runtime help and then call `submit_lane_handoff`.",
        boardId
          ? `7. Only call \`get_board\` if you truly need whole-board state, and if you do, pass boardId: "${boardId}". Do not call \`get_board\` with empty arguments.`
          : "7. Only call `get_board` if the task context already provides a concrete boardId. Do not call `get_board` with empty arguments or placeholder values.",
        "8. Do not call `report_to_parent`; this Kanban automation session is managed directly by the workflow",
      ];

  const artifactGateSection = [
    "## Artifact Gates",
    "",
    `**Current lane gate:** ${transitionArtifacts.currentColumn?.name ?? currentColumnId} requires ${formatArtifactSummary(transitionArtifacts.currentRequiredArtifacts)} to enter.`,
    transitionArtifacts.nextColumn
      ? `**Next transition gate:** Moving this card to ${transitionArtifacts.nextColumn.name ?? nextColumnId ?? "the next column"} requires ${formatArtifactSummary(transitionArtifacts.nextRequiredArtifacts)}.`
      : "**Next transition gate:** None. This card is already in the terminal stage.",
    !canAdvanceToNextColumn
      ? `This lane still has ${laneAutomationState.nextStep?.specialistName ?? laneAutomationState.nextStep?.specialistId ?? laneAutomationState.nextStep?.role ?? "another automation step"} pending, so do not call \`move_card\` yet.`
      : transitionArtifacts.nextRequiredArtifacts.length > 0
      ? `Before you call \`move_card\`, make sure ${formatArtifactSummary(transitionArtifacts.nextRequiredArtifacts)} exist as artifacts on task ${task.id}.`
      : "If no artifact gate is listed, you still should leave concise evidence in the card update.",
    "Use `list_artifacts` to confirm what already exists, then use `provide_artifact` or `capture_screenshot` to fill gaps.",
    "Do not treat `update_card` text as artifact evidence. Artifact gates are satisfied only by stored artifacts.",
    "",
  ];

  const laneRunHistorySection = !isBacklogPlanning && previousLaneRun
    ? [
        "## Current Lane History",
        "",
        `**Previous run in this lane:** ${formatLaneSessionDescriptor(previousLaneRun)}`,
        previousLaneRun.completedAt
          ? `Completed ${new Date(previousLaneRun.completedAt).toLocaleString()}. Review its output before repeating the same work.`
          : "A previous run already exists for this lane. Review its task updates and artifacts before continuing.",
        "",
      ]
    : [];

  const laneHandoffSection = !isBacklogPlanning && (previousLaneSession || pendingLaneHandoffs.length > 0)
    ? [
        "## Lane Handoff Context",
        "",
        previousLaneSession
          ? `**Previous lane session:** ${formatLaneSessionDescriptor(previousLaneSession)}`
          : "**Previous lane session:** none recorded",
        previousLaneSession
          ? "Use `request_previous_lane_handoff` if you need environment preparation, runtime context, or a focused rerun from the previous lane."
          : "No previous lane session is available for handoff.",
        ...(pendingLaneHandoffs.length > 0
          ? pendingLaneHandoffs.flatMap((handoff, index) => ([
              "",
              `Pending handoff ${index + 1}: ${formatHandoffRequestType(handoff.requestType)}`,
              handoff.request,
              `Respond with \`submit_lane_handoff\` using handoffId: "${handoff.id}".`,
            ]))
          : []),
        "",
      ]
    : [];

  const devVerificationSection = currentColumnId === "dev"
    ? [
        "## Dev Verification Safety",
        "",
        "Verify frontend changes against the current task worktree and the preview process started for this session.",
        "Do not assume `http://localhost:3000` is the right preview target unless this session started that exact server for the current worktree.",
        "Do not use broad process-kill commands such as `pkill -f \"next dev\"` or otherwise stop shared developer servers.",
        "If you start a temporary preview server, stop only the exact process started for this session, preferably via its recorded PID. Do not use `ps | grep | xargs kill`, `killall`, or broad `pkill` patterns for cleanup.",
        "If the UI depends on env vars or setup, start verification with those exact env vars, mention them in `update_card`, and attach evidence from that configured run.",
        "If safe runtime verification is blocked, use `request_previous_lane_handoff` for environment preparation or runtime context instead of looping on restarts.",
        "",
      ]
    : [];

  const storyReadinessSection = summaryContext?.storyReadiness
    ? [
        "## Story Readiness",
        "",
        `Ready for next move: ${summaryContext.storyReadiness.ready ? "yes" : "no"}`,
        summaryContext.storyReadiness.requiredTaskFields.length > 0
          ? `Required fields: ${summaryContext.storyReadiness.requiredTaskFields.join(", ")}`
          : "Required fields: none configured",
        summaryContext.storyReadiness.missing.length > 0
          ? `Missing fields: ${summaryContext.storyReadiness.missing.join(", ")}`
          : "Missing fields: none",
        `Checks: scope=${summaryContext.storyReadiness.checks.scope ? "present" : "missing"}, `
          + `acceptanceCriteria=${summaryContext.storyReadiness.checks.acceptanceCriteria ? "present" : "missing"}, `
          + `verificationCommands=${summaryContext.storyReadiness.checks.verificationCommands ? "present" : "missing"}, `
          + `testCases=${summaryContext.storyReadiness.checks.testCases ? "present" : "missing"}, `
          + `verificationPlan=${summaryContext.storyReadiness.checks.verificationPlan ? "present" : "missing"}, `
          + `dependenciesDeclared=${summaryContext.storyReadiness.checks.dependenciesDeclared ? "present" : "missing"}`,
        "",
      ]
    : [];

  const investSection = summaryContext?.investValidation
    ? [
        "## INVEST Snapshot",
        "",
        `Source: ${summaryContext.investValidation.source}`,
        `Overall: ${summaryContext.investValidation.overallStatus.toUpperCase()}`,
        `Independent: ${summaryContext.investValidation.checks.independent.status.toUpperCase()} — ${summaryContext.investValidation.checks.independent.reason}`,
        `Negotiable: ${summaryContext.investValidation.checks.negotiable.status.toUpperCase()} — ${summaryContext.investValidation.checks.negotiable.reason}`,
        `Valuable: ${summaryContext.investValidation.checks.valuable.status.toUpperCase()} — ${summaryContext.investValidation.checks.valuable.reason}`,
        `Estimable: ${summaryContext.investValidation.checks.estimable.status.toUpperCase()} — ${summaryContext.investValidation.checks.estimable.reason}`,
        `Small: ${summaryContext.investValidation.checks.small.status.toUpperCase()} — ${summaryContext.investValidation.checks.small.reason}`,
        `Testable: ${summaryContext.investValidation.checks.testable.status.toUpperCase()} — ${summaryContext.investValidation.checks.testable.reason}`,
        ...(summaryContext.investValidation.issues.length > 0
          ? [`Issues: ${summaryContext.investValidation.issues.join(" | ")}`]
          : []),
        "",
      ]
    : [];

  const evidenceBundleSection = summaryContext?.evidenceSummary
    ? [
        "## Evidence Bundle",
        "",
        `Artifacts total: ${summaryContext.evidenceSummary.artifact.total}`,
        `Artifacts by type: ${Object.entries(summaryContext.evidenceSummary.artifact.byType)
          .map(([type, count]) => `${type}=${count}`)
          .join(", ") || "none"}`,
        `Required artifacts satisfied: ${summaryContext.evidenceSummary.artifact.requiredSatisfied ? "yes" : "no"}`,
        `Missing required artifacts: ${summaryContext.evidenceSummary.artifact.missingRequired.join(", ") || "none"}`,
        `Verification verdict: ${summaryContext.evidenceSummary.verification.verdict ?? "none"}`,
        `Verification report present: ${summaryContext.evidenceSummary.verification.hasReport ? "yes" : "no"}`,
        `Completion summary present: ${summaryContext.evidenceSummary.completion.hasSummary ? "yes" : "no"}`,
        `Runs: total=${summaryContext.evidenceSummary.runs.total}, latestStatus=${summaryContext.evidenceSummary.runs.latestStatus}`,
        "",
      ]
    : [];

  return [
    `You are assigned to Kanban task: ${task.title}`,
    "",
    "## Context",
    "",
    "**IMPORTANT**: You are working in Kanban context. Use MCP tools (update_card, move_card, etc.) to manage this card.",
    "Do NOT create or sync GitHub issues during backlog planning.",
    "Do NOT use `gh issue create` or other GitHub CLI commands — those are for GitHub issue context only.",
    "",
    "## Task Details",
    "",
    `**Card ID:** ${task.id}`,
    boardId ? `**Board ID:** ${boardId}` : "**Board ID:** unavailable",
    `**Current Column ID:** ${currentColumnId}`,
    nextColumnId ? `**Next Column ID:** ${nextColumnId}` : "**Next Column ID:** none",
    `**Priority:** ${task.priority ?? "medium"}`,
    labels,
    task.githubUrl ? `**GitHub Issue:** ${task.githubUrl}` : "**GitHub Issue:** local-only",
    "",
    "## Objective",
    "",
    task.objective,
    "",
    ...storyReadinessSection,
    ...investSection,
    ...artifactGateSection,
    ...evidenceBundleSection,
    ...laneRunHistorySection,
    ...laneHandoffSection,
    ...devVerificationSection,
    "## Available MCP Tools",
    "",
    "You have access to the following MCP tools for task management:",
    "",
    ...availableTools,
    "",
    "## Instructions",
    "",
    ...instructions,
  ].join("\n");
}

export function resolveKanbanAutomationProvider(provider?: string): string {
  if (provider === "claude" && isClaudeCodeSdkConfigured()) {
    return "claude-code-sdk";
  }

  return provider ?? "opencode";
}

export interface AutomationRunHandle {
  transport: KanbanTransport;
  localSessionId?: string;
  externalTaskId?: string;
  contextId?: string;
  displayTarget?: string;
}

function emitAutomationEvent(params: {
  eventBus?: EventBus;
  type: AgentEventType;
  workspaceId: string;
  sessionId: string;
  transport: KanbanTransport;
  success: boolean;
  externalTaskId?: string;
  contextId?: string;
  error?: string;
}): void {
  if (!params.eventBus) {
    return;
  }

  params.eventBus.emit({
    type: params.type,
    agentId: params.sessionId,
    workspaceId: params.workspaceId,
    data: {
      sessionId: params.sessionId,
      success: params.success,
      transport: params.transport,
      externalTaskId: params.externalTaskId,
      contextId: params.contextId,
      error: params.error,
    },
    timestamp: new Date(),
  });
}

function getStepTransport(step?: KanbanAutomationStep): KanbanTransport {
  return step?.transport ?? "acp";
}

function getA2AFailureMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function triggerAcpTaskAgent(params: {
  origin: string;
  workspaceId: string;
  cwd: string;
  branch?: string;
  task: Task;
  specialistLocale?: string;
  boardColumns: KanbanColumn[];
  summaryContext?: TaskPromptSummaryContext;
  eventBus?: EventBus;
}): Promise<AutomationRunHandle | { error: string }> {
  const provider = resolveKanbanAutomationProvider(params.task.assignedProvider);
  const role = params.task.assignedRole ?? "CRAFTER";

  const newSessionResponse = await fetch(`${params.origin}/api/acp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: uuidv4(),
      method: "session/new",
      params: {
        cwd: params.cwd,
        branch: params.branch,
        provider,
        role,
        toolMode: "full",
        workspaceId: params.workspaceId,
        specialistId: params.task.assignedSpecialistId,
        specialistLocale: params.specialistLocale,
        name: `${params.task.title} · ${provider}`,
      },
    }),
  });

  const newSessionBody = await newSessionResponse.json() as { result?: { sessionId?: string }; error?: { message?: string } };
  const sessionId = newSessionBody.result?.sessionId;
  if (!newSessionResponse.ok || !sessionId) {
    return { error: newSessionBody.error?.message ?? "Failed to create ACP session." };
  }

  void (async () => {
    const response = await fetch(`${params.origin}/api/acp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: uuidv4(),
        method: "session/prompt",
        params: {
          sessionId,
          workspaceId: params.workspaceId,
          provider,
          cwd: params.cwd,
          prompt: [{
            type: "text",
            text: buildTaskPrompt(params.task, params.boardColumns, {
              currentSessionId: sessionId,
              summaryContext: params.summaryContext,
            }),
          }],
        },
      }),
    });

    await consumeAcpPromptResponse(response);
    emitAutomationEvent({
      eventBus: params.eventBus,
      type: AgentEventType.AGENT_COMPLETED,
      workspaceId: params.workspaceId,
      sessionId,
      transport: "acp",
      success: true,
    });
  })().catch((error) => {
    console.error("[kanban] Failed to auto-prompt ACP task session:", error);
    emitAutomationEvent({
      eventBus: params.eventBus,
      type: AgentEventType.AGENT_FAILED,
      workspaceId: params.workspaceId,
      sessionId,
      transport: "acp",
      success: false,
      error: getA2AFailureMessage(error),
    });
  });

  return {
    transport: "acp",
    localSessionId: sessionId,
    displayTarget: provider,
  };
}

async function triggerA2ATaskAgent(params: {
  workspaceId: string;
  task: Task;
  boardColumns: KanbanColumn[];
  step?: KanbanAutomationStep;
  summaryContext?: TaskPromptSummaryContext;
  eventBus?: EventBus;
}): Promise<AutomationRunHandle | { error: string }> {
  const agentCardUrl = params.step?.agentCardUrl?.trim();
  if (!agentCardUrl) {
    return { error: "A2A automation requires agentCardUrl." };
  }

  const localSessionId = `a2a-${uuidv4()}`;
  let authHeaders: Record<string, string> | undefined;
  try {
    authHeaders = resolveA2AAuthConfig(params.step?.authConfigId)?.headers;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  const client = getA2AOutboundClient(
    authHeaders ? { requestHeaders: authHeaders } : undefined,
  );
  const metadata: Record<string, unknown> = {
    workspaceId: params.workspaceId,
    cardId: params.task.id,
    boardId: params.task.boardId,
    columnId: params.task.columnId,
    specialistId: params.step?.specialistId ?? params.task.assignedSpecialistId,
    specialistName: params.step?.specialistName ?? params.task.assignedSpecialistName,
    role: params.step?.role ?? params.task.assignedRole,
    localSessionId,
  };

  if (params.step?.skillId) {
    metadata.skillId = params.step.skillId;
  }
  if (params.step?.authConfigId) {
    metadata.authConfigId = params.step.authConfigId;
  }

  const taskHandle = await client.sendMessage(
    agentCardUrl,
    buildTaskPrompt(params.task, params.boardColumns, {
      currentSessionId: localSessionId,
      summaryContext: params.summaryContext,
    }),
    metadata,
  );

  void (async () => {
    try {
      const completedTask = await client.waitForCompletion(agentCardUrl, taskHandle.id);
      const state = completedTask.status.state;
      const isSuccess = state === "completed";
      emitAutomationEvent({
        eventBus: params.eventBus,
        type: isSuccess ? AgentEventType.AGENT_COMPLETED : AgentEventType.AGENT_FAILED,
        workspaceId: params.workspaceId,
        sessionId: localSessionId,
        transport: "a2a",
        success: isSuccess,
        externalTaskId: completedTask.id,
        contextId: completedTask.contextId,
        error: isSuccess ? undefined : `A2A task ended in state: ${state}`,
      });
    } catch (error) {
      console.error("[kanban] Failed to monitor A2A task session:", error);
      emitAutomationEvent({
        eventBus: params.eventBus,
        type: AgentEventType.AGENT_FAILED,
        workspaceId: params.workspaceId,
        sessionId: localSessionId,
        transport: "a2a",
        success: false,
        externalTaskId: taskHandle.id,
        contextId: taskHandle.contextId,
        error: getA2AFailureMessage(error),
      });
    }
  })();

  return {
    transport: "a2a",
    localSessionId,
    externalTaskId: taskHandle.id,
    contextId: taskHandle.contextId,
    displayTarget: agentCardUrl,
  };
}

export async function triggerAssignedTaskAgent(params: {
  origin: string;
  workspaceId: string;
  cwd: string;
  branch?: string;
  task: Task;
  step?: KanbanAutomationStep;
  specialistLocale?: string;
  boardColumns?: KanbanColumn[];
  summaryContext?: TaskPromptSummaryContext;
  eventBus?: EventBus;
}): Promise<{ sessionId?: string; error?: string; transport?: KanbanTransport; externalTaskId?: string; contextId?: string; displayTarget?: string }> {
  const {
    origin,
    workspaceId,
    cwd,
    branch,
    task,
    step,
    specialistLocale,
    boardColumns = [],
    summaryContext,
    eventBus,
  } = params;
  const transport = getStepTransport(step);
  const runHandle = transport === "a2a"
    ? await triggerA2ATaskAgent({
        workspaceId,
        task,
        boardColumns,
        step,
        summaryContext,
        eventBus,
      })
    : await triggerAcpTaskAgent({
        origin,
        workspaceId,
        cwd,
        branch,
        task,
        specialistLocale,
        boardColumns,
        summaryContext,
        eventBus,
      });

  if ("error" in runHandle) {
    return { error: runHandle.error, transport };
  }

  return {
    sessionId: runHandle.localSessionId,
    transport: runHandle.transport,
    externalTaskId: runHandle.externalTaskId,
    contextId: runHandle.contextId,
    displayTarget: runHandle.displayTarget,
  };
}
