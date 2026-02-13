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

const DEFAULT_WORKSPACE = "default";

export async function GET(request: NextRequest) {
  const system = getRoutaSystem();
  const id = request.nextUrl.searchParams.get("id");
  const summary = request.nextUrl.searchParams.has("summary");
  const workspaceId =
    request.nextUrl.searchParams.get("workspaceId") ?? DEFAULT_WORKSPACE;

  if (id) {
    const result = summary
      ? await system.tools.getAgentSummary(id)
      : await system.tools.getAgentStatus(id);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    return NextResponse.json(result.data);
  }

  const result = await system.tools.listAgents(workspaceId);
  return NextResponse.json(result.data);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const system = getRoutaSystem();

  const result = await system.tools.createAgent({
    name: body.name,
    role: body.role,
    workspaceId: body.workspaceId ?? DEFAULT_WORKSPACE,
    parentId: body.parentId,
    modelTier: body.modelTier,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result.data, { status: 201 });
}
