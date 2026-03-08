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

export interface Task {
  id: string;
  title: string;
  objective: string;
  scope?: string;
  acceptanceCriteria?: string[];
  verificationCommands?: string[];
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
  workspaceId: string;
  sessionId?: string;
  scope?: string;
  acceptanceCriteria?: string[];
  verificationCommands?: string[];
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
}): Task {
  const now = new Date();
  return {
    id: params.id,
    title: params.title,
    objective: params.objective,
    scope: params.scope,
    acceptanceCriteria: params.acceptanceCriteria,
    verificationCommands: params.verificationCommands,
    status: TaskStatus.PENDING,
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
    createdAt: now,
    updatedAt: now,
  };
}
