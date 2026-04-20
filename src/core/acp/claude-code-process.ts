import { NotificationHandler, JsonRpcMessage } from "@/core/acp/processer";
import { AcpAgentPreset, resolveCommand } from "@/core/acp/acp-presets";
import { awaitProcessReady, needsShell } from "@/core/acp/utils";
import type { IProcessHandle } from "@/core/platform/interfaces";
import { getServerBridge } from "@/core/platform";

/**
 * Claude Code stream-json protocol types.
 *
 * Claude Code uses a different wire format from ACP:
 *   - stdin/stdout: JSON lines (NDJSON) with Claude-specific message types
 *   - Message types: system, assistant, user, result, stream_event
 *
 * This process translates Claude's output into ACP-compatible `session/update`
 * notifications so the existing frontend renderer works without changes.
 *
 * Streaming optimization (ported from JetBrains ml-llm):
 *   - Uses isCompleteJson() to detect complete JSON objects
 *   - Processes messages immediately when complete, without waiting for newlines
 *   - Handles JSON that may span multiple chunks
 */

// ─── JSON Parsing Utilities ───────────────────────────────────────────────

/**
 * Check if a JSON string is complete (ends with closing brace).
 * Ported from JetBrains ClaudeCodeProcessHandler.
 */
function isCompleteJson(json: string): boolean {
    return json.trimEnd().endsWith("}");
}

/**
 * Remove ANSI escape codes from text.
 * Ported from JetBrains ClaudeCodeProcessHandler.
 */
function clearAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, "");
}

// ─── Claude Protocol Types ──────────────────────────────────────────────

interface ClaudeStreamDelta {
    type: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    signature?: string;
    // Extended thinking fields
    citation?: unknown;
}

// Stop reasons from Claude API
type ClaudeStopReason = "end_turn" | "stop_sequence" | "max_tokens" | "tool_use" | string;

interface ClaudeStreamContentBlock {
    type: string;
    text?: string;
    thinking?: string;
    id?: string;
    name?: string;
    input?: unknown;
    // Extended thinking fields
    signature?: string;
}

interface ClaudeStreamEvent {
    type: string; // content_block_start, content_block_delta, content_block_stop
    index?: number;
    content_block?: ClaudeStreamContentBlock;
    delta?: ClaudeStreamDelta;
}

interface ClaudeContent {
    type: string;
    text?: string;
    thinking?: string;
    id?: string;
    name?: string;
    input?: unknown;
    tool_use_id?: string;
    content?: unknown;
    is_error?: boolean;
}

type ClaudeMessageType = "system" | "assistant" | "user" | "result" | "stream_event";

interface ClaudeOutputMessage {
    type: ClaudeMessageType;
    subtype?: string;
    session_id?: string;
    message?: {
        role: string;
        content: ClaudeContent[];
        // Extended thinking fields
        stop_reason?: ClaudeStopReason;
        stop_sequence?: string;
    };
    event?: ClaudeStreamEvent;
    result?: string;
    is_error?: boolean;
    // Extended thinking fields for result messages
    stop_reason?: ClaudeStopReason;
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
    };
}

// ─── Claude Code Process Config ─────────────────────────────────────────

export interface ClaudeCodeProcessConfig {
    preset: AcpAgentPreset;
    /** Resolved binary path for `claude` */
    command: string;
    /** Working directory */
    cwd: string;
    /** Additional environment variables */
    env?: Record<string, string>;
    /** Display name for logging */
    displayName: string;
    /** Permission mode: "acceptEdits" | "bypassPermissions" */
    permissionMode?: string;
    /** Tools to auto-approve */
    allowedTools?: string[];
    /** MCP config JSON strings (passed via --mcp-config) */
    mcpConfigs?: string[];
}

/**
 * Manages a Claude Code process and translates its stream-json output
 * into ACP-compatible `session/update` notifications.
 *
 * Ported from Kotlin `ClaudeCodeClient` with adaptations for Node.js.
 */
export class ClaudeCodeProcess {
    private process: IProcessHandle | null = null;
    private buffer = "";
    private _sessionId: string | null = null;
    private _alive = false;
    private _config: ClaudeCodeProcessConfig;
    private onNotification: NotificationHandler;

