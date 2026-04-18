import { NextRequest, NextResponse } from "next/server";

import { persistFitnessCanvasSource } from "@/core/canvas/local-canvas-storage";

export const dynamic = "force-dynamic";

interface MaterializeCanvasBody {
  workspaceId: string;
  repoPath: string;
  repoLabel?: string;
  source: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(
  body: Record<string, unknown>,
  key: keyof MaterializeCanvasBody,
): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

export async function POST(request: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isPlainObject(rawBody)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const workspaceId = readOptionalString(rawBody, "workspaceId")?.trim();
  const repoPath = readOptionalString(rawBody, "repoPath")?.trim();
  const repoLabel = readOptionalString(rawBody, "repoLabel")?.trim();
  const source = readOptionalString(rawBody, "source")?.trim();

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  if (!repoPath) {
    return NextResponse.json({ error: "repoPath is required" }, { status: 400 });
  }
  if (!source) {
    return NextResponse.json({ error: "source is required" }, { status: 400 });
  }

  try {
    const stored = await persistFitnessCanvasSource({
      repoPath,
      repoLabel,
      source,
    });

    return NextResponse.json({
      workspaceId,
      ...stored,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to persist canvas source",
      },
      { status: 500 },
    );
  }
}
