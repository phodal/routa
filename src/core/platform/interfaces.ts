/**
 * Platform Abstraction Interfaces
 *
 * Defines the contracts for platform-specific capabilities.
 * Each platform (Web/Vercel, Tauri, Electron) provides its own implementation.
 *
 * Design reference: intent Electron Bridge pattern — a unified interface
 * that abstracts IPC, dialogs, shell, and events across platforms.
 */

// ─── Platform Types ───────────────────────────────────────────────────────

export type PlatformType = "web" | "tauri" | "electron";

// ─── Process Management ───────────────────────────────────────────────────

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  shell?: boolean;
  detached?: boolean;
  stdio?: ("pipe" | "inherit" | "ignore")[];
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  encoding?: string;
}

export interface IProcessHandle {
  pid: number | undefined;
  stdin: WritableStreamLike | null;
  stdout: ReadableStreamLike | null;
  stderr: ReadableStreamLike | null;
  exitCode: number | null;
  /** Resolves when the process has been spawned and pid is available (Tauri async spawn). */
  ready?: Promise<void>;
  kill(signal?: string): void;
  on(event: "exit", handler: (code: number | null, signal: string | null) => void): void;
  on(event: "error", handler: (err: Error) => void): void;
}

export interface WritableStreamLike {
  writable: boolean;
  write(data: string | Buffer): boolean;
}

export interface ReadableStreamLike {
  on(event: "data", handler: (chunk: Buffer) => void): void;
}

/**
 * Platform process management.
 * - Web/Vercel: Not available (isAvailable = false), throws on spawn/exec
 * - Tauri: Uses Tauri Shell Plugin / sidecar
 * - Electron: Uses Node.js child_process
 */
export interface IPlatformProcess {
  /** Whether process spawning is available on this platform */
  isAvailable(): boolean;

  /** Spawn a child process. Returns a handle for stdio communication. */
  spawn(command: string, args: string[], options?: SpawnOptions): IProcessHandle;

  /** Execute a command and return stdout/stderr. */
  exec(command: string, options?: ExecOptions): Promise<{ stdout: string; stderr: string }>;

  /** Execute a command synchronously and return stdout. */
  execSync(command: string, options?: ExecOptions): string;

  /** Check if a command exists in PATH. */
  which(command: string): Promise<string | null>;
}

// ─── File System ──────────────────────────────────────────────────────────

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  path: string;
}

/**
 * Platform file system operations.
 * - Web/Vercel: Limited (read-only or API-backed)
 * - Tauri: Uses @tauri-apps/plugin-fs
 * - Electron: Uses Node.js fs
 */
export interface IPlatformFs {
  readTextFile(path: string): Promise<string>;
  readTextFileSync(path: string): string;
  writeTextFile(path: string, content: string): Promise<void>;
  writeTextFileSync(path: string, content: string): void;
  exists(path: string): Promise<boolean>;
  existsSync(path: string): boolean;
  readDir(path: string): Promise<DirEntry[]>;
  readDirSync(path: string): DirEntry[];
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  remove(path: string): Promise<void>;
  copyFile(src: string, dest: string): Promise<void>;
  stat(path: string): Promise<{ isDirectory: boolean; isFile: boolean }>;
  statSync(path: string): { isDirectory: boolean; isFile: boolean };
}

// ─── Database ─────────────────────────────────────────────────────────────

export type DatabaseType = "postgres" | "sqlite" | "memory";

/**
 * Platform database provider.
 * - Web/Vercel: Neon Postgres (drizzle-orm/neon-http)
 * - Tauri: SQLite (drizzle-orm/better-sqlite3 or Tauri SQL plugin)
 * - Electron: SQLite
 * - Dev/Test: InMemory
 */
export interface IPlatformDb {
  type: DatabaseType;
  isDatabaseConfigured(): boolean;
  /** Returns a Drizzle database instance. The concrete type varies by platform. */
  getDatabase(): unknown;
}

// ─── Dialog ───────────────────────────────────────────────────────────────

export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  multiple?: boolean;
  directory?: boolean;
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}

export interface MessageDialogOptions {
  title?: string;
  type?: "info" | "warning" | "error";
  buttons?: string[];
}

/**
 * Platform native dialog.
 * - Web: Browser file input / window.confirm
 * - Tauri: @tauri-apps/plugin-dialog
 * - Electron: electron.dialog
 */
export interface IPlatformDialog {
  open(options?: OpenDialogOptions): Promise<string | string[] | null>;
  save(options?: SaveDialogOptions): Promise<string | null>;
  message(message: string, options?: MessageDialogOptions): Promise<number>;
}

