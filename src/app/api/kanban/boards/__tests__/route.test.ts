import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, TaskStatus, VerificationVerdict, type Task } from "@/core/models/task";

const notify = vi.fn();
const ensureDefaultBoard = vi.fn();
const processKanbanColumnTransition = vi.fn();
const getBoardSnapshot = vi.fn();

const taskStore = {
  listByWorkspace: vi.fn<(_: string) => Promise<Task[]>>(),
  save: vi.fn<(task: Task) => Promise<void>>(),
};

const boardStore = {
  listByWorkspace: vi.fn(),
  get: vi.fn(),
};

const workspaceStore = {
  get: vi.fn(),
};

const system = {
  taskStore,
  kanbanBoardStore: boardStore,
  workspaceStore,
};

const sessionStore = {
  hydrateFromDb: vi.fn<() => Promise<void>>(),
  getSession: vi.fn(),
};

const processManager = {
  hasActiveSession: vi.fn<(sessionId: string) => boolean>(),
};

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

vi.mock("@/core/acp/http-session-store", () => ({
  getHttpSessionStore: () => sessionStore,
}));

vi.mock("@/core/acp/processer", () => ({
  getAcpProcessManager: () => processManager,
}));

vi.mock("@/core/kanban/boards", () => ({
  ensureDefaultBoard: (...args: unknown[]) => ensureDefaultBoard(...args),
}));

vi.mock("@/core/kanban/kanban-event-broadcaster", () => ({
  getKanbanEventBroadcaster: () => ({ notify }),
}));

vi.mock("@/core/kanban/workflow-orchestrator-singleton", () => ({
  getKanbanSessionQueue: () => ({ getBoardSnapshot }),
  processKanbanColumnTransition: (...args: unknown[]) => processKanbanColumnTransition(...args),
}));

import { GET } from "../route";

function createTaskWithRunningSession(overrides?: Partial<Task>): Task {
  return {
    ...createTask({
      id: "task-1",
      title: "Backlog story",
      objective: "Backlog story",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
    }),
    triggerSessionId: "session-1",
    laneSessions: [{
      sessionId: "session-1",
      columnId: "backlog",
      status: "running",
      startedAt: "2025-01-01T00:00:00.000Z",
    }],
    ...overrides,
  };
}

