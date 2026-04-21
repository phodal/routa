/**
 * Claude Code Agent SDK Adapter for Serverless Environments (Vercel)
 *
 * Uses the official @anthropic-ai/claude-agent-sdk which spawns the bundled
 * cli.js and communicates via JSONL streams. This gives us the full Claude Code
 * agent loop (tools, multi-turn, etc.) while still being compatible with
 * Node.js serverless runtimes (e.g. Vercel Pro with 60s timeout).
 *
 * Requirements:
 * - ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY environment variable
 * - Node.js runtime (NOT Edge Runtime) — child_process.spawn must be available
 *
 * Configuration via environment variables:
 * - ANTHROPIC_BASE_URL: API endpoint (default: https://api.anthropic.com)
 * - ANTHROPIC_AUTH_TOKEN: API authentication token
 * - ANTHROPIC_MODEL: Model to use (default: claude-sonnet-4-20250514)
 * - API_TIMEOUT_MS: Request timeout in milliseconds (default: 55000)
 */

// ─── MUST be imported BEFORE the SDK ─────────────────────────────────────────
// Patches `fs` to redirect .claude/ writes from read-only home directories
// to /tmp/.claude/ (prevents ENOENT crashes in Vercel Lambda).
import "@/core/platform/serverless-fs-patch";

