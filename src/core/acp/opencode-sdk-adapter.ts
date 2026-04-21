/**
 * OpenCode SDK Adapter for Serverless Environments (Vercel)
 *
 * Supports two modes:
 *
 * **Mode 1: Remote Server** — connects to a running OpenCode server
 * via the official @opencode-ai/sdk (REST API + SSE).
 *
 * **Mode 2: Direct API** — calls an OpenAI-compatible chat completions
 * endpoint directly (e.g. BigModel's Coding API). This mode is used when
 * OPENCODE_SERVER_URL is not set but OPENCODE_API_KEY (or ANTHROPIC_AUTH_TOKEN)
 * is available. It provides a lightweight chat experience without requiring
 * a running OpenCode server.
 *
 * Configuration via environment variables:
 *
 * Remote Server mode:
 * - OPENCODE_SERVER_URL: Remote server endpoint (required for this mode)
 * - OPENCODE_MODEL: Model in "providerID/modelID" format (optional)
 * - OPENCODE_DIRECTORY: Project working directory on the server (optional)
 *
 * Direct API mode:
 * - OPENCODE_API_KEY: API key (falls back to ANTHROPIC_AUTH_TOKEN)
 * - OPENCODE_BASE_URL: Chat completions base URL
 *     (default: https://open.bigmodel.cn/api/coding/paas/v4)
 * - OPENCODE_MODEL_ID: Model ID for completions (default: GLM-4.7)
 *
 * Common:
 * - API_TIMEOUT_MS: Request timeout in milliseconds (default: 55000)
 */

import type { NotificationHandler, JsonRpcMessage } from "@/core/acp/protocol-types";
import { isServerlessEnvironment } from "@/core/acp/api-based-providers";
import { getHttpSessionStore } from "@/core/acp/http-session-store";
import { renameSessionInDb } from "@/core/acp/session-db-persister";

/**
 * Helper to create a JSON-RPC notification message
 */
function createNotification(method: string, params: Record<string, unknown>): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    method,
    params,
  };
}

// ─── Minimal type definitions matching @opencode-ai/sdk v2 ────────────────

interface OpencodeClient {
  session: {
    create: (opts?: Record<string, unknown>) => Promise<{ data: OpencodeSession }>;
    prompt: (opts: {
      sessionID: string;
      parts: Array<{ type: string; text?: string; [k: string]: unknown }>;
      model?: { providerID: string; modelID: string };
      system?: string;
      agent?: string;
    }) => Promise<SessionPromptResult>;
    promptAsync: (opts: {
      sessionID: string;
      parts: Array<{ type: string; text?: string; [k: string]: unknown }>;
      model?: { providerID: string; modelID: string };
      system?: string;
      agent?: string;
    }) => Promise<void>;
    abort: (opts: { sessionID: string }) => Promise<void>;
    delete: (opts: { sessionID: string }) => Promise<void>;
    get: (opts: { sessionID: string }) => Promise<{ data: OpencodeSession }>;
  };
  event: {
    subscribe: (opts?: { directory?: string }) => Promise<{ stream: AsyncIterable<OpencodeEvent> }>;
  };
  global: {
    health: () => Promise<{ data: unknown }>;
  };
}

interface OpencodeSession {
  id: string;
  title: string;
  slug: string;
  directory: string;
  parentID?: string;
  time: { created: number; updated: number };
}

interface SessionPromptResult {
  data: {
    info: {
      id: string;
      sessionID: string;
      role: string;
      cost: number;
      tokens: {
        input: number;
        output: number;
        reasoning: number;
        cache: { read: number; write: number };
      };
      error?: { name: string; message: string };
    };
    parts: Array<OpencodePart>;
  };
}

interface OpencodePart {
  id: string;
  sessionID: string;
  messageID: string;
  type: string;
  text?: string;
  tool?: string;
  callID?: string;
  state?: {
    status: string;
    input?: Record<string, unknown>;
    output?: string;
    title?: string;
    error?: string;
  };
  [k: string]: unknown;
}

interface OpencodeEvent {
  type: string;
  properties: Record<string, unknown>;
}

/**
 * Check if OpenCode SDK mode is available.
 * Returns true when either a remote server URL OR a direct API key is configured.
 */
