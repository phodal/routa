// Shared types for workspace dashboard components

import type { McpServerProfile } from "@/core/mcp/mcp-server-profiles";
import type { InvestValidation } from "@/core/models/task";

export interface SessionInfo {
  sessionId: string;
  name?: string;
  cwd: string;
  branch?: string;
  workspaceId: string;
  routaAgentId?: string;
  provider?: string;
  role?: string;
  acpStatus?: "connecting" | "ready" | "error";
  acpError?: string;
  modeId?: string;
  model?: string;
  parentSessionId?: string;
  specialistId?: string;
  createdAt: string;
}

export interface TaskRunInfo {
  id: string;
  kind: "embedded_acp" | "runner_acp" | "a2a_task";
  status: "running" | "completed" | "failed" | "timed_out" | "transitioned" | "unknown";
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

export interface KanbanAgentPromptOptions {
  provider?: string;
  role?: string;
  toolMode?: "essential" | "full";
  allowedNativeTools?: string[];
  mcpProfile?: McpServerProfile;
  systemPrompt?: string;
}

export type KanbanAgentPromptHandler = (
  prompt: string,
  options?: KanbanAgentPromptOptions,
) => Promise<string | null>;

export type KanbanDevSessionSupervisionMode = "disabled" | "watchdog_retry" | "ralph_loop";
export type KanbanDevSessionCompletionRequirement =
  | "turn_complete"
  | "completion_summary"
  | "verification_report";
export type KanbanTransportInfo = "acp" | "a2a";

export interface KanbanDevSessionSupervisionInfo {
  mode: KanbanDevSessionSupervisionMode;
  inactivityTimeoutMinutes: number;
  maxRecoveryAttempts: number;
  completionRequirement: KanbanDevSessionCompletionRequirement;
}

export interface ArtifactInfo {
  id: string;
  type: "screenshot" | "test_results" | "code_diff" | "logs";
  taskId: string;
  providedByAgentId?: string;
  requestedByAgentId?: string;
  requestId?: string;
  content?: string;
  context?: string;
  status: "pending" | "provided" | "expired";
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  metadata?: Record<string, string>;
}

export interface ArtifactSummaryInfo {
  total: number;
  byType: Partial<Record<ArtifactInfo["type"], number>>;
  requiredSatisfied?: boolean;
  missingRequired?: ArtifactInfo["type"][];
}

export interface TaskEvidenceSummaryInfo {
  artifact: ArtifactSummaryInfo;
  verification: {
    hasVerdict: boolean;
    verdict?: string;
    hasReport: boolean;
  };
  completion: {
    hasSummary: boolean;
  };
  runs: {
    total: number;
    latestStatus: string;
  };
}

export interface TaskInfo {
  id: string;
  title: string;
  objective?: string;
  comment?: string;
  testCases?: string[];
  status: string;
  boardId?: string;
  columnId?: string;
  position?: number;
  priority?: string;
  labels?: string[];
  assignee?: string;
  assignedTo?: string;
  assignedProvider?: string;
  assignedRole?: string;
  assignedSpecialistId?: string;
  assignedSpecialistName?: string;
  triggerSessionId?: string;
  /** All session IDs that have been associated with this task (history) */
  sessionIds?: string[];
  laneSessions?: Array<{
    sessionId: string;
    routaAgentId?: string;
    columnId?: string;
    columnName?: string;
    stepId?: string;
    stepIndex?: number;
    stepName?: string;
    provider?: string;
    role?: string;
    specialistId?: string;
    specialistName?: string;
    transport?: KanbanTransportInfo;
    externalTaskId?: string;
    contextId?: string;
    attempt?: number;
    loopMode?: "watchdog_retry" | "ralph_loop";
    completionRequirement?: "turn_complete" | "completion_summary" | "verification_report";
    objective?: string;
    lastActivityAt?: string;
    recoveredFromSessionId?: string;
    recoveryReason?: "watchdog_inactivity" | "agent_failed" | "completion_criteria_not_met";
    status: "running" | "completed" | "failed" | "timed_out" | "transitioned";
    startedAt: string;
    completedAt?: string;
  }>;
  laneHandoffs?: Array<{
    id: string;
    fromSessionId: string;
    toSessionId: string;
    fromColumnId?: string;
    toColumnId?: string;
    requestType: "environment_preparation" | "runtime_context" | "clarification" | "rerun_command";
    request: string;
    status: "requested" | "delivered" | "completed" | "blocked" | "failed";
    requestedAt: string;
    respondedAt?: string;
    responseSummary?: string;
  }>;
  githubId?: string;
  githubNumber?: number;
  githubUrl?: string;
  githubRepo?: string;
  githubState?: string;
  githubSyncedAt?: string;
  lastSyncError?: string;
  sessionId?: string;
  /** Associated codebase IDs for this task */
  codebaseIds?: string[];
  /** Git worktree ID for this task */
  worktreeId?: string;
  artifactSummary?: ArtifactSummaryInfo;
  evidenceSummary?: TaskEvidenceSummaryInfo;
  investValidation?: InvestValidation;
  createdAt: string;
  updatedAt?: string;
}

export interface KanbanColumnAutomationInfo {
  enabled: boolean;
  steps?: Array<{
    id: string;
    transport?: KanbanTransportInfo;
    providerId?: string;
    role?: string;
    specialistId?: string;
    specialistName?: string;
    specialistLocale?: string;
    agentCardUrl?: string;
    skillId?: string;
    authConfigId?: string;
  }>;
  transport?: KanbanTransportInfo;
  providerId?: string;
  role?: string;
  specialistId?: string;
  specialistName?: string;
  specialistLocale?: string;
  agentCardUrl?: string;
  skillId?: string;
  authConfigId?: string;
  transitionType?: "entry" | "exit" | "both";
  requiredArtifacts?: ("screenshot" | "test_results" | "code_diff")[];
  autoAdvanceOnSuccess?: boolean;
}

export interface KanbanBoardQueueInfo {
  runningCount: number;
  runningCards: Array<{ cardId: string; cardTitle: string }>;
  queuedCount: number;
  queuedCardIds: string[];
  queuedCards: Array<{ cardId: string; cardTitle: string }>;
  queuedPositions: Record<string, number>;
}

export interface KanbanColumnInfo {
  id: string;
  name: string;
  color?: string;
  position: number;
  stage: string;
  visible?: boolean;
  width?: "compact" | "standard" | "wide";
  automation?: KanbanColumnAutomationInfo;
}

export interface KanbanBoardInfo {
  id: string;
  workspaceId: string;
  name: string;
  isDefault: boolean;
  sessionConcurrencyLimit?: number;
  devSessionSupervision?: KanbanDevSessionSupervisionInfo;
  queue?: KanbanBoardQueueInfo;
  columns: KanbanColumnInfo[];
  createdAt: string;
  updatedAt: string;
}

export interface BackgroundTaskInfo {
  id: string;
  title: string;
  prompt: string;
  agentId: string;
  status: string;
  triggeredBy?: string;
  triggerSource?: string;
  priority?: string;
  resultSessionId?: string;
  errorMessage?: string;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  lastActivity?: string;
  currentActivity?: string;
  toolCallCount?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface TraceInfo {
  id: string;
  agentName?: string;
  agentRole?: string;
  action?: string;
  summary?: string;
  durationMs?: number;
  createdAt: string;
}

export interface WorktreeInfo {
  id: string;
  codebaseId: string;
  workspaceId: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
  status: "creating" | "active" | "error" | "removing";
  sessionId?: string;
  label?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}
