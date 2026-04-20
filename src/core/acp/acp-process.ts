import {
    AcpProcessConfig,
    AcpSessionContext,
    JsonRpcMessage,
    NotificationHandler,
    PendingRequest,
} from "@/core/acp/processer";
import { awaitProcessReady, needsShell } from "@/core/acp/utils";
import {getTerminalManager} from "@/core/acp/terminal-manager";
import type {IProcessHandle} from "@/core/platform/interfaces";
import {getServerBridge} from "@/core/platform";
import {AgentRole} from "@/core/models/agent";

/**
 * Manages a single ACP agent process and its JSON-RPC communication.
 *
 * This is the core abstraction that handles the ACP protocol over stdio.
 * It works with any ACP-compliant agent (opencode, gemini, codex-acp, etc.).
 *
 * Uses the platform bridge for process spawning and file system operations,
 * enabling support across Web (Node.js), Tauri, and Electron environments.
 */
/**
 * Authentication method info from ACP agent.
 */
export interface AcpAuthMethod {
    id: string;
    name: string;
    description: string;
}

/**
 * ACP initialization result containing agent capabilities and auth methods.
 */
export interface AcpInitResult {
    protocolVersion: number;
    agentCapabilities?: Record<string, unknown>;
    agentInfo?: {
        name: string;
        version: string;
    };
    authMethods?: AcpAuthMethod[];
}

/**
 * Custom error class for ACP errors that may include auth requirements.
 */
export class AcpError extends Error {
    code: number;
    authMethods?: AcpAuthMethod[];
    agentInfo?: { name: string; version: string };
    data?: unknown;

    constructor(
        message: string,
        code: number,
        authMethods?: AcpAuthMethod[],
        agentInfo?: { name: string; version: string },
        data?: unknown,
    ) {
        super(message);
        this.name = "AcpError";
        this.code = code;
        this.authMethods = authMethods;
        this.agentInfo = agentInfo;
        this.data = data;
    }
}

export class AcpProcess {
    private process: IProcessHandle | null = null;
    private buffer = "";
    private pendingRequests = new Map<number | string, PendingRequest>();
    private pendingInteractiveRequests = new Map<string, {
        requestId: number | string;
        method: string;
        params: Record<string, unknown>;
    }>();
    private requestId = 0;
    private onNotification: NotificationHandler;
    private _sessionId: string | null = null;
    private _alive = false;
    private _config: AcpProcessConfig;
    private _initResult: AcpInitResult | null = null;
    private _sessionContext: AcpSessionContext | null = null;

    constructor(config: AcpProcessConfig, onNotification: NotificationHandler) {
        this._config = config;
        this.onNotification = onNotification;
    }

    get initResult(): AcpInitResult | null {
        return this._initResult;
    }

    get sessionId(): string | null {
        return this._sessionId;
    }

    get alive(): boolean {
        return this._alive && this.process !== null && this.process.exitCode === null;
    }

    get config(): AcpProcessConfig {
        return this._config;
    }

    get presetId(): string | undefined {
        return this._config.preset?.id;
    }

    setSessionContext(context: AcpSessionContext): void {
        this._sessionContext = context;
    }

