import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { TaskPriority, type Task } from "@/core/models/task";
import { columnIdToTaskStatus, taskStatusToColumnId } from "@/core/models/kanban";
import { updateGitHubIssue } from "@/core/kanban/github-issues";
import { getInternalApiOrigin, triggerAssignedTaskAgent } from "@/core/kanban/agent-trigger";

export const dynamic = "force-dynamic";

function serializeTask(task: Task) {
  return {
    ...task,
    githubSyncedAt: task.githubSyncedAt?.toISOString(),
    createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : task.createdAt,
    updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : task.updatedAt,
  };
}

function sanitizeLabels(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;

  return Array.from(
    new Set(
      value
        .filter((label): label is string => typeof label === "string")
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  );
}

function parsePriority(value: unknown): TaskPriority | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return undefined;

  return Object.values(TaskPriority).includes(value as TaskPriority)
    ? value as TaskPriority
    : undefined;
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

  let body: Partial<Task> & {
    repoPath?: string;
    syncToGitHub?: boolean;
    retryTrigger?: boolean;
  };
  try {
    body = await request.json() as Partial<Task> & {
      repoPath?: string;
      syncToGitHub?: boolean;
      retryTrigger?: boolean;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const nextTask: Task = { ...existing, updatedAt: new Date() };

  if (body.title !== undefined) nextTask.title = body.title;
  if (body.objective !== undefined) nextTask.objective = body.objective;
  if (body.scope !== undefined) nextTask.scope = body.scope;
  if (body.acceptanceCriteria !== undefined) nextTask.acceptanceCriteria = body.acceptanceCriteria;
  if (body.verificationCommands !== undefined) nextTask.verificationCommands = body.verificationCommands;
  if (body.assignedTo !== undefined) nextTask.assignedTo = body.assignedTo;
  if (body.boardId !== undefined) nextTask.boardId = body.boardId;
  if (body.columnId !== undefined) nextTask.columnId = body.columnId;
  if (body.position !== undefined) nextTask.position = body.position;
  if (body.assignee !== undefined) nextTask.assignee = body.assignee;
  if (body.assignedProvider !== undefined) nextTask.assignedProvider = body.assignedProvider;
  if (body.assignedRole !== undefined) nextTask.assignedRole = body.assignedRole;
  if (body.assignedSpecialistId !== undefined) nextTask.assignedSpecialistId = body.assignedSpecialistId;
  if (body.assignedSpecialistName !== undefined) nextTask.assignedSpecialistName = body.assignedSpecialistName;
  if (body.triggerSessionId !== undefined) nextTask.triggerSessionId = body.triggerSessionId;
  if (body.githubId !== undefined) nextTask.githubId = body.githubId;
  if (body.githubNumber !== undefined) nextTask.githubNumber = body.githubNumber;
  if (body.githubUrl !== undefined) nextTask.githubUrl = body.githubUrl;
  if (body.githubRepo !== undefined) nextTask.githubRepo = body.githubRepo;
  if (body.githubState !== undefined) nextTask.githubState = body.githubState;
  if (body.lastSyncError !== undefined) nextTask.lastSyncError = body.lastSyncError;
  if (body.dependencies !== undefined) nextTask.dependencies = body.dependencies;
  if (body.parallelGroup !== undefined) nextTask.parallelGroup = body.parallelGroup;
  if (body.completionSummary !== undefined) nextTask.completionSummary = body.completionSummary;
  if (body.verificationVerdict !== undefined) nextTask.verificationVerdict = body.verificationVerdict;
  if (body.verificationReport !== undefined) nextTask.verificationReport = body.verificationReport;

  const normalizedLabels = sanitizeLabels(body.labels);
  if (body.labels !== undefined && normalizedLabels === undefined) {
    return NextResponse.json({ error: "labels must be an array of strings" }, { status: 400 });
  }
  if (normalizedLabels) {
    nextTask.labels = normalizedLabels;
  }

  const normalizedPriority = parsePriority(body.priority);
  if (body.priority !== undefined && normalizedPriority === undefined) {
    return NextResponse.json({ error: `Invalid priority: ${String(body.priority)}` }, { status: 400 });
  }
  if (body.priority !== undefined) {
    nextTask.priority = normalizedPriority;
  }

  if (body.status !== undefined) {
    nextTask.status = body.status;
  }

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
      origin: getInternalApiOrigin(),
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

