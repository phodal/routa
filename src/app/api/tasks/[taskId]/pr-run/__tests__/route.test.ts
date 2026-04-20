import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, type Task } from "@/core/models/task";

const taskStore = {
  get: vi.fn<(_: string) => Promise<Task | null>>(),
};

const worktreeStore = {
  get: vi.fn<(_: string) => Promise<{ id: string; codebaseId: string; worktreePath?: string } | null>>(),
};

const codebaseStore = {
  get: vi.fn<(_: string) => Promise<{ id: string; repoPath: string; sourceType?: "local" | "github"; sourceUrl?: string } | null>>(),
};

const isGitRepository = vi.fn<(repoPath: string) => boolean>();
const isBareGitRepository = vi.fn<(repoPath: string) => boolean>();
const getRemoteUrl = vi.fn<(repoPath: string) => string | null>();
const getRepoDeliveryStatus = vi.fn();
const enqueueKanbanTaskSession = vi.fn();

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => ({
    taskStore,
    worktreeStore,
    codebaseStore,
  }),
}));

vi.mock("@/core/git", () => ({
  getRemoteUrl: (repoPath: string) => getRemoteUrl(repoPath),
  isGitRepository: (repoPath: string) => isGitRepository(repoPath),
  isBareGitRepository: (repoPath: string) => isBareGitRepository(repoPath),
  isGitHubUrl: (value: string | null | undefined) => Boolean(value && value.includes("github.com")),
  getRepoDeliveryStatus: (...args: unknown[]) => getRepoDeliveryStatus(...args),
}));

vi.mock("@/core/kanban/workflow-orchestrator-singleton", () => ({
  enqueueKanbanTaskSession: (...args: unknown[]) => enqueueKanbanTaskSession(...args),
}));

import { POST } from "../route";

describe("/api/tasks/[taskId]/pr-run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    worktreeStore.get.mockResolvedValue(null);
    isGitRepository.mockReturnValue(true);
    isBareGitRepository.mockReturnValue(false);
    getRepoDeliveryStatus.mockReturnValue({
      branch: "feature/pr",
      baseBranch: "main",
      baseRef: "origin/main",
      status: {
        clean: true,
        ahead: 0,
        behind: 0,
        modified: 0,
        untracked: 0,
      },
      commitsSinceBase: 0,
      hasCommitsSinceBase: false,
      hasUncommittedChanges: false,
      remoteUrl: "git@github.com:acme/platform.git",
      isGitHubRepo: true,
      canCreatePullRequest: false,
    });
    enqueueKanbanTaskSession.mockResolvedValue({
      sessionId: "session-pr-1",
      queued: false,
    });
  });

  it("starts a PR specialist session for a GitHub codebase", async () => {
    const task = createTask({
      id: "task-1",
      title: "Publish PR",
      objective: "Open a PR",
      workspaceId: "workspace-1",
      boardId: "board-1",
    });
    task.columnId = "done";
    task.codebaseIds = ["codebase-1"];

    taskStore.get.mockResolvedValue(task);
    codebaseStore.get.mockResolvedValue({
      id: "codebase-1",
      repoPath: "/repo",
      sourceType: "github",
      sourceUrl: "https://github.com/acme/platform",
    });
    getRemoteUrl.mockReturnValue("git@github.com:acme/platform.git");

    const response = await POST(new NextRequest("http://localhost/api/tasks/task-1/pr-run", {
      method: "POST",
      body: JSON.stringify({ specialistLocale: "zh-CN" }),
    }), {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(expect.objectContaining({
      sessionId: "session-pr-1",
      platform: "github",
    }));
    expect(enqueueKanbanTaskSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      task,
      ignoreExistingTrigger: true,
      bypassQueue: true,
      step: expect.objectContaining({
        specialistId: "kanban-pr-publisher",
        specialistLocale: "zh-CN",
      }),
    }));
  });

  it("rejects unsupported repository hosts", async () => {
    const task = createTask({
      id: "task-2",
      title: "Publish PR",
      objective: "Open a PR",
      workspaceId: "workspace-1",
      boardId: "board-1",
    });
    task.codebaseIds = ["codebase-2"];

    taskStore.get.mockResolvedValue(task);
    codebaseStore.get.mockResolvedValue({
      id: "codebase-2",
      repoPath: "/repo",
      sourceType: "local",
      sourceUrl: "https://example.com/acme/platform",
    });
    getRemoteUrl.mockReturnValue("git@example.com:acme/platform.git");

    const response = await POST(new NextRequest("http://localhost/api/tasks/task-2/pr-run", {
      method: "POST",
    }), {
      params: Promise.resolve({ taskId: "task-2" }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      error: "PR session is only available for GitHub or GitLab repositories.",
    });
    expect(enqueueKanbanTaskSession).not.toHaveBeenCalled();
  });
});
