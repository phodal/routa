/**
 * Tauri Platform Bridge — implementation for Tauri v2 desktop application.
 *
 * Uses Tauri's plugin system for native capabilities:
 * - @tauri-apps/plugin-shell: Process spawning, shell operations
 * - @tauri-apps/plugin-fs: File system access
 * - @tauri-apps/plugin-dialog: Native file/message dialogs
 * - @tauri-apps/plugin-notification: Native notifications
 * - @tauri-apps/plugin-sql: SQLite database
 * - @tauri-apps/api: Core IPC (invoke, listen, emit)
 *
 * This bridge is used in the Tauri frontend (renderer) context.
 * Heavy operations (process spawn, fs) are delegated to the Rust backend
 * via Tauri's invoke mechanism.
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
  WritableStreamLike,
  ReadableStreamLike,
} from "./interfaces";

// ─── Tauri API Dynamic Imports ────────────────────────────────────────────
// Dynamic imports to avoid bundling Tauri APIs in web builds.
// These packages are only available when running inside a Tauri app.
// TypeScript may report "Cannot find module" errors in the root project —
// this is expected. The types resolve correctly in apps/desktop/ where
// the Tauri packages are installed.

/* eslint-disable @typescript-eslint/no-explicit-any */

async function getTauriCore(): Promise<any> {
  return await import("@tauri-apps/api/core");
}

async function getTauriEvent(): Promise<any> {
  return await import("@tauri-apps/api/event");
}

async function getTauriShell(): Promise<any> {
  return await import("@tauri-apps/plugin-shell");
}

async function getTauriFs(): Promise<any> {
  return await import("@tauri-apps/plugin-fs");
}

async function getTauriDialog(): Promise<any> {
  return await import("@tauri-apps/plugin-dialog");
}

