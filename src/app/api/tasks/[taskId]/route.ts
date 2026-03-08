import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import type { Task } from "@/core/models/task";
import { columnIdToTaskStatus, taskStatusToColumnId } from "@/core/models/kanban";
import { parseGitHubRepo, updateGitHubIssue } from "@/core/kanban/github-issues";
import { triggerAssignedTaskAgent } from "@/core/kanban/agent-trigger";

export const dynamic = "force-dynamic";

function serializeTask(task: Task) {
  return {
    ...task,
    githubSyncedAt: task.githubSyncedAt?.toISOString(),
    createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : task.createdAt,
    updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : task.updatedAt,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const system = getRoutaSystem();
  const task = await system.taskStore.get(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  return NextResponse.json({ task: serializeTask(task) });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const system = getRoutaSystem();
  const existing = await system.taskStore.get(taskId);
  if (!existing) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const body = await request.json() as Partial<Task> & {
    repoPath?: string;
    syncToGitHub?: boolean;
    retryTrigger?: boolean;
  };
  const nextTask: Task = {
    ...existing,
    ...body,
    labels: body.labels ?? existing.labels,
    position: body.position ?? existing.position,
    updatedAt: new Date(),
  };

  if (body.retryTrigger) {
    nextTask.triggerSessionId = undefined;
    nextTask.lastSyncError = undefined;
  }

  if (body.columnId && !body.status) {
    nextTask.status = columnIdToTaskStatus(body.columnId);
  }
  if (body.status && !body.columnId) {
    nextTask.columnId = taskStatusToColumnId(body.status);
  }

  if (body.syncToGitHub !== false && nextTask.githubRepo && nextTask.githubNumber) {
    try {
      await updateGitHubIssue(nextTask.githubRepo, nextTask.githubNumber, {
        title: nextTask.title,
        body: nextTask.objective,
        labels: nextTask.labels,
        state: nextTask.status === "COMPLETED" ? "closed" : "open",
        assignees: nextTask.assignee ? [nextTask.assignee] : undefined,
      });
      nextTask.githubState = nextTask.status === "COMPLETED" ? "closed" : "open";
      nextTask.githubSyncedAt = new Date();
      nextTask.lastSyncError = undefined;
    } catch (error) {
      nextTask.lastSyncError = error instanceof Error ? error.message : "GitHub sync failed";
    }
  }

  const enteringDev = nextTask.columnId === "dev" && existing.columnId !== "dev";
  const assignedWhileInDev = nextTask.columnId === "dev" && !existing.triggerSessionId && (
    body.assignedProvider !== undefined || body.assignedSpecialistId !== undefined || body.assignedRole !== undefined
  );
  const retryingTrigger = body.retryTrigger === true;

  if ((enteringDev || assignedWhileInDev || retryingTrigger) && !nextTask.triggerSessionId && nextTask.assignedProvider) {
    const preferredCodebase = body.repoPath
      ? await system.codebaseStore.findByRepoPath(nextTask.workspaceId, body.repoPath)
      : await system.codebaseStore.getDefault(nextTask.workspaceId);
    const triggerResult = await triggerAssignedTaskAgent({
      origin: request.nextUrl.origin,
      workspaceId: nextTask.workspaceId,
      cwd: preferredCodebase?.repoPath ?? process.cwd(),
      branch: preferredCodebase?.branch,
      task: nextTask,
    });
    if (triggerResult.sessionId) {
      nextTask.triggerSessionId = triggerResult.sessionId;
      nextTask.lastSyncError = undefined;
    } else if (triggerResult.error) {
      nextTask.lastSyncError = triggerResult.error;
    }
  }

  await system.taskStore.save(nextTask);
  return NextResponse.json({ task: serializeTask(nextTask) });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const system = getRoutaSystem();
  await system.taskStore.delete(taskId);
  return NextResponse.json({ deleted: true });
}