    // Track tool names for mapping tool_use → tool_result
    private toolUseNames = new Map<string, string>();
    private toolUseInputs = new Map<string, Record<string, unknown>>();
    private renderedToolIds = new Set<string>();

    // Input JSON Streaming: accumulate partial JSON for each tool
    private toolPartialJson = new Map<string, string>();
    // Track current streaming tool ID (from content_block_start index)
    private currentToolId: string | null = null;
    private streamingBlockIndex: number | null = null;

    // Streaming state
    private inThinking = false;
    private inText = false;
    private inToolUse = false;
    private hasRenderedStreamContent = false;

    // Extended Thinking state
    private currentReasoningId: string | null = null;
    private currentReasoningText = "";
    private currentSignature: string | null = null;

    // Resolve/reject for the current prompt
    private promptResolve: ((value: { stopReason: string }) => void) | null = null;
    private promptReject: ((reason: Error) => void) | null = null;
    private promptTimeout: ReturnType<typeof setTimeout> | null = null;

    constructor(config: ClaudeCodeProcessConfig, onNotification: NotificationHandler) {
        this._config = config;
        this.onNotification = onNotification;
    }

    get sessionId(): string | null {
        return this._sessionId;
    }

    get alive(): boolean {
        return this._alive && this.process !== null && this.process.exitCode === null;
    }

    get config(): ClaudeCodeProcessConfig {
        return this._config;
    }

    get presetId(): string {
        return this._config.preset.id;
    }

    setPermissionMode(mode: string): void {
        this._config.permissionMode = mode;
    }

