/**
 * GET /api/github/issues — List Kanban issues for a workspace with optional filters.
 *
 * Query params:
 *   workspaceId  - workspace to scope to (default: "default")
 *   status       - filter by Kanban status (backlog|todo|in_progress|in_review|blocked|done)
 *
 * Also supports syncing issues from GitHub when `sync=true` is passed:
 *   sync         - "true" to fetch from GitHub and upsert into local store
 *   githubOwner  - GitHub repo owner (required when sync=true)
 *   githubRepo   - GitHub repo name (required when sync=true)
 *   githubToken  - override the GITHUB_TOKEN env var
 *   state        - GitHub issue state filter: open|closed|all (default: open)
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getRoutaSystem } from "@/core/routa-system";
import { createIssue, type KanbanStatus } from "@/core/models/issue";
import {
  GitHubIssueClient,
  githubStateToKanbanStatus,
} from "@/core/github/github-issue-client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const workspaceId = searchParams.get("workspaceId") ?? "default";
  const status = searchParams.get("status") as KanbanStatus | null;
  const sync = searchParams.get("sync") === "true";
  const githubOwner = searchParams.get("githubOwner");
  const githubRepo = searchParams.get("githubRepo");
  const githubToken = searchParams.get("githubToken");
  const state = (searchParams.get("state") ?? "open") as "open" | "closed" | "all";

  const system = getRoutaSystem();

  // ── Optional: pull from GitHub and upsert ──────────────────────────────
  if (sync && githubOwner && githubRepo) {
    const token = githubToken ?? process.env.GITHUB_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "GITHUB_TOKEN not configured" },
        { status: 400 }
      );
    }

    try {
      const client = new GitHubIssueClient({
        owner: githubOwner,
        repo: githubRepo,
        token,
      });
      const ghIssues = await client.listIssues({ state });

      const now = new Date();
      for (const ghIssue of ghIssues) {
        const existing = await system.issueStore.findByGithubId(ghIssue.node_id);
        const kanbanStatus: KanbanStatus = existing?.status ?? githubStateToKanbanStatus(ghIssue.state);

        const issue = createIssue({
          id: existing?.id ?? uuidv4(),
          title: ghIssue.title,
          body: ghIssue.body ?? "",
          status: kanbanStatus,
          priority: existing?.priority ?? "none",
          workspaceId,
          labels: ghIssue.labels.map((l) => l.name),
          assigneeId: ghIssue.assignee?.login ?? existing?.assigneeId,
          githubId: ghIssue.node_id,
          githubNumber: ghIssue.number,
          githubUrl: ghIssue.html_url,
          githubState: ghIssue.state,
          githubUpdatedAt: new Date(ghIssue.updated_at),
          githubSyncedAt: now,
        });
        // Preserve createdAt if updating existing
        if (existing) {
          issue.createdAt = existing.createdAt;
        }
        await system.issueStore.save(issue);
      }
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "GitHub sync failed" },
        { status: 502 }
      );
    }
  }

  // ── Return local issues ────────────────────────────────────────────────
  const issues = status
    ? await system.issueStore.listByStatus(workspaceId, status)
    : await system.issueStore.listByWorkspace(workspaceId);

  return NextResponse.json({
    issues: issues.map((issue) => ({
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
      githubUpdatedAt: issue.githubUpdatedAt?.toISOString(),
      githubSyncedAt: issue.githubSyncedAt?.toISOString(),
      lastSyncError: issue.lastSyncError,
      createdAt: issue.createdAt instanceof Date ? issue.createdAt.toISOString() : issue.createdAt,
      updatedAt: issue.updatedAt instanceof Date ? issue.updatedAt.toISOString() : issue.updatedAt,
    })),
  });
}
