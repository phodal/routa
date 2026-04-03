/**
 * Task model - port of routa-core Task.kt
 *
 * Represents a unit of work within the multi-agent system.
 */

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
  requestType: TaskLaneHandoffRequestType;
  request: string;
  status: TaskLaneHandoffStatus;
  requestedAt: string;
  respondedAt?: string;
  responseSummary?: string;
}

export interface InvestValidation {
  independent: { status: "pass" | "fail" | "warning"; reason: string };
  negotiable: { status: "pass" | "fail" | "warning"; reason: string };
  valuable: { status: "pass" | "fail" | "warning"; reason: string };
  estimable: { status: "pass" | "fail" | "warning"; reason: string };
  small: { status: "pass" | "fail" | "warning"; reason: string };
  testable: { status: "pass" | "fail" | "warning"; reason: string };
  overall: "pass" | "fail" | "warning";
  validatedAt: string;
  issues: string[];
}

export interface Task {
  id: string;
  title: string;
  objective: string;
  comment?: string;
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
  dependencies: string[];
  parallelGroup?: string;
  workspaceId: string;
  /** Session ID that created this task (for session-scoped filtering) */
  sessionId?: string;
  /** Associated codebase IDs for this task */
  codebaseIds: string[];
  /** Git worktree ID created for this task when it enters the dev column */
  worktreeId?: string;
  createdAt: Date;
  updatedAt: Date;
  completionSummary?: string;
  verificationVerdict?: VerificationVerdict;
  verificationReport?: string;
  investValidation?: InvestValidation;
}

export function createTask(params: {
  id: string;
  title: string;
  objective: string;
  comment?: string;
  workspaceId: string;
  triggerSessionId?: string;
  sessionId?: string;
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
  githubId?: string;
  githubNumber?: number;
  githubUrl?: string;
  githubRepo?: string;
  githubState?: string;
  githubSyncedAt?: Date;
  lastSyncError?: string;
  status?: TaskStatus;
  codebaseIds?: string[];
  worktreeId?: string;
  investValidation?: InvestValidation;
}): Task {
  const now = new Date();
  return {
    id: params.id,
    title: params.title,
    objective: params.objective,
    comment: params.comment,
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
    dependencies: params.dependencies ?? [],
    parallelGroup: params.parallelGroup,
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    codebaseIds: params.codebaseIds ?? [],
    worktreeId: params.worktreeId,
    triggerSessionId: params.triggerSessionId,
    investValidation: params.investValidation,
    createdAt: now,
    updatedAt: now,
  };
}