export function isOpencodeServerConfigured(): boolean {
  return !!process.env.OPENCODE_SERVER_URL || isOpencodeDirectApiConfigured();
}

/**
 * Check if Direct API mode is available (no server needed).
 * Requires OPENCODE_API_KEY or falls back to ANTHROPIC_AUTH_TOKEN.
 */
export function isOpencodeDirectApiConfigured(): boolean {
  return !!(process.env.OPENCODE_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * Get the OpenCode server URL from environment
 */
export function getOpencodeServerUrl(): string | null {
  return process.env.OPENCODE_SERVER_URL || null;
}

/**
 * Get OpenCode SDK configuration from environment
 */
export function getOpencodeConfig(): {
  serverUrl: string | undefined;
  model: { providerID: string; modelID: string } | undefined;
  directory: string | undefined;
  timeoutMs: number;
  /** Direct API mode config (when no server URL) */
  directApi: {
    apiKey: string | undefined;
    baseUrl: string;
    modelId: string;
  };
} {
  const modelStr = process.env.OPENCODE_MODEL;
  let model: { providerID: string; modelID: string } | undefined;
  if (modelStr && modelStr.includes("/")) {
    const [providerID, ...rest] = modelStr.split("/");
    model = { providerID, modelID: rest.join("/") };
  }

  return {
    serverUrl: process.env.OPENCODE_SERVER_URL,
    model,
    directory: process.env.OPENCODE_DIRECTORY,
    timeoutMs: parseInt(process.env.API_TIMEOUT_MS || "55000", 10),
    directApi: {
      apiKey: process.env.OPENCODE_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN,
      baseUrl: process.env.OPENCODE_BASE_URL || "https://open.bigmodel.cn/api/coding/paas/v4",
      modelId: process.env.OPENCODE_MODEL_ID || process.env.ANTHROPIC_MODEL || "GLM-4.7",
    },
  };
}

/**
 * OpenCode SDK Adapter — wraps the official OpenCode SDK to provide an
 * ACP-compatible streaming interface for serverless environments.
 *
 * Session Continuity:
 * - Maintains OpenCode session ID for multi-turn conversations
 * - Uses promptAsync + SSE events for non-blocking streaming
 * - Maps OpenCode events to ACP agent_message_chunk / tool_call notifications
 */
export class OpencodeSdkAdapter {
  private client: OpencodeClient | null = null;
  /** Our ACP session ID (for notifications) */
  private sessionId: string | null = null;
  /** OpenCode server's session ID */
  private opencodeSessionId: string | null = null;
  private onNotification: NotificationHandler;
  private serverUrl: string;
  private _alive = false;
  private abortController: AbortController | null = null;

  constructor(serverUrl: string, onNotification: NotificationHandler) {
    this.serverUrl = serverUrl;
    this.onNotification = onNotification;
  }

  get alive(): boolean {
    return this._alive;
  }

  get acpSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Initialize connection to the OpenCode server
   */
  async connect(): Promise<void> {
    const config = getOpencodeConfig();

    try {
      // Dynamic import to avoid bundling issues when SDK is not installed
      const { createOpencodeClient } = await import("@opencode-ai/sdk/v2/client");

      this.client = createOpencodeClient({
        baseUrl: this.serverUrl,
        ...(config.directory ? { directory: config.directory } : {}),
      }) as unknown as OpencodeClient;

      // Test connection by health check
      await this.client.global.health();

      console.log(`[OpencodeSdkAdapter] Connected to OpenCode server at ${this.serverUrl}`);
      if (config.model) {
        console.log(`[OpencodeSdkAdapter] Using model: ${config.model.providerID}/${config.model.modelID}`);
      }
      this._alive = true;
    } catch (error) {
      console.error("[OpencodeSdkAdapter] Failed to connect:", error);
      throw new Error(
        `Failed to connect to OpenCode server at ${this.serverUrl}: ${error}`,
        { cause: error }
      );
    }
  }

  /**
   * Create a new session on the remote OpenCode server
   */
  async createSession(title?: string): Promise<string> {
    if (!this.client) {
      throw new Error("Not connected to OpenCode server");
    }

    const response = await this.client.session.create({
      title: title || "Routa Session",
    });

    this.opencodeSessionId = response.data.id;
    this.sessionId = `opencode-sdk-${this.opencodeSessionId}`;
    this._alive = true;

    console.log(`[OpencodeSdkAdapter] Created session: ${this.opencodeSessionId}`);
    return this.sessionId;
  }

  /**
   * Send a prompt and return a streaming async generator of SSE events.
   * Each yielded string is a complete SSE event (data: JSON\n\n format).
   * This allows the HTTP response to stream in serverless environments.
   *
   * Uses promptAsync + SSE event subscription for real-time streaming.
   *
   * @param text - The prompt text
   * @param acpSessionId - The ACP session ID to use in notifications
   * @param skillContent - Optional skill content to inject via system prompt
   */
  async *promptStream(
    text: string,
    acpSessionId?: string,
    skillContent?: string,
  ): AsyncGenerator<string, void, unknown> {
    if (!this._alive || !this.client || !this.opencodeSessionId) {
      throw new Error("No active session");
    }

    const config = getOpencodeConfig();
    this.abortController = new AbortController();
    const sessionId = acpSessionId ?? this.sessionId!;
    const opcSessionId = this.opencodeSessionId;

    console.log(
      `[OpencodeSdkAdapter] promptStream: serverUrl=${this.serverUrl}, ` +
      `opcSession=${opcSessionId}, model=${config.model ? `${config.model.providerID}/${config.model.modelID}` : "default"}`
    );

    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason = "end_turn";
    // Track partID → part type (e.g. "text", "reasoning") for delta events
    const partTypeMap = new Map<string, string>();

    // Helper to format SSE event
    const formatSseEvent = (notification: JsonRpcMessage): string => {
      return `data: ${JSON.stringify(notification)}\n\n`;
    };

    try {
      // 1. Subscribe to SSE events BEFORE sending the prompt
      //    This ensures we don't miss any events
      const eventStream = await this.client.event.subscribe();

      // 2. Send prompt asynchronously (returns immediately with 204)
      const promptBody: Record<string, unknown> = {
        sessionID: opcSessionId,
        parts: [{ type: "text" as const, text }],
      };
      if (config.model) {
        promptBody.model = config.model;
      }
      if (skillContent) {
        promptBody.system = skillContent;
      }

      // Fire prompt asynchronously
      await this.client.session.promptAsync(promptBody as Parameters<OpencodeClient["session"]["promptAsync"]>[0]);

      // 3. Consume SSE events and yield ACP notifications
      for await (const event of eventStream.stream) {
        if (this.abortController?.signal.aborted) {
          stopReason = "cancelled";
          break;
        }

        // Filter events for our session only
        const props = event.properties as Record<string, unknown>;
        const eventSessionId = (props.sessionID as string) ??
          ((props.info as Record<string, unknown>)?.sessionID as string) ??
          ((props.part as Record<string, unknown>)?.sessionID as string);

        if (eventSessionId && eventSessionId !== opcSessionId) {
          continue; // Skip events for other sessions
        }

        // Convert OpenCode event to ACP notification and yield
        const notification = this.createNotificationFromEvent(event, sessionId, partTypeMap);
        if (notification) {
          this.onNotification(notification);
          yield formatSseEvent(notification);
        }

        // Track token usage from message.updated events
        if (event.type === "message.updated") {
          const info = props.info as Record<string, unknown> | undefined;
          if (info?.role === "assistant") {
            const tokens = info.tokens as Record<string, number> | undefined;
            if (tokens) {
              inputTokens = tokens.input ?? inputTokens;
              outputTokens = tokens.output ?? outputTokens;
            }
          }
        }

        // Session idle means the agent is done processing
        if (event.type === "session.idle") {
          if (eventSessionId === opcSessionId || !eventSessionId) {
            stopReason = "end_turn";
            break;
          }
        }

        // Session error
        if (event.type === "session.error") {
          const error = props.error as Record<string, unknown> | undefined;
          stopReason = "error";
          const errorNotification = createNotification("session/update", {
            sessionId,
            type: "error",
            error: { message: (error?.message as string) ?? "OpenCode session error" },
          });
          this.onNotification(errorNotification);
          yield formatSseEvent(errorNotification);
          break;
        }
      }

      // Yield turn_complete event
      const completeNotification = createNotification("session/update", {
        sessionId,
        update: {
          sessionUpdate: "turn_complete",
          stopReason,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        },
      });
      this.onNotification(completeNotification);
      yield formatSseEvent(completeNotification);

    } catch (error) {
      if (!this.abortController?.signal.aborted) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("[OpencodeSdkAdapter] promptStream failed:", errorMessage);
        const errorNotification = createNotification("session/update", {
          sessionId,
          type: "error",
          error: { message: errorMessage },
        });
        this.onNotification(errorNotification);
        yield formatSseEvent(errorNotification);
      }
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Send a prompt through the OpenCode SDK (blocking version).
   * Streams ACP notifications for real-time UI updates.
   * @deprecated Use promptStream() for serverless streaming
   */
  async prompt(
    text: string,
    model?: { providerID: string; modelID: string },
  ): Promise<{
    stopReason: string;
    content?: string;
    usage?: { inputTokens: number; outputTokens: number };
  }> {
    if (!this._alive || !this.client || !this.opencodeSessionId) {
      throw new Error("No active session");
    }

    const config = getOpencodeConfig();
    const sessionId = this.sessionId!;
    const resolvedModel = model ?? config.model;

    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason = "end_turn";
    let fullContent = "";

    try {
      // Use synchronous prompt (blocks until agent finishes)
      const result = await this.client.session.prompt({
        sessionID: this.opencodeSessionId,
        parts: [{ type: "text", text }],
        ...(resolvedModel ? { model: resolvedModel } : {}),
      });

      const { info, parts } = result.data;

      // Extract tokens
      if (info.tokens) {
        inputTokens = info.tokens.input ?? 0;
        outputTokens = info.tokens.output ?? 0;
      }

      // Check for errors
      if (info.error) {
        stopReason = "error";
        this.onNotification(createNotification("session/update", {
          sessionId,
          type: "error",
          error: { message: info.error.message },
        }));
      }

      // Dispatch parts as ACP notifications
      for (const part of parts) {
        const notification = this.createNotificationFromPart(part, sessionId);
        if (notification) {
          this.onNotification(notification);
        }
        if (part.type === "text" && part.text) {
          fullContent += part.text;
        }
      }

      // Emit turn_complete
      this.onNotification(createNotification("session/update", {
        sessionId,
        update: {
          sessionUpdate: "turn_complete",
          stopReason,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        },
      }));

      return {
        stopReason,
        content: fullContent,
        usage: { inputTokens, outputTokens },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[OpencodeSdkAdapter] Prompt failed:", errorMessage);
      this.onNotification(createNotification("session/update", {
        sessionId,
        type: "error",
        error: { message: errorMessage },
      }));
      throw error;
    }
  }

  /**
   * Convert an OpenCode SSE event to an ACP session/update notification.
   * Returns null if the event doesn't produce a notification.
   *
   * Event mapping:
   *   message.part.delta (text)  → agent_message_chunk  (real-time text)
   *   message.part.updated (text) → agent_message_chunk  (full text fallback)
   *   message.part.updated (tool) → tool_call / tool_call_update
   *   message.part.updated (reasoning) → agent_thought_chunk
   *   message.updated (assistant) → token usage tracking
   *   session.idle              → (triggers turn_complete externally)
   */
  private createNotificationFromEvent(event: OpencodeEvent, sessionId: string, partTypeMap?: Map<string, string>): JsonRpcMessage | null {
    const props = event.properties;

    switch (event.type) {
      // ── Streaming text delta (incremental) ──────────────────────────
      case "message.part.delta": {
        const delta = props.delta as string | undefined;
        const content = props.content as string | undefined;
        const field = props.field as string | undefined;
        const partID = props.partID as string | undefined;
        const text = delta ?? content;

        if (!text) return null;

        // Determine if this delta belongs to a reasoning part.
        // The `field` property always says "text" (it's the Part's field name),
        // so we use the partTypeMap to check the actual part type.
        const partType = partID ? partTypeMap?.get(partID) : undefined;
        const isReasoning = partType === "reasoning" || field === "reasoning";

        if (isReasoning) {
          return createNotification("session/update", {
            sessionId,
            update: {
              sessionUpdate: "agent_thought_chunk",
              content: { type: "text", text },
            },
          });
        }

        return createNotification("session/update", {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text },
          },
        });
      }

      // ── Part created/updated (tool state changes only) ──────────────
      // Text and reasoning are already handled by message.part.delta events
      // above, so we only process tool parts here to avoid duplicates.
      // We also register part IDs to track their type for delta events.
      case "message.part.updated": {
        const part = props.part as OpencodePart | undefined;
        if (!part) return null;
        // Register part type for future delta events
        if (part.id && partTypeMap) {
          partTypeMap.set(part.id, part.type);
        }
        // Skip text and reasoning — already streamed via deltas
        if (part.type === "text" || part.type === "reasoning") return null;
        return this.createNotificationFromPart(part, sessionId);
      }

      // ── Message updated (track tokens, detect errors) ──────────────
      case "message.updated": {
        const info = props.info as Record<string, unknown> | undefined;
        if (!info) return null;

        // Check for error in assistant message
        if (info.role === "assistant" && info.error) {
          const error = info.error as Record<string, unknown>;
          return createNotification("session/update", {
            sessionId,
            type: "error",
            error: { message: (error.message as string) ?? "Agent error" },
          });
        }
        return null;
      }

      // ── Session status changes ─────────────────────────────────────
      case "session.status": {
        const status = props.status as Record<string, string> | undefined;
        if (status?.type === "busy") {
          // Agent started working - could send a status notification
          return null;
        }
        return null;
      }

      // ── File edits (useful for tracking) ───────────────────────────
      case "file.edited": {
        const file = props.file as string | undefined;
        if (file) {
          return createNotification("session/update", {
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: `file-edit-${Date.now()}`,
              title: `Edit: ${file}`,
              status: "completed",
            },
          });
        }
        return null;
      }

      default:
        return null;
    }
  }

  /**
   * Convert an OpenCode Part object to an ACP notification.
   */
  private createNotificationFromPart(part: OpencodePart, sessionId: string): JsonRpcMessage | null {
    switch (part.type) {
      case "text": {
        if (part.text) {
          return createNotification("session/update", {
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: part.text },
            },
          });
        }
        return null;
      }

      case "reasoning": {
        const text = part.text;
        if (text) {
          return createNotification("session/update", {
            sessionId,
            update: {
              sessionUpdate: "agent_thought_chunk",
              content: { type: "text", text },
            },
          });
        }
        return null;
      }

      case "tool": {
        const state = part.state;
        if (!state) return null;

        const toolCallId = part.callID ?? part.id;
        const toolName = part.tool ?? "unknown";

        switch (state.status) {
          case "pending":
            return createNotification("session/update", {
              sessionId,
              update: {
                sessionUpdate: "tool_call",
                title: toolName,
                toolCallId,
                status: "running",
                rawInput: state.input,
              },
            });

          case "running":
            return createNotification("session/update", {
              sessionId,
              update: {
                sessionUpdate: "tool_call",
                // Always use part.tool as the canonical name; state.title from OpenCode
                // may be a generic category like "other" for custom MCP tools.
                title: toolName !== "unknown" ? toolName : (state.title ?? toolName),
                toolCallId,
                status: "running",
                rawInput: state.input,
              },
            });

          case "completed":
            return createNotification("session/update", {
              sessionId,
              update: {
                sessionUpdate: "tool_call_update",
                // Always use part.tool as the canonical name; state.title from OpenCode
                // may be a generic category like "other" for custom MCP tools.
                title: toolName !== "unknown" ? toolName : (state.title ?? toolName),
                toolCallId,
                status: "completed",
                rawInput: state.input,
                rawOutput: state.output,
              },
            });

          case "error":
            return createNotification("session/update", {
              sessionId,
              update: {
                sessionUpdate: "tool_call_update",
                title: toolName !== "unknown" ? toolName : (state.title ?? toolName),
                toolCallId,
                status: "completed",
                rawOutput: state.error ?? "Tool execution failed",
              },
            });

          default:
            return null;
        }
      }

      case "step-start":
        return null;

      case "step-finish": {
        // step-finish contains cost/token info - could track
        return null;
      }

      default:
        return null;
    }
  }

  /**
   * Cancel the in-progress prompt.
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    // Also abort on the server side
    if (this.client && this.opencodeSessionId) {
      this.client.session.abort({ sessionID: this.opencodeSessionId }).catch(() => {});
    }
  }

  /**
   * Close the session and disconnect.
   */
  async close(): Promise<void> {
    this.cancel();
    if (this.client && this.opencodeSessionId) {
      try {
        await this.client.session.delete({ sessionID: this.opencodeSessionId });
      } catch {
        // Ignore cleanup errors
      }
    }
    this.sessionId = null;
    this.opencodeSessionId = null;
    this.client = null;
    this._alive = false;
  }

  /**
   * Synchronous alias for close (used by process-exit handlers).
   */
  kill(): void {
    this.close().catch(() => {});
  }
}

