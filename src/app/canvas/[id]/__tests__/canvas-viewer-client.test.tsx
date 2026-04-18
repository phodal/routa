import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/client/components/canvas-viewer", () => ({
  CanvasViewer: ({ canvasId }: { canvasId: string }) => (
    <div data-testid="canvas-viewer">{canvasId}</div>
  ),
}));

import { CanvasViewerClient } from "../canvas-viewer-client";

describe("CanvasViewerClient", () => {
  it("forwards the canvas id to the shared viewer", () => {
    render(<CanvasViewerClient canvasId="canvas-456" />);

    expect(screen.getByTestId("canvas-viewer").textContent).toBe("canvas-456");
  });
});