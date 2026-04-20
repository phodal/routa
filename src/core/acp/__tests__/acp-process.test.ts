import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IProcessHandle, WritableStreamLike } from "@/core/platform/interfaces";

const spawnMock = vi.hoisted(() => vi.fn());
const isAvailableMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/core/platform", () => ({
  getServerBridge: () => ({
    process: {
      isAvailable: isAvailableMock,
      spawn: spawnMock,
      execSync: vi.fn(),
    },
  }),
}));

import { AcpProcess } from "../acp-process";

class FakeWritable implements WritableStreamLike {
  writable = true;
  writes: Array<string | Buffer> = [];

  write(data: string | Buffer): boolean {
    this.writes.push(data);
    return true;
  }
}

class FakeProcess extends EventEmitter implements IProcessHandle {
  pid: number | undefined = 1234;
  stdin: WritableStreamLike | null = new FakeWritable();
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;

  kill(): void {
    this.exitCode = 0;
    this.emit("exit", 0, null);
  }
}

describe("AcpProcess codex permission handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAvailableMock.mockReturnValue(true);
    spawnMock.mockReset();
  });

  function createProcess(onNotification = vi.fn()) {
    return new AcpProcess({
      command: "codex-acp",
      args: [],
      cwd: "/tmp",
      displayName: "Codex",
    }, onNotification);
  }

  it("auto-approves codex permission requests even without explicit session auto-approval", () => {
    const onNotification = vi.fn();
    const process = createProcess(onNotification);
    const writeMessage = vi.fn();

    process.setSessionContext({
      sessionId: "session-1",
      provider: "codex",
      role: "CRAFTER",
    });

    (process as any).writeMessage = writeMessage;
    (process as any).handleAgentRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "session/request_permission",
      params: {
        permissions: {
          file_system: {
            write: ["/tmp/outside"],
          },
        },
      },
    });

    expect(writeMessage).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: 7,
      result: {
        outcome: {
          outcome: "selected",
          optionId: "approved",
        },
      },
    });
    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({
      method: "session/update",
      params: expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call_update",
          status: "completed",
          kind: "request-permissions",
        }),
      }),
    }));
  });

  it("selects the approved option for codex option-based permission requests", () => {
    const process = createProcess();
    const writeMessage = vi.fn();

    process.setSessionContext({
      sessionId: "session-1",
      provider: "codex",
      role: "CRAFTER",
    });

    (process as any).writeMessage = writeMessage;
    (process as any).handleAgentRequest({
      jsonrpc: "2.0",
      id: 9,
      method: "session/request_permission",
      params: {
        options: [
          { optionId: "approved-for-session", kind: "allow_always" },
          { optionId: "approved", kind: "allow_once" },
          { optionId: "abort", kind: "reject_once" },
        ],
      },
    });

    expect(writeMessage).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: 9,
      result: {
        outcome: {
          outcome: "selected",
          optionId: "approved",
        },
      },
    });
  });

  it("maps manual codex permission responses to option selections", () => {
    const process = createProcess();
    const writeMessage = vi.fn();

    process.setSessionContext({
      sessionId: "session-1",
      provider: "codex",
      role: "CRAFTER",
    });

    (process as any).writeMessage = writeMessage;
    (process as any).pendingInteractiveRequests.set("request-permission-1", {
      requestId: 10,
      method: "session/request_permission",
      params: {
        options: [
          { optionId: "approved-for-session", kind: "allow_always" },
          { optionId: "approved", kind: "allow_once" },
          { optionId: "abort", kind: "reject_once" },
        ],
      },
    });

    const handled = process.respondToUserInput("request-permission-1", {
      decision: "approve",
      scope: "session",
    });

    expect(handled).toBe(true);
    expect(writeMessage).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: 10,
      result: {
        outcome: {
          outcome: "selected",
          optionId: "approved-for-session",
        },
      },
    });
  });

  it("passes through explicit option ids for option-driven permission requests", () => {
    const process = createProcess();
    const writeMessage = vi.fn();

    process.setSessionContext({
      sessionId: "session-1",
      provider: "codex",
      role: "CRAFTER",
    });

    (process as any).writeMessage = writeMessage;
    (process as any).pendingInteractiveRequests.set("request-permission-2", {
      requestId: 12,
      method: "session/request_permission",
      params: {
        options: [
          { optionId: "approved", kind: "allow_once" },
          { optionId: "approved-for-session", kind: "allow_always" },
          { optionId: "approved-always", kind: "allow_always" },
          { optionId: "cancel", kind: "reject_once" },
        ],
      },
    });

    const handled = process.respondToUserInput("request-permission-2", {
      optionId: "approved-always",
      decision: "approve",
      scope: "session",
    });

    expect(handled).toBe(true);
    expect(writeMessage).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: 12,
      result: {
        outcome: {
          outcome: "selected",
          optionId: "approved-always",
        },
      },
    });
  });

  it("falls back to ACP-standard selected results when options are missing", () => {
    const process = createProcess();
    const writeMessage = vi.fn();

    process.setSessionContext({
      sessionId: "session-1",
      provider: "codex",
      role: "CRAFTER",
    });

    (process as any).writeMessage = writeMessage;
    (process as any).handleAgentRequest({
      jsonrpc: "2.0",
      id: 11,
      method: "session/request_permission",
      params: {
        permissions: {
          file_system: {
            write: ["/tmp/outside"],
          },
        },
      },
    });

    expect(writeMessage).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: 11,
      result: {
        outcome: {
          outcome: "selected",
          optionId: "approved",
        },
      },
    });
  });

  it("keeps non-codex permission requests interactive unless auto-approval is enabled", () => {
    const onNotification = vi.fn();
    const process = new AcpProcess({
      command: "opencode",
      args: [],
      cwd: "/tmp",
      displayName: "OpenCode",
    }, onNotification);
    const writeMessage = vi.fn();

    process.setSessionContext({
      sessionId: "session-2",
      provider: "opencode",
      role: "CRAFTER",
    });

    (process as any).writeMessage = writeMessage;
    (process as any).handleAgentRequest({
      jsonrpc: "2.0",
      id: 8,
      method: "session/request_permission",
      params: {
        permissions: {
          file_system: {
            write: ["/tmp/outside"],
          },
        },
      },
    });

    expect(writeMessage).not.toHaveBeenCalled();
    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({
      method: "session/update",
      params: expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call",
          status: "waiting",
          kind: "request-permissions",
        }),
      }),
    }));
  });

  it("fails startup when process spawning is unavailable", async () => {
    isAvailableMock.mockReturnValue(false);

    const process = createProcess();

    await expect(process.start()).rejects.toThrow(
      'Process spawning is not available on this platform. Cannot start Codex.',
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("fails startup when the spawned process has no pid", async () => {
    const fakeProcess = new FakeProcess();
    fakeProcess.pid = undefined;
    spawnMock.mockReturnValue(fakeProcess);

    const process = createProcess();

    await expect(process.start()).rejects.toThrow(
      'Failed to spawn Codex - is "codex-acp" installed and in PATH?',
    );
  });

  it("forwards stderr output as process_output notifications", async () => {
    vi.useFakeTimers();
    const onNotification = vi.fn();
    const fakeProcess = new FakeProcess();
    spawnMock.mockReturnValue(fakeProcess);

    const process = createProcess(onNotification);
    const startPromise = process.start();
    await vi.advanceTimersByTimeAsync(500);
    await startPromise;

    fakeProcess.stderr.emit("data", Buffer.from("permission warning\n", "utf-8"));

    expect(onNotification).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "pending",
        update: {
          sessionUpdate: "process_output",
          source: "stderr",
          data: "permission warning\n",
          displayName: "Codex",
        },
      },
    });

    vi.useRealTimers();
  });

  it("rejects pending requests when the process exits", async () => {
    vi.useFakeTimers();
    const fakeProcess = new FakeProcess();
    spawnMock.mockReturnValue(fakeProcess);

    const process = createProcess();
    const startPromise = process.start();
    await vi.advanceTimersByTimeAsync(500);
    await startPromise;

    const pending = process.sendRequest("initialize", { protocolVersion: 1 });
    fakeProcess.exitCode = 1;
    fakeProcess.emit("exit", 1, null);

    await expect(pending).rejects.toThrow("Codex process exited (code=1)");
    vi.useRealTimers();
  });
});