    /**
     * Spawn the ACP agent process and wait for it to be ready.
     */
    async start(): Promise<void> {
        const {command, args, cwd, env, displayName, mcpConfigs} = this._config;

        // Build final args with MCP configs if provided
        const finalArgs = [...args];

        // Add MCP server configs if provided
        // Note: Different providers may use different flags for MCP config
        // - Auggie: --mcp-config
        // - OpenCode: --mcp-config (if supported)
        // - Codex: --mcp-config (if supported)
        if (mcpConfigs && mcpConfigs.length > 0) {
            for (const mcpConfig of mcpConfigs) {
                if (mcpConfig) {
                    finalArgs.push("--mcp-config", mcpConfig);
                }
            }
        }

        console.log(
            `[AcpProcess:${displayName}] Spawning: ${command} ${finalArgs.join(" ")} (cwd: ${cwd})`
        );

        const bridge = getServerBridge();
        if (!bridge.process.isAvailable()) {
            throw new Error(
                `Process spawning is not available on this platform. ` +
                `Cannot start ${displayName}.`
            );
        }

        this.process = bridge.process.spawn(command, finalArgs, {
            stdio: ["pipe", "pipe", "pipe"],
            cwd,
            env: {
                ...process.env,
                ...env,
                NODE_NO_READLINE: "1",
            },
            detached: false,
            // On Windows, batch files (.cmd/.bat) cannot be spawned directly —
            // they must be run through the shell (cmd.exe /c ...).
            shell: needsShell(command),
        });

        // Wire up stdout/stderr/exit listeners BEFORE awaiting ready.
        // Tauri's shell plugin forwards events immediately after cmd.spawn(),
        // so binding after the await would miss early output frames.
        this.process.stdout?.on("data", (chunk: Buffer) => {
            this.buffer += chunk.toString("utf-8");
            this.processBuffer();
        });

        this.process.stderr?.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf-8").trim();
            if (text) {
                console.error(`[AcpProcess:${displayName} stderr] ${text}`);
                // Forward stderr to frontend as process_output notification
                // This allows xterm.js to display agent process output
                this.onNotification({
                    jsonrpc: "2.0",
                    method: "session/update",
                    params: {
                        sessionId: this._sessionId ?? "pending",
                        update: {
                            sessionUpdate: "process_output",
                            source: "stderr",
                            data: text + "\n",
                            displayName,
                        },
                    },
                });
            }
        });

        this.process.on("exit", (code, signal) => {
            console.log(
                `[AcpProcess:${displayName}] Process exited: code=${code}, signal=${signal}`
            );
            this._alive = false;
            // Reject all pending requests
            for (const [id, pending] of this.pendingRequests) {
                clearTimeout(pending.timeout);
                pending.reject(new Error(`${displayName} process exited (code=${code})`));
                this.pendingRequests.delete(id);
            }
        });

        this.process.on("error", (err) => {
            console.error(`[AcpProcess:${displayName}] Process error:`, err);
            this._alive = false;
        });

        await awaitProcessReady(this.process);

        if (!this.process || !this.process.pid) {
            throw new Error(
                `Failed to spawn ${displayName} - is "${command}" installed and in PATH?`
            );
        }

        if (!this.process.stdin || !this.process.stdout) {
            throw new Error(
                `${displayName} spawned without required stdio streams`
            );
        }

        this._alive = true;


        // Wait for process to stabilize
        await new Promise((resolve) => setTimeout(resolve, 500));

        if (!this.alive) {
            throw new Error(`${displayName} process died during startup`);
        }

        console.log(
            `[AcpProcess:${displayName}] Process started, pid=${this.process.pid}`
        );
    }

    /**
     * Initialize the ACP protocol.
     * Stores the result including authMethods for later use.
     */
    async initialize(): Promise<AcpInitResult> {
        const result = await this.sendRequest("initialize", {
            protocolVersion: 1,
            clientInfo: {
                name: "routa-js",
                version: "0.1.0",
            },
        }) as AcpInitResult;

        // Store the init result for later use (e.g., auth error handling)
        this._initResult = result;

        console.log(
            `[AcpProcess:${this._config.displayName}] Initialized:`,
            JSON.stringify(result)
        );
        return result;
    }

    /**
     * Create a new ACP session.
     * Throws AcpError with authMethods if authentication is required.
     */
    async newSession(cwd?: string): Promise<string> {
        try {
            const result = (await this.sendRequest("session/new", {
                cwd: cwd || this._config.cwd,
                mcpServers: [],
            })) as { sessionId: string };

            this._sessionId = result.sessionId;
            console.log(
                `[AcpProcess:${this._config.displayName}] Session created: ${this._sessionId}`
            );
            return this._sessionId;
        } catch (error) {
            // If authentication is required, throw AcpError with auth info
            if (error instanceof AcpError) {
                throw new AcpError(
                    error.message,
                    error.code,
                    this._initResult?.authMethods ?? error.authMethods,
                    this._initResult?.agentInfo ?? error.agentInfo,
                    error.data,
                );
            }
            if (error instanceof Error) {
                const authMatch = error.message.match(/ACP Error \[(-?\d+)\]:\s*(.+)/);
                if (authMatch) {
                    const code = parseInt(authMatch[1], 10);
                    const message = authMatch[2];

                    // Include authMethods from init result if available
                    throw new AcpError(
                        message,
                        code,
                        this._initResult?.authMethods,
                        this._initResult?.agentInfo
                    );
                }
            }
            throw error;
        }
    }

    /**
     * Load an existing ACP session.
     * Used by providers such as codex-acp that can resume persisted threads.
     */
    async loadSession(sessionId: string, cwd?: string): Promise<void> {
        try {
            await this.sendRequest("session/load", {
                sessionId,
                cwd: cwd || this._config.cwd,
                mcpServers: [],
            });
            this._sessionId = sessionId;
            console.log(
                `[AcpProcess:${this._config.displayName}] Session loaded: ${this._sessionId}`
            );
        } catch (error) {
            if (error instanceof AcpError) {
                throw new AcpError(
                    error.message,
                    error.code,
                    this._initResult?.authMethods ?? error.authMethods,
                    this._initResult?.agentInfo ?? error.agentInfo,
                    error.data,
                );
            }
            throw error;
        }
    }

    /**
     * Send a prompt to the current session.
     * The response comes back asynchronously; content streams via session/update notifications.
     */
    async prompt(
        sessionId: string,
        text: string
    ): Promise<{ stopReason: string }> {
        const result = (await this.sendRequest(
            "session/prompt",
            {
                sessionId,
                prompt: [{type: "text", text}],
            },
            300000 // 5 min timeout for prompts
        )) as { stopReason: string };
        return result;
    }

    /**
     * Cancel the current prompt.
     */
    async cancel(sessionId: string): Promise<void> {
        // session/cancel is a notification (no response expected)
        this.writeMessage({
            jsonrpc: "2.0",
            method: "session/cancel",
            params: {sessionId},
        });
    }

    /**
     * Send a generic JSON-RPC request and wait for response.
     */
    async sendRequest(
        method: string,
        params: Record<string, unknown>,
        timeoutMs?: number
    ): Promise<unknown> {
        if (!this.alive) {
            throw new Error(`${this._config.displayName} process is not alive`);
        }

        return new Promise((resolve, reject) => {
            const id = ++this.requestId;

            // Determine timeout based on method and distribution type
            // npx/uvx agents may need longer timeout for first-time package download
            const isNpxOrUvx = this._config.command === "npx" || this._config.command === "uvx";
            const isInitRequest = method === "initialize" || method === "session/new" || method === "session/load";
            const isPromptRequest = method === "session/prompt";

            let defaultTimeout: number;
            if (isInitRequest) {
                // npx/uvx may need to download packages on first run
                // OpenCode may need longer on Windows due to shell initialization overhead
                const isOpencode = this._config.displayName?.toLowerCase().includes("opencode");
                defaultTimeout = isNpxOrUvx ? 120000 : (isOpencode ? 30000 : 15000); // 30s for opencode, 15s for others
            } else if (isPromptRequest) {
                // session/prompt can take a long time for complex tasks
                // Match Rust implementation: 5 minutes for prompt requests
                defaultTimeout = 300000; // 5 min
            } else {
                defaultTimeout = 30000; // 30s for other requests
            }

            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Timeout waiting for ${method} (id=${id})`));
            }, timeoutMs ?? defaultTimeout);

            this.pendingRequests.set(id, {resolve, reject, timeout});

            this.writeMessage({
                jsonrpc: "2.0",
                id,
                method,
                params,
            });
        });
    }

    /**
     * Kill the agent process.
     */
    kill(): void {
        if (this.process && this.process.exitCode === null) {
            console.log(
                `[AcpProcess:${this._config.displayName}] Killing process pid=${this.process.pid}`
            );
            this.process.kill("SIGTERM");

            // Force kill after 5 seconds if still alive
            setTimeout(() => {
                if (this.process && this.process.exitCode === null) {
                    this.process.kill("SIGKILL");
                }
            }, 5000);
        }
        this._alive = false;
        this.pendingInteractiveRequests.clear();
    }

    respondToUserInput(toolCallId: string, response: Record<string, unknown>): boolean {
        const pending = this.pendingInteractiveRequests.get(toolCallId);
        if (!pending) {
            return false;
        }

        this.pendingInteractiveRequests.delete(toolCallId);

        let result: Record<string, unknown>;
        let notificationRawInput: Record<string, unknown> = response;
        if (pending.method === "session/request_permission") {
            const explicitOptionId = typeof response.optionId === "string" && response.optionId.trim().length > 0
                ? response.optionId.trim()
                : undefined;
            const decision = typeof response.decision === "string" ? response.decision : "approve";
            const scope = response.scope === "session" ? "session" : "turn";
            result = explicitOptionId
                ? {
                    outcome: {
                        outcome: "selected",
                        optionId: explicitOptionId,
                    },
                }
                : this.buildPermissionResponseResult(pending.params, decision, scope);
            const selectedOptionId = explicitOptionId ?? this.extractSelectedPermissionOptionId(result);
            notificationRawInput = {
                ...pending.params,
                decision,
                scope,
                outcome: typeof selectedOptionId === "string" ? "selected" : "cancelled",
                ...(selectedOptionId ? { optionId: selectedOptionId } : {}),
            };
        } else {
            result = response;
        }

        console.log(
            `[AcpProcess:${this._config.displayName}] Responding to interactive agent request ${pending.method} (id=${String(pending.requestId)}): ${JSON.stringify(result)}`
        );
        this.writeMessage({
            jsonrpc: "2.0",
            id: pending.requestId,
            result,
        });

        this.onNotification({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
                sessionId: this._sessionId ?? "pending",
                update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId,
                    title: pending.method === "session/request_permission" ? "RequestPermissions" : "UserInputResponse",
                    status: "completed",
                    rawInput: notificationRawInput,
                    rawOutput: pending.method === "session/request_permission" ? result : undefined,
                },
            },
        });

        return true;
    }

    // ─── Private ────────────────────────────────────────────────────────────

    private processBuffer(): void {
        const lines = this.buffer.split("\n");
        // Keep the last incomplete line in the buffer
        this.buffer = lines[lines.length - 1];

        for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            try {
                const msg = JSON.parse(line) as JsonRpcMessage;
                this.handleMessage(msg);
            } catch {
                // Try to find JSON objects in the line (some agents concatenate)
                this.tryParseEmbeddedJson(line);
            }
        }
    }

    private tryParseEmbeddedJson(line: string): void {
        // Try to find JSON objects by matching braces
        let depth = 0;
        let start = -1;

        for (let i = 0; i < line.length; i++) {
            if (line[i] === "{") {
                if (depth === 0) start = i;
                depth++;
            } else if (line[i] === "}") {
                depth--;
                if (depth === 0 && start >= 0) {
                    try {
                        const msg = JSON.parse(line.slice(start, i + 1)) as JsonRpcMessage;
                        this.handleMessage(msg);
                    } catch {
                        // Ignore parse errors for embedded JSON
                    }
                    start = -1;
                }
            }
        }
    }

    private handleMessage(msg: JsonRpcMessage): void {
        // Response to a pending request (has id, has result or error)
        if (
            msg.id !== undefined &&
            (msg.result !== undefined || msg.error !== undefined)
        ) {
            const pending = this.pendingRequests.get(msg.id);
            if (pending) {
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(msg.id);
                if (msg.error) {
                    pending.reject(
                        new AcpError(
                            msg.error.message,
                            msg.error.code,
                            undefined,
                            undefined,
                            msg.error.data,
                        )
                    );
                } else {
                    pending.resolve(msg.result);
                }
                return;
            }
        }

        // Agent→Client requests (has id and method, expects response)
        if (msg.id !== undefined && msg.method) {
            this.handleAgentRequest(msg);
            return;
        }

        // Notification (no id, has method) - e.g. session/update
        if (msg.method) {
            const updateType = (msg.params as Record<string, unknown>)?.update;
            const sessionUpdate = updateType
                ? (updateType as Record<string, unknown>)?.sessionUpdate
                : (msg.params as Record<string, unknown>)?.sessionUpdate;
            console.log(
                `[AcpProcess:${this._config.displayName}] Notification: ${msg.method} (${sessionUpdate ?? "unknown"})`
            );
            this.onNotification(msg);
            return;
        }

        console.warn(
            `[AcpProcess:${this._config.displayName}] Unhandled message:`,
            JSON.stringify(msg)
        );
    }

    /**
     * Handle requests FROM the agent TO the client (fs, terminal, permissions).
     * We auto-respond to keep the agent running.
     */
    private handleAgentRequest(msg: JsonRpcMessage): void {
        const {method, id, params} = msg;

        console.log(
            `[AcpProcess:${this._config.displayName}] Agent request: ${method} (id=${id})`
        );

        switch (method) {
            case "session/request_permission": {
                const toolCallId = `request-permission-${String(id)}`;
                const rawInput = (params && typeof params === "object")
                    ? params as Record<string, unknown>
                    : {};
                if (this.shouldAutoApprovePermissionRequest(rawInput)) {
                    const result = this.buildPermissionApprovalResult(rawInput);
                    console.log(
                        `[AcpProcess:${this._config.displayName}] Auto-responding to agent request ${method} (id=${String(id)}): ${JSON.stringify(result)}`
                    );
                    this.writeMessage({
                        jsonrpc: "2.0",
                        id,
                        result,
                    });
                    this.onNotification({
                        jsonrpc: "2.0",
                        method: "session/update",
                        params: {
                            sessionId: this._sessionId ?? "pending",
                            update: {
                                sessionUpdate: "tool_call_update",
                                title: "RequestPermissions",
                                toolCallId,
                                kind: "request-permissions",
                                status: "completed",
                                rawInput: result,
                            },
                        },
                    });
                    break;
                }
                this.pendingInteractiveRequests.set(toolCallId, {
                    requestId: id!,
                    method,
                    params: rawInput,
                });

                this.onNotification({
                    jsonrpc: "2.0",
                    method: "session/update",
                    params: {
                        sessionId: this._sessionId ?? "pending",
                        update: {
                            sessionUpdate: "tool_call",
                            title: "RequestPermissions",
                            toolCallId,
                            kind: "request-permissions",
                            rawInput,
                            status: "waiting",
                        },
                    },
                });
                break;
            }

            case "fs/read_text_file": {
                const filePath = (params as { path: string })?.path;
                if (filePath) {
                    const fsBridge = getServerBridge().fs;
                    fsBridge.readTextFile(filePath).then((content) => {
                        console.log(
                            `[AcpProcess:${this._config.displayName}] Responding to agent request ${method} (id=${String(id)}): ${JSON.stringify({content})}`
                        );
                        this.writeMessage({
                            jsonrpc: "2.0",
                            id,
                            result: {content},
                        });
                    }).catch((err) => {
                        this.writeMessage({
                            jsonrpc: "2.0",
                            id,
                            error: {
                                code: -32000,
                                message: `Failed to read file: ${(err as Error).message}`,
                            },
                        });
                    });
                }
                break;
            }

            case "fs/write_text_file": {
                const {path: writePath, content} = (params as {
                    path: string;
                    content: string;
                }) ?? {};
                if (writePath && content !== undefined) {
                    const fsBridge = getServerBridge().fs;
                    fsBridge.writeTextFile(writePath, content).then(() => {
                        console.log(
                            `[AcpProcess:${this._config.displayName}] Responding to agent request ${method} (id=${String(id)}): {}`
                        );
                        this.writeMessage({
                            jsonrpc: "2.0",
                            id,
                            result: {},
                        });
                    }).catch((err) => {
                        this.writeMessage({
                            jsonrpc: "2.0",
                            id,
                            error: {
                                code: -32000,
                                message: `Failed to write file: ${(err as Error).message}`,
                            },
                        });
                    });
                }
                break;
            }

            case "terminal/create": {
                const terminalManager = getTerminalManager();
                const termParams = (params ?? {}) as Record<string, unknown>;
                const result = terminalManager.create(
                    termParams,
                    this._sessionId ?? "unknown",
                    (notification) => {
                        // Forward terminal notifications through the ACP notification channel
                        this.onNotification(notification as unknown as JsonRpcMessage);
                    }
                );
                console.log(
                    `[AcpProcess:${this._config.displayName}] Responding to agent request ${method} (id=${String(id)}): ${JSON.stringify(result)}`
                );
                this.writeMessage({
                    jsonrpc: "2.0",
                    id,
                    result,
                });
                break;
            }

            case "terminal/output": {
                const terminalManager = getTerminalManager();
                const termId = (params as { terminalId?: string })?.terminalId;
                const output = termId
                    ? terminalManager.getOutput(termId)
                    : { output: "", truncated: false };
                console.log(
                    `[AcpProcess:${this._config.displayName}] Responding to agent request ${method} (id=${String(id)}): ${JSON.stringify(output)}`
                );
                this.writeMessage({
                    jsonrpc: "2.0",
                    id,
                    result: output,
                });
                break;
            }

            case "terminal/wait_for_exit": {
                const terminalManager = getTerminalManager();
                const termId = (params as { terminalId?: string })?.terminalId;
                if (termId) {
                    terminalManager.waitForExit(termId).then((result) => {
                        console.log(
                            `[AcpProcess:${this._config.displayName}] Responding to agent request ${method} (id=${String(id)}): ${JSON.stringify(result)}`
                        );
                        this.writeMessage({
                            jsonrpc: "2.0",
                            id,
                            result,
                        });
                    });
                } else {
                    console.log(
                        `[AcpProcess:${this._config.displayName}] Responding to agent request ${method} (id=${String(id)}): ${JSON.stringify({ exitCode: null, signal: null })}`
                    );
                    this.writeMessage({
                        jsonrpc: "2.0",
                        id,
                        result: { exitCode: null, signal: null },
                    });
                }
                break;
            }

            case "terminal/kill": {
                const terminalManager = getTerminalManager();
                const termId = (params as { terminalId?: string })?.terminalId;
                if (termId) {
                    terminalManager.kill(termId);
                }
                console.log(
                    `[AcpProcess:${this._config.displayName}] Responding to agent request ${method} (id=${String(id)}): {}`
                );
                this.writeMessage({
                    jsonrpc: "2.0",
                    id,
                    result: {},
                });
                break;
            }

            case "terminal/release": {
                const terminalManager = getTerminalManager();
                const termId = (params as { terminalId?: string })?.terminalId;
                if (termId) {
                    terminalManager.release(termId);
                }
                console.log(
                    `[AcpProcess:${this._config.displayName}] Responding to agent request ${method} (id=${String(id)}): {}`
                );
                this.writeMessage({
                    jsonrpc: "2.0",
                    id,
                    result: {},
                });
                break;
            }

            default: {
                console.warn(
                    `[AcpProcess:${this._config.displayName}] Unknown agent request: ${method}`
                );
                this.writeMessage({
                    jsonrpc: "2.0",
                    id,
                    error: {
                        code: -32601,
                        message: `Method not supported: ${method}`,
                    },
                });
            }
        }
    }

    private shouldAutoApprovePermissionRequest(params: Record<string, unknown>): boolean {
        const provider = (this._sessionContext?.provider ?? this.presetId ?? "").toLowerCase();
        const isCodex = provider === "codex" || provider === "codex-acp";
        if (isCodex) return typeof params === "object" && params !== null;

        if (!this._sessionContext?.autoApprovePermissions) return false;

        return typeof params === "object" && params !== null;
    }

    private buildPermissionApprovalResult(params: Record<string, unknown>): Record<string, unknown> {
        const scope = this.getDefaultPermissionScope();
        return this.buildPermissionResponseResult(params, "approve", scope);
    }

    private getDefaultPermissionScope(): "session" | "turn" {
        const role = (this._sessionContext?.role ?? "").toUpperCase();
        return role === AgentRole.ROUTA ? "session" : "turn";
    }

    private resolvePermissionOptionId(
        params: Record<string, unknown>,
        decision: string,
        scope: "session" | "turn",
    ): string | undefined {
        const options = Array.isArray(params.options)
            ? params.options.filter((option): option is Record<string, unknown> => typeof option === "object" && option !== null)
            : [];
        if (options.length === 0) {
            return undefined;
        }

        const normalizedOptions = options.map((option) => ({
            optionId: typeof option.optionId === "string" ? option.optionId : undefined,
            kind: typeof option.kind === "string" ? option.kind : undefined,
        })).flatMap((option) => (
            typeof option.optionId === "string"
                ? [{ optionId: option.optionId, kind: option.kind }]
                : []
        ));

        if (decision === "deny") {
            return this.findPermissionOptionId(normalizedOptions, [
                "abort",
                "denied",
                "decline",
                "cancel",
                "rejected",
                "reject",
            ], [
                "reject_once",
                "reject_always",
            ]);
        }

        if (scope === "session") {
            return this.findPermissionOptionId(normalizedOptions, [
                "approved-for-session",
                "approved-always",
                "approved-execpolicy-amendment",
                "approved",
            ], [
                "allow_always",
                "allow_once",
            ]);
        }

        return this.findPermissionOptionId(normalizedOptions, [
            "approved",
            "approved-once",
            "approved-for-session",
            "approved-always",
            "approved-execpolicy-amendment",
        ], [
            "allow_once",
            "allow_always",
        ]);
    }

    private buildPermissionResponseResult(
        params: Record<string, unknown>,
        decision: string,
        scope: "session" | "turn",
    ): Record<string, unknown> {
        const optionId = this.resolvePermissionOptionId(params, decision, scope)
            ?? this.getFallbackPermissionOptionId(decision, scope);

        if (optionId) {
            return {
                outcome: {
                    outcome: "selected",
                    optionId,
                },
            };
        }

        return {
            outcome: {
                outcome: "cancelled",
            },
        };
    }

    private getFallbackPermissionOptionId(
        decision: string,
        scope: "session" | "turn",
    ): string | undefined {
        if (decision === "deny") {
            return "abort";
        }
        return scope === "session" ? "approved-for-session" : "approved";
    }

    private extractSelectedPermissionOptionId(result: Record<string, unknown>): string | undefined {
        const outcome = typeof result.outcome === "object" && result.outcome !== null
            ? result.outcome as Record<string, unknown>
            : undefined;
        return typeof outcome?.optionId === "string" ? outcome.optionId : undefined;
    }

    private findPermissionOptionId(
        options: Array<{ optionId: string; kind?: string }>,
        preferredIds: string[],
        preferredKinds: string[],
    ): string | undefined {
        for (const optionId of preferredIds) {
            const match = options.find((option) => option.optionId === optionId);
            if (match) return match.optionId;
        }

        for (const kind of preferredKinds) {
            const match = options.find((option) => option.kind === kind);
            if (match) return match.optionId;
        }

        return options[0]?.optionId;
    }

    private writeMessage(msg: Record<string, unknown>): void {
        if (!this.process?.stdin || !this.process.stdin.writable) {
            console.error(
                `[AcpProcess:${this._config.displayName}] Cannot write - stdin not writable`
            );
            return;
        }

        const data = JSON.stringify(msg) + "\n";
        this.process.stdin.write(data);
    }
}
