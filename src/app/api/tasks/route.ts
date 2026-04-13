/**
 * /api/tasks - REST API for task management.
 *
 * GET    /api/tasks?workspaceId=...  → List tasks
 * POST   /api/tasks                   → Create a task
 * DELETE /api/tasks?taskId=...        → Delete a task
 * DELETE /api/tasks?workspaceId=...   → Delete all tasks in a workspace
 */

import { NextRequest, NextResponse } from "next/server";
import { monitorApiRoute } from "@/core/http/api-route-observability";
import { getRoutaSystem } from "@/core/routa-system";
import { createTask, hydrateTaskComments, Task, TaskStatus, TaskPriority } from "@/core/models/task";
import type { ArtifactStore } from "@/core/store/artifact-store";
import type { CodebaseStore } from "@/core/db/pg-codebase-store";
import type { KanbanBoardStore } from "@/core/store/kanban-board-store";
import type { WorktreeStore } from "@/core/db/pg-worktree-store";
import { v4 as uuidv4 } from "uuid";
import { ensureDefaultBoard } from "@/core/kanban/boards";
import {
  buildTaskGitHubIssueBody,
  createGitHubIssue,
  resolveGitHubRepo,
} from "@/core/kanban/github-issues";
import {
  normalizeTaskCreationSource,
  shouldCreateGitHubIssueOnTaskCreate,
} from "@/core/kanban/task-creation-policy";
import { columnIdToTaskStatus } from "@/core/models/kanban";
import { getKanbanEventBroadcaster } from "@/core/kanban/kanban-event-broadcaster";
import { emitColumnTransition } from "@/core/kanban/column-transition";
import { processKanbanColumnTransition } from "@/core/kanban/workflow-orchestrator-singleton";
import {
  buildTaskEvidenceSummary,
  buildTaskInvestValidation,
  buildTaskStoryReadiness,
} from "./task-evidence-summary";
import { buildTaskDeliveryReadiness } from "@/core/kanban/task-delivery-readiness";

export const dynamic = "force-dynamic";

type RoutaSystem = ReturnType<typeof getRoutaSystem>;

type TaskSerializationSystem = {
  artifactStore: Pick<ArtifactStore, "listByTask">;
  kanbanBoardStore: Pick<KanbanBoardStore, "get">;
  codebaseStore: Pick<CodebaseStore, "get" | "getDefault">;
  worktreeStore: Pick<WorktreeStore, "get">;
};

type SerializeTaskOptions = {
  includeDeliveryReadiness?: boolean;
};

function cachePromise<K, V>(cache: Map<K, Promise<V>>, key: K, load: () => Promise<V>): Promise<V> {
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const promise = load();
  cache.set(key, promise);
  return promise;
}

function isMissingSqliteWorktreesTable(error: unknown): boolean {
  return error instanceof Error && error.message.includes("no such table: worktrees");
}

async function listWorktreesSafely(
  system: RoutaSystem,
  workspaceId: string,
): Promise<Awaited<ReturnType<WorktreeStore["listByWorkspace"]>>> {
  try {
    return await system.worktreeStore.listByWorkspace(workspaceId);
  } catch (error) {
    if (isMissingSqliteWorktreesTable(error)) {
      return [];
    }
    throw error;
  }
}

