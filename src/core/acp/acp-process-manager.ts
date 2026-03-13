import {AcpProcess} from "@/core/acp/acp-process";
import {buildConfigFromPreset, buildConfigFromInline, ManagedProcess, NotificationHandler} from "@/core/acp/processer";
import {ClaudeCodeProcess, buildClaudeCodeConfig, mapClaudeModeToPermissionMode} from "@/core/acp/claude-code-process";
import {ensureMcpForProvider, providerSupportsMcp} from "@/core/acp/mcp-setup";
import {getDefaultRoutaMcpConfig} from "@/core/acp/mcp-config-generator";
import {OpencodeSdkAdapter, OpencodeSdkDirectAdapter, shouldUseOpencodeAdapter, getOpencodeServerUrl, isOpencodeServerConfigured, isOpencodeDirectApiConfigured} from "@/core/acp/opencode-sdk-adapter";
import {ClaudeCodeSdkAdapter, shouldUseClaudeCodeSdkAdapter} from "@/core/acp/claude-code-sdk-adapter";
import {WorkspaceAgentAdapter, type WorkspaceAgentAdapterOptions} from "@/core/acp/workspace-agent";
import { DockerOpenCodeAdapter, getDockerProcessManager, DEFAULT_DOCKER_AGENT_IMAGE } from "@/core/acp/docker";
import {isServerlessEnvironment} from "@/core/acp/api-based-providers";
import {getHttpSessionStore} from "@/core/acp/http-session-store";
import {AgentInstanceFactory, getAgentInstanceManager, type AgentInstanceConfig} from "@/core/acp/agent-instance-factory";
import {getDatabaseDriver, getPostgresDatabase} from "@/core/db/index";
import {PgAcpSessionStore} from "@/core/db/pg-acp-session-store";
import type { LifecycleNotifier } from "@/core/acp/lifecycle-notifier";

/**
 * A managed Claude Code process (separate from standard ACP).
 */
export interface ManagedClaudeProcess {
    process: ClaudeCodeProcess;
    acpSessionId: string;
    presetId: string;
    createdAt: Date;
}

/**
 * A managed OpenCode SDK adapter (for serverless environments).
 */
export interface ManagedOpencodeAdapter {
    adapter: OpencodeSdkAdapter | OpencodeSdkDirectAdapter;
    acpSessionId: string;
    presetId: string;
    createdAt: Date;
}

/**
 * A managed Claude Code SDK adapter (for serverless environments).
 */
export interface ManagedClaudeCodeSdkAdapter {
    adapter: ClaudeCodeSdkAdapter;
    acpSessionId: string;
    presetId: string;
    createdAt: Date;
}

/**
 * A managed Workspace Agent adapter (native Vercel AI SDK agent).
 */
export interface ManagedWorkspaceAgent {
    adapter: WorkspaceAgentAdapter;
    acpSessionId: string;
    presetId: string;
    createdAt: Date;
}

/**
 * A managed Docker OpenCode adapter.
 */
export interface ManagedDockerAdapter {
    adapter: DockerOpenCodeAdapter;
    acpSessionId: string;
    presetId: string;
    createdAt: Date;
}

/**
 * Singleton manager for ACP agent processes.
 * Maps our session IDs to ACP process instances.
 * Supports spawning different agent types via presets, including Claude Code.
 * In serverless environments, uses OpenCode SDK adapter when configured.
 */
export class AcpProcessManager {
    private processes = new Map<string, ManagedProcess>();
    private claudeProcesses = new Map<string, ManagedClaudeProcess>();
    private opencodeAdapters = new Map<string, ManagedOpencodeAdapter>();
    private dockerAdapters = new Map<string, ManagedDockerAdapter>();
    private claudeCodeSdkAdapters = new Map<string, ManagedClaudeCodeSdkAdapter>();
    private workspaceAgents = new Map<string, ManagedWorkspaceAgent>();

