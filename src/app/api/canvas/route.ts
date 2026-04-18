import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { createArtifact } from "@/core/models/artifact";
import { createTask, TaskStatus } from "@/core/models/task";
import type {
  CanvasArtifactPayload,
  CanvasType,
  CanvasRenderMode,
} from "@/core/models/canvas-artifact";

export const dynamic = "force-dynamic";

const VALID_CANVAS_TYPES: CanvasType[] = ["fitness_overview"];
const VALID_RENDER_MODES: CanvasRenderMode[] = ["dynamic", "prebuilt"];
type RoutaSystem = ReturnType<typeof getRoutaSystem>;

function isValidCanvasType(value: unknown): value is CanvasType {
  return (
    typeof value === "string" &&
    VALID_CANVAS_TYPES.includes(value as CanvasType)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface CreateCanvasBody {
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

export interface CreatedCanvasArtifact {
  id: string;
  renderMode: CanvasRenderMode;
  canvasType?: CanvasType;
  title: string;
  taskId: string;
  createdAt: string;
}

async function resolveCanvasTaskId(
  system: RoutaSystem,
  body: CreateCanvasBody,
): Promise<string | NextResponse> {
  const workspace = await system.workspaceStore.get(body.workspaceId);
  if (!workspace) {
    return NextResponse.json(
      { error: `Workspace not found: ${body.workspaceId}` },
      { status: 400 },
    );
  }

  if (body.taskId) {
    const task = await system.taskStore.get(body.taskId);
    if (!task) {
      return NextResponse.json(
        { error: `Task not found: ${body.taskId}` },
        { status: 400 },
      );
    }
    if (task.workspaceId !== body.workspaceId) {
      return NextResponse.json(
        {
          error: `taskId ${body.taskId} does not belong to workspace ${body.workspaceId}`,
        },
        { status: 400 },
      );
    }
    return task.id;
  }

  const task = createTask({
    id: crypto.randomUUID(),
    title: `Canvas artifact: ${body.title}`,
    objective: `Backing task for canvas artifact "${body.title}".`,
    workspaceId: body.workspaceId,
    status: TaskStatus.COMPLETED,
    labels: ["canvas"],
    codebaseIds: body.codebaseId ? [body.codebaseId] : [],
  });

  await system.taskStore.save(task);
  return task.id;
}

export async function createCanvasArtifact(
  system: RoutaSystem,
  body: CreateCanvasBody,
): Promise<CreatedCanvasArtifact> {
  const renderMode: CanvasRenderMode = body.renderMode ?? "dynamic";
  const taskId = await resolveCanvasTaskId(system, body);
  if (taskId instanceof NextResponse) {
    const payload = await taskId.json();
    throw new Error(typeof payload?.error === "string" ? payload.error : "Failed to resolve canvas task");
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
    taskId,
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

  await system.artifactStore.saveArtifact(artifact);

  return {
    id: artifact.id,
    renderMode,
    canvasType: payload.metadata.canvasType,
    title: body.title,
    taskId,
    createdAt: artifact.createdAt.toISOString(),
  };
}

/**
 * POST /api/canvas — Create a new canvas artifact.
 *
 * Supports two modes:
 *  - `dynamic`: agent provides TSX `source`; compiled client-side.
 *  - `prebuilt`: agent provides `canvasType` + `data`; rendered via template.
 */
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

  const body = rawBody as unknown as CreateCanvasBody;
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

  if (renderMode === "dynamic") {
    if (!body.source || typeof body.source !== "string") {
      return NextResponse.json(
        { error: "source (TSX string) is required for dynamic renderMode" },
        { status: 400 },
      );
    }
  } else {
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

  const system = getRoutaSystem();
  try {
    const created = await createCanvasArtifact(system, body);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Failed to create canvas artifact";
    const status = message.startsWith("Workspace not found:") || message.startsWith("Task not found:")
      || message.includes("does not belong to workspace")
      ? 400
      : 500;

    return NextResponse.json({ error: message }, { status });
  }
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
  try {
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
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "Failed to list canvas artifacts",
      },
      { status: 500 },
    );
  }
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
