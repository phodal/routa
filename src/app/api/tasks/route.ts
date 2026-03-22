/**
 * /api/tasks - REST API for task management.
 *
 * GET    /api/tasks?workspaceId=...  → List tasks
 * POST   /api/tasks                   → Create a task
 * DELETE /api/tasks?taskId=...        → Delete a task
 * DELETE /api/tasks?workspaceId=...   → Delete all tasks in a workspace
 */

import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { createTask, Task, TaskStatus, TaskPriority } from "@/core/models/task";
import { v4 as uuidv4 } from "uuid";
import { ensureDefaultBoard } from "@/core/kanban/boards";
import { buildTaskGitHubIssueBody, createGitHubIssue, parseGitHubRepo } from "@/core/kanban/github-issues";
import {
  normalizeTaskCreationSource,
  shouldCreateGitHubIssueOnTaskCreate,
} from "@/core/kanban/task-creation-policy";
import { columnIdToTaskStatus } from "@/core/models/kanban";
import { getKanbanEventBroadcaster } from "@/core/kanban/kanban-event-broadcaster";
import { emitColumnTransition } from "@/core/kanban/column-transition";
import type { ArtifactType } from "@/core/models/artifact";

export const dynamic = "force-dynamic";

function requireWorkspaceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function sanitizeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

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

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const workspaceId = requireWorkspaceId(searchParams.get("workspaceId"));
  const sessionId = searchParams.get("sessionId");
  const status = searchParams.get("status");
  const assignedTo = searchParams.get("assignedTo");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

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
    tasks: await Promise.all(tasks.map((task) => serializeTask(task, system))),
  });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    title,
    objective,
    workspaceId,
    sessionId,
    scope,
    acceptanceCriteria,
    verificationCommands,
    testCases,
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
    creationSource,
    repoPath,
    codebaseIds,
  } = body;

  const normalizedTitle = typeof title === "string" ? title : "";
  const normalizedObjective = typeof objective === "string" ? objective : "";
  const normalizedWorkspaceId = requireWorkspaceId(workspaceId);
  const normalizedSessionId = typeof sessionId === "string" ? sessionId : undefined;
  const normalizedScope = typeof scope === "string" ? scope : undefined;
  const normalizedAcceptanceCriteria = Array.isArray(acceptanceCriteria)
    ? acceptanceCriteria.filter((item): item is string => typeof item === "string")
    : undefined;
  const normalizedVerificationCommands = Array.isArray(verificationCommands)
    ? verificationCommands.filter((item): item is string => typeof item === "string")
    : undefined;
  const normalizedTestCases = Array.isArray(testCases)
    ? testCases.filter((item): item is string => typeof item === "string")
    : undefined;
  const normalizedDependencies = Array.isArray(dependencies)
    ? dependencies.filter((item): item is string => typeof item === "string")
    : undefined;
  const normalizedParallelGroup = typeof parallelGroup === "string" ? parallelGroup : undefined;
  const normalizedBoardId = typeof boardId === "string" ? boardId : undefined;
  const normalizedColumnId = typeof columnId === "string" ? columnId : undefined;
  const normalizedAssignee = typeof assignee === "string" ? assignee : undefined;
  const normalizedAssignedProvider = typeof assignedProvider === "string" ? assignedProvider : undefined;
  const normalizedAssignedRole = typeof assignedRole === "string" ? assignedRole : undefined;
  const normalizedAssignedSpecialistId = typeof assignedSpecialistId === "string" ? assignedSpecialistId : undefined;
  const normalizedAssignedSpecialistName = typeof assignedSpecialistName === "string" ? assignedSpecialistName : undefined;
  const normalizedCreationSource = normalizeTaskCreationSource(creationSource);
  const normalizedCreateGitHubIssue = shouldCreateGitHubIssueOnTaskCreate({
    createGitHubIssue: shouldCreateGitHubIssue === true,
    creationSource: normalizedCreationSource,
  });
  const normalizedRepoPath = typeof repoPath === "string" ? repoPath : undefined;
  const requestedCodebaseIds = Array.isArray(codebaseIds)
    ? codebaseIds.filter((id): id is string => typeof id === "string")
    : [];

  if (!normalizedTitle) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!normalizedObjective) {
    return NextResponse.json({ error: "objective is required" }, { status: 400 });
  }
  if (!normalizedWorkspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const normalizedPriority = parsePriority(priority);
  if (priority !== undefined && priority !== null && normalizedPriority === undefined) {
    return NextResponse.json({ error: `Invalid priority: ${String(priority)}` }, { status: 400 });
  }

  const normalizedLabels = sanitizeLabels(labels);

  const system = getRoutaSystem();
  const defaultBoard = await ensureDefaultBoard(system, normalizedWorkspaceId);
  const workspaceCodebases = await system.codebaseStore.listByWorkspace(normalizedWorkspaceId);
  const normalizedCodebaseIds = requestedCodebaseIds.length > 0
    ? requestedCodebaseIds
    : workspaceCodebases.map((codebase) => codebase.id);

  const codebase = normalizedRepoPath
    ? await system.codebaseStore.findByRepoPath(normalizedWorkspaceId, normalizedRepoPath)
    : normalizedCodebaseIds.length > 0
      ? await system.codebaseStore.get(normalizedCodebaseIds[0])
      : await system.codebaseStore.getDefault(normalizedWorkspaceId);

  const repo = parseGitHubRepo(codebase?.sourceUrl);

  let githubId: string | undefined;
  let githubNumber: number | undefined;
  let githubUrl: string | undefined;
  let githubRepo: string | undefined;
  let githubState: string | undefined;
  let githubSyncedAt: Date | undefined;
  let lastSyncError: string | undefined;

  if (normalizedCreateGitHubIssue) {
    if (!repo) {
      lastSyncError = "Selected codebase is not linked to a GitHub repository.";
    } else {
      try {
        const issue = await createGitHubIssue(repo, {
          title: normalizedTitle,
          body: buildTaskGitHubIssueBody(normalizedObjective, normalizedTestCases),
          labels: normalizedLabels,
          assignees: normalizedAssignee ? [normalizedAssignee] : undefined,
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
    title: normalizedTitle,
    objective: normalizedObjective,
    workspaceId: normalizedWorkspaceId,
    sessionId: normalizedSessionId,
    scope: normalizedScope,
    acceptanceCriteria: normalizedAcceptanceCriteria,
    verificationCommands: normalizedVerificationCommands,
    testCases: normalizedTestCases,
    dependencies: normalizedDependencies,
    parallelGroup: normalizedParallelGroup,
    boardId: normalizedBoardId ?? defaultBoard.id,
    columnId: normalizedColumnId ?? "backlog",
    status: columnIdToTaskStatus(normalizedColumnId),
    position: typeof position === "number" ? position : 0,
    priority: normalizedPriority,
    labels: normalizedLabels,
    assignee: normalizedAssignee,
    assignedProvider: normalizedAssignedProvider,
    assignedRole: normalizedAssignedRole,
    assignedSpecialistId: normalizedAssignedSpecialistId,
    assignedSpecialistName: normalizedAssignedSpecialistName,
    githubId,
    githubNumber,
    githubUrl,
    githubRepo,
    githubState,
    githubSyncedAt,
    lastSyncError,
    codebaseIds: normalizedCodebaseIds,
  });

  await system.taskStore.save(task);
  getKanbanEventBroadcaster().notify({
    workspaceId: task.workspaceId,
    entity: "task",
    action: "created",
    resourceId: task.id,
    source: "user",
  });

  const board = await system.kanbanBoardStore.get(task.boardId ?? defaultBoard.id);
  const targetColumn = board?.columns.find((column) => column.id === (task.columnId ?? "backlog"));
  if (board && targetColumn?.automation?.enabled) {
    emitColumnTransition(system.eventBus, {
      cardId: task.id,
      cardTitle: task.title,
      boardId: board.id,
      workspaceId: task.workspaceId,
      fromColumnId: "__created__",
      toColumnId: targetColumn.id,
      fromColumnName: "Created",
      toColumnName: targetColumn.name,
    });
  }

  return NextResponse.json({ task: await serializeTask(task, system) }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const taskId = searchParams.get("taskId");
  const workspaceId = requireWorkspaceId(searchParams.get("workspaceId"));
  const system = getRoutaSystem();

  if (workspaceId) {
    const deletedCount = await system.taskStore.deleteByWorkspace(workspaceId);
    getKanbanEventBroadcaster().notify({
      workspaceId,
      entity: "task",
      action: "deleted",
      source: "user",
    });
    return NextResponse.json({ deleted: true, deletedCount });
  }

  if (!taskId) {
    return NextResponse.json({ error: "taskId or workspaceId is required" }, { status: 400 });
  }

  const task = await system.taskStore.get(taskId);
  await system.taskStore.delete(taskId);
  if (task) {
    getKanbanEventBroadcaster().notify({
      workspaceId: task.workspaceId,
      entity: "task",
      action: "deleted",
      resourceId: task.id,
      source: "user",
    });
  }

  return NextResponse.json({ deleted: true });
}

async function buildArtifactSummary(task: Task, system: ReturnType<typeof getRoutaSystem>) {
  const artifacts = await system.artifactStore.listByTask(task.id);
  const byType: Partial<Record<ArtifactType, number>> = {};

  for (const artifact of artifacts) {
    byType[artifact.type] = (byType[artifact.type] ?? 0) + 1;
  }

  return {
    total: artifacts.length,
    byType,
  };
}

async function serializeTask(task: Task, system: ReturnType<typeof getRoutaSystem>) {
  return {
    id: task.id,
    title: task.title,
    objective: task.objective,
    scope: task.scope,
    acceptanceCriteria: task.acceptanceCriteria,
    verificationCommands: task.verificationCommands,
    testCases: task.testCases,
    assignedTo: task.assignedTo,
    status: task.status,
    boardId: task.boardId,
    columnId: task.columnId,
    position: task.position,
    ...(task.priority != null && { priority: task.priority }),
    labels: task.labels,
    assignee: task.assignee,
    assignedProvider: task.assignedProvider,
    assignedRole: task.assignedRole,
    assignedSpecialistId: task.assignedSpecialistId,
    assignedSpecialistName: task.assignedSpecialistName,
    triggerSessionId: task.triggerSessionId,
    sessionIds: task.sessionIds ?? [],
    laneSessions: task.laneSessions ?? [],
    laneHandoffs: task.laneHandoffs ?? [],
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
    codebaseIds: task.codebaseIds ?? [],
    worktreeId: task.worktreeId,
    completionSummary: task.completionSummary,
    ...(task.verificationVerdict != null && { verificationVerdict: task.verificationVerdict }),
    ...(task.verificationReport != null && { verificationReport: task.verificationReport }),
    artifactSummary: await buildArtifactSummary(task, system),
    createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : task.createdAt,
    updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : task.updatedAt,
  };
}