    /**
     * Spawn the Claude Code process with stream-json mode.
     */
    async start(): Promise<void> {
        const { command, cwd, env, displayName, permissionMode, allowedTools, mcpConfigs } = this._config;

        const cmd = [command, "-p"];
        cmd.push("--output-format", "stream-json");
        cmd.push("--input-format", "stream-json");
        cmd.push("--include-partial-messages"); // Enable streaming of partial message chunks
        cmd.push("--verbose");

        // Default to bypassPermissions so ALL tools (including MCP tools) are auto-approved.
        // With acceptEdits, only file-edit tools are auto-approved;
        // MCP tools trigger a permission request that our ACP server doesn't handle,
        // causing silent failures like "you haven't granted permission".
        //
        // IMPORTANT: --permission-mode bypassPermissions requires
        // --allow-dangerously-skip-permissions to actually work. Without it,
        // Claude CLI silently falls back to "default" mode and sends
        // permission requests we can't handle.
        const effectivePermissionMode = permissionMode ?? "bypassPermissions";
        if (effectivePermissionMode === "bypassPermissions") {
            cmd.push("--dangerously-skip-permissions");
        } else {
            cmd.push("--permission-mode", effectivePermissionMode);
        }

        // Disallow interactive questions (we auto-approve via permission mode)
        cmd.push("--disallowed-tools", "AskUserQuestion");

        // Add allowed tools for auto-approval
        if (allowedTools && allowedTools.length > 0) {
            cmd.push("--allowedTools", allowedTools.join(","));
        }

        // Add MCP server configs
        if (mcpConfigs) {
            for (const mcpConfig of mcpConfigs) {
                if (mcpConfig) {
                    cmd.push("--mcp-config", mcpConfig);
                }
            }
        }

        console.log(`[ClaudeCode:${displayName}] Spawning: ${cmd.join(" ")} (cwd: ${cwd})`);

        const bridge = getServerBridge();
        if (!bridge.process.isAvailable()) {
            throw new Error(
                `Process spawning is not available on this platform. ` +
                `Cannot start Claude Code.`
            );
        }

        this.process = bridge.process.spawn(cmd[0], cmd.slice(1), {
            stdio: ["pipe", "pipe", "pipe"],
            cwd,
            env: {
                ...process.env, // inherit parent PATH and other env vars
                ...env,         // allow extra/override vars
                PWD: cwd,
            },
            detached: false,
            // On Windows, batch files (.cmd/.bat) cannot be spawned directly —
            // they must be run through the shell (cmd.exe /c ...).
            shell: needsShell(cmd[0]),
        });

        // Wire up stdout/stderr/exit listeners BEFORE awaiting ready.
        // Tauri's shell plugin forwards events immediately after cmd.spawn(),
        // so binding after the await would miss early output frames (init messages).
        this.process.stdout?.on("data", (chunk: Buffer) => {
            this.buffer += chunk.toString("utf-8");
            this.processBuffer();
        });

        this.process.stderr?.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf-8").trim();
            if (text) {
                console.error(`[ClaudeCode:${displayName} stderr] ${text}`);
            }
        });

        this.process.on("exit", (code, signal) => {
            console.log(`[ClaudeCode:${displayName}] Process exited: code=${code}, signal=${signal}`);
            this._alive = false;
            if (this.promptTimeout) { clearTimeout(this.promptTimeout); this.promptTimeout = null; }
            if (this.promptReject) {
                this.promptReject(new Error(`Claude Code process exited (code=${code})`));
                this.promptResolve = null;
                this.promptReject = null;
            }
        });

        this.process.on("error", (err) => {
            console.error(`[ClaudeCode:${displayName}] Process error:`, err);
            this._alive = false;
        });

        await awaitProcessReady(this.process);

        if (!this.process || !this.process.pid) {
            const pathSep = process.platform === "win32" ? ";" : ":";
            const pathHint = process.env.PATH?.split(pathSep).slice(0, 5).join(pathSep) ?? "(empty)";
            throw new Error(
                `Failed to spawn Claude Code - is "${command}" installed and in PATH? ` +
                `(cwd: ${cwd}, PATH starts with: ${pathHint})`
            );
        }

        if (!this.process.stdin || !this.process.stdout) {
            throw new Error(`Claude Code spawned without required stdio streams`);
        }

        this._alive = true;

        // Wait for process to stabilize
        await new Promise((resolve) => setTimeout(resolve, 500));

        if (!this.alive) {
            throw new Error(`Claude Code process died during startup`);
        }

        console.log(`[ClaudeCode:${displayName}] Process started, pid=${this.process.pid}`);
    }

    /**
     * Send a prompt to Claude Code.
     * The response streams via notifications (translated to session/update).
     */
    async prompt(sessionId: string, text: string): Promise<{ stopReason: string }> {
        if (!this.alive) {
            throw new Error("Claude Code process is not alive");
        }

        // Reset streaming state for this prompt
        this.inThinking = false;
        this.inText = false;
        this.inToolUse = false;
        this.hasRenderedStreamContent = false;
        this.toolPartialJson.clear();
        this.currentToolId = null;
        this.streamingBlockIndex = null;

        // Reset extended thinking state
        this.currentReasoningId = null;
        this.currentReasoningText = "";
        this.currentSignature = null;

        // Build Claude user input
        const userInput = JSON.stringify({
            type: "user",
            message: {
                role: "user",
                content: [{ type: "text", text }],
            },
            session_id: this._sessionId ?? undefined,
        });

        const PROMPT_TIMEOUT_MS = 300_000; // 5 min — matches ACP process

        return new Promise<{ stopReason: string }>((resolve, reject) => {
            if (this.promptResolve || this.promptReject) {
                reject(new Error("Claude Code already has a prompt in flight"));
                return;
            }

            // Clear any previous timeout
            if (this.promptTimeout) {
                clearTimeout(this.promptTimeout);
                this.promptTimeout = null;
            }

            this.promptResolve = resolve;
            this.promptReject = reject;

            // Timeout guard: prevents the POST handler from blocking forever
            // when Claude Code runs a long task or the process hangs.
            this.promptTimeout = setTimeout(() => {
                this.promptResolve = null;
                this.promptReject = null;
                this.promptTimeout = null;
                reject(new Error(`Timeout waiting for session/prompt (${PROMPT_TIMEOUT_MS / 1000}s)`));
            }, PROMPT_TIMEOUT_MS);

            // Write to stdin
            if (!this.process?.stdin?.writable) {
                if (this.promptTimeout) clearTimeout(this.promptTimeout);
                this.promptTimeout = null;
                this.promptResolve = null;
                this.promptReject = null;
                reject(new Error("Claude Code stdin not writable"));
                return;
            }

            this.process.stdin.write(userInput + "\n");
        });
    }

    /**
     * Cancel the current prompt by sending a signal to Claude Code.
     */
    async cancel(): Promise<void> {
        // Claude Code doesn't have a cancel protocol; we can send SIGINT
        if (this.process && this.process.exitCode === null) {
            this.process.kill("SIGINT");
        }
    }

    /**
     * Kill the Claude Code process.
     */
    kill(): void {
        if (this.process && this.process.exitCode === null) {
            console.log(`[ClaudeCode:${this._config.displayName}] Killing process pid=${this.process.pid}`);
            this.process.kill("SIGTERM");

            setTimeout(() => {
                if (this.process && this.process.exitCode === null) {
                    this.process.kill("SIGKILL");
                }
            }, 5000);
        }
        this._alive = false;
    }

    // ─── Private: Buffer and Parse ──────────────────────────────────────

    /**
     * Process the buffer to extract complete JSON messages.
     *
     * This implementation is optimized for streaming (ported from JetBrains ml-llm):
     * 1. Clears ANSI escape codes from incoming text
     * 2. Uses isCompleteJson() to detect complete JSON objects
     * 3. Processes messages immediately when complete, without waiting for newlines
     * 4. Handles JSON that may span multiple chunks
     */
    private processBuffer(): void {
        // First, try the newline-based approach for NDJSON (most common case)
        const lines = this.buffer.split("\n");

        // Process all complete lines (all but the last one)
        for (let i = 0; i < lines.length - 1; i++) {
            const line = clearAnsi(lines[i].trim());
            if (!line) continue;

            // Skip debug/error lines that aren't JSON
            if (line.startsWith("[DEBUG]") || line.startsWith("[ERROR]")) {
                continue;
            }

            // Only process lines that look like JSON objects
            if (!line.startsWith("{")) continue;

            try {
                const msg = JSON.parse(line) as ClaudeOutputMessage;
                this.handleClaudeMessage(msg);
            } catch {
                // Ignore parse errors for incomplete JSON
            }
        }

        // Keep the last (potentially incomplete) line in the buffer
        this.buffer = lines[lines.length - 1];

        // JetBrains-style: Also check if the remaining buffer contains complete JSON
        // This handles cases where JSON doesn't end with a newline
        if (this.buffer.startsWith("{") && isCompleteJson(this.buffer)) {
            const cleanedBuffer = clearAnsi(this.buffer.trim());
            try {
                const msg = JSON.parse(cleanedBuffer) as ClaudeOutputMessage;
                this.handleClaudeMessage(msg);
                this.buffer = ""; // Clear buffer after successful parse
            } catch {
                // JSON looks complete but isn't valid - keep buffering
            }
        }
    }

    /**
     * Handle a parsed Claude output message and translate to ACP session/update.
     */
    private handleClaudeMessage(msg: ClaudeOutputMessage): void {
        const sid = this._sessionId ?? "claude-session";

        switch (msg.type) {
            case "system": {
                if (msg.subtype === "init" && msg.session_id) {
                    this._sessionId = msg.session_id;
                }
                break;
            }

            case "stream_event": {
                const event = msg.event;
                if (!event) return;
                this.processStreamEvent(event, sid);
                break;
            }

            case "assistant": {
                // Full assistant message with tool_use blocks
                const content = msg.message?.content ?? [];
                for (const c of content) {
                    if (c.type === "tool_use") {
                        const toolId = c.id ?? "";
                        const toolName = c.name ?? "unknown";
                        this.toolUseNames.set(toolId, toolName);

                        const inputMap = (typeof c.input === "object" && c.input !== null)
                            ? c.input as Record<string, unknown>
                            : {};
                        this.toolUseInputs.set(toolId, inputMap);

                        if (!this.renderedToolIds.has(toolId)) {
                            const mappedName = mapClaudeToolName(toolName);
                            this.emitSessionUpdate(sid, {
                                sessionUpdate: "tool_call",
                                toolCallId: toolId,
                                title: formatToolTitle(toolName, inputMap),
                                status: "running",
                                kind: mappedName,
                                rawInput: inputMap,
                            });
                            this.renderedToolIds.add(toolId);
                        }
                    }
                }
                break;
            }

            case "user": {
                // User message with tool_result blocks
                const content = msg.message?.content ?? [];
                for (const c of content) {
                    if (c.type === "tool_result") {
                        const toolId = c.tool_use_id ?? "";
                        const toolName = this.toolUseNames.get(toolId) ?? "unknown";
                        const isErr = c.is_error === true;
                        const output = extractToolResultText(c);
                        const mappedKind = mapClaudeToolName(toolName);
                        const rawInput = this.toolUseInputs.get(toolId) ?? {};

                        // For delegate_task_to_agent, use "delegated" status instead of "completed"
                        // The task is still running asynchronously, and will be updated via task_completion
                        let status: string = isErr ? "failed" : "completed";
                        let delegatedTaskId: string | undefined;

                        if (mappedKind === "task" && !isErr) {
                            // Check if this is a delegation tool (has taskId in input)
                            const taskId = rawInput.taskId as string | undefined;
                            if (taskId) {
                                status = "delegated";
                                delegatedTaskId = taskId;
                            }
                        }

                        this.emitSessionUpdate(sid, {
                            sessionUpdate: "tool_call_update",
                            toolCallId: toolId,
                            title: toolName,
                            status,
                            kind: mappedKind,
                            rawOutput: output,
                            // Include taskId for matching with task_completion notifications
                            ...(delegatedTaskId && { delegatedTaskId }),
                        });
                    }
                }
                break;
            }

            case "result": {
                const resultText = msg.result ?? "";
                // Determine stop reason: from msg.stop_reason, msg.subtype, or default
                const stopReason: ClaudeStopReason = msg.stop_reason ?? msg.subtype ?? "end_turn";

                if (resultText && !this.hasRenderedStreamContent) {
                    // Result came without streaming - emit as a message
                    this.emitSessionUpdate(sid, {
                        sessionUpdate: "agent_message_chunk",
                        content: { type: "text", text: resultText },
                    });
                }

                // Emit stop_reason event for UI handling
                this.emitSessionUpdate(sid, {
                    sessionUpdate: "turn_complete",
                    stopReason,
                    usage: msg.usage,
                    // Include extended thinking state if present
                    ...(this.currentReasoningText && {
                        reasoningText: this.currentReasoningText,
                        reasoningSignature: this.currentSignature,
                    }),
                });

                // Handle specific stop reasons
                switch (stopReason) {
                    case "max_tokens":
                        console.warn(`[ClaudeCode] Response truncated: max_tokens reached`);
                        break;
                    case "tool_use":
                        // Tool use is pending - normal flow, handled by tool_call events
                        break;
                    case "stop_sequence":
                        // Explicit stop sequence hit
                        break;
                    case "end_turn":
                    default:
                        // Normal end of turn
                        break;
                }

                // Resolve the prompt promise
                if (this.promptResolve) {
                    if (this.promptTimeout) { clearTimeout(this.promptTimeout); this.promptTimeout = null; }
                    this.promptResolve({ stopReason });
                    this.promptResolve = null;
                    this.promptReject = null;
                }
                break;
            }

            default:
                // Unknown message type - ignore silently
                break;
        }
    }

    /**
     * Process Claude stream events and translate to ACP session/update.
     */
    private processStreamEvent(event: ClaudeStreamEvent, sid: string): void {
        switch (event.type) {
            case "content_block_start": {
                const block = event.content_block;
                if (!block) return;

                // Track the streaming block index for input_json_delta correlation
                this.streamingBlockIndex = event.index ?? null;

                if (block.type === "thinking") {
                    this.inThinking = true;
                    // Extended Thinking: emit thinking_start event
                    this.emitSessionUpdate(sid, {
                        sessionUpdate: "thinking_start",
                        blockIndex: event.index,
                    });
                } else if (block.type === "text") {
                    this.inText = true;
                } else if (block.type === "tool_use") {
                    const toolId = block.id ?? "";
                    const toolName = block.name ?? "unknown";
                    this.toolUseNames.set(toolId, toolName);
                    this.inToolUse = true;
                    this.currentToolId = toolId;
                    // Initialize partial JSON accumulator for this tool
                    this.toolPartialJson.set(toolId, "");

                    // Emit tool_call_start event for streaming UI
                    const mappedName = mapClaudeToolName(toolName);
                    this.emitSessionUpdate(sid, {
                        sessionUpdate: "tool_call_start",
                        toolCallId: toolId,
                        toolName: toolName,
                        kind: mappedName,
                        status: "streaming",
                    });
                }
                break;
            }

            case "content_block_delta": {
                const delta = event.delta;
                if (!delta) return;

                if (delta.type === "thinking_delta" && delta.thinking) {
                    this.hasRenderedStreamContent = true;
                    // Accumulate reasoning text for Extended Thinking
                    this.currentReasoningText += delta.thinking;
                    this.emitSessionUpdate(sid, {
                        sessionUpdate: "agent_thought_chunk",
                        content: { type: "text", text: delta.thinking },
                    });
                } else if (delta.type === "signature_delta" && delta.signature) {
                    // Extended Thinking: signature for verification
                    this.currentSignature = delta.signature;
                    this.emitSessionUpdate(sid, {
                        sessionUpdate: "thinking_signature",
                        signature: delta.signature,
                    });
                } else if (delta.type === "text_delta" && delta.text) {
                    this.hasRenderedStreamContent = true;
                    // Close any open thought block context
                    this.inThinking = false;
                    this.emitSessionUpdate(sid, {
                        sessionUpdate: "agent_message_chunk",
                        content: { type: "text", text: delta.text },
                    });
                } else if (delta.type === "input_json_delta" && delta.partial_json) {
                    this.hasRenderedStreamContent = true;
                    // Input JSON Streaming: accumulate and emit partial tool params
                    if (this.currentToolId) {
                        const existing = this.toolPartialJson.get(this.currentToolId) ?? "";
                        const updated = existing + delta.partial_json;
                        this.toolPartialJson.set(this.currentToolId, updated);

                        // Try to parse partial JSON for UI preview
                        const parsedInput = tryParsePartialJson(updated);
                        const toolName = this.toolUseNames.get(this.currentToolId) ?? "unknown";

                        this.emitSessionUpdate(sid, {
                            sessionUpdate: "tool_call_params_delta",
                            toolCallId: this.currentToolId,
                            partialJson: delta.partial_json,
                            accumulatedJson: updated,
                            parsedInput,
                            title: formatToolTitle(toolName, parsedInput ?? {}),
                        });
                    }
                }
                break;
            }

            case "content_block_stop": {
                if (this.inThinking) {
                    this.inThinking = false;
                    // Extended Thinking: emit thinking_stop with accumulated reasoning
                    this.emitSessionUpdate(sid, {
                        sessionUpdate: "thinking_stop",
                        reasoningText: this.currentReasoningText,
                        signature: this.currentSignature,
                    });
                }
                if (this.inText) {
                    this.inText = false;
                }
                if (this.inToolUse && this.currentToolId) {
                    this.inToolUse = false;
                    // Finalize the tool input from accumulated JSON
                    const finalJson = this.toolPartialJson.get(this.currentToolId) ?? "";
                    const parsedInput = tryParsePartialJson(finalJson);
                    if (parsedInput) {
                        this.toolUseInputs.set(this.currentToolId, parsedInput);
                    }
                    this.currentToolId = null;
                }
                this.streamingBlockIndex = null;
                break;
            }

            case "message_start": {
                // Extended Thinking: message_start may contain reasoning_opaque
                // This is handled at the message level, not stream event
                break;
            }

            case "message_delta": {
                // Extended Thinking: message_delta contains stop_reason
                // This is handled via the result message type
                break;
            }

            case "message_stop": {
                // Message complete - cleanup handled elsewhere
                break;
            }
        }
    }

    /**
     * Emit an ACP-compatible session/update notification.
     */
    private emitSessionUpdate(sessionId: string, update: Record<string, unknown>): void {
        const notification: JsonRpcMessage = {
            jsonrpc: "2.0",
            method: "session/update",
            params: {
                sessionId,
                update,
            },
        };
        this.onNotification(notification);
    }
}

