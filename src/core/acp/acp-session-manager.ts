/**
 * AcpSessionManager - port of AcpSessionManager.kt
 *
 * Manages ACP sessions and connections to external ACP agents.
 * Handles spawning agent processes and maintaining connections.
 */

import { v4 as uuidv4 } from "uuid";

export interface AcpAgentConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface AcpSessionInfo {
  id: string;
  agentName: string;
  config: AcpAgentConfig;
  status: "connecting" | "connected" | "disconnected" | "error";
  createdAt: Date;
}

/**
 * Manages ACP agent sessions on the server side.
 * Connects to external ACP agents (Codex, Claude Code, etc.)
 */
export class AcpSessionManager {
  private sessions = new Map<string, AcpSessionInfo>();

  /**
   * Register an ACP agent configuration
   */
  registerAgent(config: AcpAgentConfig): string {
    const sessionId = uuidv4();
    const session: AcpSessionInfo = {
      id: sessionId,
      agentName: config.name,
      config,
      status: "disconnected",
      createdAt: new Date(),
    };
    this.sessions.set(sessionId, session);
    return sessionId;
  }

  /**
   * Get all registered sessions
   */
  listSessions(): AcpSessionInfo[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get a specific session
   */
  getSession(sessionId: string): AcpSessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Remove a session
   */
  removeSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Get available agent configs (for client discovery)
   */
  getAvailableAgents(): Array<{ name: string; sessionId: string; status: string }> {
    return Array.from(this.sessions.values()).map((s) => ({
      name: s.agentName,
      sessionId: s.id,
      status: s.status,
    }));
  }
}
