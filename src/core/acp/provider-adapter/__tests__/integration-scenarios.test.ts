/**
 * Integration Scenario Tests
 *
 * End-to-end scenarios testing the full flow from raw notifications
 * through adapters to trace recording.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { getProviderAdapter, clearAdapterCache } from "../index";
import { TraceRecorder } from "../trace-recorder";
import { AgentEventBridge } from "../../agent-event-bridge/agent-event-bridge";
import type { NormalizedSessionUpdate } from "../types";

vi.mock("@/core/trace/types", () => ({
  createTraceRecord: vi.fn((sessionId, eventType, meta) => ({
    sessionId,
    eventType,
    contributor: { provider: meta.provider },
    tool: null,
    conversation: null,
    files: [],
  })),
  withConversation: vi.fn((trace, conv) => ({ ...trace, conversation: conv })),
  withTool: vi.fn((trace, tool) => ({ ...trace, tool })),
  withVcs: vi.fn((trace, vcs) => ({ ...trace, vcs })),
  withMetadata: vi.fn((trace, key, value) => ({ ...trace, metadata: { ...trace.metadata, [key]: value } })),
}));

vi.mock("@/core/trace/writer", () => ({
  recordTrace: vi.fn(),
}));

vi.mock("@/core/trace/file-range-extractor", () => ({
  extractFilesFromToolCall: vi.fn(() => []),
}));

vi.mock("@/core/trace/vcs-context", () => ({
  getVcsContextLight: vi.fn(() => null),
}));

import { recordTrace } from "@/core/trace/writer";

describe("Integration Scenarios", () => {
  let recorder: TraceRecorder;

  beforeEach(() => {
    clearAdapterCache();
    recorder = new TraceRecorder();
    vi.clearAllMocks();
  });

  describe("Scenario: OpenCode Complete Workflow", () => {
    it("handles full OpenCode tool call lifecycle", () => {
      const adapter = getProviderAdapter("opencode");
      const sessionId = "opencode-session-1";
      const cwd = "/test/cwd";

      // Step 1: User message
      const userMsg = adapter.normalize(sessionId, {
        sessionId,
        update: {
          sessionUpdate: "user_message",
          content: { type: "text", text: "Read the file test.ts" },
        },
      }) as NormalizedSessionUpdate;

      recorder.recordFromUpdate(userMsg, cwd);
      expect(recordTrace).toHaveBeenCalledWith(cwd, expect.objectContaining({
        eventType: "user_message",
      }));

      // Step 2: Tool call with empty input (OpenCode behavior)
      const toolCall = adapter.normalize(sessionId, {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call_1",
          kind: "read",
          title: "Read File",
          rawInput: {}, // Empty!
        },
      }) as NormalizedSessionUpdate;

      expect(toolCall.toolCall?.inputFinalized).toBe(false);
      recorder.recordFromUpdate(toolCall, cwd);
      // Should NOT record yet
      expect(recordTrace).toHaveBeenCalledTimes(1); // Only user_message

      // Step 3: Tool call update with actual input
      const toolUpdate = adapter.normalize(sessionId, {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call_1",
          kind: "read",
          rawInput: { filePath: "/test/test.ts" },
          status: "in_progress",
        },
      }) as NormalizedSessionUpdate;

      recorder.recordFromUpdate(toolUpdate, cwd);
      // Now should record tool_call
      expect(recordTrace).toHaveBeenCalledTimes(2);
      expect(recordTrace).toHaveBeenCalledWith(cwd, expect.objectContaining({
        eventType: "tool_call",
        tool: expect.objectContaining({
          input: { filePath: "/test/test.ts" },
        }),
      }));

      // Step 4: Tool completion
      const toolComplete = adapter.normalize(sessionId, {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call_1",
          kind: "read",
          status: "completed",
          rawOutput: "file contents here",
        },
      }) as NormalizedSessionUpdate;

      recorder.recordFromUpdate(toolComplete, cwd);
      expect(recordTrace).toHaveBeenCalledWith(cwd, expect.objectContaining({
        eventType: "tool_result",
      }));

      // Step 5: Agent response chunks
      for (let i = 0; i < 4; i++) {
        const chunk = adapter.normalize(sessionId, {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "a".repeat(30) },
          },
        }) as NormalizedSessionUpdate;
        recorder.recordFromUpdate(chunk, cwd);
      }

      // Step 6: Turn complete (should flush buffer)
      const turnComplete = adapter.normalize(sessionId, {
        sessionId,
        update: {
          sessionUpdate: "turn_complete",
          stopReason: "end_turn",
        },
      }) as NormalizedSessionUpdate;
      recorder.recordFromUpdate(turnComplete, cwd);

      // Final check: should have recorded multiple traces
      expect(recordTrace).toHaveBeenCalled();
    });
  });

  describe("Scenario: Claude Code Complete Workflow", () => {
    it("handles full Claude Code tool call lifecycle", () => {
      const adapter = getProviderAdapter("claude");
      const sessionId = "claude-session-1";
      const cwd = "/test/cwd";

      // Tool call with immediate input (Claude behavior)
      const toolCall = adapter.normalize(sessionId, {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call_claude_1",
          kind: "view",
          title: "View File",
          rawInput: { filePath: "/path/to/file.ts", lineRange: [1, 100] },
        },
      }) as NormalizedSessionUpdate;

      expect(toolCall.toolCall?.inputFinalized).toBe(true);
      recorder.recordFromUpdate(toolCall, cwd);
      
      // Should record immediately
      expect(recordTrace).toHaveBeenCalledWith(cwd, expect.objectContaining({
        eventType: "tool_call",
        tool: expect.objectContaining({
          input: { filePath: "/path/to/file.ts", lineRange: [1, 100] },
        }),
      }));
    });
  });

  describe("Scenario: Multiple Concurrent Tool Calls", () => {
    it("handles multiple pending tool calls correctly", () => {
      const adapter = getProviderAdapter("opencode");
      const sessionId = "concurrent-session";
      const cwd = "/test/cwd";

      // Two tool calls started with empty input
      const toolCall1 = adapter.normalize(sessionId, {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call_1",
          kind: "read",
          rawInput: {},
        },
      }) as NormalizedSessionUpdate;

      const toolCall2 = adapter.normalize(sessionId, {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call_2",
          kind: "write",
          rawInput: {},
        },
      }) as NormalizedSessionUpdate;

      recorder.recordFromUpdate(toolCall1, cwd);
      recorder.recordFromUpdate(toolCall2, cwd);

      // Both should be pending
      expect(recordTrace).not.toHaveBeenCalled();

      // Update for call_2 arrives first
      const update2 = adapter.normalize(sessionId, {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call_2",
          kind: "write",
          rawInput: { filePath: "/file2.ts", content: "new content" },
          status: "completed",
        },
      }) as NormalizedSessionUpdate;

      recorder.recordFromUpdate(update2, cwd);

      // Should record call_2 tool_call and tool_result
      expect(recordTrace).toHaveBeenCalledTimes(2);

      // Update for call_1 arrives later
      const update1 = adapter.normalize(sessionId, {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call_1",
          kind: "read",
          rawInput: { filePath: "/file1.ts" },
          status: "completed",
        },
      }) as NormalizedSessionUpdate;

      recorder.recordFromUpdate(update1, cwd);

      // Should record call_1 tool_call and tool_result
      expect(recordTrace).toHaveBeenCalledTimes(4);
    });
  });

  describe("Edge Case: Malformed Notifications", () => {
    it("handles notification without update field", () => {
      const adapter = getProviderAdapter("opencode");
      const result = adapter.normalize("session-1", {
        sessionId: "session-1",
        // missing update field
      });
      expect(result).toBeNull();
    });

    it("handles notification with empty update", () => {
      const adapter = getProviderAdapter("opencode");
      const result = adapter.normalize("session-1", {
        sessionId: "session-1",
        update: {},
      });
      expect(result).toBeNull();
    });

    it("handles notification with non-object update", () => {
      const adapter = getProviderAdapter("opencode");
      const result = adapter.normalize("session-1", {
        sessionId: "session-1",
        update: "invalid",
      });
      expect(result).toBeNull();
    });

    it("handles completely empty notification", () => {
      const adapter = getProviderAdapter("opencode");
      const result = adapter.normalize("session-1", {});
      expect(result).toBeNull();
    });

    it("handles null notification", () => {
      const adapter = getProviderAdapter("opencode");
      const result = adapter.normalize("session-1", null);
      expect(result).toBeNull();
    });
  });

  describe("Edge Case: Complex Tool Input Types", () => {
    it("preserves nested object input", () => {
      const adapter = getProviderAdapter("claude");
      const complexInput = {
        filePath: "/path/to/file.ts",
        options: {
          encoding: "utf-8",
          flags: ["read", "write"],
          metadata: { created: "2026-02-26" },
        },
      };

      const result = adapter.normalize("session-1", {
        sessionId: "session-1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call_complex",
          kind: "advanced-read",
          rawInput: complexInput,
        },
      }) as NormalizedSessionUpdate;

      expect(result.toolCall?.input).toEqual(complexInput);
    });

    it("preserves array input", () => {
      const adapter = getProviderAdapter("claude");
      const arrayInput = {
        files: ["/file1.ts", "/file2.ts", "/file3.ts"],
        patterns: ["*.ts", "*.tsx"],
      };

      const result = adapter.normalize("session-1", {
        sessionId: "session-1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call_array",
          kind: "multi-read",
          rawInput: arrayInput,
        },
      }) as NormalizedSessionUpdate;

      expect(result.toolCall?.input).toEqual(arrayInput);
    });
  });

  describe("Scenario: AgentEventBridge full pipeline", () => {
    it("converts raw notifications to WorkspaceAgentEvents end-to-end", () => {
      const adapter = getProviderAdapter("claude");
      const sessionId = "bridge-session-1";
      const bridge = new AgentEventBridge(sessionId);
      const events: unknown[] = [];

      const process = (raw: unknown) => {
        const normalized = adapter.normalize(sessionId, raw) as NormalizedSessionUpdate | null;
        if (normalized) {
          const agentEvents = bridge.process(normalized);
          events.push(...agentEvents);
        }
      };

      // Tool call: read file
      process({
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tc-1",
          kind: "read",
          rawInput: { path: "src/index.ts" },
        },
      });
      expect(events.at(-1)).toMatchObject({ type: "read_block", status: "in_progress" });

      // Tool call: bash
      process({
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tc-2",
          kind: "bash",
          rawInput: { command: "npm test" },
        },
      });
      expect(events.at(-1)).toMatchObject({ type: "terminal_block", command: "npm test" });

      // Tool call update: bash completes
      process({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-2",
          kind: "bash",
          status: "completed",
          rawOutput: "All tests passed",
        },
      });
      expect(events.at(-1)).toMatchObject({ type: "terminal_block", status: "completed" });

      // Agent message chunk
      process({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Done!" },
        },
      });
      expect(events.at(-1)).toMatchObject({ type: "message_block", isChunk: true });

      // Turn complete
      process({
        sessionId,
        update: {
          sessionUpdate: "turn_complete",
          stopReason: "end_turn",
          usage: { inputTokens: 100, outputTokens: 50 },
        },
      });
      // usage_reported + agent_completed
      expect(events.at(-2)).toMatchObject({ type: "usage_reported" });
      expect(events.at(-1)).toMatchObject({ type: "agent_completed", stopReason: "end_turn" });
    });

    it("converts plan_update through full pipeline", () => {
      const adapter = getProviderAdapter("opencode");
      const sessionId = "bridge-plan-session";
      const bridge = new AgentEventBridge(sessionId);

      const raw = {
        sessionId,
        update: {
          sessionUpdate: "plan_update",
          items: [
            { description: "Analyze codebase", status: "completed" },
            { description: "Write tests", status: "in_progress" },
          ],
        },
      };

      const normalized = adapter.normalize(sessionId, raw) as NormalizedSessionUpdate;
      expect(normalized.eventType).toBe("plan_update");

      const agentEvents = bridge.process(normalized);
      expect(agentEvents).toHaveLength(1);
      expect(agentEvents[0]).toMatchObject({
        type: "plan_updated",
        items: [
          { description: "Analyze codebase", status: "done" },
          { description: "Write tests", status: "in_progress" },
        ],
      });
    });
  });
});
