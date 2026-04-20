"use client";

import { useSyncExternalStore } from "react";

import { CanvasViewer } from "@/client/components/canvas-viewer";

function subscribe() {
  return () => {};
}

export function CanvasViewerClient({ canvasId }: { canvasId: string }) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  // CanvasViewer suspends on fetch and uses relative API paths. Delay rendering
  // until the browser has mounted so Node/SSR never tries to resolve `/api/...`.
  if (!mounted) {
    return null;
  }

  return <CanvasViewer canvasId={canvasId} />;
}
