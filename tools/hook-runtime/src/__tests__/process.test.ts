import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
  default: { spawn: spawnMock },
}));

import { runCommand } from "../process.js";

type MockChildProcess = EventEmitter & {
  exitCode: number | null;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
  pid: number;
  signalCode: NodeJS.Signals | null;
  stderr: EventEmitter;
  stdout: EventEmitter;
};

function createMockChildProcess(pid = 4321): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.pid = pid;
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn((signal: NodeJS.Signals) => {
    child.killed = true;
    child.signalCode = signal;
    return true;
  });
  return child;
}

describe("runCommand", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("kills the shell process group on timeout so pipeline children do not hang the caller", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child);
    const processKillSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const resultPromise = runCommand("sleep 10 | cat", { stream: false, timeoutMs: 50 });

    await vi.advanceTimersByTimeAsync(50);

    expect(spawnMock).toHaveBeenCalledWith("/bin/bash", ["-lc", "sleep 10 | cat"], expect.objectContaining({
      detached: true,
    }));
    expect(processKillSpy).toHaveBeenCalledWith(-4321, "SIGTERM");

    child.signalCode = "SIGTERM";
    child.emit("close", null);

    const result = await resultPromise;

    expect(result.exitCode).toBe(124);
    expect(result.output).toContain("Command timed out after 50ms");
  });
});
