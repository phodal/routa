/**
 * TraceRecorder Tests
 *
 * Tests for TraceRecorder from a use-case perspective.
 * Focuses on the key scenarios: deferred input handling, buffer flushing, etc.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TraceRecorder } from "../trace-recorder";
import type { NormalizedSessionUpdate, NormalizedToolCall } from "../types";

// Helper for cross-platform path matching
function pathContains(path: string, segments: string): boolean {
  // Normalize both paths to use forward slashes for comparison
  const normalizedPath = path.replace(/\\/g, "/");
  return normalizedPath.includes(segments);
}

// Mock the trace module
vi.mock("@/core/trace", () => ({
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
  withMetadata: vi.fn((trace, key, value) => ({
    ...trace,
    metadata: { ...(trace.metadata ?? {}), [key]: value },
  })),
  recordTrace: vi.fn(),
  extractFilesFromToolCall: vi.fn(() => []),
  getVcsContextLight: vi.fn(() => null),
}));

import { recordTrace } from "@/core/trace";

describe("TraceRecorder", () => {
  let recorder: TraceRecorder;

  beforeEach(() => {
    recorder = new TraceRecorder();
    vi.clearAllMocks();
  });

  describe("Use Case: Claude Code (Immediate Input)", () => {
    it("records tool_call trace immediately when inputFinalized=true", () => {
      const update: NormalizedSessionUpdate = {
        sessionId: "session-1",
        provider: "claude",
        eventType: "tool_call",
        timestamp: new Date(),
        toolCall: {
          toolCallId: "call_123",
          name: "view",
          title: "View File",
          status: "running",
          input: { filePath: "/path/to/file.ts" },
          inputFinalized: true, // Claude sends input immediately
        },
      };

      recorder.recordFromUpdate(update, "/cwd");

      // Should record immediately
      expect(recordTrace).toHaveBeenCalledTimes(1);
      const mockRecordTrace = vi.mocked(recordTrace);
      const callArgs = mockRecordTrace.mock.calls[0];
      expect(callArgs?.[0]).toBe("/cwd");
      const traceArg = callArgs?.[1] as unknown as { eventType: string; tool: { name: string; input: unknown }; metadata: Record<string, unknown> };
      expect(traceArg.eventType).toBe("tool_call");
      expect(traceArg.tool.name).toBe("view");
      expect(traceArg.tool.input).toEqual({ filePath: "/path/to/file.ts" });
      // Cross-platform path assertions
      expect(pathContains(traceArg.metadata.toolCallContextDir as string, "/tool-calls/call_123/")).toBe(true);
      expect(pathContains(traceArg.metadata.toolCallContentPath as string, "/content.txt")).toBe(true);
      expect(pathContains(traceArg.metadata.toolCallMetadataPath as string, "/metadata.json")).toBe(true);
    });
  });

  describe("Use Case: OpenCode (Deferred Input)", () => {
    it("buffers tool_call when inputFinalized=false", () => {
      const update: NormalizedSessionUpdate = {
        sessionId: "session-1",
        provider: "opencode",
        eventType: "tool_call",
        timestamp: new Date(),
        toolCall: {
          toolCallId: "call_opencode_1",
          name: "read",
          status: "running",
          input: {}, // Empty!
          inputFinalized: false, // Input will come later
        },
      };

      recorder.recordFromUpdate(update, "/cwd");

      // Should NOT record yet - waiting for input
      expect(recordTrace).not.toHaveBeenCalled();
    });

    it("records tool_call when deferred input arrives in update", () => {
      // Step 1: tool_call with empty input
      const toolCall: NormalizedSessionUpdate = {
        sessionId: "session-1",
        provider: "opencode",
        eventType: "tool_call",
        timestamp: new Date(),
        toolCall: {
          toolCallId: "call_opencode_1",
          name: "read",
          status: "running",
          input: {},
          inputFinalized: false,
        },
      };

      recorder.recordFromUpdate(toolCall, "/cwd");
      expect(recordTrace).not.toHaveBeenCalled();

      // Step 2: tool_call_update with actual input
      const toolCallUpdate: NormalizedSessionUpdate = {
        sessionId: "session-1",
        provider: "opencode",
        eventType: "tool_call_update",
        timestamp: new Date(),
        toolCall: {
          toolCallId: "call_opencode_1",
          name: "read",
          status: "running",
          input: { filePath: "/path/to/file.ts" }, // Now we have input!
          inputFinalized: true,
        },
      };

      recorder.recordFromUpdate(toolCallUpdate, "/cwd");

      // Now should record the tool_call trace
      expect(recordTrace).toHaveBeenCalledTimes(1);
      const mockRecordTrace = vi.mocked(recordTrace);
      const callArgs = mockRecordTrace.mock.calls[0];
      expect(callArgs?.[0]).toBe("/cwd");
      const traceArg = callArgs?.[1] as unknown as { eventType: string; tool: { name: string; input: unknown }; metadata: Record<string, unknown> };
      expect(traceArg.eventType).toBe("tool_call");
      expect(traceArg.tool.name).toBe("read");
      expect(traceArg.tool.input).toEqual({ filePath: "/path/to/file.ts" });
      // Cross-platform path assertion
      expect(pathContains(traceArg.metadata.toolCallContextDir as string, "/tool-calls/call_opencode_1/")).toBe(true);
    });

    it("records tool_result when tool completes", () => {
      // Setup: pending tool call
      const toolCall: NormalizedSessionUpdate = {
        sessionId: "session-1",
        provider: "opencode",
        eventType: "tool_call",
        timestamp: new Date(),
        toolCall: {
          toolCallId: "call_opencode_1",
          name: "read",
          status: "running",
          input: {},
          inputFinalized: false,
        },
      };
      recorder.recordFromUpdate(toolCall, "/cwd");

      // Completion with input and output
      const completion: NormalizedSessionUpdate = {
        sessionId: "session-1",
        provider: "opencode",
        eventType: "tool_call_update",
        timestamp: new Date(),
        toolCall: {
          toolCallId: "call_opencode_1",
          name: "read",
          status: "completed",
          input: { filePath: "/path/to/file.ts" },
          output: "file contents...",
          inputFinalized: true,
        },
      };

      recorder.recordFromUpdate(completion, "/cwd");

      // Should record both tool_call and tool_result
      expect(recordTrace).toHaveBeenCalledTimes(2);
    });

    it("does not record duplicate tool_call when input arrives multiple times", () => {
      // Setup: tool_call with empty input
      const toolCall: NormalizedSessionUpdate = {
        sessionId: "session-1",
        provider: "opencode",
        eventType: "tool_call",
        timestamp: new Date(),
        toolCall: {
          toolCallId: "call_dup_test",
          name: "read",
          status: "running",
          input: {},
          inputFinalized: false,
        },
      };
      recorder.recordFromUpdate(toolCall, "/cwd");

      // First update with input
      const update1: NormalizedSessionUpdate = {
        sessionId: "session-1",
        provider: "opencode",
        eventType: "tool_call_update",
        timestamp: new Date(),
        toolCall: {
          toolCallId: "call_dup_test",
          name: "read",
          status: "running",
          input: { filePath: "/file1.ts" },
          inputFinalized: true,
        },
      };
      recorder.recordFromUpdate(update1, "/cwd");

      // Second update with input (should not record again)
      const update2: NormalizedSessionUpdate = {
        sessionId: "session-1",
        provider: "opencode",
        eventType: "tool_call_update",
        timestamp: new Date(),
        toolCall: {
          toolCallId: "call_dup_test",
          name: "read",
          status: "running",
          input: { filePath: "/file1.ts" },
          inputFinalized: true,
        },
      };
      recorder.recordFromUpdate(update2, "/cwd");

      // Should only record once
      expect(recordTrace).toHaveBeenCalledTimes(1);
    });
  });

  describe("Message Buffer Accumulation", () => {
    it("accumulates message chunks and flushes at threshold", () => {
      // Send multiple small chunks
      for (let i = 0; i < 5; i++) {
        const chunk: NormalizedSessionUpdate = {
          sessionId: "session-1",
          provider: "claude",
          eventType: "agent_message",
          timestamp: new Date(),
          message: {
            role: "assistant",
            content: "a".repeat(30), // 30 chars each
            isChunk: true,
          },
        };
        recorder.recordFromUpdate(chunk, "/cwd");
      }

      // 5 chunks * 30 chars = 150 chars > 100 threshold
      // Should have flushed once
      expect(recordTrace).toHaveBeenCalled();
    });

    it("records non-chunk messages immediately", () => {
      const message: NormalizedSessionUpdate = {
        sessionId: "session-1",
        provider: "claude",
        eventType: "agent_message",
        timestamp: new Date(),
        message: {
          role: "assistant",
          content: "Complete message here",
          isChunk: false,
        },
      };

      recorder.recordFromUpdate(message, "/cwd");

      expect(recordTrace).toHaveBeenCalledTimes(1);
    });

    it("flushes buffers on turn_complete", () => {
      // Add some buffered content
      const chunk: NormalizedSessionUpdate = {
        sessionId: "session-1",
        provider: "claude",
        eventType: "agent_message",
        timestamp: new Date(),
        message: {
          role: "assistant",
          content: "Short chunk", // Less than 100 chars
          isChunk: true,
        },
      };
      recorder.recordFromUpdate(chunk, "/cwd");
      expect(recordTrace).not.toHaveBeenCalled(); // Not flushed yet

      // Turn complete should flush
      const turnComplete: NormalizedSessionUpdate = {
        sessionId: "session-1",
        provider: "claude",
        eventType: "turn_complete",
        timestamp: new Date(),
        turnComplete: { stopReason: "end_turn" },
      };
      recorder.recordFromUpdate(turnComplete, "/cwd");

      expect(recordTrace).toHaveBeenCalledTimes(1);
    });
  });

  describe("Session Cleanup", () => {
    it("cleans up pending tool calls on session cleanup", () => {
      // Add a pending tool call
      const toolCall: NormalizedSessionUpdate = {
        sessionId: "session-to-clean",
        provider: "opencode",
        eventType: "tool_call",
        timestamp: new Date(),
        toolCall: {
          toolCallId: "call_pending",
          name: "read",
          status: "running",
          input: {},
          inputFinalized: false,
        },
      };
      recorder.recordFromUpdate(toolCall, "/cwd");

      // Cleanup
      recorder.cleanupSession("session-to-clean");

      // Now if we send an update for this tool call, it should not find it
      const update: NormalizedSessionUpdate = {
        sessionId: "session-to-clean",
        provider: "opencode",
        eventType: "tool_call_update",
        timestamp: new Date(),
        toolCall: {
          toolCallId: "call_pending",
          name: "read",
          status: "completed",
          input: { filePath: "/file.ts" },
          inputFinalized: true,
        },
      };
      recorder.recordFromUpdate(update, "/cwd");

      // Should only record tool_result (no pending to record tool_call from)
      expect(recordTrace).toHaveBeenCalledTimes(1);
      expect(recordTrace).toHaveBeenCalledWith("/cwd", expect.objectContaining({
        eventType: "tool_result",
      }));
    });
  });

  describe("Edge Cases", () => {
    it("handles tool_call_update without prior tool_call", () => {
      // This can happen if we missed the initial tool_call
      const update: NormalizedSessionUpdate = {
        sessionId: "session-1",
        provider: "opencode",
        eventType: "tool_call_update",
        timestamp: new Date(),
        toolCall: {
          toolCallId: "orphan_call",
          name: "read",
          status: "completed",
          input: { filePath: "/file.ts" },
          output: "contents",
          inputFinalized: true,
        },
      };

      // Should not crash, just record tool_result
      recorder.recordFromUpdate(update, "/cwd");
      expect(recordTrace).toHaveBeenCalledWith("/cwd", expect.objectContaining({
        eventType: "tool_result",
      }));
    });

    it("handles missing toolCall in update", () => {
      const update: NormalizedSessionUpdate = {
        sessionId: "session-1",
        provider: "claude",
        eventType: "tool_call",
        timestamp: new Date(),
        // toolCall is undefined
      };

      // Should not crash
      recorder.recordFromUpdate(update, "/cwd");
      expect(recordTrace).not.toHaveBeenCalled();
    });

    it("handles empty message content", () => {
      const message: NormalizedSessionUpdate = {
        sessionId: "session-1",
        provider: "claude",
        eventType: "agent_message",
        timestamp: new Date(),
        message: {
          role: "assistant",
          content: "",
          isChunk: false,
        },
      };

      // Should record even empty content
      recorder.recordFromUpdate(message, "/cwd");
      expect(recordTrace).toHaveBeenCalled();
    });
  });
});
