/**
 * Unit tests for Workspace Agent module
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { WorkspaceAgentStateMachine } from "../workspace-agent/workspace-agent-state";
import { resolveWorkspaceAgentConfig } from "../workspace-agent/workspace-agent-config";
import { createAgentManagementTools } from "../workspace-agent/workspace-agent-tools";
import { getProviderAdapter, clearAdapterCache } from "../provider-adapter/index";
import { AgentEventBridge } from "../agent-event-bridge/agent-event-bridge";
import type { JsonRpcMessage } from "../processer";

// ─── State Machine ───────────────────────────────────────────────────────────

describe("WorkspaceAgentStateMachine", () => {
  it("starts in INIT state", () => {
    const sm = new WorkspaceAgentStateMachine(12, 300_000);
    expect(sm.current).toBe("INIT");
    expect(sm.context.stepCount).toBe(0);
  });

  it("transitions between states", () => {
    const sm = new WorkspaceAgentStateMachine(12, 300_000);
    sm.transition("ACTING");
    expect(sm.current).toBe("ACTING");
    sm.transition("DONE");
    expect(sm.current).toBe("DONE");
  });

  it("increments step count", () => {
    const sm = new WorkspaceAgentStateMachine(12, 300_000);
    sm.transition("ACTING");
    sm.incrementStep();
    sm.incrementStep();
    expect(sm.context.stepCount).toBe(2);
    expect(sm.context.lastStepAt).toBeInstanceOf(Date);
  });

  it("returns error when max steps exceeded", () => {
    const sm = new WorkspaceAgentStateMachine(2, 300_000);
    sm.transition("ACTING");
    sm.incrementStep();
    expect(sm.checkLimits()).toBeNull();
    sm.incrementStep();
    expect(sm.checkLimits()).toContain("Max steps exceeded");
  });

  it("returns error when total timeout exceeded", () => {
    const sm = new WorkspaceAgentStateMachine(12, 100);
    sm.transition("ACTING");
    // Manually backdate startedAt
    (sm as any).ctx.startedAt = new Date(Date.now() - 200);
    expect(sm.checkLimits()).toContain("Total timeout exceeded");
  });

  it("returns null when within limits", () => {
    const sm = new WorkspaceAgentStateMachine(12, 300_000);
    sm.transition("ACTING");
    sm.incrementStep();
    expect(sm.checkLimits()).toBeNull();
  });
});

// ─── Config ──────────────────────────────────────────────────────────────────

describe("resolveWorkspaceAgentConfig", () => {
  it("returns defaults when no overrides or env vars", () => {
    const config = resolveWorkspaceAgentConfig();
    expect(config.provider).toBe("anthropic");
    expect(config.modelId).toBe("claude-sonnet-4-20250514");
    expect(config.maxSteps).toBe(12);
    expect(config.totalTimeoutMs).toBe(300_000);
    expect(config.maxTokens).toBe(16_384);
  });

  it("applies explicit overrides", () => {
    const config = resolveWorkspaceAgentConfig({
      provider: "openai",
      modelId: "gpt-4o",
      maxSteps: 20,
    });
    expect(config.provider).toBe("openai");
    expect(config.modelId).toBe("gpt-4o");
    expect(config.maxSteps).toBe(20);
  });

  it("reads from environment variables", () => {
    const originalProvider = process.env.WORKSPACE_AGENT_PROVIDER;
    const originalModel = process.env.WORKSPACE_AGENT_MODEL;
    const originalSteps = process.env.WORKSPACE_AGENT_MAX_STEPS;

    try {
      process.env.WORKSPACE_AGENT_PROVIDER = "openai";
      process.env.WORKSPACE_AGENT_MODEL = "gpt-4o-mini";
      process.env.WORKSPACE_AGENT_MAX_STEPS = "8";

      const config = resolveWorkspaceAgentConfig();
      expect(config.provider).toBe("openai");
      expect(config.modelId).toBe("gpt-4o-mini");
      expect(config.maxSteps).toBe(8);
    } finally {
      if (originalProvider === undefined) delete process.env.WORKSPACE_AGENT_PROVIDER;
      else process.env.WORKSPACE_AGENT_PROVIDER = originalProvider;
      if (originalModel === undefined) delete process.env.WORKSPACE_AGENT_MODEL;
      else process.env.WORKSPACE_AGENT_MODEL = originalModel;
      if (originalSteps === undefined) delete process.env.WORKSPACE_AGENT_MAX_STEPS;
      else process.env.WORKSPACE_AGENT_MAX_STEPS = originalSteps;
    }
  });

  it("explicit overrides take precedence over env vars", () => {
    const originalProvider = process.env.WORKSPACE_AGENT_PROVIDER;
    try {
      process.env.WORKSPACE_AGENT_PROVIDER = "openai";
      const config = resolveWorkspaceAgentConfig({ provider: "anthropic" });
      expect(config.provider).toBe("anthropic");
    } finally {
      if (originalProvider === undefined) delete process.env.WORKSPACE_AGENT_PROVIDER;
      else process.env.WORKSPACE_AGENT_PROVIDER = originalProvider;
    }
  });

  it("accepts minimax as a workspace agent provider", () => {
    const config = resolveWorkspaceAgentConfig({
      provider: "minimax",
      modelId: "MiniMax-M2.7",
    });
    expect(config.provider).toBe("minimax");
    expect(config.modelId).toBe("MiniMax-M2.7");
  });

  it("reads minimax provider from environment", () => {
    const originalProvider = process.env.WORKSPACE_AGENT_PROVIDER;
    const originalModel = process.env.WORKSPACE_AGENT_MODEL;
    try {
      process.env.WORKSPACE_AGENT_PROVIDER = "minimax";
      process.env.WORKSPACE_AGENT_MODEL = "MiniMax-M2.7-highspeed";
      const config = resolveWorkspaceAgentConfig();
      expect(config.provider).toBe("minimax");
      expect(config.modelId).toBe("MiniMax-M2.7-highspeed");
    } finally {
      if (originalProvider === undefined) delete process.env.WORKSPACE_AGENT_PROVIDER;
      else process.env.WORKSPACE_AGENT_PROVIDER = originalProvider;
      if (originalModel === undefined) delete process.env.WORKSPACE_AGENT_MODEL;
      else process.env.WORKSPACE_AGENT_MODEL = originalModel;
    }
  });
});

// ─── Provider Adapter Integration ────────────────────────────────────────────

describe("WorkspaceAgentProviderAdapter", () => {
  beforeEach(() => {
    clearAdapterCache();
  });

  it("returns workspace adapter for 'workspace' provider", () => {
    const adapter = getProviderAdapter("workspace");
    const behavior = adapter.getBehavior();
    expect(behavior.type).toBe("workspace");
    expect(behavior.immediateToolInput).toBe(true);
    expect(behavior.streaming).toBe(true);
  });

  it("normalizes 'workspace-agent' to workspace", () => {
    const adapter = getProviderAdapter("workspace-agent");
    expect(adapter.getBehavior().type).toBe("workspace");
  });

  it("normalizes 'routa-native' to workspace", () => {
    const adapter = getProviderAdapter("routa-native");
    expect(adapter.getBehavior().type).toBe("workspace");
  });

  it("normalizes tool_call notifications", () => {
    const adapter = getProviderAdapter("workspace");
    const result = adapter.normalize("sess-1", {
      sessionId: "sess-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_1",
        title: "read_file",
        rawInput: { path: "src/index.ts" },
        status: "running",
      },
    });

    expect(result).not.toBeNull();
    const update = Array.isArray(result) ? result[0] : result!;
    expect(update.eventType).toBe("tool_call");
    expect(update.toolCall?.toolCallId).toBe("call_1");
    expect(update.toolCall?.input).toEqual({ path: "src/index.ts" });
  });

  it("normalizes agent_message_chunk notifications", () => {
    const adapter = getProviderAdapter("workspace");
    const result = adapter.normalize("sess-1", {
      sessionId: "sess-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello" },
      },
    });

    expect(result).not.toBeNull();
    const update = Array.isArray(result) ? result[0] : result!;
    expect(update.eventType).toBe("agent_message");
    expect(update.message?.content).toBe("Hello");
    expect(update.message?.isChunk).toBe(true);
  });

  it("normalizes turn_complete notifications", () => {
    const adapter = getProviderAdapter("workspace");
    const result = adapter.normalize("sess-1", {
      sessionId: "sess-1",
      update: {
        sessionUpdate: "turn_complete",
        stopReason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });

    expect(result).not.toBeNull();
    const update = Array.isArray(result) ? result[0] : result!;
    expect(update.eventType).toBe("turn_complete");
    expect(update.turnComplete?.stopReason).toBe("end_turn");
  });
});

describe("createAgentManagementTools", () => {
  it("uses the default sandbox id for permission requests when none is passed explicitly", async () => {
    const requestPermission = vi.fn().mockResolvedValue({
      data: { requestId: "req-1", decision: "pending" },
    });
    const tools = createAgentManagementTools(
      {
        requestPermission,
      } as unknown as import("@/core/tools/agent-tools").AgentTools,
      "ws-1",
      "agent-1",
      { defaultSandboxId: "sandbox-default" },
    );

    const result = await tools.request_permission.execute?.(
      {
        coordinatorAgentId: "coord-1",
        type: "file_edit",
        description: "Need to edit src/main.rs",
      },
      {} as never,
    );

    expect(result).toMatchObject({ requestId: "req-1", decision: "pending" });
    expect(requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        options: { sandboxId: "sandbox-default" },
      }),
    );
  });
});

// ─── Full Pipeline: Adapter → Provider → EventBridge ─────────────────────────

describe("Workspace Agent → AgentEventBridge pipeline", () => {
  let bridge: AgentEventBridge;
  let providerAdapter: ReturnType<typeof getProviderAdapter>;

  beforeEach(() => {
    clearAdapterCache();
    bridge = new AgentEventBridge("sess-1");
    providerAdapter = getProviderAdapter("workspace");
  });

  it("tool_call → read_block event", () => {
    const normalized = providerAdapter.normalize("sess-1", {
      sessionId: "sess-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_1",
        title: "read_file",
        rawInput: { path: "src/main.ts" },
        status: "running",
      },
    });

    const update = Array.isArray(normalized) ? normalized[0] : normalized!;
    const events = bridge.process(update);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("read_block");
    if (events[0].type === "read_block") {
      expect(events[0].files).toContain("src/main.ts");
      expect(events[0].status).toBe("in_progress");
    }
  });

  it("tool_call → file_changes_block for write_file", () => {
    const normalized = providerAdapter.normalize("sess-1", {
      sessionId: "sess-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_2",
        title: "write_file",
        rawInput: { path: "src/new.ts", content: "export const x = 1;" },
        status: "running",
      },
    });

    const update = Array.isArray(normalized) ? normalized[0] : normalized!;
    const events = bridge.process(update);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("file_changes_block");
    if (events[0].type === "file_changes_block") {
      expect(events[0].changes[0].path).toBe("src/new.ts");
      expect(events[0].changes[0].changeType).toBe("create");
    }
  });

  it("tool_call → file_changes_block for edit_file", () => {
    const normalized = providerAdapter.normalize("sess-1", {
      sessionId: "sess-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_3",
        title: "edit_file",
        rawInput: { path: "src/main.ts", old_string: "foo", new_string: "bar" },
        status: "running",
      },
    });

    const update = Array.isArray(normalized) ? normalized[0] : normalized!;
    const events = bridge.process(update);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("file_changes_block");
    if (events[0].type === "file_changes_block") {
      expect(events[0].changes[0].changeType).toBe("edit");
    }
  });

  it("tool_call → terminal_block for run_command", () => {
    const normalized = providerAdapter.normalize("sess-1", {
      sessionId: "sess-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_4",
        title: "run_command",
        rawInput: { command: "npm test" },
        status: "running",
      },
    });

    const update = Array.isArray(normalized) ? normalized[0] : normalized!;
    const events = bridge.process(update);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("terminal_block");
    if (events[0].type === "terminal_block") {
      expect(events[0].command).toBe("npm test");
    }
  });

  it("tool_call → read_block for search_files", () => {
    const normalized = providerAdapter.normalize("sess-1", {
      sessionId: "sess-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_5",
        title: "search_files",
        rawInput: { pattern: "**/*.ts" },
        status: "running",
      },
    });

    const update = Array.isArray(normalized) ? normalized[0] : normalized!;
    const events = bridge.process(update);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("read_block");
  });

  it("tool_call → read_block for grep_search", () => {
    const normalized = providerAdapter.normalize("sess-1", {
      sessionId: "sess-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_6",
        title: "grep_search",
        rawInput: { pattern: "TODO" },
        status: "running",
      },
    });

    const update = Array.isArray(normalized) ? normalized[0] : normalized!;
    const events = bridge.process(update);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("read_block");
  });

  it("tool_call → read_block for list_directory", () => {
    const normalized = providerAdapter.normalize("sess-1", {
      sessionId: "sess-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_7",
        title: "list_directory",
        rawInput: { path: "src" },
        status: "running",
      },
    });

    const update = Array.isArray(normalized) ? normalized[0] : normalized!;
    const events = bridge.process(update);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("read_block");
  });

  it("message chunk → message_block event", () => {
    const normalized = providerAdapter.normalize("sess-1", {
      sessionId: "sess-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Working on it..." },
      },
    });

    const update = Array.isArray(normalized) ? normalized[0] : normalized!;
    const events = bridge.process(update);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message_block");
    if (events[0].type === "message_block") {
      expect(events[0].content).toBe("Working on it...");
      expect(events[0].isChunk).toBe(true);
    }
  });

  it("turn_complete → agent_completed event", () => {
    const normalized = providerAdapter.normalize("sess-1", {
      sessionId: "sess-1",
      update: {
        sessionUpdate: "turn_complete",
        stopReason: "end_turn",
        usage: { input_tokens: 500, output_tokens: 200 },
      },
    });

    const update = Array.isArray(normalized) ? normalized[0] : normalized!;
    const events = bridge.process(update);

    // usage_reported + agent_completed
    expect(events.length).toBeGreaterThanOrEqual(1);
    const completed = events.find((e) => e.type === "agent_completed");
    expect(completed).toBeDefined();
    if (completed?.type === "agent_completed") {
      expect(completed.stopReason).toBe("end_turn");
    }
  });

  it("tool_call_update completed → cleans up tracked tool call", () => {
    // Start a tool call
    const startNorm = providerAdapter.normalize("sess-1", {
      sessionId: "sess-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_cleanup",
        title: "read_file",
        rawInput: { path: "test.ts" },
        status: "running",
      },
    });
    bridge.process(Array.isArray(startNorm) ? startNorm[0] : startNorm!);

    // Complete the tool call
    const doneNorm = providerAdapter.normalize("sess-1", {
      sessionId: "sess-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call_cleanup",
        title: "read_file",
        status: "completed",
        rawOutput: { content: "file contents" },
      },
    });
    const events = bridge.process(Array.isArray(doneNorm) ? doneNorm[0] : doneNorm!);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("read_block");
    if (events[0].type === "read_block") {
      expect(events[0].status).toBe("completed");
    }
  });
});
