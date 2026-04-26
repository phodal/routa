import { renderHook, waitFor } from "@testing-library/react";
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
              content: "export default function Canvas(){ return <div>Status</div>; }",
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
      source: "export default function Canvas(){ return <div>Status</div>; }",
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
              content: "export default function Canvas(){ return <div>Status</div>; }",
            },
          },
        },
      ],
    });

    await waitFor(() => {
      expect(desktopAwareFetch).not.toHaveBeenCalled();
    });
  });
});
