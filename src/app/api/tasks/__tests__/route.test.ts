import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createArtifact } from "@/core/models/artifact";
import { createTask, TaskStatus, type Task } from "@/core/models/task";
import { InMemoryArtifactStore } from "@/core/store/artifact-store";

const taskStore = {
  listByWorkspace: vi.fn<(_: string) => Promise<Task[]>>(),
  listByAssignee: vi.fn<(_: string) => Promise<Task[]>>(),
  listByStatus: vi.fn<(_: string, __: TaskStatus) => Promise<Task[]>>(),
  deleteByWorkspace: vi.fn<(_: string) => Promise<number>>(),
  get: vi.fn<(_: string) => Promise<Task | undefined>>(),
  delete: vi.fn<(_: string) => Promise<void>>(),
};

const artifactStore = new InMemoryArtifactStore();

const system = {
  taskStore,
  artifactStore,
};

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
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
      artifactSummary: {
        total: 2,
        byType: {
          screenshot: 1,
          logs: 1,
        },
      },
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
