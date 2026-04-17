import { NextRequest, NextResponse } from "next/server";
import { monitorApiRoute } from "@/core/http/api-route-observability";
import { getRoutaSystem } from "@/core/routa-system";
import { hydrateTaskComments, resetTaskExecutionState, TaskPriority, TaskStatus, VerificationVerdict, type Task } from "@/core/models/task";
import { columnIdToTaskStatus, resolveTaskStatusForBoardColumn, taskStatusToColumnId } from "@/core/models/kanban";
import { getKanbanEventBroadcaster } from "@/core/kanban/kanban-event-broadcaster";
import { ensureTaskBoardContext } from "@/core/kanban/task-board-context";
import { buildTaskGitHubIssueBody, updateGitHubIssue } from "@/core/kanban/github-issues";
import { GitWorktreeService } from "@/core/git/git-worktree-service";
import { ensureTaskWorktree } from "@/core/kanban/ensure-task-worktree";
import { getKanbanBranchRules } from "@/core/kanban/board-branch-rules";
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
  buildTaskDeliveryTransitionErrorFromRules,
  type TaskDeliveryReadiness,
} from "@/core/kanban/task-delivery-readiness";
import {
  captureTaskDeliverySnapshot,
  shouldCaptureTaskDeliverySnapshotForColumn,
} from "@/core/kanban/task-delivery-snapshot";
import {
  appendTaskComment,
  appendTaskCommentEntry,
} from "@/core/kanban/task-comment-log";
import { resolveReviewLaneConvergenceTarget } from "@/core/kanban/review-lane-convergence";
import {
  buildContractGateNote,
  buildContractLoopBreakerMessage,
  buildTaskContractReadiness,
  buildTaskContractTransitionErrorFromRules,
  buildTaskContractUpdateErrorFromRules,
  CONTRACT_GATE_BLOCKED_LABEL,
  countContractGateFailures,
  resolveCurrentOrNextContractGate,
} from "@/core/kanban/task-contract-readiness";
import { resolveTaskWorktreeTruth } from "@/core/kanban/task-worktree-truth";
import { checkDependencyGate, updateDependencyRelations, applyDependencyStatus, validateParentAssignment, detectParentCycle } from "@/core/kanban/dependency-gate";

export const dynamic = "force-dynamic";

