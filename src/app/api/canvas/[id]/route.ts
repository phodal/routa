import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import type { CanvasArtifactPayload } from "@/core/models/canvas-artifact";

export const dynamic = "force-dynamic";

/**
 * GET /api/canvas/[id] — Retrieve a canvas artifact by ID.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const system = getRoutaSystem();
  const artifact = await system.artifactStore.getArtifact(id);

  if (!artifact || artifact.type !== "canvas") {
    return NextResponse.json(
      { error: "Canvas artifact not found" },
      { status: 404 },
    );
  }

  let payload: CanvasArtifactPayload | null = null;
  if (artifact.content) {
    try {
      payload = JSON.parse(artifact.content) as CanvasArtifactPayload;
    } catch {
      return NextResponse.json(
        { error: "Canvas artifact data is corrupted" },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    id: artifact.id,
    renderMode: payload?.metadata.renderMode ?? "prebuilt",
    canvasType: payload?.metadata.canvasType,
    title: payload?.metadata.title ?? artifact.context ?? "Untitled",
    schemaVersion: payload?.metadata.schemaVersion,
    generatedAt: payload?.metadata.generatedAt,
    source: payload?.source,
    data: payload?.data,
    workspaceId: artifact.workspaceId,
    createdAt: artifact.createdAt instanceof Date
      ? artifact.createdAt.toISOString()
      : artifact.createdAt,
  });
}

/**
 * DELETE /api/canvas/[id] — Delete a canvas artifact.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const system = getRoutaSystem();
  const artifact = await system.artifactStore.getArtifact(id);

  if (!artifact || artifact.type !== "canvas") {
    return NextResponse.json(
      { error: "Canvas artifact not found" },
      { status: 404 },
    );
  }

  await system.artifactStore.deleteArtifact(id);
  return NextResponse.json({ deleted: true });
}
