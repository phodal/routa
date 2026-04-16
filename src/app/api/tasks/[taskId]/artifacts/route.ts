import { NextRequest, NextResponse } from "next/server";
import type { Artifact, ArtifactType } from "@/core/models/artifact";
import { getRoutaSystem } from "@/core/routa-system";
import type { ToolResult } from "@/core/tools/tool-result";

export const dynamic = "force-dynamic";

interface CreateArtifactBody {
  agentId?: string;
  type?: ArtifactType;
  content?: string;
  context?: string;
  requestId?: string;
  metadata?: Record<string, string>;
}

function serializeArtifact(artifact: Artifact) {
  return {
    ...artifact,
    createdAt: artifact.createdAt instanceof Date ? artifact.createdAt.toISOString() : artifact.createdAt,
    updatedAt: artifact.updatedAt instanceof Date ? artifact.updatedAt.toISOString() : artifact.updatedAt,
    expiresAt: artifact.expiresAt instanceof Date ? artifact.expiresAt.toISOString() : artifact.expiresAt,
  };
}

function isArtifactType(value: unknown): value is ArtifactType {
  return value === "screenshot" || value === "test_results" || value === "code_diff" || value === "logs";
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === "object"
    && value !== null
    && Object.values(value).every((entry) => typeof entry === "string");
}

function isSuccessfulToolResult(value: ToolResult): value is ToolResult & { success: true; data: Record<string, unknown> } {
  return value.success && typeof value.data === "object" && value.data !== null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const system = getRoutaSystem();
  const task = await system.taskStore.get(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const artifacts = await system.artifactStore.listByTask(taskId);
  const orderedArtifacts = artifacts
    .slice()
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

  return NextResponse.json({
    artifacts: orderedArtifacts.map((artifact) => serializeArtifact(artifact)),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const system = getRoutaSystem();
  const task = await system.taskStore.get(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  let body: CreateArtifactBody;
  try {
    body = await request.json() as CreateArtifactBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isArtifactType(body.type)) {
    return NextResponse.json({ error: "A valid artifact type is required" }, { status: 400 });
  }
  if (typeof body.agentId !== "string" || body.agentId.trim().length === 0) {
    return NextResponse.json({ error: "agentId is required for agent artifact submission" }, { status: 400 });
  }
  if (typeof body.content !== "string" || body.content.trim().length === 0) {
    return NextResponse.json({ error: "Artifact content is required" }, { status: 400 });
  }
  if (body.metadata !== undefined && !isStringRecord(body.metadata)) {
    return NextResponse.json({ error: "metadata must be a string-to-string object" }, { status: 400 });
  }

  const result = await system.tools.provideArtifact({
    agentId: body.agentId.trim(),
    type: body.type,
    taskId,
    workspaceId: task.workspaceId,
    content: body.content,
    context: typeof body.context === "string" ? body.context.trim() || undefined : undefined,
    requestId: typeof body.requestId === "string" ? body.requestId.trim() || undefined : undefined,
    metadata: body.metadata,
  });
  if (!isSuccessfulToolResult(result)) {
    return NextResponse.json({ error: result.error ?? "Failed to provide artifact" }, { status: 400 });
  }

  const artifactId = typeof result.data.artifactId === "string" ? result.data.artifactId : undefined;
  if (!artifactId) {
    return NextResponse.json({ error: "Artifact created without an ID" }, { status: 500 });
  }

  const artifact = await system.artifactStore.getArtifact(artifactId);
  if (!artifact) {
    return NextResponse.json({ error: "Artifact was created but could not be loaded" }, { status: 500 });
  }

  return NextResponse.json({
    artifact: serializeArtifact(artifact),
  }, { status: 201 });
}
