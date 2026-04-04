/**
 * ACP Runtime Manager
 *
 * TypeScript port of the Rust `AcpRuntimeManager`.
 * Manages Node.js and uv runtimes for ACP agent execution:
 *   - Detect system-installed runtimes (node, npx, uv, uvx) via PATH
 *   - Download and cache managed runtimes in {data_dir}/acp-agents/.runtimes/
 *   - Platform detection and URL construction
 *
 * Runtime resolution priority (per RuntimeType):
 *   1. getManagedRuntime()  — check .runtimes/{node|uv}/{version}/
 *   2. getSystemRuntime()   — search system PATH
 *   3. ensureRuntime()      — auto-download when neither is available
 *
 * NPX/UVX mapping:
 *   - RuntimeType.Npx  → download Node.js, then find `npx` in the same dir
 *   - RuntimeType.Uvx  → download uv,      then find `uvx` in the same dir
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";
import { needsShell, which } from "./utils";

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_NODE_VERSION = "22.12.0";
const DEFAULT_UV_VERSION = "0.5.11";
const NODE_DOWNLOAD_BASE = "https://nodejs.org/dist";
const UV_DOWNLOAD_BASE = "https://github.com/astral-sh/uv/releases/download";

// ─── Platform ───────────────────────────────────────────────────────────────

export type AcpPlatform =
  | "darwin-aarch64"
  | "darwin-x86_64"
  | "linux-aarch64"
  | "linux-x86_64"
  | "windows-aarch64"
  | "windows-x86_64";

/**
 * Return the current platform string (e.g. `"darwin-aarch64"`).
 */
export function currentPlatform(): AcpPlatform {
  const { platform, arch } = process;
  if (platform === "darwin") return arch === "arm64" ? "darwin-aarch64" : "darwin-x86_64";
  if (platform === "linux") return arch === "arm64" ? "linux-aarch64" : "linux-x86_64";
  if (platform === "win32") return arch === "arm64" ? "windows-aarch64" : "windows-x86_64";
  return "linux-x86_64"; // safe fallback
}

// ─── Runtime Type ─────────────────────────────────────────────────────────

export type RuntimeType = "node" | "npx" | "uv" | "uvx";

const RUNTIME_COMMANDS: Record<RuntimeType, string> = {
  node: "node",
  npx: "npx",
  uv: "uv",
  uvx: "uvx",
};

const RUNTIME_LABELS: Record<RuntimeType, string> = {
  node: "Node.js",
  npx: "npx",
  uv: "uv",
  uvx: "uvx",
};

// ─── Runtime Info ──────────────────────────────────────────────────────────

export interface RuntimeInfo {
  runtime: RuntimeType;
  path: string;
  version: string | null;
  isManaged: boolean;
}

export interface RuntimeStatus {
  platform: AcpPlatform;
  runtimes: Record<RuntimeType, RuntimeInfo | null>;
}

// ─── Paths ────────────────────────────────────────────────────────────────

function getAcpDataDir(): string {
  // Match Rust: dirs::data_local_dir() + "acp-agents"
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "acp-agents");
  }
  if (process.platform === "win32") {
    return path.join(os.homedir(), "AppData", "Local", "acp-agents");
  }
  // Linux: XDG_DATA_HOME or ~/.local/share
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg || path.join(os.homedir(), ".local", "share");
  return path.join(base, "acp-agents");
}

function getRuntimeDir(base: "node" | "uv", version: string): string {
  return path.join(getAcpDataDir(), ".runtimes", base, version);
}

function getDownloadsDir(): string {
  return path.join(getAcpDataDir(), ".downloads");
}

// ─── Download lock (in-process mutex) ────────────────────────────────────

const downloadLocks = new Map<string, Promise<void>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  // Wait for any existing lock on this key
  const existing = downloadLocks.get(key);
  if (existing) await existing.catch(() => {});

  let releaseLock!: () => void;
  const lock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  downloadLocks.set(key, lock);

  try {
    return await fn();
  } finally {
    releaseLock();
    downloadLocks.delete(key);
  }
}

