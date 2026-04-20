import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getHttpSessionStore,
  httpSessionStore,
  getAcpProcessManager,
  acpProcessManager,
  getSessionWriteBuffer,
  sessionWriteBuffer,
  getSessionRoutingRecord,
  getRequiredRunnerUrl,
  isForwardedAcpRequest,
  proxyRequestToRunner,
  runnerUnavailableResponse,
  loadHistorySinceEventIdFromDb,
  loadSessionFromDb,
  loadSessionFromLocalStorage,
  persistSessionToDb,
  updateSessionExecutionBindingInDb,
} = vi.hoisted(() => {
  const store = {
    attachSse: vi.fn(),
    pushConnected: vi.fn(),
    detachSse: vi.fn(),
    flushAgentBuffer: vi.fn(),
    getSession: vi.fn(),
    getConsolidatedHistory: vi.fn(() => []),
    upsertSession: vi.fn(),
    pushNotification: vi.fn(),
    pushUserMessage: vi.fn(),
  };
  const processManager = {
    createSession: vi.fn(),
    loadSession: vi.fn(),
    hasActiveSession: vi.fn(),
    respondToUserInput: vi.fn(),
    getProcess: vi.fn(),
    getClaudeProcess: vi.fn(),
    isClaudeSession: vi.fn(),
    getAcpSessionId: vi.fn(),
    isDockerAdapterSession: vi.fn(),
    isOpencodeAdapterSession: vi.fn(),
    isClaudeCodeSdkSession: vi.fn(),
    isClaudeCodeSdkSessionAsync: vi.fn(),
    isOpencodeSdkSessionAsync: vi.fn(),
    getOrRecreateClaudeCodeSdkAdapter: vi.fn(),
    getOpencodeAdapter: vi.fn(),
    getDockerAdapter: vi.fn(),
    cancel: vi.fn(),
  };
  const writeBuffer = {
    add: vi.fn(),
    replace: vi.fn(),
    flush: vi.fn(),
  };

  return {
    getHttpSessionStore: vi.fn(() => store),
    httpSessionStore: store,
    getAcpProcessManager: vi.fn(() => processManager),
    acpProcessManager: processManager,
    getSessionWriteBuffer: vi.fn(() => writeBuffer),
    sessionWriteBuffer: writeBuffer,
    getSessionRoutingRecord: vi.fn(),
    getRequiredRunnerUrl: vi.fn(),
    isForwardedAcpRequest: vi.fn(),
    proxyRequestToRunner: vi.fn(),
    runnerUnavailableResponse: vi.fn(),
    loadHistorySinceEventIdFromDb: vi.fn(),
    loadSessionFromDb: vi.fn(),
    loadSessionFromLocalStorage: vi.fn(),
    persistSessionToDb: vi.fn(),
    updateSessionExecutionBindingInDb: vi.fn(),
  };
});

vi.mock("@/core/acp/http-session-store", () => ({
  getHttpSessionStore,
}));

vi.mock("@/core/acp/processer", () => ({
  getAcpProcessManager,
}));

vi.mock("../acp-session-history", () => ({
  getSessionWriteBuffer,
}));

vi.mock("@/core/acp/runner-routing", () => ({
  getSessionRoutingRecord,
  getRequiredRunnerUrl,
  isForwardedAcpRequest,
  proxyRequestToRunner,
  runnerUnavailableResponse,
}));

vi.mock("@/core/acp/session-db-persister", async () => {
  const actual = await vi.importActual<typeof import("@/core/acp/session-db-persister")>(
    "@/core/acp/session-db-persister",
  );
  return {
    ...actual,
    loadHistorySinceEventIdFromDb,
    loadSessionFromDb,
    loadSessionFromLocalStorage,
    persistSessionToDb,
    updateSessionExecutionBindingInDb,
  };
});

import { GET, POST } from "../route";

async function readStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let result = "";

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    result += decoder.decode(chunk.value, { stream: true });
    if (result.includes("data: ")) {
      break;
    }
  }

  reader.cancel().catch(() => {});
  return result;
}

