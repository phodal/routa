import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureMcpForProviderMock = vi.hoisted(() => vi.fn());
const cleanupMcpForProviderMock = vi.hoisted(() => vi.fn());
const providerSupportsMcpMock = vi.hoisted(() => vi.fn());
const shouldUseOpencodeAdapterMock = vi.hoisted(() => vi.fn());
const getOpencodeServerUrlMock = vi.hoisted(() => vi.fn());
const isOpencodeDirectApiConfiguredMock = vi.hoisted(() => vi.fn());
const shouldUseClaudeCodeSdkAdapterMock = vi.hoisted(() => vi.fn());
const buildConfigFromPresetMock = vi.hoisted(() => vi.fn());
const buildClaudeCodeConfigMock = vi.hoisted(() => vi.fn());
const mapClaudeModeToPermissionModeMock = vi.hoisted(() => vi.fn());
const getDefaultRoutaMcpConfigMock = vi.hoisted(() => vi.fn());
const getHttpSessionStoreMock = vi.hoisted(() => vi.fn());
const isServerlessEnvironmentMock = vi.hoisted(() => vi.fn());
const getDatabaseDriverMock = vi.hoisted(() => vi.fn());
const getPostgresDatabaseMock = vi.hoisted(() => vi.fn());
const pgGetMock = vi.hoisted(() => vi.fn());
const dockerStopContainerMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const dockerStopAllMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const getDockerProcessManagerMock = vi.hoisted(() => vi.fn());
const opencodeConnectMock = vi.hoisted(() => vi.fn());
const opencodeCreateSessionMock = vi.hoisted(() => vi.fn());
const directConnectMock = vi.hoisted(() => vi.fn());
const directCreateSessionMock = vi.hoisted(() => vi.fn());
const claudeSdkConnectMock = vi.hoisted(() => vi.fn());
const claudeSdkCreateSessionMock = vi.hoisted(() => vi.fn());
const workspaceConnectMock = vi.hoisted(() => vi.fn());
const workspaceCreateSessionMock = vi.hoisted(() => vi.fn());

const acpInstances: Array<Record<string, unknown>> = [];
const claudeInstances: Array<Record<string, unknown>> = [];
const opencodeInstances: Array<Record<string, unknown>> = [];
const directInstances: Array<Record<string, unknown>> = [];
const claudeSdkInstances: Array<Record<string, unknown>> = [];
const workspaceInstances: Array<Record<string, unknown>> = [];

vi.mock("@/core/acp/process-config", () => ({
  buildConfigFromPreset: buildConfigFromPresetMock,
  buildConfigFromInline: vi.fn(),
}));

vi.mock("@/core/acp/acp-process", () => ({
  AcpProcess: class AcpProcess {
    config: unknown;
    onNotification: unknown;
    alive = true;
    sessionId?: string;
    start = vi.fn(async () => {});
    initialize = vi.fn(async () => {});
    newSession = vi.fn(async () => "acp-session-1");
    loadSession = vi.fn(async () => {});
    setSessionContext = vi.fn();
    sendRequest = vi.fn(async () => {});
    respondToUserInput = vi.fn(() => false);
    kill = vi.fn(() => {
      this.alive = false;
    });

    constructor(config: unknown, onNotification: unknown) {
      this.config = config;
      this.onNotification = onNotification;
      acpInstances.push(this as unknown as Record<string, unknown>);
    }
  },
}));

vi.mock("@/core/acp/claude-code-process", () => ({
  ClaudeCodeProcess: class ClaudeCodeProcess {
    config: unknown;
    alive = true;
    start = vi.fn(async () => {});
    setPermissionMode = vi.fn();
    kill = vi.fn(() => {
      this.alive = false;
    });

    constructor(config: unknown) {
      this.config = config;
      claudeInstances.push(this as unknown as Record<string, unknown>);
    }
  },
  buildClaudeCodeConfig: buildClaudeCodeConfigMock,
  mapClaudeModeToPermissionMode: mapClaudeModeToPermissionModeMock,
}));

vi.mock("@/core/acp/mcp-setup", () => ({
  cleanupMcpForProvider: cleanupMcpForProviderMock,
  ensureMcpForProvider: ensureMcpForProviderMock,
  parseMcpServersFromConfigs: vi.fn(() => ({ routa: { type: "http", url: "http://localhost" } })),
  providerSupportsMcp: providerSupportsMcpMock,
}));