/**
 * Check if we should use the OpenCode SDK adapter
 */
export function shouldUseOpencodeAdapter(): boolean {
  return isServerlessEnvironment() && isOpencodeServerConfigured();
}

/**
 * Create an OpenCode SDK adapter if conditions are met.
 * Prefers Remote Server mode when OPENCODE_SERVER_URL is set,
 * otherwise falls back to Direct API mode.
 */
export function createOpencodeAdapterIfAvailable(
  onNotification: NotificationHandler
): OpencodeSdkAdapter | OpencodeSdkDirectAdapter | null {
  const serverUrl = getOpencodeServerUrl();
  if (serverUrl) {
    return new OpencodeSdkAdapter(serverUrl, onNotification);
  }

  // Fall back to direct API mode (BigModel Coding API, etc.)
  if (isOpencodeDirectApiConfigured()) {
    return new OpencodeSdkDirectAdapter(onNotification);
  }

  return null;
}


// ─── Direct API Adapter ────────────────────────────────────────────────────

/**
 * Chat message for conversation history (OpenAI-compatible format).
 * Supports plain messages, tool result messages, and assistant messages with tool_calls.
 */
interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  reasoning_content?: string;
  /** Populated on assistant turns that produced function calls */
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  /** Populated on tool-result turns */
  tool_call_id?: string;
}

