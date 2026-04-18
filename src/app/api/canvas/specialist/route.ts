import { NextRequest, NextResponse } from "next/server";

import { handleSessionNew, loadSpecialistConfig } from "../../acp/acp-session-create";
import { dispatchSessionPrompt } from "@/core/acp/session-prompt";
import {
  getHttpSessionStore,
  type SessionUpdateNotification,
} from "@/core/acp/http-session-store";
import { getAcpProcessManager } from "@/core/acp/processer";
import { createCanvasArtifact } from "../route";
import { getRoutaSystem } from "@/core/routa-system";
import { ensureMcpForProvider } from "@/core/acp/mcp-setup";
import { getDefaultRoutaMcpConfig } from "@/core/acp/mcp-config-generator";
import type { McpServerProfile } from "@/core/mcp/mcp-server-profiles";

import {
  buildCanvasSpecialistPrompt,
  extractCanvasSpecialistOutputFromHistory,
  extractCanvasSourceFromSpecialistOutput,
} from "@/core/canvas/specialist-source";

export const dynamic = "force-dynamic";

interface CreateCanvasFromSpecialistBody {
  specialistId: string;
  prompt: string;
  workspaceId: string;
  title?: string;
  provider?: string;
  model?: string;
  specialistLocale?: string;
  taskId?: string;
  codebaseId?: string;
  repoPath?: string;
  cwd?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireWorkspaceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function jsonrpcResponse(
  id: string | number | null,
  result: unknown,
  error?: { code: number; message: string; data?: Record<string, unknown> },
): Response {
  const body = error
    ? { jsonrpc: "2.0", id, error }
    : { jsonrpc: "2.0", id, result };
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

function createSessionUpdateForwarder(
  store: ReturnType<typeof getHttpSessionStore>,
  sessionId: string,
): (msg: { method?: string; params?: Record<string, unknown> }) => void {
  return (msg) => {
    if (msg.method !== "session/update" || !msg.params) return;
    store.pushNotification({
      ...msg.params,
      sessionId,
    } as SessionUpdateNotification);
  };
}

async function buildMcpConfigForClaude(
  workspaceId?: string,
  sessionId?: string,
  toolMode?: "essential" | "full",
  _mcpProfile?: McpServerProfile,
): Promise<string[]> {
  const config = workspaceId
    ? getDefaultRoutaMcpConfig(workspaceId, sessionId, toolMode)
    : undefined;
  const result = await ensureMcpForProvider("claude", config);
  return result.mcpConfigs;
}

function pushForwardedNotification(
  store: ReturnType<typeof getHttpSessionStore>,
  sessionId: string,
  data: unknown,
): void {
  if (!data || typeof data !== "object") return;
  const record = data as Record<string, unknown>;
  const params = record.params;
  if (!params || typeof params !== "object") return;

  store.pushNotification({
    ...(params as Record<string, unknown>),
    sessionId,
  } as SessionUpdateNotification);
}

function decodeJsonRpcResult<T>(payload: unknown): T {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid JSON-RPC response");
  }

  const record = payload as Record<string, unknown>;
  if (record.error && typeof record.error === "object") {
    const errorRecord = record.error as Record<string, unknown>;
    const message = typeof errorRecord.message === "string"
      ? errorRecord.message
      : "ACP request failed";
    throw new Error(message);
  }

  return record.result as T;
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

  const body = rawBody as unknown as CreateCanvasFromSpecialistBody;
  const specialistId = body.specialistId?.trim().toLowerCase();
  const workspaceId = body.workspaceId?.trim();
  const prompt = body.prompt?.trim();
  const specialistLocale = body.specialistLocale?.trim() || "en";

  if (!specialistId) {
    return NextResponse.json({ error: "specialistId is required" }, { status: 400 });
  }
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  const specialist = await loadSpecialistConfig(specialistId, specialistLocale);
  if (!specialist) {
    return NextResponse.json(
      { error: `Specialist not found: ${specialistId}` },
      { status: 404 },
    );
  }

  const sessionCreateResponse = await handleSessionNew({
    id: null,
    params: {
      workspaceId,
      provider: body.provider,
      model: body.model,
      specialistId,
      specialistLocale,
      cwd: body.cwd ?? body.repoPath,
      name: body.title ? `Canvas: ${body.title}` : `Canvas: ${specialist.name}`,
    },
    jsonrpcResponse,
    createSessionUpdateForwarder,
    buildMcpConfigForClaude,
    requireWorkspaceId,
    pushAndPersistForwardedNotification: pushForwardedNotification,
  });

  let sessionId: string | undefined;
  try {
    const createPayload = await sessionCreateResponse.json() as unknown;
    const result = decodeJsonRpcResult<{ sessionId: string }>(createPayload);
    sessionId = result.sessionId;

    const generatedPrompt = buildCanvasSpecialistPrompt(prompt);
    await dispatchSessionPrompt({
      sessionId,
      workspaceId,
      provider: body.provider ?? specialist.defaultProvider,
      cwd: body.cwd ?? body.repoPath,
      prompt: generatedPrompt,
    });

    const history = getHttpSessionStore().getConsolidatedHistory(sessionId);
    const rawOutput = extractCanvasSpecialistOutputFromHistory(history);
    const source = extractCanvasSourceFromSpecialistOutput(rawOutput);
    if (!source) {
      return NextResponse.json(
        {
          error: "Specialist output did not contain usable canvas TSX",
          sessionId,
          outputPreview: rawOutput.slice(0, 500),
        },
        { status: 422 },
      );
    }

    const system = getRoutaSystem();
    const title = body.title?.trim() || `${specialist.name} Canvas`;
    const created = await createCanvasArtifact(system, {
      renderMode: "dynamic",
      title,
      source,
      workspaceId,
      taskId: body.taskId,
      codebaseId: body.codebaseId,
      repoPath: body.repoPath,
    });

    return NextResponse.json({
      ...created,
      sessionId,
      viewerUrl: `/canvas/${created.id}`,
      source,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "Failed to generate canvas from specialist",
        ...(sessionId ? { sessionId } : {}),
      },
      { status: 500 },
    );
  } finally {
    if (sessionId) {
      await getAcpProcessManager().killSession(sessionId).catch(() => undefined);
    }
  }
}
