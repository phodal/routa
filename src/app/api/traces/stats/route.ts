/**
 * GET /api/traces/stats — Get trace statistics.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTraceReader, queryTracesWithSessionFallback, type TraceRecord } from "@/core/trace";

export const dynamic = "force-dynamic";

function buildTraceStats(records: TraceRecord[]) {
  const days = new Set<string>();
  const sessions = new Set<string>();
  const eventTypes: Record<string, number> = {};

  for (const record of records) {
    sessions.add(record.sessionId);
    days.add(record.timestamp.slice(0, 10));
    eventTypes[record.eventType] = (eventTypes[record.eventType] ?? 0) + 1;
  }

  return {
    totalDays: days.size,
    totalFiles: 0,
    totalRecords: records.length,
    uniqueSessions: sessions.size,
    eventTypes,
  };
}

/**
 * GET /api/traces/stats — Get trace statistics.
 */
export async function GET(_request: NextRequest) {
  try {
    const sessionId = _request.nextUrl.searchParams.get("sessionId") ?? undefined;
    const stats = sessionId
      ? buildTraceStats(await queryTracesWithSessionFallback({ sessionId }))
      : await getTraceReader(process.cwd()).stats();

    return NextResponse.json({ stats });
  } catch (error) {
    console.error("[Traces Stats API] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to get trace statistics",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
