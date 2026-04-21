import { getServerBridge } from "@/core/platform";
import type { NotificationHandler } from "@/core/acp/protocol-types";
import os from "os";
import path from "path";
import fsSync from "fs";
import {
  DEFAULT_DOCKER_AGENT_IMAGE,
  findAvailablePort,
  generateContainerName,
  sanitizeEnvForLogging,
  shellEscape,
} from "./utils";
import type { DockerContainerConfig, DockerContainerInfo } from "./types";

// Temporary directory for storing auth.json files
const DOCKER_OPENCODE_TMP_DIR = path.join(os.tmpdir(), "routa-opencode-auth");

const DEFAULT_CONTAINER_PORT = 4321;
const DEFAULT_HEALTH_TIMEOUT_MS = 30_000;
const CONTAINER_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface PersistentContainerInfo extends DockerContainerInfo {
  lastUsedAt: Date;
  sessionCount: number;
}

export class DockerProcessManager {
  private static instance: DockerProcessManager | null = null;
  private containers = new Map<string, DockerContainerInfo>();
  private usedPorts = new Set<number>();

  // Container reuse support
  private persistentContainer: PersistentContainerInfo | null = null;
  private idleTimeoutHandle: NodeJS.Timeout | null = null;

  static getInstance(): DockerProcessManager {
    if (!DockerProcessManager.instance) {
      DockerProcessManager.instance = new DockerProcessManager();
    }
    return DockerProcessManager.instance;
  }

  listContainers(): DockerContainerInfo[] {
    return Array.from(this.containers.values());
  }

  getContainer(sessionId: string): DockerContainerInfo | undefined {
    return this.containers.get(sessionId);
  }

  /**
   * Acquire a container for a session, reusing the persistent container if healthy.
   * This is the main entry point for container lifecycle management with reuse support.
   */
  async acquireContainer(config: DockerContainerConfig): Promise<DockerContainerInfo> {
    // Try to reuse persistent container if available and healthy
    if (this.persistentContainer && await this.isContainerHealthy(this.persistentContainer)) {
      console.log(
        `[DockerProcessManager] Reusing persistent container ${this.persistentContainer.containerName} ` +
        `for session ${config.sessionId} (sessions: ${this.persistentContainer.sessionCount + 1})`
      );

      // Update session tracking
      this.persistentContainer.lastUsedAt = new Date();
      this.persistentContainer.sessionCount++;

      // Map this session to the persistent container
      const sessionInfo: DockerContainerInfo = {
        ...this.persistentContainer,
        sessionId: config.sessionId,
      };
      this.containers.set(config.sessionId, sessionInfo);

      // Cancel idle timeout since container is now in use
      this.cancelIdleTimeout();

      return sessionInfo;
    }

    // If a persistent container exists but is not healthy, clean it up
    if (this.persistentContainer) {
      this.cleanupPersistentContainer();
    }

    // No healthy persistent container available, start a new one
    return this.startContainer(config);
  }

