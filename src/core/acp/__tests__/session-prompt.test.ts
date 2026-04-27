import { beforeEach, describe, expect, it, vi } from "vitest";

import { AcpError } from "../acp-process";

const managerMock = vi.hoisted(() => ({
  hasActiveSession: vi.fn(),
  isOpencodeAdapterSession: vi.fn(),
  isOpencodeSdkSessionAsync: vi.fn(),
  getOrRecreateOpencodeSdkAdapter: vi.fn(),
  isDockerAdapterSession: vi.fn(),
  getDockerAdapter: vi.fn(),
  isClaudeCodeSdkSessionAsync: vi.fn(),
  getOrRecreateClaudeCodeSdkAdapter: vi.fn(),
  isClaudeSession: vi.fn(),
  getClaudeProcess: vi.fn(),
  killSession: vi.fn(),
  createClaudeSession: vi.fn(),
  getProcess: vi.fn(),
  getAcpSessionId: vi.fn(),
  getPresetId: vi.fn(),
}));

const storeMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  getHistory: vi.fn(() => []),
  updateSessionAcpStatus: vi.fn(),
  pushUserMessage: vi.fn(),
  flushAgentBuffer: vi.fn(),
  enterStreamingMode: vi.fn(),
  exitStreamingMode: vi.fn(),
  markFirstPromptSent: vi.fn(),
  upsertSession: vi.fn(),
  pushNotification: vi.fn(),
}));

const getPresetByIdMock = vi.hoisted(() => vi.fn());
const isServerlessEnvironmentMock = vi.hoisted(() => vi.fn(() => false));
const isOpencodeServerConfiguredMock = vi.hoisted(() => vi.fn(() => false));
const getDockerDetectorMock = vi.hoisted(() => vi.fn(() => ({
  checkAvailability: vi.fn(async () => ({ available: false, error: "docker unavailable" })),
})));
const isClaudeCodeSdkConfiguredMock = vi.hoisted(() => vi.fn(() => false));
const getRoutaOrchestratorMock = vi.hoisted(() => vi.fn(() => null));
const getRoutaSystemMock = vi.hoisted(() => vi.fn(() => ({
  agentStore: { get: vi.fn() },
})));
const ensureMcpForProviderMock = vi.hoisted(() => vi.fn(async () => ({ mcpConfigs: [] })));
const getDefaultRoutaMcpConfigMock = vi.hoisted(() => vi.fn());
const consumeAcpPromptResponseMock = vi.hoisted(() => vi.fn(async () => {}));
const buildCoordinatorPromptMock = vi.hoisted(() => vi.fn(() => "coordinator prompt"));
const recordTraceMock = vi.hoisted(() => vi.fn());
const createTraceRecordMock = vi.hoisted(() => vi.fn((sessionId: string, type: string, metadata: unknown) => ({
  sessionId,
  type,
  metadata,
})));
const withWorkspaceIdMock = vi.hoisted(() => vi.fn((record: Record<string, unknown>) => record));
const withMetadataMock = vi.hoisted(() => vi.fn((record: Record<string, unknown>) => record));
const loadSessionFromDbMock = vi.hoisted(() => vi.fn());
const loadSessionFromLocalStorageMock = vi.hoisted(() => vi.fn());
const persistSessionToDbMock = vi.hoisted(() => vi.fn(async () => {}));
const updateSessionExecutionBindingInDbMock = vi.hoisted(() => vi.fn(async () => {}));
const resolveSkillContentMock = vi.hoisted(() => vi.fn(async () => undefined));
const buildExecutionBindingMock = vi.hoisted(() => vi.fn(() => ({ executionMode: "embedded" as const })));
const getEmbeddedOwnershipIssueMock = vi.hoisted(() => vi.fn(() => null));
const refreshExecutionBindingMock = vi.hoisted(() => vi.fn((record: Record<string, unknown>) => record));
const persistSessionHistorySnapshotMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/core/acp/processer", () => ({
  getAcpProcessManager: () => managerMock,
}));

