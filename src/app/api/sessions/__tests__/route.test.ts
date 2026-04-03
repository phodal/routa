import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { hydrateFromDb, listSessions } = vi.hoisted(() => ({
  hydrateFromDb: vi.fn(),
  listSessions: vi.fn(),
}));

vi.mock("@/core/acp/http-session-store", () => ({
  getHttpSessionStore: () => ({
    hydrateFromDb,
    listSessions,
  }),
}));

import { GET } from "../route";

describe("/api/sessions GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hydrateFromDb.mockResolvedValue(undefined);
    listSessions.mockReturnValue([
      {
        sessionId: "session-3",
        name: "Session 3",
        workspaceId: "workspace-1",
        cwd: "/tmp/project",
        branch: "main",
        provider: "codex",
        role: "DEVELOPER",
        toolMode: "full",
        allowedNativeTools: ["Bash"],
        createdAt: "2026-04-03T10:02:00.000Z",
      },
      {
        sessionId: "session-2",
        workspaceId: "workspace-1",
        cwd: "/tmp/project",
        createdAt: "2026-04-03T10:01:00.000Z",
      },
      {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        cwd: "/tmp/project",
        createdAt: "2026-04-03T10:00:00.000Z",
      },
      {
        sessionId: "child-2",
        workspaceId: "workspace-1",
        cwd: "/tmp/project",
        createdAt: "2026-04-03T09:59:30.000Z",
        parentSessionId: "parent-1",
      },
      {
        sessionId: "child-1",
        workspaceId: "workspace-1",
        cwd: "/tmp/project",
        createdAt: "2026-04-03T09:59:15.000Z",
        parentSessionId: "parent-1",
        firstPromptSent: false,
      },
      {
        sessionId: "session-other-workspace",
        workspaceId: "workspace-2",
        cwd: "/tmp/project",
        createdAt: "2026-04-03T09:59:00.000Z",
      },
      {
        sessionId: "session-empty",
        workspaceId: "workspace-1",
        cwd: "/tmp/project",
        createdAt: "2026-04-03T09:58:00.000Z",
        firstPromptSent: false,
      },
    ]);
  });

  it("filters by workspace and honors limit", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/sessions?workspaceId=workspace-1&limit=2"),
    );
    const data = await response.json();

    expect(hydrateFromDb).toHaveBeenCalledTimes(1);
    expect(data.sessions.map((session: { sessionId: string }) => session.sessionId)).toEqual([
      "session-3",
      "session-2",
    ]);
    expect(data.sessions[0]).toMatchObject({
      sessionId: "session-3",
      name: "Session 3",
      branch: "main",
      provider: "codex",
      role: "DEVELOPER",
    });
    expect(data.sessions[0].toolMode).toBeUndefined();
    expect(data.sessions[0].allowedNativeTools).toBeUndefined();
  });

  it("keeps child session queries inclusive but still honors limit", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/sessions?parentSessionId=parent-1&limit=1"),
    );
    const data = await response.json();

    expect(data.sessions.map((session: { sessionId: string }) => session.sessionId)).toEqual([
      "child-2",
    ]);
  });
});
