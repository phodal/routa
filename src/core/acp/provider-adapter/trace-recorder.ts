/**
 * Trace Recorder
 *
 * Records traces from normalized session updates.
 * Handles deferred input patterns using a pending tool calls buffer.
 * Also saves fine-grained tool call context files for debugging.
 */

import {
  createTraceRecord,
  withConversation,
  withMetadata,
  withTool,
  withVcs,
} from "@/core/trace/types";
import { recordTrace } from "@/core/trace/writer";
import { extractFilesFromToolCall } from "@/core/trace/file-range-extractor";
import { getVcsContextLight } from "@/core/trace/vcs-context";
import { ToolCallContextWriter } from "@/core/storage/tool-call-context-writer";
import type { NormalizedSessionUpdate, NormalizedToolCall } from "./types";

/**
 * Pending tool call waiting for input.
 */
interface PendingToolCall {
  toolCallId: string;
  name: string;
  title?: string;
  sessionId: string;
  cwd: string;
  provider: string;
  traced: boolean;
}

/**
 * TraceRecorder handles recording traces from normalized session updates.
 * It manages pending tool calls for providers that send input in updates.
 * Also saves fine-grained tool call context files for debugging.
 */
export class TraceRecorder {
  /** Buffer for pending tool calls awaiting input */
  private pendingToolCalls = new Map<string, PendingToolCall>();
  /** Buffer for accumulating message chunks */
  private messageBuffer = new Map<string, string>();
  /** Buffer for accumulating thought chunks */
  private thoughtBuffer = new Map<string, string>();
  /** Per-cwd context writers */
  private contextWriters = new Map<string, ToolCallContextWriter>();

  /**
   * Get or create a ToolCallContextWriter for the given cwd.
   */
  private getContextWriter(cwd: string): ToolCallContextWriter {
    let writer = this.contextWriters.get(cwd);
    if (!writer) {
      writer = new ToolCallContextWriter(cwd);
      this.contextWriters.set(cwd, writer);
    }
    return writer;
  }

  /**
   * Record a trace from a normalized session update.
   *
   * @param update - The normalized session update
   * @param cwd - Working directory for trace storage
   */
  recordFromUpdate(update: NormalizedSessionUpdate, cwd: string): void {
    const { sessionId, provider, eventType } = update;

    switch (eventType) {
      case "tool_call":
        this.handleToolCall(update, cwd);
        break;

      case "tool_call_update":
        this.handleToolCallUpdate(update, cwd);
        break;

      case "agent_message":
        this.handleAgentMessage(update, cwd);
        break;

      case "agent_thought":
        this.handleAgentThought(update, cwd);
        break;

      case "user_message":
        this.handleUserMessage(update, cwd);
        break;

      case "turn_complete":
        this.flushBuffers(sessionId, cwd, provider);
        break;

      // Errors and other types are not traced
    }
  }

  private handleToolCall(update: NormalizedSessionUpdate, cwd: string): void {
    const { sessionId, provider, toolCall } = update;
    if (!toolCall) return;

    if (toolCall.inputFinalized) {
      // Input is ready, record immediately
      this.recordToolCallTrace(sessionId, provider, toolCall, cwd);
    } else {
      // Input is deferred, store in pending
      this.pendingToolCalls.set(toolCall.toolCallId, {
        toolCallId: toolCall.toolCallId,
        name: toolCall.name,
        title: toolCall.title,
        sessionId,
        cwd,
        provider,
        traced: false,
      });
    }
  }

  private handleToolCallUpdate(update: NormalizedSessionUpdate, cwd: string): void {
    const { sessionId, provider, toolCall } = update;
    if (!toolCall) return;

    // Check if this update provides deferred input
    const pending = this.pendingToolCalls.get(toolCall.toolCallId);
    if (pending && !pending.traced && toolCall.inputFinalized && toolCall.input) {
      // Record the tool_call trace with the now-available input
      const finalToolCall: NormalizedToolCall = {
        ...toolCall,
        name: toolCall.name || pending.name,
        title: toolCall.title || pending.title,
      };
      this.recordToolCallTrace(sessionId, provider, finalToolCall, cwd);
      pending.traced = true;
    }

    // Record tool_result if complete
    const isComplete = toolCall.status === "completed" || toolCall.status === "failed";
    if (isComplete) {
      this.recordToolResultTrace(sessionId, provider, toolCall, cwd);
      // Clean up pending
      this.pendingToolCalls.delete(toolCall.toolCallId);
    }
  }

  private handleAgentMessage(update: NormalizedSessionUpdate, cwd: string): void {
    const { sessionId, provider, message } = update;
    if (!message) return;

    if (message.isChunk) {
      // Accumulate chunks
      const existing = this.messageBuffer.get(sessionId) ?? "";
      const accumulated = existing + message.content;
      this.messageBuffer.set(sessionId, accumulated);

      // Trace when buffer reaches threshold
      if (accumulated.length >= 100) {
        this.recordAgentMessageTrace(sessionId, provider, accumulated, cwd);
        this.messageBuffer.set(sessionId, "");
      }
    } else {
      // Complete message, trace immediately
      this.recordAgentMessageTrace(sessionId, provider, message.content, cwd);
    }
  }

  private handleAgentThought(update: NormalizedSessionUpdate, cwd: string): void {
    const { sessionId, provider, message } = update;
    if (!message) return;

    if (message.isChunk) {
      const existing = this.thoughtBuffer.get(sessionId) ?? "";
      const accumulated = existing + message.content;
      this.thoughtBuffer.set(sessionId, accumulated);

      if (accumulated.length >= 100) {
        this.recordAgentThoughtTrace(sessionId, provider, accumulated, cwd);
        this.thoughtBuffer.set(sessionId, "");
      }
    } else {
      this.recordAgentThoughtTrace(sessionId, provider, message.content, cwd);
    }
  }