vi.mock("@/core/acp/mcp-config-generator", () => ({
  getDefaultRoutaMcpConfig: getDefaultRoutaMcpConfigMock,
}));

vi.mock("@/core/acp/opencode-sdk-adapter", () => ({
  OpencodeSdkAdapter: class OpencodeSdkAdapter {
    alive = true;
    serverUrl: string;
    connect = opencodeConnectMock;
    createSession = opencodeCreateSessionMock;
    kill = vi.fn(() => {
      this.alive = false;
    });

    constructor(serverUrl: string) {
      this.serverUrl = serverUrl;
      opencodeInstances.push(this as unknown as Record<string, unknown>);
    }
  },
  OpencodeSdkDirectAdapter: class OpencodeSdkDirectAdapter {
    alive = true;
    connect = directConnectMock;
    createSession = directCreateSessionMock;
    kill = vi.fn(() => {
      this.alive = false;
    });

    constructor() {
      directInstances.push(this as unknown as Record<string, unknown>);
    }
  },
  shouldUseOpencodeAdapter: shouldUseOpencodeAdapterMock,
  getOpencodeServerUrl: getOpencodeServerUrlMock,
  isOpencodeServerConfigured: vi.fn(() => true),
  isOpencodeDirectApiConfigured: isOpencodeDirectApiConfiguredMock,
}));

vi.mock("@/core/acp/claude-code-sdk-adapter", () => ({
  ClaudeCodeSdkAdapter: class ClaudeCodeSdkAdapter {
    alive = true;
    connect = claudeSdkConnectMock;
    createSession = claudeSdkCreateSessionMock;
    respondToUserInput = vi.fn(() => false);
    kill = vi.fn(() => {
      this.alive = false;
    });

    constructor() {
      claudeSdkInstances.push(this as unknown as Record<string, unknown>);
    }
  },
  shouldUseClaudeCodeSdkAdapter: shouldUseClaudeCodeSdkAdapterMock,
}));

vi.mock("@/core/acp/workspace-agent/workspace-agent-adapter", () => ({
  WorkspaceAgentAdapter: class WorkspaceAgentAdapter {
    alive = true;
    connect = workspaceConnectMock;
    createSession = workspaceCreateSessionMock;
    promptStream = vi.fn();
    kill = vi.fn(() => {
      this.alive = false;
    });

    constructor() {
      workspaceInstances.push(this as unknown as Record<string, unknown>);
    }
  },
}));

vi.mock("@/core/acp/docker/docker-opencode-adapter", () => ({
  DockerOpenCodeAdapter: class DockerOpenCodeAdapter {
    alive = true;
    connect = vi.fn();
    createSession = vi.fn();
    kill = vi.fn(() => {
      this.alive = false;
    });
  },
}));

vi.mock("@/core/acp/docker/process-manager", () => ({
  getDockerProcessManager: getDockerProcessManagerMock,
}));

vi.mock("@/core/acp/docker/utils", () => ({
  DEFAULT_DOCKER_AGENT_IMAGE: "docker-image",
}));

vi.mock("@/core/acp/api-based-providers", () => ({
  isServerlessEnvironment: isServerlessEnvironmentMock,
}));

vi.mock("@/core/acp/http-session-store", () => ({
  getHttpSessionStore: getHttpSessionStoreMock,
}));

vi.mock("@/core/acp/agent-instance-factory", () => ({
  AgentInstanceFactory: {
    createClaudeCodeSdkAdapter: vi.fn(() => ({
      adapter: {
        alive: true,
        connect: claudeSdkConnectMock,
        createSession: claudeSdkCreateSessionMock,
        respondToUserInput: vi.fn(() => false),
        kill: vi.fn(),
      },
      resolved: {},
    })),
  },
  getAgentInstanceManager: vi.fn(() => ({
    register: vi.fn(),
  })),
}));

vi.mock("@/core/db/index", () => ({
  getDatabaseDriver: getDatabaseDriverMock,
  getPostgresDatabase: getPostgresDatabaseMock,
}));

