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

import type { McpServerProfile } from "@/core/mcp/mcp-server-profiles";
import { resolveApiPath } from "@/client/config/backend";

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
  role?: string;
  routaAgentId?: string;
  sandboxId?: string;
  /** ACP process lifecycle status — "connecting" means the agent is still starting up */
  acpStatus?: "connecting" | "ready" | "error";
}

export interface AcpLoadSessionResult {
  sessionId: string;
  provider?: string;
  role?: string;
  acpStatus?: "connecting" | "ready" | "error";
  resumeMode?: "native" | "recreated" | "attached";
  nativeResumeError?: string;
  resumeCapabilities?: {
    supported: boolean;
    mode: "native" | "replay" | "both";
    supportsFork?: boolean;
    supportsList?: boolean;
  };
}

export interface AcpForkSessionResult {
  sessionId: string;
  parentSessionId: string;
  name?: string;
  provider?: string;
  role?: string;
  cwd?: string;
  branch?: string;
  workspaceId?: string;
  createdAt?: string;
}

export interface AcpPromptResult {
  stopReason: string;
  /** Full response content (for serverless environments where SSE may not work) */
  content?: string;
  /** Token usage info */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface AcpTerminalMutationResult {
  ok: boolean;
}

export interface AcpProviderInfo {
  id: string;
  name: string;
  description: string;
  command: string;
  status?: "available" | "unavailable" | "checking";
  source?: "static" | "registry";
  unavailableReason?: string;
}

export type SessionUpdateHandler = (update: AcpSessionNotification) => void;

/**
 * Authentication method info from ACP agent.
 */
export interface AcpAuthMethod {
  id: string;
  name: string;
  description: string;
}

export interface AcpConnectionIssue {
  sessionId: string;
  message: string;
  retryable: boolean;
  status?: number;
  ownerInstanceId?: string;
  leaseExpiresAt?: string;
  retryDelayMs?: number;
}

export type SessionConnectionIssueHandler = (issue: AcpConnectionIssue) => void;

/**
 * Custom error class for ACP errors that may include auth requirements.
 */
export class AcpClientError extends Error {
  code: number;
  authMethods?: AcpAuthMethod[];
  agentInfo?: { name: string; version: string };
  data?: unknown;
  sessionMayContinue?: boolean;

  constructor(
    message: string,
    code: number,
    authMethods?: AcpAuthMethod[],
    agentInfo?: { name: string; version: string },
    data?: unknown,
    sessionMayContinue?: boolean,
  ) {
    super(message);
    this.name = "AcpClientError";
    this.code = code;
    this.authMethods = authMethods;
    this.agentInfo = agentInfo;
    this.data = data;
    this.sessionMayContinue = sessionMayContinue;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      authMethods: this.authMethods,
      agentInfo: this.agentInfo,
      data: this.data,
      sessionMayContinue: this.sessionMayContinue,
      stack: this.stack,
    };
  }
}