    /**
     * Spawn a new ACP agent process, initialize the protocol, and create a session.
     * In serverless environments with OPENCODE_SERVER_URL configured, uses SDK adapter instead.
     *
     * @param sessionId - Our internal session ID
     * @param cwd - Working directory for the agent
     * @param onNotification - Handler for session/update notifications
     * @param presetId - Which ACP agent to use (default: "opencode")
     * @param extraArgs - Additional command-line arguments
     * @param extraEnv - Additional environment variables
     * @returns The agent's ACP session ID
     */
    async createSession(
        sessionId: string,
        cwd: string,
        onNotification: NotificationHandler,
        presetId: string = "opencode",
        initialModeId?: string,
        extraArgs?: string[],
        extraEnv?: Record<string, string>,
        workspaceId?: string,
        toolMode?: "essential" | "full",
    ): Promise<string> {
        // Check if we should use OpenCode SDK adapter (serverless + configured)
        if (presetId === "opencode" && shouldUseOpencodeAdapter()) {
            return this.createOpencodeSdkSession(sessionId, onNotification);
        }

        // Setup MCP: writes config files and/or returns CLI args
        // Pass workspaceId and sessionId so the MCP endpoint URL has ?wsId= and ?sid= params
        // This ensures notes created by the agent are scoped to the current session.
        let mcpConfigs: string[] | undefined;
        if (providerSupportsMcp(presetId)) {
            const mcpResult = await ensureMcpForProvider(
                presetId,
                getDefaultRoutaMcpConfig(workspaceId, sessionId, toolMode),
            );
            mcpConfigs = mcpResult.mcpConfigs.length > 0 ? mcpResult.mcpConfigs : undefined;
            console.log(`[AcpProcessManager] MCP setup for ${presetId}: ${mcpResult.summary}`);
        }

        const config = await buildConfigFromPreset(presetId, cwd, extraArgs, extraEnv, mcpConfigs);
        const proc = new AcpProcess(config, onNotification);

        await proc.start();
        await proc.initialize();
        const acpSessionId = await proc.newSession(cwd);
        if (initialModeId) {
            try {
                await proc.sendRequest("session/set_mode", {
                    sessionId: acpSessionId,
                    modeId: initialModeId,
                });
            } catch {
                // Some providers do not support set_mode; ignore.
            }
        }

        this.processes.set(sessionId, {
            process: proc,
            acpSessionId,
            presetId,
            createdAt: new Date(),
        });

        return acpSessionId;
    }

    /**
     * Spawn a new ACP agent process from an inline command and args (custom provider).
     * Used when the user defines a custom ACP provider not in the preset registry.
     *
     * @param sessionId - Our internal session ID
     * @param command - The command to execute (e.g. "my-agent")
     * @param args - Command-line arguments for ACP mode (e.g. ["--acp"])
     * @param cwd - Working directory for the agent
     * @param displayName - Human-readable name for logging
     * @param onNotification - Handler for session/update notifications
     * @returns The agent's ACP session ID
     */
    async createSessionFromInline(
        sessionId: string,
        command: string,
        args: string[],
        cwd: string,
        displayName: string,
        onNotification: NotificationHandler,
    ): Promise<string> {
        const config = buildConfigFromInline(command, args, cwd, displayName);
        const proc = new AcpProcess(config, onNotification);

        await proc.start();
        await proc.initialize();
        const acpSessionId = await proc.newSession(cwd);

        this.processes.set(sessionId, {
            process: proc,
            acpSessionId,
            presetId: `custom:${command}`,
            createdAt: new Date(),
        });

        return acpSessionId;
    }

    /**
     * Create a session using OpenCode SDK adapter (for serverless environments).
     * This is public so that the API route can explicitly request SDK-based session
     * when the provider is 'opencode-sdk'.
     */
    async createOpencodeSdkSession(
        sessionId: string,
        onNotification: NotificationHandler
    ): Promise<string> {
        const serverUrl = getOpencodeServerUrl();

        if (serverUrl) {
            // Mode 1: Remote Server
            console.log(`[AcpProcessManager] Using OpenCode SDK adapter (remote server)`);
            console.log(`[AcpProcessManager] Connecting to: ${serverUrl}`);

            const adapter = new OpencodeSdkAdapter(serverUrl, onNotification);
            await adapter.connect();
            const acpSessionId = await adapter.createSession(`Routa Session ${sessionId}`);

            this.opencodeAdapters.set(sessionId, {
                adapter,
                acpSessionId,
                presetId: "opencode-sdk",
                createdAt: new Date(),
            });

            console.log(`[AcpProcessManager] OpenCode SDK session created: ${acpSessionId}`);
            return acpSessionId;
        }

        if (isOpencodeDirectApiConfigured()) {
            // Mode 2: Direct API (BigModel Coding API, etc.)
            console.log(`[AcpProcessManager] Using OpenCode SDK adapter (direct API mode)`);

            const adapter = new OpencodeSdkDirectAdapter(onNotification);
            await adapter.connect();
            const acpSessionId = await adapter.createSession(`Routa Session ${sessionId}`);

            this.opencodeAdapters.set(sessionId, {
                adapter,
                acpSessionId,
                presetId: "opencode-sdk",
                createdAt: new Date(),
            });

            console.log(`[AcpProcessManager] OpenCode SDK direct session created: ${acpSessionId}`);
            return acpSessionId;
        }

        throw new Error("OpenCode SDK not configured. Set OPENCODE_SERVER_URL or OPENCODE_API_KEY.");
    }

