import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { TaskPriority, TaskStatus, type Task } from "@/core/models/task";
import { columnIdToTaskStatus, taskStatusToColumnId } from "@/core/models/kanban";
import { getKanbanEventBroadcaster } from "@/core/kanban/kanban-event-broadcaster";
import { ensureTaskBoardContext } from "@/core/kanban/task-board-context";
import { buildTaskGitHubIssueBody, updateGitHubIssue } from "@/core/kanban/github-issues";
import { GitWorktreeService } from "@/core/git/git-worktree-service";
import { getDefaultWorkspaceWorktreeRoot, getEffectiveWorkspaceMetadata } from "@/core/models/workspace";
import type { ArtifactType } from "@/core/models/artifact";
import { emitColumnTransition } from "@/core/kanban/column-transition";
import { archiveActiveTaskSession, prepareTaskForColumnChange } from "@/core/kanban/task-session-transition";
import {
  enqueueKanbanTaskSession,
  getKanbanSessionQueue,
  processKanbanColumnTransition,
} from "@/core/kanban/workflow-orchestrator-singleton";
import { buildRemainingLaneStepsMessage, resolveCurrentLaneAutomationState } from "@/core/kanban/lane-automation-state";
import {
  buildTaskEvidenceSummary,
  buildTaskInvestValidation,
  buildTaskStoryReadiness,
  formatRequiredTaskFieldLabel,
  resolveTargetRequiredTaskFields,
  validateTaskReadiness,
} from "../task-evidence-summary";
import {
  buildTaskDeliveryReadiness,
  buildTaskDeliveryTransitionError,
} from "@/core/kanban/task-delivery-readiness";

export const dynamic = "force-dynamic";

