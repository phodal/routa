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

import type { IProcessHandle } from "@/core/platform/interfaces";
import { getServerBridge } from "@/core/platform";

export type TerminalNotificationEmitter = (notification: {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}) => void;

interface ManagedTerminal {
  terminalId: string;
  process: IProcessHandle;
  output: string;
  exitCode: number | null;
  exited: boolean;
  exitPromise: Promise<number>;
  createdAt: Date;
}

export class TerminalManager {
  private terminals = new Map<string, ManagedTerminal>();
  private terminalCounter = 0;

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
    const env = (params.env as Record<string, string>) ?? {};

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

    const proc = bridge.process.spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
      env: {
        ...env,
        FORCE_COLOR: "1",
        TERM: "xterm-256color",
      },
      shell: true,
    });

    let output = "";
    let exitResolve: (code: number) => void;
    const exitPromise = new Promise<number>((resolve) => {
      exitResolve = resolve;
    });

    const managed: ManagedTerminal = {
      terminalId,
      process: proc,
      output,
      exitCode: null,
      exited: false,
      exitPromise,
      createdAt: new Date(),
    };

    // Capture stdout
    proc.stdout?.on("data", (chunk: Buffer) => {
      const data = chunk.toString("utf-8");
      managed.output += data;

      // Forward output to client via notification
      emitNotification({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "terminal_output",
            terminalId,
            data,
          },
        },
      });
    });

    // Capture stderr (merge into terminal output)
    proc.stderr?.on("data", (chunk: Buffer) => {
      const data = chunk.toString("utf-8");
      managed.output += data;

      // Forward stderr as terminal output too
      emitNotification({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "terminal_output",
            terminalId,
            data,
          },
        },
      });
    });

    // Handle process exit
    proc.on("exit", (code, signal) => {
      console.log(
        `[TerminalManager] Terminal ${terminalId} exited: code=${code}, signal=${signal}`
      );
      managed.exitCode = code ?? (signal ? 128 : 0);
      managed.exited = true;
      exitResolve!(managed.exitCode);

      // Notify client of terminal exit
      emitNotification({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "terminal_exited",
            terminalId,
            exitCode: managed.exitCode,
          },
        },
      });
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
  getOutput(terminalId: string): { output: string } {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return { output: "" };
    }
    return { output: terminal.output };
  }

  /**
   * Wait for a terminal process to exit.
   */
  async waitForExit(terminalId: string): Promise<{ exitCode: number }> {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return { exitCode: -1 };
    }

    if (terminal.exited) {
      return { exitCode: terminal.exitCode ?? 0 };
    }

    const exitCode = await terminal.exitPromise;
    return { exitCode };
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