  /**
   * Check if a container is healthy by querying its health endpoint.
   */
  private async isContainerHealthy(info: DockerContainerInfo): Promise<boolean> {
    try {
      const healthUrl = `http://127.0.0.1:${info.hostPort}/health`;
      const res = await fetch(healthUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(3000), // 3 second timeout
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Clean up tracking and resources for the current persistent container.
   * This is used when the persistent container is no longer healthy and
   * we need to start a replacement.
   */
  private cleanupPersistentContainer(): void {
    if (!this.persistentContainer) {
      return;
    }

    // Cancel any pending idle timeout associated with the old persistent container
    this.cancelIdleTimeout();

    // Remove any sessions mapped to this persistent container
    for (const [sessionId, info] of this.containers.entries()) {
      if (info.containerName === this.persistentContainer.containerName) {
        this.containers.delete(sessionId);
      }
    }

    // Release the port used by the old persistent container
    this.usedPorts.delete(this.persistentContainer.hostPort);

    // Clear the persistent container reference
    this.persistentContainer = null;
  }

  /**
   * Start a new idle timeout for the persistent container.
   */
  private scheduleIdleTimeout(): void {
    this.cancelIdleTimeout();

    this.idleTimeoutHandle = setTimeout(async () => {
      if (this.persistentContainer) {
        const idleTime = Date.now() - this.persistentContainer.lastUsedAt.getTime();
        console.log(
          `[DockerProcessManager] Persistent container ${this.persistentContainer.containerName} ` +
          `idle for ${Math.floor(idleTime / 1000)}s, stopping...`
        );
        await this.stopPersistentContainer().catch((err) => {
          console.error(`[DockerProcessManager] Failed to stop idle container:`, err);
        });
      }
    }, CONTAINER_IDLE_TIMEOUT_MS);
  }

  /**
   * Cancel the idle timeout if it exists.
   */
  private cancelIdleTimeout(): void {
    if (this.idleTimeoutHandle) {
      clearTimeout(this.idleTimeoutHandle);
      this.idleTimeoutHandle = null;
    }
  }

  /**
   * Stop the persistent container and clean up resources.
   */
  private async stopPersistentContainer(): Promise<void> {
    if (!this.persistentContainer) return;

    const bridge = getServerBridge();
    const containerName = this.persistentContainer.containerName;

    try {
      await bridge.process.exec(`docker stop -t 10 ${shellEscape(containerName)}`, { timeout: 15_000 });
    } catch {
      try {
        await bridge.process.exec(`docker kill ${shellEscape(containerName)}`, { timeout: 8_000 });
      } catch {
        // Ignore kill failure
      }
    }

    try {
      await bridge.process.exec(`docker rm -f ${shellEscape(containerName)}`, { timeout: 8_000 });
    } catch {
      // Ignore cleanup failure
    }

    this.usedPorts.delete(this.persistentContainer.hostPort);
    this.persistentContainer = null;
    this.cancelIdleTimeout();

    console.log(`[DockerProcessManager] Stopped persistent container ${containerName}`);
  }

  async startContainer(config: DockerContainerConfig): Promise<DockerContainerInfo> {
    const bridge = getServerBridge();
    const containerPort = config.containerPort ?? DEFAULT_CONTAINER_PORT;
    const hostPort = await findAvailablePort(this.usedPorts);
    const containerName = generateContainerName(config.sessionId);

    const labels = {
      "routa.managed": "true",
      "routa.session": config.sessionId,
      ...(config.labels ?? {}),
    };

    const envEntries = Object.entries(config.env ?? {}).filter(([, value]) => typeof value === "string") as Array<[string, string]>;
    const sanitizedEnv = sanitizeEnvForLogging(config.env);

    const runParts: string[] = [
      "docker run -d",
      "--rm",
      `--name ${shellEscape(containerName)}`,
      `-p ${hostPort}:${containerPort}`,
      // Resource limits to prevent runaway processes
      "--memory", "2g",
      "--cpus", "2",
      "--pids-limit", "100",
      // Allow the container to reach the host machine (e.g. for MCP at localhost:PORT).
      // On Docker Desktop (Mac/Windows) this resolves automatically; on Linux we
      // need to explicitly map the host-gateway alias.
      "--add-host=host.docker.internal:host-gateway",
      "-w /workspace",
      `-v ${shellEscape(`${config.workspacePath}:/workspace`)}`,
    ];

    // Mount host SSH keys so git SSH operations (clone, push, pull) work inside
    // the container. Mounted read-only to avoid accidental modification.
    const sshDir = path.join(os.homedir(), ".ssh");
    if (fsSync.existsSync(sshDir)) {
      runParts.push(`-v ${shellEscape(`${sshDir}:/root/.ssh:ro`)}`);
    }

    // Mount host git config so commits carry the correct author identity and
    // credential helpers are available for HTTPS operations.
    const gitConfigFile = path.join(os.homedir(), ".gitconfig");
    if (fsSync.existsSync(gitConfigFile)) {
      runParts.push(`-v ${shellEscape(`${gitConfigFile}:/root/.gitconfig:ro`)}`);
    }

    // Derive the Routa MCP URL that is reachable from inside the container.
    // host.docker.internal resolves to the host machine; PORT is the Next.js port.
    const routaPort = process.env.PORT || "3000";
    const routaMcpUrl = `http://host.docker.internal:${routaPort}/api/mcp`;
    runParts.push(`-e ${shellEscape(`ROUTA_MCP_URL=${routaMcpUrl}`)}`);

    // Forward GitHub token for HTTPS git authentication when available.
    if (process.env.GITHUB_TOKEN) {
      runParts.push(`-e GITHUB_TOKEN=${shellEscape(process.env.GITHUB_TOKEN)}`);
    }

    // Forward common AI provider API keys from the host so that the opencode
    // agent can authenticate against Anthropic / OpenAI / etc. without the user
    // having to re-configure credentials inside the container.
    const providerKeyVars = [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "OPENAI_API_KEY",
      "OPENAI_API_BASE",
      "OPENAI_BASE_URL",
      "GEMINI_API_KEY",
      "OPENROUTER_API_KEY",
      "XAI_API_KEY",
      "AZURE_OPENAI_API_KEY",
      "AZURE_OPENAI_ENDPOINT",
    ];
    for (const key of providerKeyVars) {
      if (process.env[key]) {
        runParts.push(`-e ${shellEscape(`${key}=${process.env[key]}`)}`);
      }
    }

    for (const [key, value] of Object.entries(labels)) {
      runParts.push(`--label ${shellEscape(`${key}=${value}`)}`);
    }

    for (const volume of config.additionalVolumes ?? []) {
      runParts.push(`-v ${shellEscape(`${volume.hostPath}:${volume.containerPath}`)}`);
    }

    for (const [key, value] of envEntries) {
      runParts.push(`-e ${shellEscape(`${key}=${value}`)}`);
    }

    // Mount auth.json if provided — write to temp file and bind-mount into container
    if (config.authJson?.trim()) {
      try {
        fsSync.mkdirSync(DOCKER_OPENCODE_TMP_DIR, { recursive: true });
        const authJsonTempFile = path.join(DOCKER_OPENCODE_TMP_DIR, `auth-${config.sessionId}.json`);
        fsSync.writeFileSync(authJsonTempFile, config.authJson, "utf-8");
        // Opencode reads from ~/.local/share/opencode/auth.json
        runParts.push(`-v ${shellEscape(`${authJsonTempFile}:/root/.local/share/opencode/auth.json:ro`)}`);
        console.log(`[DockerProcessManager] Mounted auth.json from ${authJsonTempFile}`);
      } catch (err) {
        console.error(`[DockerProcessManager] Failed to write auth.json: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    runParts.push(shellEscape(config.image || DEFAULT_DOCKER_AGENT_IMAGE));

    const runCommand = runParts.join(" ");

    try {
      const { stdout } = await bridge.process.exec(runCommand, { timeout: 30_000 });
      const containerId = stdout.trim();

      const info: DockerContainerInfo = {
        sessionId: config.sessionId,
        containerId,
        containerName,
        hostPort,
        containerPort,
        image: config.image || DEFAULT_DOCKER_AGENT_IMAGE,
        workspacePath: config.workspacePath,
        createdAt: new Date(),
      };

      this.containers.set(config.sessionId, info);
      this.usedPorts.add(hostPort);

      // Set as persistent container for reuse
      this.persistentContainer = {
        ...info,
        lastUsedAt: new Date(),
        sessionCount: 1,
      };

      console.log(
        `[DockerProcessManager] Started container ${containerName} on port ${hostPort} ` +
        `(image: ${info.image}, env: ${JSON.stringify(sanitizedEnv)}, reusable: true)`
      );

      return info;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to start Docker container: ${message}`, { cause: err });
    }
  }

  async waitForHealthy(
    sessionId: string,
    timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
    onProgress?: NotificationHandler,
  ): Promise<void> {
    const info = this.containers.get(sessionId);
    if (!info) {
      throw new Error(`No managed Docker container for session ${sessionId}`);
    }

    const emitLog = (text: string) => {
      if (!onProgress) return;
      onProgress({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "process_output",
            source: "docker",
            data: text,
            displayName: "Docker",
          },
        },
      });
    };

    const start = Date.now();
    const healthUrl = `http://127.0.0.1:${info.hostPort}/health`;
    let lastTickSec = -1;

    emitLog(`Starting container ${info.containerName} on port ${info.hostPort}...\r\n`);

    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(healthUrl, { cache: "no-store" });
        if (res.ok) {
          emitLog(`Container is healthy ✓\r\n`);
          return;
        }
      } catch {
        // Ignore transient startup failures while container is booting.
      }

      const elapsed = Math.floor((Date.now() - start) / 1000);
      if (elapsed !== lastTickSec && elapsed % 3 === 0) {
        lastTickSec = elapsed;
        // Stream recent container logs every 3 seconds
        try {
          const bridge = getServerBridge();
          const { stdout, stderr } = await bridge.process.exec(
            `docker logs --tail 10 ${shellEscape(info.containerName)}`,
            { timeout: 3_000 },
          );
          const combined = (stdout + stderr).trim();
          if (combined) {
            emitLog(combined + "\r\n");
          } else {
            emitLog(`Waiting for container health check... (${elapsed}s)\r\n`);
          }
        } catch {
          emitLog(`Waiting for container health check... (${elapsed}s)\r\n`);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    const logs = await this.getContainerLogs(info.containerName);
    throw new Error(
      `Docker container health check timeout after ${timeoutMs}ms for ${info.containerName}. ` +
      `Health endpoint: ${healthUrl}. Logs:\n${logs}`
    );
  }

  async stopContainer(sessionId: string): Promise<void> {
    const info = this.containers.get(sessionId);
    if (!info) return;

    // Remove session mapping
    this.containers.delete(sessionId);

    // If this is the persistent container, only schedule idle timeout when the last session ends
    if (this.persistentContainer && info.containerName === this.persistentContainer.containerName) {
      // Check if any other session is still using this persistent container
      const hasOtherSessionsForPersistent = Array.from(this.containers.values()).some(
        (c) => c.containerName === info.containerName,
      );

      if (hasOtherSessionsForPersistent) {
        console.log(
          `[DockerProcessManager] Session ${sessionId} ended, persistent container ${info.containerName} ` +
          `still has active sessions; not scheduling idle timeout.`,
        );
        return;
      }

      // At this point the persistent container is actually idle
      console.log(
        `[DockerProcessManager] Session ${sessionId} ended, persistent container ${info.containerName} is now idle; ` +
        `scheduling idle timeout for reuse (idle timeout: ${CONTAINER_IDLE_TIMEOUT_MS / 1000}s)`,
      );

      // Update lastUsedAt when the persistent container becomes idle
      this.persistentContainer.lastUsedAt = new Date();
      this.scheduleIdleTimeout();
      return;
    }

    // Non-persistent container, stop it immediately
    const bridge = getServerBridge();

    try {
      await bridge.process.exec(`docker stop -t 10 ${shellEscape(info.containerName)}`, { timeout: 15_000 });
    } catch {
      try {
        await bridge.process.exec(`docker kill ${shellEscape(info.containerName)}`, { timeout: 8_000 });
      } catch {
        // Ignore kill failure; rm -f below is best effort.
      }
    }

    try {
      await bridge.process.exec(`docker rm -f ${shellEscape(info.containerName)}`, { timeout: 8_000 });
    } catch {
      // Ignore cleanup failure for already-removed containers.
    }

    this.usedPorts.delete(info.hostPort);
  }

  async stopAll(): Promise<void> {
    const ids = Array.from(this.containers.keys());
    for (const sessionId of ids) {
      await this.stopContainer(sessionId);
    }

    // Also stop the persistent container
    await this.stopPersistentContainer();

    this.containers.clear();
    this.usedPorts.clear();
  }

  private async getContainerLogs(containerName: string): Promise<string> {
    const bridge = getServerBridge();
    try {
      const { stdout, stderr } = await bridge.process.exec(
        `docker logs --tail 200 ${shellEscape(containerName)}`,
        { timeout: 5_000 },
      );
      return `${stdout}${stderr ? `\n${stderr}` : ""}`.trim();
    } catch (err) {
      return `Failed to read logs: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

export function getDockerProcessManager(): DockerProcessManager {
  return DockerProcessManager.getInstance();
}
