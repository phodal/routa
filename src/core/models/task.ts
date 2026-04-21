/**
 * Task model - port of routa-core Task.kt
 *
 * Represents a unit of work within the multi-agent system.
 */

import type { ArtifactType } from "./artifact";
import type { KanbanRequiredTaskField } from "./task-requirements";
import type { TaskCreationSource } from "../kanban/task-creation-policy";

export enum TaskStatus {
  PENDING = "PENDING",
  IN_PROGRESS = "IN_PROGRESS",
  REVIEW_REQUIRED = "REVIEW_REQUIRED",
  COMPLETED = "COMPLETED",
  NEEDS_FIX = "NEEDS_FIX",
  BLOCKED = "BLOCKED",
  CANCELLED = "CANCELLED",
}

export enum TaskPriority {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  URGENT = "urgent",
}

export enum VerificationVerdict {
  APPROVED = "APPROVED",
  NOT_APPROVED = "NOT_APPROVED",
  BLOCKED = "BLOCKED",
}

export type TaskAnalysisStatus = "pass" | "warning" | "fail";

export interface TaskInvestCheckSummary {
  status: TaskAnalysisStatus;
  reason: string;
}

export interface TaskInvestValidation {
  source: "canonical_story" | "heuristic";
  overallStatus: TaskAnalysisStatus;
  checks: {
    independent: TaskInvestCheckSummary;
    negotiable: TaskInvestCheckSummary;
    valuable: TaskInvestCheckSummary;
    estimable: TaskInvestCheckSummary;
    small: TaskInvestCheckSummary;
    testable: TaskInvestCheckSummary;
  };
  issues: string[];
}

export interface TaskStoryReadiness {
  ready: boolean;
  missing: KanbanRequiredTaskField[];
  requiredTaskFields: KanbanRequiredTaskField[];
  checks: {
    scope: boolean;
    acceptanceCriteria: boolean;
    verificationCommands: boolean;
    testCases: boolean;
    verificationPlan: boolean;
    dependenciesDeclared: boolean;
  };
}

export interface TaskArtifactSummary {
  total: number;
  byType: Partial<Record<ArtifactType, number>>;
  requiredSatisfied: boolean;
  missingRequired: ArtifactType[];
}

