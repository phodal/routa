/**
 * Unit tests for ClaudeCodeSdkAdapter
 *
 * Mocks `query` from @anthropic-ai/claude-agent-sdk so no real process is
 * spawned and no network calls are made.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// ─── Mock the SDK query function ─────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// ─── Mock isServerlessEnvironment ────────────────────────────────────────────

vi.mock("@/core/acp/api-based-providers", () => ({
  isServerlessEnvironment: vi.fn(() => true),
}));

// ─── Import after mocks are set up ───────────────────────────────────────────

import {
  ClaudeCodeSdkAdapter,
  isClaudeCodeSdkConfigured,
  getClaudeCodeSdkConfig,
  shouldUseClaudeCodeSdkAdapter,
  createClaudeCodeSdkAdapterIfAvailable,
} from "../claude-code-sdk-adapter";
import type { JsonRpcMessage } from "@/core/acp/processer";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build an async generator that yields the given messages in order */
async function* makeStream(messages: SDKMessage[]): AsyncGenerator<SDKMessage, void> {
  for (const msg of messages) {
    yield msg;
  }
}

function collectNotifications(): { notifications: JsonRpcMessage[]; handler: (msg: JsonRpcMessage) => void } {
  const notifications: JsonRpcMessage[] = [];
  return {
    notifications,
    handler: (msg: JsonRpcMessage) => notifications.push(msg),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("isClaudeCodeSdkConfigured", () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("returns false when no env vars are set", () => {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    expect(isClaudeCodeSdkConfigured()).toBe(false);
  });

  it("returns true when ANTHROPIC_AUTH_TOKEN is set", () => {
    process.env.ANTHROPIC_AUTH_TOKEN = "test-token";
    expect(isClaudeCodeSdkConfigured()).toBe(true);
  });

  it("returns true when ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(isClaudeCodeSdkConfigured()).toBe(true);
  });
});

describe("getClaudeCodeSdkConfig", () => {
  beforeEach(() => {
    // Clean up env vars before each test to ensure clean state
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.API_TIMEOUT_MS;
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.API_TIMEOUT_MS;
  });

  it("uses default model when ANTHROPIC_MODEL is not set", () => {
    const config = getClaudeCodeSdkConfig();
    expect(config.model).toBe("claude-sonnet-4-20250514");
  });

  it("uses custom model from env", () => {
    process.env.ANTHROPIC_MODEL = "claude-opus-4-20251101";
    const config = getClaudeCodeSdkConfig();
    expect(config.model).toBe("claude-opus-4-20251101");
  });

  it("uses default timeout of 55000", () => {
    const config = getClaudeCodeSdkConfig();
    expect(config.timeoutMs).toBe(55000);
  });

  it("uses ANTHROPIC_AUTH_TOKEN over ANTHROPIC_API_KEY when both set", () => {
    process.env.ANTHROPIC_AUTH_TOKEN = "auth-token";
    process.env.ANTHROPIC_API_KEY = "api-key";
    const config = getClaudeCodeSdkConfig();
    expect(config.apiKey).toBe("auth-token");
  });
});

describe("shouldUseClaudeCodeSdkAdapter", () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("returns true when serverless and configured", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(shouldUseClaudeCodeSdkAdapter()).toBe(true);
  });

  it("returns false when not configured", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    expect(shouldUseClaudeCodeSdkAdapter()).toBe(false);
  });
});

describe("createClaudeCodeSdkAdapterIfAvailable", () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("returns null when not configured", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    const result = createClaudeCodeSdkAdapterIfAvailable("/cwd", () => {});
    expect(result).toBeNull();
  });

  it("returns adapter instance when configured", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const result = createClaudeCodeSdkAdapterIfAvailable("/cwd", () => {});
    expect(result).toBeInstanceOf(ClaudeCodeSdkAdapter);
  });
});

