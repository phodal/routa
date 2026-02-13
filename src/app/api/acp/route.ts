/**
 * ACP Server API Route - /api/acp (OpenCode compatible)
 *
 * Implements standard ACP JSON-RPC methods and streams `session/update` notifications via SSE.
 *
 * - POST: JSON-RPC request/response (initialize, session/new, session/prompt, session/load, etc.)
 * - GET : SSE stream for `session/update`
 */

import { NextRequest, NextResponse } from "next/server";
import type {
  Agent,
  AgentSideConnection,
  InitializeRequest,
  LoadSessionRequest,
  NewSessionRequest,
  PromptRequest,
} from "@agentclientprotocol/sdk";
import { getRoutaSystem } from "@/core/routa-system";
import { SkillRegistry } from "@/core/skills/skill-registry";
import { createRoutaAcpAgent } from "@/core/acp";
import { getHttpSessionStore } from "@/core/acp/http-session-store";

export const dynamic = "force-dynamic";

let agentHandler:
  | ((connection: AgentSideConnection) => Agent)
  | undefined;

function getAgentHandler() {
  if (!agentHandler) {
    const system = getRoutaSystem();
    const skillRegistry = new SkillRegistry({ projectDir: process.cwd() });
    agentHandler = createRoutaAcpAgent(system, skillRegistry);
  }
  return agentHandler;
}

function getConnection(): AgentSideConnection {
  const store = getHttpSessionStore();
  return {
    sessionUpdate(notification) {
      store.pushNotification(notification);
    },
  } as AgentSideConnection;
}

// ─── GET: SSE stream for session/update ────────────────────────────────

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing sessionId query param" },
      { status: 400 }
    );
  }

  const store = getHttpSessionStore();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      store.attachSse(sessionId, controller);
      store.pushConnected(sessionId);

      request.signal.addEventListener("abort", () => {
        store.detachSse(sessionId);
        try {
          controller.close();
        } catch {
          // ignore
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
    },
  });
}

// ─── POST: JSON-RPC request handler ────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { method, params, id } = body as {
      jsonrpc: "2.0";
      id?: string | number | null;
      method: string;
      params?: Record<string, unknown>;
    };

    const handler = getAgentHandler();
    const agent = handler(getConnection());

    // ACP core methods
    if (method === "initialize") {
      const req = (params ?? {}) as unknown as InitializeRequest;
      const result = await agent.initialize(req);
      return jsonrpcResponse(id ?? null, result);
    }

    if (method === "session/new") {
      const p = (params ?? {}) as Record<string, unknown>;
      const req = {
        cwd: (p.cwd as string | undefined) ?? process.cwd(),
        mcpServers: (p.mcpServers as unknown[]) ?? [],
        _meta: (p._meta as object | null | undefined) ?? null,
      } as unknown as NewSessionRequest;
      const result = await agent.newSession(req);
      return jsonrpcResponse(id ?? null, result);
    }

    if (method === "session/prompt") {
      const req = (params ?? {}) as unknown as PromptRequest;
      const result = await agent.prompt(req);
      return jsonrpcResponse(id ?? null, result);
    }

    if (method === "session/load") {
      const p = (params ?? {}) as Record<string, unknown>;
      const req = {
        sessionId: p.sessionId as string,
        cwd: (p.cwd as string | undefined) ?? process.cwd(),
        mcpServers: (p.mcpServers as unknown[]) ?? [],
        _meta: (p._meta as object | null | undefined) ?? null,
      } as unknown as LoadSessionRequest;
      if (!agent.loadSession) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32601,
          message: "Method not supported: session/load",
        });
      }
      const result = await agent.loadSession(req);
      return jsonrpcResponse(id ?? null, result);
    }

    if (method === "session/cancel") {
      // notification per spec, but allow response if id provided
      if (agent.cancel) {
        await agent.cancel((params ?? {}) as never);
      }
      return jsonrpcResponse(id ?? null, {});
    }

    if (method === "session/set_mode") {
      // Not implemented in Routa agent yet; return empty success
      return jsonrpcResponse(id ?? null, {});
    }

    // Extension methods must start with "_"
    if (method.startsWith("_")) {
      if (!agent.extMethod) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32601,
          message: `Method not supported: ${method}`,
        });
      }
      const result = await agent.extMethod(
        method,
        (params ?? {}) as Record<string, unknown>
      );
      return jsonrpcResponse(id ?? null, result);
    }

    return jsonrpcResponse(id ?? null, null, {
      code: -32601,
      message: `Method not found: ${method}`,
    });
  } catch (error) {
    return jsonrpcResponse(null, null, {
      code: -32603,
      message: error instanceof Error ? error.message : "Internal error",
    });
  }
}

function jsonrpcResponse(
  id: string | number | null,
  result: unknown,
  error?: { code: number; message: string }
) {
  if (error) {
    return NextResponse.json({ jsonrpc: "2.0", id, error });
  }
  return NextResponse.json({ jsonrpc: "2.0", id, result });
}
