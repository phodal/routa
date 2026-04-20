import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { exportTraces, queryTracesWithSessionFallback } = vi.hoisted(() => ({
  exportTraces: vi.fn(),
  queryTracesWithSessionFallback: vi.fn(),
}));

vi.mock("@/core/trace", () => ({
  getTraceReader: () => ({
    export: exportTraces,
  }),
  queryTracesWithSessionFallback,
}));

import { POST } from "../route";

describe("/api/traces/export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exportTraces.mockResolvedValue([{ id: "trace-export-1" }]);
    queryTracesWithSessionFallback.mockResolvedValue([{ id: "trace-session-1" }]);
  });

  it("rejects malformed JSON bodies", async () => {
    const response = await POST(new NextRequest("http://localhost/api/traces/export", {
      method: "POST",
      body: "{bad json",
      headers: { "Content-Type": "application/json" },
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: "Invalid JSON body" });
    expect(exportTraces).not.toHaveBeenCalled();
    expect(queryTracesWithSessionFallback).not.toHaveBeenCalled();
  });

  it("preserves zero-valued pagination overrides from the request body", async () => {
    const response = await POST(new NextRequest("http://localhost/api/traces/export?limit=25&offset=10", {
      method: "POST",
      body: JSON.stringify({
        sessionId: "session-123",
        limit: 0,
        offset: 0,
      }),
      headers: { "Content-Type": "application/json" },
    }));

    expect(response.status).toBe(200);
    expect(queryTracesWithSessionFallback).toHaveBeenCalledWith({
      sessionId: "session-123",
      workspaceId: undefined,
      file: undefined,
      eventType: undefined,
      startDate: undefined,
      endDate: undefined,
      limit: 0,
      offset: 0,
    });
    expect(exportTraces).not.toHaveBeenCalled();
  });

  it("rejects invalid pagination query params", async () => {
    const response = await POST(new NextRequest("http://localhost/api/traces/export?limit=NaN", {
      method: "POST",
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: "Invalid limit pagination parameter" });
    expect(exportTraces).not.toHaveBeenCalled();
    expect(queryTracesWithSessionFallback).not.toHaveBeenCalled();
  });

  it("uses the trace reader export when no session fallback is needed", async () => {
    const response = await POST(new NextRequest("http://localhost/api/traces/export?workspaceId=workspace-1", {
      method: "POST",
    }));

    expect(response.status).toBe(200);
    expect(exportTraces).toHaveBeenCalledWith({
      sessionId: undefined,
      workspaceId: "workspace-1",
      file: undefined,
      eventType: undefined,
      startDate: undefined,
      endDate: undefined,
      limit: undefined,
      offset: undefined,
    });
    expect(queryTracesWithSessionFallback).not.toHaveBeenCalled();
  });
});
