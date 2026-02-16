/**
 * Web Platform Bridge — implementation for Next.js / Vercel deployment.
 *
 * Wraps current server-side Node.js capabilities (child_process, fs, etc.)
 * and provides no-op / limited implementations for features unavailable
 * in serverless environments.
 */

import type {
  IPlatformBridge,
  IPlatformProcess,
  IPlatformFs,
  IPlatformDb,
  IPlatformGit,
  IPlatformTerminal,
  IPlatformDialog,
  IPlatformShell,
  IPlatformEnv,
  IPlatformEvents,
  IProcessHandle,
  SpawnOptions,
  ExecOptions,
  DirEntry,
  DatabaseType,
  OpenDialogOptions,
  SaveDialogOptions,
  MessageDialogOptions,
  TerminalCreateOptions,
  ITerminalHandle,
  GitBranchInfo,
  GitStatus,
  EventHandler,
  UnlistenFn,
} from "./interfaces";

// ─── Web Process (Node.js child_process) ──────────────────────────────────

class WebProcess implements IPlatformProcess {
  private _isServerless: boolean;

  constructor(isServerless: boolean) {
    this._isServerless = isServerless;
  }

  isAvailable(): boolean {
    return !this._isServerless;
  }

  spawn(command: string, args: string[], options?: SpawnOptions): IProcessHandle {
    if (this._isServerless) {
      throw new Error("Process spawning is not available in serverless environments");
    }
    const { spawn } = require("child_process");
    return spawn(command, args, {
      stdio: options?.stdio ?? ["pipe", "pipe", "pipe"],
      cwd: options?.cwd,
      env: options?.env ? { ...process.env, ...options.env } : process.env,
      shell: options?.shell ?? false,
      detached: options?.detached ?? false,
    });
  }

  async exec(command: string, options?: ExecOptions): Promise<{ stdout: string; stderr: string }> {
    if (this._isServerless) {
      throw new Error("Process execution is not available in serverless environments");
    }
    const { exec } = require("child_process");
    const { promisify } = require("util");
    const execAsync = promisify(exec);
    return execAsync(command, {
      cwd: options?.cwd,
      env: options?.env ? { ...process.env, ...options.env } : process.env,
      timeout: options?.timeout,
      encoding: options?.encoding ?? "utf-8",
    });
  }

  execSync(command: string, options?: ExecOptions): string {
    if (this._isServerless) {
      throw new Error("Process execution is not available in serverless environments");
    }
    const { execSync } = require("child_process");
    return execSync(command, {
      cwd: options?.cwd,
      env: options?.env ? { ...process.env, ...options.env } : process.env,
      timeout: options?.timeout,
      encoding: (options?.encoding ?? "utf-8") as BufferEncoding,
    }).toString();
  }

  async which(command: string): Promise<string | null> {
    if (this._isServerless) return null;
    try {
      const whichCmd = process.platform === "win32" ? "where" : "which";
      const result = this.execSync(`${whichCmd} ${command}`);
      return result.trim().split("\n")[0] || null;
    } catch {
      return null;
    }
  }
}

// ─── Web File System (Node.js fs) ─────────────────────────────────────────

class WebFs implements IPlatformFs {
  private get fs() {
    return require("fs") as typeof import("fs");
  }

  private get path() {
    return require("path") as typeof import("path");
  }

  async readTextFile(path: string): Promise<string> {
    return this.fs.readFileSync(path, "utf-8");
  }

  readTextFileSync(path: string): string {
    return this.fs.readFileSync(path, "utf-8");
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    this.fs.writeFileSync(path, content, "utf-8");
  }

  writeTextFileSync(path: string, content: string): void {
    this.fs.writeFileSync(path, content, "utf-8");
  }

  async exists(path: string): Promise<boolean> {
    return this.fs.existsSync(path);
  }

  existsSync(path: string): boolean {
    return this.fs.existsSync(path);
  }

  async readDir(dirPath: string): Promise<DirEntry[]> {
    return this.readDirSync(dirPath);
  }

  readDirSync(dirPath: string): DirEntry[] {
    const entries = this.fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      path: this.path.join(dirPath, entry.name),
    }));
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.fs.mkdirSync(path, { recursive: options?.recursive ?? false });
  }

  mkdirSync(path: string, options?: { recursive?: boolean }): void {
    this.fs.mkdirSync(path, { recursive: options?.recursive ?? false });
  }

  async remove(path: string): Promise<void> {
    this.fs.unlinkSync(path);
  }

  async copyFile(src: string, dest: string): Promise<void> {
    this.fs.copyFileSync(src, dest);
  }

  async stat(path: string): Promise<{ isDirectory: boolean; isFile: boolean }> {
    return this.statSync(path);
  }

  statSync(path: string): { isDirectory: boolean; isFile: boolean } {
    const s = this.fs.statSync(path);
    return { isDirectory: s.isDirectory(), isFile: s.isFile() };
  }
}

