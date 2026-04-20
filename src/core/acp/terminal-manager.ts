/**
 * TerminalManager - Server-side terminal process manager for ACP terminal operations.
 *
 * Handles terminal/create, terminal/output, terminal/release, terminal/wait_for_exit,
 * terminal/kill requests from ACP agents by spawning real shell processes.
 *
 * Terminal output is forwarded to the client via session/update notifications
 * with sessionUpdate type "terminal_output" for rendering in xterm.js.
 *
 * Uses the platform bridge for process spawning, enabling support across
 * Web (Node.js), Tauri, and Electron environments.
 */

import fs from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";

import type { IProcessHandle } from "@/core/platform/interfaces";
import { getServerBridge } from "@/core/platform";

export type TerminalNotificationEmitter = (notification: {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}) => void;

interface ManagedTerminal {
  terminalId: string;
  sessionId: string;
  process: IProcessHandle;
  output: string;
  exitCode: number | null;
  signal: string | null;
  exited: boolean;
  exitPromise: Promise<number>;
  createdAt: Date;
  cols?: number;
  rows?: number;
  backend: "node-pty" | "spawn";
  exitNotified?: boolean;
  ptyProcess?: NodePtyProcessHandle;
}

interface NodePtyTerminal {
  pid?: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(handler: (data: string) => void): { dispose(): void } | void;
  onExit(handler: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } | void;
}

interface NodePtyModule {
  spawn(
    file: string,
    args?: string[],
    options?: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
    },
  ): NodePtyTerminal;
}

class NodePtyProcessHandle extends EventEmitter implements IProcessHandle {
  pid: number | undefined;
  stdin;
  stdout;
  stderr = null;
  exitCode: number | null = null;

  constructor(private readonly pty: NodePtyTerminal) {
    super();
    this.pid = pty.pid;
    this.stdin = {
      writable: true,
      write: (data: string | Buffer) => {
        this.pty.write(typeof data === "string" ? data : data.toString("utf-8"));
        return true;
      },
    };
    this.stdout = {
      on: (event: "data", handler: (chunk: Buffer) => void) => {
        if (event !== "data") return;
        this.pty.onData((data) => {
          handler(Buffer.from(data, "utf-8"));
        });
      },
    };

    this.pty.onExit(({ exitCode, signal }) => {
      this.exitCode = exitCode;
      this.emit("exit", exitCode, signal == null ? null : String(signal));
    });
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }

  kill(signal?: string): void {
    this.pty.kill(signal);
  }
}

interface TerminalManagerOptions {
  enableNodePty?: boolean;
}

export class TerminalManager {
  private terminals = new Map<string, ManagedTerminal>();
  private terminalCounter = 0;
  private nodePtyModule: NodePtyModule | null | undefined;

  constructor(private readonly options: TerminalManagerOptions = {}) {}