// ─── AcpRuntimeManager ───────────────────────────────────────────────────

export class AcpRuntimeManager {
  private static instance: AcpRuntimeManager | undefined;

  /**
   * Singleton accessor — safe for Next.js server components and API routes.
   */
  static getInstance(): AcpRuntimeManager {
    if (!AcpRuntimeManager.instance) {
      AcpRuntimeManager.instance = new AcpRuntimeManager();
    }
    return AcpRuntimeManager.instance;
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /** Return whether a runtime is reachable (managed or system). */
  async isRuntimeAvailable(rt: RuntimeType): Promise<boolean> {
    return (await this.getRuntimePath(rt)) !== null;
  }

  /** Return the best path for a runtime: managed first, then system. */
  async getRuntimePath(rt: RuntimeType): Promise<string | null> {
    const managed = await this.getManagedRuntime(rt);
    if (managed) return managed.path;
    const system = await this.getSystemRuntime(rt);
    return system ? system.path : null;
  }

  /** Locate the runtime on the system PATH. */
  async getSystemRuntime(rt: RuntimeType): Promise<RuntimeInfo | null> {
    const cmd = RUNTIME_COMMANDS[rt];
    const resolved = await which(cmd);
    if (!resolved) return null;
    return {
      runtime: rt,
      path: resolved,
      version: null,
      isManaged: false,
    };
  }

  /** Locate a previously downloaded (managed) runtime. */
  async getManagedRuntime(rt: RuntimeType): Promise<RuntimeInfo | null> {
    const { base, version } = this.baseAndVersion(rt);
    const runtimeDir = getRuntimeDir(base, version);

    if (!fs.existsSync(runtimeDir)) return null;

    const exe = await this.findExecutableIn(runtimeDir, RUNTIME_COMMANDS[rt]);
    if (!exe) return null;

    return {
      runtime: rt,
      path: exe,
      version,
      isManaged: true,
    };
  }

  /**
   * Ensure the runtime is available, downloading it if necessary.
   * Returns a RuntimeInfo with the resolved path.
   */
  async ensureRuntime(rt: RuntimeType): Promise<RuntimeInfo> {
    // 1. Managed runtime already present?
    const managed = await this.getManagedRuntime(rt);
    if (managed) return managed;

    // 2. System runtime available?
    const system = await this.getSystemRuntime(rt);
    if (system) return system;

    // 3. Download the base type, then locate the companion executable.
    const platform = currentPlatform();
    const { base, version } = this.baseAndVersion(rt);

    if (base === "node") {
      await this.downloadNode(version, platform);
    } else if (base === "uv") {
      await this.downloadUv(version, platform);
    } else {
      throw new Error(`Unknown runtime base: ${base}`);
    }

    // Locate the binary in the extracted tree
    const runtimeDir = getRuntimeDir(base, version);
    const exe = await this.findExecutableIn(runtimeDir, RUNTIME_COMMANDS[rt]);
    if (!exe) {
      throw new Error(
        `'${RUNTIME_COMMANDS[rt]}' not found after downloading ${base} (looked in ${runtimeDir})`
      );
    }

    return {
      runtime: rt,
      path: exe,
      version,
      isManaged: true,
    };
  }

  /**
   * Run `{binary} --version` and capture the output.
   * Returns null if the runtime is not available or the command fails.
   */
  async getVersion(rt: RuntimeType): Promise<string | null> {
    const binPath = await this.getRuntimePath(rt);
    if (!binPath) return null;

    return new Promise((resolve) => {
      const proc = spawn(binPath, ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10_000,
        shell: needsShell(binPath),
      });

      let output = "";
      proc.stdout?.on("data", (d: Buffer) => { output += d.toString(); });
      proc.stderr?.on("data", (d: Buffer) => { output += d.toString(); });

      proc.on("close", () => {
        const trimmed = output.trim();
        // node → "v22.12.0", uv/uvx → "uv 0.5.11 ..."
        resolve(trimmed.length > 0 ? trimmed.split("\n")[0].trim() : null);
      });

      proc.on("error", () => resolve(null));
    });
  }