describe("/api/acp GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isForwardedAcpRequest.mockReturnValue(false);
    getSessionRoutingRecord.mockResolvedValue(undefined);
    getRequiredRunnerUrl.mockReturnValue(null);
    runnerUnavailableResponse.mockReturnValue(new Response("runner unavailable", { status: 503 }));
    proxyRequestToRunner.mockResolvedValue(new Response("proxied", { status: 200 }));
    loadHistorySinceEventIdFromDb.mockResolvedValue([]);
    loadSessionFromDb.mockResolvedValue(null);
    loadSessionFromLocalStorage.mockResolvedValue(null);
    persistSessionToDb.mockResolvedValue(undefined);
    updateSessionExecutionBindingInDb.mockResolvedValue(undefined);

    httpSessionStore.attachSse.mockReset();
    httpSessionStore.pushConnected.mockReset();
    httpSessionStore.detachSse.mockReset();
    httpSessionStore.flushAgentBuffer.mockReset();
    httpSessionStore.getSession.mockReset();
    httpSessionStore.getConsolidatedHistory.mockReset();
    httpSessionStore.upsertSession.mockReset();
    httpSessionStore.pushNotification.mockReset();
    httpSessionStore.pushUserMessage.mockReset();
    httpSessionStore.getSession.mockReturnValue({ cwd: "/tmp/session" });
    httpSessionStore.getConsolidatedHistory.mockReturnValue([]);
    acpProcessManager.respondToUserInput.mockReset();
    acpProcessManager.createSession.mockReset();
    acpProcessManager.loadSession.mockReset();
    acpProcessManager.hasActiveSession.mockReset();
    acpProcessManager.getProcess.mockReset();
    acpProcessManager.getClaudeProcess.mockReset();
    acpProcessManager.isClaudeSession.mockReset();
    acpProcessManager.getAcpSessionId.mockReset();
    acpProcessManager.isDockerAdapterSession.mockReset();
    acpProcessManager.isOpencodeAdapterSession.mockReset();
    acpProcessManager.isClaudeCodeSdkSession.mockReset();
    acpProcessManager.isClaudeCodeSdkSessionAsync.mockReset();
    acpProcessManager.isOpencodeSdkSessionAsync.mockReset();
    acpProcessManager.getOrRecreateClaudeCodeSdkAdapter.mockReset();
    acpProcessManager.getOpencodeAdapter.mockReset();
    acpProcessManager.getDockerAdapter.mockReset();
    acpProcessManager.cancel.mockReset();
    acpProcessManager.getProcess.mockReturnValue(undefined);
    acpProcessManager.getClaudeProcess.mockReturnValue(undefined);
    acpProcessManager.isClaudeSession.mockReturnValue(false);
    acpProcessManager.hasActiveSession.mockReturnValue(false);
    acpProcessManager.getAcpSessionId.mockReturnValue(undefined);
    acpProcessManager.isDockerAdapterSession.mockReturnValue(false);
    acpProcessManager.isOpencodeAdapterSession.mockReturnValue(false);
    acpProcessManager.isClaudeCodeSdkSession.mockReturnValue(false);
    acpProcessManager.isClaudeCodeSdkSessionAsync.mockResolvedValue(false);
    acpProcessManager.isOpencodeSdkSessionAsync.mockResolvedValue(false);
    acpProcessManager.getOrRecreateClaudeCodeSdkAdapter.mockResolvedValue(undefined);
    sessionWriteBuffer.add.mockReset();
    sessionWriteBuffer.replace.mockReset();
    sessionWriteBuffer.flush.mockReset();
    sessionWriteBuffer.flush.mockResolvedValue(undefined);
  });

  it("replays events after lastEventId before attaching the live SSE stream", async () => {
    loadHistorySinceEventIdFromDb.mockResolvedValue([
      {
        sessionId: "session-1",
        eventId: "evt-2",
        update: { sessionUpdate: "agent_message", content: { type: "text", text: "replayed" } },
      },
    ]);

    const response = await GET(
      new NextRequest("http://localhost/api/acp?sessionId=session-1&lastEventId=evt-1"),
    );
    const body = await readStream(response);

    expect(loadHistorySinceEventIdFromDb).toHaveBeenCalledWith("session-1", "evt-1", "/tmp/session");
    expect(body).toContain("id: evt-2");
    expect(body).toContain("\"sessionUpdate\":\"agent_message\"");
    expect(httpSessionStore.attachSse).toHaveBeenCalledWith(
      "session-1",
      expect.anything(),
      { skipPending: true },
    );
    expect(httpSessionStore.pushConnected).toHaveBeenCalledWith("session-1");
  });

  it("falls back to normal SSE attach when no replay tail exists", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/acp?sessionId=session-1"),
    );

    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(httpSessionStore.attachSse).toHaveBeenCalledWith(
      "session-1",
      expect.anything(),
      { skipPending: false },
    );
  });

  it("refreshes the embedded lease when the current instance attaches SSE", async () => {
    getSessionRoutingRecord.mockResolvedValue({
      sessionId: "session-1",
      executionMode: "embedded",
      ownerInstanceId: `next-${process.pid}`,
      leaseExpiresAt: "2000-01-01T00:00:00.000Z",
      createdAt: "2026-03-28T00:00:00.000Z",
      cwd: "/tmp/session",
      workspaceId: "default",
    });

    const response = await GET(
      new NextRequest("http://localhost/api/acp?sessionId=session-1"),
    );

    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(httpSessionStore.attachSse).toHaveBeenCalled();
    expect(httpSessionStore.upsertSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        executionMode: "embedded",
        ownerInstanceId: `next-${process.pid}`,
        leaseExpiresAt: expect.any(String),
      }),
    );
    expect(updateSessionExecutionBindingInDb).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        executionMode: "embedded",
        ownerInstanceId: `next-${process.pid}`,
        leaseExpiresAt: expect.any(String),
      }),
    );
  });

  it("supports probe mode without attaching the live SSE stream", async () => {
    getSessionRoutingRecord.mockResolvedValue({
      sessionId: "session-1",
      executionMode: "embedded",
      ownerInstanceId: `next-${process.pid}`,
      leaseExpiresAt: "2000-01-01T00:00:00.000Z",
      createdAt: "2026-03-28T00:00:00.000Z",
      cwd: "/tmp/session",
      workspaceId: "default",
    });

    const response = await GET(
      new NextRequest("http://localhost/api/acp?sessionId=session-1&probe=1"),
    );

    expect(response.status).toBe(204);
    expect(httpSessionStore.attachSse).not.toHaveBeenCalled();
    expect(httpSessionStore.pushConnected).not.toHaveBeenCalled();
    expect(httpSessionStore.upsertSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        executionMode: "embedded",
      }),
    );
  });

  it("rejects SSE attach when an embedded session is owned by another instance", async () => {
    getSessionRoutingRecord.mockResolvedValue({
      executionMode: "embedded",
      ownerInstanceId: "web-2",
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
    });

    const response = await GET(
      new NextRequest("http://localhost/api/acp?sessionId=session-1"),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("owned by instance web-2"),
      ownerInstanceId: "web-2",
    });
    expect(httpSessionStore.attachSse).not.toHaveBeenCalled();
  });
});

