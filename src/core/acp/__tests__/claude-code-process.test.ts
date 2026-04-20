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

import { ClaudeCodeProcess } from "../claude-code-process";

class FakeWritable implements WritableStreamLike {
  writable = true;
  writes: Array<string | Buffer> = [];

  write(data: string | Buffer): boolean {
    this.writes.push(data);
    return true;
  }
}

class FakeProcess extends EventEmitter implements IProcessHandle {
  pid: number | undefined = 4321;
  stdin: WritableStreamLike | null = new FakeWritable();
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;

  kill(): void {
    this.exitCode = 0;
    this.emit("exit", 0, null);
  }
}

describe("ClaudeCodeProcess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAvailableMock.mockReturnValue(true);
    spawnMock.mockReset();
  });

  function createProcess(onNotification = vi.fn()) {
    return new ClaudeCodeProcess({
      preset: {
        id: "claude-code",
        name: "Claude Code",
        provider: "claude-code",
        command: "claude",
        args: [],
      } as never,
      command: "claude",
      cwd: "/tmp",
      displayName: "Claude Code",
      allowedTools: ["Read", "Write"],
      mcpConfigs: ["{\"name\":\"routa\"}"],
    }, onNotification);
  }

  it("starts Claude with stream-json flags and auto-approval defaults", async () => {
    vi.useFakeTimers();
    const fakeProcess = new FakeProcess();
    spawnMock.mockReturnValue(fakeProcess);

    const process = createProcess();
    const startPromise = process.start();
    await vi.advanceTimersByTimeAsync(500);
    await startPromise;

    expect(spawnMock).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining([
        "-p",
        "--output-format",
        "stream-json",
        "--input-format",
        "stream-json",
        "--include-partial-messages",
        "--verbose",
        "--dangerously-skip-permissions",
        "--disallowed-tools",
        "AskUserQuestion",
        "--allowedTools",
        "Read,Write",
        "--mcp-config",
        "{\"name\":\"routa\"}",
      ]),
      expect.objectContaining({
        cwd: "/tmp",
      }),
    );

    vi.useRealTimers();
  });

  it("fails startup when the spawned process has no pid", async () => {
    const fakeProcess = new FakeProcess();
    fakeProcess.pid = undefined;
    spawnMock.mockReturnValue(fakeProcess);

    const process = createProcess();

    await expect(process.start()).rejects.toThrow(
      'Failed to spawn Claude Code - is "claude" installed and in PATH?',
    );
  });

  it("resolves prompts from result messages", async () => {
    vi.useFakeTimers();
    const onNotification = vi.fn();
    const fakeProcess = new FakeProcess();
    spawnMock.mockReturnValue(fakeProcess);

    const process = createProcess(onNotification);
    const startPromise = process.start();
    await vi.advanceTimersByTimeAsync(500);
    await startPromise;

    const promptPromise = process.prompt("session-1", "Hello Claude");
    fakeProcess.stdout.emit(
      "data",
      Buffer.from(
        `${JSON.stringify({ type: "result", result: "done", stop_reason: "max_tokens" })}\n`,
        "utf-8",
      ),
    );

    await expect(promptPromise).resolves.toEqual({ stopReason: "max_tokens" });
    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({
      method: "session/update",
      params: expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "turn_complete",
          stopReason: "max_tokens",
        }),
      }),
    }));

    vi.useRealTimers();
  });

  it("rejects in-flight prompts when the process exits", async () => {
    vi.useFakeTimers();
    const fakeProcess = new FakeProcess();
    spawnMock.mockReturnValue(fakeProcess);

    const process = createProcess();
    const startPromise = process.start();
    await vi.advanceTimersByTimeAsync(500);
    await startPromise;

    const promptPromise = process.prompt("session-1", "Continue");
    fakeProcess.exitCode = 137;
    fakeProcess.emit("exit", 137, null);

    await expect(promptPromise).rejects.toThrow("Claude Code process exited (code=137)");
    vi.useRealTimers();
  });

  it("rejects a second prompt while one is already in flight", async () => {
    vi.useFakeTimers();
    const fakeProcess = new FakeProcess();
    spawnMock.mockReturnValue(fakeProcess);

    const process = createProcess();
    const startPromise = process.start();
    await vi.advanceTimersByTimeAsync(500);
    await startPromise;

    const firstPrompt = process.prompt("session-1", "Continue");
    const secondPrompt = process.prompt("session-1", "Interrupt");

    await expect(secondPrompt).rejects.toThrow("Claude Code already has a prompt in flight");

    fakeProcess.stdout.emit(
      "data",
      Buffer.from(
        `${JSON.stringify({ type: "result", result: "done", stop_reason: "end_turn" })}\n`,
        "utf-8",
      ),
    );

    await expect(firstPrompt).resolves.toEqual({ stopReason: "end_turn" });
    vi.useRealTimers();
  });

  it("translates streaming thinking and tool parameter deltas into session updates", async () => {
    vi.useFakeTimers();
    const onNotification = vi.fn();
    const fakeProcess = new FakeProcess();
    spawnMock.mockReturnValue(fakeProcess);

    const process = createProcess(onNotification);
    const startPromise = process.start();
    await vi.advanceTimersByTimeAsync(500);
    await startPromise;

    const promptPromise = process.prompt("session-1", "Think and use a tool");
    fakeProcess.stdout.emit(
      "data",
      Buffer.from(
        [
          JSON.stringify({
            type: "system",
            subtype: "init",
            session_id: "claude-session-1",
          }),
          JSON.stringify({
            type: "stream_event",
            event: {
              type: "content_block_start",
              index: 0,
              content_block: { type: "thinking" },
            },
          }),
          JSON.stringify({
            type: "stream_event",
            event: {
              type: "content_block_delta",
              delta: { type: "thinking_delta", thinking: "Analyzing" },
            },
          }),
          JSON.stringify({
            type: "stream_event",
            event: {
              type: "content_block_start",
              index: 1,
              content_block: { type: "tool_use", id: "tool-1", name: "Read" },
            },
          }),
          JSON.stringify({
            type: "stream_event",
            event: {
              type: "content_block_delta",
              delta: { type: "input_json_delta", partial_json: "{\"file\":\"README.md\"}" },
            },
          }),
          JSON.stringify({
            type: "stream_event",
            event: {
              type: "content_block_stop",
            },
          }),
          JSON.stringify({
            type: "result",
            result: "",
            stop_reason: "tool_use",
          }),
        ].join("\n") + "\n",
        "utf-8",
      ),
    );

    await expect(promptPromise).resolves.toEqual({ stopReason: "tool_use" });
    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({
      method: "session/update",
      params: expect.objectContaining({
        sessionId: "claude-session-1",
        update: expect.objectContaining({
          sessionUpdate: "thinking_start",
        }),
      }),
    }));
    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Analyzing" },
        }),
      }),
    }));
    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call_start",
          toolCallId: "tool-1",
          toolName: "Read",
        }),
      }),
    }));
    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call_params_delta",
          toolCallId: "tool-1",
          parsedInput: { file: "README.md" },
        }),
      }),
    }));

    vi.useRealTimers();
  });

  it("maps assistant tool_use and user tool_result messages into tool updates", async () => {
    vi.useFakeTimers();
    const onNotification = vi.fn();
    const fakeProcess = new FakeProcess();
    spawnMock.mockReturnValue(fakeProcess);

    const process = createProcess(onNotification);
    const startPromise = process.start();
    await vi.advanceTimersByTimeAsync(500);
    await startPromise;

    const promptPromise = process.prompt("session-1", "Delegate work");
    fakeProcess.stdout.emit(
      "data",
      Buffer.from(
        [
          JSON.stringify({
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: "task-1",
                  name: "delegate_task_to_agent",
                  input: { taskId: "child-42", prompt: "Investigate bug" },
                },
              ],
            },
          }),
          JSON.stringify({
            type: "user",
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "task-1",
                  content: "delegated",
                },
              ],
            },
          }),
          JSON.stringify({
            type: "result",
            result: "delegation queued",
            stop_reason: "end_turn",
          }),
        ].join("\n") + "\n",
        "utf-8",
      ),
    );

    await expect(promptPromise).resolves.toEqual({ stopReason: "end_turn" });
    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call",
          toolCallId: "task-1",
          status: "running",
        }),
      }),
    }));
    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call_update",
          toolCallId: "task-1",
          status: "completed",
          kind: "delegate_task_to_agent",
        }),
      }),
    }));

    vi.useRealTimers();
  });
});
