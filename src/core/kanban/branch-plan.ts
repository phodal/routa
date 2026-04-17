/**
 * Branch Resolution Engine
 *
 * THE single authority for all branch decisions.
 * Every consumer (ensureTaskWorktree, route.ts, pr-merge-listener, etc.)
 * calls resolveBranchPlan() and receives a complete, ready-to-execute plan.
 *
 * Consumers never make independent branch decisions.
 */

import type { Task } from "../models/task";
import type { Codebase } from "../models/codebase";
import type { KanbanBranchRules } from "./board-branch-rules";
import { GIT_DEFAULT_BRANCH } from "../git/git-defaults";
import type { WorktreeStore } from "../db/pg-worktree-store";
import type { TaskStore } from "../store/task-store";

// ─── Plan (output) ──────────────────────────────────────────────────

export interface BranchPlan {
  /** The git branch name to create/use */
  branch: string;
  /** The base branch to branch off from */
  baseBranch: string;
  /** Human-readable label for display */
  label: string;
  /** Whether a worktree should be auto-created */
  shouldCreateWorktree: boolean;
  /** How to handle name collisions */
  collisionStrategy: "timestamp_suffix" | "increment" | "fail";
  /** Whether to delete branch after PR merge */
  deleteBranchOnMerge: boolean;
  /** Whether to remove worktree after PR merge */
  removeWorktreeOnMerge: boolean;
  /** Whether to rebase downstream worktrees after PR merge */
  rebaseDownstream: boolean;
}

// ─── Context (input) ────────────────────────────────────────────────

export interface BranchResolutionContext {
  /** The task being processed */
  task: Task;
  /** The preferred codebase for this task */
  codebase: Codebase;
  /** Branch rules from board config */
  rules: KanbanBranchRules;
  /** Current column ID the task is in / entering */
  targetColumnId?: string;
  /** Optional branch name override (from user input) */
  branchOverride?: string;
  /** Optional base branch override (from user input) */
  baseBranchOverride?: string;
}

// ─── Engine ─────────────────────────────────────────────────────────

/**
 * Resolve a complete branch plan from context + rules.
 *
 * This is the ONLY function that should make branch decisions.
 * All consumers receive the plan and execute it verbatim.
 */
export function resolveBranchPlan(context: BranchResolutionContext): BranchPlan {
  const { task, codebase, rules, branchOverride, baseBranchOverride } = context;

  // 1. Branch name
  const branch = resolveBranchName(task, rules, branchOverride);

  // 2. Base branch (user override > rules strategy > codebase default > system default)
  const baseBranch = resolveBaseBranch(task, codebase, rules, baseBranchOverride);

  // 3. Display label
  const label = branchOverride ?? deriveLabel(task);

  // 4. Worktree creation trigger
  const shouldCreateWorktree = resolveShouldCreateWorktree(context);

  return {
    branch,
    baseBranch,
    label,
    shouldCreateWorktree,
    collisionStrategy: rules.collisionStrategy,
    deleteBranchOnMerge: rules.lifecycle.deleteBranchOnMerge,
    removeWorktreeOnMerge: rules.lifecycle.removeWorktreeOnMerge,
    rebaseDownstream: rules.lifecycle.rebaseDownstream,
  };
}

// ─── Internal resolvers ─────────────────────────────────────────────

function resolveBranchName(
  task: Task,
  rules: KanbanBranchRules,
  override?: string,
): string {
  // User override takes absolute precedence
  if (override?.trim()) return override.trim();

  const shortTaskId = task.id.trim().slice(0, 8) || "task";
  const { prefix, template, customTemplate } = rules.naming;

  switch (template) {
    case "slug_id": {
      const slug = deriveSlug(task.title);
      if (slug.length >= 3) {
        return `${prefix}/${slug}-${shortTaskId}`;
      }
      // Fallback to id_only when no valid slug
      return `${prefix}/${task.id.trim().slice(0, 12) || shortTaskId}`;
    }

    case "id_only":
      return `${prefix}/${shortTaskId}`;

    case "custom": {
      const tmpl = customTemplate ?? "{prefix}/{slug}-{shortId}";
      return tmpl
        .replace("{prefix}", prefix)
        .replace("{slug}", deriveSlug(task.title))
        .replace("{shortId}", shortTaskId)
        .replace("{column}", task.columnId ?? "dev");
    }

    default:
      return `${prefix}/${shortTaskId}`;
  }
}

