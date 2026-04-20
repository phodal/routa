import { getRepoCommitChanges, getRepoRefSha } from "@/core/git/git-utils";
import type { Task, TaskDeliverySnapshot } from "@/core/models/task";
import type { TaskDeliveryReadiness } from "./task-delivery-readiness";

export type TaskDeliverySnapshotSource =
  | "review_transition"
  | "done_transition"
  | "pr_run"
  | "manual";

export function shouldCaptureTaskDeliverySnapshotForColumn(columnId: string | undefined): boolean {
  return columnId === "review" || columnId === "done";
}

export function captureTaskDeliverySnapshot(
  task: Task,
  readiness: TaskDeliveryReadiness,
  params: { source: TaskDeliverySnapshotSource; capturedAt?: Date },
): TaskDeliverySnapshot | undefined {
  const repoPath = readiness.repoPath;
  const baseRef = readiness.baseRef;
  if (!readiness.checked || !repoPath || !baseRef || readiness.commitsSinceBase <= 0) {
    return task.deliverySnapshot;
  }

  const baseSha = getRepoRefSha(repoPath, baseRef);
  const headSha = getRepoRefSha(repoPath, "HEAD");
  if (!baseSha || !headSha || baseSha === headSha) {
    return task.deliverySnapshot;
  }

  const commits = getRepoCommitChanges(repoPath, {
    baseRef,
    maxCount: Math.max(readiness.commitsSinceBase, 1),
  });
  if (commits.length === 0) {
    return task.deliverySnapshot;
  }

  return {
    capturedAt: (params.capturedAt ?? new Date()).toISOString(),
    repoPath,
    worktreeId: task.worktreeId,
    branch: readiness.branch,
    baseBranch: readiness.baseBranch,
    baseRef,
    baseSha,
    headSha,
    commits,
    source: params.source,
  };
}