// ─── Web Database (Neon Postgres / InMemory) ──────────────────────────────

class WebDb implements IPlatformDb {
  get type(): DatabaseType {
    const { getDatabaseDriver } = require("@/core/db/index");
    const driver = getDatabaseDriver();
    if (driver === "postgres") return "postgres";
    if (driver === "sqlite") return "sqlite";
    return "memory";
  }

  isDatabaseConfigured(): boolean {
    const { isDatabaseConfigured } = require("@/core/db/index");
    return isDatabaseConfigured();
  }

  getDatabase(): unknown {
    if (!this.isDatabaseConfigured()) return null;
    const { getDatabase } = require("@/core/db/index");
    return getDatabase();
  }
}

// ─── Web Git (execSync-based) ─────────────────────────────────────────────

class WebGit implements IPlatformGit {
  private processAdapter: WebProcess;

  constructor(processAdapter: WebProcess) {
    this.processAdapter = processAdapter;
  }

  isAvailable(): boolean {
    return this.processAdapter.isAvailable();
  }

  async isGitRepository(dirPath: string): Promise<boolean> {
    try {
      this.processAdapter.execSync("git rev-parse --is-inside-work-tree", { cwd: dirPath });
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentBranch(repoPath: string): Promise<string> {
    return this.processAdapter.execSync("git branch --show-current", { cwd: repoPath }).trim();
  }

  async listBranches(repoPath: string): Promise<GitBranchInfo[]> {
    const output = this.processAdapter.execSync("git branch", { cwd: repoPath });
    return output
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => ({
        name: line.replace(/^\*?\s+/, "").trim(),
        isCurrent: line.startsWith("*"),
      }));
  }

  async getStatus(repoPath: string): Promise<GitStatus> {
    const isRepo = await this.isGitRepository(repoPath);
    if (!isRepo) {
      return { isRepo: false, branch: "", modified: [], staged: [], untracked: [] };
    }

    const branch = await this.getCurrentBranch(repoPath);
    const statusOutput = this.processAdapter.execSync("git status --porcelain", { cwd: repoPath });
    const lines = statusOutput.split("\n").filter((l) => l.trim());

    const modified: string[] = [];
    const staged: string[] = [];
    const untracked: string[] = [];

    for (const line of lines) {
      const indexStatus = line[0];
      const workingStatus = line[1];
      const file = line.slice(3);

      if (indexStatus === "?" && workingStatus === "?") {
        untracked.push(file);
      } else {
        if (indexStatus !== " " && indexStatus !== "?") staged.push(file);
        if (workingStatus !== " " && workingStatus !== "?") modified.push(file);
      }
    }

    return { isRepo: true, branch, modified, staged, untracked };
  }

  async clone(url: string, targetDir: string, onProgress?: (msg: string) => void): Promise<void> {
    if (onProgress) {
      const handle = this.processAdapter.spawn("git", ["clone", "--progress", url, targetDir]);
      return new Promise((resolve, reject) => {
        handle.stderr?.on("data", (chunk: Buffer) => onProgress(chunk.toString()));
        handle.on("exit", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`git clone failed with code ${code}`));
        });
        handle.on("error", reject);
      });
    }
    await this.processAdapter.exec(`git clone ${url} ${targetDir}`);
  }

  async fetch(repoPath: string): Promise<void> {
    await this.processAdapter.exec("git fetch --all", { cwd: repoPath });
  }

  async pull(repoPath: string, branch?: string): Promise<void> {
    const cmd = branch ? `git pull origin ${branch}` : "git pull";
    await this.processAdapter.exec(cmd, { cwd: repoPath });
  }

  async checkout(repoPath: string, branch: string): Promise<void> {
    await this.processAdapter.exec(`git checkout ${branch}`, { cwd: repoPath });
  }
}

// ─── Web Terminal (Node.js child_process) ─────────────────────────────────

class WebTerminal implements IPlatformTerminal {
  private processAdapter: WebProcess;

  constructor(processAdapter: WebProcess) {
    this.processAdapter = processAdapter;
  }

  isAvailable(): boolean {
    return this.processAdapter.isAvailable();
  }

