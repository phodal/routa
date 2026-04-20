import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createArtifact } from "@/core/models/artifact";
import { createTask, TaskStatus, type Task } from "@/core/models/task";
import { InMemoryArtifactStore } from "@/core/store/artifact-store";

const notify = vi.fn();
const processKanbanColumnTransition = vi.fn();
const emitColumnTransition = vi.fn();
const createGitHubIssue = vi.fn();
const buildTaskGitHubIssueBody = vi.fn<(objective: string, testCases?: string[]) => string>(
  (objective: string) => objective,
);
const resolveGitHubRepo = vi.fn((sourceUrl?: string, repoPath?: string) => {
  if (!sourceUrl?.includes("github.com") && repoPath !== "/repos/acme/platform") {
    return undefined;
  }

  return "acme/platform";
});

const taskStore = {
  listByWorkspace: vi.fn<(_: string) => Promise<Task[]>>(),
  listByAssignee: vi.fn<(_: string) => Promise<Task[]>>(),
  listByStatus: vi.fn<(_: string, __: TaskStatus) => Promise<Task[]>>(),
  deleteByWorkspace: vi.fn<(_: string) => Promise<number>>(),
  get: vi.fn<(_: string) => Promise<Task | undefined>>(),
  delete: vi.fn<(_: string) => Promise<void>>(),
  save: vi.fn<(task: Task) => Promise<void>>(),
};

const artifactStore = new InMemoryArtifactStore();

const system = {
  taskStore,
  artifactStore,
  kanbanBoardStore: { get: vi.fn() },
  codebaseStore: { listByWorkspace: vi.fn(), get: vi.fn(), getDefault: vi.fn(), findByRepoPath: vi.fn() },
  worktreeStore: { listByWorkspace: vi.fn(), get: vi.fn() },
};

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

vi.mock("@/core/kanban/boards", () => ({
  ensureDefaultBoard: vi.fn(async () => ({ id: "board-1" })),
}));

vi.mock("@/core/kanban/kanban-event-broadcaster", () => ({
  getKanbanEventBroadcaster: () => ({ notify }),
}));

vi.mock("@/core/kanban/column-transition", () => ({
  emitColumnTransition: (...args: unknown[]) => emitColumnTransition(...args),
}));

vi.mock("@/core/kanban/workflow-orchestrator-singleton", () => ({
  processKanbanColumnTransition: (...args: unknown[]) => processKanbanColumnTransition(...args),
}));

vi.mock("@/core/kanban/github-issues", () => ({
  createGitHubIssue: (repo: string, payload: unknown) => createGitHubIssue(repo, payload),
  buildTaskGitHubIssueBody: (objective: string, testCases?: string[]) =>
    buildTaskGitHubIssueBody(objective, testCases),
  resolveGitHubRepo: (sourceUrl?: string, repoPath?: string) => resolveGitHubRepo(sourceUrl, repoPath),
}));

import { DELETE, GET, POST } from "../route";