async function getTauriPath(): Promise<any> {
  return await import("@tauri-apps/api/path");
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Tauri Process ────────────────────────────────────────────────────────

/**
 * Wraps a Tauri Shell Command child process to match IProcessHandle.
 */
class TauriProcessHandle implements IProcessHandle {
  pid: number | undefined;
  stdin: WritableStreamLike | null = null;
  stdout: ReadableStreamLike | null = null;
  stderr: ReadableStreamLike | null = null;
  exitCode: number | null = null;

  private _exitHandlers: Array<(code: number | null, signal: string | null) => void> = [];
  private _errorHandlers: Array<(err: Error) => void> = [];
  private _stdoutHandlers: Array<(chunk: Buffer) => void> = [];
  private _stderrHandlers: Array<(chunk: Buffer) => void> = [];
  private _killFn: (() => void) | null = null;
  private _writeFn: ((data: string) => void) | null = null;

  constructor() {
    this.stdout = {
      on: (_event: string, handler: (chunk: Buffer) => void) => {
        this._stdoutHandlers.push(handler);
      },
    };
    this.stderr = {
      on: (_event: string, handler: (chunk: Buffer) => void) => {
        this._stderrHandlers.push(handler);
      },
    };
    this.stdin = {
      writable: true,
      write: (data: string | Buffer) => {
        if (this._writeFn) {
          this._writeFn(typeof data === "string" ? data : data.toString());
          return true;
        }
        return false;
      },
    };
  }

  /** @internal Called by TauriProcess to wire up the Tauri shell child. */
  _wireChild(child: {
    pid: number;
    write: (data: string) => void;
    kill: () => void;
  }): void {
    this.pid = child.pid;
    this._killFn = () => child.kill();
    this._writeFn = (data: string) => child.write(data);
  }

  /** @internal Forward stdout data from Tauri child */
  _emitStdout(data: string): void {
    const buf = Buffer.from(data);
    for (const handler of this._stdoutHandlers) handler(buf);
  }

  /** @internal Forward stderr data from Tauri child */
  _emitStderr(data: string): void {
    const buf = Buffer.from(data);
    for (const handler of this._stderrHandlers) handler(buf);
  }

  /** @internal Forward exit event from Tauri child */
  _emitExit(code: number): void {
    this.exitCode = code;
    for (const handler of this._exitHandlers) handler(code, null);
  }

  /** @internal Forward error event */
  _emitError(err: Error): void {
    for (const handler of this._errorHandlers) handler(err);
  }

  kill(signal?: string): void {
    if (this._killFn) this._killFn();
  }

  on(event: "exit", handler: (code: number | null, signal: string | null) => void): void;
  on(event: "error", handler: (err: Error) => void): void;
  on(event: "exit" | "error", handler: (...args: unknown[]) => void): void {
    if (event === "exit") {
      this._exitHandlers.push(handler as (code: number | null, signal: string | null) => void);
    } else if (event === "error") {
      this._errorHandlers.push(handler as (err: Error) => void);
    }
  }
}

class TauriProcess implements IPlatformProcess {
  isAvailable(): boolean {
    return true;
  }

  spawn(command: string, args: string[], options?: SpawnOptions): IProcessHandle {
    const handle = new TauriProcessHandle();

    (async () => {
      try {
        const shell = await getTauriShell();
        const cmd = shell.Command.create(command, args, {
          cwd: options?.cwd,
          env: options?.env,
        });

        cmd.on("close", (data: { code: number }) => {
          handle._emitExit(data.code);
        });

        cmd.on("error", (error: string) => {
          handle._emitError(new Error(error));
        });

        cmd.stdout.on("data", (line: string) => {
          handle._emitStdout(line);
        });

        cmd.stderr.on("data", (line: string) => {
          handle._emitStderr(line);
        });

        const child = await cmd.spawn();
        handle._wireChild({
          pid: child.pid,
          write: (data: string) => child.write(new TextEncoder().encode(data)),
          kill: () => child.kill(),
        });
      } catch (err) {
        handle._emitError(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return handle;
  }

  async exec(command: string, options?: ExecOptions): Promise<{ stdout: string; stderr: string }> {
    const shell = await getTauriShell();
    // Split command into program and args
    const parts = command.split(/\s+/);
    const program = parts[0];
    const args = parts.slice(1);

    const output = await shell.Command.create(program, args, {
      cwd: options?.cwd,
      env: options?.env,
    }).execute();

    if (output.code !== 0) {
      throw new Error(`Command failed (code ${output.code}): ${output.stderr}`);
    }

    return { stdout: output.stdout, stderr: output.stderr };
  }

  execSync(_command: string, _options?: ExecOptions): string {
    throw new Error(
      "execSync is not available in Tauri. Use async exec() instead."
    );
  }

  async which(command: string): Promise<string | null> {
    try {
      const result = await this.exec(`which ${command}`);
      return result.stdout.trim() || null;
    } catch {
      return null;
    }
  }
}

// ─── Tauri File System ────────────────────────────────────────────────────

class TauriFs implements IPlatformFs {
  async readTextFile(path: string): Promise<string> {
    const fs = await getTauriFs();
    return fs.readTextFile(path);
  }

  readTextFileSync(_path: string): string {
    throw new Error("Sync file operations not available in Tauri. Use async methods.");
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    const fs = await getTauriFs();
    await fs.writeTextFile(path, content);
  }

  writeTextFileSync(_path: string, _content: string): void {
    throw new Error("Sync file operations not available in Tauri. Use async methods.");
  }

  async exists(path: string): Promise<boolean> {
    const fs = await getTauriFs();
    return fs.exists(path);
  }

  existsSync(_path: string): boolean {
    throw new Error("Sync file operations not available in Tauri. Use async methods.");
  }

  async readDir(dirPath: string): Promise<DirEntry[]> {
    const fs = await getTauriFs();
    const entries = await fs.readDir(dirPath);
    return entries.map((entry: { name: string; isDirectory: boolean; isFile: boolean }) => ({
      name: entry.name,
      isDirectory: entry.isDirectory,
      isFile: entry.isFile,
      path: `${dirPath}/${entry.name}`,
    }));
  }

  readDirSync(_dirPath: string): DirEntry[] {
    throw new Error("Sync file operations not available in Tauri. Use async methods.");
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const fs = await getTauriFs();
    await fs.mkdir(path, { recursive: options?.recursive ?? false });
  }

  mkdirSync(_path: string, _options?: { recursive?: boolean }): void {
    throw new Error("Sync file operations not available in Tauri. Use async methods.");
  }

  async remove(path: string): Promise<void> {
    const fs = await getTauriFs();
    await fs.remove(path);
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const fs = await getTauriFs();
    await fs.copyFile(src, dest);
  }

  async stat(path: string): Promise<{ isDirectory: boolean; isFile: boolean }> {
    const fs = await getTauriFs();
    const s = await fs.stat(path);
    return { isDirectory: s.isDirectory, isFile: s.isFile };
  }

  statSync(_path: string): { isDirectory: boolean; isFile: boolean } {
    throw new Error("Sync file operations not available in Tauri. Use async methods.");
  }
}

// ─── Tauri Database (SQLite) ──────────────────────────────────────────────

class TauriDb implements IPlatformDb {
  type: DatabaseType = "sqlite";
  private _db: unknown = null;

  isDatabaseConfigured(): boolean {
    return true;
  }

  getDatabase(): unknown {
    if (!this._db) {
      // Lazy-load the SQLite database using indirect require
      // to prevent webpack from bundling better-sqlite3 in web builds.
      try {
        // eslint-disable-next-line no-eval
        const dynamicRequire = eval("require") as NodeRequire;
        const { getSqliteDatabase } = dynamicRequire("@/core/db/sqlite");
        this._db = getSqliteDatabase();
      } catch {
        throw new Error(
          "SQLite database could not be initialized. " +
          "Ensure better-sqlite3 is installed."
        );
      }
    }
    return this._db;
  }

  /** Set a pre-configured database instance (for Tauri SQL plugin integration). */
  setDatabase(db: unknown): void {
    this._db = db;
  }
}

// ─── Tauri Git ────────────────────────────────────────────────────────────

class TauriGit implements IPlatformGit {
  private processAdapter: TauriProcess;

  constructor(processAdapter: TauriProcess) {
    this.processAdapter = processAdapter;
  }

  isAvailable(): boolean {
    return true;
  }

  async isGitRepository(dirPath: string): Promise<boolean> {
    try {
      await this.processAdapter.exec("git rev-parse --is-inside-work-tree", { cwd: dirPath });
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentBranch(repoPath: string): Promise<string> {
    const result = await this.processAdapter.exec("git branch --show-current", { cwd: repoPath });
    return result.stdout.trim();
  }

  async listBranches(repoPath: string): Promise<GitBranchInfo[]> {
    const result = await this.processAdapter.exec("git branch", { cwd: repoPath });
    return result.stdout
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
    const result = await this.processAdapter.exec("git status --porcelain", { cwd: repoPath });
    const lines = result.stdout.split("\n").filter((l) => l.trim());

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

// ─── Tauri Terminal ───────────────────────────────────────────────────────

class TauriTerminal implements IPlatformTerminal {
  private processAdapter: TauriProcess;

  constructor(processAdapter: TauriProcess) {
    this.processAdapter = processAdapter;
  }

  isAvailable(): boolean {
    return true;
  }

  create(
    options: TerminalCreateOptions,
    sessionId: string,
    onOutput: (data: string) => void
  ): ITerminalHandle {
    const command = options.command ?? "/bin/bash";
    const args = options.args ?? [];
    const terminalId = `tauri-term-${Date.now()}-${sessionId}`;
    let output = "";
    let exitCode: number | null = null;

    const proc = this.processAdapter.spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
    });

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
      kill: () => proc.kill(),
      release: () => proc.kill(),
    };
  }
}

// ─── Tauri Dialog ─────────────────────────────────────────────────────────

class TauriDialog implements IPlatformDialog {
  async open(options?: OpenDialogOptions): Promise<string | string[] | null> {
    const dialog = await getTauriDialog();
    const result = await dialog.open({
      title: options?.title,
      defaultPath: options?.defaultPath,
      filters: options?.filters,
      multiple: options?.multiple ?? false,
      directory: options?.directory ?? false,
    });
    return result;
  }

  async save(options?: SaveDialogOptions): Promise<string | null> {
    const dialog = await getTauriDialog();
    return dialog.save({
      title: options?.title,
      defaultPath: options?.defaultPath,
      filters: options?.filters,
    });
  }

  async message(message: string, options?: MessageDialogOptions): Promise<number> {
    const dialog = await getTauriDialog();
    const confirmed = await dialog.message(message, {
      title: options?.title,
      kind: options?.type as "info" | "warning" | "error" | undefined,
    });
    return confirmed ? 1 : 0;
  }
}

// ─── Tauri Shell ──────────────────────────────────────────────────────────

class TauriShell implements IPlatformShell {
  async openUrl(url: string): Promise<void> {
    const shell = await getTauriShell();
    await shell.open(url);
  }

  async openPath(path: string): Promise<void> {
    const shell = await getTauriShell();
    await shell.open(path);
  }
}

// ─── Tauri Environment ────────────────────────────────────────────────────

class TauriEnv implements IPlatformEnv {
  platform = "tauri" as const;

  private _homeDir: string | null = null;
  private _appDataDir: string | null = null;

  isServerless(): boolean {
    return false;
  }

  isDesktop(): boolean {
    return true;
  }

  isTauri(): boolean {
    return true;
  }

  isElectron(): boolean {
    return false;
  }

  homeDir(): string {
    if (this._homeDir) return this._homeDir;
    // Will be set asynchronously via initPaths()
    throw new Error("TauriEnv paths not initialized. Call initPaths() first.");
  }

  appDataDir(): string {
    if (this._appDataDir) return this._appDataDir;
    throw new Error("TauriEnv paths not initialized. Call initPaths() first.");
  }

  currentDir(): string {
    // In Tauri, there's no process.cwd(). Use the app's resource dir or config.
    return this._appDataDir ?? "";
  }

  private _envCache = new Map<string, string | undefined>();

  getEnv(key: string): string | undefined {
    // Return from cache if available (populated by initEnv)
    return this._envCache.get(key);
  }

  /** Pre-fetch commonly used environment variables from Rust backend. */
  async initEnv(): Promise<void> {
    try {
      const core = await getTauriCore();
      const envKeys = ["HOME", "USERPROFILE", "PATH", "DATABASE_URL", "NODE_ENV"];
      for (const key of envKeys) {
        try {
          const value = await core.invoke("get_env", { name: key });
          if (value) this._envCache.set(key, value as string);
        } catch {
          // Key not available
        }
      }
    } catch (err) {
      console.error("[TauriEnv] Failed to initialize env:", err);
    }
  }

  osPlatform(): string {
    // Detect from navigator or Tauri OS info
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    if (ua.includes("Win")) return "win32";
    if (ua.includes("Mac")) return "darwin";
    return "linux";
  }

  /** Initialize async paths. Call once during app startup. */
  async initPaths(): Promise<void> {
    try {
      const pathApi = await getTauriPath();
      this._homeDir = await pathApi.homeDir();
      this._appDataDir = await pathApi.appDataDir();
    } catch (err) {
      console.error("[TauriEnv] Failed to initialize paths:", err);
    }
  }
}

// ─── Tauri Events ─────────────────────────────────────────────────────────

class TauriEvents implements IPlatformEvents {
  listen(event: string, handler: EventHandler): UnlistenFn {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const eventApi = await getTauriEvent();
        if (cancelled) return;
        const unlistenFn = await eventApi.listen(event, (e: { payload: unknown }) => {
          handler(e.payload);
        });
        if (cancelled) {
          unlistenFn();
        } else {
          unlisten = unlistenFn;
        }
      } catch (err) {
        console.error(`[TauriEvents] Failed to listen to "${event}":`, err);
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }

  async emit(event: string, payload?: unknown): Promise<void> {
    const eventApi = await getTauriEvent();
    await eventApi.emit(event, payload);
  }
}

// ─── Tauri Platform Bridge ────────────────────────────────────────────────

export class TauriPlatformBridge implements IPlatformBridge {
  platform = "tauri" as const;

  env: TauriEnv;
  process: IPlatformProcess;
  fs: IPlatformFs;
  db: IPlatformDb;
  git: IPlatformGit;
  terminal: IPlatformTerminal;
  dialog: IPlatformDialog;
  shell: IPlatformShell;
  events: IPlatformEvents;

  constructor() {
    this.env = new TauriEnv();
    const tauriProcess = new TauriProcess();

    this.process = tauriProcess;
    this.fs = new TauriFs();
    this.db = new TauriDb();
    this.git = new TauriGit(tauriProcess);
    this.terminal = new TauriTerminal(tauriProcess);
    this.dialog = new TauriDialog();
    this.shell = new TauriShell();
    this.events = new TauriEvents();
  }

  /** Initialize async resources. Call once during app startup. */
  async initialize(): Promise<void> {
    await this.env.initPaths();
    await this.env.initEnv();
  }

  async invoke<T = unknown>(channel: string, data?: unknown): Promise<T> {
    const core = await getTauriCore();
    return core.invoke(channel, data as Record<string, unknown>) as Promise<T>;
  }
}
