/**
 * Workspace model
 *
 * Represents a logical workspace (typically 1:1 with a Git repo/branch).
 * Workspace is now a first-class citizen — every agent, task, and note
 * belongs to exactly one workspace.
 */

export type WorkspaceStatus = "active" | "archived";

export interface Workspace {
  id: string;
  title: string;
  repoPath?: string;
  branch?: string;
  status: WorkspaceStatus;
  metadata: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export function createWorkspace(params: {
  id: string;
  title: string;
  repoPath?: string;
  branch?: string;
  metadata?: Record<string, string>;
}): Workspace {
  const now = new Date();
  return {
    id: params.id,
    title: params.title,
    repoPath: params.repoPath,
    branch: params.branch,
    status: "active",
    metadata: params.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };
}