  create(
    options: TerminalCreateOptions,
    sessionId: string,
    onOutput: (data: string) => void
  ): ITerminalHandle {
    const command = options.command ?? "/bin/bash";
    const args = options.args ?? [];
    const cwd = options.cwd ?? process.cwd();

    const proc = this.processAdapter.spawn(command, args, {
      cwd,
      env: options.env ? { ...process.env, ...options.env } as Record<string, string> : undefined,
      shell: true,
    });

    const terminalId = `term-${Date.now()}-${sessionId}`;
    let output = "";
    let exitCode: number | null = null;

    const exitPromise = new Promise<{ exitCode: number }>((resolve) => {
      proc.on("exit", (code) => {
        exitCode = code ?? -1;
        resolve({ exitCode });
      });
    });

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      onOutput(text);
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      onOutput(text);
    });

    return {
      terminalId,
      getOutput: () => output,
      waitForExit: () => exitPromise,
      kill: () => proc.kill("SIGTERM"),
      release: () => proc.kill("SIGTERM"),
    };
  }
}

// ─── Web Dialog (browser fallbacks) ───────────────────────────────────────

class WebDialog implements IPlatformDialog {
  async open(_options?: OpenDialogOptions): Promise<string | string[] | null> {
    // In server context, native file dialog is not available.
    // Client-side code should use <input type="file"> instead.
    console.warn("[WebDialog] File dialog not available on server side");
    return null;
  }

  async save(_options?: SaveDialogOptions): Promise<string | null> {
    console.warn("[WebDialog] Save dialog not available on server side");
    return null;
  }

  async message(_message: string, _options?: MessageDialogOptions): Promise<number> {
    console.warn("[WebDialog] Message dialog not available on server side");
    return 0;
  }
}

// ─── Web Shell ────────────────────────────────────────────────────────────

class WebShell implements IPlatformShell {
  async openUrl(_url: string): Promise<void> {
    // Server-side: no-op. Client-side should use window.open().
    console.warn("[WebShell] openUrl not available on server side");
  }

  async openPath(_path: string): Promise<void> {
    console.warn("[WebShell] openPath not available on server side");
  }
}

// ─── Web Environment ──────────────────────────────────────────────────────

class WebEnv implements IPlatformEnv {
  platform = "web" as const;

  isServerless(): boolean {
    return !!(
      process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.NETLIFY ||
      process.env.FUNCTION_NAME
    );
  }

  isDesktop(): boolean {
    return false;
  }

  isTauri(): boolean {
    return false;
  }

  isElectron(): boolean {
    return false;
  }

  homeDir(): string {
    return require("os").homedir();
  }

  appDataDir(): string {
    return this.homeDir();
  }

  currentDir(): string {
    return process.cwd();
  }

  getEnv(key: string): string | undefined {
    return process.env[key];
  }

  osPlatform(): string {
    return process.platform;
  }
}

// ─── Web Events (CustomEvent + in-process) ────────────────────────────────

class WebEvents implements IPlatformEvents {
  private handlers = new Map<string, EventHandler[]>();

  listen(event: string, handler: EventHandler): UnlistenFn {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(handler);

    return () => {
      const list = this.handlers.get(event);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      }
    };
  }

  async emit(event: string, payload?: unknown): Promise<void> {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch (err) {
          console.error(`[WebEvents] Error in handler for "${event}":`, err);
        }
      }
    }
  }
}

// ─── Web Platform Bridge ──────────────────────────────────────────────────

export class WebPlatformBridge implements IPlatformBridge {
  platform = "web" as const;

  env: IPlatformEnv;
  process: IPlatformProcess;
  fs: IPlatformFs;
  db: IPlatformDb;
  git: IPlatformGit;
  terminal: IPlatformTerminal;
  dialog: IPlatformDialog;
  shell: IPlatformShell;
  events: IPlatformEvents;

  constructor() {
    this.env = new WebEnv();
    const isServerless = this.env.isServerless();
    const webProcess = new WebProcess(isServerless);

    this.process = webProcess;
    this.fs = new WebFs();
    this.db = new WebDb();
    this.git = new WebGit(webProcess);
    this.terminal = new WebTerminal(webProcess);
    this.dialog = new WebDialog();
    this.shell = new WebShell();
    this.events = new WebEvents();
  }

  async invoke<T = unknown>(channel: string, data?: unknown): Promise<T> {
    // In web mode, invoke maps to internal API route calls
    const response = await fetch(`/api/${channel}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      throw new Error(`API call to ${channel} failed: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }
}
