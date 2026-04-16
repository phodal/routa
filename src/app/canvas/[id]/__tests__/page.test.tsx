import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../canvas-viewer-client", () => ({
  CanvasViewerClient: ({ canvasId }: { canvasId: string }) => (
    <div data-testid="canvas-viewer-client">{canvasId}</div>
  ),
}));

import CanvasViewerPage, { generateStaticParams } from "../page";

describe("canvas viewer page", () => {
  it("passes the route id through to the client viewer", async () => {
    render(await CanvasViewerPage({ params: Promise.resolve({ id: "canvas-123" }) }));

    expect(screen.getByTestId("canvas-viewer-client").textContent).toBe("canvas-123");
  });

  it("keeps the placeholder static params for static export", async () => {
    const original = process.env.ROUTA_BUILD_STATIC;
    process.env.ROUTA_BUILD_STATIC = "1";

    try {
      await expect(generateStaticParams()).resolves.toEqual([{ id: "__placeholder__" }]);
    } finally {
      process.env.ROUTA_BUILD_STATIC = original;
    }
  });
});