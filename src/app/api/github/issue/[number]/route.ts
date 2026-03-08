/**
 * PATCH /api/github/issue/:number — Update a Kanban issue.
 *
 * Looks up the issue by its local ID (the `number` path param is the UUID).
 * Optionally propagates changes back to GitHub.
 *
 * PATCH body:
 *   { title?, body?, status?, priority?, labels?, assigneeId?,
 *     workspaceId?,
 *     githubOwner?, githubRepo?, githubToken? }
 */

import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import type { KanbanStatus, IssuePriority } from "@/core/models/issue";
import { GitHubIssueClient } from "@/core/github/github-issue-client";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ number: string }> }
) {
  const { number: issueId } = await params;
  const body = await request.json();

  const system = getRoutaSystem();
  const existing = await system.issueStore.get(issueId);
  if (!existing) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const {
    title,
    body: issueBody,
    status,
    priority,
    labels,
    assigneeId,
    githubOwner,
    githubRepo,
    githubToken,
  } = body as {
    title?: string;
    body?: string;
    status?: KanbanStatus;
    priority?: IssuePriority;
    labels?: string[];
    assigneeId?: string;
    githubOwner?: string;
    githubRepo?: string;
    githubToken?: string;
  };

  const updated = {
    ...existing,
    title: title ?? existing.title,
    body: issueBody ?? existing.body,
    status: (status ?? existing.status) as KanbanStatus,
    priority: (priority ?? existing.priority) as IssuePriority,
    labels: labels ?? existing.labels,
    assigneeId: assigneeId ?? existing.assigneeId,
    updatedAt: new Date(),
  };

  // Optionally propagate to GitHub
  const token = githubToken ?? process.env.GITHUB_TOKEN;
  if (existing.githubNumber && githubOwner && githubRepo && token) {
    try {
      const client = new GitHubIssueClient({ owner: githubOwner, repo: githubRepo, token });
      const ghInput: Parameters<typeof client.updateIssue>[1] = {};
      if (title !== undefined) ghInput.title = title;
      if (issueBody !== undefined) ghInput.body = issueBody;
      if (labels !== undefined) ghInput.labels = labels;
      if (assigneeId !== undefined) ghInput.assignees = [assigneeId];
      // Map kanban "done" → closed, anything else → open
      if (status !== undefined) {
        ghInput.state = status === "done" ? "closed" : "open";
      }

      const ghIssue = await client.updateIssue(existing.githubNumber, ghInput);
      updated.githubState = ghIssue.state;
      updated.githubUpdatedAt = new Date(ghIssue.updated_at);
      updated.githubSyncedAt = new Date();
      updated.lastSyncError = undefined;
    } catch (err) {
      updated.lastSyncError = err instanceof Error ? err.message : String(err);
    }
  }

  await system.issueStore.save(updated);

  return NextResponse.json({
    issue: {
      id: updated.id,
      title: updated.title,
      body: updated.body,
      status: updated.status,
      priority: updated.priority,
      workspaceId: updated.workspaceId,
      assigneeId: updated.assigneeId,
      labels: updated.labels,
      githubId: updated.githubId,
      githubNumber: updated.githubNumber,
      githubUrl: updated.githubUrl,
      githubState: updated.githubState,
      githubUpdatedAt: updated.githubUpdatedAt?.toISOString(),
      githubSyncedAt: updated.githubSyncedAt?.toISOString(),
      lastSyncError: updated.lastSyncError,
      createdAt: updated.createdAt instanceof Date ? updated.createdAt.toISOString() : updated.createdAt,
      updatedAt: updated.updatedAt instanceof Date ? updated.updatedAt.toISOString() : updated.updatedAt,
    },
  });
}
