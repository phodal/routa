/**
 * Browser ACP Client
 *
 * Connects to `/api/acp` via JSON-RPC over HTTP and receives `session/update`
 * notifications via SSE.
 *
 * The backend spawns an opencode process per session and proxies:
 *   - JSON-RPC requests → opencode stdin
 *   - opencode stdout → SSE session/update
 */

export interface AcpSessionNotification {
  sessionId: string;
  update?: Record<string, unknown>;
  /** Flat fields from opencode (sessionUpdate, content, etc.) */
  [key: string]: unknown;
}

export interface AcpInitializeResult {
  protocolVersion: string | number;
  agentCapabilities: Record<string, unknown>;
  agentInfo?: { name: string; version: string };
}

export interface AcpNewSessionResult {
  sessionId: string;
  provider?: string;
}

export interface AcpPromptResult {
  stopReason: string;
}

export interface AcpProviderInfo {
  id: string;
  name: string;
  description: string;
  command: string;
  status?: "available" | "unavailable";
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
   * Initialize the ACP connection.
   */
  async initialize(
    protocolVersion: number | string = 1
  ): Promise<AcpInitializeResult> {
    return this.rpc("initialize", { protocolVersion });
  }

  /**
   * Create a new ACP session.
   * This spawns a new ACP agent process on the backend.
   */
  async newSession(params: {
    cwd?: string;
    provider?: string;
    modeId?: string;
    mcpServers?: Array<{ name: string; url?: string }>;
  }): Promise<AcpNewSessionResult> {
    const result = await this.rpc<AcpNewSessionResult>("session/new", {
      cwd: params.cwd ?? "/",
      provider: params.provider ?? "opencode",
      modeId: params.modeId,
      mcpServers: params.mcpServers ?? [],
    });
    this._sessionId = result.sessionId;

    // Connect SSE after we know the sessionId
    this.attachSession(result.sessionId);

    return result;
  }

  /**
   * List available ACP providers from the backend.
   */
  async listProviders(): Promise<AcpProviderInfo[]> {
    const result = await this.rpc<{ providers?: AcpProviderInfo[] }>(
      "_providers/list",
      {}
    );
    return Array.isArray(result.providers) ? result.providers : [];
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
   * Content streams via SSE session/update notifications.
   */
  async prompt(sessionId: string, text: string): Promise<AcpPromptResult> {
    return this.rpc("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  /**
   * Set session mode (if provider supports it).
   */
  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.rpc("session/set_mode", { sessionId, modeId });
  }

  /**
   * Cancel the current prompt.
   */
  async cancel(sessionId: string): Promise<void> {
    await this.rpc("session/cancel", { sessionId });
  }

  /**
   * Register a handler for session updates (SSE).
   */
  onUpdate(handler: SessionUpdateHandler): () => void {
    this.updateHandlers.push(handler);
    return () => {
      this.updateHandlers = this.updateHandlers.filter((h) => h !== handler);
    };
  }

  /**
   * Disconnect and clean up.
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
          const notification = data.params as AcpSessionNotification;

          for (const handler of this.updateHandlers) {
            try {
              handler(notification);
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
      throw new Error(
        `ACP Error [${data.error.code}]: ${data.error.message}`
      );
    }

    return data.result as T;
  }
}