    /**
     * Create a session using Docker-isolated OpenCode agent.
     */
    async createDockerSession(
        sessionId: string,
        cwd: string,
        onNotification: NotificationHandler,
        image?: string,
        extraEnv?: Record<string, string>,
        authJson?: string,
    ): Promise<string> {
        const dockerManager = getDockerProcessManager();
        // Use acquireContainer for container reuse support
        const container = await dockerManager.acquireContainer({
            sessionId,
            image: image ?? DEFAULT_DOCKER_AGENT_IMAGE,
            workspacePath: cwd,
            env: extraEnv,
            authJson,
        });

        try {
            await dockerManager.waitForHealthy(sessionId, undefined, onNotification);
            const adapter = new DockerOpenCodeAdapter(
                `http://127.0.0.1:${container.hostPort}`,
                onNotification,
            );
            await adapter.connect();
            const acpSessionId = await adapter.createSession(`Routa Docker Session ${sessionId}`);

            this.dockerAdapters.set(sessionId, {
                adapter,
                acpSessionId,
                presetId: "docker-opencode",
                createdAt: new Date(),
            });

            return acpSessionId;
        } catch (err) {
            // Emit container logs so the user can see why the session failed
            try {
                const bridge = (await import("@/core/platform")).getServerBridge();
                const { shellEscape } = await import("./docker/utils");
                const { stdout, stderr } = await bridge.process.exec(
                    `docker logs --tail 50 ${shellEscape(container.containerName)}`,
                    { timeout: 5_000 },
                );
                const logs = `${stdout}${stderr ? `\n${stderr}` : ""}`.trim();
                if (logs) {
                    onNotification({
                        jsonrpc: "2.0",
                        method: "session/update",
                        params: {
                            sessionId,
                            update: {
                                sessionUpdate: "process_output",
                                source: "docker",
                                data: `[Container logs on failure]\n${logs}\n`,
                                displayName: "Docker",
                            },
                        },
                    });
                }
            } catch {
                // Log capture failure is non-fatal
            }
            await dockerManager.stopContainer(sessionId).catch(() => {});
            throw err;
        }
    }

    /**
     * Spawn a new Claude Code process with stream-json mode.
     * In serverless environments, uses Claude Code SDK adapter instead.
     *
     * @param sessionId - Our internal session ID
     * @param cwd - Working directory
     * @param onNotification - Handler for translated session/update notifications
     * @param mcpConfigs - MCP config JSON strings to pass to Claude Code
     * @param modeId - Claude mode (acceptEdits, plan, etc.)
     * @param role - Agent role (ROUTA, CRAFTER, GATE). ROUTA forces bypassPermissions.
     * @param extraEnv - Additional environment variables
     * @returns A synthetic session ID for Claude Code
     */
    async createClaudeSession(
        sessionId: string,
        cwd: string,
        onNotification: NotificationHandler,
        mcpConfigs?: string[],
        modeId?: string,
        role?: string,
        extraEnv?: Record<string, string>,
    ): Promise<string> {
        // In serverless environments, use Claude Code SDK adapter
        if (shouldUseClaudeCodeSdkAdapter()) {
            return this.createClaudeCodeSdkSession(sessionId, cwd, onNotification);
        }

        // ROUTA agents need bypassPermissions because they use MCP tools
        // (create_task, delegate_task_to_agent, list_agents) that are NOT
        // auto-approved under acceptEdits mode, causing "you haven't
        // granted permission" errors.
        const permissionMode = role === "ROUTA"
            ? "bypassPermissions"
            : mapClaudeModeToPermissionMode(modeId);
        const config = buildClaudeCodeConfig(cwd, mcpConfigs, permissionMode, extraEnv);
        const proc = new ClaudeCodeProcess(config, onNotification);

        await proc.start();

        // Claude Code doesn't have a separate "initialize" or "newSession" step.
        // The session ID comes from the "system" init message on first prompt.
        // We use our sessionId as the ACP session ID for consistency.
        const acpSessionId = sessionId;

        this.claudeProcesses.set(sessionId, {
            process: proc,
            acpSessionId,
            presetId: "claude",
            createdAt: new Date(),
        });

        return acpSessionId;
    }

