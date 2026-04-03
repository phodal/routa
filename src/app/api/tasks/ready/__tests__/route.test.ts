import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createArtifact } from "@/core/models/artifact";
import { createTask, TaskStatus, type Task } from "@/core/models/task";
import { InMemoryArtifactStore } from "@/core/store/artifact-store";

const taskStore = {
  findReadyTasks: vi.fn<(_: string) => Promise<Task[]>>(),
};

const artifactStore = new InMemoryArtifactStore();
const system = {
  taskStore,
  artifactStore,
  kanbanBoardStore: { get: vi.fn() },
};

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

import { GET } from "../route";

describe("/api/tasks/ready GET", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await artifactStore.deleteByTask("task-ready-1");
    taskStore.findReadyTasks.mockResolvedValue([
      createTask({
        id: "task-ready-1",
        title: "Ready task",
        objective: "Run after dependencies complete",
        workspaceId: "workspace-1",
        boardId: "board-1",
        columnId: "todo",
        status: TaskStatus.PENDING,
      }),
    ]);
    system.kanbanBoardStore.get.mockResolvedValue({
      id: "board-1",
      columns: [
        { id: "todo", name: "Todo", position: 0, stage: "todo" },
        {
          id: "dev",
          name: "Dev",
          position: 1,
          stage: "dev",
          automation: {
            requiredArtifacts: ["screenshot"],
          },
        },
      ],
    });
  });

  it("returns ready tasks for the requested workspace", async () => {
    await artifactStore.saveArtifact(createArtifact({
      id: "artifact-1",
      type: "screenshot",
      taskId: "task-ready-1",
      workspaceId: "workspace-1",
      status: "provided",
    }));

    const response = await GET(new NextRequest("http://localhost/api/tasks/ready?workspaceId=workspace-1"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(taskStore.findReadyTasks).toHaveBeenCalledWith("workspace-1");
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0]).toMatchObject({
      id: "task-ready-1",
      workspaceId: "workspace-1",
      artifactSummary: {
        total: 1,
        byType: {
          screenshot: 1,
        },
        requiredSatisfied: true,
        missingRequired: [],
      },
      evidenceSummary: {
        artifact: {
          total: 1,
          byType: {
            screenshot: 1,
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

  it("rejects requests without workspaceId", async () => {
    const response = await GET(new NextRequest("http://localhost/api/tasks/ready"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: "workspaceId is required" });
    expect(taskStore.findReadyTasks).not.toHaveBeenCalled();
  });
});
