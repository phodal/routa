/**
 * A2A RPC API - /api/a2a/rpc
 *
 * JSON-RPC endpoint for A2A protocol communication.
 * Forwards requests to backend ACP sessions based on sessionId parameter.
 *
 * Supports:
 * - POST: JSON-RPC method calls
 * - GET: Server-Sent Events stream for notifications
 */

import { NextRequest, NextResponse } from "next/server";
import { getHttpSessionStore } from "@/core/acp/http-session-store";
import { getRoutaSystem } from "@/core/routa-system";

export const dynamic = "force-dynamic";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * POST /api/a2a/rpc - Handle JSON-RPC method calls
 */
export async function POST(request: NextRequest) {
  const sessionStore = getHttpSessionStore();
  const system = getRoutaSystem();
  
  try {
    const body = (await request.json()) as JsonRpcRequest;
    const sessionId = request.nextUrl.searchParams.get("sessionId");

    // Validate that body is an object
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message: "Invalid Request",
          },
        } as JsonRpcResponse,
        {
          status: 400,
          headers: {
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // Validate JSON-RPC format
    if (body.jsonrpc !== "2.0" || !body.method) {
      return NextResponse.json(
        {
          jsonrpc: "2.0",
          id: body.id,
          error: {
            code: -32600,
            message: "Invalid Request",
          },
        } as JsonRpcResponse,
        {
          status: 400,
          headers: {
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // Handle method routing
    const result = await handleA2aMethod(body.method, body.params, sessionId, sessionStore, system);

    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: body.id,
        result,
      } as JsonRpcResponse,
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("A2A RPC error:", error);
    
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal error",
          data: error instanceof Error ? error.message : String(error),
        },
      } as JsonRpcResponse,
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}

/**
 * GET /api/a2a/rpc - Server-Sent Events stream for session notifications
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  
  if (!sessionId) {
    return new NextResponse("Missing sessionId parameter", { status: 400 });
  }

  const sessionStore = getHttpSessionStore();
  const session = sessionStore.getSession(sessionId);

  if (!session) {
    return new NextResponse(`Session ${sessionId} not found`, { status: 404 });
  }

  // Create SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Attach SSE controller to session
      sessionStore.attachSse(sessionId, controller);

      // Send initial connected event
      const connectEvent = `data: ${JSON.stringify({
        jsonrpc: "2.0",
        method: "notification",
        params: {
          type: "connected",
          sessionId,
          message: "A2A event stream connected",
        },
      })}\n\n`;
      controller.enqueue(encoder.encode(connectEvent));

      // Keep-alive ping every 30 seconds
      const keepAliveInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          clearInterval(keepAliveInterval);
        }
      }, 30000);

      // Cleanup on close
      request.signal.addEventListener("abort", () => {
        clearInterval(keepAliveInterval);
        try {
          controller.close();
        } catch {
          // Ignore errors if the controller is already closed
        }
        sessionStore.detachSse(sessionId);
      });
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * Handle A2A method calls and route to appropriate backend
 */
async function handleA2aMethod(
  method: string,
  params: unknown,
  sessionId: string | null,
  sessionStore: ReturnType<typeof getHttpSessionStore>,
  system: ReturnType<typeof getRoutaSystem>
): Promise<unknown> {
  // Handle meta methods (no session required)
  if (method === "method_list") {
    return {
      methods: [
        "method_list",
        "initialize",
        "session/new",
        "session/prompt",
        "session/cancel",
        "session/load",
        "list_agents",
        "create_agent",
        "delegate_task",
        "message_agent",
      ],
    };
  }

  if (method === "initialize") {
    return {
      protocolVersion: "0.3.0",
      agentInfo: {
        name: "routa-a2a-bridge",
        version: "0.1.0",
      },
      capabilities: {
        sessions: true,
        coordination: true,
      },
    };
  }

  // Route to appropriate handler based on method prefix
  if (method.startsWith("session/")) {
    // Session methods require sessionId
    if (!sessionId) {
      throw new Error("Session ID required for session methods");
    }
    return handleSessionMethod(method, params, sessionId, sessionStore);
  }

  // Coordination methods - use explicit list instead of prefix matching
  const coordinationMethods = [
    "list_agents",
    "create_agent",
    "delegate_task",
    "message_agent",
  ];

  if (coordinationMethods.includes(method)) {
    return handleCoordinationMethod(method, params, system);
  }

  throw new Error(`Unknown method: ${method}`);
}

/**
 * Handle ACP session methods (forwarded to backend)
 */
async function handleSessionMethod(
  method: string,
  params: unknown,
  sessionId: string,
  sessionStore: ReturnType<typeof getHttpSessionStore>
): Promise<unknown> {
  // For now, we acknowledge the request and queue it for backend processing
  // In a full implementation, this would forward to the actual ACP process
  
  sessionStore.pushNotification({
    sessionId,
    update: {
      sessionUpdate: "a2a_request",
      method,
      params,
    },
  });

  return {
    status: "forwarded",
    sessionId,
    method,
    message: "Request forwarded to backend session",
  };
}

/**
 * Handle Routa coordination methods
 */
async function handleCoordinationMethod(
  method: string,
  params: unknown,
  system: ReturnType<typeof getRoutaSystem>
): Promise<unknown> {
  const tools = system.tools;

  // Validate params is an object
  if (typeof params !== "object" || params === null) {
    throw new Error("Invalid params: must be an object");
  }

  switch (method) {
    case "list_agents": {
      const p = params as { workspaceId?: string };
      return await tools.listAgents(p.workspaceId || "default");
    }

    case "create_agent": {
      const p = params as Record<string, unknown>;
      
      // Validate required fields
      if (typeof p.name !== "string" || !p.name) {
        throw new Error("Invalid params: 'name' is required and must be a non-empty string");
      }
      if (typeof p.role !== "string" || !p.role) {
        throw new Error("Invalid params: 'role' is required and must be a non-empty string");
      }
      
      return await tools.createAgent({
        name: p.name,
        role: p.role,
        workspaceId: typeof p.workspaceId === "string" ? p.workspaceId : "default",
      });
    }

    case "delegate_task": {
      const p = params as Record<string, unknown>;
      
      // Validate required fields
      if (typeof p.agentId !== "string" || !p.agentId) {
        throw new Error("Invalid params: 'agentId' is required and must be a non-empty string");
      }
      if (typeof p.taskId !== "string" || !p.taskId) {
        throw new Error("Invalid params: 'taskId' is required and must be a non-empty string");
      }
      if (typeof p.callerAgentId !== "string" || !p.callerAgentId) {
        throw new Error("Invalid params: 'callerAgentId' is required and must be a non-empty string");
      }
      
      return await tools.delegate({
        agentId: p.agentId,
        taskId: p.taskId,
        callerAgentId: p.callerAgentId,
      });
    }

    case "message_agent": {
      const p = params as Record<string, unknown>;
      
      // Validate required fields
      if (typeof p.fromAgentId !== "string" || !p.fromAgentId) {
        throw new Error("Invalid params: 'fromAgentId' is required and must be a non-empty string");
      }
      if (typeof p.toAgentId !== "string" || !p.toAgentId) {
        throw new Error("Invalid params: 'toAgentId' is required and must be a non-empty string");
      }
      if (typeof p.message !== "string" || !p.message) {
        throw new Error("Invalid params: 'message' is required and must be a non-empty string");
      }
      
      return await tools.messageAgent({
        fromAgentId: p.fromAgentId,
        toAgentId: p.toAgentId,
        message: p.message,
      });
    }

    default:
      throw new Error(`Coordination method not implemented: ${method}`);
  }
}

/**
 * OPTIONS - CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
