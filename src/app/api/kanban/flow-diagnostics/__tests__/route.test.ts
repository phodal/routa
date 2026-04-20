import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { taskStore } = vi.hoisted(() => ({
  taskStore: {
    listByWorkspace: vi.fn<(_: string) => Promise<unknown[]>>(),
  },
}));

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => ({
    taskStore,
  }),
}));

import { GET } from "../route";

describe("/api/kanban/flow-diagnostics GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when workspaceId is missing", async () => {
    const req = new NextRequest("http://localhost:3000/api/kanban/flow-diagnostics");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("workspaceId");
  });

  it("returns empty report for workspace with no tasks", async () => {
    taskStore.listByWorkspace.mockResolvedValue([]);
    const req = new NextRequest("http://localhost:3000/api/kanban/flow-diagnostics?workspaceId=ws-1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe("ws-1");
    expect(body.taskCount).toBe(0);
    expect(body.bouncePatterns).toEqual([]);
  });

  it("filters by boardId when provided", async () => {
    taskStore.listByWorkspace.mockResolvedValue([
      {
        id: "t1",
        boardId: "board-1",
        laneSessions: [
          { sessionId: "s1", columnId: "dev", startedAt: "2026-01-01T00:00:00Z", status: "completed" },
        ],
        laneHandoffs: [],
      },
      {
        id: "t2",
        boardId: "board-2",
        laneSessions: [
          { sessionId: "s2", columnId: "dev", startedAt: "2026-01-01T00:00:00Z", status: "failed" },
        ],
        laneHandoffs: [],
      },
    ]);

    const req = new NextRequest("http://localhost:3000/api/kanban/flow-diagnostics?workspaceId=ws-1&boardId=board-1");
    const res = await GET(req);
    const body = await res.json();

    expect(body.boardId).toBe("board-1");
    expect(body.taskCount).toBe(1);
  });

  it("returns flow analysis with bounce patterns", async () => {
    taskStore.listByWorkspace.mockResolvedValue([
      {
        id: "t1",
        boardId: "board-1",
        laneSessions: [
          { sessionId: "s1", columnId: "dev", startedAt: "2026-01-01T00:00:00Z", status: "completed" },
          { sessionId: "s2", columnId: "review", startedAt: "2026-01-01T01:00:00Z", status: "completed" },
          { sessionId: "s3", columnId: "dev", startedAt: "2026-01-01T02:00:00Z", status: "completed" },
        ],
        laneHandoffs: [],
      },
    ]);

    const req = new NextRequest("http://localhost:3000/api/kanban/flow-diagnostics?workspaceId=ws-1");
    const res = await GET(req);
    const body = await res.json();

    expect(body.bouncePatterns.length).toBeGreaterThan(0);
    expect(body.bouncePatterns[0].fromColumnId).toBe("review");
    expect(body.bouncePatterns[0].toColumnId).toBe("dev");
  });
});