describe("/api/kanban/boards GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureDefaultBoard.mockResolvedValue(undefined);
    taskStore.save.mockResolvedValue(undefined);
    sessionStore.hydrateFromDb.mockResolvedValue(undefined);
    sessionStore.getSession.mockReturnValue(undefined);
    processManager.hasActiveSession.mockReturnValue(false);
    workspaceStore.get.mockResolvedValue({
      metadata: {
        "kanbanAutoProvider:board-1": "codex",
      },
    });
    getBoardSnapshot.mockResolvedValue({
      boardId: "board-1",
      runningCount: 0,
      runningCards: [],
      queuedCount: 0,
      queuedCardIds: [],
      queuedCards: [],
      queuedPositions: {},
    });
    boardStore.listByWorkspace.mockResolvedValue([{
      id: "board-1",
      workspaceId: "workspace-1",
      name: "Default Board",
      isDefault: true,
      columns: [{
        id: "backlog",
        name: "Backlog",
        position: 0,
        stage: "backlog",
        automation: {
          enabled: true,
          transitionType: "entry",
          steps: [{ id: "backlog-refiner", role: "CRAFTER" }],
        },
      }],
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    }]);
    boardStore.get.mockResolvedValue({
      id: "board-1",
      workspaceId: "workspace-1",
      name: "Default Board",
      isDefault: true,
      columns: [{
        id: "backlog",
        name: "Backlog",
        position: 0,
        stage: "backlog",
        automation: {
          enabled: true,
          transitionType: "entry",
          steps: [{ id: "backlog-refiner", role: "CRAFTER" }],
        },
      }],
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    });
  });

  it("re-enqueues orphaned tasks in entry automation columns", async () => {
    taskStore.listByWorkspace.mockResolvedValue([
      createTask({
        id: "task-1",
        title: "Orphaned backlog story",
        objective: "Backlog story",
        workspaceId: "workspace-1",
        boardId: "board-1",
        columnId: "backlog",
        status: TaskStatus.PENDING,
        assignedProvider: "codex",
      }),
    ]);

    const response = await GET(new NextRequest("http://localhost/api/kanban/boards?workspaceId=workspace-1"));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.boards[0]).toMatchObject({
      id: "board-1",
      autoProviderId: "codex",
    });
    expect(processKanbanColumnTransition).toHaveBeenCalledWith(system, expect.objectContaining({
      cardId: "task-1",
      toColumnId: "backlog",
      fromColumnId: "__revive__",
    }));
  });

  it("does not re-enqueue tasks that already have lane history in the current column", async () => {
    processManager.hasActiveSession.mockImplementation((sessionId) => sessionId === "session-1");
    taskStore.listByWorkspace.mockResolvedValue([
      {
        ...createTask({
          id: "task-1",
          title: "Started backlog story",
          objective: "Backlog story",
          workspaceId: "workspace-1",
          boardId: "board-1",
          columnId: "backlog",
          status: TaskStatus.PENDING,
        }),
        laneSessions: [{
          sessionId: "session-1",
          columnId: "backlog",
          status: "running",
          startedAt: "2025-01-01T00:00:00.000Z",
        }],
      },
    ]);

    const response = await GET(new NextRequest("http://localhost/api/kanban/boards?workspaceId=workspace-1"));
    expect(response.status).toBe(200);
    expect(processKanbanColumnTransition).not.toHaveBeenCalled();
  });

  it("revives tasks after clearing stale trigger sessions in the current lane", async () => {
    taskStore.listByWorkspace.mockResolvedValue([
      createTaskWithRunningSession({
        title: "Stale review story",
        objective: "Review story",
        status: TaskStatus.REVIEW_REQUIRED,
        verificationVerdict: undefined,
      }),
    ]);

    const response = await GET(new NextRequest("http://localhost/api/kanban/boards?workspaceId=workspace-1"));

    expect(response.status).toBe(200);
    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      id: "task-1",
      triggerSessionId: undefined,
      laneSessions: [expect.objectContaining({
        sessionId: "session-1",
        status: "timed_out",
      })],
    }));
    expect(processKanbanColumnTransition).toHaveBeenCalledWith(system, expect.objectContaining({
      cardId: "task-1",
      toColumnId: "backlog",
      fromColumnId: "__revive__",
    }));
  });

  it("marks stale review sessions with existing verdicts as transitioned before revive", async () => {
    taskStore.listByWorkspace.mockResolvedValue([
      createTaskWithRunningSession({
        title: "Approved review story",
        objective: "Review story",
        status: TaskStatus.REVIEW_REQUIRED,
        verificationVerdict: VerificationVerdict.APPROVED,
        verificationReport: "looks good",
      }),
    ]);

    const response = await GET(new NextRequest("http://localhost/api/kanban/boards?workspaceId=workspace-1"));

    expect(response.status).toBe(200);
    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      laneSessions: [expect.objectContaining({
        sessionId: "session-1",
        status: "transitioned",
      })],
    }));
    expect(processKanbanColumnTransition).toHaveBeenCalledTimes(1);
  });

  it("does not revive tasks when the trigger session is still active", async () => {
    processManager.hasActiveSession.mockImplementation((sessionId) => sessionId === "session-1");
    taskStore.listByWorkspace.mockResolvedValue([
      createTaskWithRunningSession({
        title: "Active backlog story",
      }),
    ]);

    const response = await GET(new NextRequest("http://localhost/api/kanban/boards?workspaceId=workspace-1"));
    expect(response.status).toBe(200);
    expect(taskStore.save).not.toHaveBeenCalled();
    expect(processKanbanColumnTransition).not.toHaveBeenCalled();
  });

  it("treats ready session-store records as active lane ownership", async () => {
    sessionStore.getSession.mockReturnValue({ acpStatus: "ready" });
    taskStore.listByWorkspace.mockResolvedValue([
      createTaskWithRunningSession(),
    ]);

    const response = await GET(new NextRequest("http://localhost/api/kanban/boards?workspaceId=workspace-1"));

    expect(response.status).toBe(200);
    expect(taskStore.save).not.toHaveBeenCalled();
    expect(processKanbanColumnTransition).not.toHaveBeenCalled();
  });

  it("treats connecting session-store records as active lane ownership", async () => {
    sessionStore.getSession.mockReturnValue({ acpStatus: "connecting" });
    taskStore.listByWorkspace.mockResolvedValue([
      createTaskWithRunningSession(),
    ]);

    const response = await GET(new NextRequest("http://localhost/api/kanban/boards?workspaceId=workspace-1"));

    expect(response.status).toBe(200);
    expect(taskStore.save).not.toHaveBeenCalled();
    expect(processKanbanColumnTransition).not.toHaveBeenCalled();
  });

  it("revives hydrated sessions without explicit acp status when no live lease remains", async () => {
    sessionStore.getSession.mockReturnValue({ sessionId: "session-1" });
    taskStore.listByWorkspace.mockResolvedValue([
      createTaskWithRunningSession(),
    ]);

    const response = await GET(new NextRequest("http://localhost/api/kanban/boards?workspaceId=workspace-1"));

    expect(response.status).toBe(200);
    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      triggerSessionId: undefined,
      laneSessions: [expect.objectContaining({
        sessionId: "session-1",
        status: "timed_out",
      })],
    }));
    expect(processKanbanColumnTransition).toHaveBeenCalledTimes(1);
  });

  it("preserves hydrated sessions without explicit acp status when the current-instance lease is still active", async () => {
    sessionStore.getSession.mockReturnValue({
      sessionId: "session-1",
      ownerInstanceId: `next-${process.pid}`,
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
    });
    taskStore.listByWorkspace.mockResolvedValue([
      createTaskWithRunningSession(),
    ]);

    const response = await GET(new NextRequest("http://localhost/api/kanban/boards?workspaceId=workspace-1"));

    expect(response.status).toBe(200);
    expect(taskStore.save).not.toHaveBeenCalled();
    expect(processKanbanColumnTransition).not.toHaveBeenCalled();
  });

  it("revives tasks when the stored session is already in error", async () => {
    sessionStore.getSession.mockReturnValue({ acpStatus: "error" });
    taskStore.listByWorkspace.mockResolvedValue([
      createTaskWithRunningSession(),
    ]);

    const response = await GET(new NextRequest("http://localhost/api/kanban/boards?workspaceId=workspace-1"));

    expect(response.status).toBe(200);
    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      triggerSessionId: undefined,
      laneSessions: [expect.objectContaining({
        sessionId: "session-1",
        status: "timed_out",
      })],
    }));
    expect(processKanbanColumnTransition).toHaveBeenCalledTimes(1);
  });

  it("clears stale trigger session ids when the current-lane session already failed", async () => {
    sessionStore.getSession.mockReturnValue({ acpStatus: "error" });
    taskStore.listByWorkspace.mockResolvedValue([
      {
        ...createTaskWithRunningSession(),
        laneSessions: [{
          sessionId: "session-1",
          columnId: "backlog",
          status: "failed",
          startedAt: "2025-01-01T00:00:00.000Z",
          completedAt: "2025-01-01T00:05:00.000Z",
        }],
      },
    ]);

    const response = await GET(new NextRequest("http://localhost/api/kanban/boards?workspaceId=workspace-1"));

    expect(response.status).toBe(200);
    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      triggerSessionId: undefined,
      laneSessions: [expect.objectContaining({
        sessionId: "session-1",
        status: "failed",
      })],
    }));
    expect(processKanbanColumnTransition).toHaveBeenCalledTimes(1);
  });

  it("hydrates session state only once before reviving multiple boards", async () => {
    boardStore.listByWorkspace.mockResolvedValue([
      {
        id: "board-1",
        workspaceId: "workspace-1",
        name: "Default Board",
        isDefault: true,
        columns: [{
          id: "backlog",
          name: "Backlog",
          position: 0,
          stage: "backlog",
          automation: {
            enabled: true,
            transitionType: "entry",
            steps: [{ id: "backlog-refiner", role: "CRAFTER" }],
          },
        }],
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        updatedAt: new Date("2025-01-01T00:00:00.000Z"),
      },
      {
        id: "board-2",
        workspaceId: "workspace-1",
        name: "Secondary Board",
        isDefault: false,
        columns: [{
          id: "backlog",
          name: "Backlog",
          position: 0,
          stage: "backlog",
          automation: {
            enabled: true,
            transitionType: "entry",
            steps: [{ id: "backlog-refiner", role: "CRAFTER" }],
          },
        }],
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        updatedAt: new Date("2025-01-01T00:00:00.000Z"),
      },
    ]);
    boardStore.get.mockImplementation(async (boardId: string) => ({
      id: boardId,
      workspaceId: "workspace-1",
      name: boardId,
      isDefault: boardId === "board-1",
      columns: [{
        id: "backlog",
        name: "Backlog",
        position: 0,
        stage: "backlog",
        automation: {
          enabled: true,
          transitionType: "entry",
          steps: [{ id: "backlog-refiner", role: "CRAFTER" }],
        },
      }],
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    }));
    taskStore.listByWorkspace.mockResolvedValue([]);

    const response = await GET(new NextRequest("http://localhost/api/kanban/boards?workspaceId=workspace-1"));

    expect(response.status).toBe(200);
    expect(sessionStore.hydrateFromDb).toHaveBeenCalledTimes(1);
  });
});