describe("ClaudeCodeSdkAdapter", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-test-1234abcd";
    mockQuery.mockReset();
  });

  afterEach(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  });

  // ── connect ────────────────────────────────────────────────────────────────

  describe("connect()", () => {
    it("throws when no API key is set", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_AUTH_TOKEN;
      const { handler } = collectNotifications();
      const adapter = new ClaudeCodeSdkAdapter("/cwd", handler);
      await expect(adapter.connect()).rejects.toThrow(/ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY/);
    });

    it("sets alive=true and generates a sessionId after connect", async () => {
      const { handler } = collectNotifications();
      const adapter = new ClaudeCodeSdkAdapter("/cwd", handler);
      expect(adapter.alive).toBe(false);
      expect(adapter.acpSessionId).toBeNull();

      await adapter.connect();

      expect(adapter.alive).toBe(true);
      expect(adapter.acpSessionId).toMatch(/^claude-sdk-\d+$/);
    });
  });

  // ── createSession ──────────────────────────────────────────────────────────

  describe("createSession()", () => {
    it("returns the sessionId after connect", async () => {
      const { handler } = collectNotifications();
      const adapter = new ClaudeCodeSdkAdapter("/cwd", handler);
      await adapter.connect();
      const id = await adapter.createSession("my session");
      expect(id).toBe(adapter.acpSessionId);
    });

    it("throws when not connected", async () => {
      const { handler } = collectNotifications();
      const adapter = new ClaudeCodeSdkAdapter("/cwd", handler);
      await expect(adapter.createSession()).rejects.toThrow("not connected");
    });
  });

  // ── prompt ─────────────────────────────────────────────────────────────────

  describe("prompt()", () => {
    it("throws when not connected", async () => {
      const { handler } = collectNotifications();
      const adapter = new ClaudeCodeSdkAdapter("/cwd", handler);
      await expect(adapter.prompt("hello")).rejects.toThrow("No active session");
    });

    it("calls query() with correct options", async () => {
      mockQuery.mockReturnValue(makeStream([]));

      const { handler } = collectNotifications();
      const adapter = new ClaudeCodeSdkAdapter("/tmp/test-cwd", handler);
      await adapter.connect();
      await adapter.prompt("Say hello");

      expect(mockQuery).toHaveBeenCalledOnce();
      const callArgs = mockQuery.mock.calls[0][0];
      expect(callArgs.prompt).toBe("Say hello");
      expect(callArgs.options.cwd).toBe("/tmp/test-cwd");
      expect(callArgs.options.permissionMode).toBe("bypassPermissions");
      expect(callArgs.options.allowDangerouslySkipPermissions).toBe(true);
      expect(callArgs.options.maxTurns).toBe(1200);
      expect(callArgs.options.settingSources).toEqual(["user", "project"]);
      expect(callArgs.options.tools).toEqual([
        "Skill",
        "Read",
        "Write",
        "Edit",
        "Bash",
        "Glob",
        "Grep",
        "AskUserQuestion",
      ]);
      expect(callArgs.options.allowedTools).toEqual([
        "Skill",
        "Read",
        "Write",
        "Edit",
        "Bash",
        "Glob",
        "Grep",
        "AskUserQuestion",
      ]);
    });

    it("passes configured MCP servers through to the SDK query", async () => {
      mockQuery.mockReturnValue(makeStream([]));

      const { handler } = collectNotifications();
      const adapter = new ClaudeCodeSdkAdapter("/tmp/test-cwd", handler, {
        mcpServers: {
          "routa-coordination": {
            type: "http",
            url: "http://127.0.0.1:3000/api/mcp?sid=test",
          },
        },
      });
      await adapter.connect();
      await adapter.prompt("Use MCP");

      const callArgs = mockQuery.mock.calls[0][0];
      expect(callArgs.options.mcpServers).toEqual({
        "routa-coordination": {
          type: "http",
          url: "http://127.0.0.1:3000/api/mcp?sid=test",
        },
      });
    });

    it("uses the provided native tool allowlist", async () => {
      mockQuery.mockReturnValue(makeStream([]));

      const { handler } = collectNotifications();
      const adapter = new ClaudeCodeSdkAdapter("/tmp/test-cwd", handler, {
        allowedNativeTools: [],
      });
      await adapter.connect();
      await adapter.prompt("Kanban only");

      const callArgs = mockQuery.mock.calls[0][0];
      expect(callArgs.options.settingSources).toEqual([]);
      expect(callArgs.options.tools).toEqual(["AskUserQuestion"]);
      expect(callArgs.options.allowedTools).toEqual(["AskUserQuestion"]);
      expect(callArgs.options.disallowedTools).toEqual([
        "Skill",
        "Read",
        "Write",
        "Edit",
        "Bash",
        "Glob",
        "Grep",
      ]);
      await expect(
        callArgs.options.canUseTool("Bash", {}, { toolUseID: "tool-1", signal: new AbortController().signal })
      ).resolves.toEqual({ behavior: "deny", message: "Tool Bash is not allowed in this session." });
      await expect(
        callArgs.options.canUseTool("mcp__routa-coordination__create_card", {}, { toolUseID: "tool-2", signal: new AbortController().signal })
      ).resolves.toEqual({ behavior: "allow", updatedInput: {} });
    });

    it("passes provider-level systemPrompt append to the SDK query", async () => {
      mockQuery.mockReturnValue(makeStream([]));

      const { handler } = collectNotifications();
      const adapter = new ClaudeCodeSdkAdapter("/tmp/test-cwd", handler, {
        systemPromptAppend: "You are the team lead. Delegate instead of implementing.",
      });
      await adapter.connect();
      await adapter.prompt("Delegate work");

      const callArgs = mockQuery.mock.calls[0][0];
      expect(callArgs.options.systemPrompt).toEqual({
        type: "preset",
        preset: "claude_code",
        append: "You are the team lead. Delegate instead of implementing.",
      });
    });

    it("emits agent_message_chunk notifications from text_delta stream events", async () => {
      const textDeltaMsg: SDKMessage = {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hello world" },
        },
        parent_tool_use_id: null,
        uuid: "uuid-1" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "sess-1",
      };

      mockQuery.mockReturnValue(makeStream([textDeltaMsg]));

      const { notifications, handler } = collectNotifications();
      const adapter = new ClaudeCodeSdkAdapter("/cwd", handler);
      await adapter.connect();
      await adapter.prompt("hi");

      const chunkNotifs = notifications.filter(
        (n) =>
          n.method === "session/update" &&
          (n.params as any)?.update?.sessionUpdate === "agent_message_chunk"
      );
      expect(chunkNotifs).toHaveLength(1);
      const update = (chunkNotifs[0].params as Record<string, unknown>).update as Record<string, unknown>;
      expect((update.content as Record<string, unknown>).text).toBe("Hello world");
    });

    it("emits agent_thought_chunk notifications from thinking_delta events", async () => {
      const thinkingMsg: SDKMessage = {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "Let me think..." },
        },
        parent_tool_use_id: null,
        uuid: "uuid-2" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "sess-1",
      };

      mockQuery.mockReturnValue(makeStream([thinkingMsg]));

      const { notifications, handler } = collectNotifications();
      const adapter = new ClaudeCodeSdkAdapter("/cwd", handler);
      await adapter.connect();
      await adapter.prompt("think");

      const thoughtNotifs = notifications.filter(
        (n) =>
          n.method === "session/update" &&
          (n.params as any)?.update?.sessionUpdate === "agent_thought_chunk"
      );
      expect(thoughtNotifs).toHaveLength(1);
    });

    it("emits tool_call notification on tool_use content_block_start", async () => {
      const toolStartMsg: SDKMessage = {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "tool-id-1", name: "Bash", input: {} },
        },
        parent_tool_use_id: null,
        uuid: "uuid-3" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "sess-1",
      };

      mockQuery.mockReturnValue(makeStream([toolStartMsg]));

      const { notifications, handler } = collectNotifications();
      const adapter = new ClaudeCodeSdkAdapter("/cwd", handler);
      await adapter.connect();
      await adapter.prompt("use tool");

      const toolNotifs = notifications.filter(
        (n) =>
          n.method === "session/update" &&
          (n.params as any)?.update?.sessionUpdate === "tool_call"
      );
      expect(toolNotifs).toHaveLength(1);
      const update = (toolNotifs[0].params as Record<string, unknown>).update as Record<string, unknown>;
      expect(update.title).toBe("Bash");
      expect(update.toolCallId).toBe("tool-id-1");
      expect(update.status).toBe("running");
    });

    it("pauses for AskUserQuestion and resumes after a UI response", async () => {
      const toolUseId = "ask-user-1";
      const questionInput = {
        questions: [
          {
            header: "Format",
            question: "How should I format the output?",
            options: [
              { label: "Summary", description: "Brief overview" },
              { label: "Detailed", description: "Full explanation" },
            ],
            multiSelect: false,
          },
        ],
      };
      let permissionResult: unknown;

      mockQuery.mockImplementation(({ options }: { options: { canUseTool?: (...args: unknown[]) => Promise<unknown> } }) => {
        async function* stream(): AsyncGenerator<SDKMessage, void> {
          permissionResult = await options.canUseTool?.(
            "AskUserQuestion",
            questionInput,
            {
              signal: new AbortController().signal,
              toolUseID: toolUseId,
            }
          );

          yield {
            type: "assistant",
            message: {
              id: "msg-ask-user-complete",
              type: "message",
              role: "assistant",
              model: "claude-sonnet",
              content: [
                { type: "tool_use", id: toolUseId, name: "AskUserQuestion", input: questionInput },
              ],
              stop_reason: "tool_use",
              stop_sequence: null,
              usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } as any,
            } as any,
            parent_tool_use_id: null,
            uuid: "uuid-ask-user-tool" as `${string}-${string}-${string}-${string}-${string}`,
            session_id: "sess-1",
          };

          yield {
            type: "result",
            subtype: "success",
            duration_ms: 1000,
            duration_api_ms: 900,
            is_error: false,
            num_turns: 1,
            result: "Done!",
            stop_reason: "end_turn",
            total_cost_usd: 0.001,
            usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } as any,
            modelUsage: {},
            permission_denials: [],
            uuid: "uuid-ask-user" as `${string}-${string}-${string}-${string}-${string}`,
            session_id: "sess-1",
          };
        }

        return stream();
      });

      const { notifications, handler } = collectNotifications();
      const adapter = new ClaudeCodeSdkAdapter("/cwd", handler);
      await adapter.connect();

      const promptPromise = adapter.prompt("help me choose");
      await new Promise((resolve) => setTimeout(resolve, 0));

      const waitingNotif = notifications.find(
        (n) =>
          n.method === "session/update" &&
          (n.params as any)?.update?.sessionUpdate === "tool_call" &&
          (n.params as any)?.update?.title === "AskUserQuestion"
      );
      expect(waitingNotif).toBeTruthy();

      const submitted = adapter.respondToUserInput(toolUseId, {
        questions: questionInput.questions,
        answers: { "How should I format the output?": "Summary" },
      });
      expect(submitted).toBe(true);

      const result = await promptPromise;
      expect(result.stopReason).toBe("end_turn");
      expect(permissionResult).toEqual({
        behavior: "allow",
        updatedInput: {
          questions: questionInput.questions,
          answers: { "How should I format the output?": "Summary" },
        },
      });

      const completedNotif = notifications.find(
        (n) =>
          n.method === "session/update" &&
          (n.params as any)?.update?.sessionUpdate === "tool_call_update" &&
          (n.params as any)?.update?.toolCallId === toolUseId
      );
      expect(completedNotif).toBeTruthy();
      expect(((completedNotif!.params as Record<string, unknown>).update as Record<string, unknown>).rawInput).toEqual({
        questions: questionInput.questions,
        answers: { "How should I format the output?": "Summary" },
      });
    });

    it("emits tool_call_update for tool_use blocks in assistant messages", async () => {
      const assistantMsg: SDKMessage = {
        type: "assistant",
        message: {
          id: "msg-1",
          type: "message",
          role: "assistant",
          model: "claude-sonnet",
          content: [
            { type: "tool_use", id: "tool-id-2", name: "Read", input: { file: "x.ts" } },
          ],
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } as any,
        } as any,
        parent_tool_use_id: null,
        uuid: "uuid-4" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "sess-1",
      };

      mockQuery.mockReturnValue(makeStream([assistantMsg]));

      const { notifications, handler } = collectNotifications();
      const adapter = new ClaudeCodeSdkAdapter("/cwd", handler);
      await adapter.connect();
      await adapter.prompt("read file");

      const updateNotifs = notifications.filter(
        (n) =>
          n.method === "session/update" &&
          (n.params as any)?.update?.sessionUpdate === "tool_call_update"
      );
      expect(updateNotifs).toHaveLength(1);
      const update = (updateNotifs[0].params as Record<string, unknown>).update as Record<string, unknown>;
      expect(update.title).toBe("Read");
      expect(update.status).toBe("completed");
    });

    it("does not emit a completed AskUserQuestion update while awaiting UI input", async () => {
      const toolUseId = "ask-user-pending";
      const assistantMsg: SDKMessage = {
        type: "assistant",
        message: {
          id: "msg-ask-user-pending",
          type: "message",
          role: "assistant",
          model: "claude-sonnet",
          content: [
            {
              type: "tool_use",
              id: toolUseId,
              name: "AskUserQuestion",
              input: {
                questions: [
                  {
                    header: "Format",
                    question: "How should I format the output?",
                    options: [
                      { label: "Summary", description: "Brief overview" },
                      { label: "Detailed", description: "Full explanation" },
                    ],
                    multiSelect: false,
                  },
                ],
              },
            },
          ],
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } as any,
        } as any,
        parent_tool_use_id: null,
        uuid: "uuid-ask-user-pending" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "sess-1",
      };

      mockQuery.mockReturnValue(makeStream([assistantMsg]));

      const { notifications, handler } = collectNotifications();
      const adapter = new ClaudeCodeSdkAdapter("/cwd", handler);
      await adapter.connect();
      (adapter as unknown as { pendingUserInputRequests: Map<string, unknown> }).pendingUserInputRequests.set(toolUseId, {});
      await adapter.prompt("ask me something");

      const updateNotifs = notifications.filter(
        (n) =>
          n.method === "session/update" &&
          (n.params as any)?.update?.sessionUpdate === "tool_call_update"
      );
      expect(updateNotifs).toHaveLength(0);
    });

    it("emits turn_complete notification after successful run", async () => {
      const resultMsg: SDKMessage = {
        type: "result",
        subtype: "success",
        duration_ms: 1000,
        duration_api_ms: 900,
        is_error: false,
        num_turns: 1,
        result: "Done!",
        stop_reason: "end_turn",
        total_cost_usd: 0.001,
        usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } as any,
        modelUsage: {},
        permission_denials: [],
        uuid: "uuid-5" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "sess-1",
      };

      mockQuery.mockReturnValue(makeStream([resultMsg]));

      const { notifications, handler } = collectNotifications();
      const adapter = new ClaudeCodeSdkAdapter("/cwd", handler);
      await adapter.connect();
      const result = await adapter.prompt("do it");

      expect(result.stopReason).toBe("end_turn");
      expect(result.content).toBe("Done!");

      const completeNotifs = notifications.filter(
        (n) =>
          n.method === "session/update" &&
          (n.params as any)?.update?.sessionUpdate === "turn_complete"
      );
      expect(completeNotifs).toHaveLength(1);
    });

    it("returns stopReason=error when result message has is_error=true", async () => {
      const errorResultMsg: SDKMessage = {
        type: "result",
        subtype: "error_max_turns",
        duration_ms: 5000,
        duration_api_ms: 4800,
        is_error: true,
        num_turns: 30,
        stop_reason: null,
        total_cost_usd: 0.01,
        usage: { input_tokens: 100, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } as any,
        modelUsage: {},
        permission_denials: [],
        errors: ["Max turns reached"],
        uuid: "uuid-6" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "sess-1",
      };

      mockQuery.mockReturnValue(makeStream([errorResultMsg]));

      const { notifications, handler } = collectNotifications();
      const adapter = new ClaudeCodeSdkAdapter("/cwd", handler);
      await adapter.connect();
      const result = await adapter.prompt("go forever");

      expect(result.stopReason).toBe("error");

      const errorNotifs = notifications.filter(
        (n) =>
          n.method === "session/update" &&
          (n.params as Record<string, unknown>).type === "error"
      );
      expect(errorNotifs).toHaveLength(1);
      const err = (errorNotifs[0].params as Record<string, unknown>).error as { message: string };
      expect(err.message).toBe("Max turns reached");
    });

    it("propagates SDK exceptions and emits error notification", async () => {
      mockQuery.mockImplementation(() => {
        throw new Error("spawn failed: ENOENT");
      });

      const { notifications, handler } = collectNotifications();
      const adapter = new ClaudeCodeSdkAdapter("/cwd", handler);
      await adapter.connect();

      await expect(adapter.prompt("hello")).rejects.toThrow("spawn failed: ENOENT");

      const errorNotifs = notifications.filter(
        (n) =>
          n.method === "session/update" &&
          (n.params as Record<string, unknown>).type === "error"
      );
      expect(errorNotifs).toHaveLength(1);
    });
  });

  // ── cancel & close ─────────────────────────────────────────────────────────

  describe("cancel() and close()", () => {
    it("close() sets alive=false and clears sessionId", async () => {
      const { handler } = collectNotifications();
      const adapter = new ClaudeCodeSdkAdapter("/cwd", handler);
      await adapter.connect();
      expect(adapter.alive).toBe(true);

      await adapter.close();
      expect(adapter.alive).toBe(false);
      expect(adapter.acpSessionId).toBeNull();
    });

    it("kill() is an alias for close()", async () => {
      const { handler } = collectNotifications();
      const adapter = new ClaudeCodeSdkAdapter("/cwd", handler);
      await adapter.connect();
      adapter.kill();
      // allow microtasks to settle
      await new Promise((r) => setTimeout(r, 0));
      expect(adapter.alive).toBe(false);
    });
  });
});