    /**
     * Create a session using Claude Code SDK adapter (for serverless environments).
     * This is public so that the API route can explicitly request SDK-based session
     * when the provider is 'claude-code-sdk'.
     *
     * @param instanceConfig - Optional config from AgentInstanceFactory to set model/specialist.
     *   If omitted, the adapter falls back to env-var / SDK defaults.
     */
    async createClaudeCodeSdkSession(
        sessionId: string,
        cwd: string,
        onNotification: NotificationHandler,
        instanceConfig?: AgentInstanceConfig,
        lifecycleNotifier?: LifecycleNotifier,
    ): Promise<string> {
        console.log(`[AcpProcessManager] Using Claude Code SDK adapter for serverless environment`);

        const { adapter, resolved } = AgentInstanceFactory.createClaudeCodeSdkAdapter(
            cwd,
            onNotification,
            instanceConfig,
            lifecycleNotifier,
        );
        await adapter.connect();
        const acpSessionId = await adapter.createSession(`Routa Session ${sessionId}`);

        this.claudeCodeSdkAdapters.set(sessionId, {
            adapter,
            acpSessionId,
            presetId: "claude-code-sdk",
            createdAt: new Date(),
        });

        // Track instance config for observability
        getAgentInstanceManager().register(sessionId, resolved);

        console.log(`[AcpProcessManager] Claude Code SDK session created: ${acpSessionId} (model: ${resolved.resolvedModel ?? 'default'})`);
        return acpSessionId;
    }

    /**
     * Create a session using the native Workspace Agent adapter (Vercel AI SDK).
     *
     * @param sessionId - Our internal session ID
     * @param cwd - Working directory for the agent
     * @param onNotification - Handler for session/update notifications
     * @param options - Agent tools, workspace ID, agent ID, config overrides
     * @returns The agent's ACP session ID
     */
    async createWorkspaceAgentSession(
        sessionId: string,
        cwd: string,
        onNotification: NotificationHandler,
        options?: Omit<WorkspaceAgentAdapterOptions, never>,
    ): Promise<string> {
        console.log(`[AcpProcessManager] Creating Workspace Agent session`);

        const adapter = new WorkspaceAgentAdapter(cwd, onNotification, options);
        await adapter.connect();
        const acpSessionId = await adapter.createSession(`Routa Session ${sessionId}`);

        this.workspaceAgents.set(sessionId, {
            adapter,
            acpSessionId,
            presetId: "workspace",
            createdAt: new Date(),
        });

        console.log(`[AcpProcessManager] Workspace Agent session created: ${acpSessionId}`);
        return acpSessionId;
    }

    async setSessionMode(sessionId: string, modeId: string): Promise<void> {
        if (this.isClaudeSession(sessionId)) {
            const claudeProc = this.getClaudeProcess(sessionId);
            if (!claudeProc) return;
            const permissionMode = mapClaudeModeToPermissionMode(modeId);
            if (permissionMode) {
                claudeProc.setPermissionMode(permissionMode);
            }
            return;
        }

        const proc = this.getProcess(sessionId);
        const acpSessionId = this.getAcpSessionId(sessionId);
        if (!proc || !acpSessionId) return;

        await proc.sendRequest("session/set_mode", {
            sessionId: acpSessionId,
            modeId,
        });
    }

    /**
     * Get the ACP process for a session.
     */
    getProcess(sessionId: string): AcpProcess | undefined {
        return this.processes.get(sessionId)?.process;
    }

