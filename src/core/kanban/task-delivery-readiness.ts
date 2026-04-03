import { getRepoDeliveryStatus, isGitRepository, type RepoDeliveryStatus } from "@/core/git";
import type { Codebase } from "@/core/models/codebase";
import type { Task } from "@/core/models/task";
import type { Worktree } from "@/core/models/worktree";

interface DeliverySystemLike {
  codebaseStore: {
    get(codebaseId: string): Promise<Codebase | undefined>;
    getDefault(workspaceId: string): Promise<Codebase | undefined>;
  };
  worktreeStore: {
    get(worktreeId: string): Promise<Worktree | undefined>;
  };
}

export interface TaskDeliveryReadiness {
  checked: boolean;
  repoPath?: string;
  branch?: string;
  baseBranch?: string;
  baseRef?: string;
  modified: number;
  untracked: number;
  ahead: number;
  behind: number;
  commitsSinceBase: number;
  hasCommitsSinceBase: boolean;
  hasUncommittedChanges: boolean;
  isGitHubRepo: boolean;
  canCreatePullRequest: boolean;
  reason?: string;
}

interface TaskRepoContext {
  repoPath: string;
  baseBranch?: string;
  codebase?: Codebase;
}

async function resolveTaskRepoContext(
  task: Task,
  system: DeliverySystemLike,
): Promise<TaskRepoContext | null> {
  if (task.worktreeId) {
    const worktree = await system.worktreeStore.get(task.worktreeId);
    if (worktree?.worktreePath) {
      const codebase = await system.codebaseStore.get(worktree.codebaseId);
      return {
        repoPath: worktree.worktreePath,
        baseBranch: worktree.baseBranch || codebase?.branch,
        codebase,
      };
    }
  }

  const primaryCodebaseId = task.codebaseIds[0];
  const codebase = primaryCodebaseId
    ? await system.codebaseStore.get(primaryCodebaseId)
    : await system.codebaseStore.getDefault(task.workspaceId);
  if (!codebase?.repoPath) {
    return null;
  }

  return {
    repoPath: codebase.repoPath,
    baseBranch: codebase.branch,
    codebase,
  };
}

function mapReadiness(
  context: TaskRepoContext,
  deliveryStatus: RepoDeliveryStatus,
): TaskDeliveryReadiness {
  return {
    checked: true,
    repoPath: context.repoPath,
    branch: deliveryStatus.branch,
    baseBranch: deliveryStatus.baseBranch,
    baseRef: deliveryStatus.baseRef,
    modified: deliveryStatus.status.modified,
    untracked: deliveryStatus.status.untracked,
    ahead: deliveryStatus.status.ahead,
    behind: deliveryStatus.status.behind,
    commitsSinceBase: deliveryStatus.commitsSinceBase,
    hasCommitsSinceBase: deliveryStatus.hasCommitsSinceBase,
    hasUncommittedChanges: deliveryStatus.hasUncommittedChanges,
    isGitHubRepo: deliveryStatus.isGitHubRepo,
    canCreatePullRequest: deliveryStatus.canCreatePullRequest,
  };
}

export async function buildTaskDeliveryReadiness(
  task: Task,
  system: DeliverySystemLike,
): Promise<TaskDeliveryReadiness> {
  const context = await resolveTaskRepoContext(task, system);
  if (!context) {
    return {
      checked: false,
      modified: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
      commitsSinceBase: 0,
      hasCommitsSinceBase: false,
      hasUncommittedChanges: false,
      isGitHubRepo: false,
      canCreatePullRequest: false,
      reason: "Task has no linked repository or worktree.",
    };
  }

  if (!isGitRepository(context.repoPath)) {
    return {
      checked: false,
      repoPath: context.repoPath,
      modified: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
      commitsSinceBase: 0,
      hasCommitsSinceBase: false,
      hasUncommittedChanges: false,
      isGitHubRepo: false,
      canCreatePullRequest: false,
      reason: "Linked repository is missing or is not a git repository.",
    };
  }

  return mapReadiness(
    context,
    getRepoDeliveryStatus(context.repoPath, {
      baseBranch: context.baseBranch,
      sourceType: context.codebase?.sourceType,
      sourceUrl: context.codebase?.sourceUrl,
    }),
  );
}

function formatBaseReference(readiness: TaskDeliveryReadiness): string {
  return readiness.baseRef ?? readiness.baseBranch ?? "the base branch";
}

export function buildTaskDeliveryTransitionError(
  readiness: TaskDeliveryReadiness,
  targetColumnName: string,
  targetColumnId: string,
): string | null {
  if (!readiness.checked) {
    if (!readiness.reason || readiness.reason === "Task has no linked repository or worktree.") {
      return null;
    }

    return `Cannot move task to "${targetColumnName}": ${readiness.reason}`;
  }

  if (!readiness.hasCommitsSinceBase) {
    return `Cannot move task to "${targetColumnName}": no committed changes detected on branch "${readiness.branch ?? "unknown"}" relative to "${formatBaseReference(readiness)}". Commit your implementation before requesting review.`;
  }

  if (targetColumnId !== "done") {
    return null;
  }

  if (readiness.hasUncommittedChanges) {
    return `Cannot move task to "${targetColumnName}": branch "${readiness.branch ?? "unknown"}" still has uncommitted changes (${readiness.modified} modified, ${readiness.untracked} untracked). Commit, stash, or discard them before marking the task done.`;
  }

  if (readiness.isGitHubRepo && !readiness.canCreatePullRequest) {
    const baseBranch = readiness.baseBranch ?? "the base branch";
    return `Cannot move task to "${targetColumnName}": GitHub repo is not PR-ready yet. Use a feature branch instead of "${baseBranch}" so this task can open a pull request cleanly.`;
  }

  return null;
}
