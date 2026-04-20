import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

import { TerminalManager } from "../terminal-manager";
import type { IProcessHandle, WritableStreamLike } from "@/core/platform/interfaces";

class FakeWritable implements WritableStreamLike {
  writable = true;
  writes: Array<string | Buffer> = [];

  write(data: string | Buffer): boolean {
    this.writes.push(data);
    return true;
  }
}

class FakeProcess extends EventEmitter implements IProcessHandle {
  pid = 1234;
  stdin = new FakeWritable();
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;

  kill(): void {
    this.emit("exit", 0, null);
  }
}

class FakeNodePty extends EventEmitter {
  pid = 4321;
  writes: string[] = [];
  resizes: Array<{ cols: number; rows: number }> = [];

  write(data: string): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }

  kill(_signal?: string): void {
    this.emit("exit", { exitCode: 0 });
  }

  onData(handler: (data: string) => void): { dispose(): void } {
    this.on("data", handler);
    return { dispose: () => this.off("data", handler) };
  }

  onExit(handler: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.on("exit", handler);
    return { dispose: () => this.off("exit", handler) };
  }
}

const spawnMock = vi.fn();
vi.mock("@/core/platform", () => ({
  getServerBridge: () => ({
    process: {
      isAvailable: () => true,
      spawn: spawnMock,
      execSync: vi.fn(),
    },
  }),
}));

describe("TerminalManager", () => {
  let manager: TerminalManager;
  let process: FakeProcess;

  beforeEach(() => {
    manager = new TerminalManager({ enableNodePty: false });
    process = new FakeProcess();
    spawnMock.mockReset();
    spawnMock.mockReturnValue(process);
  });

  it("writes browser input back to the spawned terminal process", () => {
    const result = manager.create(
      { command: "/bin/sh", args: ["-c", "cat"] },
      "session-1",
      vi.fn(),
    );

    expect(manager.hasTerminal("session-1", result.terminalId)).toBe(true);

    manager.write(result.terminalId, "ls -la\n");

    expect(process.stdin.writes).toEqual(["ls -la\n"]);
  });

  it("tracks resize metadata without a PTY backend", () => {
    const result = manager.create(
      { command: "/bin/sh", args: ["-c", "cat"], cols: 80, rows: 24 },
      "session-1",
      vi.fn(),
    );

    expect(() => manager.resize(result.terminalId, 120, 40)).not.toThrow();
    expect(process.stdin.writes).toEqual([]);
  });

  it("prefers node-pty when available and writes terminal data directly", () => {
    const nodePty = new FakeNodePty();
    manager = new TerminalManager({ enableNodePty: true });
    vi.spyOn(manager as any, "loadNodePty").mockReturnValue({
      spawn: vi.fn(() => nodePty),
    });

    const emitNotification = vi.fn();
    const result = manager.create(
      { command: "/bin/sh", args: ["-c", "cat"], cols: 80, rows: 24 },
      "session-1",
      emitNotification,
    );

    manager.write(result.terminalId, "echo hello\n");
    manager.resize(result.terminalId, 120, 40);
    nodePty.emit("data", "pty output");

    expect(spawnMock).not.toHaveBeenCalled();
    expect(nodePty.writes).toEqual(["echo hello\n"]);
    expect(nodePty.resizes).toEqual([{ cols: 120, rows: 40 }]);
    expect(manager.getOutput(result.terminalId)).toEqual({
      output: "pty output",
      truncated: false,
    });
    expect(emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "terminal_output",
          data: "pty output",
        }),
      }),
    }));
  });

  it("emits terminal_exited when the node-pty backend exits", async () => {
    const nodePty = new FakeNodePty();
    manager = new TerminalManager({ enableNodePty: true });
    vi.spyOn(manager as any, "loadNodePty").mockReturnValue({
      spawn: vi.fn(() => nodePty),
    });

    const emitNotification = vi.fn();
    const result = manager.create(
      { command: "/bin/sh", args: ["-c", "exit 7"] },
      "session-1",
      emitNotification,
    );

    nodePty.emit("exit", { exitCode: 7 });

    await expect(manager.waitForExit(result.terminalId)).resolves.toEqual({
      exitCode: 7,
      signal: null,
    });
    expect(emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "terminal_exited",
          exitCode: 7,
        }),
      }),
    }));
  });

  it("returns ACP-shaped terminal output and exit status", async () => {
    const emitNotification = vi.fn();
    const result = manager.create(
      { command: "/bin/sh", args: ["-c", "printf test"] },
      "session-1",
      emitNotification,
    );

    process.stdout.emit("data", Buffer.from("test", "utf-8"));
    process.emit("exit", 0, null);

    expect(manager.getOutput(result.terminalId)).toEqual({
      output: "test",
      truncated: false,
      exitStatus: {
        exitCode: 0,
        signal: null,
      },
    });
    await expect(manager.waitForExit(result.terminalId)).resolves.toEqual({
      exitCode: 0,
      signal: null,
    });
  });

  it("normalizes ACP env arrays when creating terminals", () => {
    manager.create(
      {
        command: "/bin/sh",
        args: ["-c", "env"],
        env: [
          { name: "FOO", value: "bar" },
          { name: "BAZ", value: "qux" },
        ],
      },
      "session-1",
      vi.fn(),
    );

    expect(spawnMock).toHaveBeenCalledWith(
      "/bin/sh",
      ["-c", "env"],
      expect.objectContaining({
        env: expect.objectContaining({
          FOO: "bar",
          BAZ: "qux",
        }),
      }),
    );
  });
});
