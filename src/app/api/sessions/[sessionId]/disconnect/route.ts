import { NextRequest, NextResponse } from "next/server";
import { getHttpSessionStore } from "@/core/acp/http-session-store";
import { getAcpProcessManager } from "@/core/acp/processer";
import { saveHistoryToDb } from "@/core/acp/session-db-persister";
import {
  getRequiredRunnerUrl,
  isForwardedAcpRequest,
  proxyRequestToRunner,
  runnerUnavailableResponse,
} from "@/core/acp/runner-routing";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const store = getHttpSessionStore();
  await store.hydrateFromDb();
  const session = store.getSession(sessionId);

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (!isForwardedAcpRequest(request) && session.executionMode === "runner") {
    const runnerUrl = getRequiredRunnerUrl();
    if (!runnerUrl) return runnerUnavailableResponse();
    return proxyRequestToRunner(request, {
      runnerUrl,
      path: `/api/sessions/${encodeURIComponent(sessionId)}/disconnect`,
      method: "POST",
    });
  }

  try {
    await saveHistoryToDb(sessionId, store.getConsolidatedHistory(sessionId));
  } catch (error) {
    console.error(`[SessionDisconnect] Failed to persist history for ${sessionId}:`, error);
  }

  await getAcpProcessManager().killSession(sessionId);

  return NextResponse.json({ ok: true });
}
