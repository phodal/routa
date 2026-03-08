/**
 * PgIssueStore — Postgres-backed issue store using Drizzle ORM.
 */

import { eq, and } from "drizzle-orm";
import type { Database } from "./index";
import { issues } from "./schema";
import type { Issue, KanbanStatus, GitHubState, IssuePriority } from "../models/issue";
import type { IssueStore } from "../store/issue-store";

export class PgIssueStore implements IssueStore {
  constructor(private db: Database) {}

  async save(issue: Issue): Promise<void> {
    await this.db
      .insert(issues)
      .values({
        id: issue.id,
        title: issue.title,
        body: issue.body,
        status: issue.status,
        priority: issue.priority,
        workspaceId: issue.workspaceId,
        assigneeId: issue.assigneeId,
        labels: issue.labels,
        githubId: issue.githubId,
        githubNumber: issue.githubNumber,
        githubUrl: issue.githubUrl,
        githubState: issue.githubState,
        githubUpdatedAt: issue.githubUpdatedAt,
        githubSyncedAt: issue.githubSyncedAt,
        lastSyncError: issue.lastSyncError,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
      })
      .onConflictDoUpdate({
        target: issues.id,
        set: {
          title: issue.title,
          body: issue.body,
          status: issue.status,
          priority: issue.priority,
          assigneeId: issue.assigneeId,
          labels: issue.labels,
          githubId: issue.githubId,
          githubNumber: issue.githubNumber,
          githubUrl: issue.githubUrl,
          githubState: issue.githubState,
          githubUpdatedAt: issue.githubUpdatedAt,
          githubSyncedAt: issue.githubSyncedAt,
          lastSyncError: issue.lastSyncError,
          updatedAt: new Date(),
        },
      });
  }

  async get(issueId: string): Promise<Issue | undefined> {
    const rows = await this.db
      .select()
      .from(issues)
      .where(eq(issues.id, issueId))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<Issue[]> {
    const rows = await this.db
      .select()
      .from(issues)
      .where(eq(issues.workspaceId, workspaceId));
    return rows.map(this.toModel).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async listByStatus(workspaceId: string, status: KanbanStatus): Promise<Issue[]> {
    const rows = await this.db
      .select()
      .from(issues)
      .where(and(eq(issues.workspaceId, workspaceId), eq(issues.status, status)));
    return rows.map(this.toModel).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async findByGithubNumber(workspaceId: string, githubNumber: number): Promise<Issue | undefined> {
    const rows = await this.db
      .select()
      .from(issues)
      .where(and(eq(issues.workspaceId, workspaceId), eq(issues.githubNumber, githubNumber)))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async findByGithubId(githubId: string): Promise<Issue | undefined> {
    const rows = await this.db
      .select()
      .from(issues)
      .where(eq(issues.githubId, githubId))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async updateStatus(issueId: string, status: KanbanStatus): Promise<void> {
    await this.db
      .update(issues)
      .set({ status, updatedAt: new Date() })
      .where(eq(issues.id, issueId));
  }

  async delete(issueId: string): Promise<void> {
    await this.db.delete(issues).where(eq(issues.id, issueId));
  }

  private toModel(row: typeof issues.$inferSelect): Issue {
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      status: row.status as KanbanStatus,
      priority: (row.priority ?? "none") as IssuePriority,
      workspaceId: row.workspaceId,
      assigneeId: row.assigneeId ?? undefined,
      labels: (row.labels ?? []) as string[],
      githubId: row.githubId ?? undefined,
      githubNumber: row.githubNumber ?? undefined,
      githubUrl: row.githubUrl ?? undefined,
      githubState: row.githubState as GitHubState | undefined,
      githubUpdatedAt: row.githubUpdatedAt ?? undefined,
      githubSyncedAt: row.githubSyncedAt ?? undefined,
      lastSyncError: row.lastSyncError ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
