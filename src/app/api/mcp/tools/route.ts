import { NextRequest, NextResponse } from "next/server";
import { createRoutaMcpServer } from "@/core/mcp/routa-mcp-server";
import { executeMcpTool, getMcpToolDefinitions } from "../route";

const DEFAULT_WORKSPACE_ID = "default";

export async function GET() {
  return NextResponse.json({ tools: getMcpToolDefinitions() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = typeof body?.name === "string" ? body.name : "";
    const args =
      body?.args && typeof body.args === "object"
        ? (body.args as Record<string, unknown>)
        : {};

    if (!name) {
      return NextResponse.json({ error: "Tool name is required" }, { status: 400 });
    }

    const toolExists = getMcpToolDefinitions().some((tool) => tool.name === name);
    if (!toolExists) {
      return NextResponse.json({ error: `Unknown tool: ${name}` }, { status: 400 });
    }

    const { system } = createRoutaMcpServer(DEFAULT_WORKSPACE_ID);
    const result = await executeMcpTool(system.tools, name, args);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
