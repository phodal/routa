import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const handleSessionNewMock = vi.hoisted(() => vi.fn());
const loadSpecialistConfigMock = vi.hoisted(() => vi.fn());
const dispatchSessionPromptMock = vi.hoisted(() => vi.fn());
const createCanvasArtifactMock = vi.hoisted(() => vi.fn());
const getConsolidatedHistoryMock = vi.hoisted(() => vi.fn());
const killSessionMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/app/api/acp/acp-session-create", () => ({
  handleSessionNew: handleSessionNewMock,
  loadSpecialistConfig: loadSpecialistConfigMock,
}));

vi.mock("@/core/acp/session-prompt", () => ({
  dispatchSessionPrompt: dispatchSessionPromptMock,
}));

vi.mock("@/core/acp/http-session-store", () => ({
  getHttpSessionStore: () => ({
    getConsolidatedHistory: getConsolidatedHistoryMock,
    pushNotification: vi.fn(),
  }),
}));

vi.mock("@/core/acp/processer", () => ({
  getAcpProcessManager: () => ({
    killSession: killSessionMock,
  }),
}));

vi.mock("@/app/api/canvas/route", () => ({
  createCanvasArtifact: createCanvasArtifactMock,
}));

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => ({}),
}));

import { POST } from "../route";

describe("/api/canvas/specialist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadSpecialistConfigMock.mockResolvedValue({
      id: "crafter",
      name: "Implementor",
      role: "CRAFTER",
      defaultModelTier: "FAST",
      systemPrompt: "build things",
      roleReminder: "stay focused",
      defaultProvider: "opencode",
    });
    handleSessionNewMock.mockResolvedValue(new Response(JSON.stringify({
      jsonrpc: "2.0",
      result: { sessionId: "sess-1" },
    }), {
      headers: { "Content-Type": "application/json" },
    }));
    dispatchSessionPromptMock.mockResolvedValue(undefined);
    createCanvasArtifactMock.mockResolvedValue({
      id: "canvas-1",
      renderMode: "dynamic",
      title: "Specialist Canvas",
      taskId: "task-1",
      createdAt: "2026-04-16T00:00:00.000Z",
    });
  });

  it("generates a canvas artifact from specialist output", async () => {
    getConsolidatedHistoryMock.mockReturnValue([
      {
        sessionId: "sess-1",
        update: {
          sessionUpdate: "agent_message",
          content: {
            type: "text",
            text: [
              "```tsx",
              "export default function Canvas() {",
              "  return <div>Browser Ready</div>;",
              "}",
              "```",
            ].join("\n"),
          },
        },
      },
    ]);

    const request = new NextRequest("http://localhost/api/canvas/specialist", {
      method: "POST",
      body: JSON.stringify({
        specialistId: "crafter",
        workspaceId: "ws-1",
        prompt: "Create a simple browser-ready status card.",
        title: "Specialist Canvas",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const json = await response.json();
    expect(json.viewerUrl).toBe("/canvas/canvas-1");
    expect(json.sessionId).toBe("sess-1");
    expect(json.source).toContain("export default function Canvas()");
    expect(createCanvasArtifactMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        workspaceId: "ws-1",
        title: "Specialist Canvas",
        renderMode: "dynamic",
      }),
    );
    expect(dispatchSessionPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess-1",
        workspaceId: "ws-1",
      }),
    );
    expect(killSessionMock).toHaveBeenCalledWith("sess-1");
  });

  it("returns 422 when specialist output has no usable canvas source", async () => {
    getConsolidatedHistoryMock.mockReturnValue([
      {
        sessionId: "sess-1",
        update: {
          sessionUpdate: "agent_message",
          content: { type: "text", text: "I cannot provide TSX right now." },
        },
      },
    ]);

    const request = new NextRequest("http://localhost/api/canvas/specialist", {
      method: "POST",
      body: JSON.stringify({
        specialistId: "crafter",
        workspaceId: "ws-1",
        prompt: "Create a status card.",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: "Specialist output did not contain usable canvas TSX",
      sessionId: "sess-1",
    }));
  });

  it("validates required fields", async () => {
    const request = new NextRequest("http://localhost/api/canvas/specialist", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: "ws-1",
        prompt: "Create a status card.",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "specialistId is required" });
  });
});
