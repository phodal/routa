import { getServerBridge } from "@/core/platform";
import { which } from "@/core/acp/utils";
import type { DockerPullResult, DockerStatus } from "./types";

const CACHE_TTL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Find docker executable on Windows by checking standard installation paths,
 * since Docker Desktop typically installs outside the system PATH.
 */
async function findDockerOnWindows(bridge: ReturnType<typeof getServerBridge>): Promise<string | null> {
  if (bridge.env.osPlatform() !== "win32") return null;

  // Common Windows Docker Desktop installation paths
  const programFilesDirs = [
    process.env["ProgramFiles"] ?? "C:\\Program Files",
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
  ];

  const candidates = [
    "\\Docker\\Docker\\resources\\bin\\docker.exe",
  ];

  for (const base of programFilesDirs) {
    for (const suffix of candidates) {
      const fullPath = base + suffix;
      try {
        const stat = bridge.fs.statSync(fullPath);
        if (stat.isFile) return fullPath;
      } catch {
        // Not found at this path, continue
      }
    }
  }

  return null;
}

function execDockerInfo(bridge: ReturnType<typeof getServerBridge>, dockerPath: string | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const isWindows = bridge.env.osPlatform() === "win32";

    if (dockerPath) {
      // Use resolved absolute path — no shell needed for .exe files
      const args = ["info", "--format", "{{json .}}"];
      const handle = bridge.process.spawn(dockerPath, args);
      let stdout = "";
      let stderr = "";

      const timer = setTimeout(() => {
        handle.kill();
        reject(new Error("docker info timed out"));
      }, DEFAULT_TIMEOUT_MS);

      handle.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf-8");
      });
      handle.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
      });
      handle.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr || `docker exited with code ${code}`));
      });
      handle.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    } else if (isWindows) {
      // On Windows with no resolved path, use shell so cmd.exe searches PATH
      const handle = bridge.process.spawn("docker", ["info", "--format", "{{json .}}"], {
        shell: true,
      });
      let stdout = "";
      let stderr = "";

      const timer = setTimeout(() => {
        handle.kill();
        reject(new Error("docker info timed out"));
      }, DEFAULT_TIMEOUT_MS);

      handle.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf-8");
      });
      handle.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
      });
      handle.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr || `docker exited with code ${code}`));
      });
      handle.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    } else {
      // Unix: PATH should be inherited correctly
      bridge.process.exec("docker info --format '{{json .}}'", { timeout: DEFAULT_TIMEOUT_MS })
        .then(({ stdout: out }) => resolve(out))
        .catch(reject);
    }
  });
}

export class DockerDetector {
  private static instance: DockerDetector | null = null;
  private cachedStatus: DockerStatus | null = null;
  private cachedAt = 0;

  static getInstance(): DockerDetector {
    if (!DockerDetector.instance) {
      DockerDetector.instance = new DockerDetector();
    }
    return DockerDetector.instance;
  }

  async checkAvailability(forceRefresh = false): Promise<DockerStatus> {
    const now = Date.now();
    if (!forceRefresh && this.cachedStatus && now - this.cachedAt < CACHE_TTL_MS) {
      return this.cachedStatus;
    }

    const bridge = getServerBridge();
    const checkedAt = new Date().toISOString();

    // Try to resolve docker path — first via PATH lookup, then standard Windows install dirs
    let dockerPath = await which("docker");
    if (!dockerPath) {
      dockerPath = await findDockerOnWindows(bridge);
    }

    try {
      const stdout = await execDockerInfo(bridge, dockerPath);
      const parsed = this.parseDockerInfo(stdout);
      const status: DockerStatus = {
        available: true,
        daemonRunning: true,
        version: parsed.version,
        apiVersion: parsed.apiVersion,
        checkedAt,
      };

      this.cachedStatus = status;
      this.cachedAt = now;
      return status;
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      // Strip platform-specific noise from error messages to avoid garbling
      const sanitized = this.sanitizeErrorMessage(rawMessage);
      const status: DockerStatus = {
        available: false,
        daemonRunning: false,
        error: sanitized,
        checkedAt,
      };

      this.cachedStatus = status;
      this.cachedAt = now;
      return status;
    }
  }

