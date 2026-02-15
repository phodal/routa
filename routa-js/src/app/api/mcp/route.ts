/**
 * MCP Server API Route - /api/mcp
 *
 * Exposes the Routa MCP server via Streamable HTTP (2025-06-18 protocol).
 * Uses the MCP SDK's WebStandardStreamableHTTPServerTransport for proper
 * protocol handling including session management and SSE streaming.
 *
 * This endpoint is used by all ACP providers (Claude Code, Copilot, Auggie,
 * Codex, Gemini, Kimi, OpenCode) when configured with type: "http".
 *
 * Supported methods:
 *   POST   /api/mcp  — Send JSON-RPC messages (initialize, tools/list, tools/call, etc.)
 *   GET    /api/mcp  — Open SSE stream for server-initiated messages
 *   DELETE /api/mcp  — Terminate an MCP session
 *
 * Session management:
 *   - Each initialize request creates a new session with a unique ID
 *   - Subsequent requests include the session ID via Mcp-Session-Id header
 *   - Sessions are maintained in-memory (same-process)
 */

import { NextRequest } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createRoutaMcpServer } from "@/core/mcp/routa-mcp-server";

// ─── Session management ────────────────────────────────────────────────

interface McpSession {
  transport: WebStandardStreamableHTTPServerTransport;
}

const sessions = new Map<string, McpSession>();

const DEFAULT_WORKSPACE_ID = "default";

/**
 * Create a new MCP session: transport + MCP server + tool registrations.
 * Returns the transport so it can handle the current request.
 */
async function createSession(): Promise<WebStandardStreamableHTTPServerTransport> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    // Return plain JSON responses instead of SSE streams.
    // This is critical for compatibility with Claude Code and other MCP clients
    // that may not send Accept: text/event-stream header (causing 406 errors).
    enableJsonResponse: true,
    onsessioninitialized: (sessionId: string) => {
      sessions.set(sessionId, { transport });
      console.log(
        `[MCP Route] Session created: ${sessionId} (active: ${sessions.size})`,
      );
    },
  });

  const { server } = createRoutaMcpServer(DEFAULT_WORKSPACE_ID);
  await server.connect(transport);

  // Clean up when session is closed
  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) {
      sessions.delete(sid);
      console.log(
        `[MCP Route] Session closed: ${sid} (active: ${sessions.size})`,
      );
    }
  };

  return transport;
}

/**
 * Find an existing session or create a new one for the incoming request.
 */
async function getOrCreateSession(
  request: NextRequest,
): Promise<WebStandardStreamableHTTPServerTransport> {
  const sessionId = request.headers.get("mcp-session-id");
  const existing = sessionId ? sessions.get(sessionId) : undefined;

  if (existing) {
    return existing.transport;
  }

  // New session needed (initialize request)
  return createSession();
}

/**
 * Add CORS headers to the transport's response.
 */
function withCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
  );
  headers.set(
    "Access-Control-Expose-Headers",
    "Mcp-Session-Id, MCP-Protocol-Version",
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ─── Route Handlers ───────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Log incoming MCP request for debugging
    const sessionId = request.headers.get("mcp-session-id");
    const accept = request.headers.get("accept");
    const clonedReq = request.clone();
    let method = "unknown";
    try {
      const body = await clonedReq.json();
      method = body.method || "unknown";
    } catch {
      // body may not be JSON
    }
    console.log(
      `[MCP Route] POST: method=${method}, session=${sessionId ?? "new"}, accept=${accept}`,
    );

    const transport = await getOrCreateSession(request);
    const response = await transport.handleRequest(request);
    console.log(
      `[MCP Route] Response: ${response.status} ${response.headers.get("content-type")}`,
    );
    return withCorsHeaders(response);
  } catch (error) {
    console.error("[MCP Route] POST error:", error);
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : "Internal error",
        },
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.headers.get("mcp-session-id");
    const session = sessionId ? sessions.get(sessionId) : undefined;

    if (!session) {
      return Response.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message: "No active session. Send an initialize POST request first.",
          },
        },
        { status: 400 },
      );
    }

    const response = await session.transport.handleRequest(request);
    return withCorsHeaders(response);
  } catch (error) {
    console.error("[MCP Route] GET error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const sessionId = request.headers.get("mcp-session-id");
    const session = sessionId ? sessions.get(sessionId) : undefined;

    if (!session) {
      return new Response("Session not found", { status: 404 });
    }

    const response = await session.transport.handleRequest(request);
    return withCorsHeaders(response);
  } catch (error) {
    console.error("[MCP Route] DELETE error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
      "Access-Control-Expose-Headers":
        "Mcp-Session-Id, MCP-Protocol-Version",
    },
  });
}
