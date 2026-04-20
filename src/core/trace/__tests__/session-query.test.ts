import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  hydrateFromDb,
  getSession,
  loadSessionFromDb,
  loadSessionFromLocalStorage,
  getTraceReader,
  listWorkspaces,
  listTasksByWorkspace,
} = vi.hoisted(() => ({
  hydrateFromDb: vi.fn(),
  getSession: vi.fn(),
  loadSessionFromDb: vi.fn(),
  loadSessionFromLocalStorage: vi.fn(),
  getTraceReader: vi.fn(),
  listWorkspaces: vi.fn(),
  listTasksByWorkspace: vi.fn(),
}));

vi.mock("@/core/acp/http-session-store", () => ({
  getHttpSessionStore: () => ({
    hydrateFromDb,
    getSession,
  }),
}));

vi.mock("@/core/acp/session-db-persister", () => ({
  loadSessionFromDb,
  loadSessionFromLocalStorage,
}));

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => ({
    workspaceStore: {
      list: listWorkspaces,
    },
    taskStore: {
      listByWorkspace: listTasksByWorkspace,
    },
  }),
}));

vi.mock("../reader", () => ({
  getTraceReader,
}));

import { queryTracesWithSessionFallback, resolveTraceReaderCwds } from "../session-query";

describe("session-query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hydrateFromDb.mockResolvedValue(undefined);
    getSession.mockReturnValue(undefined);
    loadSessionFromDb.mockResolvedValue(null);
    loadSessionFromLocalStorage.mockResolvedValue(null);
    listWorkspaces.mockResolvedValue([]);
    listTasksByWorkspace.mockResolvedValue([]);
  });

  it("queries both the repo cwd and the session cwd, then dedupes globally", async () => {
    getSession.mockReturnValue({ cwd: "/tmp/worktree/task-1" });

    const repoReader = {
      query: vi.fn().mockResolvedValue([
        {
          id: "trace-1",
          sessionId: "session-1",
          eventType: "session_start",
          timestamp: "2026-04-07T10:00:00.000Z",
        },
      ]),
    };
    const worktreeReader = {
      query: vi.fn().mockResolvedValue([
        {
          id: "trace-1",
          sessionId: "session-1",
          eventType: "session_start",
          timestamp: "2026-04-07T10:00:00.000Z",
        },
        {
          id: "trace-2",
          sessionId: "session-1",
          eventType: "tool_call",
          timestamp: "2026-04-07T10:01:00.000Z",
        },
      ]),
    };

    getTraceReader.mockImplementation((cwd: string) => {
      if (cwd === "/tmp/repo") return repoReader;
      if (cwd === "/tmp/worktree/task-1") return worktreeReader;
      throw new Error(`Unexpected cwd: ${cwd}`);
    });

    const traces = await queryTracesWithSessionFallback(
      { sessionId: "session-1" },
      "/tmp/repo",
    );

    expect(getTraceReader).toHaveBeenCalledWith("/tmp/repo");
    expect(getTraceReader).toHaveBeenCalledWith("/tmp/worktree/task-1");
    expect(repoReader.query).toHaveBeenCalledWith({ sessionId: "session-1" });
    expect(worktreeReader.query).toHaveBeenCalledWith({ sessionId: "session-1" });
    expect(traces.map((trace) => trace.id)).toEqual(["trace-1", "trace-2"]);
  });

  it("falls back to persisted session metadata when the active session is missing", async () => {
    loadSessionFromDb.mockResolvedValue({ cwd: "/tmp/worktree/from-db" });

    const cwds = await resolveTraceReaderCwds("session-2", "/tmp/repo");

    expect(hydrateFromDb).toHaveBeenCalledTimes(1);
    expect(loadSessionFromDb).toHaveBeenCalledWith("session-2");
    expect(loadSessionFromLocalStorage).not.toHaveBeenCalled();
    expect(cwds).toEqual(["/tmp/repo", "/tmp/worktree/from-db"]);
  });

  it("falls back to lane session cwd when session metadata has already been pruned", async () => {
    listWorkspaces.mockResolvedValue([{ id: "default" }]);
    listTasksByWorkspace.mockResolvedValue([
      {
        id: "task-1",
        title: "Story",
        updatedAt: "2026-04-07T10:05:00.000Z",
        laneSessions: [
          {
            sessionId: "session-3",
            cwd: "/tmp/worktree/from-task",
            columnId: "review",
            status: "completed",
            startedAt: "2026-04-07T10:00:00.000Z",
          },
        ],
        laneHandoffs: [],
        sessionIds: [],
      },
    ]);

    const cwds = await resolveTraceReaderCwds("session-3", "/tmp/repo");

    expect(listWorkspaces).toHaveBeenCalledTimes(1);
    expect(listTasksByWorkspace).toHaveBeenCalledWith("default");
    expect(cwds).toEqual(["/tmp/repo", "/tmp/worktree/from-task"]);
  });
});