vi.mock("@/core/db/pg-acp-session-store", () => ({
  PgAcpSessionStore: class PgAcpSessionStore {
    get = pgGetMock;
  },
}));

const { AcpProcessManager } = await import("../acp-process-manager");

describe("AcpProcessManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acpInstances.length = 0;
    claudeInstances.length = 0;
    opencodeInstances.length = 0;
    directInstances.length = 0;
    claudeSdkInstances.length = 0;
    workspaceInstances.length = 0;
    providerSupportsMcpMock.mockReturnValue(true);
    ensureMcpForProviderMock.mockResolvedValue({
      mcpConfigs: ["mcp-config"],
      summary: "ok",
    });
    cleanupMcpForProviderMock.mockResolvedValue("cleanup-ok");
    shouldUseOpencodeAdapterMock.mockReturnValue(false);
    shouldUseClaudeCodeSdkAdapterMock.mockReturnValue(false);
    buildConfigFromPresetMock.mockResolvedValue({ bin: "opencode" });
    buildClaudeCodeConfigMock.mockReturnValue({ command: "claude" });
    mapClaudeModeToPermissionModeMock.mockReturnValue("acceptEdits");
    getDefaultRoutaMcpConfigMock.mockReturnValue({ type: "http" });
    getOpencodeServerUrlMock.mockReturnValue("http://opencode.local");
    isOpencodeDirectApiConfiguredMock.mockReturnValue(false);
    opencodeConnectMock.mockResolvedValue(undefined);
    opencodeCreateSessionMock.mockResolvedValue("opencode-session");
    directConnectMock.mockResolvedValue(undefined);
    directCreateSessionMock.mockResolvedValue("direct-session");
    claudeSdkConnectMock.mockResolvedValue(undefined);
    claudeSdkCreateSessionMock.mockResolvedValue("claude-sdk-session");
    workspaceConnectMock.mockResolvedValue(undefined);
    workspaceCreateSessionMock.mockResolvedValue("workspace-session");
    isServerlessEnvironmentMock.mockReturnValue(false);
    getDatabaseDriverMock.mockReturnValue("sqlite");
    getHttpSessionStoreMock.mockReturnValue({
      getSession: vi.fn(() => undefined),
      upsertSession: vi.fn(),
    });
    getDockerProcessManagerMock.mockReturnValue({
      stopContainer: dockerStopContainerMock,
      stopAll: dockerStopAllMock,
    });
  });

  it("creates a standard ACP session and stores the managed process", async () => {
    const manager = new AcpProcessManager();

    const acpSessionId = await manager.createSession(
      "session-1",
      "/repo",
      vi.fn(),
      "codex",
      "plan",
      ["--verbose"],
      { FOO: "bar" },
      "ws-1",
      "full",
    );

    expect(acpSessionId).toBe("acp-session-1");
    expect(getDefaultRoutaMcpConfigMock).toHaveBeenCalledWith("ws-1", "session-1", "full", undefined);
    expect(ensureMcpForProviderMock).toHaveBeenCalledWith("codex", { type: "http", cwd: "/repo" });
    expect(buildConfigFromPresetMock).toHaveBeenCalledWith(
      "codex",
      "/repo",
      ["--verbose"],
      { FOO: "bar" },
      ["mcp-config"],
    );
    expect((acpInstances[0]?.newSession as ReturnType<typeof vi.fn>)?.mock.calls[0]?.[0]).toBe("/repo");
    expect(manager.getProcess("session-1")).toBeDefined();
    expect(manager.getAcpSessionId("session-1")).toBe("acp-session-1");
    expect(manager.getPresetId("session-1")).toBe("codex");
    expect(manager.hasActiveSession("session-1")).toBe(true);
  });

  it("routes opencode sessions to the SDK adapter when configured", async () => {
    shouldUseOpencodeAdapterMock.mockReturnValue(true);
    const manager = new AcpProcessManager();

    const acpSessionId = await manager.createSession("sdk-session", "/repo", vi.fn(), "opencode");

    expect(acpSessionId).toBe("opencode-session");
    expect(opencodeConnectMock).toHaveBeenCalledOnce();
    expect(opencodeCreateSessionMock).toHaveBeenCalledWith("Routa Session sdk-session");
    expect(manager.getOpencodeAdapter("sdk-session")).toBeDefined();
    expect(manager.isOpencodeAdapterSession("sdk-session")).toBe(true);
  });

  it("creates a Claude session with bypassPermissions for ROUTA agents", async () => {
    mapClaudeModeToPermissionModeMock.mockReturnValue("plan");
    const manager = new AcpProcessManager();

    const acpSessionId = await manager.createClaudeSession(
      "claude-session",
      "/repo",
      vi.fn(),
      ["mcp-json"],
      "acceptEdits",
      "ROUTA",
      { BAR: "baz" },
      ["Bash"],
    );

    expect(acpSessionId).toBe("claude-session");
    expect(buildClaudeCodeConfigMock).toHaveBeenCalledWith(
      "/repo",
      ["mcp-json"],
      "bypassPermissions",
      { BAR: "baz" },
      ["Bash"],
    );
    expect(manager.getClaudeProcess("claude-session")).toBeDefined();
    expect(manager.isClaudeSession("claude-session")).toBe(true);
  });

  it("lists and kills sessions across all managed transport types", async () => {
    const manager = new AcpProcessManager();
    (manager as unknown as {
      processes: Map<string, { process: { alive: boolean; kill: () => void }; acpSessionId: string; presetId: string; createdAt: Date }>;
      opencodeAdapters: Map<string, { adapter: { alive: boolean; kill: () => void }; acpSessionId: string; presetId: string; createdAt: Date }>;
      workspaceAgents: Map<string, { adapter: { alive: boolean; kill: () => void }; acpSessionId: string; presetId: string; createdAt: Date }>;
    }).processes.set("proc-1", {
      process: { alive: true, kill: vi.fn() },
      acpSessionId: "acp-1",
      presetId: "codex",
      createdAt: new Date("2026-04-12T00:00:00Z"),
    });
    (manager as unknown as {
      opencodeAdapters: Map<string, { adapter: { alive: boolean; kill: () => void }; acpSessionId: string; presetId: string; createdAt: Date }>;
    }).opencodeAdapters.set("sdk-1", {
      adapter: { alive: true, kill: vi.fn() },
      acpSessionId: "sdk-acp-1",
      presetId: "opencode-sdk",
      createdAt: new Date("2026-04-12T00:01:00Z"),
    });
    (manager as unknown as {
      workspaceAgents: Map<string, { adapter: { alive: boolean; kill: () => void }; acpSessionId: string; presetId: string; createdAt: Date }>;
    }).workspaceAgents.set("workspace-1", {
      adapter: { alive: true, kill: vi.fn() },
      acpSessionId: "workspace-acp-1",
      presetId: "workspace",
      createdAt: new Date("2026-04-12T00:02:00Z"),
    });

    expect(manager.listSessions()).toEqual([
      expect.objectContaining({ sessionId: "proc-1", presetId: "codex" }),
      expect.objectContaining({ sessionId: "sdk-1", presetId: "opencode-sdk" }),
      expect.objectContaining({ sessionId: "workspace-1", presetId: "workspace" }),
    ]);

    await manager.killSession("sdk-1");
    expect(manager.getOpencodeAdapter("sdk-1")).toBeUndefined();

    await manager.killAll();
    expect(manager.listSessions()).toEqual([]);
    expect(dockerStopAllMock).toHaveBeenCalledOnce();
  });

  it("tracks qoder MCP setup and removes it on session shutdown", async () => {
    const manager = new AcpProcessManager();
    const cleanup = {
      action: "qoder-remove",
      providerId: "qoder",
      serverName: "routa-coordination",
      scope: "local",
      cwd: "/repo",
    };
    ensureMcpForProviderMock.mockResolvedValueOnce({
      mcpConfigs: [],
      summary: "qoder: added routa-coordination via local config",
      cleanup,
    });

    const acpSessionId = await manager.createSession(
      "session-qoder",
      "/repo",
      vi.fn(),
      "qoder",
      undefined,
      undefined,
      undefined,
      "ws-qoder",
      "full",
    );

    expect(acpSessionId).toBe("acp-session-1");
    expect(getDefaultRoutaMcpConfigMock).toHaveBeenCalledWith("ws-qoder", "session-qoder", "full", undefined);
    expect(ensureMcpForProviderMock).toHaveBeenCalledWith("qoder", { type: "http", cwd: "/repo" });

    await manager.killSession("session-qoder");
    expect(cleanupMcpForProviderMock).toHaveBeenCalledWith(cleanup);
  });

  it("prepends MCP provider args before caller extra args", async () => {
    const manager = new AcpProcessManager();
    ensureMcpForProviderMock.mockResolvedValueOnce({
      mcpConfigs: ["mcp-config"],
      providerArgs: ["-c", 'mcp_servers.routa-coordination.url="http://localhost:3210/api/mcp"'],
      summary: "codex: wrote private overlay",
    });

    await manager.createSession(
      "session-args",
      "/repo",
      vi.fn(),
      "codex",
      undefined,
      ["--verbose"],
      undefined,
      "ws-1",
    );

    expect(buildConfigFromPresetMock).toHaveBeenCalledWith(
      "codex",
      "/repo",
      ["-c", 'mcp_servers.routa-coordination.url="http://localhost:3210/api/mcp"', "--verbose"],
      undefined,
      ["mcp-config"],
    );
  });

  it("routes explicit opencode-sdk sessions to the direct api adapter when no server url is set", async () => {
    const manager = new AcpProcessManager();
    getOpencodeServerUrlMock.mockReturnValue(null);
    isOpencodeDirectApiConfiguredMock.mockReturnValue(true);

    const acpSessionId = await manager.createOpencodeSdkSession("session-direct", vi.fn());

    expect(acpSessionId).toBe("direct-session");
    expect(opencodeInstances).toHaveLength(0);
    expect(directInstances).toHaveLength(1);
    expect(directConnectMock).toHaveBeenCalledOnce();
    expect(directCreateSessionMock).toHaveBeenCalledWith("Routa Session session-direct");
  });

  it("delegates Claude sessions to the SDK adapter in serverless mode", async () => {
    const manager = new AcpProcessManager();
    shouldUseClaudeCodeSdkAdapterMock.mockReturnValue(true);

    const acpSessionId = await manager.createClaudeSession(
      "session-claude-sdk",
      "/workspace",
      vi.fn(),
      ["mcp-config"],
      "plan",
      "CRAFTER",
      undefined,
      ["Read"],
    );

    expect(acpSessionId).toBe("claude-sdk-session");
    expect(claudeSdkConnectMock).toHaveBeenCalledOnce();
    expect(claudeSdkCreateSessionMock).toHaveBeenCalledWith("Routa Session session-claude-sdk");
  });

  it("creates and stores workspace-agent sessions", async () => {
    const manager = new AcpProcessManager();

    const acpSessionId = await manager.createWorkspaceAgentSession(
      "session-workspace",
      "/workspace",
      vi.fn(),
      { workspaceId: "ws-1" },
    );

    expect(acpSessionId).toBe("workspace-session");
    expect(workspaceInstances).toHaveLength(1);
    expect(workspaceConnectMock).toHaveBeenCalledOnce();
    expect(workspaceCreateSessionMock).toHaveBeenCalledWith("Routa Session session-workspace");
    expect(manager.getWorkspaceAgent("session-workspace")).toBe(workspaceInstances[0]);
    expect(manager.hasActiveSession("session-workspace")).toBe(true);
  });

  it("reports Claude SDK sessions from the HTTP store even after cold starts", () => {
    getHttpSessionStoreMock.mockReturnValue({
      getSession: vi.fn(() => ({
        provider: "claude-code-sdk",
      })),
      upsertSession: vi.fn(),
    });

    const manager = new AcpProcessManager();

    expect(manager.isClaudeCodeSdkSession("session-cold")).toBe(true);
  });

  it("routes interactive responses to managed ACP processes and falls back to false", async () => {
    const manager = new AcpProcessManager();
    await manager.createSession(
      "session-1",
      "/workspace",
      vi.fn(),
      "opencode",
    );

    const process = acpInstances[0];
    (process.respondToUserInput as ReturnType<typeof vi.fn>).mockReturnValue(true);

    expect(manager.respondToUserInput("session-1", "tool-1", { approved: true })).toBe(true);
    expect(manager.respondToUserInput("missing", "tool-1", { approved: true })).toBe(false);
  });
});
