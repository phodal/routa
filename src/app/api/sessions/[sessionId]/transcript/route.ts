import { NextResponse } from "next/server";
import { queryTracesWithSessionFallback } from "@/core/trace";
import { loadSessionHistory } from "@/core/session-history";
import {
  buildPreferredTranscriptPayload,
  historyNotificationsToMessages,
  shouldFetchTranscriptTraces,
} from "@/core/session-transcript";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const history = await loadSessionHistory(sessionId, { consolidated: true });
  const historyMessages = historyNotificationsToMessages(history, sessionId);
  const traces = shouldFetchTranscriptTraces(historyMessages)
    ? await queryTracesWithSessionFallback({ sessionId })
    : [];

  return NextResponse.json(
    buildPreferredTranscriptPayload({ sessionId, history, traces }),
    { headers: { "Cache-Control": "no-store" } },
  );
}
