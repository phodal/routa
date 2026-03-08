// Shared types for workspace dashboard components

export interface SessionInfo {
  sessionId: string;
  name?: string;
  cwd: string;
  workspaceId: string;
  provider?: string;
  role?: string;
  acpStatus?: "connecting" | "ready" | "error";
  acpError?: string;
  createdAt: string;
}

export interface TaskInfo {
  id: string;
  title: string;
  objective?: string;
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
  githubId?: string;
  githubNumber?: number;
  githubUrl?: string;
  githubRepo?: string;
  githubState?: string;
  githubSyncedAt?: string;
  lastSyncError?: string;
  sessionId?: string;
  createdAt: string;
}

export interface KanbanColumnInfo {
  id: string;
  name: string;
  color?: string;
  position: number;
  stage: string;
}

export interface KanbanBoardInfo {
  id: string;
  workspaceId: string;
  name: string;
  isDefault: boolean;
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