/**
 * OpenCode SDK Direct Adapter — calls an OpenAI-compatible chat completions
 * endpoint directly, without requiring a running OpenCode server.
 *
 * This is used when OPENCODE_SERVER_URL is not set but API credentials are
 * available (e.g. BigModel's Coding API at
 * https://open.bigmodel.cn/api/coding/paas/v4).
 *
 * Features:
 * - Streaming SSE responses (text + reasoning)
 * - Multi-turn conversation history (in-memory)
 * - Maps responses to ACP session/update notifications
 */
export class OpencodeSdkDirectAdapter {
  private sessionId: string | null = null;
  private onNotification: NotificationHandler;
  private _alive = false;
  private abortController: AbortController | null = null;
  /** Conversation history for multi-turn */
  private messages: ChatMessage[] = [];

  constructor(onNotification: NotificationHandler) {
    this.onNotification = onNotification;
  }

  get alive(): boolean {
    return this._alive;
  }

  get acpSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Initialize — validates that API credentials are present.
   */
  async connect(): Promise<void> {
    const config = getOpencodeConfig();

    if (!config.directApi.apiKey) {
      throw new Error(
        "OpenCode Direct API requires OPENCODE_API_KEY or ANTHROPIC_AUTH_TOKEN environment variable"
      );
    }

    this.sessionId = `opencode-direct-${Date.now()}`;
    this._alive = true;
    console.log(
      `[OpencodeSdkDirectAdapter] Initialized with model: ${config.directApi.modelId}, ` +
      `endpoint: ${config.directApi.baseUrl}`
    );
  }