import type { NotificationHandler, JsonRpcMessage } from "@/core/acp/protocol-types";
import { isServerlessEnvironment } from "@/core/acp/api-based-providers";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { McpServerConfig, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { join } from "path";
import type { LifecycleNotifier } from "@/core/acp/lifecycle-notifier";

interface PendingUserInputRequest {
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
  resolve: (value: { behavior: "allow"; updatedInput: Record<string, unknown> }) => void;
  reject: (reason: Error) => void;
}

/**
 * Resolve the path to the Claude Code cli.js binary.
 *
 * The @anthropic-ai/claude-agent-sdk resolves cli.js relative to
 * import.meta.url inside its own bundled code. On Vercel, Next.js webpack
 * bundles the SDK's JS but does NOT copy cli.js to the bundle output, so the
 * auto-resolved path doesn't exist at runtime.
 *
 * We override it explicitly using process.cwd() which is:
 *   - `/var/task`   on Vercel (where node_modules are unpacked)
 *   - project root  in local dev / tests
 */
function resolveCliPath(): string {
  return join(process.cwd(), "node_modules/@anthropic-ai/claude-agent-sdk/cli.js");
}

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

/**
 * Check if Claude Code SDK is configured
 */
export function isClaudeCodeSdkConfigured(): boolean {
  return !!(process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY);
}

/**
 * Get Claude Code SDK configuration from environment
 */
export function getClaudeCodeSdkConfig(): {
  apiKey: string | undefined;
  baseUrl: string | undefined;
  model: string;
  timeoutMs: number;
} {
  return {
    apiKey: process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL,
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
    // Keep 5s below Vercel Pro 60s limit to allow clean shutdown
    timeoutMs: parseInt(process.env.API_TIMEOUT_MS || "55000", 10),
  };
}

/**
 * Claude Code SDK Adapter — wraps the official agent SDK to provide an
 * ACP-compatible streaming interface.
 *
 * Session Continuity:
 * - Uses `continue: true` option to maintain conversation history within a session
 * - Stores the SDK's internal sessionId for proper multi-turn conversations
 * - Each prompt() call continues the same conversation context
 */
export class ClaudeCodeSdkAdapter {
  private sessionId: string | null = null;
  /** Internal SDK session ID for multi-turn continuity */
  private sdkSessionId: string | null = null;
  private onNotification: NotificationHandler;
  private cwd: string;
  private _alive = false;
  private abortController: AbortController | null = null;
  /** Track if this is the first prompt in the session (no continue needed) */
  private _isFirstPrompt = true;
  /**
   * Tracks whether native stream_event text deltas have been dispatched during
   * the current prompt turn. Used to avoid double-dispatching text for backends
   * (like native Anthropic) that emit both stream_event and assistant messages.
   * GLM and similar providers only emit assistant messages, so when this is false
   * we fall back to dispatching text from the assistant message blocks.
   */
  private _hasSeenStreamTextDelta = false;
  /** Per-instance model override — takes precedence over env-var config. */
  private _modelOverride: string | undefined;
  /** Per-instance maxTurns override. */
  private _maxTurnsOverride: number | undefined;
  /** Per-instance base URL override — takes precedence over ANTHROPIC_BASE_URL. */
  private _baseUrlOverride: string | undefined;
  /** Per-instance API key override — takes precedence over ANTHROPIC_AUTH_TOKEN. */
  private _apiKeyOverride: string | undefined;
  /** Optional allowlist for provider-native tools such as Bash/Read/Edit. */
  private _allowedNativeTools: string[];
  /** Optional MCP servers exposed to Claude Code via the SDK. */
  private _mcpServers?: Record<string, McpServerConfig>;
  /** Optional provider-level system prompt append content. */
  private _systemPromptAppend?: string;
  /** Pending AskUserQuestion requests waiting for a UI response. */
  private pendingUserInputRequests = new Map<string, PendingUserInputRequest>();
  /** Completed AskUserQuestion responses keyed by tool call ID. */
  private completedUserInputResponses = new Map<string, Record<string, unknown>>();

  private lifecycleNotifier?: LifecycleNotifier;

  private splitAssistantText(text: string): string[] {
    if (!text) return [];
    if (text.length <= 120) return [text];

    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += 120) {
      chunks.push(text.slice(i, i + 120));
    }
    return chunks;
  }

  private createFallbackAssistantNotifications(
    msg: Extract<SDKMessage, { type: "assistant" }>,
    sessionId: string,
  ): JsonRpcMessage[] {
    const notifications: JsonRpcMessage[] = [];

    for (const block of msg.message.content) {
      if (block.type === "text" && block.text) {
        for (const chunk of this.splitAssistantText(block.text)) {
          notifications.push(
            createNotification("session/update", {
              sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: chunk },
              },
            }),
          );
        }
        continue;
      }

      if (block.type === "tool_use") {
        if (block.name === "AskUserQuestion" && this.pendingUserInputRequests.has(block.id)) {
          continue;
        }
        const toolBlock = block as unknown as Record<string, unknown>;
        const completedAskUserInput =
          block.name === "AskUserQuestion"
            ? this.completedUserInputResponses.get(block.id)
            : undefined;
        const rawInput = completedAskUserInput ?? toolBlock.input;
        if (completedAskUserInput) {
          this.completedUserInputResponses.delete(block.id);
        }
        const rawInputObj = rawInput ? { rawInput } : {};
        notifications.push(
          createNotification("session/update", {
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: block.id,
              title: block.name,
              status: "completed",
              ...rawInputObj,
            },
          }),
        );
      }
    }

    return notifications;
  }

  constructor(
    cwd: string,
    onNotification: NotificationHandler,
    options?: {
      model?: string;
      maxTurns?: number;
      baseUrl?: string;
      apiKey?: string;
      allowedNativeTools?: string[];
      mcpServers?: Record<string, McpServerConfig>;
      systemPromptAppend?: string;
      lifecycleNotifier?: LifecycleNotifier;
    }
  ) {
    this.cwd = cwd;
    this.onNotification = onNotification;
    this._modelOverride = options?.model;
    this._maxTurnsOverride = options?.maxTurns;
    this._baseUrlOverride = options?.baseUrl;
    this._apiKeyOverride = options?.apiKey;
    this._allowedNativeTools = options?.allowedNativeTools ?? ["Skill", "Read", "Write", "Edit", "Bash", "Glob", "Grep"];
    this._mcpServers = options?.mcpServers;
    this._systemPromptAppend = options?.systemPromptAppend;
    this.lifecycleNotifier = options?.lifecycleNotifier;
  }

  private buildSystemPromptOption(skillContent?: string):
    | {
        systemPrompt: {
          type: "preset";
          preset: "claude_code";
          append: string;
        };
      }
    | undefined {
    const appendParts = [this._systemPromptAppend, skillContent]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

    if (appendParts.length === 0) {
      return undefined;
    }

    return {
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: appendParts.join("\n\n---\n\n"),
      },
    };
  }

  private canUseConfiguredTool(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
    toolUseId: string,
    signal: AbortSignal,
  ) {
    if (toolName === "AskUserQuestion") {
      return this.handleAskUserQuestion(sessionId, input, toolUseId, signal);
    }

    if (toolName.startsWith("mcp__")) {
      return Promise.resolve({ behavior: "allow" as const, updatedInput: input });
    }

    if (this._allowedNativeTools.includes(toolName)) {
      return Promise.resolve({ behavior: "allow" as const, updatedInput: input });
    }

    return Promise.resolve({
      behavior: "deny" as const,
      message: `Tool ${toolName} is not allowed in this session.`,
    });
  }

  get alive(): boolean {
    return this._alive;
  }

  get acpSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Initialize the adapter — validates that credentials are present.
   */
  async connect(): Promise<void> {
    const config = getClaudeCodeSdkConfig();
    const effectiveModel = this._modelOverride ?? config.model;
    const effectiveApiKey = this._apiKeyOverride ?? config.apiKey;
    const effectiveBaseUrl = this._baseUrlOverride ?? config.baseUrl;

    if (!effectiveApiKey) {
      throw new Error(
        "Claude Code SDK requires ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY environment variable"
      );
    }

    // Ensure env vars are visible to the cli.js child process
    process.env.ANTHROPIC_API_KEY = effectiveApiKey;
    if (effectiveBaseUrl) {
      process.env.ANTHROPIC_BASE_URL = effectiveBaseUrl;
    }

    // Ensure CLAUDE_CONFIG_DIR points to /tmp/.claude in the current process
    // so the SDK's trace writer resolves to a writable path — this is the
    // primary fix for the ENOENT crash on Vercel (the serverless-fs-patch
    // import above acts as a safety net). Only override in serverless envs;
    // local (SDK mode via ROUTA_USE_SDK_MODE) should use the default ~/.claude.
    if (!process.env.CLAUDE_CONFIG_DIR && isServerlessEnvironment()) {
      process.env.CLAUDE_CONFIG_DIR = "/tmp/.claude";
    }

    this.sessionId = `claude-sdk-${Date.now()}`;
    this._alive = true;
    console.log(`[ClaudeCodeSdkAdapter] Initialized with model: ${effectiveModel}${this._modelOverride ? ' (per-instance override)' : ''}`);
    if (effectiveBaseUrl) {
      console.log(`[ClaudeCodeSdkAdapter] Using custom API endpoint: ${effectiveBaseUrl}`);
    }
  }

  /**
   * Create a session (API compatibility — SDK doesn't need explicit sessions)
   */
  async createSession(title?: string): Promise<string> {
    if (!this._alive) {
      throw new Error("Adapter not connected");
    }
    console.log(`[ClaudeCodeSdkAdapter] Session created: ${this.sessionId} (${title || "untitled"})`);
    return this.sessionId!;
  }

  /**
   * Send a prompt and return a streaming async generator of SSE events.
   * Each yielded string is a complete SSE event (data: JSON\n\n format).
   * This allows the HTTP response to stream in serverless environments.
   *
   * @param text - The prompt text
   * @param acpSessionId - The ACP session ID to use in notifications (must match client's session)
   * @param skillContent - Optional skill content to inject via systemPrompt.append
   */
  async *promptStream(text: string, acpSessionId?: string, skillContent?: string): AsyncGenerator<string, void, unknown> {
    if (!this._alive || !this.sessionId) {
      throw new Error("No active session");
    }

    const config = getClaudeCodeSdkConfig();
    this.abortController = new AbortController();
    this._hasSeenStreamTextDelta = false;
    // Use the provided ACP session ID for notifications, or fall back to internal ID
    const sessionId = acpSessionId ?? this.sessionId;

    const maskedKey = config.apiKey
      ? `${config.apiKey.substring(0, 8)}...${config.apiKey.substring(config.apiKey.length - 4)}`
      : "undefined";
    const cliPath = resolveCliPath();
    const promptCwd = this.cwd || process.cwd();
    const shouldContinue = !this._isFirstPrompt && this.sdkSessionId !== null;

    console.log(
      `[ClaudeCodeSdkAdapter] promptStream: model=${config.model}, apiKey=${maskedKey}, ` +
      `cwd=${promptCwd}, cli=${cliPath}, continue=${shouldContinue}`
    );

    let stopReason = "end_turn";
    let inputTokens = 0;
    let outputTokens = 0;
    const builtInTools = [...this._allowedNativeTools, "AskUserQuestion"];
    const shouldLoadSettings = this._allowedNativeTools.includes("Skill");
    const disallowedTools = shouldLoadSettings
      ? undefined
      : ["Skill", "Read", "Write", "Edit", "Bash", "Glob", "Grep"];
    const systemPromptOption = this.buildSystemPromptOption(skillContent);

    // Helper to format SSE event
    const formatSseEvent = (notification: JsonRpcMessage): string => {
      return `data: ${JSON.stringify(notification)}\n\n`;
    };

    try {
      const queryOptions: Parameters<typeof query>[0]["options"] = {
        cwd: promptCwd,
        model: this._modelOverride ?? config.model,
        maxTurns: this._maxTurnsOverride ?? 30,
        // Required for token-level incremental streaming events.
        includePartialMessages: true,
        abortController: this.abortController,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        pathToClaudeCodeExecutable: cliPath,
        // Only load user/project settings when Skill is explicitly enabled.
        settingSources: shouldLoadSettings ? ["user", "project"] : [],
        // Restrict built-in/native tools at the SDK level. MCP tools remain available
        // through the attached MCP servers and are handled separately by canUseTool.
        tools: builtInTools,
        allowedTools: builtInTools,
        ...(disallowedTools ? { disallowedTools } : {}),
        canUseTool: async (toolName, input, options) => {
          return this.canUseConfiguredTool(sessionId, toolName, input, options.toolUseID, options.signal);
        },
        // When a skill is explicitly selected via /skill in the UI, inject its
        // content into the system prompt using the preset+append mechanism.
        // This is the official SDK approach for skill integration — see:
        // https://platform.claude.com/docs/en/agent-sdk/skills
        ...(systemPromptOption ?? {}),
        env: {
          ...process.env,
          ...(isServerlessEnvironment() && { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? "/tmp/.claude" }),
        },
        ...(this._mcpServers ? { mcpServers: this._mcpServers } : {}),
        ...(shouldContinue && { continue: true }),
        persistSession: true,
      };

      if (shouldContinue && this.sdkSessionId) {
        (queryOptions as Record<string, unknown>).resume = this.sdkSessionId;
      }

      const stream = query({
        prompt: text,
        options: queryOptions,
      });

      if ("sessionId" in stream) {
        const streamSessionId = (stream as { sessionId?: string }).sessionId;
        if (streamSessionId && streamSessionId !== this.sdkSessionId) {
          this.sdkSessionId = streamSessionId;
        }
      }

      for await (const msg of stream) {
        if (this.abortController?.signal.aborted) {
          stopReason = "cancelled";
          break;
        }

        // Capture SDK session ID from system message
        if (msg.type === "system" && "session_id" in msg) {
          const systemSessionId = (msg as Record<string, unknown>).session_id as string | undefined;
          if (systemSessionId && systemSessionId !== this.sdkSessionId) {
            this.sdkSessionId = systemSessionId;
          }
        }

        // Some SDK/provider combinations do not emit `stream_event` deltas even with
        // includePartialMessages. In that case, split assistant text blocks so the
        // client still receives incremental chunks instead of a single large payload.
        if (msg.type === "assistant" && !this._hasSeenStreamTextDelta) {
          const fallbackNotifications = this.createFallbackAssistantNotifications(msg, sessionId);
          for (const fallbackNotification of fallbackNotifications) {
            this.onNotification(fallbackNotification);
            yield formatSseEvent(fallbackNotification);
          }
          const renameNotification = this.detectAgentRenameFromMessage(msg, sessionId);
          if (renameNotification) {
            this.onNotification(renameNotification);
            yield formatSseEvent(renameNotification);
          }
          continue;
        }

        // Dispatch message and yield SSE event
        const notification = this.createNotificationFromMessage(msg, sessionId);
        if (notification) {
          const params = notification.params as Record<string, unknown> | undefined;
          const update = params?.update as Record<string, unknown> | undefined;
          const content = update?.content as Record<string, unknown> | undefined;
          const text = update?.sessionUpdate === "agent_message_chunk"
            && typeof content?.text === "string"
            ? content.text
            : undefined;

          if (text && text.length > 120) {
            for (const chunk of this.splitAssistantText(text)) {
              const chunkNotification = createNotification("session/update", {
                sessionId,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: chunk },
                },
              });
              this.onNotification(chunkNotification);
              yield formatSseEvent(chunkNotification);
            }
            continue;
          }

          // Also call the original notification handler for non-streaming consumers
          this.onNotification(notification);
          // Yield SSE event for streaming response
          yield formatSseEvent(notification);
        }

        // Detect Bash-based set_agent_name fallback and emit synthetic rename notification.
        // The Claude Code agent falls back to `echo "Agent name: ..."` when set_agent_name
        // tool isn't available in its built-in tool set.
        if (msg.type === "assistant") {
          const renameNotification = this.detectAgentRenameFromMessage(msg, sessionId);
          if (renameNotification) {
            this.onNotification(renameNotification);
            yield formatSseEvent(renameNotification);
          }
        }

        // Accumulate content
        if (msg.type === "assistant") {
          if (msg.message.usage) {
            inputTokens = msg.message.usage.input_tokens ?? inputTokens;
            outputTokens = msg.message.usage.output_tokens ?? outputTokens;
          }
        }

        if (msg.type === "result") {
          stopReason = msg.stop_reason ?? (msg.is_error ? "error" : "end_turn");
          if (msg.subtype === "success" && msg.result) {
            // no-op: promptStream does not return accumulated content
          }
          if (msg.usage) {
            inputTokens = msg.usage.input_tokens ?? inputTokens;
            outputTokens = msg.usage.output_tokens ?? outputTokens;
          }
        }
      }

      this._isFirstPrompt = false;

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

      // Auto-notify lifecycle: agent is idle after completing its turn
      if (this.lifecycleNotifier) {
        await this.lifecycleNotifier.notifyIdle();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!this.abortController?.signal.aborted) {
        console.error("[ClaudeCodeSdkAdapter] promptStream failed:", errorMessage);
        const errorNotification = createNotification("session/update", {
          sessionId,
          type: "error",
          error: { message: errorMessage },
        });
        this.onNotification(errorNotification);
        yield formatSseEvent(errorNotification);
        // Auto-notify lifecycle: agent failed
        if (this.lifecycleNotifier) {
          await this.lifecycleNotifier.notifyFailed(errorMessage);
        }
      }
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Send a prompt through the official Claude Code Agent SDK.
   * Streams ACP notifications for real-time UI updates.
   * @deprecated Use promptStream() for serverless streaming - this blocks until completion
   */
  async prompt(text: string): Promise<{
    stopReason: string;
    content?: string;
    usage?: { inputTokens: number; outputTokens: number };
  }> {
    if (!this._alive || !this.sessionId) {
      throw new Error("No active session");
    }

    const config = getClaudeCodeSdkConfig();
    this.abortController = new AbortController();
    this._hasSeenStreamTextDelta = false;
    const sessionId = this.sessionId;

    const maskedKey = config.apiKey
      ? `${config.apiKey.substring(0, 8)}...${config.apiKey.substring(config.apiKey.length - 4)}`
      : "undefined";
    const cliPath = resolveCliPath();
    const promptCwd = this.cwd || process.cwd();
    const shouldContinue = !this._isFirstPrompt && this.sdkSessionId !== null;

    console.log(
      `[ClaudeCodeSdkAdapter] Sending prompt: model=${config.model}, apiKey=${maskedKey}, ` +
      `cwd=${promptCwd}, cli=${cliPath}, continue=${shouldContinue}, sdkSessionId=${this.sdkSessionId ?? "none"}`
    );

    let stopReason = "end_turn";
    let fullContent = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let msgCount = 0;
    const builtInTools = [...this._allowedNativeTools, "AskUserQuestion"];
    const shouldLoadSettings = this._allowedNativeTools.includes("Skill");
    const disallowedTools = shouldLoadSettings
      ? undefined
      : ["Skill", "Read", "Write", "Edit", "Bash", "Glob", "Grep"];
    const systemPromptOption = this.buildSystemPromptOption();

    try {
      // Build query options with session continuity support
      const queryOptions: Parameters<typeof query>[0]["options"] = {
        cwd: promptCwd,
        model: this._modelOverride ?? config.model,
        maxTurns: this._maxTurnsOverride ?? 30,
        // Keep message semantics aligned with promptStream().
        includePartialMessages: true,
        abortController: this.abortController,
        // Allow the agent to execute tools without interactive permission prompts.
        // Required for autonomous operation in serverless environments.
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        // Explicitly point to cli.js so the SDK doesn't try to resolve it
        // relative to its own import.meta.url (which fails after webpack
        // bundling on Vercel because cli.js is not a statically-imported module
        // and gets stripped from the bundle output unless we force-include it
        // via outputFileTracingIncludes in next.config.ts).
        pathToClaudeCodeExecutable: cliPath,
        // Only load user/project settings when Skill is explicitly enabled.
        settingSources: shouldLoadSettings ? ["user", "project"] : [],
        // Restrict built-in/native tools at the SDK level. MCP tools remain available
        // through the attached MCP servers and are handled separately by canUseTool.
        tools: builtInTools,
        allowedTools: builtInTools,
        ...(disallowedTools ? { disallowedTools } : {}),
        canUseTool: async (toolName, input, options) => {
          return this.canUseConfiguredTool(sessionId, toolName, input, options.toolUseID, options.signal);
        },
        ...(systemPromptOption ?? {}),
        // Set CLAUDE_CONFIG_DIR to /tmp in serverless environments so the child
        // process can write config/cache files (HOME may be read-only on Vercel).
        // In local SDK mode, leave it unset to use the default ~/.claude.
        env: {
          ...process.env,
          ...(isServerlessEnvironment() && { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? "/tmp/.claude" }),
        },
        ...(this._mcpServers ? { mcpServers: this._mcpServers } : {}),
        // Session continuity: use `continue: true` for follow-up prompts
        // to maintain conversation history within the same session.
        // For the first prompt, we let the SDK create a new session.
        ...(shouldContinue && { continue: true }),
        // Persist session to enable conversation history
        persistSession: true,
      };

      // If we have a previous SDK session ID, resume from it
      if (shouldContinue && this.sdkSessionId) {
        // Use resume to load conversation history from the previous session
        (queryOptions as Record<string, unknown>).resume = this.sdkSessionId;
      }

      const stream = query({
        prompt: text,
        options: queryOptions,
      });

      // Capture SDK session ID from the stream for future continuity
      // The stream object has a sessionId property after initialization
      if ("sessionId" in stream) {
        const streamSessionId = (stream as { sessionId?: string }).sessionId;
        if (streamSessionId && streamSessionId !== this.sdkSessionId) {
          console.log(`[ClaudeCodeSdkAdapter] Captured SDK session ID: ${streamSessionId}`);
          this.sdkSessionId = streamSessionId;
        }
      }

      for await (const msg of stream) {
        msgCount++;
        if (this.abortController?.signal.aborted) {
          stopReason = "cancelled";
          break;
        }

        // Try to capture SDK session ID from system message
        if (msg.type === "system" && "session_id" in msg) {
          const systemSessionId = (msg as Record<string, unknown>).session_id as string | undefined;
          if (systemSessionId && systemSessionId !== this.sdkSessionId) {
            console.log(`[ClaudeCodeSdkAdapter] Captured SDK session ID from system message: ${systemSessionId}`);
            this.sdkSessionId = systemSessionId;
          }
        }

        this.dispatchMessage(msg, sessionId);

        // Detect Bash-based set_agent_name fallback (same as promptStream)
        if (msg.type === "assistant") {
          const renameNotification = this.detectAgentRenameFromMessage(msg, sessionId);
          if (renameNotification) {
            this.onNotification(renameNotification);
          }
        }

        // Accumulate final text from completed assistant messages
        if (msg.type === "assistant") {
          for (const block of msg.message.content) {
            if (block.type === "text") {
              fullContent += block.text;
            }
          }
          if (msg.message.usage) {
            inputTokens = msg.message.usage.input_tokens ?? inputTokens;
            outputTokens = msg.message.usage.output_tokens ?? outputTokens;
          }
        }

        if (msg.type === "result") {
          // Log full result for debugging (visible in Vercel function logs)
          const resultLength = ("result" in msg && msg.result) ? msg.result.length : 0;
          const usage = msg.usage as unknown as Record<string, number> | null;
          console.log(
            `[ClaudeCodeSdkAdapter] result: subtype=${msg.subtype} is_error=${msg.is_error}` +
            ` stop_reason=${msg.stop_reason} result_len=${resultLength}` +
            ` in=${usage?.input_tokens ?? 0}` +
            ` out=${usage?.output_tokens ?? 0}`
          );
          stopReason = msg.stop_reason ?? (msg.is_error ? "error" : "end_turn");
          if (msg.subtype === "success" && msg.result) {
            fullContent = msg.result;
          }
          if (msg.usage) {
            inputTokens = msg.usage.input_tokens ?? inputTokens;
            outputTokens = msg.usage.output_tokens ?? outputTokens;
          }
        }
      }

      // Mark that first prompt has been completed - next prompts should use continue
      this._isFirstPrompt = false;

      console.log(`[ClaudeCodeSdkAdapter] stream done: ${msgCount} messages, content_len=${fullContent.length}, in=${inputTokens}, out=${outputTokens}, sdkSessionId=${this.sdkSessionId ?? "none"}`);
    } catch (error) {
      if (this.abortController?.signal.aborted) {
        return { stopReason: "cancelled" };
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[ClaudeCodeSdkAdapter] Prompt failed:", errorMessage);
      this.onNotification(
        createNotification("session/update", {
          sessionId,
          type: "error",
          error: { message: errorMessage },
        })
      );
      throw error;
    } finally {
      this.abortController = null;
    }

    // Emit ACP turn_complete notification
    this.onNotification(
      createNotification("session/update", {
        sessionId,
        update: {
          sessionUpdate: "turn_complete",
          stopReason,
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
          },
        },
      })
    );

    return {
      stopReason,
      content: fullContent,
      usage: { inputTokens, outputTokens },
    };
  }

  /**
   * Convert an SDKMessage to an ACP session/update notification.
   * Returns null if the message doesn't produce a notification.
   *
   * Message type mapping:
   *   stream_event (text_delta)      → agent_message_chunk  (real-time text)
   *   stream_event (thinking_delta)  → agent_thought_chunk  (CoT streaming)
   *   stream_event (tool_use start)  → tool_call            (tool starts)
   *   assistant (tool_use blocks)    → tool_call_update     (tool completes)
   *   result (error)                 → error notification
   */
  private createNotificationFromMessage(msg: SDKMessage, sessionId: string): JsonRpcMessage | null {
    switch (msg.type) {
      case "stream_event": {
        const event = msg.event;

        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            this._hasSeenStreamTextDelta = true;
            return createNotification("session/update", {
              sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: event.delta.text },
              },
            });
          } else if (event.delta.type === "thinking_delta") {
            return createNotification("session/update", {
              sessionId,
              update: {
                sessionUpdate: "agent_thought_chunk",
                content: { type: "text", text: event.delta.thinking },
              },
            });
          } else if (event.delta.type === "input_json_delta") {
            const inputDelta = (event.delta as unknown as Record<string, unknown>).partial_json;
            if (inputDelta) {
              return createNotification("session/update", {
                sessionId,
                update: {
                  sessionUpdate: "tool_call_update",
                  toolCallId: (event as unknown as Record<string, unknown>).index?.toString() ?? "unknown",
                  inputDelta: inputDelta,
                  status: "running",
                },
              });
            }
          }
        } else if (
          event.type === "content_block_start" &&
          event.content_block.type === "tool_use"
        ) {
          const toolBlock = event.content_block as unknown as Record<string, unknown>;
          const rawInputObj = toolBlock.input ? { rawInput: toolBlock.input } : {};
          return createNotification("session/update", {
            sessionId,
            update: {
              sessionUpdate: "tool_call",
              title: event.content_block.name,
              toolCallId: event.content_block.id,
              status: "running",
              ...rawInputObj,
            },
          });
        }
        return null;
      }

      case "assistant": {
        // For backends that don't emit stream_event text deltas (e.g. GLM),
        // emit the full text block as a single chunk.
        if (!this._hasSeenStreamTextDelta) {
          for (const block of msg.message.content) {
            if (block.type === "text" && block.text) {
              return createNotification("session/update", {
                sessionId,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: block.text },
                },
              });
            }
          }
        }
        // Also emit tool_call_update for completed tools
        for (const block of msg.message.content) {
          if (block.type === "tool_use") {
            if (block.name === "AskUserQuestion" && this.pendingUserInputRequests.has(block.id)) {
              continue;
            }
            const toolBlock = block as unknown as Record<string, unknown>;
            const completedAskUserInput =
              block.name === "AskUserQuestion"
                ? this.completedUserInputResponses.get(block.id)
                : undefined;
            const rawInput = completedAskUserInput ?? toolBlock.input;
            if (completedAskUserInput) {
              this.completedUserInputResponses.delete(block.id);
            }
            const rawInputObj = rawInput ? { rawInput } : {};
            return createNotification("session/update", {
              sessionId,
              update: {
                sessionUpdate: "tool_call_update",
                toolCallId: block.id,
                title: block.name,
                status: "completed",
                ...rawInputObj,
              },
            });
          }
        }
        return null;
      }

      case "user": {
        const userMsg = msg as Record<string, unknown>;
        const toolUseResult = userMsg.tool_use_result;
        const parentToolUseId = userMsg.parent_tool_use_id as string | undefined;

        if (toolUseResult && parentToolUseId) {
          return createNotification("session/update", {
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: parentToolUseId,
              status: "completed",
              rawOutput: toolUseResult,
            },
          });
        }
        return null;
      }

      case "result": {
        if (msg.is_error || msg.subtype !== "success") {
          const errorText =
            msg.subtype === "error_max_turns"
              ? "Max turns reached"
              : msg.subtype === "error_max_budget_usd"
              ? "Budget limit exceeded"
              : "Agent execution error";
          return createNotification("session/update", {
            sessionId,
            type: "error",
            error: { message: errorText },
          });
        }
        return null;
      }

      default:
        return null;
    }
  }

  /**
   * Detect Bash-based set_agent_name fallback or direct set_agent_name tool_use
   * in an assistant message. Returns a synthetic notification that
   * extractSetAgentNameTitle (in route.ts) can pick up to trigger a rename.
   *
   * The Claude Code agent falls back to Bash echo when set_agent_name isn't
   * available in its built-in tool set. Patterns detected:
   *   - Bash: echo "Agent name: My Agent"
   *   - Bash: echo "set_agent_name: My Agent"
   *   - Direct: set_agent_name({ name: "..." }) (if the SDK processes it)
   */
  private detectAgentRenameFromMessage(msg: SDKMessage, sessionId: string): JsonRpcMessage | null {
    if (msg.type !== "assistant") return null;

    for (const block of msg.message.content) {
      if (block.type !== "tool_use") continue;
      const toolBlock = block as unknown as Record<string, unknown>;
      const input = (toolBlock.input ?? {}) as Record<string, unknown>;

      // Case 1: Direct set_agent_name tool call (may appear even if the SDK
      // doesn't officially support it — the model can still generate the block)
      if (block.name === "set_agent_name" && typeof input.name === "string") {
        return createNotification("session/update", {
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: block.id,
            title: "set_agent_name",
            status: "completed",
            rawInput: { name: input.name },
          },
        });
      }

      // Case 2: Bash echo fallback
      if (block.name === "Bash" || block.name === "bash") {
        const command = input.command as string ?? "";
        const patterns = [
          /echo\s+["']?Agent\s*name:\s*(.+?)["']?\s*$/i,
          /echo\s+["']?set_agent_name:\s*(.+?)["']?\s*$/i,
          /echo\s+["']?Agent:\s*(.+?)["']?\s*$/i,
        ];
        for (const pattern of patterns) {
          const match = command.match(pattern);
          if (match?.[1]) {
            const name = match[1].replace(/["'\\]/g, "").trim();
            if (name) {
              return createNotification("session/update", {
                sessionId,
                update: {
                  sessionUpdate: "tool_call_update",
                  toolCallId: block.id,
                  title: "set_agent_name",
                  status: "completed",
                  rawInput: { name },
                },
              });
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * Convert an SDKMessage to ACP session/update notifications.
   * @deprecated Use createNotificationFromMessage for streaming - this method dispatches directly
   */
  private dispatchMessage(msg: SDKMessage, sessionId: string): void {
    const notification = this.createNotificationFromMessage(msg, sessionId);
    if (notification) {
      this.onNotification(notification);
    }
  }

  respondToUserInput(toolUseId: string, updatedInput: Record<string, unknown>): boolean {
    const pending = this.pendingUserInputRequests.get(toolUseId);
    if (!pending) {
      return false;
    }

    this.pendingUserInputRequests.delete(toolUseId);
    this.completedUserInputResponses.set(toolUseId, updatedInput);
    this.onNotification(
      createNotification("session/update", {
        sessionId: pending.sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: toolUseId,
          title: pending.toolName,
          kind: "ask-user-question",
          status: "completed",
          rawInput: updatedInput,
        },
      })
    );
    pending.resolve({ behavior: "allow", updatedInput });
    return true;
  }

  private async handleAskUserQuestion(
    sessionId: string,
    input: Record<string, unknown>,
    toolUseId: string | undefined,
    signal: AbortSignal,
  ): Promise<{ behavior: "allow"; updatedInput: Record<string, unknown> }> {
    const effectiveToolUseId = toolUseId ?? `ask-user-${Date.now()}`;
    this.onNotification(
      createNotification("session/update", {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          title: "AskUserQuestion",
          kind: "ask-user-question",
          status: "awaiting_input",
          toolCallId: effectiveToolUseId,
          rawInput: input,
        },
      })
    );

    return await new Promise<{ behavior: "allow"; updatedInput: Record<string, unknown> }>((resolve, reject) => {
      const abortHandler = () => {
        this.pendingUserInputRequests.delete(effectiveToolUseId);
        this.onNotification(
          createNotification("session/update", {
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: effectiveToolUseId,
              title: "AskUserQuestion",
              kind: "ask-user-question",
              status: "failed",
              rawInput: input,
            },
          })
        );
        reject(new Error("AskUserQuestion request was aborted"));
      };

      signal.addEventListener("abort", abortHandler, { once: true });
      this.pendingUserInputRequests.set(effectiveToolUseId, {
        sessionId,
        toolName: "AskUserQuestion",
        input,
        resolve: (value) => {
          signal.removeEventListener("abort", abortHandler);
          resolve(value);
        },
        reject: (reason) => {
          signal.removeEventListener("abort", abortHandler);
          reject(reason);
        },
      });
    });
  }

  private rejectPendingUserInputs(message: string): void {
    for (const [toolUseId, pending] of this.pendingUserInputRequests.entries()) {
      this.onNotification(
        createNotification("session/update", {
          sessionId: pending.sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: toolUseId,
            title: pending.toolName,
            kind: "ask-user-question",
            status: "failed",
            rawInput: pending.input,
          },
        })
      );
      pending.reject(new Error(message));
    }
    this.pendingUserInputRequests.clear();
  }

  /**
   * Cancel the in-progress prompt.
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.rejectPendingUserInputs("Prompt cancelled");
  }

  /**
   * Close the adapter and release all resources.
   */
  async close(): Promise<void> {
    this.cancel();
    this.sessionId = null;
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
 * Check if we should use the Claude Code SDK adapter
 */
export function shouldUseClaudeCodeSdkAdapter(): boolean {
  if (!isClaudeCodeSdkConfigured()) return false;
  // Enable SDK mode in serverless environments, or when explicitly opted-in
  // (e.g. for third-party API providers like Zhipu GLM Coding Plan that
  // require SDK mode to bypass TTY-based usage detection).
  return isServerlessEnvironment() || process.env.ROUTA_USE_SDK_MODE === "1";
}

/**
 * Create a Claude Code SDK adapter if conditions are met
 */
export function createClaudeCodeSdkAdapterIfAvailable(
  cwd: string,
  onNotification: NotificationHandler
): ClaudeCodeSdkAdapter | null {
  if (!isClaudeCodeSdkConfigured()) return null;
  return new ClaudeCodeSdkAdapter(cwd, onNotification);
}