export interface TaskEvidenceSummary {
  artifact: TaskArtifactSummary;
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

export type TaskLaneSessionStatus =
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "transitioned";

export type TaskLaneSessionLoopMode = "watchdog_retry" | "ralph_loop";
export type TaskLaneSessionCompletionRequirement =
  | "turn_complete"
  | "completion_summary"
  | "verification_report";
export type TaskLaneSessionRecoveryReason =
  | "watchdog_inactivity"
  | "agent_failed"
  | "completion_criteria_not_met";

export type TaskLaneHandoffRequestType =
  | "environment_preparation"
  | "runtime_context"
  | "clarification"
  | "rerun_command";

export type TaskLaneHandoffStatus =
  | "requested"
  | "delivered"
  | "completed"
  | "blocked"
  | "failed";

export interface TaskLaneSession {
  sessionId: string;
  routaAgentId?: string;
  worktreeId?: string;
  cwd?: string;
  columnId?: string;
  columnName?: string;
  stepId?: string;
  stepIndex?: number;
  stepName?: string;
  provider?: string;
  role?: string;
  specialistId?: string;
  specialistName?: string;
  /** Transport protocol used for this session */
  transport?: string;
  /** A2A-specific: External task ID from the agent system */
  externalTaskId?: string;
  /** A2A-specific: Context ID for tracking the conversation */
  contextId?: string;
  attempt?: number;
  loopMode?: TaskLaneSessionLoopMode;
  completionRequirement?: TaskLaneSessionCompletionRequirement;
  objective?: string;
  lastActivityAt?: string;
  recoveredFromSessionId?: string;
  recoveryReason?: TaskLaneSessionRecoveryReason;
  status: TaskLaneSessionStatus;
  startedAt: string;
  completedAt?: string;
}

export interface TaskLaneHandoff {
  id: string;
  fromSessionId: string;
  toSessionId: string;
  fromColumnId?: string;
  toColumnId?: string;
  worktreeId?: string;
  cwd?: string;
  requestType: TaskLaneHandoffRequestType;
  request: string;
  status: TaskLaneHandoffStatus;
  requestedAt: string;
  respondedAt?: string;
  responseSummary?: string;
}

export interface TaskCommentEntry {
  id: string;
  body: string;
  createdAt: string;
  source?: "legacy_import" | "update_card";
  agentId?: string;
  sessionId?: string;
}

export interface TaskDeliverySnapshotCommit {
  sha: string;
  shortSha: string;
  summary: string;
  authorName: string;
  authoredAt: string;
  additions: number;
  deletions: number;
}

export interface TaskDeliverySnapshot {
  capturedAt: string;
  repoPath: string;
  worktreeId?: string;
  worktreePath?: string;
  branch?: string;
  baseBranch?: string;
  baseRef: string;
  baseSha: string;
  headSha: string;
  commits: TaskDeliverySnapshotCommit[];
  source: "review_transition" | "done_transition" | "pr_run" | "manual";
}

export interface FallbackAgent {
  providerId?: string;
  role?: string;
  specialistId?: string;
  specialistName?: string;
}

export interface Task {
  id: string;
  title: string;
  objective: string;
  comment?: string;
  comments: TaskCommentEntry[];
  scope?: string;
  acceptanceCriteria?: string[];
  verificationCommands?: string[];
  testCases?: string[];
  assignedTo?: string;
  status: TaskStatus;
  boardId?: string;
  columnId?: string;
  position: number;
  priority?: TaskPriority;
  labels: string[];
  assignee?: string;
  assignedProvider?: string;
  assignedRole?: string;
  assignedSpecialistId?: string;
  assignedSpecialistName?: string;
  /** Ordered fallback agents to try when the primary agent fails */
  fallbackAgentChain?: FallbackAgent[];
  /** Whether to automatically try the next fallback agent on failure */
  enableAutomaticFallback?: boolean;
  /** Maximum number of fallback attempts before giving up */
  maxFallbackAttempts?: number;
  triggerSessionId?: string;
  /** All session IDs that have been associated with this task (history) */
  sessionIds: string[];
  /** Durable per-lane session history for Kanban workflow handoff */
  laneSessions: TaskLaneSession[];
  /** Adjacent-lane handoff requests and responses */
  laneHandoffs: TaskLaneHandoff[];
  githubId?: string;
  githubNumber?: number;
  githubUrl?: string;
  githubRepo?: string;
  githubState?: string;
  githubSyncedAt?: Date;
  lastSyncError?: string;
  isPullRequest?: boolean;
  dependencies: string[];
  parallelGroup?: string;
  workspaceId: string;
  /** Session ID that created this task (for session-scoped filtering) */
  sessionId?: string;
  creationSource?: TaskCreationSource;
  /** Associated codebase IDs for this task */
  codebaseIds: string[];
  /** Git worktree ID created for this task when it enters the dev column */
  worktreeId?: string;
  /** Frozen delivery evidence captured before PR / merge / base sync can erase base..HEAD */
  deliverySnapshot?: TaskDeliverySnapshot;
  createdAt: Date;
  updatedAt: Date;
  completionSummary?: string;
  verificationVerdict?: VerificationVerdict;
  verificationReport?: string;
}

export function createTask(params: {
  id: string;
  title: string;
  objective: string;
  comment?: string;
  comments?: TaskCommentEntry[];
  workspaceId: string;
  triggerSessionId?: string;
  sessionId?: string;
  creationSource?: TaskCreationSource;
  scope?: string;
  acceptanceCriteria?: string[];
  verificationCommands?: string[];
  testCases?: string[];
  dependencies?: string[];
  parallelGroup?: string;
  boardId?: string;
  columnId?: string;
  position?: number;
  priority?: TaskPriority;
  labels?: string[];
  assignee?: string;
  assignedProvider?: string;
  assignedRole?: string;
  assignedSpecialistId?: string;
  assignedSpecialistName?: string;
  fallbackAgentChain?: FallbackAgent[];
  enableAutomaticFallback?: boolean;
  maxFallbackAttempts?: number;
  githubId?: string;
  githubNumber?: number;
  githubUrl?: string;
  githubRepo?: string;
  githubState?: string;
  githubSyncedAt?: Date;
  lastSyncError?: string;
  isPullRequest?: boolean;
  status?: TaskStatus;
  codebaseIds?: string[];
  worktreeId?: string;
}): Task {
  const now = new Date();
  const comments = params.comments ?? buildInitialTaskComments(params.comment, now);
  return {
    id: params.id,
    title: params.title,
    objective: params.objective,
    comment: params.comment,
    comments,
    scope: params.scope,
    acceptanceCriteria: params.acceptanceCriteria,
    verificationCommands: params.verificationCommands,
    testCases: params.testCases,
    status: params.status ?? TaskStatus.PENDING,
    boardId: params.boardId,
    columnId: params.columnId,
    position: params.position ?? 0,
    priority: params.priority,
    labels: params.labels ?? [],
    assignee: params.assignee,
    assignedProvider: params.assignedProvider,
    assignedRole: params.assignedRole,
    assignedSpecialistId: params.assignedSpecialistId,
    assignedSpecialistName: params.assignedSpecialistName,
    fallbackAgentChain: params.fallbackAgentChain,
    enableAutomaticFallback: params.enableAutomaticFallback,
    maxFallbackAttempts: params.maxFallbackAttempts,
    sessionIds: [],
    laneSessions: [],
    laneHandoffs: [],
    githubId: params.githubId,
    githubNumber: params.githubNumber,
    githubUrl: params.githubUrl,
    githubRepo: params.githubRepo,
    githubState: params.githubState,
    githubSyncedAt: params.githubSyncedAt,
    lastSyncError: params.lastSyncError,
    isPullRequest: params.isPullRequest,
    dependencies: params.dependencies ?? [],
    parallelGroup: params.parallelGroup,
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    creationSource: params.creationSource,
    codebaseIds: params.codebaseIds ?? [],
    worktreeId: params.worktreeId,
    triggerSessionId: params.triggerSessionId,
    createdAt: now,
    updatedAt: now,
  };
}

function buildInitialTaskComments(comment: string | undefined, now: Date): TaskCommentEntry[] {
  const trimmed = comment?.trim();
  if (!trimmed) {
    return [];
  }

  return [{
    id: createTaskCommentId(),
    body: trimmed,
    createdAt: now.toISOString(),
    source: "legacy_import",
  }];
}

function createTaskCommentId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `comment-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function hydrateTaskComments(
  comments: TaskCommentEntry[] | undefined,
  legacyComment: string | undefined,
): TaskCommentEntry[] {
  if ((comments?.length ?? 0) > 0) {
    return comments ?? [];
  }

  return splitLegacyTaskComment(legacyComment);
}

export function splitLegacyTaskComment(comment: string | undefined): TaskCommentEntry[] {
  const trimmed = comment?.trim();
  if (!trimmed) {
    return [];
  }

  return [{
    id: "legacy-comment-1",
    body: trimmed,
    createdAt: "",
    source: "legacy_import",
  }];
}
