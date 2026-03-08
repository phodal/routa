/**
 * Issue model — represents a Kanban/GitHub issue within the Routa system.
 *
 * Supports local-only issues as well as issues synchronized with GitHub.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

/** Kanban column status */
export type KanbanStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "blocked"
  | "done";

/** Issue priority level */
export type IssuePriority = "urgent" | "high" | "medium" | "low" | "none";

/** GitHub issue state */
export type GitHubState = "open" | "closed";

// ─── Model ───────────────────────────────────────────────────────────────────

export interface Issue {
  id: string;
  title: string;
  body: string;
  status: KanbanStatus;
  priority: IssuePriority;
  workspaceId: string;
  assigneeId?: string;

  /** Labels attached to this issue */
  labels: string[];

  // ── GitHub sync fields ──
  /** GitHub node ID (globally unique) */
  githubId?: string;
  /** GitHub issue number within the repository */
  githubNumber?: number;
  /** HTML URL to the issue on GitHub */
  githubUrl?: string;
  /** Open or closed state on GitHub */
  githubState?: GitHubState;
  /** When the issue was last updated on GitHub */
  githubUpdatedAt?: Date;
  /** When the last successful sync occurred */
  githubSyncedAt?: Date;
  /** Error message from the most recent sync attempt */
  lastSyncError?: string;

  createdAt: Date;
  updatedAt: Date;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createIssue(
  partial: Omit<Issue, "createdAt" | "updatedAt">
): Issue {
  const now = new Date();
  return {
    ...partial,
    labels: partial.labels ?? [],
    createdAt: now,
    updatedAt: now,
  };
}

// ─── GitHub payload types (REST API v3) ──────────────────────────────────────

export interface GitHubIssuePayload {
  id: number;
  node_id: string;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  labels: Array<{ name: string }>;
  assignee?: { login: string } | null;
  assignees?: Array<{ login: string }>;
  updated_at: string;
}