export class BrowserAcpClient {
  private baseUrl: string;
  private eventSource: EventSource | null = null;
  private updateHandlers: SessionUpdateHandler[] = [];
  private connectionIssueHandlers: SessionConnectionIssueHandler[] = [];
  private requestId = 0;
  private _sessionId: string | null = null;
  private lastEventId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sseAttempt = 0;
  private readonly ownershipConflictRetryLimit = 4;
  private readonly ownershipConflictBaseDelayMs = 1200;
  private readonly ownershipConflictBackoffMultiplier = 2;
  private readonly ownershipConflictRetryState = new Map<string, number>();

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
   *
   * @param params.idempotencyKey - Optional unique key to prevent duplicate session creation.
   *   If provided, the backend will return the same session for repeated requests with the same key
   *   within a short time window (30 seconds). This prevents multiple sessions being created when
   *   user clicks "Start" multiple times before navigation completes.
   */
  async newSession(params: {
    cwd?: string;
    /** Git branch to scope the session to (optional) */
    branch?: string;
    /** Optional display name for the session */
    name?: string;
    provider?: string;
    modeId?: string;
    role?: string;
    /** Parent session ID when creating a child session */
    parentSessionId?: string;
    crafterProvider?: string;
    gateProvider?: string;
    mcpServers?: Array<{ name: string; url?: string }>;
    workspaceId?: string;
    toolMode?: "essential" | "full";
    /** Optional allowlist for provider-native tools such as Bash/Read/Edit. */
    allowedNativeTools?: string[];
    /** Optional logical MCP profile, such as kanban-planning. */
    mcpProfile?: McpServerProfile;
    model?: string;
    idempotencyKey?: string;
    specialistId?: string;
    specialistLocale?: string;
    /** Optional session-scoped system prompt injected before the first user turn. */
    systemPrompt?: string;
    /** Custom API base URL (overrides ANTHROPIC_BASE_URL env var) */
    baseUrl?: string;
    /** API key override (overrides ANTHROPIC_AUTH_TOKEN env var) */
    apiKey?: string;
    /** Existing Rust sandbox to bind to this session instead of auto-creating one */
    sandboxId?: string;
    /** Custom provider command (for user-defined ACP providers) */
    customCommand?: string;
    /** Custom provider args (for user-defined ACP providers) */
    customArgs?: string[];
    /** Docker OpenCode: auth.json content to mount into container */
    authJson?: string;
    /** Allow unattended permission approvals for automation sessions. */
    autoApprovePermissions?: boolean;
  }): Promise<AcpNewSessionResult> {
    const result = await this.rpc<AcpNewSessionResult>("session/new", {
      cwd: params.cwd,
      branch: params.branch,
      name: params.name,
      provider: params.provider ?? "opencode",
      modeId: params.modeId,
      role: params.role,
      parentSessionId: params.parentSessionId,
      crafterProvider: params.crafterProvider,
      gateProvider: params.gateProvider,
      mcpServers: params.mcpServers ?? [],
      workspaceId: params.workspaceId,
      toolMode: params.toolMode,
      allowedNativeTools: params.allowedNativeTools,
      mcpProfile: params.mcpProfile,
      model: params.model,
      idempotencyKey: params.idempotencyKey,
      specialistId: params.specialistId,
      specialistLocale: params.specialistLocale,
      systemPrompt: params.systemPrompt,
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      sandboxId: params.sandboxId,
      customCommand: params.customCommand,
      customArgs: params.customArgs,
      authJson: params.authJson,
      autoApprovePermissions: params.autoApprovePermissions,
    });
    this._sessionId = result.sessionId;

    // Connect SSE after we know the sessionId
    this.attachSession(result.sessionId);

    return result;
  }

  /**
   * Load or resume an existing ACP session.
   */
  async loadSession(params: {
    sessionId: string;
    cwd?: string;
  }): Promise<AcpLoadSessionResult> {
    const result = await this.rpc<AcpLoadSessionResult>("session/load", {
      sessionId: params.sessionId,
      cwd: params.cwd,
    });
    this._sessionId = params.sessionId;
    this.attachSession(params.sessionId);
    return {
      ...result,
      sessionId: result.sessionId ?? params.sessionId,
    };
  }