  /**
   * Return status of all four runtimes.
   */
  async getRuntimeStatus(): Promise<RuntimeStatus> {
    const platform = currentPlatform();
    const types: RuntimeType[] = ["node", "npx", "uv", "uvx"];
    const runtimes = {} as Record<RuntimeType, RuntimeInfo | null>;

    await Promise.all(
      types.map(async (rt) => {
        const managed = await this.getManagedRuntime(rt);
        if (managed) {
          runtimes[rt] = managed;
          return;
        }
        const system = await this.getSystemRuntime(rt);
        if (system) {
          // Populate version lazily
          system.version = await this.getVersion(rt);
        }
        runtimes[rt] = system;
      })
    );

    return { platform, runtimes };
  }

  // ── Node.js download ───────────────────────────────────────────────────

  async downloadNode(version: string, platform: AcpPlatform): Promise<string> {
    return withLock(`node-${version}`, async () => {
      const runtimeDir = getRuntimeDir("node", version);

      // Already present?
      const existing = await this.findExecutableIn(runtimeDir, "node");
      if (existing) return existing;

      fs.mkdirSync(runtimeDir, { recursive: true });

      const { nodeOs, nodeArch } = this.nodePlatform(platform);
      const isWin = nodeOs === "win";
      const ext = isWin ? "zip" : "tar.gz";
      const archiveBase = `node-v${version}-${nodeOs}-${nodeArch}`;
      const url = `${NODE_DOWNLOAD_BASE}/v${version}/${archiveBase}.${ext}`;

      const downloadDir = path.join(getDownloadsDir(), "node", version);
      fs.mkdirSync(downloadDir, { recursive: true });
      const archivePath = path.join(downloadDir, `${archiveBase}.${ext}`);

      console.log(`[AcpRuntimeManager] Downloading Node.js ${version}: ${url}`);
      await this.downloadFile(url, archivePath);

      await this.extractArchive(archivePath, runtimeDir);

      // Clean up download
      try { fs.rmSync(downloadDir, { recursive: true, force: true }); } catch { /* ignore */ }

      const nodePath = await this.findExecutableIn(runtimeDir, "node");
      if (!nodePath) throw new Error("node binary not found after extraction");

      await this.makeExecutable(nodePath);

      // Also chmod npx if present
      const npxPath = await this.findExecutableIn(runtimeDir, "npx");
      if (npxPath) await this.makeExecutable(npxPath).catch(() => {});

      console.log(`[AcpRuntimeManager] Node.js ready: ${nodePath}`);
      return nodePath;
    });
  }

  // ── uv download ────────────────────────────────────────────────────────