async function serializeTask(task: Task, system: ReturnType<typeof getRoutaSystem>) {
  const evidenceSummary = await buildTaskEvidenceSummary(task, system);
  const storyReadiness = await buildTaskStoryReadiness(task, system);
  const investValidation = buildTaskInvestValidation(task);
  const deliveryReadiness = await buildTaskDeliveryReadiness(task, system);
  const comments = hydrateTaskComments(task.comments, task.comment);

  return {
    ...task,
    comments,
    artifactSummary: evidenceSummary.artifact,
    evidenceSummary,
    storyReadiness,
    investValidation,
    deliveryReadiness,
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

async function recordTaskContractGateFailure(
  task: Task,
  system: ReturnType<typeof getRoutaSystem>,
  params: {
    message: string;
    targetColumnName: string;
    threshold: number;
    sessionId?: string;
  },
): Promise<void> {
  const note = buildContractGateNote(params.message);
  let changed = true;

  task.comment = appendTaskComment(task.comment, note);
  task.comments = appendTaskCommentEntry(task.comments, note, {
    sessionId: params.sessionId,
    source: undefined,
  });

  const failureCount = countContractGateFailures(task);
  if (failureCount >= params.threshold) {
    const nextLabels = Array.from(new Set([...(task.labels ?? []), CONTRACT_GATE_BLOCKED_LABEL]));
    const nextMessage = buildContractLoopBreakerMessage(
      params.targetColumnName,
      failureCount,
      params.threshold,
    );
    if (task.lastSyncError !== nextMessage) {
      task.lastSyncError = nextMessage;
      changed = true;
    }
    if (nextLabels.length !== (task.labels ?? []).length) {
      task.labels = nextLabels;
      changed = true;
    }
  }

  if (!changed) {
    return;
  }

  task.updatedAt = new Date();
  await system.taskStore.save(task);
  getKanbanEventBroadcaster().notify({
    workspaceId: task.workspaceId,
    entity: "task",
    action: "updated",
    resourceId: task.id,
    source: "system",
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  return monitorApiRoute(request, "GET /api/tasks/[taskId]", () =>
    getTask(request, { params })
  );
}

async function getTask(
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
    retryProviderId?: string;
    codebaseIds?: string[];
    worktreeId?: string | null;
    reopenOnNewBranch?: boolean;
    branchStrategy?: "new" | "reset" | "custom";
    customBranchName?: string;
    targetBaseBranch?: string;
  };
  try {
    body = await request.json() as Partial<Task> & {
      repoPath?: string;
      syncToGitHub?: boolean;
      retryTrigger?: boolean;
      retryProviderId?: string;
      reopenOnNewBranch?: boolean;
      branchStrategy?: "new" | "reset" | "custom";
      customBranchName?: string;
      targetBaseBranch?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const nextTask: Task = { ...existing, updatedAt: new Date() };
  let transitionDeliveryReadiness: TaskDeliveryReadiness | undefined;

  // ── Reopen on New Branch ──────────────────────────────────────────
  // Three strategies for any card that has a worktree:
  //   "new"    — delete old worktree+branch, create fresh (default)
  //   "reset"  — keep worktree+branch, hard-reset to base
  //   "custom" — like "new" but with a user-specified branch name
  if (body.reopenOnNewBranch === true) {
    if (!existing.worktreeId) {
      return NextResponse.json(
        { error: "reopenOnNewBranch requires an existing worktree" },
        { status: 400 },
      );
    }

    const strategy = body.branchStrategy ?? "new";

    if (strategy === "reset") {
      // ── Reset: keep worktree, hard-reset to base branch ──
      try {
        const worktreeService = new GitWorktreeService(
          system.worktreeStore,
          system.codebaseStore,
        );
        await worktreeService.resetWorktree(existing.worktreeId, {
          baseBranch: body.targetBaseBranch,
        });
        console.log(
          `[ReopenOnNewBranch] Reset worktree ${existing.worktreeId} for task ${taskId}.`,
        );
      } catch (err) {
        console.warn(
          `[ReopenOnNewBranch] Failed to reset worktree ${existing.worktreeId}:`,
          err instanceof Error ? err.message : err,
        );
      }

      // Clear session/delivery state, but KEEP worktree + PR info
      resetTaskExecutionState(nextTask, false);

      // Move to dev column if not already there
      if (existing.columnId !== "dev") {
        body.columnId = "dev";
        body.status = TaskStatus.IN_PROGRESS;
      }
    } else {
      // ── New / Custom: delete old worktree, recreate on fresh branch ──

      // Clean up old worktree + branch
      try {
        const worktreeService = new GitWorktreeService(
          system.worktreeStore,
          system.codebaseStore,
        );
        await worktreeService.removeWorktree(existing.worktreeId, { deleteBranch: true });
        console.log(
          `[ReopenOnNewBranch] Removed old worktree ${existing.worktreeId} for task ${taskId}.`,
        );
      } catch (err) {
        console.warn(
          `[ReopenOnNewBranch] Failed to remove old worktree ${existing.worktreeId}:`,
          err instanceof Error ? err.message : err,
        );
      }

      // Reset all delivery / PR state
      resetTaskExecutionState(nextTask, true);

      // Custom branch name override (consumed when worktree is created)
      if (strategy === "custom" && body.customBranchName) {
        nextTask.nextBranchOverride = body.customBranchName;
      }
      if (body.targetBaseBranch) {
        nextTask.nextBaseBranchOverride = body.targetBaseBranch;
      }

      // Move to dev column
      body.columnId = "dev";
      body.status = TaskStatus.IN_PROGRESS;
    }

    // Archive the active session so the queue releases the card
    archiveActiveTaskSession(nextTask);
    getKanbanSessionQueue(system).removeCardJob(taskId);
  }

  if (
    existing.columnId === "review"
    && body.columnId === undefined
    && body.status === undefined
    && body.verificationVerdict === VerificationVerdict.NOT_APPROVED
  ) {
    body.columnId = "dev";
    body.status = TaskStatus.IN_PROGRESS;
  }

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

  const boardId = body.boardId ?? existing.boardId;
  const board = boardId
    ? await system.kanbanBoardStore.get(boardId)
    : null;

  if (body.objective !== undefined && board) {
    const contractGate = resolveCurrentOrNextContractGate(board.columns, existing.columnId);
    if (contractGate) {
      const contractReadiness = buildTaskContractReadiness(nextTask, contractGate.rules);
      const contractError = buildTaskContractUpdateErrorFromRules(
        contractReadiness,
        contractGate.columnName,
        contractGate.rules,
      );
      if (contractError) {
        await recordTaskContractGateFailure(existing, system, {
          message: contractError,
          targetColumnName: contractGate.columnName,
          threshold: contractReadiness.loopBreakerThreshold,
          sessionId: existing.triggerSessionId,
        });
        return NextResponse.json(
          {
            error: contractError,
            contractReadiness,
          },
          { status: 400 },
        );
      }
    }
  }

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
  const requestedStatus = body.status !== undefined ? normalizedStatus as TaskStatus : undefined;
  if (requestedStatus !== undefined) {
    nextTask.status = requestedStatus;
  }

  if (body.columnId !== undefined && requestedStatus !== undefined) {
    const expectedStatus = columnIdToTaskStatus(body.columnId);
    const expectedColumnId = taskStatusToColumnId(requestedStatus);
    if (expectedStatus !== requestedStatus || expectedColumnId !== body.columnId) {
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

  if (body.columnId !== undefined) {
    nextTask.columnId = body.columnId;
    if (requestedStatus === undefined) {
      nextTask.status = columnIdToTaskStatus(body.columnId);
    }
  } else if (requestedStatus !== undefined) {
    nextTask.columnId = taskStatusToColumnId(requestedStatus);
  }

  // Always check review lane convergence when verification verdict is updated.
  // This must happen before transition gates so the final target lane is validated.
  if (body.verificationVerdict !== undefined || (body.columnId === undefined && body.status === undefined)) {
    const convergenceColumnId = resolveReviewLaneConvergenceTarget(nextTask, board?.columns ?? []);
    if (convergenceColumnId && convergenceColumnId !== nextTask.columnId) {
      nextTask.columnId = convergenceColumnId;
      nextTask.status = resolveTaskStatusForBoardColumn(board?.columns ?? [], convergenceColumnId);
    }
  }

  const targetColumnId = nextTask.columnId;
  const isColumnTransition = targetColumnId !== existing.columnId;

  // Check required artifacts before allowing column transition
  if (isColumnTransition && targetColumnId !== undefined) {
    const incomingVerificationVerdict = nextTask.verificationVerdict;
    const allowReviewFallbackToDev = existing.columnId === "review"
      && targetColumnId === "dev"
      && incomingVerificationVerdict === VerificationVerdict.NOT_APPROVED;
    const allowReopenOnNewBranch = body.reopenOnNewBranch === true
      && Boolean(existing.worktreeId)
      && targetColumnId === "dev";
    if (boardId && board) {
        if (existing.triggerSessionId && !allowReviewFallbackToDev && !allowReopenOnNewBranch) {
          const laneAutomationState = resolveCurrentLaneAutomationState(existing, board.columns, {
            currentSessionId: existing.triggerSessionId,
          });
          const moveBlockedMessage = buildRemainingLaneStepsMessage(existing.title, laneAutomationState);
          if (moveBlockedMessage) {
            return NextResponse.json({ error: moveBlockedMessage }, { status: 400 });
          }
        }

        const targetColumn = board.columns.find((c) => c.id === targetColumnId);

        // Skip artifact/field/contract/delivery gates for done→dev reopen
        if (!allowReopenOnNewBranch) {
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
                  error: `Cannot move task to "${targetColumn?.name ?? targetColumnId}": missing required artifacts: ${missingArtifacts.join(", ")}. Please provide these artifacts before moving the task.`,
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
                  error: `Cannot move task to "${targetColumn?.name ?? targetColumnId}": missing required task fields: ${missingTaskFields.join(", ")}. Please complete this story definition before moving the task.`,
                  missingTaskFields,
                  storyReadiness: readiness,
                },
                { status: 400 },
              );
            }
          }

          const contractReadiness = buildTaskContractReadiness(nextTask, targetColumn?.automation?.contractRules);
          const contractError = buildTaskContractTransitionErrorFromRules(
            contractReadiness,
            targetColumn?.name ?? targetColumnId,
            targetColumn?.automation?.contractRules,
          );
          if (contractError) {
            await recordTaskContractGateFailure(existing, system, {
              message: contractError,
              targetColumnName: targetColumn?.name ?? targetColumnId,
              threshold: contractReadiness.loopBreakerThreshold,
              sessionId: existing.triggerSessionId,
            });
            return NextResponse.json(
              {
                error: contractError,
                contractReadiness,
              },
              { status: 400 },
            );
          }

          // Dependency gate: block column transition if dependencies are unsatisfied
          if (nextTask.dependencies.length > 0) {
            const depCheck = await checkDependencyGate(nextTask, board.columns, system.taskStore);
            applyDependencyStatus(nextTask, depCheck);
            if (depCheck.blocked) {
              return NextResponse.json(
                {
                  error: `Cannot move task: blocked by unfinished dependencies: ${depCheck.pendingDependencies.join(", ")}`,
                  pendingDependencies: depCheck.pendingDependencies,
                },
                { status: 409 },
              );
            }
          }

          if (targetColumn?.automation?.deliveryRules) {
            const deliveryReadiness = await buildTaskDeliveryReadiness(nextTask, system);
            transitionDeliveryReadiness = deliveryReadiness;
            const deliveryError = buildTaskDeliveryTransitionErrorFromRules(
              deliveryReadiness,
              targetColumn.name ?? targetColumnId,
              targetColumn.automation.deliveryRules,
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

  if (
    isColumnTransition
    && shouldCaptureTaskDeliverySnapshotForColumn(nextTask.columnId)
    && body.reopenOnNewBranch !== true
  ) {
    transitionDeliveryReadiness ??= await buildTaskDeliveryReadiness(nextTask, system);
    nextTask.deliverySnapshot = captureTaskDeliverySnapshot(nextTask, transitionDeliveryReadiness, {
      source: nextTask.columnId === "done" ? "done_transition" : "review_transition",
    });
  }

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
  if (body.isPullRequest !== undefined) nextTask.isPullRequest = body.isPullRequest === true ? true : undefined;
  if (body.dependencies !== undefined) {
    nextTask.dependencies = body.dependencies;
    // Sync bidirectional relations + update blocked status
    await updateDependencyRelations(taskId, body.dependencies, system.taskStore);
  }
  if (body.parentTaskId !== undefined) {
    const newParentId = body.parentTaskId || undefined;
    if (newParentId) {
      const validationError = validateParentAssignment(taskId, newParentId);
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 });
      }
      const hasCycle = await detectParentCycle(taskId, newParentId, system.taskStore);
      if (hasCycle) {
        return NextResponse.json({ error: "Circular parent relationship detected." }, { status: 400 });
      }
    }
    nextTask.parentTaskId = newParentId;
  }
  if (body.parallelGroup !== undefined) nextTask.parallelGroup = body.parallelGroup;

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
  const reopenTrigger = body.reopenOnNewBranch === true && nextTask.columnId === "dev" && !nextTask.worktreeId;
  const retryProviderId = typeof body.retryProviderId === "string" && body.retryProviderId.trim().length > 0
    ? body.retryProviderId.trim()
    : undefined;

  if ((enteringDev || assignedWhileInDev || retryingTrigger || reopenTrigger) && !nextTask.triggerSessionId) {
    const worktreeTruth = await resolveTaskWorktreeTruth(nextTask, system, {
      preferredRepoPath: body.repoPath,
    });
    const preferredCodebase = worktreeTruth?.codebase;

    // Auto-create worktree when entering dev column (if no worktree yet and codebase exists)
    if ((enteringDev || reopenTrigger) && preferredCodebase && !nextTask.worktreeId) {
      const workspace = await system.workspaceStore.get(nextTask.workspaceId);
      const boardId = nextTask.boardId ?? board?.id;
      const branchRules = boardId ? getKanbanBranchRules(workspace?.metadata, boardId) : undefined;
      const result = await ensureTaskWorktree(nextTask, preferredCodebase, {
        worktreeStore: system.worktreeStore,
        codebaseStore: system.codebaseStore,
        taskStore: system.taskStore,
        workspace,
        workspaceId: nextTask.workspaceId,
        rules: branchRules,
      });
      if (!result.ok) {
        console.error("[kanban] Failed to auto-create worktree:", result.errorMessage);
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
      bypassDependencyGate: reopenTrigger,
      providerOverride: retryProviderId,
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