async function createTaskSerializationSystem(
  system: RoutaSystem,
  workspaceId: string,
  tasks: Task[],
): Promise<TaskSerializationSystem> {
  const [codebases, worktrees, artifacts] = await Promise.all([
    system.codebaseStore.listByWorkspace(workspaceId),
    listWorktreesSafely(system, workspaceId),
    typeof system.artifactStore.listByWorkspace === "function"
      ? system.artifactStore.listByWorkspace(workspaceId)
      : Promise.resolve([]),
  ]);
  const hasPreloadedArtifacts = typeof system.artifactStore.listByWorkspace === "function";

  const codebaseById = new Map(codebases.map((codebase) => [codebase.id, codebase]));
  const defaultCodebase = codebases.find((codebase) => codebase.isDefault);
  const worktreeById = new Map(worktrees.map((worktree) => [worktree.id, worktree]));
  const preloadedTaskIds = new Set(tasks.filter((task) => task.workspaceId === workspaceId).map((task) => task.id));
  const artifactsByTaskId = new Map<string, typeof artifacts>();
  for (const artifact of artifacts) {
    const taskArtifacts = artifactsByTaskId.get(artifact.taskId) ?? [];
    taskArtifacts.push(artifact);
    artifactsByTaskId.set(artifact.taskId, taskArtifacts);
  }
  const artifactCache = new Map<string, ReturnType<ArtifactStore["listByTask"]>>();
  const boardCache = new Map<string, ReturnType<KanbanBoardStore["get"]>>();
  const codebaseCache = new Map<string, ReturnType<CodebaseStore["get"]>>();
  const worktreeCache = new Map<string, ReturnType<WorktreeStore["get"]>>();

  return {
    artifactStore: {
      listByTask: (taskId) =>
        hasPreloadedArtifacts && preloadedTaskIds.has(taskId)
          ? Promise.resolve(artifactsByTaskId.get(taskId) ?? [])
          : cachePromise(artifactCache, taskId, () => system.artifactStore.listByTask(taskId)),
    },
    kanbanBoardStore: {
      get: (boardId) =>
        cachePromise(boardCache, boardId, () => system.kanbanBoardStore.get(boardId)),
    },
    codebaseStore: {
      get: (codebaseId) => {
        const preloaded = codebaseById.get(codebaseId);
        if (preloaded) {
          return Promise.resolve(preloaded);
        }
        return cachePromise(codebaseCache, codebaseId, () => system.codebaseStore.get(codebaseId));
      },
      getDefault: (requestedWorkspaceId) => {
        if (requestedWorkspaceId === workspaceId && defaultCodebase) {
          return Promise.resolve(defaultCodebase);
        }
        return system.codebaseStore.getDefault(requestedWorkspaceId);
      },
    },
    worktreeStore: {
      get: (worktreeId) => {
        const preloaded = worktreeById.get(worktreeId);
        if (preloaded) {
          return Promise.resolve(preloaded);
        }
        return cachePromise(worktreeCache, worktreeId, () => system.worktreeStore.get(worktreeId));
      },
    },
  };
}

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
  return monitorApiRoute(request, "GET /api/tasks", () => getTasks(request));
}