  /**
   * Create a terminal process.
   *
   * @param params - terminal/create params from the agent
   * @param sessionId - ACP session ID for notification routing
   * @param emitNotification - callback to emit session/update notifications
   * @returns { terminalId } for the created terminal
   */
  create(
    params: Record<string, unknown>,
    sessionId: string,
    emitNotification: TerminalNotificationEmitter
  ): { terminalId: string } {
    const terminalId = `term-${++this.terminalCounter}-${Date.now()}`;

    // Extract command from params
    const command = (params.command as string) ?? "/bin/bash";
    const args = (params.args as string[]) ?? [];
    const cwd = (params.cwd as string) ?? process.cwd();
    const env = this.normalizeEnv(params.env);

    console.log(
      `[TerminalManager] Creating terminal ${terminalId}: ${command} ${args.join(" ")} (cwd: ${cwd})`
    );

    // Emit terminal_created notification so the client knows to show a terminal
    emitNotification({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "terminal_created",
          terminalId,
          command,
          args,
        },
      },
    });

    const bridge = getServerBridge();
    if (!bridge.process.isAvailable()) {
      throw new Error("Process spawning is not available on this platform");
    }

    const mergedEnv = {
      ...env,
      FORCE_COLOR: "1",
      TERM: "xterm-256color",
    };
    const rows = typeof params.rows === "number" ? params.rows : undefined;
    const cols = typeof params.cols === "number" ? params.cols : undefined;

    const nodePty = this.loadNodePty();
    const proc = nodePty
      ? new NodePtyProcessHandle(
          nodePty.spawn(command, args, {
            name: mergedEnv.TERM,
            cwd,
            env: { ...process.env, ...mergedEnv },
            cols: cols ?? 80,
            rows: rows ?? 24,
          }),
        )
      : bridge.process.spawn(command, args, {
          stdio: ["pipe", "pipe", "pipe"],
          cwd,
          env: { ...process.env, ...mergedEnv },
          shell: true,
        });
    const backend: ManagedTerminal["backend"] = nodePty ? "node-pty" : "spawn";

    const output = "";
    let exitResolve: (code: number) => void;
    const exitPromise = new Promise<number>((resolve) => {
      exitResolve = resolve;
    });

    const managed: ManagedTerminal = {
      terminalId,
      sessionId,
      process: proc,
      output,
      exitCode: null,
      signal: null,
      exited: false,
      exitPromise,
      createdAt: new Date(),
      cols,
      rows,
      backend,
      exitNotified: false,
      ptyProcess: proc instanceof NodePtyProcessHandle ? proc : undefined,
    };

    // Capture stdout
    proc.stdout?.on("data", (chunk: Buffer) => {
      const data = chunk.toString("utf-8");
      this.appendOutput(managed, data, emitNotification);
    });

    // Capture stderr (merge into terminal output)
    proc.stderr?.on("data", (chunk: Buffer) => {
      const data = chunk.toString("utf-8");
      this.appendOutput(managed, data, emitNotification);
    });

    // Handle process exit
    proc.on("exit", (code, signal) => {
      console.log(
        `[TerminalManager] Terminal ${terminalId} exited: code=${code}, signal=${signal}`
      );
      this.markExited(managed, code, signal == null ? null : String(signal), emitNotification);
      exitResolve!(managed.exitCode ?? 0);
    });

    proc.on("error", (err) => {
      console.error(
        `[TerminalManager] Terminal ${terminalId} error:`,
        err
      );
      managed.exited = true;
      managed.exitCode = 1;
      exitResolve!(1);
    });

    this.terminals.set(terminalId, managed);

    return { terminalId };
  }

  /**
   * Get accumulated output for a terminal.
   */
  getOutput(terminalId: string): {
    output: string;
    truncated: boolean;
    exitStatus?: {
      exitCode: number | null;
      signal: string | null;
    };
  } {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return { output: "", truncated: false };
    }
    return {
      output: terminal.output,
      truncated: false,
      ...(terminal.exited
        ? {
            exitStatus: {
              exitCode: terminal.exitCode,
              signal: terminal.signal,
            },
          }
        : {}),
    };
  }

  hasTerminal(sessionId: string, terminalId: string): boolean {
    const terminal = this.terminals.get(terminalId);
    return terminal?.sessionId === sessionId;
  }

  write(terminalId: string, data: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal || terminal.exited || !terminal.process.stdin?.writable) {
      throw new Error("Terminal is not writable");
    }

    terminal.process.stdin.write(data);
  }

  resize(terminalId: string, cols?: number, rows?: number): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal || terminal.exited) {
      throw new Error("Terminal not found");
    }

    terminal.cols = typeof cols === "number" ? cols : terminal.cols;
    terminal.rows = typeof rows === "number" ? rows : terminal.rows;
    if (terminal.backend === "node-pty" && terminal.ptyProcess && terminal.cols && terminal.rows) {
      terminal.ptyProcess.resize(terminal.cols, terminal.rows);
      return;
    }
  }

  private normalizeEnv(envValue: unknown): Record<string, string> {
    if (Array.isArray(envValue)) {
      return Object.fromEntries(
        envValue.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const name = typeof (entry as { name?: unknown }).name === "string"
            ? (entry as { name: string }).name
            : undefined;
          const value = typeof (entry as { value?: unknown }).value === "string"
            ? (entry as { value: string }).value
            : undefined;
          return name && value !== undefined ? [[name, value]] : [];
        }),
      );
    }

    if (envValue && typeof envValue === "object") {
      return Object.fromEntries(
        Object.entries(envValue).flatMap(([key, value]) => (
          typeof value === "string" ? [[key, value]] : []
        )),
      );
    }

    return {};
  }

  private appendOutput(
    terminal: ManagedTerminal,
    data: string,
    emitNotification: TerminalNotificationEmitter,
  ): void {
    terminal.output += data;
    emitNotification({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: terminal.sessionId,
        update: {
          sessionUpdate: "terminal_output",
          terminalId: terminal.terminalId,
          data,
        },
      },
    });
  }

  private markExited(
    terminal: ManagedTerminal,
    exitCode: number | null,
    signal: string | null,
    emitNotification: TerminalNotificationEmitter,
  ): void {
    if (terminal.exitNotified) return;
    terminal.exitCode = exitCode;
    terminal.signal = signal;
    terminal.exited = true;
    terminal.exitNotified = true;
    emitNotification({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: terminal.sessionId,
        update: {
          sessionUpdate: "terminal_exited",
          terminalId: terminal.terminalId,
          exitCode: exitCode ?? 0,
        },
      },
    });
  }

  private loadNodePty(): NodePtyModule | null {
    if (this.options.enableNodePty === false) {
      return null;
    }
    if (this.nodePtyModule !== undefined) {
      return this.nodePtyModule;
    }

    try {
      // Loaded dynamically because this native module is optional and only needed on server runtimes.
      this.ensureNodePtySpawnHelperExecutable();
      const nodePty = require("node-pty") as NodePtyModule;
      this.nodePtyModule = typeof nodePty?.spawn === "function" ? nodePty : null;
    } catch {
      this.nodePtyModule = null;
    }

    return this.nodePtyModule;
  }

  private ensureNodePtySpawnHelperExecutable(): void {
    if (process.platform === "win32") {
      return;
    }

    try {
      const packageJsonPath = require.resolve("node-pty/package.json");
      const helperPath = path.join(
        path.dirname(packageJsonPath),
        "prebuilds",
        `${process.platform}-${process.arch}`,
        "spawn-helper",
      );
      if (!fs.existsSync(helperPath)) {
        return;
      }

      const currentMode = fs.statSync(helperPath).mode & 0o777;
      if ((currentMode & 0o111) !== 0o111) {
        fs.chmodSync(helperPath, 0o755);
      }
    } catch {
      // If we cannot normalize helper permissions, node-pty loading will fall back to plain spawn.
    }
  }

  /**
   * Wait for a terminal process to exit.
   */
  async waitForExit(terminalId: string): Promise<{ exitCode: number | null; signal: string | null }> {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return { exitCode: null, signal: null };
    }

    if (terminal.exited) {
      return { exitCode: terminal.exitCode, signal: terminal.signal };
    }

    await terminal.exitPromise;
    return { exitCode: terminal.exitCode, signal: terminal.signal };
  }

  /**
   * Kill a terminal process.
   */
  kill(terminalId: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal || terminal.exited) return;

    console.log(`[TerminalManager] Killing terminal ${terminalId}`);

    try {
      terminal.process.kill("SIGTERM");
      // Force kill after 3 seconds
      setTimeout(() => {
        if (!terminal.exited) {
          terminal.process.kill("SIGKILL");
        }
      }, 3000);
    } catch (err) {
      console.error(
        `[TerminalManager] Error killing terminal ${terminalId}:`,
        err
      );
    }
  }

  /**
   * Release terminal resources.
   */
  release(terminalId: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;

    console.log(`[TerminalManager] Releasing terminal ${terminalId}`);

    if (!terminal.exited) {
      this.kill(terminalId);
    }
    this.terminals.delete(terminalId);
  }

  /**
   * Dispose of all terminals.
   */
  disposeAll(): void {
    for (const [id] of this.terminals) {
      this.release(id);
    }
  }
}

// Singleton
let singleton: TerminalManager | undefined;

export function getTerminalManager(): TerminalManager {
  if (!singleton) {
    singleton = new TerminalManager();
  }
  return singleton;
}
