import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import path from "node:path";
import * as vscode from "vscode";

import { readRoutaConfig } from "./config";

export type RoutaServerState = "stopped" | "starting" | "running" | "external" | "error";

export interface RoutaServerStatus {
  state: RoutaServerState;
  baseUrl?: string;
  port?: number;
  error?: string;
}

type StatusListener = (status: RoutaServerStatus) => void;

const STARTUP_TIMEOUT_MS = 20_000;

export class RoutaServerManager implements vscode.Disposable {
  private child: ChildProcessWithoutNullStreams | null = null;
  private status: RoutaServerStatus = { state: "stopped" };
  private listeners = new Set<StatusListener>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {}

  getStatus(): RoutaServerStatus {
    return { ...this.status };
  }

  onDidChangeStatus(listener: StatusListener): vscode.Disposable {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  async ensureStarted(): Promise<RoutaServerStatus> {
    const current = this.getStatus();
    if ((current.state === "running" || current.state === "external") && current.baseUrl) {
      return current;
    }
    return this.start();
  }

  async start(): Promise<RoutaServerStatus> {
    const current = this.getStatus();
    if ((current.state === "running" || current.state === "external") && current.baseUrl) {
      return current;
    }
    if (current.state === "starting") {
      return this.waitForRunning();
    }

    const config = readRoutaConfig();
    const port = config.port > 0 ? config.port : await findAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    if (config.port > 0 && await isHealthy(baseUrl)) {
      this.output.appendLine(`[routa] Connected to existing server at ${baseUrl}`);
      this.setStatus({ state: "external", baseUrl, port });
      return this.getStatus();
    }

    const executable = this.resolveExecutablePath(config.executablePath);
    const dbPath = this.resolveDatabasePath();
    const staticDir = this.resolveStaticDir(config.staticDir);
    const resourceRoot = this.resolveResourceRoot();
    const args = [
      "--db",
      dbPath,
      "server",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      ...(staticDir ? ["--static-dir", staticDir] : []),
      ...config.extraArgs,
    ];

    this.setStatus({ state: "starting", baseUrl, port });
    this.output.appendLine(`[routa] Starting ${executable} ${args.map(quoteArg).join(" ")}`);
    this.output.appendLine(`[routa] Database: ${dbPath}`);
    if (staticDir) {
      this.output.appendLine(`[routa] Frontend: ${staticDir}`);
    } else {
      this.output.appendLine("[routa] Frontend: API only; no static directory found");
    }

    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
    // VS Code launches the configured local Routa binary without shell interpolation.
    const child = spawn(executable, args, {
      cwd: this.resolveRepoRoot(),
      env: {
        ...process.env,
        ROUTA_SERVER_URL: baseUrl,
        ROUTA_SPECIALISTS_RESOURCE_DIR: resourceRoot,
        ROUTA_FEATURE_TREE_RESOURCE_DIR: resourceRoot,
      },
      shell: false,
    });

    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => {
      this.output.appendLine(chunk.toString("utf8").trimEnd());
    });
    child.stderr.on("data", (chunk: Buffer) => {
      this.output.appendLine(chunk.toString("utf8").trimEnd());
    });
    child.on("error", (error) => {
      this.child = null;
      this.output.appendLine(`[routa] Failed to start: ${error.message}`);
      this.setStatus({ state: "error", error: error.message });
    });
    child.on("exit", (code, signal) => {
      this.child = null;
      if (this.status.state !== "stopped") {
        const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
        this.output.appendLine(`[routa] Server exited with ${reason}`);
        this.setStatus({ state: "stopped" });
      }
    });

    try {
      await waitForHealth(baseUrl, STARTUP_TIMEOUT_MS);
      this.setStatus({ state: "running", baseUrl, port });
      return this.getStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[routa] Startup health check failed: ${message}`);
      this.setStatus({ state: "error", baseUrl, port, error: message });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.child) {
      this.setStatus({ state: "stopped" });
      return;
    }

    const child = this.child;
    this.child = null;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 1500);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill();
    });
    this.setStatus({ state: "stopped" });
  }

  dispose(): void {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    this.listeners.clear();
  }

  private async waitForRunning(): Promise<RoutaServerStatus> {
    const start = Date.now();
    while (Date.now() - start < STARTUP_TIMEOUT_MS) {
      const current = this.getStatus();
      if ((current.state === "running" || current.state === "external") && current.baseUrl) {
        return current;
      }
      if (current.state === "error" || current.state === "stopped") {
        throw new Error(current.error ?? vscode.l10n.t("Routa server did not start."));
      }
      await sleep(100);
    }
    throw new Error(vscode.l10n.t("Timed out while waiting for Routa server startup."));
  }

  private setStatus(status: RoutaServerStatus): void {
    this.status = status;
    for (const listener of this.listeners) {
      listener(this.getStatus());
    }
  }

  private resolveExecutablePath(configuredPath: string): string {
    const configured = configuredPath.trim();
    if (configured) {
      return configured;
    }

    const binName = process.platform === "win32" ? "routa.exe" : "routa";
    const platformArch = `${process.platform}-${process.arch}`;
    const repoRoot = this.resolveRepoRoot();
    const candidates = [
      path.join(this.context.extensionPath, "bin", platformArch, binName),
      path.join(repoRoot, "target", "release", binName),
      path.join(repoRoot, "target", "debug", binName),
    ];

    return candidates.find((candidate) => existsSync(candidate)) ?? binName;
  }

  private resolveDatabasePath(): string {
    const storagePath = this.context.globalStorageUri.fsPath;
    mkdirSync(storagePath, { recursive: true });
    return path.join(storagePath, "routa-vscode.db");
  }

  private resolveStaticDir(configuredPath: string): string | undefined {
    const configured = configuredPath.trim();
    if (configured && existsSync(configured)) {
      return configured;
    }

    const repoRoot = this.resolveRepoRoot();
    const candidates = [
      path.join(this.context.extensionPath, "dist", "frontend"),
      path.join(repoRoot, "out"),
    ];
    return candidates.find((candidate) => existsSync(candidate));
  }

  private resolveResourceRoot(): string {
    const repoRoot = this.resolveRepoRoot();
    const candidates = [
      this.context.extensionPath,
      repoRoot,
    ];
    return candidates.find((candidate) => existsSync(path.join(candidate, "resources", "specialists"))) ?? repoRoot;
  }

  private resolveRepoRoot(): string {
    const candidate = path.resolve(this.context.extensionPath, "..", "..");
    if (
      existsSync(path.join(candidate, "package.json")) &&
      existsSync(path.join(candidate, "crates", "routa-cli", "Cargo.toml"))
    ) {
      return candidate;
    }
    return this.context.extensionPath;
  }
}

function quoteArg(value: string): string {
  if (!/[\s"']/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("Failed to resolve an available local port."));
        }
      });
    });
  });
}

function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (await isHealthy(baseUrl)) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Routa server did not become healthy at ${baseUrl}`));
        return;
      }
      setTimeout(tick, 250);
    };
    void tick();
  });
}

function isHealthy(baseUrl: string): Promise<boolean> {
  const url = new URL("/api/health", baseUrl);
  return new Promise((resolve) => {
    const req = request(url, { method: "GET", timeout: 1000 }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}
