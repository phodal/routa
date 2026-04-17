/**
 * ensureTaskWorktree — pure executor that creates a worktree for a kanban task.
 *
 * All branch decisions are made by resolveBranchPlan() in branch-plan.ts.
 * This module only executes the plan: creates the worktree, handles collisions,
 * consumes overrides, and updates task state.
 *
 * Responsibilities (execution only, no decision-making):
 *  1. Resolve BranchPlan via the branch resolution engine
 *  2. Resolve dependency base branch (async, merged into plan)
 *  3. Create worktree via GitWorktreeService
 *  4. Retry with collision suffix on branch-name collision
 *  5. Clear ephemeral override fields on the task after consumption
 *  6. Mark the task as BLOCKED on unrecoverable failure
 */

import type { Task } from "../models/task";
import { TaskStatus } from "../models/task";
import type { Codebase } from "../models/codebase";
import type { WorktreeStore } from "../db/pg-worktree-store";
import type { CodebaseStore } from "../db/pg-codebase-store";
import type { TaskStore } from "../store/task-store";
import { GitWorktreeService } from "../git/git-worktree-service";
import { getDefaultWorkspaceWorktreeRoot, getEffectiveWorkspaceMetadata } from "../models/workspace";
import type { Workspace } from "../models/workspace";
import type { KanbanBranchRules } from "./board-branch-rules";
import { DEFAULT_BRANCH_RULES } from "./board-branch-rules";
import {
  resolveBranchPlan,
  resolveDependencyBaseBranch,
  generateCollisionSuffix,
} from "./branch-plan";

export interface EnsureTaskWorktreeDeps {
  worktreeStore: WorktreeStore;
  codebaseStore: CodebaseStore;
  taskStore: TaskStore;
  workspace?: Workspace | null;
  workspaceId: string;
  /** Branch rules from board config (falls back to defaults) */
  rules?: KanbanBranchRules;
}

export interface EnsureTaskWorktreeResult {
  ok: true;
  worktreeId: string;
}

export interface EnsureTaskWorktreeError {
  ok: false;
  errorMessage: string;
}

export type EnsureTaskWorktreeOutcome =
  | EnsureTaskWorktreeResult
  | EnsureTaskWorktreeError;

/**
 * Create a worktree for a task, consuming any ephemeral overrides.
 *
 * All branch decisions come from resolveBranchPlan() + rules.
 * On success the task's worktreeId is set and override fields are cleared.
 * On failure the task is marked BLOCKED and lastSyncError is set.
 */
export async function ensureTaskWorktree(
  task: Task,
  preferredCodebase: Codebase,
  deps: EnsureTaskWorktreeDeps,
): Promise<EnsureTaskWorktreeOutcome> {
  const worktreeService = new GitWorktreeService(
    deps.worktreeStore,
    deps.codebaseStore,
  );

  const rules = deps.rules ?? DEFAULT_BRANCH_RULES;

  // 1. Resolve the complete branch plan from the engine
  const plan = resolveBranchPlan({
    task,
    codebase: preferredCodebase,
    rules,
    targetColumnId: task.columnId,
    branchOverride: task.nextBranchOverride || undefined,
    baseBranchOverride: task.nextBaseBranchOverride || undefined,
  });

  // 2. Merge dependency-aware base branch (async)
  let effectiveBaseBranch = plan.baseBranch;
  if (rules.baseBranch.strategy === "dependency_inherit") {
    const dependencyBase = await resolveDependencyBaseBranch(task, {
      taskStore: deps.taskStore,
      worktreeStore: deps.worktreeStore,
    });
    // User override > dependency > codebase/system fallback
    if (dependencyBase && !task.nextBaseBranchOverride) {
      effectiveBaseBranch = dependencyBase;
    }
  }

  // 3. Resolve worktree root
  const worktreeRoot = deps.workspace
    ? getEffectiveWorkspaceMetadata(deps.workspace).worktreeRoot
    : getDefaultWorkspaceWorktreeRoot(deps.workspaceId);

  // 4. Attempt creation
  try {
    const worktree = await worktreeService.createWorktree(preferredCodebase.id, {
      branch: plan.branch,
      baseBranch: effectiveBaseBranch,
      label: plan.label,
      worktreeRoot,
    });
    task.worktreeId = worktree.id;
    clearOverrides(task);
    return { ok: true, worktreeId: worktree.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // 5. Retry with collision suffix on branch-name collision
    if (message.includes("already in use")) {
      try {
        const suffix = generateCollisionSuffix(plan.collisionStrategy);
        const retryBranch = `${plan.branch}${suffix}`;

        const worktree = await worktreeService.createWorktree(
          preferredCodebase.id,
          {
            branch: retryBranch,
            baseBranch: effectiveBaseBranch,
            label: plan.label,
            worktreeRoot,
          },
        );
        task.worktreeId = worktree.id;
        clearOverrides(task);
        return { ok: true, worktreeId: worktree.id };
      } catch (retryError) {
        const retryMsg =
          retryError instanceof Error ? retryError.message : String(retryError);
        markBlocked(task, `Worktree creation failed after retry: ${retryMsg}`);
        clearOverrides(task);
        return { ok: false, errorMessage: task.lastSyncError! };
      }
    }

    // 6. Unrecoverable failure
    markBlocked(task, `Worktree creation failed: ${message}`);
    clearOverrides(task);
    return { ok: false, errorMessage: task.lastSyncError! };
  }
}

function clearOverrides(task: Task): void {
  task.nextBranchOverride = undefined;
  task.nextBaseBranchOverride = undefined;
}

function markBlocked(task: Task, message: string): void {
  task.status = TaskStatus.BLOCKED;
  task.columnId = "blocked";
  task.lastSyncError = message;
}