  /**
   * Fork a session - creates a child session from an existing one.
   * The original session is preserved intact.
   */
  async forkSession(params: {
    sessionId: string;
    name?: string;
  }): Promise<AcpForkSessionResult> {
    const response = await fetch(
      resolveApiPath(`api/sessions/${params.sessionId}/fork`, this.baseUrl),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: params.name }),
      },
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(
        (err as Record<string, string>).error ?? `Fork failed: ${response.status}`,
      );
    }
    return response.json() as Promise<AcpForkSessionResult>;
  }

  /**
   * List available models for a provider (e.g. opencode).
   */
  async listProviderModels(provider: string): Promise<string[]> {
    const response = await fetch(resolveApiPath(`api/providers/models?provider=${encodeURIComponent(provider)}`, this.baseUrl));
    const data = await response.json();
    return Array.isArray(data.models) ? data.models : [];
  }

  /**
   * List available ACP providers from the backend.
   * @param check - If true, check command availability (slower). If false, return immediately with "checking" status.
   * @param includeRegistry - If true, include registry providers (slower). If false, only local providers.
   */
  async listProviders(check: boolean = false, includeRegistry: boolean = false): Promise<AcpProviderInfo[]> {
    const params = new URLSearchParams();
    if (check) params.set("check", "true");
    if (includeRegistry) params.set("registry", "true");

    const response = await fetch(resolveApiPath(`api/providers?${params}`, this.baseUrl));
    const data = await response.json();

    return Array.isArray(data.providers) ? data.providers : [];
  }

  /**
   * Load registry providers asynchronously after local providers are loaded.
   * This is useful for showing local providers first, then loading registry in background.
   */
  async loadRegistryProviders(): Promise<AcpProviderInfo[]> {
    const response = await fetch(resolveApiPath("api/providers?registry=true", this.baseUrl));
    const data = await response.json();
    return Array.isArray(data.providers) ? data.providers : [];
  }

  /**
   * Attach to an existing session ID (switch sessions).
   */
  attachSession(sessionId: string): void {
    if (this._sessionId !== sessionId) {
      if (this._sessionId) {
        this.ownershipConflictRetryState.delete(this._sessionId);
      }
      this.lastEventId = null;
    }
    this._sessionId = sessionId;
    this.connectSSE(sessionId);
  }

  /**
   * Send a prompt to the session.
   * Content streams via SSE session/update notifications.
   * In serverless environments, the POST response itself streams SSE events.
   *
   * @param sessionId - The session to send to
   * @param text - The prompt text
   * @param skillContext - Optional skill context (name + content) from UI /skill selection
   */
  async prompt(
    sessionId: string,
    text: string,
    skillContext?: { skillName: string; skillContent: string },
  ): Promise<AcpPromptResult> {
    const id = ++this.requestId;

    const params: Record<string, unknown> = {
      sessionId,
      prompt: [{ type: "text", text }],
    };

    // Pass skill context so the backend can inject it via appendSystemPrompt (SDK)
    // or prepend to prompt (CLI) for proper skill integration
    if (skillContext) {
      params.skillName = skillContext.skillName;
      params.skillContent = skillContext.skillContent;
    }

    const response = await fetch(resolveApiPath("api/acp", this.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "session/prompt",
        params,
      }),
    });

    const contentType = response.headers.get("Content-Type") || "";

    // Handle streaming SSE response (serverless environments)
    if (contentType.includes("text/event-stream")) {
      return this.handleStreamingPromptResponse(response, sessionId);
    }

    // Handle traditional JSON response
    let data: any;
    try {
      data = await response.json();
    } catch (error) {
      throw new AcpClientError(
        `Invalid ACP response (${response.status} ${response.statusText})`,
        response.status || -32603,
        undefined,
        undefined,
        {
          responseContentType: contentType,
          parseError: error instanceof Error ? error.message : String(error),
        },
      );
    }
    if (data.error) {
      throw new AcpClientError(
        data.error.message,
        data.error.code,
        data.error.authMethods,
        data.error.agentInfo,
        data.error.data,
        data.error.sessionMayContinue,
      );
    }

    const result = data.result as AcpPromptResult;

    // Legacy fallback: if response includes content directly, emit as notification
    if (result.content) {
      const notification: AcpSessionNotification = {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: result.content },
        },
      };
      for (const handler of this.updateHandlers) {
        try { handler(notification); } catch (err) { console.error("[AcpClient] Handler error:", err); }
      }

      const turnCompleteNotification: AcpSessionNotification = {
        sessionId,
        update: {
          sessionUpdate: "turn_complete",
          stopReason: result.stopReason,
          usage: result.usage ? {
            input_tokens: result.usage.inputTokens,
            output_tokens: result.usage.outputTokens,
          } : undefined,
        },
      };
      for (const handler of this.updateHandlers) {
        try { handler(turnCompleteNotification); } catch (err) { console.error("[AcpClient] Handler error:", err); }
      }
    }

    return result;
  }

  /**
   * Handle streaming SSE response from prompt endpoint.
   * Reads SSE events from the response body and dispatches notifications.
   */
  private async handleStreamingPromptResponse(
    response: Response,
    _sessionId: string
  ): Promise<AcpPromptResult> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Response body is not readable");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let lastStopReason = "end_turn";
    let lastUsage: { inputTokens: number; outputTokens: number } | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events (lines ending with \n\n)
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || ""; // Keep incomplete event in buffer

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;

          try {
            const jsonStr = line.slice(6); // Remove "data: " prefix
            const data = JSON.parse(jsonStr);

            // Dispatch notification to handlers
            if (data.method === "session/update" && data.params) {
              const notification = data.params as AcpSessionNotification;

              // Track turn_complete for return value
              const update = notification.update as Record<string, unknown> | undefined;
              if (update?.sessionUpdate === "turn_complete") {
                lastStopReason = (update.stopReason as string) || "end_turn";
                const usage = update.usage as Record<string, number> | undefined;
                if (usage) {
                  lastUsage = {
                    inputTokens: usage.input_tokens || 0,
                    outputTokens: usage.output_tokens || 0,
                  };
                }
              }

              for (const handler of this.updateHandlers) {
                try {
                  handler(notification);
                } catch (err) {
                  console.error("[AcpClient] Handler error:", err);
                }
              }
            }
          } catch (parseErr) {
            console.error("[AcpClient] SSE parse error:", parseErr);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      stopReason: lastStopReason,
      usage: lastUsage,
    };
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

  async respondToUserInput(
    sessionId: string,
    toolCallId: string,
    response: Record<string, unknown>,
  ): Promise<void> {
    await this.rpc("session/respond_user_input", {
      sessionId,
      toolCallId,
      response,
    });
  }

  async writeTerminal(
    sessionId: string,
    terminalId: string,
    data: string,
  ): Promise<AcpTerminalMutationResult> {
    return this.rpc("terminal/write", {
      sessionId,
      terminalId,
      data,
    });
  }

  async resizeTerminal(
    sessionId: string,
    terminalId: string,
    cols: number,
    rows: number,
  ): Promise<AcpTerminalMutationResult> {
    return this.rpc("terminal/resize", {
      sessionId,
      terminalId,
      cols,
      rows,
    });
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

  onConnectionIssue(handler: SessionConnectionIssueHandler): () => void {
    this.connectionIssueHandlers.push(handler);
    return () => {
      this.connectionIssueHandlers = this.connectionIssueHandlers.filter((h) => h !== handler);
    };
  }

  /**
   * Disconnect and clean up.
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this._sessionId = null;
    this.lastEventId = null;
    this.ownershipConflictRetryState.clear();
    this.updateHandlers = [];
    this.connectionIssueHandlers = [];
  }

  // ─── Private ─────────────────────────────────────────────────────────

  private connectSSE(sessionId: string): void {
    const attempt = ++this.sseAttempt;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    const url = new URL(resolveApiPath("api/acp", this.baseUrl || window.location.origin));
    url.searchParams.set("sessionId", sessionId);
    if (this.lastEventId) {
      url.searchParams.set("lastEventId", this.lastEventId);
    }
    url.searchParams.set("probe", "1");

    void this.probeSse(url, sessionId).then((issue) => {
      if (attempt !== this.sseAttempt || this._sessionId !== sessionId) {
        return;
      }

      if (issue) {
        this.emitConnectionIssue(issue);
        if (issue.retryable) {
          this.scheduleReconnect(issue.retryDelayMs ?? 2000);
        }
        return;
      }

      url.searchParams.delete("probe");
      this.eventSource = new EventSource(url.toString());

      this.eventSource.onmessage = (event) => {
        try {
          if (event.lastEventId) {
            this.lastEventId = event.lastEventId;
          }
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
        // EventSource auto-reconnects on transient errors, but if the
        // connection is CLOSED (readyState === 2) — e.g. after a server
        // restart / page refresh — we must reconnect manually.
        if (this.eventSource?.readyState === EventSource.CLOSED) {
          console.warn("[AcpClient] SSE connection closed, reconnecting in 2s...");
          this.scheduleReconnect();
        }
      };
    });
  }

  private scheduleReconnect(delayMs: number = 2000): void {
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this._sessionId) {
        this.connectSSE(this._sessionId);
      }
    }, delayMs);
  }

  private emitConnectionIssue(issue: AcpConnectionIssue): void {
    for (const handler of this.connectionIssueHandlers) {
      try {
        handler(issue);
      } catch (err) {
        console.error("[AcpClient] Connection issue handler error:", err);
      }
    }
  }

  private getOwnershipConflictRetryDelayMs(sessionId: string): number | null {
    const attempts = (this.ownershipConflictRetryState.get(sessionId) ?? 0) + 1;
    if (attempts > this.ownershipConflictRetryLimit) {
      this.ownershipConflictRetryState.delete(sessionId);
      return null;
    }
    this.ownershipConflictRetryState.set(sessionId, attempts);
    const backoff = this.ownershipConflictBaseDelayMs * (this.ownershipConflictBackoffMultiplier ** (attempts - 1));
    return Math.min(backoff, 10000);
  }

  private clearOwnershipConflictRetryState(sessionId: string): void {
    this.ownershipConflictRetryState.delete(sessionId);
  }

  private async probeSse(url: URL, sessionId: string): Promise<AcpConnectionIssue | null> {
    try {
      const response = await fetch(url.toString(), {
        headers: { Accept: "text/event-stream" },
      });

      if (response.ok) {
        this.clearOwnershipConflictRetryState(sessionId);
        return null;
      }

      let payload: Record<string, unknown> | null = null;
      try {
        payload = await response.json() as Record<string, unknown>;
      } catch {
        payload = null;
      }

      const message = typeof payload?.error === "string"
        ? payload.error
        : `SSE attach failed with status ${response.status}`;

      const ownershipConflictRetryDelayMs = response.status === 409
        ? this.getOwnershipConflictRetryDelayMs(sessionId)
        : null;

      return {
        sessionId,
        message,
        retryable: response.status !== 409 || ownershipConflictRetryDelayMs !== null,
        status: response.status,
        ownerInstanceId: typeof payload?.ownerInstanceId === "string" ? payload.ownerInstanceId : undefined,
        leaseExpiresAt: typeof payload?.leaseExpiresAt === "string" ? payload.leaseExpiresAt : undefined,
        retryDelayMs:
          response.status === 409
            ? ownershipConflictRetryDelayMs ?? undefined
            : undefined,
      };
    } catch (error) {
      console.warn("[AcpClient] SSE probe failed, falling back to EventSource:", error);
      this.clearOwnershipConflictRetryState(sessionId);
      return null;
    }
  }

  private async rpc<T = unknown>(
    method: string,
    params: Record<string, unknown>
  ): Promise<T> {
    const id = ++this.requestId;

    const response = await fetch(resolveApiPath("api/acp", this.baseUrl), {
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
      // Throw AcpClientError with auth info if available
      throw new AcpClientError(
        data.error.message,
        data.error.code,
        data.error.authMethods,
        data.error.agentInfo,
        data.error.data,
        data.error.sessionMayContinue,
      );
    }

    return data.result as T;
  }
}