  /**
   * Create a session (API compatibility)
   */
  async createSession(title?: string): Promise<string> {
    if (!this._alive) {
      throw new Error("Adapter not connected");
    }
    // Reset conversation history for new session
    this.messages = [];
    console.log(
      `[OpencodeSdkDirectAdapter] Session created: ${this.sessionId} (${title || "untitled"})`
    );
    return this.sessionId!;
  }

  /**
   * Send a prompt and return a streaming async generator of SSE events.
   * Uses OpenAI-compatible chat completions with streaming and agentic tool-call loop.
   *
   * @param workspaceId - The workspace ID used for tool execution context.
   */
  async *promptStream(
    text: string,
    acpSessionId?: string,
    skillContent?: string,
    workspaceId?: string,
  ): AsyncGenerator<string, void, unknown> {
    if (!this._alive || !this.sessionId) {
      throw new Error("No active session");
    }

    const config = getOpencodeConfig();
    const { directApi } = config;
    this.abortController = new AbortController();
    const sessionId = acpSessionId ?? this.sessionId;

    console.log(
      `[OpencodeSdkDirectAdapter] promptStream: model=${directApi.modelId}, ` +
      `endpoint=${directApi.baseUrl}`
    );

    const formatSseEvent = (notification: JsonRpcMessage): string => {
      return `data: ${JSON.stringify(notification)}\n\n`;
    };

    // Build OpenAI-compatible tool definitions for function calling
    const { getMcpToolDefinitions } = await import("@/core/mcp/mcp-tool-executor");
    const toolDefs = getMcpToolDefinitions("essential").map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));

    // Build message history for this turn
    const requestMessages: ChatMessage[] = [];
    if (skillContent) {
      requestMessages.push({ role: "system", content: skillContent });
    }
    requestMessages.push(...this.messages);
    requestMessages.push({ role: "user", content: text });
    this.messages.push({ role: "user", content: text });

    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason = "end_turn";

    const url = `${directApi.baseUrl}/chat/completions`;
    const MAX_TOOL_ROUNDS = 10;

    try {
      // ── Agentic tool-call loop ────────────────────────────────────────
      for (let toolRound = 0; toolRound < MAX_TOOL_ROUNDS; toolRound++) {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${directApi.apiKey}`,
          },
          body: JSON.stringify({
            model: directApi.modelId,
            messages: requestMessages,
            stream: true,
            max_tokens: 16384,
            tools: toolDefs,
            tool_choice: "auto",
          }),
          signal: this.abortController.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API request failed (${response.status}): ${errorText}`);
        }
        if (!response.body) throw new Error("No response body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // Accumulator for streaming tool_calls delta chunks
        type ToolCallAcc = { id: string; name: string; argumentStr: string };
        const toolCallAcc: Record<number, ToolCallAcc> = {};
        let roundContent = "";
        let roundFinishReason = "";

        // ── Stream reading loop ─────────────────────────────────────────
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (this.abortController?.signal.aborted) {
            stopReason = "cancelled";
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === "data: [DONE]") continue;
            if (!trimmed.startsWith("data: ")) continue;

            try {
              const data = JSON.parse(trimmed.slice(6));
              const choice = data.choices?.[0];
              if (!choice) continue;
              const delta = choice.delta;
              if (!delta) continue;

              // Accumulate tool_call delta chunks by index
              if (Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const idx: number = tc.index ?? 0;
                  if (!toolCallAcc[idx]) {
                    toolCallAcc[idx] = { id: tc.id ?? "", name: tc.function?.name ?? "", argumentStr: "" };
                  } else {
                    if (tc.id) toolCallAcc[idx].id = tc.id;
                    if (tc.function?.name) toolCallAcc[idx].name += tc.function.name;
                  }
                  if (tc.function?.arguments) {
                    toolCallAcc[idx].argumentStr += tc.function.arguments;
                  }
                }
              }

              // Reasoning content (GLM-specific)
              if (delta.reasoning_content) {
                const n = createNotification("session/update", {
                  sessionId,
                  update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: delta.reasoning_content } },
                });
                this.onNotification(n);
                yield formatSseEvent(n);
              }

              // Regular text content
              if (delta.content) {
                roundContent += delta.content;
                const n = createNotification("session/update", {
                  sessionId,
                  update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: delta.content } },
                });
                this.onNotification(n);
                yield formatSseEvent(n);
              }

              if (choice.finish_reason) {
                roundFinishReason = choice.finish_reason;
                stopReason = choice.finish_reason === "stop" ? "end_turn" : choice.finish_reason;
              }

              if (data.usage) {
                inputTokens = data.usage.prompt_tokens ?? inputTokens;
                outputTokens = data.usage.completion_tokens ?? outputTokens;
              }
            } catch {
              // Skip unparseable SSE lines
            }
          }
        }

        // ── Handle tool calls ───────────────────────────────────────────
        const pendingCalls = Object.entries(toolCallAcc);
        if (roundFinishReason === "tool_calls" && pendingCalls.length > 0) {
          // Append assistant turn with tool_calls to conversation
          requestMessages.push({
            role: "assistant",
            content: roundContent || null,
            tool_calls: pendingCalls.map(([, tc]) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.argumentStr },
            })),
          });

          // Execute each tool call and append result
          for (const [, tc] of pendingCalls) {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(tc.argumentStr); } catch { /* use empty args */ }

            // Inject workspaceId when the tool requires it but the model didn't supply it
            if (workspaceId && !args.workspaceId) {
              args.workspaceId = workspaceId;
            }
            if (!args.sessionId) {
              args.sessionId = sessionId;
            }

            console.log(`[OpencodeSdkDirectAdapter] tool_call: ${tc.name}`, args);

            // Notify client that a tool call is starting (use same field names as other adapters)
            const tcStart = createNotification("session/update", {
              sessionId,
              update: {
                sessionUpdate: "tool_call",
                title: tc.name,
                toolCallId: tc.id,
                status: "running",
                rawInput: args,
              },
            });
            this.onNotification(tcStart);
            yield formatSseEvent(tcStart);

            let toolResult: unknown;
            try {
              if (workspaceId) {
                const [
                  { createRoutaMcpServer },
                  { executeMcpTool },
                  { KanbanTools },
                ] = await Promise.all([
                  import("@/core/mcp/routa-mcp-server"),
                  import("@/core/mcp/mcp-tool-executor"),
                  import("@/core/tools/kanban-tools"),
                ]);
                const { system } = createRoutaMcpServer({ workspaceId, toolMode: "essential" });
                const kanbanTools = new KanbanTools(system.kanbanBoardStore, system.taskStore);
                kanbanTools.setEventBus(system.eventBus);
                kanbanTools.setAutomationSystem(system);
                toolResult = await executeMcpTool(system.tools, tc.name, args, system.noteTools, system.workspaceTools, kanbanTools);
              } else {
                toolResult = { content: [{ type: "text", text: JSON.stringify({ error: "workspaceId not available" }) }], isError: true };
              }
            } catch (e) {
              toolResult = { content: [{ type: "text", text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true };
            }

            // Extract text content from result
            const resultAny = toolResult as { content?: Array<{ type: string; text?: string }>; isError?: boolean } | null;
            const resultContent: Array<{ type: string; text?: string }> = Array.isArray(resultAny?.content)
              ? resultAny!.content
              : [{ type: "text", text: JSON.stringify(toolResult) }];

            // Special handling: set_agent_name actually renames the ACP session
            if (tc.name === "set_agent_name" && !resultAny?.isError && args.name) {
              try {
                const store = getHttpSessionStore();
                store.renameSession(sessionId, args.name as string);
                await renameSessionInDb(sessionId, args.name as string);
              } catch {
                // non-fatal — rename is best-effort
              }
            }

            // Notify client with tool result (send content only — not rawOutput — to avoid duplicate display)
            const tcResult = createNotification("session/update", {
              sessionId,
              update: {
                sessionUpdate: "tool_call_update",
                title: tc.name,
                toolCallId: tc.id,
                status: resultAny?.isError ? "failed" : "completed",
                rawInput: args,
                content: resultContent,
              },
            });
            this.onNotification(tcResult);
            yield formatSseEvent(tcResult);

            // Append tool result message to conversation
            requestMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult),
            });
          }

          // Continue loop — model will respond with the tool results in context
          continue;
        }

        // ── Normal completion (no tool calls) ───────────────────────────
        if (roundContent) {
          this.messages.push({ role: "assistant", content: roundContent });
        }
        break;
      }

      // Yield turn_complete
      const completeNotification = createNotification("session/update", {
        sessionId,
        update: {
          sessionUpdate: "turn_complete",
          stopReason,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        },
      });
      this.onNotification(completeNotification);
      yield formatSseEvent(completeNotification);

    } catch (error) {
      if (!this.abortController?.signal.aborted) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("[OpencodeSdkDirectAdapter] promptStream failed:", errorMessage);
        const errorNotification = createNotification("session/update", {
          sessionId,
          type: "error",
          error: { message: errorMessage },
        });
        this.onNotification(errorNotification);
        yield formatSseEvent(errorNotification);
      }
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Cancel the in-progress prompt.
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Close the session and disconnect.
   */
  async close(): Promise<void> {
    this.cancel();
    this.sessionId = null;
    this.messages = [];
    this._alive = false;
  }

  /**
   * Synchronous alias for close.
   */
  kill(): void {
    this.close().catch(() => {});
  }
}