describe("/api/acp POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isForwardedAcpRequest.mockReturnValue(false);
    getRequiredRunnerUrl.mockReturnValue(null);
    updateSessionExecutionBindingInDb.mockResolvedValue(undefined);
    httpSessionStore.upsertSession.mockReset();
    httpSessionStore.pushNotification.mockReset();
    acpProcessManager.respondToUserInput.mockReset();
    acpProcessManager.getProcess.mockReset();
    acpProcessManager.getClaudeProcess.mockReset();
    acpProcessManager.isDockerAdapterSession.mockReset();
    acpProcessManager.isOpencodeAdapterSession.mockReset();
    acpProcessManager.isClaudeCodeSdkSession.mockReset();
    acpProcessManager.isClaudeCodeSdkSessionAsync.mockReset();
    acpProcessManager.isOpencodeSdkSessionAsync.mockReset();
    acpProcessManager.getOrRecreateClaudeCodeSdkAdapter.mockReset();
    acpProcessManager.getOpencodeAdapter.mockReset();
    acpProcessManager.getDockerAdapter.mockReset();
    acpProcessManager.cancel.mockReset();
    acpProcessManager.getProcess.mockReturnValue(undefined);
    acpProcessManager.getClaudeProcess.mockReturnValue(undefined);
    acpProcessManager.isDockerAdapterSession.mockReturnValue(false);
    acpProcessManager.isOpencodeAdapterSession.mockReturnValue(false);
    acpProcessManager.isClaudeCodeSdkSession.mockReturnValue(false);
    acpProcessManager.isClaudeCodeSdkSessionAsync.mockResolvedValue(false);
    acpProcessManager.isOpencodeSdkSessionAsync.mockResolvedValue(false);
    acpProcessManager.getOrRecreateClaudeCodeSdkAdapter.mockResolvedValue(undefined);
    sessionWriteBuffer.add.mockReset();
    sessionWriteBuffer.flush.mockReset();
    sessionWriteBuffer.flush.mockResolvedValue(undefined);
  });

  it("returns ACP capabilities for initialize before any process exists", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/acp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: 1 },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
        },
        agentInfo: {
          name: "routa-acp",
          version: "0.1.0",
        },
      },
    });
  });

  it("rejects session/new when workspaceId is missing", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/acp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "session/new",
          params: {
            provider: "opencode",
            cwd: "/tmp/project",
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      error: {
        code: -32602,
        message: "workspaceId is required",
      },
    });
  });

  it("rejects prompt methods when an embedded session is owned by another instance", async () => {
    getRequiredRunnerUrl.mockReturnValue("http://runner.internal");
    getSessionRoutingRecord.mockResolvedValue({
      executionMode: "embedded",
      ownerInstanceId: "web-2",
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
    });

    const response = await POST(
      new NextRequest("http://localhost/api/acp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "session/prompt",
          params: {
            sessionId: "session-1",
            prompt: {
              role: "user",
              content: [{ type: "text", text: "hello" }],
            },
          },
        }),
      }),
    );

    expect(proxyRequestToRunner).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      error: {
        code: -32010,
        message: expect.stringContaining("owned by instance web-2"),
      },
    });
  });

  it("refreshes the embedded lease before handling session methods on the owner instance", async () => {
    getRequiredRunnerUrl.mockReturnValue("http://runner.internal");
    getSessionRoutingRecord.mockResolvedValue({
      sessionId: "session-1",
      executionMode: "embedded",
      ownerInstanceId: `next-${process.pid}`,
      leaseExpiresAt: "2000-01-01T00:00:00.000Z",
      createdAt: "2026-03-28T00:00:00.000Z",
      cwd: "/tmp/session",
      workspaceId: "default",
    });

    const response = await POST(
      new NextRequest("http://localhost/api/acp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "session/cancel",
          params: { sessionId: "session-1" },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(httpSessionStore.upsertSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        executionMode: "embedded",
        ownerInstanceId: `next-${process.pid}`,
        leaseExpiresAt: expect.any(String),
      }),
    );
    expect(updateSessionExecutionBindingInDb).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        executionMode: "embedded",
        ownerInstanceId: `next-${process.pid}`,
        leaseExpiresAt: expect.any(String),
      }),
    );
  });

  it("recreates prompt sessions using local session metadata when the in-memory store is empty", async () => {
    httpSessionStore.getSession.mockReturnValue(undefined);
    loadSessionFromLocalStorage.mockResolvedValue({
      id: "session-1",
      name: "Recovered session",
      cwd: "/tmp/recovered",
      workspaceId: "workspace-1",
      provider: "opencode",
      role: "CRAFTER",
      specialistId: "kanban-backlog-refiner",
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
    });

    const response = await POST(
      new NextRequest("http://localhost/api/acp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 5,
          method: "session/prompt",
          params: {
            sessionId: "session-1",
            prompt: [{ type: "text", text: "continue" }],
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.not.toMatchObject({
      error: {
        message: "workspaceId is required to recreate the session",
      },
    });
    expect(loadSessionFromLocalStorage).toHaveBeenCalledWith("session-1");
  });

  it("loads persisted codex sessions through the native resume path", async () => {
    httpSessionStore.getSession.mockReturnValue(undefined);
    loadSessionFromDb.mockResolvedValue({
      id: "session-codex",
      name: "Resume Codex",
      cwd: "/tmp/codex",
      workspaceId: "workspace-1",
      provider: "codex",
      role: "DEVELOPER",
      routaAgentId: "codex-thread-1",
      createdAt: new Date("2026-04-08T00:00:00.000Z"),
    });
    acpProcessManager.loadSession.mockResolvedValue("session-codex");

    const response = await POST(
      new NextRequest("http://localhost/api/acp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 8,
          method: "session/load",
          params: {
            sessionId: "session-codex",
          },
        }),
      }),
    );

    expect(acpProcessManager.loadSession).toHaveBeenCalledWith(
      "session-codex",
      "/tmp/codex",
      expect.any(Function),
      "codex",
      "workspace-1",
      undefined,
      undefined,
      {
        provider: "codex",
        role: "DEVELOPER",
      },
      "codex-thread-1",
    );
    expect(acpProcessManager.createSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 8,
      result: {
        sessionId: "session-codex",
        provider: "codex",
        role: "DEVELOPER",
        acpStatus: "ready",
        resumeMode: "native",
      },
    });
  });

  it("falls back to recreate when native codex resume fails", async () => {
    httpSessionStore.getSession.mockReturnValue(undefined);
    loadSessionFromDb.mockResolvedValue({
      id: "session-codex",
      cwd: "/tmp/codex",
      workspaceId: "workspace-1",
      provider: "codex",
      role: "CRAFTER",
      createdAt: new Date("2026-04-08T00:00:00.000Z"),
    });
    acpProcessManager.loadSession.mockRejectedValue(new Error("rollout missing"));
    acpProcessManager.createSession.mockResolvedValue("session-codex");

    const response = await POST(
      new NextRequest("http://localhost/api/acp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 9,
          method: "session/load",
          params: {
            sessionId: "session-codex",
          },
        }),
      }),
    );

    expect(acpProcessManager.createSession).toHaveBeenCalledWith(
      "session-codex",
      "/tmp/codex",
      expect.any(Function),
      "codex",
      undefined,
      undefined,
      undefined,
      "workspace-1",
      undefined,
      undefined,
      {
        provider: "codex",
        role: "CRAFTER",
      },
    );
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 9,
      result: {
        sessionId: "session-codex",
        provider: "codex",
        role: "CRAFTER",
        acpStatus: "ready",
        resumeMode: "recreated",
        nativeResumeError: "rollout missing",
      },
    });
  });

  it("rejects prompt auto-recreate when recovered embedded session belongs to another instance", async () => {
    httpSessionStore.getSession.mockReturnValue(undefined);
    loadSessionFromDb.mockResolvedValue({
      id: "session-1",
      cwd: "/tmp/recovered",
      workspaceId: "workspace-1",
      provider: "codex",
      role: "CRAFTER",
      executionMode: "embedded",
      ownerInstanceId: "web-2",
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
      createdAt: new Date("2026-04-08T00:00:00.000Z"),
    });

    const response = await POST(
      new NextRequest("http://localhost/api/acp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          method: "session/prompt",
          params: {
            sessionId: "session-1",
            prompt: [{ type: "text", text: "continue" }],
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 7,
      error: {
        code: -32010,
        message: expect.stringContaining("owned by instance web-2"),
      },
    });
  });

  it("marks missing interactive requests as failed so stale permission cards disappear after refresh", async () => {
    acpProcessManager.respondToUserInput.mockReturnValue(false);

    const response = await POST(
      new NextRequest("http://localhost/api/acp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 6,
          method: "session/respond_user_input",
          params: {
            sessionId: "session-1",
            toolCallId: "request-permission-1",
            response: {
              decision: "deny",
              scope: "turn",
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 6,
      error: {
        code: -32000,
        message: "No pending interactive request found for this session",
      },
    });
    expect(httpSessionStore.pushNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        update: expect.objectContaining({
          sessionUpdate: "tool_call_update",
          toolCallId: "request-permission-1",
          status: "failed",
          rawOutput: {
            message: "No pending interactive request found for this session",
          },
        }),
      }),
    );
    expect(sessionWriteBuffer.add).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        sessionId: "session-1",
      }),
    );
    expect(sessionWriteBuffer.flush).toHaveBeenCalledWith("session-1");
  });
});
