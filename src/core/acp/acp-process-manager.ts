import {AcpProcess} from "@/core/acp/acp-process";
import {buildConfigFromPreset, ManagedProcess, NotificationHandler} from "@/core/acp/processer";
import {ClaudeCodeProcess, buildClaudeCodeConfig, mapClaudeModeToPermissionMode} from "@/core/acp/claude-code-process";

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
 * Singleton manager for ACP agent processes.
 * Maps our session IDs to ACP process instances.
 * Supports spawning different agent types via presets, including Claude Code.
 */
export class AcpProcessManager {
    private processes = new Map<string, ManagedProcess>();
    private claudeProcesses = new Map<string, ManagedClaudeProcess>();

    /**
     * Spawn a new ACP agent process, initialize the protocol, and create a session.
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
        const config = buildConfigFromPreset(presetId, cwd, extraArgs, extraEnv);
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
     * Spawn a new Claude Code process with stream-json mode.
     *
     * @param sessionId - Our internal session ID
     * @param cwd - Working directory
     * @param onNotification - Handler for translated session/update notifications
     * @param mcpConfigs - MCP config JSON strings to pass to Claude Code
     * @param extraEnv - Additional environment variables
     * @returns A synthetic session ID for Claude Code
     */
    async createClaudeSession(
        sessionId: string,
        cwd: string,
        onNotification: NotificationHandler,
        mcpConfigs?: string[],
        modeId?: string,
        extraEnv?: Record<string, string>,
    ): Promise<string> {
        const permissionMode = mapClaudeModeToPermissionMode(modeId);
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
     * Check if a session is a Claude Code session.
     */
    isClaudeSession(sessionId: string): boolean {
        return this.claudeProcesses.has(sessionId);
    }

    /**
     * Get the agent's ACP session ID for our session.
     */
    getAcpSessionId(sessionId: string): string | undefined {
        return (
            this.processes.get(sessionId)?.acpSessionId ??
            this.claudeProcesses.get(sessionId)?.acpSessionId
        );
    }

    /**
     * Get the preset ID used for a session.
     */
    getPresetId(sessionId: string): string | undefined {
        return (
            this.processes.get(sessionId)?.presetId ??
            this.claudeProcesses.get(sessionId)?.presetId
        );
    }

    /**
     * List all active sessions (both ACP and Claude Code).
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

        return [...acpSessions, ...claudeSessions];
    }

    /**
     * Kill a session's agent process.
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
        }
    }

    /**
     * Kill all processes.
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
    }
}