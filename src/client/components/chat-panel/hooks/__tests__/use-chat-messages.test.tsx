import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChatMessages } from "../use-chat-messages";

vi.mock("@/client/utils/diagnostics", () => ({
  desktopAwareFetch: vi.fn(),
}));

import { desktopAwareFetch } from "@/client/utils/diagnostics";

function okJson(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

describe("useChatMessages", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("retries transcript hydration for an active session until messages become available", async () => {
    const fetchMock = vi.mocked(desktopAwareFetch);
    fetchMock
      .mockResolvedValueOnce(okJson({
        history: [],
        messages: [],
        latestEventKind: "agent_message",
      }))
      .mockResolvedValueOnce(okJson({
        history: [],
        messages: [
          {
            id: "msg-1",
            role: "assistant",
            content: "hydrated later",
            timestamp: "2026-04-03T14:08:44.000Z",
          },
        ],
        latestEventKind: "agent_message",
      }));

    const { result } = renderHook(() => useChatMessages({
      activeSessionId: "session-1",
      updates: [],
    }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(result.current.visibleMessages).toHaveLength(0);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.visibleMessages).toHaveLength(1));

    expect(result.current.visibleMessages[0]?.content).toBe("hydrated later");
  });

  it("rehydrates the consolidated transcript after turn_complete", async () => {
    const fetchMock = vi.mocked(desktopAwareFetch);
    fetchMock
      .mockResolvedValueOnce(okJson({
        history: [],
        messages: [
          {
            id: "msg-initial",
            role: "assistant",
            content: "before live updates",
            timestamp: "2026-04-03T14:08:44.000Z",
          },
        ],
        latestEventKind: "turn_complete",
      }))
      .mockResolvedValueOnce(okJson({
        history: [],
        messages: [
          {
            id: "msg-final",
            role: "assistant",
            content: "merged final answer",
            timestamp: "2026-04-03T14:08:55.000Z",
          },
        ],
        latestEventKind: "turn_complete",
      }));

    const updates = [
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Thinking..." },
        },
      },
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "turn_complete",
        },
      },
    ];

    const { result, rerender } = renderHook(
      ({ incomingUpdates }) => useChatMessages({
        activeSessionId: "session-1",
        updates: incomingUpdates,
      }),
      {
        initialProps: {
          incomingUpdates: [] as typeof updates,
        },
      },
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.visibleMessages[0]?.content).toBe("before live updates"));

    rerender({ incomingUpdates: updates });

    await waitFor(() => expect(result.current.isSessionRunning).toBe(false));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.visibleMessages[0]?.content).toBe("merged final answer"));
    expect(result.current.visibleMessages).toHaveLength(1);
  });

  it("keeps assistant chunks merged when process output updates are interleaved", async () => {
    const fetchMock = vi.mocked(desktopAwareFetch);
    fetchMock.mockResolvedValue(okJson({
      history: [],
      messages: [],
      latestEventKind: "turn_complete",
    }));

    const updates = [
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "我" },
        },
      },
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "process_output",
          source: "stderr",
          data: "provider stderr line\n",
          displayName: "Codex",
        },
      },
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "会" },
        },
      },
    ];

    const { result, rerender } = renderHook(
      ({ incomingUpdates }) => useChatMessages({
        activeSessionId: "session-1",
        updates: incomingUpdates,
      }),
      {
        initialProps: {
          incomingUpdates: [] as typeof updates,
        },
      },
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rerender({ incomingUpdates: updates });

    await waitFor(() => expect(result.current.visibleMessages).toHaveLength(2));
    expect(result.current.visibleMessages[0]).toMatchObject({
      role: "assistant",
      content: "我会",
    });
    expect(result.current.visibleMessages[1]).toMatchObject({
      role: "terminal",
      content: "provider stderr line\n",
    });
  });

  it("starts a fresh assistant message after a tool call", async () => {
    const fetchMock = vi.mocked(desktopAwareFetch);
    fetchMock.mockResolvedValue(okJson({
      history: [],
      messages: [],
      latestEventKind: "turn_complete",
    }));

    const updates = [
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "before tool" },
        },
      },
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "list_mcp_resources",
          kind: "mcp",
        },
      },
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "after tool" },
        },
      },
    ];

    const { result, rerender } = renderHook(
      ({ incomingUpdates }) => useChatMessages({
        activeSessionId: "session-1",
        updates: incomingUpdates,
      }),
      {
        initialProps: {
          incomingUpdates: [] as typeof updates,
        },
      },
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rerender({ incomingUpdates: updates });

    await waitFor(() => expect(result.current.visibleMessages).toHaveLength(3));
    expect(result.current.visibleMessages[0]).toMatchObject({
      role: "assistant",
      content: "before tool",
    });
    expect(result.current.visibleMessages[1]).toMatchObject({
      role: "tool",
      toolCallId: "tool-1",
    });
    expect(result.current.visibleMessages[2]).toMatchObject({
      role: "assistant",
      content: "after tool",
    });
  });

  it("does not reconnect assistant chunks across tool calls even with process output in between", async () => {
    const fetchMock = vi.mocked(desktopAwareFetch);
    fetchMock.mockResolvedValue(okJson({
      history: [],
      messages: [],
      latestEventKind: "turn_complete",
    }));

    const updates = [
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "before tool" },
        },
      },
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "list_mcp_resources",
          kind: "mcp",
        },
      },
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "process_output",
          source: "stderr",
          data: "provider stderr line\n",
          displayName: "Codex",
        },
      },
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "after tool" },
        },
      },
    ];

    const { result, rerender } = renderHook(
      ({ incomingUpdates }) => useChatMessages({
        activeSessionId: "session-1",
        updates: incomingUpdates,
      }),
      {
        initialProps: {
          incomingUpdates: [] as typeof updates,
        },
      },
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rerender({ incomingUpdates: updates });

    await waitFor(() => expect(result.current.visibleMessages).toHaveLength(4));
    expect(result.current.visibleMessages[0]).toMatchObject({
      role: "assistant",
      content: "before tool",
    });
    expect(result.current.visibleMessages[1]).toMatchObject({
      role: "tool",
      toolCallId: "tool-1",
    });
    expect(result.current.visibleMessages[2]).toMatchObject({
      role: "terminal",
      content: "provider stderr line\n",
    });
    expect(result.current.visibleMessages[3]).toMatchObject({
      role: "assistant",
      content: "after tool",
    });
  });

  it("starts a fresh assistant message after a completed turn", async () => {
    const fetchMock = vi.mocked(desktopAwareFetch);
    fetchMock.mockResolvedValue(okJson({
      history: [],
      messages: [
        {
          id: "msg-old",
          role: "assistant",
          content: "old answer",
          timestamp: "2026-04-03T14:08:44.000Z",
        },
      ],
      latestEventKind: "turn_complete",
    }));

    const updates = [
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "new answer" },
        },
      },
    ];

    const { result, rerender } = renderHook(
      ({ incomingUpdates }) => useChatMessages({
        activeSessionId: "session-1",
        updates: incomingUpdates,
      }),
      {
        initialProps: {
          incomingUpdates: [] as typeof updates,
        },
      },
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.visibleMessages[0]?.content).toBe("old answer"));

    rerender({ incomingUpdates: updates });

    await waitFor(() => expect(result.current.visibleMessages).toHaveLength(2));
    expect(result.current.visibleMessages[0]).toMatchObject({
      role: "assistant",
      content: "old answer",
    });
    expect(result.current.visibleMessages[1]).toMatchObject({
      role: "assistant",
      content: "new answer",
    });
  });
});