  async downloadUv(version: string, platform: AcpPlatform): Promise<string> {
    return withLock(`uv-${version}`, async () => {
      const runtimeDir = getRuntimeDir("uv", version);

      // Already present?
      const existing = await this.findExecutableIn(runtimeDir, "uv");
      if (existing) return existing;

      fs.mkdirSync(runtimeDir, { recursive: true });

      const target = this.uvTarget(platform);
      const isWin = platform.startsWith("windows");
      const ext = isWin ? "zip" : "tar.gz";
      const archiveBase = `uv-${target}`;
      const url = `${UV_DOWNLOAD_BASE}/${version}/${archiveBase}.${ext}`;

      const downloadDir = path.join(getDownloadsDir(), "uv", version);
      fs.mkdirSync(downloadDir, { recursive: true });
      const archivePath = path.join(downloadDir, `${archiveBase}.${ext}`);

      console.log(`[AcpRuntimeManager] Downloading uv ${version}: ${url}`);
      await this.downloadFile(url, archivePath);

      await this.extractArchive(archivePath, runtimeDir);

      // Clean up download
      try { fs.rmSync(downloadDir, { recursive: true, force: true }); } catch { /* ignore */ }

      const uvPath = await this.findExecutableIn(runtimeDir, "uv");
      if (!uvPath) throw new Error("uv binary not found after extraction");

      await this.makeExecutable(uvPath);
      const uvxPath = await this.findExecutableIn(runtimeDir, "uvx");
      if (uvxPath) await this.makeExecutable(uvxPath).catch(() => {});

      console.log(`[AcpRuntimeManager] uv ready: ${uvPath}`);
      return uvPath;
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private baseAndVersion(rt: RuntimeType): { base: "node" | "uv"; version: string } {
    if (rt === "node" || rt === "npx") return { base: "node", version: DEFAULT_NODE_VERSION };
    return { base: "uv", version: DEFAULT_UV_VERSION };
  }

  private nodePlatform(platform: AcpPlatform): { nodeOs: string; nodeArch: string } {
    const map: Record<AcpPlatform, { nodeOs: string; nodeArch: string }> = {
      "darwin-aarch64": { nodeOs: "darwin", nodeArch: "arm64" },
      "darwin-x86_64": { nodeOs: "darwin", nodeArch: "x64" },
      "linux-aarch64": { nodeOs: "linux", nodeArch: "arm64" },
      "linux-x86_64": { nodeOs: "linux", nodeArch: "x64" },
      "windows-aarch64": { nodeOs: "win", nodeArch: "arm64" },
      "windows-x86_64": { nodeOs: "win", nodeArch: "x64" },
    };
    return map[platform];
  }

  private uvTarget(platform: AcpPlatform): string {
    const map: Record<AcpPlatform, string> = {
      "darwin-aarch64": "aarch64-apple-darwin",
      "darwin-x86_64": "x86_64-apple-darwin",
      "linux-aarch64": "aarch64-unknown-linux-gnu",
      "linux-x86_64": "x86_64-unknown-linux-gnu",
      "windows-aarch64": "aarch64-pc-windows-msvc",
      "windows-x86_64": "x86_64-pc-windows-msvc",
    };
    return map[platform];
  }

  private async downloadFile(url: string, dest: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed (${response.status}) for ${url}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(dest, buffer);
    console.log(`[AcpRuntimeManager] Downloaded ${buffer.length} bytes → ${dest}`);
  }

  private async extractArchive(archivePath: string, destDir: string): Promise<void> {
    const lower = archivePath.toLowerCase();
    if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
      await this.extractTarGz(archivePath, destDir);
    } else if (lower.endsWith(".zip")) {
      await this.extractZip(archivePath, destDir);
    } else {
      // Raw binary — just chmod
      await this.makeExecutable(archivePath);
    }
  }

  private extractTarGz(archivePath: string, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn("tar", ["-xzf", archivePath, "-C", destDir]);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`tar extraction failed with code ${code}`));
      });
      proc.on("error", reject);
    });
  }

  private extractZip(archivePath: string, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === "win32";
      const cmd = isWindows ? "powershell" : "unzip";
      const args = isWindows
        ? ["-Command", `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}'`]
        : ["-o", archivePath, "-d", destDir];

      const proc = spawn(cmd, args);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`zip extraction failed with code ${code}`));
      });
      proc.on("error", reject);
    });
  }

  /** Recursively find a named executable under `dir`. */
  private async findExecutableIn(dir: string, name: string): Promise<string | null> {
    if (!fs.existsSync(dir)) return null;

    const isWindows = process.platform === "win32";
    const targetName = isWindows ? `${name}.exe` : name;

    const search = (currentDir: string): string | null => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return null;
      }
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          const found = search(fullPath);
          if (found) return found;
        } else if (entry.name === targetName) {
          return fullPath;
        }
      }
      return null;
    };

    return search(dir);
  }

  private async makeExecutable(filePath: string): Promise<void> {
    if (process.platform !== "win32") {
      fs.chmodSync(filePath, 0o755);
    }
    // Remove macOS quarantine attribute
    if (process.platform === "darwin") {
      await new Promise<void>((resolve) => {
        const proc = spawn("xattr", ["-d", "com.apple.quarantine", filePath], {
          stdio: "ignore",
        });
        proc.on("close", () => resolve());
        proc.on("error", () => resolve());
      });
    }
  }
}

export const RUNTIME_LABELS_MAP = RUNTIME_LABELS;
