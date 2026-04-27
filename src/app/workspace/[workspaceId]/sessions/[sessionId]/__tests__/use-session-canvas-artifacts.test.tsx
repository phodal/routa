import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AcpSessionNotification } from "@/client/acp-client";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { useSessionCanvasArtifacts } from "../use-session-canvas-artifacts";

vi.mock("@/client/utils/diagnostics", () => ({
  desktopAwareFetch: vi.fn(),
}));

function createdCanvas(id: string) {
  return {
    ok: true,
    json: async () => ({
      id,
      title: "Status",
    }),
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

describe("useSessionCanvasArtifacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(desktopAwareFetch).mockResolvedValue(createdCanvas("canvas-1"));
  });

  it("creates a canvas artifact when a tool completes writing a canvas file", async () => {
    const { result, rerender } = renderHook(
      ({ updates }) => useSessionCanvasArtifacts({
        workspaceId: "default",
        sessionId: "session-1",
        updates,
        repoPath: "/repo",
      }),
      {
        initialProps: {
          updates: [] as AcpSessionNotification[],
        },
      },
    );

    rerender({
      updates: [
        {
          sessionId: "session-1",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "tool-1",
            status: "running",
            rawInput: {
              path: "canvases/status.canvas.tsx",
              content: "export default () => <div>Status</div>;",
            },
          },
        },
        {
          sessionId: "session-1",
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-1",
            status: "completed",
          },
        },
      ],
    });

    await waitFor(() => {
      expect(desktopAwareFetch).toHaveBeenCalledTimes(1);
    });

    const [, init] = vi.mocked(desktopAwareFetch).mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      renderMode: "dynamic",
      repoPath: "/repo",
      source: "export default () => <div>Status</div>;",
      title: "Status",
      workspaceId: "default",
    });

    await waitFor(() => {
      expect(result.current.activeCanvas).toMatchObject({
        fileName: "status.canvas.tsx",
        filePath: "canvases/status.canvas.tsx",
        id: "canvas-1",
        title: "Status",
        viewerUrl: "/canvas/canvas-1",
      });
    });
  });

  it("ignores completed canvas writes from other sessions", async () => {
    const { rerender } = renderHook(
      ({ updates }) => useSessionCanvasArtifacts({
        workspaceId: "default",
        sessionId: "session-1",
        updates,
      }),
      {
        initialProps: {
          updates: [] as AcpSessionNotification[],
        },
      },
    );

    rerender({
      updates: [
        {
          sessionId: "session-2",
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-1",
            status: "completed",
            rawInput: {
              path: "canvases/status.canvas.tsx",
              content: "export default () => <div>Status</div>;",
            },
          },
        },
      ],
    });

    await waitFor(() => {
      expect(desktopAwareFetch).not.toHaveBeenCalled();
    });
  });

  it("releases cached raw input after a tool call settles without rendering", async () => {
    const { rerender } = renderHook(
      ({ updates }) => useSessionCanvasArtifacts({
        workspaceId: "default",
        sessionId: "session-1",
        updates,
      }),
      {
        initialProps: {
          updates: [] as AcpSessionNotification[],
        },
      },
    );

    const runningUpdate: AcpSessionNotification = {
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        status: "running",
        rawInput: {
          path: "canvases/status.canvas.tsx",
          content: "export default () => <div>Status</div>;",
        },
      },
    };
    const failedUpdate: AcpSessionNotification = {
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "failed",
      },
    };

    rerender({ updates: [runningUpdate, failedUpdate] });
    rerender({
      updates: [
        runningUpdate,
        failedUpdate,
        {
          sessionId: "session-1",
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-1",
            status: "completed",
          },
        },
      ],
    });

    await waitFor(() => {
      expect(desktopAwareFetch).not.toHaveBeenCalled();
    });
  });

  it("ignores completed OpenCode tool updates that carry error output", async () => {
    const { rerender } = renderHook(
      ({ updates }) => useSessionCanvasArtifacts({
        workspaceId: "default",
        sessionId: "session-1",
        updates,
      }),
      {
        initialProps: {
          updates: [] as AcpSessionNotification[],
        },
      },
    );

    const runningUpdate: AcpSessionNotification = {
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        status: "running",
        rawInput: {
          path: "canvases/status.canvas.tsx",
          content: "export default () => <div>Status</div>;",
        },
      },
    };

    rerender({
      updates: [
        runningUpdate,
        {
          sessionId: "session-1",
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-1",
            status: "completed",
            rawOutput: "Tool execution failed",
          },
        },
      ],
    });

    await waitFor(() => {
      expect(desktopAwareFetch).not.toHaveBeenCalled();
    });
  });

  it("allows a failed canvas materialization to retry the same candidate", async () => {
    vi.mocked(desktopAwareFetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: "renderer unavailable" }),
      } as Response)
      .mockResolvedValueOnce(createdCanvas("canvas-retry"));

    const { result, rerender } = renderHook(
      ({ updates }) => useSessionCanvasArtifacts({
        workspaceId: "default",
        sessionId: "session-1",
        updates,
      }),
      {
        initialProps: {
          updates: [] as AcpSessionNotification[],
        },
      },
    );

    const completedUpdate: AcpSessionNotification = {
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        rawInput: {
          path: "canvases/status.canvas.tsx",
          content: "export default () => <div>Status</div>;",
        },
      },
    };

    rerender({ updates: [completedUpdate] });

    await waitFor(() => {
      expect(result.current.error).toBe("renderer unavailable");
    });

    rerender({
      updates: [
        completedUpdate,
        { ...completedUpdate, update: { ...completedUpdate.update } },
      ],
    });

    await waitFor(() => {
      expect(desktopAwareFetch).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(result.current.activeCanvas).toMatchObject({
        id: "canvas-retry",
        filePath: "canvases/status.canvas.tsx",
      });
    });
  });

  it("keeps an in-flight canvas materialization alive across non-canvas update rerenders", async () => {
    const pending = deferred<Response>();
    vi.mocked(desktopAwareFetch).mockReturnValueOnce(pending.promise);
    const canvasUpdates: AcpSessionNotification[] = [
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          status: "completed",
          rawInput: {
            path: "canvases/status.canvas.tsx",
            content: "export default () => <div>Status</div>;",
          },
        },
      },
    ];

    const { result, rerender } = renderHook(
      ({ updates }) => useSessionCanvasArtifacts({
        workspaceId: "default",
        sessionId: "session-1",
        updates,
      }),
      {
        initialProps: {
          updates: [] as AcpSessionNotification[],
        },
      },
    );

    rerender({ updates: canvasUpdates });
    await waitFor(() => expect(result.current.isMaterializing).toBe(true));

    rerender({
      updates: [
        ...canvasUpdates,
        {
          sessionId: "session-1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "done" },
          },
        },
      ],
    });

    await act(async () => {
      pending.resolve(createdCanvas("canvas-2"));
      await pending.promise;
    });

    await waitFor(() => {
      expect(result.current).toMatchObject({
        activeCanvas: {
          id: "canvas-2",
          filePath: "canvases/status.canvas.tsx",
        },
        isMaterializing: false,
      });
    });
  });

  it("dismisses an in-flight canvas materialization when the panel is closed", async () => {
    const pending = deferred<Response>();
    vi.mocked(desktopAwareFetch).mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(
      ({ updates }) => useSessionCanvasArtifacts({
        workspaceId: "default",
        sessionId: "session-1",
        updates,
      }),
      {
        initialProps: {
          updates: [] as AcpSessionNotification[],
        },
      },
    );

    rerender({
      updates: [
        {
          sessionId: "session-1",
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-1",
            status: "completed",
            rawInput: {
              path: "canvases/status.canvas.tsx",
              content: "export default () => <div>Status</div>;",
            },
          },
        },
      ],
    });

    await waitFor(() => expect(result.current.isMaterializing).toBe(true));

    act(() => {
      result.current.clearActiveCanvas();
    });

    expect(result.current).toMatchObject({
      activeCanvas: null,
      error: null,
      isMaterializing: false,
    });

    await act(async () => {
      pending.resolve(createdCanvas("canvas-3"));
      await pending.promise;
    });

    expect(result.current).toMatchObject({
      activeCanvas: null,
      error: null,
      isMaterializing: false,
    });
  });
});
