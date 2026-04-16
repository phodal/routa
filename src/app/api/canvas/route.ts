import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { createArtifact } from "@/core/models/artifact";
import type {
  CanvasArtifactPayload,
  CanvasType,
  CanvasRenderMode,
} from "@/core/models/canvas-artifact";

export const dynamic = "force-dynamic";

const VALID_CANVAS_TYPES: CanvasType[] = ["fitness_overview"];
const VALID_RENDER_MODES: CanvasRenderMode[] = ["dynamic", "prebuilt"];

function isValidCanvasType(value: unknown): value is CanvasType {
  return (
    typeof value === "string" &&
    VALID_CANVAS_TYPES.includes(value as CanvasType)
  );
}

interface CreateCanvasBody {
  /** Render mode. Defaults to "dynamic". */
  renderMode?: CanvasRenderMode;
  /** Pre-built template (required for "prebuilt" mode). */
  canvasType?: CanvasType;
  title: string;
  /** TSX source code (required for "dynamic" mode). */
  source?: string;
  /** Structured data (required for "prebuilt" mode). */
  data?: unknown;
  workspaceId: string;
  taskId?: string;
  codebaseId?: string;
  repoPath?: string;
  agentId?: string;
}

/**
 * POST /api/canvas — Create a new canvas artifact.
 *
 * Supports two modes:
 *  - `dynamic`: agent provides TSX `source`; compiled client-side.
 *  - `prebuilt`: agent provides `canvasType` + `data`; rendered via template.
 */
export async function POST(request: NextRequest) {
  let body: CreateCanvasBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const renderMode: CanvasRenderMode = body.renderMode ?? "dynamic";

  if (!VALID_RENDER_MODES.includes(renderMode)) {
    return NextResponse.json(
      { error: `Invalid renderMode. Expected one of: ${VALID_RENDER_MODES.join(", ")}` },
      { status: 400 },
    );
  }

  if (!body.title || typeof body.title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  if (!body.workspaceId || typeof body.workspaceId !== "string") {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400 },
    );
  }

  // Validate mode-specific fields
  if (renderMode === "dynamic") {
    if (!body.source || typeof body.source !== "string") {
      return NextResponse.json(
        { error: "source (TSX string) is required for dynamic renderMode" },
        { status: 400 },
      );
    }
  } else {
    // prebuilt
    if (!isValidCanvasType(body.canvasType)) {
      return NextResponse.json(
        { error: `canvasType is required for prebuilt mode. Expected one of: ${VALID_CANVAS_TYPES.join(", ")}` },
        { status: 400 },
      );
    }
    if (body.data === undefined || body.data === null) {
      return NextResponse.json(
        { error: "data is required for prebuilt renderMode" },
        { status: 400 },
      );
    }
  }

  const payload: CanvasArtifactPayload = {
    metadata: {
      renderMode,
      canvasType: renderMode === "prebuilt" ? body.canvasType : undefined,
      title: body.title,
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      workspaceId: body.workspaceId,
      codebaseId: body.codebaseId,
      repoPath: body.repoPath,
    },
    source: renderMode === "dynamic" ? body.source : undefined,
    data: renderMode === "prebuilt" ? body.data : undefined,
  };

  const id = crypto.randomUUID();
  const artifact = createArtifact({
    id,
    type: "canvas",
    taskId: body.taskId ?? `canvas-${id}`,
    workspaceId: body.workspaceId,
    providedByAgentId: body.agentId,
    content: JSON.stringify(payload),
    context: `Canvas: ${body.title}`,
    status: "provided",
    metadata: {
      renderMode,
      canvasType: renderMode === "prebuilt" ? (body.canvasType ?? "") : "",
      title: body.title,
      schemaVersion: "1",
    },
  });

  const system = getRoutaSystem();
  await system.artifactStore.saveArtifact(artifact);

  return NextResponse.json({
    id: artifact.id,
    renderMode,
    canvasType: payload.metadata.canvasType,
    title: body.title,
    createdAt: artifact.createdAt.toISOString(),
  }, { status: 201 });
}

/**
 * GET /api/canvas — List canvas artifacts for a workspace.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId query parameter is required" },
      { status: 400 },
    );
  }

  const system = getRoutaSystem();
  const allArtifacts = await system.artifactStore.listByWorkspace(workspaceId);
  const canvasArtifacts = allArtifacts
    .filter((a) => a.type === "canvas")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const items = canvasArtifacts.map((a) => {
    const payload = parseCanvasPayload(a.content);
    return {
      id: a.id,
      renderMode: payload?.metadata.renderMode ?? "prebuilt",
      canvasType: payload?.metadata.canvasType ?? undefined,
      title: payload?.metadata.title ?? a.context ?? "Untitled",
      generatedAt: payload?.metadata.generatedAt ?? a.createdAt.toISOString(),
      createdAt: a.createdAt.toISOString(),
    };
  });

  return NextResponse.json({ canvasArtifacts: items });
}

function parseCanvasPayload(
  content: string | undefined,
): CanvasArtifactPayload | null {
  if (!content) return null;
  try {
    return JSON.parse(content) as CanvasArtifactPayload;
  } catch {
    return null;
  }
}
