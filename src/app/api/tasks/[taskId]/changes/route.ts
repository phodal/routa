import { NextRequest, NextResponse } from "next/server";
import { monitorApiRoute } from "@/core/http/api-route-observability";
import { getRoutaSystem } from "@/core/routa-system";
import {
  getRepoChanges,
  getRemoteUrl,
  isBareGitRepository,
  isGitRepository,
} from "@/core/git/git-utils";
import { buildTaskDeliveryReadiness } from "@/core/kanban/task-delivery-readiness";
import { getRepoCommitChanges } from "@/core/git";

export const dynamic = "force-dynamic";

function repoLabelFromPath(repoPath: string): string {
  return repoPath.split("/").filter(Boolean).pop() ?? repoPath;
}

/**
 * GET /api/tasks/[taskId]/changes
 *
 * Returns repository changes for a task.
 * Performance optimizations:
 * - Batch git diff for all files (1 command instead of N)
 * - Global limit of 500 files with detailed stats
 * - 5-second LRU cache
 *
 * For very large changesets, use /api/tasks/[taskId]/changes/stats
 * to lazy-load stats for specific files only.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  return monitorApiRoute(request, "GET /api/tasks/[taskId]/changes", () =>
    getTaskChanges(request, { params })
  );
}

async function getTaskChanges(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const system = getRoutaSystem();
  const task = await system.taskStore.get(taskId);

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const worktree = task.worktreeId
    ? await system.worktreeStore.get(task.worktreeId)
    : null;
  const codebaseId = worktree?.codebaseId ?? task.codebaseIds?.[0] ?? "";
  const codebase = codebaseId ? await system.codebaseStore.get(codebaseId) : null;
  const repoPath = worktree?.worktreePath ?? codebase?.repoPath ?? task.deliverySnapshot?.repoPath ?? "";
  const label = codebase?.label ?? repoLabelFromPath(repoPath || "repo");

  if (!repoPath) {
    return NextResponse.json({
      changes: {
        codebaseId,
        repoPath: task.deliverySnapshot?.repoPath ?? "",
        label,
        branch: codebase?.branch ?? "unknown",
        status: {
          clean: true,
          ahead: 0,
          behind: 0,
          modified: 0,
          untracked: 0,
        },
        files: [],
        mode: (task.deliverySnapshot?.commits.length ?? 0) > 0 ? "commits" : "worktree",
        baseRef: task.deliverySnapshot?.baseRef,
        commits: task.deliverySnapshot?.commits ?? [],
        source: worktree ? "worktree" : "repo",
        worktreeId: worktree?.id,
        worktreePath: worktree?.worktreePath,
        error: task.deliverySnapshot
          ? undefined
          : "No repository or worktree linked to this task",
      },
    });
  }

  try {
    if (!isGitRepository(repoPath)) {
      throw new Error("Repository is missing or not a git repository");
    }
    if (!worktree && isBareGitRepository(repoPath)) {
      throw new Error("This task's codebase points to a bare git repository (no working directory). Move the task to 'Dev' to create a worktree, or use a regular clone as the codebase.");
    }

    const changes = getRepoChanges(repoPath);
    const remoteUrl = getRemoteUrl(repoPath);
    const deliveryReadiness = await buildTaskDeliveryReadiness(task, system);
    const liveCommittedChanges = deliveryReadiness.checked
      && deliveryReadiness.hasCommitsSinceBase
      && deliveryReadiness.baseRef
      ? getRepoCommitChanges(repoPath, {
        baseRef: deliveryReadiness.baseRef,
        maxCount: Math.max(deliveryReadiness.commitsSinceBase, 1),
      })
      : [];
    const committedChanges = liveCommittedChanges.length > 0
      ? liveCommittedChanges
      : task.deliverySnapshot?.commits ?? [];
    const baseRef = liveCommittedChanges.length > 0
      ? deliveryReadiness.baseRef
      : task.deliverySnapshot?.baseRef ?? deliveryReadiness.baseRef;

    return NextResponse.json({
      changes: {
        codebaseId,
        repoPath,
        label,
        branch: changes.branch,
        status: changes.status,
        files: changes.files,
        mode: committedChanges.length > 0 ? "commits" : "worktree",
        baseRef,
        remoteUrl,
        commits: committedChanges,
        source: worktree ? "worktree" : "repo",
        worktreeId: worktree?.id,
        worktreePath: worktree?.worktreePath,
      },
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({
      changes: {
        codebaseId,
        repoPath,
        label,
        branch: codebase?.branch ?? "unknown",
        status: {
          clean: true,
          ahead: 0,
          behind: 0,
          modified: 0,
          untracked: 0,
        },
        files: [],
        mode: (task.deliverySnapshot?.commits.length ?? 0) > 0 ? "commits" : "worktree",
        baseRef: task.deliverySnapshot?.baseRef,
        commits: task.deliverySnapshot?.commits ?? [],
        source: worktree ? "worktree" : "repo",
        worktreeId: worktree?.id,
        worktreePath: worktree?.worktreePath,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
