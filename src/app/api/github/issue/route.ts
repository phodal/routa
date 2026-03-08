/**
 * POST /api/github/issue — Create a new Kanban issue (optionally synced to GitHub).
 *
 * Body:
 *   { title, body?, status?, priority?, workspaceId?, labels?,
 *     githubOwner?, githubRepo?, githubToken? }
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getRoutaSystem } from "@/core/routa-system";
import { createIssue, type KanbanStatus, type IssuePriority } from "@/core/models/issue";
import { GitHubIssueClient } from "@/core/github/github-issue-client";

export const dynamic = "force-dynamic";

// ─── POST /api/github/issue ────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    title,
    body: issueBody = "",
    status = "backlog",
    priority = "none",
    workspaceId = "default",
    labels = [],
    assigneeId,
    // Optional: push to GitHub at creation time
    githubOwner,
    githubRepo,
    githubToken,
  } = body as {
    title?: string;
    body?: string;
    status?: KanbanStatus;
    priority?: IssuePriority;
    workspaceId?: string;
    labels?: string[];
    assigneeId?: string;
    githubOwner?: string;
    githubRepo?: string;
    githubToken?: string;
  };

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const system = getRoutaSystem();

  let githubId: string | undefined;
  let githubNumber: number | undefined;
  let githubUrl: string | undefined;
  let githubState: "open" | "closed" | undefined;
  let githubUpdatedAt: Date | undefined;
  let githubSyncedAt: Date | undefined;
  let lastSyncError: string | undefined;

  // Optionally create the issue on GitHub
  const token = githubToken ?? process.env.GITHUB_TOKEN;
  if (githubOwner && githubRepo && token) {
    try {
      const client = new GitHubIssueClient({ owner: githubOwner, repo: githubRepo, token });
      const ghIssue = await client.createIssue({
        title,
        body: issueBody,
        labels,
        assignees: assigneeId ? [assigneeId] : [],
      });
      githubId = ghIssue.node_id;
      githubNumber = ghIssue.number;
      githubUrl = ghIssue.html_url;
      githubState = ghIssue.state;
      githubUpdatedAt = new Date(ghIssue.updated_at);
      githubSyncedAt = new Date();
    } catch (err) {
      lastSyncError = err instanceof Error ? err.message : String(err);
    }
  }

  const issue = createIssue({
    id: uuidv4(),
    title,
    body: issueBody,
    status: status as KanbanStatus,
    priority: priority as IssuePriority,
    workspaceId,
    labels,
    assigneeId,
    githubId,
    githubNumber,
    githubUrl,
    githubState,
    githubUpdatedAt,
    githubSyncedAt,
    lastSyncError,
  });

  await system.issueStore.save(issue);

  return NextResponse.json({ issue: serializeIssue(issue) }, { status: 201 });
}

// ─── Serializer ────────────────────────────────────────────────────────────

function serializeIssue(issue: ReturnType<typeof createIssue>) {
  return {
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
  };
}