async function serializeTask(task: Task, system: ReturnType<typeof getRoutaSystem>) {
  const evidenceSummary = await buildTaskEvidenceSummary(task, system);
  const storyReadiness = await buildTaskStoryReadiness(task, system);
  const investValidation = buildTaskInvestValidation(task);

  return {
    ...task,
    artifactSummary: evidenceSummary.artifact,
    evidenceSummary,
    storyReadiness,
    investValidation,
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

function parseStatus(value: unknown): TaskStatus | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return undefined;

  return Object.values(TaskStatus).includes(value as TaskStatus)
    ? value as TaskStatus
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
  return NextResponse.json({ task: await serializeTask(task, system) });
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
    codebaseIds?: string[];
    worktreeId?: string | null;
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
  if (body.comment !== undefined) nextTask.comment = body.comment;
  if (body.scope !== undefined) nextTask.scope = body.scope;
  if (body.acceptanceCriteria !== undefined) nextTask.acceptanceCriteria = body.acceptanceCriteria;
  if (body.verificationCommands !== undefined) nextTask.verificationCommands = body.verificationCommands;
  if (body.testCases !== undefined) nextTask.testCases = body.testCases;
  if (body.assignedTo !== undefined) nextTask.assignedTo = body.assignedTo;
  if (body.boardId !== undefined) nextTask.boardId = body.boardId;
  if (body.codebaseIds !== undefined && Array.isArray(body.codebaseIds)) {
    nextTask.codebaseIds = body.codebaseIds.filter((id): id is string => typeof id === "string");
  }
  if (body.worktreeId === null) nextTask.worktreeId = undefined;
  if (typeof body.worktreeId === "string") nextTask.worktreeId = body.worktreeId;

  // Check required artifacts before allowing column transition
  if (body.columnId !== undefined && body.columnId !== existing.columnId) {
    const boardId = body.boardId ?? existing.boardId;
    if (boardId) {
      const board = await system.kanbanBoardStore.get(boardId);
      if (board) {
        if (existing.triggerSessionId) {
          const laneAutomationState = resolveCurrentLaneAutomationState(existing, board.columns, {
            currentSessionId: existing.triggerSessionId,
          });
          const moveBlockedMessage = buildRemainingLaneStepsMessage(existing.title, laneAutomationState);
          if (moveBlockedMessage) {
            return NextResponse.json({ error: moveBlockedMessage }, { status: 400 });
          }
        }

        const targetColumn = board.columns.find((c) => c.id === body.columnId);
        const requiredArtifacts = targetColumn?.automation?.requiredArtifacts;
        if (requiredArtifacts && requiredArtifacts.length > 0 && system.artifactStore) {
          const missingArtifacts: string[] = [];
          for (const artifactType of requiredArtifacts) {
            const artifacts = await system.artifactStore.listByTaskAndType(
              taskId,
              artifactType as ArtifactType
            );
            if (artifacts.length === 0) {
              missingArtifacts.push(artifactType);
            }
          }
          if (missingArtifacts.length > 0) {
            return NextResponse.json(
              {
                error: `Cannot move task to "${targetColumn?.name ?? body.columnId}": missing required artifacts: ${missingArtifacts.join(", ")}. Please provide these artifacts before moving the task.`,
                missingArtifacts,
              },
              { status: 400 }
            );
          }
        }

        const requiredTaskFields = resolveTargetRequiredTaskFields(board.columns, targetColumn?.id);
        if (requiredTaskFields.length > 0) {
          const readiness = validateTaskReadiness(nextTask, requiredTaskFields);
          if (!readiness.ready) {
            const missingTaskFields = readiness.missing.map(formatRequiredTaskFieldLabel);
            return NextResponse.json(
              {
                error: `Cannot move task to "${targetColumn?.name ?? body.columnId}": missing required task fields: ${missingTaskFields.join(", ")}. Please complete this story definition before moving the task.`,
                missingTaskFields,
                storyReadiness: readiness,
              },
              { status: 400 },
            );
          }
        }

        if (targetColumn && (targetColumn.id === "review" || targetColumn.id === "done")) {
          const deliveryReadiness = await buildTaskDeliveryReadiness(nextTask, system);
          const deliveryError = buildTaskDeliveryTransitionError(
            deliveryReadiness,
            targetColumn.name ?? body.columnId,
            targetColumn.id,
          );
          if (deliveryError) {
            return NextResponse.json(
              {
                error: deliveryError,
                deliveryReadiness,
              },
              { status: 400 },
            );
          }
        }
      }
    }
  }

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

  const normalizedStatus = parseStatus(body.status);
  if (body.status !== undefined && normalizedStatus === undefined) {
    return NextResponse.json({ error: `Invalid status: ${String(body.status)}` }, { status: 400 });
  }
  if (body.status !== undefined) {
    nextTask.status = normalizedStatus as TaskStatus;
  }

  if (body.columnId !== undefined && body.status !== undefined) {
    const expectedStatus = columnIdToTaskStatus(body.columnId);
    const expectedColumnId = taskStatusToColumnId(normalizedStatus);
    if (expectedStatus !== normalizedStatus || expectedColumnId !== body.columnId) {
      return NextResponse.json(
        { error: "columnId and status must describe the same workflow state" },
        { status: 400 },
      );
    }
  }

  if (body.retryTrigger) {
    // Preserve the current session in history before clearing for retry
    archiveActiveTaskSession(nextTask);
    nextTask.triggerSessionId = undefined;
    nextTask.lastSyncError = undefined;
    getKanbanSessionQueue(system).removeCardJob(taskId);
  }

  if (body.columnId && !body.status) {
    nextTask.status = columnIdToTaskStatus(body.columnId);
  }
  if (body.status && !body.columnId) {
    nextTask.columnId = taskStatusToColumnId(body.status);
  }

  Object.assign(nextTask, await ensureTaskBoardContext(system, nextTask));

  const columnChanged = prepareTaskForColumnChange(existing.columnId, nextTask);
  if (columnChanged) {
    getKanbanSessionQueue(system).removeCardJob(taskId);
    if (existing.worktreeId) {
      await system.worktreeStore.assignSession(existing.worktreeId, null);
    }
  }

  if (body.syncToGitHub !== false && nextTask.githubRepo && nextTask.githubNumber) {
    try {
      await updateGitHubIssue(nextTask.githubRepo, nextTask.githubNumber, {
        title: nextTask.title,
        body: buildTaskGitHubIssueBody(nextTask.objective, nextTask.testCases),
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

  if ((enteringDev || assignedWhileInDev || retryingTrigger) && !nextTask.triggerSessionId) {
    // Determine which codebase to use: first from task's codebaseIds, else repo path, else default
    let preferredCodebase = body.repoPath
      ? await system.codebaseStore.findByRepoPath(nextTask.workspaceId, body.repoPath)
      : undefined;
    if (!preferredCodebase && (nextTask.codebaseIds?.length ?? 0) > 0) {
      preferredCodebase = await system.codebaseStore.get(nextTask.codebaseIds![0]);
    }
    if (!preferredCodebase) {
      preferredCodebase = await system.codebaseStore.getDefault(nextTask.workspaceId);
    }

    // Auto-create worktree when entering dev column (if no worktree yet and codebase exists)
    if (enteringDev && preferredCodebase && !nextTask.worktreeId) {
      try {
        const worktreeService = new GitWorktreeService(system.worktreeStore, system.codebaseStore);
        const slugifiedTitle = nextTask.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 40);
        const branch = `issue/${nextTask.id.slice(0, 8)}-${slugifiedTitle}`;
        const label = `${nextTask.id.slice(0, 8)}-${slugifiedTitle}`;
        // Req 5: use worktreeRoot from workspace metadata if configured
        const workspace = await system.workspaceStore.get(nextTask.workspaceId);
        const worktreeRoot = workspace
          ? getEffectiveWorkspaceMetadata(workspace).worktreeRoot
          : getDefaultWorkspaceWorktreeRoot(nextTask.workspaceId);
        const worktree = await worktreeService.createWorktree(preferredCodebase.id, {
          branch,
          baseBranch: preferredCodebase.branch ?? "main",
          label,
          worktreeRoot,
        });
        nextTask.worktreeId = worktree.id;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[kanban] Failed to auto-create worktree:", msg);
        // Mark task as blocked if worktree creation fails
        nextTask.status = TaskStatus.BLOCKED;
        nextTask.columnId = "blocked";
        nextTask.lastSyncError = `Worktree creation failed: ${msg}`;
        await system.taskStore.save(nextTask);
        getKanbanEventBroadcaster().notify({
          workspaceId: nextTask.workspaceId,
          entity: "task",
          action: "updated",
          resourceId: nextTask.id,
          source: "user",
        });
        return NextResponse.json({ task: await serializeTask(nextTask, system) });
      }
    }

    const triggerResult = await enqueueKanbanTaskSession(system, {
      task: nextTask,
      expectedColumnId: nextTask.columnId,
      ignoreExistingTrigger: retryingTrigger,
    });
    if (triggerResult.sessionId) {
      nextTask.triggerSessionId = triggerResult.sessionId;
      // Track session in history
      if (!nextTask.sessionIds) nextTask.sessionIds = [];
      if (!nextTask.sessionIds.includes(triggerResult.sessionId)) {
        nextTask.sessionIds.push(triggerResult.sessionId);
      }
      nextTask.lastSyncError = undefined;
    } else if (triggerResult.queued) {
      nextTask.lastSyncError = undefined;
    } else if (triggerResult.error) {
      nextTask.lastSyncError = triggerResult.error;
    }
  }

  await system.taskStore.save(nextTask);
  getKanbanEventBroadcaster().notify({
    workspaceId: nextTask.workspaceId,
    entity: "task",
    action: existing.columnId !== nextTask.columnId ? "moved" : "updated",
    resourceId: nextTask.id,
    source: "user",
  });

  // Emit column transition event if column changed
  if (body.columnId !== undefined && existing.columnId !== nextTask.columnId && nextTask.boardId && nextTask.columnId) {
    const board = await system.kanbanBoardStore.get(nextTask.boardId);
    if (board && existing.columnId) {
      const fromColumn = board.columns.find((c) => c.id === existing.columnId);
      const toColumn = board.columns.find((c) => c.id === nextTask.columnId);

      const transition = {
        cardId: nextTask.id,
        cardTitle: nextTask.title,
        boardId: nextTask.boardId,
        workspaceId: nextTask.workspaceId,
        fromColumnId: existing.columnId,
        toColumnId: nextTask.columnId,
        fromColumnName: fromColumn?.name,
        toColumnName: toColumn?.name,
      };
      if (!nextTask.triggerSessionId) {
        await processKanbanColumnTransition(system, transition);
      }
      emitColumnTransition(system.eventBus, transition);
    }
  }

  return NextResponse.json({ task: await serializeTask(nextTask, system) });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const system = getRoutaSystem();
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
