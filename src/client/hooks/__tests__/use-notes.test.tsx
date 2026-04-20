import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  desktopAwareFetchMock,
  getDesktopApiBaseUrlMock,
  logRuntimeMock,
  shouldSuppressTeardownErrorMock,
  toErrorMessageMock,
} = vi.hoisted(() => ({
  desktopAwareFetchMock: vi.fn(),
  getDesktopApiBaseUrlMock: vi.fn(() => "http://desktop"),
  logRuntimeMock: vi.fn(),
  shouldSuppressTeardownErrorMock: vi.fn(() => false),
  toErrorMessageMock: vi.fn((error: unknown) => error instanceof Error ? error.message : String(error)),
}));

vi.mock("../../utils/diagnostics", () => ({
  desktopAwareFetch: desktopAwareFetchMock,
  getDesktopApiBaseUrl: getDesktopApiBaseUrlMock,
  logRuntime: logRuntimeMock,
  shouldSuppressTeardownError: shouldSuppressTeardownErrorMock,
  toErrorMessage: toErrorMessageMock,
}));

import { useNotes } from "../use-notes";

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
}

function okJson(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

describe("useNotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.instances = [];
    vi.useRealTimers();
    vi.stubGlobal("EventSource", MockEventSource);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("fetches notes on mount, filters by session, and connects SSE", async () => {
    desktopAwareFetchMock.mockResolvedValueOnce(okJson({
      notes: [
        {
          id: "task-1",
          title: "Task note",
          content: "Do work",
          workspaceId: "ws-1",
          sessionId: "session-1",
          metadata: { type: "task" },
          createdAt: "2026-04-12T00:00:00.000Z",
          updatedAt: "2026-04-12T00:00:00.000Z",
        },
        {
          id: "general-1",
          title: "General note",
          content: "Shared",
          workspaceId: "ws-1",
          metadata: { type: "general" },
          createdAt: "2026-04-12T00:00:00.000Z",
          updatedAt: "2026-04-12T00:00:00.000Z",
        },
        {
          id: "task-2",
          title: "Other session",
          content: "Skip",
          workspaceId: "ws-1",
          sessionId: "session-2",
          metadata: { type: "task" },
          createdAt: "2026-04-12T00:00:00.000Z",
          updatedAt: "2026-04-12T00:00:00.000Z",
        },
      ],
    }));

    const { result } = renderHook(() => useNotes("ws-1", "session-1"));

    await waitFor(() => {
      expect(result.current.notes.map((note) => note.id)).toEqual(["task-1", "general-1"]);
    });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]?.url).toBe("http://desktop/api/notes/events?workspaceId=ws-1");

    act(() => {
      MockEventSource.instances[0]?.onopen?.();
    });

    expect(result.current.connected).toBe(true);
  });

  it("applies SSE create, update, and delete events", async () => {
    desktopAwareFetchMock.mockResolvedValueOnce(okJson({ notes: [] }));

    const { result } = renderHook(() => useNotes("ws-1", "session-1"));

    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1);
    });

    act(() => {
      MockEventSource.instances[0]?.onmessage?.({
        data: JSON.stringify({
          type: "note:created",
          note: {
            id: "task-1",
            title: "Task note",
            content: "Draft",
            workspaceId: "ws-1",
            sessionId: "session-1",
            metadata: { type: "task" },
            createdAt: new Date("2026-04-12T00:00:00.000Z"),
            updatedAt: new Date("2026-04-12T00:00:00.000Z"),
          },
        }),
      } as MessageEvent);
    });

    expect(result.current.notes.map((note) => note.id)).toEqual(["task-1"]);

    act(() => {
      MockEventSource.instances[0]?.onmessage?.({
        data: JSON.stringify({
          type: "note:updated",
          note: {
            id: "task-1",
            title: "Task note updated",
            content: "Final",
            workspaceId: "ws-1",
            sessionId: "session-1",
            metadata: { type: "task" },
            createdAt: new Date("2026-04-12T00:00:00.000Z"),
            updatedAt: new Date("2026-04-12T01:00:00.000Z"),
          },
        }),
      } as MessageEvent);
    });

    expect(result.current.notes[0]).toMatchObject({
      title: "Task note updated",
      content: "Final",
    });

    act(() => {
      MockEventSource.instances[0]?.onmessage?.({
        data: JSON.stringify({
          type: "note:deleted",
          noteId: "task-1",
        }),
      } as MessageEvent);
    });

    expect(result.current.notes).toEqual([]);
  });

  it("supports note CRUD helpers and reports fetch/create failures", async () => {
    desktopAwareFetchMock
      .mockResolvedValueOnce(okJson({ notes: [] }))
      .mockResolvedValueOnce(okJson({
        note: {
          id: "note-1",
          title: "Fetched",
          content: "",
          workspaceId: "ws-1",
          metadata: { type: "general" },
          createdAt: "2026-04-12T00:00:00.000Z",
          updatedAt: "2026-04-12T00:00:00.000Z",
        },
      }))
      .mockResolvedValueOnce(okJson({
        note: {
          id: "note-2",
          title: "Created",
          content: "Body",
          workspaceId: "ws-1",
          metadata: { type: "general" },
          createdAt: "2026-04-12T00:00:00.000Z",
          updatedAt: "2026-04-12T00:00:00.000Z",
        },
      }))
      .mockResolvedValueOnce(okJson({
        note: {
          id: "note-2",
          title: "Updated",
          content: "Body 2",
          workspaceId: "ws-1",
          metadata: { type: "general" },
          createdAt: "2026-04-12T00:00:00.000Z",
          updatedAt: "2026-04-12T00:00:00.000Z",
        },
      }))
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce({ ok: false, status: 500 });

    const { result } = renderHook(() => useNotes("ws-1"));

    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1);
    });

    await act(async () => {
      const note = await result.current.fetchNote("note-1");
      expect(note?.id).toBe("note-1");
    });

    await act(async () => {
      const created = await result.current.createNote({ title: "Created", content: "Body" });
      expect(created?.id).toBe("note-2");
    });

    await act(async () => {
      const updated = await result.current.updateNote("note-2", { title: "Updated", content: "Body 2" });
      expect(updated?.title).toBe("Updated");
    });

    await act(async () => {
      await result.current.deleteNote("note-2");
    });

    await act(async () => {
      const created = await result.current.createNote({ title: "Broken" });
      expect(created).toBeNull();
    });

    expect(result.current.error).toBe("Failed to create note: 500");
  });
});
