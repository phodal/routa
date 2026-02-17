import {AcpProcess} from "@/core/acp/acp-process";
import {buildConfigFromPreset, ManagedProcess, NotificationHandler} from "@/core/acp/processer";
import {ClaudeCodeProcess, buildClaudeCodeConfig, mapClaudeModeToPermissionMode} from "@/core/acp/claude-code-process";
import {ensureMcpForProvider, providerSupportsMcp} from "@/core/acp/mcp-setup";
import {OpencodeSdkAdapter, shouldUseOpencodeAdapter, getOpencodeServerUrl} from "@/core/acp/opencode-sdk-adapter";

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
    adapter: OpencodeSdkAdapter;
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
        extraEnv?: Record<string, string>
    ): Promise<string> {
        // Check if we should use OpenCode SDK adapter (serverless + configured)
        if (presetId === "opencode" && shouldUseOpencodeAdapter()) {
            return this.createOpencodeAdapterSession(sessionId, onNotification);
        }

        // Setup MCP: writes config files and/or returns CLI args
        let mcpConfigs: string[] | undefined;
        if (providerSupportsMcp(presetId)) {
            const mcpResult = ensureMcpForProvider(presetId);
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
     * Create a session using OpenCode SDK adapter (for serverless environments).
     */
    private async createOpencodeAdapterSession(
        sessionId: string,
        onNotification: NotificationHandler
    ): Promise<string> {
        const serverUrl = getOpencodeServerUrl();
        if (!serverUrl) {
            throw new Error("OPENCODE_SERVER_URL not configured");
        }

        console.log(`[AcpProcessManager] Using OpenCode SDK adapter for serverless environment`);
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

    /**
     * Spawn a new Claude Code process with stream-json mode.
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
    getOpencodeAdapter(sessionId: string): OpencodeSdkAdapter | undefined {
        return this.opencodeAdapters.get(sessionId)?.adapter;
    }

    /**
     * Check if a session is a Claude Code session.
     */
    isClaudeSession(sessionId: string): boolean {
        return this.claudeProcesses.has(sessionId);
    }

    /**
     * Check if a session is using OpenCode SDK adapter.
     */
    isOpencodeAdapterSession(sessionId: string): boolean {
        return this.opencodeAdapters.has(sessionId);
    }

    /**
     * Get the agent's ACP session ID for our session.
     */
    getAcpSessionId(sessionId: string): string | undefined {
        return (
            this.processes.get(sessionId)?.acpSessionId ??
            this.claudeProcesses.get(sessionId)?.acpSessionId ??
            this.opencodeAdapters.get(sessionId)?.acpSessionId
        );
    }

    /**
     * Get the preset ID used for a session.
     */
    getPresetId(sessionId: string): string | undefined {
        return (
            this.processes.get(sessionId)?.presetId ??
            this.claudeProcesses.get(sessionId)?.presetId ??
            this.opencodeAdapters.get(sessionId)?.presetId
        );
    }

    /**
     * List all active sessions (ACP, Claude Code, and OpenCode SDK).
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

        return [...acpSessions, ...claudeSessions, ...adapterSessions];
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
    }
}