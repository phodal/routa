/**
 * POST /api/traces/export — Export traces in Agent Trace JSON format.
 *
 * Static route takes priority over [id] dynamic route,
 * preventing "export" from being matched as a trace ID.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTraceReader, queryTracesWithSessionFallback, type TraceQuery } from "@/core/trace";

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

export async function POST(request: NextRequest) {
  try {
    const params = parseQueryParams(request.url);

    // Allow body to override query params
    try {
      const body = await request.json();
      if (body.sessionId) params.sessionId = body.sessionId;
      if (body.workspaceId) params.workspaceId = body.workspaceId;
      if (body.file) params.file = body.file;
      if (body.eventType) params.eventType = body.eventType;
      if (body.startDate) params.startDate = body.startDate;
      if (body.endDate) params.endDate = body.endDate;
      if (body.limit) params.limit = String(body.limit);
      if (body.offset) params.offset = String(body.offset);
    } catch {
      // No body or invalid JSON, use query params
    }

    const query = toTraceQuery(params);
    const traces = query.sessionId
      ? await queryTracesWithSessionFallback(query)
      : await getTraceReader(process.cwd()).export(query);

    return NextResponse.json({
      export: traces,
      format: "agent-trace-json",
      version: "0.1.0",
    });
  } catch (error) {
    console.error("[Traces API] Export error:", error);
    return NextResponse.json(
      {
        error: "Failed to export traces",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