vi.mock("@/core/acp/http-session-store", () => ({
  getHttpSessionStore: () => storeMock,
}));

vi.mock("@/core/acp/acp-presets", () => ({
  getPresetById: getPresetByIdMock,
}));

vi.mock("@/core/acp/api-based-providers", () => ({
  isServerlessEnvironment: isServerlessEnvironmentMock,
}));

vi.mock("@/core/acp/opencode-sdk-adapter", () => ({
  isOpencodeServerConfigured: isOpencodeServerConfiguredMock,
}));

vi.mock("@/core/acp/docker/detector", () => ({
  getDockerDetector: getDockerDetectorMock,
}));

vi.mock("@/core/acp/docker/utils", () => ({
  DEFAULT_DOCKER_AGENT_IMAGE: "docker-image",
}));

vi.mock("@/core/acp/claude-code-sdk-adapter", () => ({
  isClaudeCodeSdkConfigured: isClaudeCodeSdkConfiguredMock,
}));

vi.mock("@/core/orchestration/orchestrator-singleton", () => ({
  getRoutaOrchestrator: getRoutaOrchestratorMock,
}));

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: getRoutaSystemMock,
}));

vi.mock("@/core/acp/mcp-setup", () => ({
  ensureMcpForProvider: ensureMcpForProviderMock,
}));

vi.mock("@/core/acp/mcp-config-generator", () => ({
  getDefaultRoutaMcpConfig: getDefaultRoutaMcpConfigMock,
}));

vi.mock("@/core/acp/prompt-response", () => ({
  consumeAcpPromptResponse: consumeAcpPromptResponseMock,
}));

vi.mock("@/core/orchestration/specialist-prompts", () => ({
  buildCoordinatorPrompt: buildCoordinatorPromptMock,
}));

vi.mock("@/core/trace", () => ({
  createTraceRecord: createTraceRecordMock,
  withWorkspaceId: withWorkspaceIdMock,
  withMetadata: withMetadataMock,
  recordTrace: recordTraceMock,
}));

vi.mock("@/core/acp/session-db-persister", () => ({
  loadSessionFromDb: loadSessionFromDbMock,
  loadSessionFromLocalStorage: loadSessionFromLocalStorageMock,
  persistSessionToDb: persistSessionToDbMock,
  updateSessionExecutionBindingInDb: updateSessionExecutionBindingInDbMock,
}));

vi.mock("@/core/skills/skill-resolver", () => ({
  resolveSkillContent: resolveSkillContentMock,
}));

vi.mock("@/core/acp/execution-backend", () => ({
  buildExecutionBinding: buildExecutionBindingMock,
  getEmbeddedOwnershipIssue: getEmbeddedOwnershipIssueMock,
  refreshExecutionBinding: refreshExecutionBindingMock,
}));

vi.mock("@/core/acp/pending-acp-creations", () => ({
  pendingAcpCreations: new Map<string, Promise<void>>(),
}));

vi.mock("@/core/acp/session-history", () => ({
  persistSessionHistorySnapshot: persistSessionHistorySnapshotMock,
}));

const {
  dispatchSessionPrompt,
  handleSessionPrompt,
  isSessionPromptTimeoutError,
} = await import("../session-prompt");

