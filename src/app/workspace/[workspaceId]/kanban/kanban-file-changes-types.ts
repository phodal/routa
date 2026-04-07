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
}

export interface KanbanRepoChanges {
  codebaseId: string;
  repoPath: string;
  label: string;
  branch: string;
  status: KanbanRepoStatus;
  files: KanbanFileChangeItem[];
  error?: string;
}

export interface KanbanTaskChanges extends KanbanRepoChanges {
  source: "worktree" | "repo";
  worktreeId?: string;
  worktreePath?: string;
}

export interface KanbanFileDiffPreview {
  path: string;
  previousPath?: string;
  status: KanbanFileChangeStatus;
  patch: string;
  additions?: number;
  deletions?: number;
}
