/**
 * /api/tasks - REST API for task management.
 *
 * GET    /api/tasks?workspaceId=...  → List tasks
 * POST   /api/tasks                   → Create a task
 * DELETE /api/tasks?taskId=...        → Delete a task
 */

import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { createTask, Task, TaskStatus, TaskPriority } from "@/core/models/task";
import { v4 as uuidv4 } from "uuid";
import { ensureDefaultBoard } from "@/core/kanban/boards";
import { createGitHubIssue, parseGitHubRepo } from "@/core/kanban/github-issues";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const workspaceId = searchParams.get("workspaceId") ?? "default";
  const sessionId = searchParams.get("sessionId");
  const status = searchParams.get("status");
  const assignedTo = searchParams.get("assignedTo");

  const system = getRoutaSystem();

  let tasks: Task[];

  if (assignedTo) {
    tasks = await system.taskStore.listByAssignee(assignedTo);
  } else if (status) {
    const taskStatus = status.toUpperCase() as TaskStatus;
    if (!Object.values(TaskStatus).includes(taskStatus)) {
      return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
    }
    tasks = await system.taskStore.listByStatus(workspaceId, taskStatus);
  } else {
    tasks = await system.taskStore.listByWorkspace(workspaceId);
  }

  // Filter by sessionId if provided (post-filter since the store may not support it)
  if (sessionId) {
    tasks = tasks.filter((t) => t.sessionId === sessionId);
  }

  return NextResponse.json({
    tasks: tasks.map(serializeTask),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    title,
    objective,
    workspaceId = "default",
    sessionId,
    scope,
    acceptanceCriteria,
    verificationCommands,
    dependencies,
    parallelGroup,
    boardId,
    columnId,
    position,
    priority,
    labels,
    assignee,
    assignedProvider,
    assignedRole,
    assignedSpecialistId,
    assignedSpecialistName,
    createGitHubIssue: shouldCreateGitHubIssue,
    repoPath,
  } = body;

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!objective) {
    return NextResponse.json({ error: "objective is required" }, { status: 400 });
  }

  const system = getRoutaSystem();
  const defaultBoard = await ensureDefaultBoard(system, workspaceId);

  const codebase = repoPath
    ? await system.codebaseStore.findByRepoPath(workspaceId, repoPath)
    : await system.codebaseStore.getDefault(workspaceId);

  const repo = parseGitHubRepo(codebase?.sourceUrl);

  let githubId: string | undefined;
  let githubNumber: number | undefined;
  let githubUrl: string | undefined;
  let githubRepo: string | undefined;
  let githubState: string | undefined;
  let githubSyncedAt: Date | undefined;
  let lastSyncError: string | undefined;

  if (shouldCreateGitHubIssue) {
    if (!repo) {
      lastSyncError = "Selected codebase is not linked to a GitHub repository.";
    } else {
      try {
        const issue = await createGitHubIssue(repo, {
          title,
          body: objective,
          labels,
          assignees: assignee ? [assignee] : undefined,
        });
        githubId = issue.id;
        githubNumber = issue.number;
        githubUrl = issue.url;
        githubRepo = issue.repo;
        githubState = issue.state;
        githubSyncedAt = new Date();
      } catch (error) {
        lastSyncError = error instanceof Error ? error.message : "GitHub issue create failed";
      }
    }
  }

  const task = createTask({
    id: uuidv4(),
    title,
    objective,
    workspaceId,
    sessionId,
    scope,
    acceptanceCriteria,
    verificationCommands,
    dependencies,
    parallelGroup,
    boardId: boardId ?? defaultBoard.id,
    columnId: columnId ?? "backlog",
    position: typeof position === "number" ? position : 0,
    priority: priority as TaskPriority | undefined,
    labels: Array.isArray(labels) ? labels : [],
    assignee,
    assignedProvider,
    assignedRole,
    assignedSpecialistId,
    assignedSpecialistName,
    githubId,
    githubNumber,
    githubUrl,
    githubRepo,
    githubState,
    githubSyncedAt,
    lastSyncError,
  });

  await system.taskStore.save(task);

  return NextResponse.json({ task: serializeTask(task) }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const taskId = searchParams.get("taskId");

  if (!taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  const system = getRoutaSystem();
  await system.taskStore.delete(taskId);

  return NextResponse.json({ deleted: true });
}

function serializeTask(task: Task) {
  return {
    id: task.id,
    title: task.title,
    objective: task.objective,
    scope: task.scope,
    acceptanceCriteria: task.acceptanceCriteria,
    verificationCommands: task.verificationCommands,
    assignedTo: task.assignedTo,
    status: task.status,
    boardId: task.boardId,
    columnId: task.columnId,
    position: task.position,
    priority: task.priority,
    labels: task.labels,
    assignee: task.assignee,
    assignedProvider: task.assignedProvider,
    assignedRole: task.assignedRole,
    assignedSpecialistId: task.assignedSpecialistId,
    assignedSpecialistName: task.assignedSpecialistName,
    triggerSessionId: task.triggerSessionId,
    githubId: task.githubId,
    githubNumber: task.githubNumber,
    githubUrl: task.githubUrl,
    githubRepo: task.githubRepo,
    githubState: task.githubState,
    githubSyncedAt: task.githubSyncedAt?.toISOString(),
    lastSyncError: task.lastSyncError,
    dependencies: task.dependencies,
    parallelGroup: task.parallelGroup,
    workspaceId: task.workspaceId,
    sessionId: task.sessionId,
    completionSummary: task.completionSummary,
    verificationVerdict: task.verificationVerdict,
    verificationReport: task.verificationReport,
    createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : task.createdAt,
    updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : task.updatedAt,
  };
}

