import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  confirmFeatureTreeStoryContextMock,
  notifyMock,
  resolveRepoRootMock,
  taskStoreGetMock,
  taskStoreSaveMock,
} = vi.hoisted(() => ({
  confirmFeatureTreeStoryContextMock: vi.fn(),
  notifyMock: vi.fn(),
  resolveRepoRootMock: vi.fn(),
  taskStoreGetMock: vi.fn(),
  taskStoreSaveMock: vi.fn(),
}));

vi.mock("@/core/harness/context-resolution", () => ({
  normalizeContextValue: (value: unknown) => {
    if (typeof value !== "string") {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  resolveRepoRoot: resolveRepoRootMock,
}));

vi.mock("@/core/kanban/context-preload", () => ({
  buildFeatureTreeRetrievalHints: (hints: unknown) => hints,
  confirmFeatureTreeStoryContext: confirmFeatureTreeStoryContextMock,
  loadRelevantFeatureTreeContext: vi.fn(),
}));

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => ({
    taskStore: {
      get: taskStoreGetMock,
      save: taskStoreSaveMock,
    },
  }),
}));

vi.mock("@/core/kanban/kanban-event-broadcaster", () => ({
  getKanbanEventBroadcaster: () => ({
    notify: notifyMock,
  }),
}));

import { confirmFeatureTreeStoryContextFromToolArgs } from "../task-adaptive-tool";

describe("confirmFeatureTreeStoryContextFromToolArgs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveRepoRootMock.mockResolvedValue("/repo");
    confirmFeatureTreeStoryContextMock.mockResolvedValue({
      warnings: [],
      confirmedContextSearchSpec: {
        featureCandidates: ["kanban-workflow"],
        relatedFiles: ["crates/routa-server/src/api/kanban.rs"],
      },
    });
  });

  it("rejects task persistence when the task belongs to another workspace", async () => {
    taskStoreGetMock.mockResolvedValue({
      id: "task-1",
      workspaceId: "workspace-2",
    });

    await expect(confirmFeatureTreeStoryContextFromToolArgs({
      workspaceId: "workspace-1",
      taskId: "task-1",
      query: "kanban workflow",
    })).rejects.toThrow("Task task-1 does not belong to workspace workspace-1.");

    expect(taskStoreSaveMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("merges confirmed hints only for a task in the current workspace", async () => {
    const task = {
      id: "task-1",
      workspaceId: "workspace-1",
      contextSearchSpec: {
        relatedFiles: ["src/app/api/kanban/events/route.ts"],
      },
      updatedAt: new Date("2026-04-23T00:00:00.000Z"),
    };
    taskStoreGetMock.mockResolvedValue(task);

    const result = await confirmFeatureTreeStoryContextFromToolArgs({
      workspaceId: "workspace-1",
      taskId: "task-1",
      query: "kanban workflow",
    });

    expect(taskStoreSaveMock).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      contextSearchSpec: {
        featureCandidates: ["kanban-workflow"],
        relatedFiles: [
          "src/app/api/kanban/events/route.ts",
          "crates/routa-server/src/api/kanban.rs",
        ],
      },
    }));
    expect(notifyMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      entity: "task",
      action: "updated",
      resourceId: "task-1",
      source: "agent",
    });
    expect(result.confirmedContextSearchSpec).toEqual(task.contextSearchSpec);
  });
});
