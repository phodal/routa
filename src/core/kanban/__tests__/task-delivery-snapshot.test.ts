import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask } from "@/core/models/task";
import { captureTaskDeliverySnapshot } from "../task-delivery-snapshot";

const getRepoCommitChanges = vi.fn();
const getRepoRefSha = vi.fn();

vi.mock("@/core/git/git-utils", () => ({
  getRepoCommitChanges: (...args: unknown[]) => getRepoCommitChanges(...args),
  getRepoRefSha: (...args: unknown[]) => getRepoRefSha(...args),
}));

describe("task delivery snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRepoRefSha.mockImplementation((_repoPath: string, ref: string) => {
      if (ref === "origin/main") return "base-sha";
      if (ref === "HEAD") return "head-sha";
      return null;
    });
    getRepoCommitChanges.mockReturnValue([{
      sha: "head-sha",
      shortSha: "head123",
      summary: "implement delivery snapshot",
      authorName: "Routa",
      authoredAt: "2026-04-09T00:00:00.000Z",
      additions: 12,
      deletions: 3,
    }]);
  });

  it("captures immutable commit evidence from the current delivery range", () => {
    const task = createTask({
      id: "task-1",
      title: "Ship diff evidence",
      objective: "Keep task diff available after merge",
      workspaceId: "workspace-1",
      worktreeId: "worktree-1",
    });

    const snapshot = captureTaskDeliverySnapshot(task, {
      checked: true,
      repoPath: "/repo/worktrees/task-1",
      branch: "issue/task-1",
      baseBranch: "main",
      baseRef: "origin/main",
      modified: 0,
      untracked: 0,
      ahead: 1,
      behind: 0,
      commitsSinceBase: 1,
      hasCommitsSinceBase: true,
      hasUncommittedChanges: false,
      isGitHubRepo: true,
      canCreatePullRequest: true,
    }, {
      source: "review_transition",
      capturedAt: new Date("2026-04-09T01:02:03.000Z"),
    });

    expect(snapshot).toMatchObject({
      capturedAt: "2026-04-09T01:02:03.000Z",
      repoPath: "/repo/worktrees/task-1",
      worktreeId: "worktree-1",
      branch: "issue/task-1",
      baseRef: "origin/main",
      baseSha: "base-sha",
      headSha: "head-sha",
      source: "review_transition",
      commits: [{
        sha: "head-sha",
        summary: "implement delivery snapshot",
      }],
    });
    expect(getRepoCommitChanges).toHaveBeenCalledWith("/repo/worktrees/task-1", {
      baseRef: "origin/main",
      maxCount: 1,
    });
  });

  it("keeps the previous snapshot when the live range is no longer deliverable", () => {
    const task = createTask({
      id: "task-2",
      title: "Merged task",
      objective: "Already captured",
      workspaceId: "workspace-1",
    });
    const previous = {
      capturedAt: "2026-04-09T01:02:03.000Z",
      repoPath: "/repo/worktrees/task-2",
      baseRef: "origin/main",
      baseSha: "base-sha",
      headSha: "head-sha",
      commits: [],
      source: "review_transition" as const,
    };
    task.deliverySnapshot = previous;

    const snapshot = captureTaskDeliverySnapshot(task, {
      checked: true,
      repoPath: "/repo/worktrees/task-2",
      branch: "main",
      baseBranch: "main",
      baseRef: "origin/main",
      modified: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
      commitsSinceBase: 0,
      hasCommitsSinceBase: false,
      hasUncommittedChanges: false,
      isGitHubRepo: true,
      canCreatePullRequest: false,
    }, {
      source: "done_transition",
    });

    expect(snapshot).toBe(previous);
    expect(getRepoCommitChanges).not.toHaveBeenCalled();
  });
});
