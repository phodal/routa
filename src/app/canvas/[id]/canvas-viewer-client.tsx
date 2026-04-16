"use client";

import { CanvasViewer } from "@/client/components/canvas-viewer";

export function CanvasViewerClient({ canvasId }: { canvasId: string }) {
  return <CanvasViewer canvasId={canvasId} />;
}
