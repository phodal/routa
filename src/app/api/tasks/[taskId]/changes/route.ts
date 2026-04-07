import { NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { getRepoChanges, isGitRepository } from "@/core/git/git-utils";
import { buildTaskDeliveryReadiness } from "@/core/kanban/task-delivery-readiness";
import { getRepoCommitChanges } from "@/core/git";

export const dynamic = "force-dynamic";

function repoLabelFromPath(repoPath: string): string {
  return repoPath.split("/").filter(Boolean).pop() ?? repoPath;
}

export async function GET(
  _request: Request,
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
  const repoPath = worktree?.worktreePath ?? codebase?.repoPath ?? "";
  const label = codebase?.label ?? repoLabelFromPath(repoPath || "repo");

  if (!repoPath) {
    return NextResponse.json({
      changes: {
        codebaseId,
        repoPath: "",
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
        source: worktree ? "worktree" : "repo",
        worktreeId: worktree?.id,
        worktreePath: worktree?.worktreePath,
        error: "No repository or worktree linked to this task",
      },
    });
  }

  try {
    if (!isGitRepository(repoPath)) {
      throw new Error("Repository is missing or not a git repository");
    }

    const changes = getRepoChanges(repoPath);
    const deliveryReadiness = await buildTaskDeliveryReadiness(task, system);
    const committedChanges = deliveryReadiness.checked
      && deliveryReadiness.hasCommitsSinceBase
      && deliveryReadiness.baseRef
      ? getRepoCommitChanges(repoPath, {
        baseRef: deliveryReadiness.baseRef,
        maxCount: Math.max(deliveryReadiness.commitsSinceBase, 1),
      })
      : [];

    return NextResponse.json({
      changes: {
        codebaseId,
        repoPath,
        label,
        branch: changes.branch,
        status: changes.status,
        files: changes.files,
        mode: committedChanges.length > 0 ? "commits" : "worktree",
        baseRef: deliveryReadiness.baseRef,
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
        source: worktree ? "worktree" : "repo",
        worktreeId: worktree?.id,
        worktreePath: worktree?.worktreePath,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
