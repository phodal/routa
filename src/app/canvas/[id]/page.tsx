/**
 * Canvas - /canvas/:id
 * Viewer page for opening a saved canvas artifact by ID, including static-export placeholder support.
 */
import { Suspense } from "react";

import { CanvasViewerClient } from "./canvas-viewer-client";

// Required for static export — allow placeholder path to be pre-rendered.
export async function generateStaticParams() {
  if (process.env.ROUTA_BUILD_STATIC === "1") {
    return [{ id: "__placeholder__" }];
  }
  return [];
}

export default async function CanvasViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <CanvasViewerClient canvasId={id} />
    </Suspense>
  );
}
