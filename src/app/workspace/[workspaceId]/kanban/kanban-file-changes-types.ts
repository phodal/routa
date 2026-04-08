export type KanbanFileChangeStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "typechange"
  | "conflicted";

export interface KanbanRepoStatus {
  clean: boolean;
  ahead: number;
  behind: number;
  modified: number;
  untracked: number;
}

export interface KanbanFileChangeItem {
  path: string;
  status: KanbanFileChangeStatus;
  previousPath?: string;
  additions?: number;
  deletions?: number;
  /** Source of the change - useful for distinguishing agent vs manual changes */
  source?: "agent" | "manual" | "git" | "worktree";
  /** Timestamp when the change was detected */
  timestamp?: number;
  /** Whether the file is staged in the Git index */
  staged?: boolean;
  /** UI state: whether the file is selected for batch operations */
  selected?: boolean;
}

export interface KanbanRepoChanges {
  codebaseId: string;
  repoPath: string;
  label: string;
  branch: string;
  status: KanbanRepoStatus;
  /** @deprecated Use unstagedFiles and stagedFiles instead for git workflow */
  files: KanbanFileChangeItem[];
  error?: string;
  /** Files in the working directory that are not staged */
  unstagedFiles?: KanbanFileChangeItem[];
  /** Files that are staged and ready to commit */
  stagedFiles?: KanbanFileChangeItem[];
  /** Recent commits from the current branch */
  commits?: KanbanCommitInfo[];
  /** Current branch name (same as branch field, kept for clarity) */
  currentBranch?: string;
  /** Target branch for PR/merge context (e.g., 'main' or 'master') */
  targetBranch?: string;
  /** Number of commits ahead of the remote branch */
  ahead?: number;
  /** Number of commits behind the remote branch */
  behind?: number;
}

export interface KanbanTaskChanges extends KanbanRepoChanges {
  source: "worktree" | "repo";
  worktreeId?: string;
  worktreePath?: string;
  mode?: "worktree" | "commits";
  baseRef?: string;
  commits?: KanbanCommitChangeItem[];
}

export interface KanbanFileDiffPreview {
  path: string;
  previousPath?: string;
  status: KanbanFileChangeStatus;
  patch: string;
  additions?: number;
  deletions?: number;
}

export interface KanbanCommitChangeItem {
  sha: string;
  shortSha: string;
  summary: string;
  authorName: string;
  authoredAt: string;
  additions: number;
  deletions: number;
}

export interface KanbanCommitDiffPreview extends KanbanCommitChangeItem {
  patch: string;
}

/** Extended commit information with file list for the commits section */
export interface KanbanCommitInfo extends KanbanCommitChangeItem {
  /** Full commit message (multi-line) */
  message?: string;
  /** Email of the commit author */
  authorEmail?: string;
  /** Files changed in this commit */
  files?: KanbanFileChangeItem[];
  /** UI state: whether the commit is expanded to show files */
  expanded?: boolean;
  /** Parent commit SHA(s) */
  parents?: string[];
}

// ============================================================================
// Git Operations Request/Response Types
// ============================================================================

/** Request to stage files */
export interface StageFilesRequest {
  /** Codebase ID */
  codebaseId: string;
  /** File paths to stage (relative to repo root) */
  files: string[];
}

/** Request to unstage files */
export interface UnstageFilesRequest {
  /** Codebase ID */
  codebaseId: string;
  /** File paths to unstage (relative to repo root) */
  files: string[];
}

/** Request to discard changes to files */
export interface DiscardChangesRequest {
  /** Codebase ID */
  codebaseId: string;
  /** File paths to discard (relative to repo root) */
  files: string[];
}

/** Request to create a commit */
export interface CreateCommitRequest {
  /** Codebase ID */
  codebaseId: string;
  /** Commit message */
  message: string;
  /** Optional: specific files to commit (if not provided, commits all staged files) */
  files?: string[];
}

/** Request to pull commits from remote */
export interface PullCommitsRequest {
  /** Codebase ID */
  codebaseId: string;
  /** Remote name (default: 'origin') */
  remote?: string;
  /** Branch name (default: current branch) */
  branch?: string;
}

/** Request to rebase onto a target branch */
export interface RebaseRequest {
  /** Codebase ID */
  codebaseId: string;
  /** Target branch to rebase onto */
  onto: string;
}

/** Request to reset branch */
export interface ResetBranchRequest {
  /** Codebase ID */
  codebaseId: string;
  /** Target commit/branch to reset to */
  to: string;
  /** Reset mode: 'soft' keeps changes staged, 'hard' discards all changes */
  mode: "soft" | "hard";
}

/** Response from Git operations */
export interface GitOperationResponse {
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if operation failed */
  error?: string;
  /** Updated repo changes after the operation */
  repoChanges?: KanbanRepoChanges;
}
