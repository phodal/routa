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
import { TEAM_LEAD_SPECIALIST_ID } from "../team-run";

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

  it("returns stable team-run summaries for explicit team runs and anonymous top-level ROUTA runs with descendants", async () => {
    listSessions.mockReturnValue([
      {
        sessionId: "anonymous-team-run",
        workspaceId: "workspace-1",
        cwd: "/tmp/project",
        role: "ROUTA",
        createdAt: "2026-04-03T10:05:00.000Z",
      },
      {
        sessionId: "anonymous-team-child",
        workspaceId: "workspace-1",
        cwd: "/tmp/project",
        role: "DEVELOPER",
        parentSessionId: "anonymous-team-run",
        createdAt: "2026-04-03T10:04:00.000Z",
      },
      {
        sessionId: "named-team-run",
        name: "Team - Investigate regression",
        workspaceId: "workspace-1",
        cwd: "/tmp/project",
        role: "ROUTA",
        createdAt: "2026-04-03T10:03:00.000Z",
      },
      {
        sessionId: "named-non-routa-run",
        name: "Team - not actually routa",
        workspaceId: "workspace-1",
        cwd: "/tmp/project",
        role: "DEVELOPER",
        createdAt: "2026-04-03T10:02:30.000Z",
      },
      {
        sessionId: "non-team-routa",
        workspaceId: "workspace-1",
        cwd: "/tmp/project",
        role: "ROUTA",
        createdAt: "2026-04-03T10:02:00.000Z",
      },
      {
        sessionId: "team-specialist-run",
        workspaceId: "workspace-1",
        cwd: "/tmp/project",
        specialistId: TEAM_LEAD_SPECIALIST_ID,
        createdAt: "2026-04-03T10:01:00.000Z",
      },
      {
        sessionId: "session-other-workspace",
        workspaceId: "workspace-2",
        cwd: "/tmp/project",
        role: "ROUTA",
        createdAt: "2026-04-03T10:00:00.000Z",
      },
    ]);

    const response = await GET(
      new NextRequest("http://localhost/api/sessions?workspaceId=workspace-1&surface=team"),
    );
    const data = await response.json();

    expect(data.sessions.map((session: { sessionId: string }) => session.sessionId)).toEqual([
      "anonymous-team-run",
      "named-team-run",
      "team-specialist-run",
    ]);
    expect(data.sessions[0]).toMatchObject({
      sessionId: "anonymous-team-run",
      directDelegates: 1,
      descendants: 1,
    });
    expect(data.sessions[1]).toMatchObject({
      sessionId: "named-team-run",
      directDelegates: 0,
      descendants: 0,
    });
  });

  it("ignores cyclic descendants and excludes named non-ROUTA sessions from the team surface", async () => {
    listSessions.mockReturnValue([
      {
        sessionId: "cycle-root",
        workspaceId: "workspace-1",
        cwd: "/tmp/project",
        role: "ROUTA",
        createdAt: "2026-04-03T10:05:00.000Z",
      },
      {
        sessionId: "cycle-child",
        workspaceId: "workspace-1",
        cwd: "/tmp/project",
        role: "DEVELOPER",
        parentSessionId: "cycle-root",
        createdAt: "2026-04-03T10:04:00.000Z",
      },
      {
        sessionId: "cycle-root",
        workspaceId: "workspace-1",
        cwd: "/tmp/project",
        role: "DEVELOPER",
        parentSessionId: "cycle-child",
        createdAt: "2026-04-03T10:03:00.000Z",
      },
      {
        sessionId: "named-non-routa-run",
        name: "Team - not actually routa",
        workspaceId: "workspace-1",
        cwd: "/tmp/project",
        role: "DEVELOPER",
        createdAt: "2026-04-03T10:02:30.000Z",
      },
    ]);

    const response = await GET(
      new NextRequest("http://localhost/api/sessions?workspaceId=workspace-1&surface=team"),
    );
    const data = await response.json();

    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0]).toMatchObject({
      sessionId: "cycle-root",
      directDelegates: 1,
      descendants: 1,
    });
  });
});