    /**
     * Get the Claude Code process for a session.
     */
    getClaudeProcess(sessionId: string): ClaudeCodeProcess | undefined {
        return this.claudeProcesses.get(sessionId)?.process;
    }

    /**
     * Get the OpenCode SDK adapter for a session.
     */
    getOpencodeAdapter(sessionId: string): OpencodeSdkAdapter | OpencodeSdkDirectAdapter | undefined {
        return this.opencodeAdapters.get(sessionId)?.adapter;
    }

    /**
     * Get the Docker OpenCode adapter for a session.
     */
    getDockerAdapter(sessionId: string): DockerOpenCodeAdapter | undefined {
        return this.dockerAdapters.get(sessionId)?.adapter;
    }

    /**
     * Get the Claude Code SDK adapter for a session.
     * Returns existing adapter from memory, or undefined if not found.
     * Use getOrRecreateClaudeCodeSdkAdapter for serverless environments.
     */
    getClaudeCodeSdkAdapter(sessionId: string): ClaudeCodeSdkAdapter | undefined {
        return this.claudeCodeSdkAdapters.get(sessionId)?.adapter;
    }

    respondToClaudeCodeSdkUserInput(
        sessionId: string,
        toolUseId: string,
        updatedInput: Record<string, unknown>,
    ): boolean {
        const adapter = this.claudeCodeSdkAdapters.get(sessionId)?.adapter;
        if (!adapter) {
            return false;
        }
        return adapter.respondToUserInput(toolUseId, updatedInput);
    }

    /**
     * Get the Workspace Agent adapter for a session.
     */
    getWorkspaceAgent(sessionId: string): WorkspaceAgentAdapter | undefined {
        return this.workspaceAgents.get(sessionId)?.adapter;
    }

    /**
     * Get or recreate a Claude Code SDK adapter for serverless environments.
     * If the session exists in HTTP store or database with provider 'claude-code-sdk' but
     * the adapter is not in memory (due to serverless cold start), recreate it.
     */
    async getOrRecreateClaudeCodeSdkAdapter(
        sessionId: string,
        onNotification: NotificationHandler
    ): Promise<ClaudeCodeSdkAdapter | undefined> {
        // First check if adapter is already in memory
        const existing = this.claudeCodeSdkAdapters.get(sessionId)?.adapter;
        if (existing) {
            return existing;
        }

        // Check HTTP session store for session metadata
        const store = getHttpSessionStore();
        const sessionRecord = store.getSession(sessionId);
        let cwd = sessionRecord?.cwd;
        let provider = sessionRecord?.provider;

        // If not in HTTP store (serverless cold start), try to recover from database
        if (!sessionRecord && isServerlessEnvironment() && getDatabaseDriver() === "postgres") {
            console.log(`[AcpProcessManager] Session not in HTTP store, checking database: ${sessionId}`);
            try {
                const db = getPostgresDatabase();
                const pgStore = new PgAcpSessionStore(db);
                const dbSession = await pgStore.get(sessionId);
                if (dbSession) {
                    cwd = dbSession.cwd;
                    provider = dbSession.provider;
                    console.log(`[AcpProcessManager] Found session in database: provider=${provider}, cwd=${cwd}`);

                    // Restore to HTTP session store for future requests in this instance
                    store.upsertSession({
                        sessionId,
                        cwd: dbSession.cwd,
                        workspaceId: dbSession.workspaceId,
                        routaAgentId: dbSession.routaAgentId,
                        provider: dbSession.provider,
                        role: dbSession.role,
                        modeId: dbSession.modeId,
                        createdAt: dbSession.createdAt.toISOString(),
                        firstPromptSent: dbSession.firstPromptSent,
                    });
                }
            } catch (err) {
                console.error(`[AcpProcessManager] Failed to query database:`, err);
            }
        }

        if (!cwd || provider !== "claude-code-sdk") {
            return undefined;
        }

        // Session exists but adapter not in memory - recreate it
        console.log(`[AcpProcessManager] Recreating Claude Code SDK adapter for session: ${sessionId}`);

        const adapter = new ClaudeCodeSdkAdapter(cwd, onNotification);
        await adapter.connect();
        // Use existing session ID instead of creating new one
        const acpSessionId = await adapter.createSession(`Routa Session ${sessionId}`);

        this.claudeCodeSdkAdapters.set(sessionId, {
            adapter,
            acpSessionId,
            presetId: "claude-code-sdk",
            createdAt: new Date(),
        });

        console.log(`[AcpProcessManager] Claude Code SDK adapter recreated: ${acpSessionId}`);
        return adapter;
    }

