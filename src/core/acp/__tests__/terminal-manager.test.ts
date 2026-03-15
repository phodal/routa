/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("@/core/platform", () => ({
  getServerBridge: () => ({
    process: {
      isAvailable: () => true,
      spawn: spawnMock,
    },
  }),
}));

import { TerminalManager } from "../terminal-manager";

function createProcessHandle() {
  const listeners: Record<string, (value?: unknown, signal?: string | null) => void> = {};
  const writes: string[] = [];

  return {
    handle: {
      pid: 1234,
      stdin: {
        writable: true,
        write(data: string | Buffer) {
          writes.push(data.toString());
          return true;
        },
      },
      stdout: {
        on: vi.fn(),
      },
      stderr: {
        on: vi.fn(),
      },
      exitCode: null,
      kill: vi.fn(),
      on(event: "exit" | "error", handler: (value: unknown, signal?: string | null) => void) {
        listeners[event] = handler;
      },
    },
    writes,
    listeners,
  };
}

describe("TerminalManager", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("passes shell mode through to spawn and normalizes carriage return writes", () => {
    const proc = createProcessHandle();
    spawnMock.mockReturnValue(proc.handle);

    const manager = new TerminalManager();
    const notifications: Array<Record<string, unknown>> = [];

    const result = manager.create(
      {
        command: "/bin/bash",
        shell: false,
      },
      "session-1",
      (notification) => notifications.push(notification),
    );

    expect(result.terminalId).toMatch(/^term-/);
    expect(spawnMock).toHaveBeenCalledWith(
      "/bin/bash",
      [],
      expect.objectContaining({
        shell: false,
      }),
    );
    expect(notifications).toHaveLength(1);

    const writeResult = manager.write(result.terminalId, "echo ok\r");
    expect(writeResult.ok).toBe(true);
    expect(proc.writes).toEqual(["echo ok\n"]);
  });

  it("returns ok=false when attempting to write to a missing terminal", () => {
    const manager = new TerminalManager();

    expect(manager.write("missing-terminal", "pwd\r")).toEqual({ ok: false });
  });
});
