import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, TaskStatus, type Task } from "@/core/models/task";

const notify = vi.fn();
const ensureDefaultBoard = vi.fn();
const processKanbanColumnTransition = vi.fn();
const getBoardSnapshot = vi.fn();

const taskStore = {
  listByWorkspace: vi.fn<(_: string) => Promise<Task[]>>(),
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

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
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

describe("/api/kanban/boards GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureDefaultBoard.mockResolvedValue(undefined);
    workspaceStore.get.mockResolvedValue(undefined);
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
    expect(response.status).toBe(200);
    expect(processKanbanColumnTransition).toHaveBeenCalledWith(system, expect.objectContaining({
      cardId: "task-1",
      toColumnId: "backlog",
      fromColumnId: "__revive__",
    }));
  });

  it("does not re-enqueue tasks that already have lane history in the current column", async () => {
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
});
