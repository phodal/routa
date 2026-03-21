import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hydrateFromDb = vi.fn();
const getSession = vi.fn();

vi.mock("@/core/acp/http-session-store", () => ({
  getHttpSessionStore: () => ({
    hydrateFromDb,
    getSession,
  }),
}));

import { GET } from "../route";

describe("/api/sessions/[sessionId] GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hydrateFromDb.mockResolvedValue(undefined);
  });

  it("returns ACP runtime status fields for Kanban session backfill", async () => {
    getSession.mockReturnValue({
      sessionId: "session-123",
      name: "Story One · auggie",
      cwd: "/tmp/project",
      branch: "main",
      workspaceId: "workspace-1",
      provider: "auggie",
      role: "DEVELOPER",
      acpStatus: "error",
      acpError: "Permission denied: HTTP error: 403 Forbidden",
      executionMode: "runner",
      ownerInstanceId: "runner",
      leaseExpiresAt: "2026-03-19T00:05:00.000Z",
      createdAt: "2026-03-19T00:00:00.000Z",
    });

    const response = await GET(
      new NextRequest("http://localhost/api/sessions/session-123"),
      { params: Promise.resolve({ sessionId: "session-123" }) },
    );
    const data = await response.json();

    expect(hydrateFromDb).toHaveBeenCalledTimes(1);
    expect(getSession).toHaveBeenCalledWith("session-123");
    expect(data.session).toMatchObject({
      sessionId: "session-123",
      provider: "auggie",
      role: "DEVELOPER",
      acpStatus: "error",
      acpError: "Permission denied: HTTP error: 403 Forbidden",
      executionMode: "runner",
      ownerInstanceId: "runner",
    });
  });
});
