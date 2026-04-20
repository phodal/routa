/**
 * Git Log Panel — shared types for the IDE-style commit log viewer.
 *
 * These types are intentionally decoupled from the rest of the kanban domain
 * so the panel can be backed by either a mock adapter or a real git adapter.
 */

// ---------------------------------------------------------------------------
// Refs
// ---------------------------------------------------------------------------

export type RefKind = "head" | "local" | "remote" | "tag";

export interface GitRef {
  name: string;
  /** e.g. "origin" for remote refs */
  remote?: string;
  kind: RefKind;
  /** SHA the ref currently points to */
  commitSha: string;
  /** Whether this ref is the current HEAD */
  isCurrent?: boolean;
}

// ---------------------------------------------------------------------------
// Commits
// ---------------------------------------------------------------------------

export interface GitCommit {
  sha: string;
  shortSha: string;
  message: string;
  summary: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  parents: string[];
  /** Refs that point at this commit */
  refs: GitRef[];
  /** Graph lane index (0-based, left to right) — filled in by the graph layout */
  lane?: number;
  /** Visual connectors to parent commits */
  graphEdges?: GraphEdge[];
}

export interface GraphEdge {
  fromLane: number;
  toLane: number;
  /** Whether this edge merges into a different lane */
  isMerge?: boolean;
}

// ---------------------------------------------------------------------------
// Changed files (commit detail)
// ---------------------------------------------------------------------------

export type FileChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied";

export interface CommitFileChange {
  path: string;
  previousPath?: string;
  status: FileChangeKind;
  additions: number;
  deletions: number;
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface GitLogQuery {
  repoPath: string;
  /** Filter commits reachable from these refs (empty = all) */
  branches?: string[];
  /** Text / hash search */
  search?: string;
  /** Number of commits to return per page */
  limit?: number;
  /** Offset for pagination (skip N commits) */
  skip?: number;
}

export interface GitLogPage {
  commits: GitCommit[];
  total: number;
  hasMore: boolean;
}

export interface GitRefsResult {
  head: GitRef | null;
  local: GitRef[];
  remote: GitRef[];
  tags: GitRef[];
}

export interface GitCommitDetail {
  commit: GitCommit;
  files: CommitFileChange[];
  /** Full diff patch (optional — may be lazily loaded) */
  patch?: string;
}

export interface GitLogAdapter {
  /** Fetch refs (branches + tags) for a repository */
  getRefs(repoPath: string): Promise<GitRefsResult>;

  /** Fetch a page of commits */
  getLog(query: GitLogQuery): Promise<GitLogPage>;

  /** Fetch detail (changed files) for a single commit */
  getCommitDetail(repoPath: string, sha: string): Promise<GitCommitDetail>;
}
