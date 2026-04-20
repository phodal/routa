import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sessionStore, getHttpSessionStoreMock } = vi.hoisted(() => {
  const store = {
    listSessions: vi.fn(),
    getSession: vi.fn(),
  };

  return {
    sessionStore: store,
    getHttpSessionStoreMock: vi.fn(() => store),
  };
});

vi.mock("@/core/acp/http-session-store", () => ({
  getHttpSessionStore: getHttpSessionStoreMock,
}));

import { A2aSessionRegistry, getA2aSessionRegistry } from "@/core/a2a/a2a-session-registry";

const GLOBAL_KEY = "__a2a_session_registry__";

describe("A2aSessionRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStore.listSessions.mockReturnValue([]);
    sessionStore.getSession.mockReturnValue(undefined);
    delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
  });

  it("maps stored sessions into A2A discovery metadata", () => {
    sessionStore.listSessions.mockReturnValue([
      {
        sessionId: "abc12345xyz",
        provider: "claude",
        createdAt: "2026-04-12T01:00:00Z",
        cwd: "/tmp/repo",
        workspaceId: "ws-1",
      },
    ]);

    const registry = new A2aSessionRegistry();
    const sessions = registry.listSessions("https://routa.dev");

    expect(sessions).toEqual([
      {
        id: "abc12345xyz",
        agentName: "routa-claude-abc12345",
        provider: "claude",
        status: "connected",
        capabilities: [
          "initialize",
          "method_list",
          "session/new",
          "session/prompt",
          "session/cancel",
          "session/load",
          "list_agents",
          "create_agent",
          "delegate_task",
          "message_agent",
        ],
        rpcUrl: "https://routa.dev/api/a2a/rpc?sessionId=abc12345xyz",
        eventStreamUrl: "https://routa.dev/api/a2a/rpc?sessionId=abc12345xyz",
        createdAt: "2026-04-12T01:00:00Z",
      },
    ]);
  });

  it("returns undefined for missing sessions and applies provider fallbacks", () => {
    sessionStore.getSession
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({
        sessionId: "fallback123",
        createdAt: "2026-04-12T02:00:00Z",
        cwd: "/tmp/repo",
        workspaceId: "ws-2",
      });

    const registry = new A2aSessionRegistry();

    expect(registry.getSession("missing", "https://routa.dev")).toBeUndefined();
    expect(registry.getSession("fallback123", "https://routa.dev")).toEqual(
      expect.objectContaining({
        agentName: "routa-agent-fallback",
        provider: "unknown",
      }),
    );
  });

  it("generates an agent card with the expected Routa endpoints and skills", () => {
    const registry = new A2aSessionRegistry();
    const card = registry.generateAgentCard("https://routa.dev");

    expect(card.name).toBe("Routa Multi-Agent Coordinator");
    expect(card.protocolVersion).toBe("0.3.0");
    expect(card.url).toBe("https://routa.dev/api/a2a/rpc");
    expect(card.documentationUrl).toBe("https://routa.dev/a2a");
    expect(card.capabilities).toEqual({
      streaming: true,
      pushNotifications: false,
    });
    expect(card.skills).toHaveLength(3);
    expect(card.skills.map((skill) => skill.id)).toEqual([
      "agent-coordination",
      "software-development",
      "code-verification",
    ]);
    expect(card.additionalInterfaces).toEqual([
      {
        url: "https://routa.dev/api/a2a/rpc",
        transport: "JSONRPC",
      },
      {
        url: "https://routa.dev/api/a2a/message",
        transport: "HTTP",
      },
    ]);
  });

  it("reuses the global singleton registry instance", () => {
    const first = getA2aSessionRegistry();
    const second = getA2aSessionRegistry();

    expect(first).toBe(second);
    expect(getHttpSessionStoreMock).toHaveBeenCalledTimes(1);
  });
});
