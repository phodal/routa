import { describe, expect, it } from "vitest";
import { buildPreferredTranscriptPayload, historyNotificationsToMessages } from "@/core/session-transcript";
import type { TraceRecord } from "@/core/trace";
import type { AcpSessionNotification } from "@/core/store/acp-session-store";

describe("buildPreferredTranscriptPayload", () => {
  it("prefers traces when they restore a richer transcript", () => {
    const history: AcpSessionNotification[] = [
      {
        sessionId: "s1",
        update: {
          sessionUpdate: "tool_call",
          kind: "delegate_task",
          toolCallId: "call-1",
        },
      },
    ];
    const traces: TraceRecord[] = [
      {
        version: "0.1.0",
        id: "t1",
        timestamp: "2026-03-21T11:22:49.789Z",
        sessionId: "s1",
        contributor: { provider: "claude" },
        eventType: "user_message",
        conversation: { role: "user", fullContent: "investigate issue 206" },
      },
      {
        version: "0.1.0",
        id: "t2",
        timestamp: "2026-03-21T11:22:54.364Z",
        sessionId: "s1",
        contributor: { provider: "claude" },
        eventType: "agent_message",
        conversation: { role: "assistant", fullContent: "I'll dispatch a researcher." },
      },
    ];

    const payload = buildPreferredTranscriptPayload({ sessionId: "s1", history, traces });

    expect(payload.source).toBe("traces");
    expect(payload.messages).toHaveLength(2);
    expect(payload.history).toHaveLength(1);
  });

  it("keeps history when traces do not add transcript coverage", () => {
    const history: AcpSessionNotification[] = [
      {
        sessionId: "s1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hello" },
        },
      },
      {
        sessionId: "s1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: " world" },
        },
      },
    ];

    const payload = buildPreferredTranscriptPayload({ sessionId: "s1", history, traces: [] });

    expect(payload.source).toBe("history");
    expect(payload.historyMessageCount).toBe(1);
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0].content).toBe("hello world");
  });

  it("preserves explicit tool names in history-derived transcripts", () => {
    const messages = historyNotificationsToMessages(
      [
        {
          sessionId: "s1",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "call-1",
            tool: "update_card",
            kind: "unknown",
            status: "running",
            rawInput: { cardId: "card-1" },
          },
        },
      ],
      "s1",
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.toolName).toBe("update_card");
  });

  it("normalizes delegated task tools so chat views can suppress duplicate prompt previews", () => {
    const messages = historyNotificationsToMessages(
      [
        {
          sessionId: "s1",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "call-1",
            tool: "delegate_task_to_agent",
            kind: "delegate_task_to_agent",
            status: "running",
            rawInput: {
              description: "Run review",
              prompt: "You are assigned to Kanban task: Run review",
            },
          },
        },
      ],
      "s1",
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.toolKind).toBe("task");
  });

  it("restores consolidated user and agent messages from history", () => {
    const payload = buildPreferredTranscriptPayload({
      sessionId: "s1",
      history: [
        {
          sessionId: "s1",
          update: {
            sessionUpdate: "user_message",
            content: { type: "text", text: "hello" },
          },
        },
        {
          sessionId: "s1",
          update: {
            sessionUpdate: "agent_message",
            content: { type: "text", text: "world" },
          },
        },
      ],
      traces: [],
    });

    expect(payload.source).toBe("history");
    expect(payload.historyMessageCount).toBe(2);
    expect(payload.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });
});
