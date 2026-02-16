/**
 * A2aSessionRegistry - Registry for exposing backend sessions via A2A protocol
 *
 * Tracks active backend sessions and provides discovery/metadata for A2A clients.
 * Integrates with HttpSessionStore to expose ACP sessions as A2A endpoints.
 */

import { AgentCard } from "@a2a-js/sdk";
import { getHttpSessionStore, RoutaSessionRecord } from "../acp/http-session-store";

export interface A2aSessionInfo {
  id: string;
  agentName: string;
  provider: string;
  status: string;
  capabilities: string[];
  rpcUrl: string;
  eventStreamUrl: string;
  createdAt: string;
}

/**
 * Registry for A2A-exposed sessions
 */
export class A2aSessionRegistry {
  private sessionStore = getHttpSessionStore();

  /**
   * Get all active sessions formatted for A2A discovery
   */
  listSessions(baseUrl: string): A2aSessionInfo[] {
    const sessions = this.sessionStore.listSessions();
    
    return sessions.map((session) => this.toA2aSessionInfo(session, baseUrl));
  }

  /**
   * Get a specific session by ID
   */
  getSession(sessionId: string, baseUrl: string): A2aSessionInfo | undefined {
    const session = this.sessionStore.getSession(sessionId);
    if (!session) return undefined;
    
    return this.toA2aSessionInfo(session, baseUrl);
  }

  /**
   * Convert internal session record to A2A session info
   */
  private toA2aSessionInfo(
    session: RoutaSessionRecord,
    baseUrl: string
  ): A2aSessionInfo {
    return {
      id: session.sessionId,
      agentName: `routa-${session.provider || "agent"}-${session.sessionId.slice(0, 8)}`,
      provider: session.provider || "unknown",
      status: "connected", // Simplified status
      capabilities: this.getSessionCapabilities(session),
      rpcUrl: `${baseUrl}/api/a2a/rpc?sessionId=${session.sessionId}`,
      eventStreamUrl: `${baseUrl}/api/a2a/rpc?sessionId=${session.sessionId}`,
      createdAt: session.createdAt,
    };
  }

  /**
   * Determine capabilities based on session provider
   */
  private getSessionCapabilities(session: RoutaSessionRecord): string[] {
    const baseCapabilities = [
      "initialize",
      "method_list",
    ];

    // ACP-based sessions support these methods (must match /api/a2a/rpc routing)
    const acpCapabilities = [
      "session/new",
      "session/prompt",
      "session/cancel",
      "session/load",
    ];

    // Routa-specific coordination tools (must match /api/a2a/rpc routing)
    const routaCapabilities = [
      "list_agents",
      "create_agent",
      "delegate_task",
      "message_agent",
    ];

    return [...baseCapabilities, ...acpCapabilities, ...routaCapabilities];
  }

  /**
   * Generate an A2A AgentCard for the Routa platform
   */
  generateAgentCard(baseUrl: string): AgentCard {
    return {
      name: "Routa Multi-Agent Coordinator",
      description: "Multi-agent coordination platform with ACP and MCP support",
      protocolVersion: "0.3.0",
      version: "0.1.0",
      url: `${baseUrl}/api/a2a/rpc`,
      skills: [
        {
          id: "coordination",
          name: "Agent Coordination",
          description: "Create, delegate tasks to, and coordinate multiple AI agents",
          tags: ["coordination", "multi-agent", "orchestration"],
        },
        {
          id: "acp-proxy",
          name: "ACP Session Proxy",
          description: "Proxy access to backend ACP agent sessions",
          tags: ["acp", "session", "proxy"],
        },
      ],
      capabilities: {
        pushNotifications: true,
      },
      defaultInputModes: ["text"],
      defaultOutputModes: ["text"],
      additionalInterfaces: [
        {
          url: `${baseUrl}/api/a2a/rpc`,
          transport: "JSONRPC",
        },
      ],
    };
  }
}

// Singleton instance
const GLOBAL_KEY = "__a2a_session_registry__";

export function getA2aSessionRegistry(): A2aSessionRegistry {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new A2aSessionRegistry();
  }
  return g[GLOBAL_KEY] as A2aSessionRegistry;
}
