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
});