    /**
     * Check if a session is a Claude Code session (process-based).
     */
    isClaudeSession(sessionId: string): boolean {
        return this.claudeProcesses.has(sessionId);
    }

    /**
     * Check if a session is using Claude Code SDK adapter (sync version).
     * Only checks in-memory and HTTP session store.
     * Use isClaudeCodeSdkSessionAsync for full serverless support with database check.
     */
    isClaudeCodeSdkSession(sessionId: string): boolean {
        // First check in-memory
        if (this.claudeCodeSdkAdapters.has(sessionId)) {
            return true;
        }

        // Check HTTP session store (session might exist but adapter not in memory)
        const store = getHttpSessionStore();
        const sessionRecord = store.getSession(sessionId);
        if (sessionRecord?.provider === "claude-code-sdk") {
            return true;
        }

        return false;
    }

    /**
     * Check if a session is using Claude Code SDK adapter (async version).
     * In serverless environments, also checks database for persisted sessions.
     */
    async isClaudeCodeSdkSessionAsync(sessionId: string): Promise<boolean> {
        // First check in-memory
        if (this.claudeCodeSdkAdapters.has(sessionId)) {
            return true;
        }

        // Check HTTP session store
        const store = getHttpSessionStore();
        const sessionRecord = store.getSession(sessionId);
        if (sessionRecord?.provider === "claude-code-sdk") {
            return true;
        }

        // In serverless with Postgres, check database
        if (isServerlessEnvironment() && getDatabaseDriver() === "postgres") {
            try {
                const db = getPostgresDatabase();
                const pgStore = new PgAcpSessionStore(db);
                const dbSession = await pgStore.get(sessionId);
                return dbSession?.provider === "claude-code-sdk";
            } catch (err) {
                console.error(`[AcpProcessManager] Failed to check session in database:`, err);
            }
        }

        return false;
    }

    /**
     * Check if a session is using OpenCode SDK adapter (sync version).
     * Checks in-memory and HTTP session store.
     */
    isOpencodeAdapterSession(sessionId: string): boolean {
        // First check in-memory
        if (this.opencodeAdapters.has(sessionId)) {
            return true;
        }

        // Check HTTP session store (session might exist but adapter not in memory)
        const store = getHttpSessionStore();
        const sessionRecord = store.getSession(sessionId);
        if (sessionRecord?.provider === "opencode-sdk") {
            return true;
        }

        return false;
    }

    /**
     * Check if a session is using Docker OpenCode adapter.
     */
    isDockerAdapterSession(sessionId: string): boolean {
        if (this.dockerAdapters.has(sessionId)) {
            return true;
        }

        const store = getHttpSessionStore();
        const sessionRecord = store.getSession(sessionId);
        return sessionRecord?.provider === "docker-opencode";
    }

    /**
     * Check if a session is using OpenCode SDK adapter (async version).
     * In serverless environments, also checks database for persisted sessions.
     */
    async isOpencodeSdkSessionAsync(sessionId: string): Promise<boolean> {
        // First check in-memory
        if (this.opencodeAdapters.has(sessionId)) {
            return true;
        }

        // Check HTTP session store
        const store = getHttpSessionStore();
        const sessionRecord = store.getSession(sessionId);
        if (sessionRecord?.provider === "opencode-sdk") {
            return true;
        }

        // In serverless with Postgres, check database
        if (isServerlessEnvironment() && getDatabaseDriver() === "postgres") {
            try {
                const db = getPostgresDatabase();
                const pgStore = new PgAcpSessionStore(db);
                const dbSession = await pgStore.get(sessionId);
                return dbSession?.provider === "opencode-sdk";
            } catch (err) {
                console.error(`[AcpProcessManager] Failed to check OpenCode session in database:`, err);
            }
        }

        return false;
    }

