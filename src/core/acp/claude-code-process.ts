import { ChildProcess, spawn } from "child_process";
import { NotificationHandler, JsonRpcMessage } from "@/core/acp/processer";
import { AcpAgentPreset, resolveCommand } from "@/core/acp/acp-presets";

/**
 * Claude Code stream-json protocol types.
 *
 * Claude Code uses a different wire format from ACP:
 *   - stdin/stdout: JSON lines (NDJSON) with Claude-specific message types
 *   - Message types: system, assistant, user, result, stream_event
 *
 * This process translates Claude's output into ACP-compatible `session/update`
 * notifications so the existing frontend renderer works without changes.
 */

// ─── Claude Protocol Types ──────────────────────────────────────────────

interface ClaudeStreamDelta {
    type: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    signature?: string;
}

interface ClaudeStreamContentBlock {
    type: string;
    text?: string;
    thinking?: string;
    id?: string;
    name?: string;
    input?: unknown;
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
    message?: { role: string; content: ClaudeContent[] };
    event?: ClaudeStreamEvent;
    result?: string;
    is_error?: boolean;
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
    private process: ChildProcess | null = null;
    private buffer = "";
    private _sessionId: string | null = null;
    private _alive = false;
    private _config: ClaudeCodeProcessConfig;
    private onNotification: NotificationHandler;

    // Track tool names for mapping tool_use → tool_result
    private toolUseNames = new Map<string, string>();
    private toolUseInputs = new Map<string, Record<string, unknown>>();
    private renderedToolIds = new Set<string>();

    // Streaming state
    private inThinking = false;
    private inText = false;
    private hasRenderedStreamContent = false;

    // Resolve/reject for the current prompt
    private promptResolve: ((value: { stopReason: string }) => void) | null = null;
    private promptReject: ((reason: Error) => void) | null = null;

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
        cmd.push("--verbose");

        const effectivePermissionMode = permissionMode ?? "acceptEdits";
        cmd.push("--permission-mode", effectivePermissionMode);

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

        this.process = spawn(cmd[0], cmd.slice(1), {
            stdio: ["pipe", "pipe", "pipe"],
            cwd,
            env: {
                ...process.env,
                ...env,
                PWD: cwd,
            },
            detached: false,
        });

        if (!this.process || !this.process.pid) {
            throw new Error(
                `Failed to spawn Claude Code - is "${command}" installed and in PATH?`
            );
        }

        if (!this.process.stdin || !this.process.stdout) {
            throw new Error(`Claude Code spawned without required stdio streams`);
        }

        this._alive = true;

        // Parse stdout as NDJSON
        this.process.stdout.on("data", (chunk: Buffer) => {
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
        this.hasRenderedStreamContent = false;

        // Build Claude user input
        const userInput = JSON.stringify({
            type: "user",
            message: {
                role: "user",
                content: [{ type: "text", text }],
            },
            session_id: this._sessionId ?? undefined,
        });

        return new Promise<{ stopReason: string }>((resolve, reject) => {
            this.promptResolve = resolve;
            this.promptReject = reject;

            // Write to stdin
            if (!this.process?.stdin?.writable) {
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

    private processBuffer(): void {
        const lines = this.buffer.split("\n");
        this.buffer = lines[lines.length - 1];

        for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].trim();
            if (!line || !line.startsWith("{")) continue;

            try {
                const msg = JSON.parse(line) as ClaudeOutputMessage;
                this.handleClaudeMessage(msg);
            } catch {
                // Ignore parse errors
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
                    console.log(`[ClaudeCode] Initialized (session=${this._sessionId})`);
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

                        this.emitSessionUpdate(sid, {
                            sessionUpdate: "tool_call_update",
                            toolCallId: toolId,
                            title: toolName,
                            status: isErr ? "failed" : "completed",
                            kind: mapClaudeToolName(toolName),
                            rawOutput: output,
                        });
                    }
                }
                break;
            }

            case "result": {
                const resultText = msg.result ?? "";
                if (resultText && !this.hasRenderedStreamContent) {
                    // Result came without streaming - emit as a message
                    this.emitSessionUpdate(sid, {
                        sessionUpdate: "agent_message_chunk",
                        content: { type: "text", text: resultText },
                    });
                }

                // Resolve the prompt promise
                if (this.promptResolve) {
                    this.promptResolve({ stopReason: msg.subtype ?? "end_turn" });
                    this.promptResolve = null;
                    this.promptReject = null;
                }
                break;
            }

            default:
                console.log(`[ClaudeCode] Unknown message type: ${msg.type}`);
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

                if (block.type === "thinking") {
                    this.inThinking = true;
                    // ThinkingStart - no specific update needed, chunks will come
                } else if (block.type === "text") {
                    this.inText = true;
                } else if (block.type === "tool_use") {
                    const toolId = block.id ?? "";
                    const toolName = block.name ?? "unknown";
                    this.toolUseNames.set(toolId, toolName);
                }
                break;
            }

            case "content_block_delta": {
                const delta = event.delta;
                if (!delta) return;

                if (delta.type === "thinking_delta" && delta.thinking) {
                    this.hasRenderedStreamContent = true;
                    this.emitSessionUpdate(sid, {
                        sessionUpdate: "agent_thought_chunk",
                        content: { type: "text", text: delta.thinking },
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
                    // Tool parameter streaming - we could emit tool updates here
                    // but the full tool_use comes in the "assistant" message
                }
                break;
            }

            case "content_block_stop": {
                if (this.inThinking) {
                    this.inThinking = false;
                }
                if (this.inText) {
                    this.inText = false;
                }
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

function mapClaudeToolName(claudeToolName: string): string {
    switch (claudeToolName) {
        case "Bash": return "shell";
        case "Read": return "read-file";
        case "Write": return "write-file";
        case "Edit": return "edit-file";
        case "Glob": return "glob";
        case "Grep": return "grep";
        case "WebSearch": return "web-search";
        case "WebFetch": return "web-fetch";
        case "Task": return "task";
        default: return claudeToolName;
    }
}

function formatToolTitle(toolName: string, params: Record<string, unknown>): string {
    switch (toolName) {
        case "Read":
        case "Write":
        case "Edit": {
            const path = (params.file_path ?? params.path ?? "") as string;
            return `${toolName}: ${path}`;
        }
        case "Bash": {
            const cmd = ((params.command as string) ?? "").slice(0, 80);
            return `Bash: ${cmd}`;
        }
        case "Task": {
            const desc = (params.description as string) ?? "";
            const subType = (params.subagent_type as string) ?? "";
            if (desc) {
                return subType ? `Task [${subType}]: ${desc}` : `Task: ${desc}`;
            }
            return "Task";
        }
        case "Glob":
        case "Grep": {
            const pattern = (params.pattern ?? params.glob_pattern ?? "") as string;
            return `${toolName}: ${pattern}`;
        }
        default:
            return toolName;
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
        permissionMode: permissionMode ?? "acceptEdits",
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
