/**
 * Deprecated compatibility route for runtime memory monitoring.
 *
 * Canonical system/process memory monitoring now lives at /api/system/memory.
 * Keep /api/memory as a temporary alias so existing clients do not break while
 * the workspace delivery memory domain claims explicit product endpoints.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  DELETE as deleteSystemMemory,
  GET as getSystemMemory,
  POST as postSystemMemory,
} from "../system/memory/route";

export const dynamic = "force-dynamic";

const DEPRECATED_ROUTE = "/api/memory";
const REPLACEMENT_ROUTE = "/api/system/memory";

function withDeprecationHeaders(response: NextResponse): NextResponse {
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", `<${REPLACEMENT_ROUTE}>; rel="successor-version"`);
  response.headers.set("Warning", `299 - "Deprecated API route; use ${REPLACEMENT_ROUTE}"`);
  response.headers.set("X-Routa-Deprecated-Route", DEPRECATED_ROUTE);
  response.headers.set("X-Routa-Replacement-Route", REPLACEMENT_ROUTE);
  return response;
}

export async function GET(request: NextRequest) {
  return withDeprecationHeaders(await getSystemMemory(request));
}

export async function POST(request: NextRequest) {
  return withDeprecationHeaders(await postSystemMemory(request));
}

export async function DELETE(request: NextRequest) {
  return withDeprecationHeaders(await deleteSystemMemory(request));
}
