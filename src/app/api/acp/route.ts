/**
 * ACP Server API Route - /api/acp
 *
 * Exposes the Routa ACP agent via JSON-RPC over HTTP.
 * Clients (browser, OpenCode, etc.) connect here via ACP protocol.
 *
 * POST /api/acp - Send ACP JSON-RPC messages
 * GET  /api/acp - SSE stream for ACP session updates
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getRoutaSystem } from "@/core/routa-system";
import { SkillRegistry } from "@/core/skills/skill-registry";
import { AgentRole } from "@/core/models/agent";

// ─── Session state ─────────────────────────────────────────────────────

interface AcpServerSession {
  id: string;
  cwd: string;
  routaAgentId?: string;
  workspaceId: string;
  createdAt: Date;
}

const sessions = new Map<string, AcpServerSession>();
const sseClients = new Map<string, ReadableStreamDefaultController<Uint8Array>>();

// Skill registry singleton
let skillRegistry: SkillRegistry | undefined;

function getSkillRegistry(): SkillRegistry {
  if (!skillRegistry) {
    skillRegistry = new SkillRegistry({
      projectDir: process.cwd(),
    });
  }
  return skillRegistry;
}

// ─── GET: SSE stream for session updates ───────────────────────────────

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const clientId = sessionId ?? uuidv4();
      sseClients.set(clientId, controller);

      // Send connection established
      const event = `data: ${JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: clientId,
          sessionUpdate: "connected",
        },
      })}\n\n`;
      controller.enqueue(encoder.encode(event));

      request.signal.addEventListener("abort", () => {
        sseClients.delete(clientId);
        try {
          controller.close();
        } catch {
          // already closed
        }
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

// ─── POST: ACP JSON-RPC handler ────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { method, params, id } = body;

    switch (method) {
      case "initialize":
        return jsonrpcResponse(id, {
          protocolVersion: params?.protocolVersion ?? "0.1.0",
          agentCapabilities: {
            streaming: true,
            skills: true,
          },
        });

      case "session/new":
        return handleNewSession(id, params);

      case "session/prompt":
        return handlePrompt(id, params);

      case "session/cancel":
        return jsonrpcResponse(id, { cancelled: true });

      case "session/load":
        return handleLoadSession(id, params);

      case "session/set_mode":
        return jsonrpcResponse(id, { mode: params?.mode ?? "default" });

      // ─── Extension methods ─────────────────────────────────────

      case "skills/list":
        return handleSkillsList(id);

      case "skills/load":
        return handleSkillLoad(id, params);

      case "agents/list":
        return handleAgentsList(id, params);

      case "tools/call":
        return handleToolCall(id, params);

      default:
        return jsonrpcResponse(id, null, {
          code: -32601,
          message: `Method not found: ${method}`,
        });
    }
  } catch (error) {
    return jsonrpcResponse(null, null, {
      code: -32603,
      message: error instanceof Error ? error.message : "Internal error",
    });
  }
}

// ─── Handler implementations ───────────────────────────────────────────

async function handleNewSession(
  id: string | number,
  params: { cwd?: string; mcpServers?: unknown[] }
) {
  const system = getRoutaSystem();
  const sessionId = uuidv4();
  const workspaceId = params?.cwd ?? "default";

  // Create a coordinator agent for this session
  const createResult = await system.tools.createAgent({
    name: `routa-session-${sessionId.slice(0, 8)}`,
    role: AgentRole.ROUTA,
    workspaceId,
  });

  const routaAgentId =
    createResult.success && createResult.data
      ? (createResult.data as { agentId: string }).agentId
      : undefined;

  const session: AcpServerSession = {
    id: sessionId,
    cwd: params?.cwd ?? process.cwd(),
    routaAgentId,
    workspaceId,
    createdAt: new Date(),
  };
  sessions.set(sessionId, session);

  // Send available skills as commands
  const registry = getSkillRegistry();
  const skills = registry.listSkillSummaries();

  // Notify SSE clients
  sendSessionUpdate(sessionId, {
    sessionUpdate: "available_commands_update",
    availableCommands: skills.map((s) => ({
      name: s.name,
      description: s.description,
    })),
  });

  return jsonrpcResponse(id, { sessionId });
}

async function handlePrompt(
  id: string | number,
  params: {
    sessionId: string;
    prompt?: Array<{ type: string; text?: string }>;
  }
) {
  const session = sessions.get(params.sessionId);
  if (!session) {
    return jsonrpcResponse(id, null, {
      code: -32602,
      message: `Session not found: ${params.sessionId}`,
    });
  }

  const system = getRoutaSystem();
  const promptText =
    params.prompt
      ?.filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n") ?? "";

  // Check for skill invocation
  if (promptText.startsWith("/")) {
    const registry = getSkillRegistry();
    const skillName = promptText.slice(1).split(" ")[0];
    const skill = registry.getSkill(skillName);
    if (skill) {
      sendSessionUpdate(params.sessionId, {
        sessionUpdate: "agent_message_chunk",
        messageChunk: `[Skill: ${skill.name}]\n\n${skill.content}`,
      });
      return jsonrpcResponse(id, { stopReason: "end_turn" });
    }
  }

  // Route through Routa coordination
  if (session.routaAgentId) {
    // Stream thinking
    sendSessionUpdate(params.sessionId, {
      sessionUpdate: "agent_thought_chunk",
      thoughtChunk: "Analyzing request and coordinating agents...",
    });

    // Execute list_agents
    const agentListResult = await system.tools.listAgents(session.workspaceId);

    // Notify tool call
    const toolCallId = uuidv4();
    sendSessionUpdate(params.sessionId, {
      sessionUpdate: "tool_call",
      toolCall: {
        id: toolCallId,
        name: "list_agents",
        arguments: { workspaceId: session.workspaceId },
        status: "running",
      },
    });

    sendSessionUpdate(params.sessionId, {
      sessionUpdate: "tool_call_update",
      toolCall: {
        id: toolCallId,
        name: "list_agents",
        status: "completed",
        result: JSON.stringify(agentListResult.data),
      },
    });

    // Stream response
    const response =
      `Routa Coordinator active.\n\n` +
      `Workspace: ${session.workspaceId}\n` +
      `Agents: ${JSON.stringify(agentListResult.data, null, 2)}\n\n` +
      `Prompt: ${promptText}`;

    sendSessionUpdate(params.sessionId, {
      sessionUpdate: "agent_message_chunk",
      messageChunk: response,
    });
  }

  return jsonrpcResponse(id, { stopReason: "end_turn" });
}

async function handleLoadSession(
  id: string | number,
  params: { sessionId: string }
) {
  const session = sessions.get(params.sessionId);
  if (!session) {
    return jsonrpcResponse(id, null, {
      code: -32602,
      message: `Session not found: ${params.sessionId}`,
    });
  }
  return jsonrpcResponse(id, { sessionId: session.id });
}

async function handleSkillsList(id: string | number) {
  const registry = getSkillRegistry();
  return jsonrpcResponse(id, {
    skills: registry.listSkills().map((s) => ({
      name: s.name,
      description: s.description,
      license: s.license,
      compatibility: s.compatibility,
      metadata: s.metadata,
    })),
  });
}

async function handleSkillLoad(
  id: string | number,
  params: { name: string }
) {
  const registry = getSkillRegistry();
  const skill = registry.getSkill(params.name);
  if (!skill) {
    return jsonrpcResponse(id, null, {
      code: -32602,
      message: `Skill not found: ${params.name}`,
    });
  }
  return jsonrpcResponse(id, {
    name: skill.name,
    description: skill.description,
    content: skill.content,
    license: skill.license,
    metadata: skill.metadata,
  });
}

async function handleAgentsList(
  id: string | number,
  params: { workspaceId?: string }
) {
  const system = getRoutaSystem();
  const result = await system.tools.listAgents(
    params?.workspaceId ?? "default"
  );
  return jsonrpcResponse(id, result.data);
}

async function handleToolCall(
  id: string | number,
  params: { name: string; arguments: Record<string, unknown> }
) {
  const system = getRoutaSystem();
  const tools = system.tools;

  // Dispatch to the appropriate tool
  const toolName = params.name;
  const args = params.arguments ?? {};

  try {
    let result;
    switch (toolName) {
      case "list_agents":
        result = await tools.listAgents((args.workspaceId as string) ?? "default");
        break;
      case "create_agent":
        result = await tools.createAgent(args as never);
        break;
      case "get_agent_status":
        result = await tools.getAgentStatus(args.agentId as string);
        break;
      case "get_agent_summary":
        result = await tools.getAgentSummary(args.agentId as string);
        break;
      case "delegate_task":
        result = await tools.delegate(args as never);
        break;
      case "send_message_to_agent":
        result = await tools.messageAgent(args as never);
        break;
      default:
        return jsonrpcResponse(id, null, {
          code: -32602,
          message: `Unknown tool: ${toolName}`,
        });
    }
    return jsonrpcResponse(id, result);
  } catch (err) {
    return jsonrpcResponse(id, null, {
      code: -32603,
      message: err instanceof Error ? err.message : "Tool execution failed",
    });
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

function sendSessionUpdate(sessionId: string, update: Record<string, unknown>) {
  const controller = sseClients.get(sessionId);
  if (controller) {
    const encoder = new TextEncoder();
    const event = `data: ${JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId, ...update },
    })}\n\n`;
    try {
      controller.enqueue(encoder.encode(event));
    } catch {
      sseClients.delete(sessionId);
    }
  }
}

function jsonrpcResponse(
  id: string | number | null,
  result: unknown,
  error?: { code: number; message: string }
) {
  if (error) {
    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      error,
    });
  }
  return NextResponse.json({
    jsonrpc: "2.0",
    id,
    result,
  });
}
