/**
 * Browser ACP Client (OpenCode-compatible)
 *
 * Connects to `/api/acp` via JSON-RPC over HTTP and receives `session/update`
 * notifications via SSE.
 *
 * This client intentionally follows ACP schema:
 *   - `session/update` params are `{ sessionId, update }`
 *   - `session/prompt` returns `{ stopReason }` while content streams over SSE
 */

export interface AcpSessionNotification {
  sessionId: string;
  update: Record<string, unknown>;
  _meta?: Record<string, unknown> | null;
}

export interface AcpInitializeResult {
  protocolVersion: string;
  agentCapabilities: Record<string, unknown>;
}

export interface AcpNewSessionResult {
  sessionId: string;
}

export interface AcpPromptResult {
  stopReason: string;
}

export type SessionUpdateHandler = (update: AcpSessionNotification) => void;

export class BrowserAcpClient {
  private baseUrl: string;
  private eventSource: EventSource | null = null;
  private updateHandlers: SessionUpdateHandler[] = [];
  private requestId = 0;
  private _sessionId: string | null = null;

  constructor(baseUrl: string = "") {
    this.baseUrl = baseUrl;
  }

  get sessionId(): string | null {
    return this._sessionId;
  }

  /**
   * Initialize the ACP connection
   */
  async initialize(
    protocolVersion: string = "0.1.0"
  ): Promise<AcpInitializeResult> {
    return this.rpc("initialize", { protocolVersion });
  }

  /**
   * Create a new ACP session.
   * Note: per ACP, SSE typically connects after sessionId is known.
   */
  async newSession(params: {
    cwd?: string;
    mcpServers?: Array<{ name: string; url?: string }>;
  }): Promise<AcpNewSessionResult> {
    const result = await this.rpc<AcpNewSessionResult>("session/new", {
      cwd: params.cwd ?? "/",
      mcpServers: params.mcpServers ?? [],
    });
    this._sessionId = result.sessionId;

    // Connect SSE after we know the sessionId
    this.attachSession(result.sessionId);

    return result;
  }

  /**
   * Attach to an existing session ID (switch sessions).
   */
  attachSession(sessionId: string): void {
    this._sessionId = sessionId;
    this.connectSSE(sessionId);
  }

  /**
   * Send a prompt to the session.
   * Returns the full response inline in JSON-RPC AND streams via SSE.
   */
  async prompt(
    sessionId: string,
    text: string
  ): Promise<AcpPromptResult> {
    return this.rpc("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  /**
   * Cancel the current prompt
   */
  async cancel(sessionId: string): Promise<void> {
    await this.rpc("session/cancel", { sessionId });
  }

  /**
   * List available skills
   */
  async listSkills(): Promise<{
    skills: Array<{
      name: string;
      description: string;
      license?: string;
      compatibility?: string;
    }>;
  }> {
    return this.rpc("skills/list", {});
  }

  /**
   * Load a specific skill
   */
  async loadSkill(
    name: string
  ): Promise<{
    name: string;
    description: string;
    content: string;
    license?: string;
    metadata?: Record<string, string>;
  }> {
    return this.rpc("skills/load", { name });
  }

  /**
   * List agents
   */
  async listAgents(
    workspaceId?: string
  ): Promise<
    Array<{
      id: string;
      name: string;
      role: string;
      status: string;
      parentId?: string;
    }>
  > {
    return this.rpc("agents/list", { workspaceId });
  }

  /**
   * Call an MCP tool through ACP
   */
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    return this.rpc("tools/call", { name, arguments: args });
  }

  /**
   * Register a handler for session updates (SSE)
   */
  onUpdate(handler: SessionUpdateHandler): () => void {
    this.updateHandlers.push(handler);
    return () => {
      this.updateHandlers = this.updateHandlers.filter((h) => h !== handler);
    };
  }

  /**
   * Disconnect and clean up
   */
  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this._sessionId = null;
    this.updateHandlers = [];
  }

  // ─── Private ─────────────────────────────────────────────────────────

  private connectSSE(sessionId: string): void {
    if (this.eventSource) {
      this.eventSource.close();
    }

    this.eventSource = new EventSource(
      `${this.baseUrl}/api/acp?sessionId=${sessionId}`
    );

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.method === "session/update" && data.params) {
          const update = data.params as AcpSessionNotification;
          for (const handler of this.updateHandlers) {
            try {
              handler(update);
            } catch (err) {
              console.error("[AcpClient] Handler error:", err);
            }
          }
        }
      } catch (err) {
        console.error("[AcpClient] SSE parse error:", err);
      }
    };

    this.eventSource.onerror = () => {
      // SSE will auto-reconnect
    };
  }

  private async rpc<T = unknown>(
    method: string,
    params: Record<string, unknown>
  ): Promise<T> {
    const id = ++this.requestId;

    const response = await fetch(`${this.baseUrl}/api/acp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(`ACP Error [${data.error.code}]: ${data.error.message}`);
    }

    return data.result as T;
  }
}
