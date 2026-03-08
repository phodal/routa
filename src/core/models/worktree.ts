/**
 * Worktree model
 *
 * Represents a Git worktree associated with a Codebase.
 * Enables multiple agents to work in parallel on the same repository,
 * each using an isolated working directory on a separate branch.
 */

export type WorktreeStatus = "creating" | "active" | "error" | "removing";

export interface Worktree {
  id: string;
  codebaseId: string;
  workspaceId: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
  status: WorktreeStatus;
  sessionId?: string;
  label?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export function createWorktree(params: {
  id: string;
  codebaseId: string;
  workspaceId: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
  label?: string;
}): Worktree {
  const now = new Date();
  return {
    id: params.id,
    codebaseId: params.codebaseId,
    workspaceId: params.workspaceId,
    worktreePath: params.worktreePath,
    branch: params.branch,
    baseBranch: params.baseBranch,
    status: "creating",
    label: params.label,
    createdAt: now,
    updatedAt: now,
  };
}
