/**
 * GET /api/traces — Query traces with optional filters.
 *
 * Query parameters:
 * - sessionId: Filter by session ID
 * - workspaceId: Filter by workspace ID
 * - file: Filter by file path
 * - eventType: Filter by event type
 * - startDate: Start date (YYYY-MM-DD)
 * - endDate: End date (YYYY-MM-DD)
 * - limit: Max number of results
 * - offset: Skip N results
 */

import { NextRequest, NextResponse } from "next/server";
import { queryTracesWithSessionFallback, type TraceQuery } from "@/core/trace";

export const dynamic = "force-dynamic";

interface TraceQueryParams {
  sessionId?: string;
  workspaceId?: string;
  file?: string;
  eventType?: string;
  startDate?: string;
  endDate?: string;
  limit?: string;
  offset?: string;
}

function parseQueryParams(requestUrl: string): TraceQueryParams {
  const url = new URL(requestUrl);
  return {
    sessionId: url.searchParams.get("sessionId") ?? undefined,
    workspaceId: url.searchParams.get("workspaceId") ?? undefined,
    file: url.searchParams.get("file") ?? undefined,
    eventType: url.searchParams.get("eventType") ?? undefined,
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  };
}

function toTraceQuery(params: TraceQueryParams): TraceQuery {
  return {
    sessionId: params.sessionId,
    workspaceId: params.workspaceId,
    file: params.file,
    eventType: params.eventType as any,
    startDate: params.startDate,
    endDate: params.endDate,
    limit: params.limit ? parseInt(params.limit, 10) : undefined,
    offset: params.offset ? parseInt(params.offset, 10) : undefined,
  };
}

/**
 * GET /api/traces — Query traces with optional filters.
 */
export async function GET(request: NextRequest) {
  try {
    const params = parseQueryParams(request.url);
    const query = toTraceQuery(params);

    const traces = await queryTracesWithSessionFallback(query);

    return NextResponse.json({
      traces,
      count: traces.length,
    });
  } catch (error) {
    console.error("[Traces API] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to query traces",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
