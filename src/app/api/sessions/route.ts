/**
 * Sessions REST API Route - /api/sessions
 *
 * Lists ACP sessions created via /api/acp for the browser UI.
 * This is NOT part of ACP; it's only for the web dashboard.
 */

import { NextResponse } from "next/server";
import { getHttpSessionStore } from "@/core/acp/http-session-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = getHttpSessionStore();
  return NextResponse.json(
    { sessions: store.listSessions() },
    { headers: { "Cache-Control": "no-store" } }
  );
}

