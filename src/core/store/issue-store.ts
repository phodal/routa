/**
 * IssueStore — interface and in-memory implementation for Kanban issues.
 */

import type { Issue, KanbanStatus } from "../models/issue";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface IssueStore {
  /** Persist or update an issue. Uses upsert semantics on `id`. */
  save(issue: Issue): Promise<void>;
  /** Retrieve a single issue by its local ID. */
  get(issueId: string): Promise<Issue | undefined>;
  /** List all issues for a workspace, ordered by `updatedAt` descending. */
  listByWorkspace(workspaceId: string): Promise<Issue[]>;
  /** List issues filtered by Kanban status. */
  listByStatus(workspaceId: string, status: KanbanStatus): Promise<Issue[]>;
  /** Find an issue by GitHub issue number (within a workspace). */
  findByGithubNumber(workspaceId: string, githubNumber: number): Promise<Issue | undefined>;
  /** Find an issue by GitHub node ID (globally unique). */
  findByGithubId(githubId: string): Promise<Issue | undefined>;
  /** Update only the Kanban status field. */
  updateStatus(issueId: string, status: KanbanStatus): Promise<void>;
  /** Delete an issue by its local ID. */
  delete(issueId: string): Promise<void>;
}

// ─── In-memory implementation ────────────────────────────────────────────────

export class InMemoryIssueStore implements IssueStore {
  private issues = new Map<string, Issue>();

  async save(issue: Issue): Promise<void> {
    this.issues.set(issue.id, { ...issue });
  }

  async get(issueId: string): Promise<Issue | undefined> {
    const issue = this.issues.get(issueId);
    return issue ? { ...issue } : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<Issue[]> {
    return Array.from(this.issues.values())
      .filter((i) => i.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async listByStatus(workspaceId: string, status: KanbanStatus): Promise<Issue[]> {
    return Array.from(this.issues.values())
      .filter((i) => i.workspaceId === workspaceId && i.status === status)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async findByGithubNumber(workspaceId: string, githubNumber: number): Promise<Issue | undefined> {
    for (const issue of this.issues.values()) {
      if (issue.workspaceId === workspaceId && issue.githubNumber === githubNumber) {
        return { ...issue };
      }
    }
    return undefined;
  }

  async findByGithubId(githubId: string): Promise<Issue | undefined> {
    for (const issue of this.issues.values()) {
      if (issue.githubId === githubId) {
        return { ...issue };
      }
    }
    return undefined;
  }

  async updateStatus(issueId: string, status: KanbanStatus): Promise<void> {
    const issue = this.issues.get(issueId);
    if (issue) {
      issue.status = status;
      issue.updatedAt = new Date();
    }
  }

  async delete(issueId: string): Promise<void> {
    this.issues.delete(issueId);
  }
}
