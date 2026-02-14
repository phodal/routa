/**
 * MCP Server API Route - /api/mcp
 *
 * Exposes the Routa MCP server via SSE (Server-Sent Events) transport.
 * External MCP clients (Claude Code, MCP Inspector, etc.) connect here.
 *
 * GET  /api/mcp - SSE stream for MCP messages
 * POST /api/mcp - Send MCP JSON-RPC messages
 */

import { NextRequest, NextResponse } from "next/server";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createRoutaMcpServer } from "@/core/mcp/routa-mcp-server";

// Keep a reference to the server and active transports
const transports = new Map<string, SSEServerTransport>();

const DEFAULT_WORKSPACE_ID = "default";

export async function GET(request: NextRequest) {
  const { server } = createRoutaMcpServer(DEFAULT_WORKSPACE_ID);

  // Create SSE response
  const encoder = new TextEncoder();
  let transport: SSEServerTransport;

  const stream = new ReadableStream({
    start(controller) {
      // Create a fake response object for the SSE transport
      const sessionId = crypto.randomUUID();

      // Use a custom writable approach since we're in Next.js
      const responseObj = {
        writeHead: (_status: number, _headers: Record<string, string>) => responseObj,
        write: (data: string) => {
          try {
            controller.enqueue(encoder.encode(data));
          } catch {
            // Stream closed
          }
          return true;
        },
        on: (_event: string, _handler: () => void) => responseObj,
        end: () => {
          try {
            controller.close();
          } catch {
            // Already closed
          }
        },
      };

      // Note: SSE transport needs actual HTTP res/req objects.
      // For Next.js App Router, we provide a simplified SSE stream.
      const eventStream = () => {
        // Send SSE endpoint info
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "endpoint", url: `/api/mcp?sessionId=${sessionId}` })}\n\n`
          )
        );
      };

      eventStream();

      // Store session for POST handler
      transports.set(sessionId, undefined as unknown as SSEServerTransport);

      // Clean up on close
      request.signal.addEventListener("abort", () => {
        transports.delete(sessionId);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { server, system } = createRoutaMcpServer(DEFAULT_WORKSPACE_ID);

    // Handle JSON-RPC directly
    // This is a simplified handler that processes MCP tool calls
    if (body.method === "tools/list") {
      return NextResponse.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: getMcpToolDefinitions(),
        },
      });
    }

    if (body.method === "tools/call") {
      const { name, arguments: args } = body.params;
      const result = await executeMcpTool(system.tools, name, args);
      return NextResponse.json({
        jsonrpc: "2.0",
        id: body.id,
        result,
      });
    }

    // Initialize
    if (body.method === "initialize") {
      return NextResponse.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: "routa-mcp",
            version: "0.1.0",
          },
        },
      });
    }

    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32601, message: `Method not found: ${body.method}` },
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : "Internal error",
        },
      },
      { status: 200 }
    );
  }
}

// ─── Tool execution helper ─────────────────────────────────────────────

import { AgentTools } from "@/core/tools/agent-tools";

export async function executeMcpTool(
  tools: AgentTools,
  name: string,
  args: Record<string, unknown>
) {
  const workspace = (args.workspaceId as string) ?? DEFAULT_WORKSPACE_ID;

  switch (name) {
    case "list_agents":
      return formatResult(await tools.listAgents(workspace));
    case "read_agent_conversation":
      return formatResult(await tools.readAgentConversation(args as never));
    case "create_agent":
      return formatResult(
        await tools.createAgent({
          name: args.name as string,
          role: args.role as string,
          workspaceId: (args.workspaceId as string) ?? workspace,
          parentId: args.parentId as string | undefined,
          modelTier: args.modelTier as string | undefined,
        })
      );
    case "delegate_task":
      return formatResult(await tools.delegate(args as never));
    case "send_message_to_agent":
      return formatResult(await tools.messageAgent(args as never));
    case "report_to_parent":
      return formatResult(
        await tools.reportToParent({
          agentId: args.agentId as string,
          report: {
            agentId: args.agentId as string,
            taskId: args.taskId as string,
            summary: args.summary as string,
            filesModified: args.filesModified as string[] | undefined,
            success: args.success as boolean,
          },
        })
      );
    case "wake_or_create_task_agent":
      return formatResult(
        await tools.wakeOrCreateTaskAgent({
          taskId: args.taskId as string,
          contextMessage: args.contextMessage as string,
          callerAgentId: args.callerAgentId as string,
          workspaceId: (args.workspaceId as string) ?? workspace,
          agentName: args.agentName as string | undefined,
          modelTier: args.modelTier as string | undefined,
        })
      );
    case "send_message_to_task_agent":
      return formatResult(await tools.sendMessageToTaskAgent(args as never));
    case "get_agent_status":
      return formatResult(await tools.getAgentStatus(args.agentId as string));
    case "get_agent_summary":
      return formatResult(await tools.getAgentSummary(args.agentId as string));
    case "subscribe_to_events":
      return formatResult(await tools.subscribeToEvents(args as never));
    case "unsubscribe_from_events":
      return formatResult(
        await tools.unsubscribeFromEvents(args.subscriptionId as string)
      );
    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
}

function formatResult(result: { success: boolean; data?: unknown; error?: string }) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          result.success ? result.data : { error: result.error },
          null,
          2
        ),
      },
    ],
    isError: !result.success,
  };
}

export function getMcpToolDefinitions() {
  return [
    {
      name: "list_agents",
      description: "List all agents in the current workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string", description: "Workspace ID" },
        },
      },
    },
    {
      name: "read_agent_conversation",
      description: "Read conversation history of another agent",
      inputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          lastN: { type: "number" },
          startTurn: { type: "number" },
          endTurn: { type: "number" },
          includeToolCalls: { type: "boolean" },
        },
        required: ["agentId"],
      },
    },
    {
      name: "create_agent",
      description: "Create a new agent (ROUTA/CRAFTER/GATE)",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: { type: "string", enum: ["ROUTA", "CRAFTER", "GATE"] },
          workspaceId: { type: "string" },
          parentId: { type: "string" },
          modelTier: { type: "string", enum: ["SMART", "FAST"] },
        },
        required: ["name", "role"],
      },
    },
    {
      name: "delegate_task",
      description: "Assign a task to an agent",
      inputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          taskId: { type: "string" },
          callerAgentId: { type: "string" },
        },
        required: ["agentId", "taskId", "callerAgentId"],
      },
    },
    {
      name: "send_message_to_agent",
      description: "Send message from one agent to another",
      inputSchema: {
        type: "object",
        properties: {
          fromAgentId: { type: "string" },
          toAgentId: { type: "string" },
          message: { type: "string" },
        },
        required: ["fromAgentId", "toAgentId", "message"],
      },
    },
    {
      name: "report_to_parent",
      description: "Submit completion report to parent agent",
      inputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          taskId: { type: "string" },
          summary: { type: "string" },
          filesModified: { type: "array", items: { type: "string" } },
          success: { type: "boolean" },
        },
        required: ["agentId", "taskId", "summary", "success"],
      },
    },
    {
      name: "wake_or_create_task_agent",
      description: "Wake existing or create new agent for a task",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          contextMessage: { type: "string" },
          callerAgentId: { type: "string" },
          workspaceId: { type: "string" },
          agentName: { type: "string" },
          modelTier: { type: "string" },
        },
        required: ["taskId", "contextMessage", "callerAgentId"],
      },
    },
    {
      name: "send_message_to_task_agent",
      description: "Send message to task's assigned agent",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          message: { type: "string" },
          callerAgentId: { type: "string" },
        },
        required: ["taskId", "message", "callerAgentId"],
      },
    },
    {
      name: "get_agent_status",
      description: "Get agent status, message count, and tasks",
      inputSchema: {
        type: "object",
        properties: { agentId: { type: "string" } },
        required: ["agentId"],
      },
    },
    {
      name: "get_agent_summary",
      description: "Get agent summary with last response and active tasks",
      inputSchema: {
        type: "object",
        properties: { agentId: { type: "string" } },
        required: ["agentId"],
      },
    },
    {
      name: "subscribe_to_events",
      description: "Subscribe to workspace events",
      inputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          agentName: { type: "string" },
          eventTypes: { type: "array", items: { type: "string" } },
          excludeSelf: { type: "boolean" },
        },
        required: ["agentId", "agentName", "eventTypes"],
      },
    },
    {
      name: "unsubscribe_from_events",
      description: "Remove an event subscription",
      inputSchema: {
        type: "object",
        properties: { subscriptionId: { type: "string" } },
        required: ["subscriptionId"],
      },
    },
  ];
}