// ─── Shell ────────────────────────────────────────────────────────────────

/**
 * Platform shell operations (open URLs, open file in default app).
 * - Web: window.open()
 * - Tauri: @tauri-apps/plugin-shell
 * - Electron: shell.openExternal
 */
export interface IPlatformShell {
  openUrl(url: string): Promise<void>;
  openPath(path: string): Promise<void>;
}

// ─── Terminal ─────────────────────────────────────────────────────────────

export interface TerminalCreateOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface ITerminalHandle {
  terminalId: string;
  getOutput(): string;
  waitForExit(): Promise<{ exitCode: number }>;
  kill(): void;
  release(): void;
}

/**
 * Platform terminal management for ACP terminal operations.
 * - Web/Vercel: Not available
 * - Tauri: Tauri Shell Plugin
 * - Electron: node-pty or child_process
 */
export interface IPlatformTerminal {
  isAvailable(): boolean;
  create(
    options: TerminalCreateOptions,
    sessionId: string,
    onOutput: (data: string) => void
  ): ITerminalHandle;
}

// ─── Git ──────────────────────────────────────────────────────────────────

export interface GitBranchInfo {
  name: string;
  isCurrent: boolean;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string;
  modified: string[];
  staged: string[];
  untracked: string[];
}

/**
 * Platform git operations.
 * - Web/Vercel: Limited or uses GitHub API
 * - Tauri/Electron: Local git CLI via process.exec
 */
export interface IPlatformGit {
  isAvailable(): boolean;
  isGitRepository(dirPath: string): Promise<boolean>;
  getCurrentBranch(repoPath: string): Promise<string>;
  listBranches(repoPath: string): Promise<GitBranchInfo[]>;
  getStatus(repoPath: string): Promise<GitStatus>;
  clone(url: string, targetDir: string, onProgress?: (msg: string) => void): Promise<void>;
  fetch(repoPath: string): Promise<void>;
  pull(repoPath: string, branch?: string): Promise<void>;
  checkout(repoPath: string, branch: string): Promise<void>;
}

// ─── Environment ──────────────────────────────────────────────────────────

/**
 * Platform environment detection and path resolution.
 */
export interface IPlatformEnv {
  /** Current platform type */
  platform: PlatformType;

  /** Running in serverless environment (Vercel, AWS Lambda, etc.) */
  isServerless(): boolean;

  /** Running as desktop app (Tauri or Electron) */
  isDesktop(): boolean;

  /** Running in Tauri */
  isTauri(): boolean;

  /** Running in Electron */
  isElectron(): boolean;

  /** User home directory */
  homeDir(): string;

  /** Application data directory (for storing config, db, etc.) */
  appDataDir(): string;

  /** Current working directory */
  currentDir(): string;

  /** Read an environment variable */
  getEnv(key: string): string | undefined;

  /** OS platform (darwin, win32, linux) */
  osPlatform(): string;
}

// ─── Event System ─────────────────────────────────────────────────────────

export type EventHandler = (payload: unknown) => void;
export type UnlistenFn = () => void;

/**
 * Platform event system for IPC-like communication.
 * - Web: CustomEvent / EventSource (SSE)
 * - Tauri: @tauri-apps/api event system
 * - Electron: ipcRenderer
 */
export interface IPlatformEvents {
  listen(event: string, handler: EventHandler): UnlistenFn;
  emit(event: string, payload?: unknown): Promise<void>;
}

// ─── Top-Level Bridge ─────────────────────────────────────────────────────

/**
 * The main platform bridge that aggregates all platform-specific capabilities.
 *
 * Usage:
 *   const bridge = getPlatformBridge();
 *   if (bridge.process.isAvailable()) {
 *     const handle = bridge.process.spawn('git', ['status']);
 *   }
 *
 * Inspired by the intent Electron Bridge pattern where a single bridge
 * object provides invoke/listen/emit + sub-modules (dialog, shell, etc.)
 */
export interface IPlatformBridge {
  /** Which platform this bridge represents */
  platform: PlatformType;

  /** IPC-style invoke (Tauri: invoke, Electron: ipcRenderer.invoke, Web: fetch) */
  invoke<T = unknown>(channel: string, data?: unknown): Promise<T>;

  /** Event system */
  events: IPlatformEvents;

  /** Sub-modules */
  process: IPlatformProcess;
  fs: IPlatformFs;
  db: IPlatformDb;
  git: IPlatformGit;
  terminal: IPlatformTerminal;
  dialog: IPlatformDialog;
  shell: IPlatformShell;
  env: IPlatformEnv;
}