  async isImageAvailable(image: string): Promise<boolean> {
    const bridge = getServerBridge();

    try {
      let dockerPath = await which("docker");
      if (!dockerPath) dockerPath = await findDockerOnWindows(bridge);
      const args = ["images", "-q", image];

      if (dockerPath) {
        const handle = bridge.process.spawn(dockerPath, args);
        let stdout = "";
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            handle.kill();
            resolve(false);
          }, DEFAULT_TIMEOUT_MS);

          handle.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf-8"); });
          handle.on("exit", (code) => {
            clearTimeout(timer);
            resolve(code === 0 && stdout.trim().length > 0);
          });
          handle.on("error", () => {
            clearTimeout(timer);
            resolve(false);
          });
        });
      } else {
        const { stdout } = await bridge.process.exec(`docker images -q ${image}`, {
          timeout: DEFAULT_TIMEOUT_MS,
        });
        return stdout.trim().length > 0;
      }
    } catch {
      return false;
    }
  }

  async pullImage(image: string): Promise<DockerPullResult> {
    const bridge = getServerBridge();
    const PULL_TIMEOUT_MS = 10 * 60_000; // 10 minutes for image pulls

    try {
      let dockerPath = await which("docker");
      if (!dockerPath) dockerPath = await findDockerOnWindows(bridge);
      const args = ["pull", image];

      if (dockerPath) {
        const handle = bridge.process.spawn(dockerPath, args);
        let stdout = "";
        let stderr = "";
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            handle.kill();
            resolve({ ok: false, image, error: "docker pull timed out" });
          }, PULL_TIMEOUT_MS);

          handle.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf-8"); });
          handle.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf-8"); });
          handle.on("exit", (code) => {
            clearTimeout(timer);
            if (code === 0) {
              resolve({ ok: true, image, output: stdout.trim() });
            } else {
              resolve({ ok: false, image, error: stderr || `docker exited with code ${code}` });
            }
          });
          handle.on("error", (err: Error) => {
            clearTimeout(timer);
            resolve({ ok: false, image, error: err.message });
          });
        });
      } else {
        const { stdout, stderr } = await bridge.process.exec(`docker pull ${image}`, {
          timeout: PULL_TIMEOUT_MS,
        });
        return { ok: true, image, output: `${stdout}${stderr ? `\n${stderr}` : ""}`.trim() };
      }
    } catch (err) {
      return { ok: false, image, error: err instanceof Error ? err.message : "Failed to pull image" };
    }
  }

  private parseDockerInfo(stdout: string): { version?: string; apiVersion?: string } {
    try {
      const json = JSON.parse(stdout.trim()) as Record<string, unknown>;
      const serverVersion = typeof json.ServerVersion === "string" ? json.ServerVersion : undefined;
      const clientInfo = (json.ClientInfo ?? {}) as Record<string, unknown>;
      const apiVersion = typeof clientInfo.ApiVersion === "string"
        ? clientInfo.ApiVersion
        : (typeof json.APIVersion === "string" ? json.APIVersion : undefined);

      return { version: serverVersion, apiVersion };
    } catch {
      return {};
    }
  }

  /**
   * Remove Windows cmd.exe noise from error messages so the UI never displays
   * garbled characters. Only keep the last line if it looks like a meaningful
   * Docker / system error.
   */
  private sanitizeErrorMessage(raw: string): string {
    if (!raw) return "Docker unavailable";
    const lastLine = raw.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? raw;
    // Preserve short, valid Docker errors like "dial tcp: EOF" and only
    // collapse messages that contain non-ASCII / replacement characters.
    if (/[^\u0020-\u007E]|�/u.test(lastLine)) {
      return "Docker unavailable";
    }
    return lastLine;
  }
}

export function getDockerDetector(): DockerDetector {
  return DockerDetector.getInstance();
}