function resolveBaseBranch(
  task: Task,
  codebase: Codebase,
  rules: KanbanBranchRules,
  override?: string,
): string {
  // User override takes absolute precedence
  if (override?.trim()) return override.trim();

  switch (rules.baseBranch.strategy) {
    case "fixed":
      return rules.baseBranch.fixedBranch?.trim() || codebase.branch || GIT_DEFAULT_BRANCH;

    case "codebase_default":
      return codebase.branch || GIT_DEFAULT_BRANCH;

    case "dependency_inherit":
      // Dependency resolution requires async I/O — handled by resolveDependencyBaseBranch().
      // This synchronous function returns the non-dependency fallback.
      // The caller (ensureTaskWorktree) merges dependency result with this.
      return codebase.branch || GIT_DEFAULT_BRANCH;

    default:
      return codebase.branch || GIT_DEFAULT_BRANCH;
  }
}

function resolveShouldCreateWorktree(context: BranchResolutionContext): boolean {
  const { task, rules, targetColumnId } = context;
  const columnId = targetColumnId ?? task.columnId;

  // Already has a worktree — no auto-creation needed
  if (task.worktreeId) return false;

  // Check if the column triggers worktree creation
  return rules.triggers.worktreeCreationColumns.includes(columnId ?? "");
}

function deriveSlug(title?: string): string {
  if (!title?.trim()) return "";
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function deriveLabel(task: Task): string {
  const slug = deriveSlug(task.title);
  return slug.length >= 3 ? slug : task.id.trim().slice(0, 8) || "task";
}

// ─── Async dependency resolver ──────────────────────────────────────

/**
 * Resolve a base branch from the task's declared dependencies.
 *
 * Only used when rules.baseBranch.strategy === "dependency_inherit".
 * Returns undefined if no eligible dependency found (caller falls back
 * to the synchronous base branch from resolveBranchPlan).
 *
 * Safeguards:
 *  - Circular dependencies: visited set prevents infinite loops.
 *  - Already-merged deps: skipped (their code is already on base).
 */
export async function resolveDependencyBaseBranch(
  task: Task,
  deps: {
    taskStore: TaskStore;
    worktreeStore: WorktreeStore;
  },
  visited?: Set<string>,
): Promise<string | undefined> {
  // Parent task takes priority: if this task has a parent with a worktree branch, use it
  if (task.parentTaskId) {
    const parentTask = await deps.taskStore.get(task.parentTaskId);
    if (parentTask?.worktreeId) {
      const parentWorktree = await deps.worktreeStore.get(parentTask.worktreeId);
      if (parentWorktree?.branch) {
        return parentWorktree.branch;
      }
    }
  }

  if (!task.dependencies || task.dependencies.length === 0) {
    return undefined;
  }

  const seen = visited ?? new Set<string>();
  seen.add(task.id);

  for (const depId of task.dependencies) {
    if (seen.has(depId)) {
      console.warn(
        `[BranchPlan] Circular dependency: ${task.id} → ${depId}. Skipping.`,
      );
      continue;
    }

    const depTask = await deps.taskStore.get(depId);
    if (!depTask) continue;

    // Merged PRs are on main already — skip
    if (depTask.pullRequestMergedAt) continue;

    // If dependency has a worktree with a branch, use it
    if (depTask.worktreeId) {
      const depWorktree = await deps.worktreeStore.get(depTask.worktreeId);
      if (depWorktree?.branch) {
        return depWorktree.branch;
      }
    }

    // Recurse: follow transitive dependency chains
    seen.add(depId);
    const transitive = await resolveDependencyBaseBranch(depTask, deps, seen);
    if (transitive) return transitive;
  }

  return undefined;
}

// ─── Collision suffix generator ─────────────────────────────────────

/**
 * Generate a collision-safe branch name based on the configured strategy.
 */
export function generateCollisionSuffix(strategy: "timestamp_suffix" | "increment" | "fail"): string | never {
  switch (strategy) {
    case "timestamp_suffix":
      return `-${Date.now().toString(36)}`;
    case "increment":
      // Simple increment suffix — caller should check and increment as needed
      return "-2";
    case "fail":
      throw new Error("Branch name collision and collisionStrategy is 'fail'");
  }
}
