/**
 * OpenCode SDK Adapter for Serverless Environments
 * 
 * This adapter uses the @opencode-ai/sdk to connect to a remote OpenCode server
 * instead of spawning a local CLI process. This makes it compatible with
 * serverless platforms like Vercel.
 * 
 * Requirements:
 * - A running OpenCode server (e.g., `opencode serve` on a VPS)
 * - Environment variable: OPENCODE_SERVER_URL (e.g., "http://your-server:4096")
 * - Optional: OPENCODE_SERVER_PASSWORD for authentication
 */

import type { NotificationHandler, JsonRpcMessage } from "@/core/acp/processer";
import { isServerlessEnvironment } from "@/core/acp/api-based-providers";

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

// Types from OpenCode SDK
interface OpencodeClient {
  session: {
    create: (opts: { body: { title?: string } }) => Promise<{ data: { id: string } }>;
    prompt: (opts: {
      path: { id: string };
      body: {
        model?: { providerID: string; modelID: string };
        parts: Array<{ type: string; text: string }>;
      };
    }) => Promise<SessionPromptResult>;
    abort: (opts: { path: { id: string } }) => Promise<{ data: boolean }>;
    delete: (opts: { path: { id: string } }) => Promise<{ data: boolean }>;
  };
  config: {
    get: () => Promise<{ data: unknown }>;
  };
  global: {
    event: () => Promise<{ stream: AsyncIterable<ServerEvent> }>;
  };
}

interface SessionPromptResult {
  data: {
    info: {
      id: string;
      sessionID: string;
      role: string;
      structured_output?: unknown;
      error?: { name: string; message: string; retries?: number };
    };
    parts: Array<{
      type: string;
      text?: string;
      toolCallId?: string;
      toolName?: string;
      state?: string;
    }>;
  };
}

interface ServerEvent {
  type: string;
  properties: Record<string, unknown>;
}

/**
 * Check if OpenCode SDK mode is available
 */
export function isOpencodeServerConfigured(): boolean {
  return !!process.env.OPENCODE_SERVER_URL;
}

/**
 * Get the OpenCode server URL from environment
 */
export function getOpencodeServerUrl(): string | null {
  return process.env.OPENCODE_SERVER_URL || null;
}

/**
 * OpenCode SDK Adapter - wraps the SDK client to provide ACP-like interface
 */