  private handleUserMessage(update: NormalizedSessionUpdate, cwd: string): void {
    const { sessionId, provider, message } = update;
    if (!message) return;

    let trace = createTraceRecord(sessionId, "user_message", { provider });
    trace = withConversation(trace, {
      role: "user",
      contentPreview: message.content.slice(0, 200),
      fullContent: message.content,
    });
    recordTrace(cwd, trace);
  }

  private flushBuffers(sessionId: string, cwd: string, provider: string): void {
    // Flush message buffer
    const message = this.messageBuffer.get(sessionId);
    if (message && message.length > 0) {
      this.recordAgentMessageTrace(sessionId, provider, message, cwd);
      this.messageBuffer.set(sessionId, "");
    }

    // Flush thought buffer
    const thought = this.thoughtBuffer.get(sessionId);
    if (thought && thought.length > 0) {
      this.recordAgentThoughtTrace(sessionId, provider, thought, cwd);
      this.thoughtBuffer.set(sessionId, "");
    }
  }

  private recordToolCallTrace(
    sessionId: string,
    provider: string,
    toolCall: NormalizedToolCall,
    cwd: string
  ): void {
    const contextPaths = this.getContextWriter(cwd).getContextPaths(sessionId, toolCall.toolCallId);
    let trace = createTraceRecord(sessionId, "tool_call", { provider });
    trace = withTool(trace, {
      name: toolCall.name,
      toolCallId: toolCall.toolCallId,
      status: "running",
      input: toolCall.input,
    });

    // Extract file ranges from tool parameters
    const files = extractFilesFromToolCall(toolCall.name, toolCall.input);
    if (files.length > 0) {
      trace = { ...trace, files };
    }

    // Add VCS context
    const vcs = getVcsContextLight(cwd);
    if (vcs) {
      trace = withVcs(trace, vcs);
    }

    trace = withMetadata(trace, "toolCallResourceId", contextPaths.resourceId);
    trace = withMetadata(trace, "toolCallContextDir", contextPaths.contextDir);
    trace = withMetadata(trace, "toolCallContentPath", contextPaths.contentPath);
    trace = withMetadata(trace, "toolCallMetadataPath", contextPaths.metadataPath);

    recordTrace(cwd, trace);

    // Save fine-grained tool call context file
    this.getContextWriter(cwd).writeContext({
      toolName: toolCall.name,
      toolCallId: toolCall.toolCallId,
      sessionId,
      provider,
      status: "running",
      input: toolCall.input,
    }).catch((err) => {
      console.error("[TraceRecorder] Failed to write tool call context:", err);
    });
  }

  private recordToolResultTrace(
    sessionId: string,
    provider: string,
    toolCall: NormalizedToolCall,
    cwd: string
  ): void {
    const contextPaths = this.getContextWriter(cwd).getContextPaths(sessionId, toolCall.toolCallId);
    let trace = createTraceRecord(sessionId, "tool_result", { provider });
    trace = withTool(trace, {
      name: toolCall.name,
      toolCallId: toolCall.toolCallId,
      status: toolCall.status,
      output: toolCall.output as string | undefined,
    });
    trace = withMetadata(trace, "toolCallResourceId", contextPaths.resourceId);
    trace = withMetadata(trace, "toolCallContextDir", contextPaths.contextDir);
    trace = withMetadata(trace, "toolCallContentPath", contextPaths.contentPath);
    trace = withMetadata(trace, "toolCallMetadataPath", contextPaths.metadataPath);
    recordTrace(cwd, trace);

    // Save fine-grained tool call context file with result
    const status = toolCall.status === "completed" ? "completed" : "failed";
    this.getContextWriter(cwd).writeContext({
      toolName: toolCall.name,
      toolCallId: toolCall.toolCallId,
      sessionId,
      provider,
      status,
      input: toolCall.input,
      output: toolCall.output,
    }).catch((err) => {
      console.error("[TraceRecorder] Failed to write tool result context:", err);
    });
  }

  private recordAgentMessageTrace(
    sessionId: string,
    provider: string,
    content: string,
    cwd: string
  ): void {
    let trace = createTraceRecord(sessionId, "agent_message", { provider });
    trace = withConversation(trace, {
      role: "assistant",
      contentPreview: content.slice(0, 200),
      fullContent: content,
    });
    recordTrace(cwd, trace);
  }

  private recordAgentThoughtTrace(
    sessionId: string,
    provider: string,
    content: string,
    cwd: string
  ): void {
    let trace = createTraceRecord(sessionId, "agent_thought", { provider });
    trace = withConversation(trace, {
      role: "assistant",
      contentPreview: content.slice(0, 200),
      fullContent: content,
    });
    recordTrace(cwd, trace);
  }

  /**
   * Flush and record any buffered content for a session.
   * Call this when a prompt completes.
   *
   * @param sessionId - Session to flush
   * @param cwd - Working directory for trace storage
   * @param provider - Provider name for trace metadata
   */
  flushSession(sessionId: string, cwd: string, provider: string): void {
    this.flushBuffers(sessionId, cwd, provider);
  }

  /**
   * Clean up session data when session ends.
   */
  cleanupSession(sessionId: string): void {
    this.messageBuffer.delete(sessionId);
    this.thoughtBuffer.delete(sessionId);
    // Clean up any pending tool calls for this session
    for (const [toolCallId, pending] of this.pendingToolCalls) {
      if (pending.sessionId === sessionId) {
        this.pendingToolCalls.delete(toolCallId);
      }
    }
  }
}
