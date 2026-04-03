import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask } from "@/core/models/task";
import {
  buildTaskDeliveryReadiness,
  buildTaskDeliveryTransitionError,
} from "../task-delivery-readiness";

const isGitRepository = vi.fn();
const getRepoDeliveryStatus = vi.fn();

vi.mock("@/core/git", () => ({
  isGitRepository: (...args: unknown[]) => isGitRepository(...args),
  getRepoDeliveryStatus: (...args: unknown[]) => getRepoDeliveryStatus(...args),
}));

describe("task delivery readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unchecked when no codebase or worktree is linked", async () => {
    const task = createTask({
      id: "task-1",
      title: "No repo",
      objective: "Nothing linked yet",
      workspaceId: "workspace-1",
    });
    const system = {
      codebaseStore: {
        get: vi.fn(),
        getDefault: vi.fn().mockResolvedValue(undefined),
      },
      worktreeStore: {
        get: vi.fn(),
      },
    };

    const readiness = await buildTaskDeliveryReadiness(task, system);

    expect(readiness.checked).toBe(false);
    expect(readiness.reason).toContain("no linked repository");
    expect(isGitRepository).not.toHaveBeenCalled();
  });

  it("uses the task worktree as the delivery source and marks GitHub branches as PR-ready", async () => {
    const task = createTask({
      id: "task-1",
      title: "Feature branch ready",
      objective: "Ready to ship",
      workspaceId: "workspace-1",
      worktreeId: "wt-1",
      codebaseIds: ["codebase-1"],
    });
    const system = {
      codebaseStore: {
        get: vi.fn().mockResolvedValue({
          id: "codebase-1",
          repoPath: "/repo/main",
          branch: "main",
          sourceType: "github",
          sourceUrl: "https://github.com/acme/platform",
        }),
        getDefault: vi.fn(),
      },
      worktreeStore: {
        get: vi.fn().mockResolvedValue({
          id: "wt-1",
          codebaseId: "codebase-1",
          workspaceId: "workspace-1",
          worktreePath: "/repo/worktrees/task-1",
          branch: "issue/task-1",
          baseBranch: "main",
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
    };
    isGitRepository.mockReturnValue(true);
    getRepoDeliveryStatus.mockReturnValue({
      branch: "issue/task-1",
      baseBranch: "main",
      baseRef: "origin/main",
      status: {
        clean: true,
        ahead: 1,
        behind: 0,
        modified: 0,
        untracked: 0,
      },
      commitsSinceBase: 1,
      hasCommitsSinceBase: true,
      hasUncommittedChanges: false,
      remoteUrl: "git@github.com:acme/platform.git",
      isGitHubRepo: true,
      canCreatePullRequest: true,
    });

    const readiness = await buildTaskDeliveryReadiness(task, system);

    expect(isGitRepository).toHaveBeenCalledWith("/repo/worktrees/task-1");
    expect(getRepoDeliveryStatus).toHaveBeenCalledWith("/repo/worktrees/task-1", {
      baseBranch: "main",
      sourceType: "github",
      sourceUrl: "https://github.com/acme/platform",
    });
    expect(readiness).toMatchObject({
      checked: true,
      repoPath: "/repo/worktrees/task-1",
      branch: "issue/task-1",
      commitsSinceBase: 1,
      canCreatePullRequest: true,
    });
  });

  it("formats blocking messages for review and done transitions", () => {
    const reviewError = buildTaskDeliveryTransitionError({
      checked: true,
      branch: "issue/task-1",
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
    }, "Review", "review");
    const doneError = buildTaskDeliveryTransitionError({
      checked: true,
      branch: "issue/task-1",
      baseBranch: "main",
      baseRef: "origin/main",
      modified: 2,
      untracked: 1,
      ahead: 1,
      behind: 0,
      commitsSinceBase: 1,
      hasCommitsSinceBase: true,
      hasUncommittedChanges: true,
      isGitHubRepo: true,
      canCreatePullRequest: false,
    }, "Done", "done");

    expect(reviewError).toContain("no committed changes detected");
    expect(doneError).toContain("uncommitted changes");
  });
});