// ─── Helper Functions ──────────────────────────────────────────────────

/**
 * Try to parse partial JSON for streaming tool parameters.
 * Returns the parsed object if valid, null otherwise.
 * Ported from Copilot SDK's pVe() function.
 */
function tryParsePartialJson(partialJson: string): Record<string, unknown> | null {
    if (!partialJson || partialJson.trim() === "") {
        return null;
    }

    // First try direct parse
    try {
        const parsed = JSON.parse(partialJson);
        if (typeof parsed === "object" && parsed !== null) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // Try to repair incomplete JSON by closing open braces/brackets
    }

    // Attempt to repair incomplete JSON
    let repaired = partialJson.trim();

    // Count open/close braces and brackets
    let braceCount = 0;
    let bracketCount = 0;
    let inString = false;
    let escape = false;

    for (const char of repaired) {
        if (escape) {
            escape = false;
            continue;
        }
        if (char === "\\") {
            escape = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;

        if (char === "{") braceCount++;
        else if (char === "}") braceCount--;
        else if (char === "[") bracketCount++;
        else if (char === "]") bracketCount--;
    }

    // If in string, close it
    if (inString) {
        repaired += '"';
    }

    // Close open brackets and braces
    while (bracketCount > 0) {
        repaired += "]";
        bracketCount--;
    }
    while (braceCount > 0) {
        repaired += "}";
        braceCount--;
    }

    try {
        const parsed = JSON.parse(repaired);
        if (typeof parsed === "object" && parsed !== null) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // Still invalid - return null
    }

    return null;
}

/**
 * Map Claude tool names to normalized kind identifiers for UI styling.
 * Returns a simplified category name used for styling and routing in the UI.
 */
function mapClaudeToolName(claudeToolName: string): string {
    // Handle MCP tool names: mcp__server-name__tool_name -> tool_name
    if (claudeToolName.startsWith("mcp__")) {
        const parts = claudeToolName.split("__");
        if (parts.length >= 3) {
            const toolName = parts.slice(2).join("__");
            // Map delegate_task_to_agent to "task" for TaskProgressBar
            if (toolName === "delegate_task_to_agent") {
                return "task";
            }
            return toolName;
        }
    }

    switch (claudeToolName) {
        // Shell/Command execution
        case "Bash": return "shell";

        // File read operations
        case "Read": return "read-file";
        case "LS": return "read-file";

        // File write/edit operations (could be handled differently)
        case "Write": return "write-file";
        case "Edit": return "edit-file";
        case "MultiEdit": return "edit-file";

        // Search operations
        case "Glob": return "glob";
        case "Grep": return "grep";

        // Web operations
        case "WebSearch": return "web-search";
        case "WebFetch": return "web-fetch";

        // Task/Agent operations
        case "Task": return "task";

        // Todo operations
        case "TodoRead": return "todo-read";
        case "TodoWrite": return "todo-write";

        // Notebook operations
        case "NotebookRead": return "notebook-read";
        case "NotebookEdit": return "notebook-edit";

        // Plan mode
        case "ExitPlanMode": return "plan";
        case "EnterPlanMode": return "plan";

        default: return claudeToolName;
    }
}

/**
 * Format tool title for display based on tool type and parameters.
 * Follows the U2e dispatcher pattern from VS Code extension analysis:
 * - Read/LS: "Read {path}" with file path
 * - Glob: "Searched for files matching `{pattern}`"
 * - Grep: "Searched for regex `{pattern}`"
 * - Edit/Write/MultiEdit: "Editing {path}" or "Writing {path}"
 * - Bash: Shows command (handled via toolSpecificData in VS Code)
 * - Task: "Task: {description}" or "Completed Task: {description}"
 * - Default: "Used tool: {name}"
 */
function formatToolTitle(toolName: string, params: Record<string, unknown>): string {
    // Handle MCP tool names: mcp__server-name__tool_name -> tool_name
    let displayName = toolName;
    if (toolName.startsWith("mcp__")) {
        const parts = toolName.split("__");
        if (parts.length >= 3) {
            displayName = parts.slice(2).join("__");
        }
    }

    switch (displayName) {
        // ── Read/LS: Show "Read {path}" with clickable file path hint ──
        case "Read": {
            const path = (params.file_path ?? params.path ?? "") as string;
            return path ? `Read ${path}` : "Read";
        }
        case "LS": {
            const path = (params.path ?? "") as string;
            return path ? `Read ${path}` : "List directory";
        }

        // ── Glob: Show search pattern ──
        case "Glob": {
            const pattern = (params.pattern ?? params.glob_pattern ?? "") as string;
            return pattern ? `Searched for files matching \`${pattern}\`` : "Glob search";
        }

        // ── Grep: Show regex pattern ──
        case "Grep": {
            const pattern = (params.pattern ?? params.regex ?? "") as string;
            return pattern ? `Searched for regex \`${pattern}\`` : "Grep search";
        }

        // ── Edit/Write/MultiEdit: Show path being edited ──
        case "Edit":
        case "MultiEdit": {
            const path = (params.file_path ?? params.path ?? "") as string;
            return path ? `Editing ${path}` : "Editing file";
        }
        case "Write": {
            const path = (params.file_path ?? params.path ?? "") as string;
            return path ? `Writing ${path}` : "Writing file";
        }

        // ── Bash: Show command (truncated) ──
        case "Bash": {
            const cmd = ((params.command as string) ?? "").slice(0, 80);
            return cmd || "Bash";
        }

        // ── Task: Show description with optional subagent type ──
        case "Task": {
            const desc = (params.description as string) ?? "";
            const subType = (params.subagent_type as string) ?? "";
            if (desc) {
                return subType ? `Task [${subType}]: ${desc}` : `Task: ${desc}`;
            }
            return "Task";
        }

        // ── MCP delegate_task_to_agent ──
        case "delegate_task_to_agent": {
            const desc = (params.description as string) ?? (params.task_description as string) ?? "";
            return desc ? `Task: ${desc}` : "Delegating task";
        }

        // ── ExitPlanMode: Show plan text ──
        case "ExitPlanMode": {
            const plan = (params.plan as string) ?? "";
            return plan ? `Plan:\n${plan}` : "Plan mode completed";
        }

        // ── Todo tools ──
        case "TodoWrite":
        case "TodoRead": {
            const todoPath = (params.file_path ?? params.path ?? "") as string;
            return todoPath ? `${displayName}: ${todoPath}` : displayName;
        }

        // ── WebFetch: Show URL ──
        case "WebFetch": {
            const url = (params.url as string) ?? "";
            return url ? `Fetching ${url}` : "Fetching webpage";
        }

        // ── WebSearch: Show query ──
        case "WebSearch": {
            const query = (params.query as string) ?? "";
            return query ? `Searching: ${query}` : "Web search";
        }

        // ── NotebookEdit: Show notebook path ──
        case "NotebookEdit": {
            const path = (params.file_path ?? params.path ?? "") as string;
            return path ? `Editing notebook ${path}` : "Editing notebook";
        }

        // ── Default: "Used tool: {name}" ──
        default:
            return `Used tool: ${displayName}`;
    }
}

function extractToolResultText(content: ClaudeContent): string {
    const c = content.content;
    if (typeof c === "string") return c;
    if (c && typeof c === "object") return JSON.stringify(c);
    return "";
}

// ─── Config Builder ────────────────────────────────────────────────────

/**
 * Build a ClaudeCodeProcessConfig from the claude preset.
 */
export function buildClaudeCodeConfig(
    cwd: string,
    mcpConfigs?: string[],
    permissionMode?: string,
    extraEnv?: Record<string, string>,
    allowedTools?: string[],
): ClaudeCodeProcessConfig {
    const preset: AcpAgentPreset = {
        id: "claude",
        name: "Claude Code",
        command: "claude",
        args: [],
        description: "Anthropic Claude Code (native ACP support)",
        nonStandardApi: true,
    };

    const command = resolveCommand(preset);

    return {
        preset,
        command,
        cwd,
        env: extraEnv,
        displayName: "Claude Code",
        permissionMode: permissionMode ?? "bypassPermissions",
        // Enable Skill tool so Claude Code CLI can discover and use skills
        // from .claude/skills/ and ~/.claude/skills/ directories
        allowedTools: allowedTools ?? ["Skill", "Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        mcpConfigs: mcpConfigs ?? [],
    };
}

export function mapClaudeModeToPermissionMode(modeId?: string): string | undefined {
    if (!modeId) return undefined;
    switch (modeId) {
        case "plan":
            return "plan";
        case "acceptEdits":
        case "brave":
            return "acceptEdits";
        case "bypassPermissions":
            return "bypassPermissions";
        default:
            return undefined;
    }
}