describe("/api/tasks GET", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    taskStore.listByWorkspace.mockResolvedValue([
      createTask({
        id: "task-1",
        title: "Artifact summary",
        objective: "Return artifact counts with task list data.",
        comment: "Backlog refinement note from update_card.",
        workspaceId: "workspace-1",
        boardId: "board-1",
        columnId: "dev",
        status: TaskStatus.IN_PROGRESS,
      }),
    ]);
    taskStore.listByAssignee.mockResolvedValue([]);
    taskStore.listByStatus.mockResolvedValue([]);
    taskStore.deleteByWorkspace.mockResolvedValue(0);
    taskStore.get.mockResolvedValue(undefined);
    taskStore.delete.mockResolvedValue();
    taskStore.save.mockResolvedValue();
    createGitHubIssue.mockReset();
    createGitHubIssue.mockResolvedValue({
      id: "github-1",
      number: 42,
      url: "https://github.com/acme/platform/issues/42",
      state: "open",
      repo: "acme/platform",
    });
    buildTaskGitHubIssueBody.mockClear();
    resolveGitHubRepo.mockClear();
    system.kanbanBoardStore.get.mockResolvedValue({
      id: "board-1",
      columns: [{ id: "backlog", name: "Backlog", position: 0, stage: "backlog" }],
    });
    system.codebaseStore.listByWorkspace.mockResolvedValue([]);
    system.codebaseStore.get.mockResolvedValue(undefined);
    system.codebaseStore.getDefault.mockResolvedValue(undefined);
    system.codebaseStore.findByRepoPath.mockResolvedValue(undefined);
    system.worktreeStore.listByWorkspace.mockResolvedValue([]);
    system.worktreeStore.get.mockResolvedValue(undefined);
    processKanbanColumnTransition.mockResolvedValue(undefined);
    await artifactStore.deleteByTask("task-1");
  });

  it("returns artifact summary counts with listed tasks", async () => {
    await artifactStore.saveArtifact(createArtifact({
      id: "artifact-1",
      type: "screenshot",
      taskId: "task-1",
      workspaceId: "workspace-1",
      status: "provided",
    }));
    await artifactStore.saveArtifact(createArtifact({
      id: "artifact-2",
      type: "logs",
      taskId: "task-1",
      workspaceId: "workspace-1",
      status: "provided",
    }));

    const response = await GET(new NextRequest("http://localhost/api/tasks?workspaceId=workspace-1"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(taskStore.listByWorkspace).toHaveBeenCalledWith("workspace-1");
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0]).toMatchObject({
      id: "task-1",
      comment: "Backlog refinement note from update_card.",
      comments: [
        { body: "Backlog refinement note from update_card." },
      ],
      artifactSummary: {
        total: 2,
        byType: {
          screenshot: 1,
          logs: 1,
        },
      },
      evidenceSummary: {
        artifact: {
          total: 2,
          byType: {
            screenshot: 1,
            logs: 1,
          },
          requiredSatisfied: true,
          missingRequired: [],
        },
        verification: {
          hasVerdict: false,
          hasReport: false,
        },
        completion: {
          hasSummary: false,
        },
        runs: {
          total: 0,
          latestStatus: "idle",
        },
      },
      storyReadiness: {
        ready: true,
        missing: [],
        requiredTaskFields: [],
      },
      investValidation: {
        source: "heuristic",
      },
    });
  });

  it("degrades gracefully when the sqlite worktrees table is missing", async () => {
    system.worktreeStore.listByWorkspace.mockRejectedValueOnce(
      new Error("SqliteError: no such table: worktrees"),
    );

    const response = await GET(new NextRequest("http://localhost/api/tasks?workspaceId=workspace-1"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0]).toMatchObject({
      id: "task-1",
      title: "Artifact summary",
    });
  });

  it("rejects task listing without workspaceId", async () => {
    const response = await GET(new NextRequest("http://localhost/api/tasks"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: "workspaceId is required" });
    expect(taskStore.listByWorkspace).not.toHaveBeenCalled();
  });

  it("rejects task creation without workspaceId", async () => {
    const response = await POST(new NextRequest("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Task title",
        objective: "Task objective",
      }),
      headers: { "Content-Type": "application/json" },
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: "workspaceId is required" });
  });

  it("processes automation immediately when creating into an automated lane", async () => {
    system.kanbanBoardStore.get.mockResolvedValue({
      id: "board-1",
      columns: [
        {
          id: "todo",
          name: "Todo",
          position: 0,
          stage: "todo",
          automation: {
            enabled: true,
            steps: [{ id: "todo-a2a", transport: "a2a", role: "CRAFTER" }],
            transitionType: "entry",
          },
        },
      ],
    });

    const response = await POST(new NextRequest("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Create into todo",
        objective: "Verify eager todo automation",
        workspaceId: "workspace-1",
        boardId: "board-1",
        columnId: "todo",
      }),
      headers: { "Content-Type": "application/json" },
    }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(taskStore.save).toHaveBeenCalled();
    expect(processKanbanColumnTransition).toHaveBeenCalledWith(system, expect.objectContaining({
      cardId: data.task.id,
      boardId: "board-1",
      toColumnId: "todo",
      toColumnName: "Todo",
    }));
    expect(emitColumnTransition).toHaveBeenCalled();
  });

  it("creates a linked GitHub issue only for manual task creation", async () => {
    system.codebaseStore.findByRepoPath.mockResolvedValue({
      id: "codebase-1",
      repoPath: "/repos/acme/platform",
      sourceUrl: "https://github.com/acme/platform",
    });

    const response = await POST(new NextRequest("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Create linked task",
        objective: "Track the task in GitHub too",
        workspaceId: "workspace-1",
        createGitHubIssue: true,
        creationSource: "manual",
        repoPath: "/repos/acme/platform",
        testCases: ["Task appears on the board"],
      }),
      headers: { "Content-Type": "application/json" },
    }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(createGitHubIssue).toHaveBeenCalledWith("acme/platform", expect.objectContaining({
      title: "Create linked task",
      body: "Track the task in GitHub too",
    }));
    expect(data.task).toMatchObject({
      githubNumber: 42,
      githubRepo: "acme/platform",
      githubUrl: "https://github.com/acme/platform/issues/42",
      githubState: "open",
    });
  });

  it("does not create a GitHub issue for non-manual task creation sources", async () => {
    system.codebaseStore.findByRepoPath.mockResolvedValue({
      id: "codebase-1",
      repoPath: "/repos/acme/platform",
      sourceUrl: "https://github.com/acme/platform",
    });

    const response = await POST(new NextRequest("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Automated backlog seed",
        objective: "Create from API without external issue side effects",
        workspaceId: "workspace-1",
        createGitHubIssue: true,
        creationSource: "api",
        repoPath: "/repos/acme/platform",
      }),
      headers: { "Content-Type": "application/json" },
    }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(createGitHubIssue).not.toHaveBeenCalled();
    expect(data.task.githubNumber).toBeUndefined();
    expect(data.task.githubRepo).toBeUndefined();
  });

  it("imports an existing GitHub issue without creating a new one", async () => {
    system.codebaseStore.get.mockResolvedValue({
      id: "codebase-1",
      repoPath: "/repos/acme/platform",
      sourceUrl: "https://github.com/acme/platform",
    });
    taskStore.listByWorkspace.mockResolvedValue([]);

    const response = await POST(new NextRequest("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Imported issue",
        objective: "Imported from GitHub",
        workspaceId: "workspace-1",
        codebaseIds: ["codebase-1"],
        githubId: "issue-77",
        githubNumber: 77,
        githubUrl: "https://github.com/acme/platform/issues/77",
        githubRepo: "acme/platform",
        githubState: "open",
      }),
      headers: { "Content-Type": "application/json" },
    }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(createGitHubIssue).not.toHaveBeenCalled();
    expect(data.task).toMatchObject({
      githubId: "issue-77",
      githubNumber: 77,
      githubRepo: "acme/platform",
      githubUrl: "https://github.com/acme/platform/issues/77",
      githubState: "open",
      codebaseIds: ["codebase-1"],
    });
  });

  it("imports an existing GitHub pull request and preserves the PR flag", async () => {
    system.codebaseStore.get.mockResolvedValue({
      id: "codebase-1",
      repoPath: "/repos/acme/platform",
      sourceUrl: "https://github.com/acme/platform",
    });
    taskStore.listByWorkspace.mockResolvedValue([]);

    const response = await POST(new NextRequest("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Imported PR",
        objective: "Imported from GitHub pull requests",
        workspaceId: "workspace-1",
        codebaseIds: ["codebase-1"],
        githubId: "pr-289",
        githubNumber: 289,
        githubUrl: "https://github.com/acme/platform/pull/289",
        githubRepo: "acme/platform",
        githubState: "open",
        isPullRequest: true,
      }),
      headers: { "Content-Type": "application/json" },
    }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(createGitHubIssue).not.toHaveBeenCalled();
    expect(data.task).toMatchObject({
      githubId: "pr-289",
      githubNumber: 289,
      githubRepo: "acme/platform",
      githubUrl: "https://github.com/acme/platform/pull/289",
      githubState: "open",
      isPullRequest: true,
      codebaseIds: ["codebase-1"],
    });
    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      githubNumber: 289,
      githubRepo: "acme/platform",
      isPullRequest: true,
    }));
  });

  it("rejects importing the same GitHub issue twice into one workspace", async () => {
    taskStore.listByWorkspace.mockResolvedValue([
      createTask({
        id: "task-77",
        title: "Existing task",
        objective: "Already imported",
        workspaceId: "workspace-1",
        githubRepo: "acme/platform",
        githubNumber: 77,
      }),
    ]);

    const response = await POST(new NextRequest("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: "Duplicate import",
        objective: "Should fail",
        workspaceId: "workspace-1",
        githubNumber: 77,
        githubRepo: "acme/platform",
      }),
      headers: { "Content-Type": "application/json" },
    }));
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toContain("already imported");
    expect(taskStore.save).not.toHaveBeenCalled();
  });

  it("deletes all tasks in a workspace", async () => {
    taskStore.deleteByWorkspace.mockResolvedValue(3);

    const response = await DELETE(new NextRequest("http://localhost/api/tasks?workspaceId=workspace-1", {
      method: "DELETE",
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(taskStore.deleteByWorkspace).toHaveBeenCalledWith("workspace-1");
    expect(data).toEqual({ deleted: true, deletedCount: 3 });
  });

  it("rejects task deletion without taskId or workspaceId", async () => {
    const response = await DELETE(new NextRequest("http://localhost/api/tasks", {
      method: "DELETE",
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: "taskId or workspaceId is required" });
  });
});
