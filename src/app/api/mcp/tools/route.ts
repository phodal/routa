import { NextRequest, NextResponse } from "next/server";
import { createRoutaMcpServer } from "@/core/mcp/routa-mcp-server";
import { executeMcpTool, getMcpToolDefinitions } from "@/core/mcp/mcp-tool-executor";
import { ToolMode } from "@/core/mcp/routa-mcp-tool-manager";
import { KanbanTools } from "@/core/tools/kanban-tools";
import { setGlobalToolMode, getGlobalToolMode } from "@/core/mcp/tool-mode-config";
import { resolveMcpServerProfile } from "@/core/mcp/mcp-server-profiles";

/**
 * GET /api/mcp/tools - List all MCP tool definitions
 *
 * Query params:
 * - mode: "essential" | "full" | undefined
 *   - If not specified, returns tools based on the global tool mode
 *   - If specified, returns tools for that specific mode
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const modeParam = searchParams.get("mode") as ToolMode | null;
  const mcpProfile = resolveMcpServerProfile(searchParams.get("mcpProfile") ?? undefined);

  // Use global mode if not explicitly specified
  const toolMode: ToolMode = modeParam === "full"
    ? "full"
    : modeParam === "essential"
      ? "essential"
      : getGlobalToolMode();

  return NextResponse.json({
    tools: getMcpToolDefinitions(toolMode, mcpProfile),
    mode: toolMode,
    globalMode: getGlobalToolMode(),
    mcpProfile,
  });
}

/**
 * PATCH /api/mcp/tools - Set the global tool mode
 *
 * Body: { mode: "essential" | "full" }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const mode = body?.mode as ToolMode;

    if (mode !== "essential" && mode !== "full") {
      return NextResponse.json(
        { error: "Invalid mode. Must be 'essential' or 'full'" },
        { status: 400 }
      );
    }

    setGlobalToolMode(mode);

    return NextResponse.json({
      success: true,
      mode: getGlobalToolMode(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/mcp/tools - Execute a specific tool by name
 *
 * Body: { name: string, args: object, mode?: "essential" | "full" }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = typeof body?.name === "string" ? body.name : "";
    const args =
      body?.args && typeof body.args === "object"
        ? (body.args as Record<string, unknown>)
        : {};
    const toolMode: ToolMode = body?.mode === "full" ? "full" : "essential";
    const mcpProfile = resolveMcpServerProfile(
      typeof body?.mcpProfile === "string"
        ? body.mcpProfile
        : new URL(request.url).searchParams.get("mcpProfile") ?? undefined,
    );

    if (!name) {
      return NextResponse.json({ error: "Tool name is required" }, { status: 400 });
    }

    // Always validate against full tool list (execution should work regardless of mode)
    const toolExists = getMcpToolDefinitions("full", mcpProfile).some((tool) => tool.name === name);
    if (!toolExists) {
      return NextResponse.json({ error: `Unknown tool: ${name}` }, { status: 400 });
    }

    const workspaceId = (args.workspaceId as string) ?? (body.workspaceId as string);
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required in args or body" }, { status: 400 });
    }

    const { system } = createRoutaMcpServer({ workspaceId, toolMode, mcpProfile });
    const kanbanTools = new KanbanTools(system.kanbanBoardStore, system.taskStore);
    kanbanTools.setEventBus(system.eventBus);
    kanbanTools.setAutomationSystem(system);
    const result = await executeMcpTool(system.tools, name, args, system.noteTools, system.workspaceTools, kanbanTools, mcpProfile);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