async function getTasks(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const workspaceId = requireWorkspaceId(searchParams.get("workspaceId"));
  const sessionId = searchParams.get("sessionId");
  const status = searchParams.get("status");
  const assignedTo = searchParams.get("assignedTo");
  const expand = new Set(searchParams.getAll("expand").flatMap((value) => value.split(",").map((item) => item.trim())));
  const includeDeliveryReadiness = expand.has("deliveryReadiness");

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

  const serializationSystem = await createTaskSerializationSystem(system, workspaceId, tasks);

  return NextResponse.json({
    tasks: await Promise.all(tasks.map((task) =>
      serializeTask(task, serializationSystem, { includeDeliveryReadiness })
    )),
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
    githubId,
    githubNumber,
    githubUrl,
    githubRepo,
    githubState,
    isPullRequest,
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
  const normalizedGitHubId = typeof githubId === "string" && githubId.trim()
    ? githubId.trim()
    : undefined;
  const normalizedGitHubNumber = typeof githubNumber === "number" && Number.isFinite(githubNumber)
    ? githubNumber
    : undefined;
  const normalizedGitHubUrl = typeof githubUrl === "string" && githubUrl.trim()
    ? githubUrl.trim()
    : undefined;
  const normalizedGitHubRepo = typeof githubRepo === "string" && githubRepo.trim()
    ? githubRepo.trim()
    : undefined;
  const normalizedGitHubState = typeof githubState === "string" && githubState.trim()
    ? githubState.trim()
    : undefined;
  const normalizedIsPullRequest = isPullRequest === true ? true : undefined;
  const hasImportedGitHubIssue = Boolean(normalizedGitHubRepo && normalizedGitHubNumber !== undefined);

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

  if (hasImportedGitHubIssue) {
    const existingTask = (await system.taskStore.listByWorkspace(normalizedWorkspaceId)).find((task) =>
      task.githubRepo === normalizedGitHubRepo && task.githubNumber === normalizedGitHubNumber
    );
    if (existingTask) {
      return NextResponse.json(
        { error: `GitHub issue #${normalizedGitHubNumber} is already imported as task ${existingTask.id}` },
        { status: 409 },
      );
    }
  }

  const codebase = normalizedRepoPath
    ? await system.codebaseStore.findByRepoPath(normalizedWorkspaceId, normalizedRepoPath)
    : normalizedCodebaseIds.length > 0
      ? await system.codebaseStore.get(normalizedCodebaseIds[0])
      : await system.codebaseStore.getDefault(normalizedWorkspaceId);

  const repo = resolveGitHubRepo(codebase?.sourceUrl, codebase?.repoPath ?? normalizedRepoPath);

  let nextGitHubId: string | undefined = normalizedGitHubId;
  let nextGitHubNumber: number | undefined = normalizedGitHubNumber;
  let nextGitHubUrl: string | undefined = normalizedGitHubUrl;
  let nextGitHubRepo: string | undefined = normalizedGitHubRepo;
  let nextGitHubState: string | undefined = normalizedGitHubState;
  let githubSyncedAt: Date | undefined = hasImportedGitHubIssue ? new Date() : undefined;
  let lastSyncError: string | undefined;

  if (normalizedCreateGitHubIssue && !hasImportedGitHubIssue) {
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
        nextGitHubId = issue.id;
        nextGitHubNumber = issue.number;
        nextGitHubUrl = issue.url;
        nextGitHubRepo = issue.repo;
        nextGitHubState = issue.state;
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
    githubId: nextGitHubId,
    githubNumber: nextGitHubNumber,
    githubUrl: nextGitHubUrl,
    githubRepo: nextGitHubRepo,
    githubState: nextGitHubState,
    githubSyncedAt,
    lastSyncError,
    isPullRequest: normalizedIsPullRequest,
    creationSource: normalizedCreationSource,
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
    const transition = {
      cardId: task.id,
      cardTitle: task.title,
      boardId: board.id,
      workspaceId: task.workspaceId,
      fromColumnId: "__created__",
      toColumnId: targetColumn.id,
      fromColumnName: "Created",
      toColumnName: targetColumn.name,
    };
    await processKanbanColumnTransition(system, transition);
    emitColumnTransition(system.eventBus, transition);
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

async function serializeTask(
  task: Task,
  system: TaskSerializationSystem,
  options: SerializeTaskOptions = { includeDeliveryReadiness: true },
) {
  const evidenceSummary = await buildTaskEvidenceSummary(task, system);
  const storyReadiness = await buildTaskStoryReadiness(task, system);
  const investValidation = buildTaskInvestValidation(task);
  const deliveryReadiness = options.includeDeliveryReadiness === false
    ? undefined
    : await buildTaskDeliveryReadiness(task, system);
  const comments = hydrateTaskComments(task.comments, task.comment);

  return {
    id: task.id,
    title: task.title,
    objective: task.objective,
    comment: task.comment,
    comments,
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
    isPullRequest: task.isPullRequest,
    dependencies: task.dependencies,
    parallelGroup: task.parallelGroup,
    workspaceId: task.workspaceId,
    sessionId: task.sessionId,
    creationSource: task.creationSource,
    codebaseIds: task.codebaseIds ?? [],
    worktreeId: task.worktreeId,
    completionSummary: task.completionSummary,
    ...(task.verificationVerdict != null && { verificationVerdict: task.verificationVerdict }),
    ...(task.verificationReport != null && { verificationReport: task.verificationReport }),
    artifactSummary: evidenceSummary.artifact,
    evidenceSummary,
    storyReadiness,
    investValidation,
    ...(deliveryReadiness != null && { deliveryReadiness }),
    createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : task.createdAt,
    updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : task.updatedAt,
  };
}
