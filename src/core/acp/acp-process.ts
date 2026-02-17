import {AcpProcessConfig, JsonRpcMessage, NotificationHandler, PendingRequest} from "@/core/acp/processer";
import {getTerminalManager} from "@/core/acp/terminal-manager";
import type {IProcessHandle} from "@/core/platform/interfaces";
import {getServerBridge} from "@/core/platform";

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

    constructor(
        message: string,
        code: number,
        authMethods?: AcpAuthMethod[],
        agentInfo?: { name: string; version: string }
    ) {
        super(message);
        this.name = "AcpError";
        this.code = code;
        this.authMethods = authMethods;
        this.agentInfo = agentInfo;
    }
}

export class AcpProcess {
    private process: IProcessHandle | null = null;
    private buffer = "";
    private pendingRequests = new Map<number | string, PendingRequest>();
    private requestId = 0;
    private onNotification: NotificationHandler;
    private _sessionId: string | null = null;
    private _alive = false;
    private _config: AcpProcessConfig;
    private _initResult: AcpInitResult | null = null;

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
                ...env,
                NODE_NO_READLINE: "1",
            },
            detached: false,
        });

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

        // Parse stdout as NDJSON
        this.process.stdout.on("data", (chunk: Buffer) => {
            this.buffer += chunk.toString("utf-8");
            this.processBuffer();
        });

        this.process.stderr?.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf-8").trim();
            if (text) {
                console.error(`[AcpProcess:${displayName} stderr] ${text}`);
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
            const isInitRequest = method === "initialize" || method === "session/new";

            let defaultTimeout: number;
            if (isInitRequest) {
                // npx/uvx may need to download packages on first run
                defaultTimeout = isNpxOrUvx ? 120000 : 10000; // 2 min for npx/uvx, 10s for others
            } else {
                defaultTimeout = 30000; // 30s for normal requests
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
                        new Error(`ACP Error [${msg.error.code}]: ${msg.error.message}`)
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
                // Auto-approve all permissions
                this.writeMessage({
                    jsonrpc: "2.0",
                    id,
                    result: {
                        outcome: {
                            outcome: "approved",
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
                    : { output: "" };
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
                        this.writeMessage({
                            jsonrpc: "2.0",
                            id,
                            result,
                        });
                    });
                } else {
                    this.writeMessage({
                        jsonrpc: "2.0",
                        id,
                        result: { exitCode: -1 },
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