    /**
     * Get or recreate an OpenCode SDK adapter for serverless environments.
     * If the session exists in HTTP store or database with provider 'opencode-sdk' but
     * the adapter is not in memory (due to serverless cold start), recreate it.
     */
    async getOrRecreateOpencodeSdkAdapter(
        sessionId: string,
        onNotification: NotificationHandler
    ): Promise<OpencodeSdkAdapter | OpencodeSdkDirectAdapter | undefined> {
        // First check if adapter is already in memory
        const existing = this.opencodeAdapters.get(sessionId)?.adapter;
        if (existing) {
            return existing;
        }

        // Check HTTP session store for session metadata
        const store = getHttpSessionStore();
        const sessionRecord = store.getSession(sessionId);
        let provider = sessionRecord?.provider;

        // If not in HTTP store (serverless cold start), try to recover from database
        if (!sessionRecord && isServerlessEnvironment() && getDatabaseDriver() === "postgres") {
            console.log(`[AcpProcessManager] OpenCode session not in HTTP store, checking database: ${sessionId}`);
            try {
                const db = getPostgresDatabase();
                const pgStore = new PgAcpSessionStore(db);
                const dbSession = await pgStore.get(sessionId);
                if (dbSession) {
                    provider = dbSession.provider;
                    console.log(`[AcpProcessManager] Found OpenCode session in database: provider=${provider}`);

                    // Restore to HTTP session store
                    store.upsertSession({
                        sessionId,
                        cwd: dbSession.cwd,
                        workspaceId: dbSession.workspaceId,
                        routaAgentId: dbSession.routaAgentId,
                        provider: dbSession.provider,
                        role: dbSession.role,
                        modeId: dbSession.modeId,
                        createdAt: dbSession.createdAt.toISOString(),
                        firstPromptSent: dbSession.firstPromptSent,
                    });
                }
            } catch (err) {
                console.error(`[AcpProcessManager] Failed to query database:`, err);
            }
        }

        if (provider !== "opencode-sdk" || !isOpencodeServerConfigured()) {
            return undefined;
        }

        // Session exists but adapter not in memory - recreate it
        console.log(`[AcpProcessManager] Recreating OpenCode SDK adapter for session: ${sessionId}`);

        const serverUrl = getOpencodeServerUrl();
        let adapter: OpencodeSdkAdapter | OpencodeSdkDirectAdapter;

        if (serverUrl) {
            adapter = new OpencodeSdkAdapter(serverUrl, onNotification);
        } else {
            adapter = new OpencodeSdkDirectAdapter(onNotification);
        }

        await adapter.connect();
        const acpSessionId = await adapter.createSession(`Routa Session ${sessionId}`);

        this.opencodeAdapters.set(sessionId, {
            adapter,
            acpSessionId,
            presetId: "opencode-sdk",
            createdAt: new Date(),
        });

        console.log(`[AcpProcessManager] OpenCode SDK adapter recreated: ${acpSessionId}`);
        return adapter;
    }

    /**
     * Get the agent's ACP session ID for our session.
     */
    getAcpSessionId(sessionId: string): string | undefined {
        return (
            this.processes.get(sessionId)?.acpSessionId ??
            this.claudeProcesses.get(sessionId)?.acpSessionId ??
            this.opencodeAdapters.get(sessionId)?.acpSessionId ??
            this.dockerAdapters.get(sessionId)?.acpSessionId ??
            this.claudeCodeSdkAdapters.get(sessionId)?.acpSessionId ??
            this.workspaceAgents.get(sessionId)?.acpSessionId
        );
    }

    /**
     * Get the preset ID used for a session.
     */
    getPresetId(sessionId: string): string | undefined {
        return (
            this.processes.get(sessionId)?.presetId ??
            this.claudeProcesses.get(sessionId)?.presetId ??
            this.opencodeAdapters.get(sessionId)?.presetId ??
            this.dockerAdapters.get(sessionId)?.presetId ??
            this.claudeCodeSdkAdapters.get(sessionId)?.presetId ??
            this.workspaceAgents.get(sessionId)?.presetId
        );
    }

