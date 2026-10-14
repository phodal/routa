/**
 * Agents REST API Route - /api/agents
 *
 * Provides a simple REST interface for agent management.
 * Complements the MCP and ACP endpoints for browser clients.
 *
 * GET    /api/agents              - List all agents
 * POST   /api/agents              - Create an agent
 * GET    /api/agents?id=x         - Get agent status
 * GET    /api/agents?id=x&summary - Get agent summary
 */

import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";

// Force dynamic - no caching for agent state
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const system = getRoutaSystem();
  const id = request.nextUrl.searchParams.get("id");
  const summary = request.nextUrl.searchParams.has("summary");
  // Blank values are treated as missing (same as the Rust runtime).
  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim() || null;

  if (!workspaceId && !id) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const headers = {
    "Cache-Control": "no-store, no-cache, must-revalidate",
  };

  if (id) {
    const result = summary
      ? await system.tools.getAgentSummary(id)
      : await system.tools.getAgentStatus(id);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 404, headers });
    }
    return NextResponse.json(result.data, { headers });
  }

  const result = await system.tools.listAgents(workspaceId!);
  return NextResponse.json({ agents: result.data }, { headers });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const system = getRoutaSystem();

  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const result = await system.tools.createAgent({
    name: body.name,
    role: body.role,
    workspaceId,
    parentId: body.parentId,
    modelTier: body.modelTier,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result.data, { status: 201 });
}