export class OpencodeSdkAdapter {
  private client: OpencodeClient | null = null;
  private sessionId: string | null = null;
  private onNotification: NotificationHandler;
  private serverUrl: string;
  private _alive = false;

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
    try {
      // Dynamic import to avoid bundling issues when SDK is not installed
      const { createOpencodeClient } = await import("@opencode-ai/sdk");

      this.client = createOpencodeClient({
        baseUrl: this.serverUrl,
      }) as unknown as OpencodeClient;

      // Test connection by getting config
      await this.client.config.get();

      console.log(`[OpencodeSdkAdapter] Connected to OpenCode server at ${this.serverUrl}`);
      this._alive = true;
    } catch (error) {
      console.error("[OpencodeSdkAdapter] Failed to connect:", error);
      throw new Error(`Failed to connect to OpenCode server at ${this.serverUrl}: ${error}`);
    }
  }

  /**
   * Create a new session on the remote server
   */
  async createSession(title?: string): Promise<string> {
    if (!this.client) {
      throw new Error("Not connected to OpenCode server");
    }

    const response = await this.client.session.create({
      body: { title: title || "Routa Session" },
    });

    this.sessionId = response.data.id;
    console.log(`[OpencodeSdkAdapter] Created session: ${this.sessionId}`);
    return this.sessionId;
  }

  /**
   * Send a prompt to the session
   */
  async prompt(
    text: string,
    model?: { providerID: string; modelID: string }
  ): Promise<void> {
    if (!this.client || !this.sessionId) {
      throw new Error("No active session");
    }

    try {
      // Start listening to events before sending the prompt
      this.subscribeToEvents();

      const result = await this.client.session.prompt({
        path: { id: this.sessionId },
        body: {
          model,
          parts: [{ type: "text", text }],
        },
      });

      // Convert SDK response to ACP-style notification
      this.emitSessionUpdate(result);
    } catch (error) {
      console.error("[OpencodeSdkAdapter] Prompt failed:", error);
      this.onNotification(createNotification("session/update", {
        sessionId: this.sessionId,
        type: "error",
        error: { message: String(error) },
      }));
    }
  }

  /**
   * Subscribe to server events for real-time updates
   */
  private async subscribeToEvents(): Promise<void> {
    if (!this.client) return;

    try {
      const events = await this.client.global.event();

      // Process events in the background
      (async () => {
        try {
          for await (const event of events.stream) {
            this.handleServerEvent(event);
          }
        } catch (error) {
          console.error("[OpencodeSdkAdapter] Event stream error:", error);
        }
      })();
    } catch (error) {
      console.error("[OpencodeSdkAdapter] Failed to subscribe to events:", error);
    }
  }

  /**
   * Handle server-sent events
   */
  private handleServerEvent(event: ServerEvent): void {
    if (!this.sessionId) return;

    // Map OpenCode events to ACP notifications
    switch (event.type) {
      case "message_start":
        this.onNotification(createNotification("session/update", {
          sessionId: this.sessionId,
          type: "message_start",
          message: event.properties,
        }));
        break;

      case "text_delta":
        this.onNotification(createNotification("session/update", {
          sessionId: this.sessionId,
          type: "text_delta",
          delta: event.properties.text || "",
        }));
        break;

      case "tool_call":
        this.onNotification(createNotification("session/update", {
          sessionId: this.sessionId,
          type: "tool_call",
          toolCall: event.properties,
        }));
        break;

      case "message_end":
        this.onNotification(createNotification("session/update", {
          sessionId: this.sessionId,
          type: "message_end",
          message: event.properties,
        }));
        break;

      case "error":
        this.onNotification(createNotification("session/update", {
          sessionId: this.sessionId,
          type: "error",
          error: event.properties,
        }));
        break;

      default:
        // Forward unknown events as-is
        this.onNotification(createNotification("session/update", {
          sessionId: this.sessionId,
          type: event.type,
          ...event.properties,
        }));
    }
  }

  /**
   * Convert SDK response to ACP-style session update notification
   */
  private emitSessionUpdate(result: SessionPromptResult): void {
    const { info, parts } = result.data;

    // Emit message start
    this.onNotification(createNotification("session/update", {
      sessionId: this.sessionId,
      type: "message_start",
      message: {
        id: info.id,
        role: info.role,
      },
    }));

    // Emit content parts
    for (const part of parts) {
      if (part.type === "text" && part.text) {
        this.onNotification(createNotification("session/update", {
          sessionId: this.sessionId,
          type: "text_delta",
          delta: part.text,
        }));
      } else if (part.type === "tool-invocation") {
        this.onNotification(createNotification("session/update", {
          sessionId: this.sessionId,
          type: "tool_call",
          toolCall: {
            id: part.toolCallId,
            name: part.toolName,
            state: part.state,
          },
        }));
      }
    }

    // Emit message end
    this.onNotification(createNotification("session/update", {
      sessionId: this.sessionId,
      type: "message_end",
      message: {
        id: info.id,
        role: info.role,
      },
    }));
  }

  /**
   * Abort the current prompt
   */
  async abort(): Promise<void> {
    if (!this.client || !this.sessionId) return;

    try {
      await this.client.session.abort({ path: { id: this.sessionId } });
    } catch (error) {
      console.error("[OpencodeSdkAdapter] Abort failed:", error);
    }
  }

  /**
   * Close the session and disconnect
   */
  async close(): Promise<void> {
    if (this.client && this.sessionId) {
      try {
        await this.client.session.delete({ path: { id: this.sessionId } });
      } catch {
        // Ignore cleanup errors
      }
    }
    this.sessionId = null;
    this.client = null;
    this._alive = false;
  }

  /**
   * Kill/close the adapter (alias for close)
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
 * Create an OpenCode SDK adapter if conditions are met
 */
export function createOpencodeAdapterIfAvailable(
  onNotification: NotificationHandler
): OpencodeSdkAdapter | null {
  const serverUrl = getOpencodeServerUrl();
  if (!serverUrl) return null;

  return new OpencodeSdkAdapter(serverUrl, onNotification);
}

