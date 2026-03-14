import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

import { createTask } from "@/core/models/task";
import { GET } from "../route";
import { getRoutaSystem } from "@/core/routa-system";

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: vi.fn(),
}));

describe("/api/tasks GET", () => {
  const mockSystem = {
    taskStore: {
      listByWorkspace: vi.fn(),
      listByStatus: vi.fn(),
      listByAssignee: vi.fn(),
    },
    workspaceStore: {
      listByStatus: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRoutaSystem).mockReturnValue(mockSystem as never);
  });

  it("aggregates active workspace tasks when allWorkspaces=true", async () => {
    mockSystem.workspaceStore.listByStatus.mockResolvedValue([
      { id: "ws-1" },
      { id: "ws-2" },
    ]);
    mockSystem.taskStore.listByWorkspace
      .mockResolvedValueOnce([
        createTask({
          id: "task-1",
          title: "Platform backlog task",
          objective: "Keep the platform board visible on home",
          workspaceId: "ws-1",
        }),
      ])
      .mockResolvedValueOnce([
        createTask({
          id: "task-2",
          title: "Infra review task",
          objective: "Track infra work from the homepage board",
          workspaceId: "ws-2",
        }),
      ]);

    const response = await GET(new NextRequest("http://localhost/api/tasks?allWorkspaces=true"));
    const body = await response.json();

    expect(mockSystem.workspaceStore.listByStatus).toHaveBeenCalledWith("active");
    expect(mockSystem.taskStore.listByWorkspace).toHaveBeenCalledTimes(2);
    expect(body.tasks).toHaveLength(2);
    expect(body.tasks.map((task: { workspaceId: string; title: string }) => ({
      workspaceId: task.workspaceId,
      title: task.title,
    }))).toEqual([
      { workspaceId: "ws-1", title: "Platform backlog task" },
      { workspaceId: "ws-2", title: "Infra review task" },
    ]);
  });
});
