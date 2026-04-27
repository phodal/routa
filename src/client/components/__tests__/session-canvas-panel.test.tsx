import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SessionCanvasPanel } from "../session-canvas-panel";

vi.mock("@/client/components/canvas-viewer", () => ({
  CanvasViewer: ({ canvasId }: { canvasId: string }) => (
    <div data-testid="canvas-viewer">{canvasId}</div>
  ),
}));

describe("SessionCanvasPanel", () => {
  it("renders the active canvas preview and detected file metadata", () => {
    render(
      <SessionCanvasPanel
        activeCanvas={{
          fileName: "status.canvas.tsx",
          filePath: "/repo/canvases/status.canvas.tsx",
          id: "canvas-1",
          title: "Status",
          viewerUrl: "/canvas/canvas-1",
        }}
        error={null}
        isMaterializing={false}
        onClose={() => {}}
      />,
    );

    expect(screen.getByTestId("session-canvas-panel")).toBeTruthy();
    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("Detected file: status.canvas.tsx")).toBeTruthy();
    expect(screen.getByTestId("canvas-viewer").textContent).toBe("canvas-1");
    expect(screen.getByRole("link", { name: "Open canvas" }).getAttribute("href")).toBe("/canvas/canvas-1");
  });

  it("renders materializing and error states", () => {
    const { rerender } = render(
      <SessionCanvasPanel
        activeCanvas={null}
        error={null}
        isMaterializing
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Rendering canvas...")).toBeTruthy();

    rerender(
      <SessionCanvasPanel
        activeCanvas={null}
        error="bad source"
        isMaterializing={false}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Canvas render setup failed: bad source")).toBeTruthy();
  });
});