    /**
     * List all active sessions (ACP, Claude Code, OpenCode SDK, and Claude Code SDK).
     */
    listSessions(): Array<{
        sessionId: string;
        acpSessionId: string;
        presetId: string;
        alive: boolean;
        createdAt: Date;
    }> {
        const acpSessions = Array.from(this.processes.entries()).map(([sessionId, managed]) => ({
            sessionId,
            acpSessionId: managed.acpSessionId,
            presetId: managed.presetId,
            alive: managed.process.alive,
            createdAt: managed.createdAt,
        }));

        const claudeSessions = Array.from(this.claudeProcesses.entries()).map(([sessionId, managed]) => ({
            sessionId,
            acpSessionId: managed.acpSessionId,
            presetId: managed.presetId,
            alive: managed.process.alive,
            createdAt: managed.createdAt,
        }));

        const adapterSessions = Array.from(this.opencodeAdapters.entries()).map(([sessionId, managed]) => ({
            sessionId,
            acpSessionId: managed.acpSessionId,
            presetId: managed.presetId,
            alive: managed.adapter.alive,
            createdAt: managed.createdAt,
        }));

        const claudeCodeSdkSessions = Array.from(this.claudeCodeSdkAdapters.entries()).map(([sessionId, managed]) => ({
            sessionId,
            acpSessionId: managed.acpSessionId,
            presetId: managed.presetId,
            alive: managed.adapter.alive,
            createdAt: managed.createdAt,
        }));

        const dockerSessions = Array.from(this.dockerAdapters.entries()).map(([sessionId, managed]) => ({
            sessionId,
            acpSessionId: managed.acpSessionId,
            presetId: managed.presetId,
            alive: managed.adapter.alive,
            createdAt: managed.createdAt,
        }));

        const workspaceAgentSessions = Array.from(this.workspaceAgents.entries()).map(([sessionId, managed]) => ({
            sessionId,
            acpSessionId: managed.acpSessionId,
            presetId: managed.presetId,
            alive: managed.adapter.alive,
            createdAt: managed.createdAt,
        }));

        return [...acpSessions, ...claudeSessions, ...adapterSessions, ...dockerSessions, ...claudeCodeSdkSessions, ...workspaceAgentSessions];
    }

    /**
     * Kill a session's agent process or adapter.
     */
    killSession(sessionId: string): void {
        const managed = this.processes.get(sessionId);
        if (managed) {
            managed.process.kill();
            this.processes.delete(sessionId);
            return;
        }

        const claudeManaged = this.claudeProcesses.get(sessionId);
        if (claudeManaged) {
            claudeManaged.process.kill();
            this.claudeProcesses.delete(sessionId);
            return;
        }

        const adapterManaged = this.opencodeAdapters.get(sessionId);
        if (adapterManaged) {
            adapterManaged.adapter.kill();
            this.opencodeAdapters.delete(sessionId);
            return;
        }

        const dockerManaged = this.dockerAdapters.get(sessionId);
        if (dockerManaged) {
            dockerManaged.adapter.kill();
            this.dockerAdapters.delete(sessionId);
            getDockerProcessManager().stopContainer(sessionId).catch(() => {});
            return;
        }

        const claudeCodeSdkManaged = this.claudeCodeSdkAdapters.get(sessionId);
        if (claudeCodeSdkManaged) {
            claudeCodeSdkManaged.adapter.kill();
            this.claudeCodeSdkAdapters.delete(sessionId);
            return;
        }

        const workspaceManaged = this.workspaceAgents.get(sessionId);
        if (workspaceManaged) {
            workspaceManaged.adapter.kill();
            this.workspaceAgents.delete(sessionId);
        }
    }

    /**
     * Kill all processes and adapters.
     */
    killAll(): void {
        for (const [, managed] of this.processes) {
            managed.process.kill();
        }
        this.processes.clear();

        for (const [, managed] of this.claudeProcesses) {
            managed.process.kill();
        }
        this.claudeProcesses.clear();

        for (const [, managed] of this.opencodeAdapters) {
            managed.adapter.kill();
        }
        this.opencodeAdapters.clear();

        for (const [, managed] of this.dockerAdapters) {
            managed.adapter.kill();
        }
        this.dockerAdapters.clear();
        getDockerProcessManager().stopAll().catch(() => {});

        for (const [, managed] of this.claudeCodeSdkAdapters) {
            managed.adapter.kill();
        }
        this.claudeCodeSdkAdapters.clear();

        for (const [, managed] of this.workspaceAgents) {
            managed.adapter.kill();
        }
        this.workspaceAgents.clear();
    }
}