describe("session-prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    managerMock.hasActiveSession.mockReturnValue(true);
    managerMock.isOpencodeAdapterSession.mockReturnValue(false);
    managerMock.isOpencodeSdkSessionAsync.mockResolvedValue(false);
    managerMock.getOrRecreateOpencodeSdkAdapter.mockResolvedValue(undefined);
    managerMock.isDockerAdapterSession.mockReturnValue(false);
    managerMock.getDockerAdapter.mockReturnValue(undefined);
    managerMock.isClaudeCodeSdkSessionAsync.mockResolvedValue(false);
    managerMock.getOrRecreateClaudeCodeSdkAdapter.mockResolvedValue(undefined);
    managerMock.isClaudeSession.mockReturnValue(false);
    managerMock.getClaudeProcess.mockReturnValue(undefined);
    managerMock.getProcess.mockReturnValue(undefined);
    managerMock.getAcpSessionId.mockReturnValue(undefined);
    managerMock.getPresetId.mockReturnValue("opencode");
    storeMock.getHistory.mockReturnValue([]);

    storeMock.getSession.mockImplementation((sessionId: string) => ({
      sessionId,
      cwd: "/workspace",
      workspaceId: "ws-1",
      provider: "opencode",
      createdAt: new Date().toISOString(),
    }));

    getPresetByIdMock.mockReturnValue(null);
    isServerlessEnvironmentMock.mockReturnValue(false);
    loadSessionFromDbMock.mockResolvedValue(undefined);
    loadSessionFromLocalStorageMock.mockResolvedValue(undefined);
    getEmbeddedOwnershipIssueMock.mockReturnValue(null);
  });

  it("detects session/prompt timeout errors", () => {
    expect(isSessionPromptTimeoutError(new Error("Timeout waiting for session/prompt (id=3)"))).toBe(true);
  });

  it("ignores non-timeout prompt errors", () => {
    expect(isSessionPromptTimeoutError(new Error("Permission denied"))).toBe(false);
    expect(isSessionPromptTimeoutError("Timeout waiting for session/prompt (id=3)")).toBe(false);
  });

  it("returns a JSON-RPC error when sessionId is missing", async () => {
    const response = await handleSessionPrompt({
      id: 1,
      params: {},
      jsonrpcResponse: (id, result, error) => new Response(JSON.stringify({ id, result, error })),
      createSessionUpdateForwarder: () => vi.fn(),
      buildMcpConfigForClaude: vi.fn(async () => []),
      requireWorkspaceId: vi.fn(() => null),
      encodeSsePayload: JSON.stringify,
    });

    const payload = await response.json() as { error: { code: number; message: string } };
    expect(payload.error).toEqual({
      code: -32602,
      message: "Missing sessionId",
    });
  });

  it("fails auto-create when workspaceId cannot be recovered", async () => {
    managerMock.hasActiveSession.mockReturnValue(false);
    storeMock.getSession.mockReturnValue(undefined);

    const response = await handleSessionPrompt({
      id: 2,
      params: {
        sessionId: "missing-session",
        prompt: "hello",
      },
      jsonrpcResponse: (id, result, error) => new Response(JSON.stringify({ id, result, error })),
      createSessionUpdateForwarder: () => vi.fn(),
      buildMcpConfigForClaude: vi.fn(async () => []),
      requireWorkspaceId: vi.fn(() => null),
      encodeSsePayload: JSON.stringify,
    });

    const payload = await response.json() as { error: { code: number; message: string } };
    expect(payload.error).toEqual({
      code: -32602,
      message: "workspaceId is required to recreate the session",
    });
  });

  it("returns an error when the OpenCode SDK adapter exists but is disconnected", async () => {
    managerMock.isOpencodeAdapterSession.mockReturnValue(true);
    managerMock.getOrRecreateOpencodeSdkAdapter.mockResolvedValue({
      alive: false,
    });

    const response = await handleSessionPrompt({
      id: 3,
      params: {
        sessionId: "opc-1",
        prompt: "hello",
      },
      jsonrpcResponse: (id, result, error) => new Response(JSON.stringify({ id, result, error })),
      createSessionUpdateForwarder: () => vi.fn(),
      buildMcpConfigForClaude: vi.fn(async () => []),
      requireWorkspaceId: vi.fn(() => "ws-1"),
      encodeSsePayload: JSON.stringify,
    });

    const payload = await response.json() as { error: { code: number; message: string } };
    expect(payload.error).toEqual({
      code: -32000,
      message: "OpenCode SDK adapter is not connected",
    });
    expect(storeMock.pushUserMessage).toHaveBeenCalledWith("opc-1", "hello");
  });

  it("returns a pending response when a Claude prompt times out", async () => {
    managerMock.isClaudeSession.mockReturnValue(true);
    managerMock.getClaudeProcess.mockReturnValue({
      alive: true,
      prompt: vi.fn(async () => {
        throw new Error("Timeout waiting for session/prompt (id=9)");
      }),
    });

    const response = await handleSessionPrompt({
      id: 4,
      params: {
        sessionId: "claude-1",
        prompt: "continue",
      },
      jsonrpcResponse: (id, result, error) => new Response(JSON.stringify({ id, result, error })),
      createSessionUpdateForwarder: () => vi.fn(),
      buildMcpConfigForClaude: vi.fn(async () => []),
      requireWorkspaceId: vi.fn(() => "ws-1"),
      encodeSsePayload: JSON.stringify,
    });

    const payload = await response.json() as { result: { sessionId: string; pending: boolean } };
    expect(payload.result).toEqual({
      sessionId: "claude-1",
      pending: true,
    });
    expect(storeMock.flushAgentBuffer).toHaveBeenCalledWith("claude-1");
  });

  it("returns ACP-shaped error data for standard process failures", async () => {
    managerMock.getProcess.mockReturnValue({
      alive: true,
      prompt: vi.fn(async () => {
        throw new AcpError(
          "Authentication required",
          401,
          [{ id: "oauth", name: "OAuth", description: "login" }],
          { name: "codex", version: "1.0.0" },
          { detail: "login first" },
        );
      }),
    });
    managerMock.getAcpSessionId.mockReturnValue("agent-123");

    const response = await handleSessionPrompt({
      id: 5,
      params: {
        sessionId: "proc-1",
        prompt: "fix it",
      },
      jsonrpcResponse: (id, result, error) => new Response(JSON.stringify({ id, result, error })),
      createSessionUpdateForwarder: () => vi.fn(),
      buildMcpConfigForClaude: vi.fn(async () => []),
      requireWorkspaceId: vi.fn(() => "ws-1"),
      encodeSsePayload: JSON.stringify,
    });

    const payload = await response.json() as {
      error: {
        code: number;
        message: string;
        data: Record<string, unknown>;
      };
    };

    expect(payload.error.code).toBe(-32000);
    expect(payload.error.message).toBe("Authentication required");
    expect(payload.error.data).toMatchObject({
      source: "acp",
      code: 401,
      agentInfo: { name: "codex", version: "1.0.0" },
    });
    expect(storeMock.updateSessionAcpStatus).toHaveBeenCalledWith(
      "proc-1",
      "error",
      "Authentication required",
    );
  });

  it("dispatches prompt responses through consumeAcpPromptResponse", async () => {
    managerMock.getProcess.mockReturnValue({
      alive: true,
      prompt: vi.fn(async () => ({ stopReason: "end_turn" })),
    });
    managerMock.getAcpSessionId.mockReturnValue("agent-456");

    await dispatchSessionPrompt({
      sessionId: "dispatch-1",
      prompt: "ship it",
      workspaceId: "ws-1",
    });

    expect(consumeAcpPromptResponseMock).toHaveBeenCalledOnce();
    expect(storeMock.pushUserMessage).toHaveBeenCalledWith("dispatch-1", "ship it");
  });

  it("pushes a synthetic turn_complete notification when prompt returns only stopReason", async () => {
    managerMock.getProcess.mockReturnValue({
      alive: true,
      prompt: vi.fn(async () => ({ stopReason: "end_turn" })),
    });
    managerMock.getAcpSessionId.mockReturnValue("agent-789");

    await handleSessionPrompt({
      id: 6,
      params: {
        sessionId: "proc-2",
        prompt: "continue",
      },
      jsonrpcResponse: (id, result, error) => new Response(JSON.stringify({ id, result, error })),
      createSessionUpdateForwarder: () => vi.fn(),
      buildMcpConfigForClaude: vi.fn(async () => []),
      requireWorkspaceId: vi.fn(() => "ws-1"),
      encodeSsePayload: JSON.stringify,
    });

    expect(storeMock.pushNotification).toHaveBeenCalledWith({
      sessionId: "proc-2",
      update: {
        sessionUpdate: "turn_complete",
        stopReason: "end_turn",
      },
    });
  });
});
