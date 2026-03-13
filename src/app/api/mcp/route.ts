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
import { getGlobalToolMode } from "@/core/mcp/tool-mode-config";
import type { ToolMode } from "@/core/mcp/routa-mcp-tool-manager";

// ─── Session management ────────────────────────────────────────────────

interface McpSession {
  transport: WebStandardStreamableHTTPServerTransport;
  workspaceId: string;
}

const sessions = new Map<string, McpSession>();

/**
 * Create a new MCP session: transport + MCP server + tool registrations.
 * Returns the transport so it can handle the current request.
 *
 * @param workspaceId - Workspace ID to use for this session (from request header or env)
 * @param enableStatelessMode - If true, uses stateless session ID ("mcp-stateless")
 *                              for clients that don't follow full MCP protocol
 */
async function createSession(
  workspaceId?: string,
  enableStatelessMode = false,
  acpSessionId?: string,
  toolMode?: ToolMode,
): Promise<WebStandardStreamableHTTPServerTransport> {
  const effectiveWorkspaceId = workspaceId || process.env.ROUTA_WORKSPACE_ID || "default";
  const sessionId = enableStatelessMode
    ? "mcp-stateless"
    : crypto.randomUUID();

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId,
    // Return plain JSON responses instead of SSE streams.
    // This is critical for compatibility with Claude Code and other MCP clients
    // that may not send Accept: text/event-stream header (causing 406 errors).
    enableJsonResponse: true,
    onsessioninitialized: (sid: string) => {
      sessions.set(sid, { transport, workspaceId: effectiveWorkspaceId });
      console.log(
        `[MCP Route] Session created: ${sid} workspaceId=${effectiveWorkspaceId} (active: ${sessions.size})`,
      );
    },
  });

  const { server } = createRoutaMcpServer({
    workspaceId: effectiveWorkspaceId,
    toolMode: toolMode ?? getGlobalToolMode(),
    sessionId: acpSessionId,
  });
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

function resolveToolMode(request: NextRequest): ToolMode | undefined {
  const toolMode = new URL(request.url).searchParams.get("toolMode");
  if (toolMode === "essential" || toolMode === "full") {
    return toolMode;
  }
  return undefined;
}

/**
 * Find an existing session or create a new one for the incoming request.
 * Reads Routa-Workspace-Id header to bind the session to a workspace.
 * Also reads ?wsId= query param for AI agent HTTP calls (where headers aren't available).
 */
async function getOrCreateSession(
  request: NextRequest,
): Promise<WebStandardStreamableHTTPServerTransport> {
  const sessionId = request.headers.get("mcp-session-id");
  const existing = sessionId ? sessions.get(sessionId) : undefined;

  if (existing) {
    return existing.transport;
  }

  // Extract workspace ID from:
  // 1. Custom header (browser client sends Routa-Workspace-Id)
  // 2. URL query param (AI agents call via URL like /api/mcp?wsId=myWorkspace)
  // 3. Environment variable (server-level default)
  const url = new URL(request.url);
  const workspaceId =
    request.headers.get("routa-workspace-id") ||
    url.searchParams.get("wsId") ||
    process.env.ROUTA_WORKSPACE_ID ||
    "default";

  // ACP session ID embedded in URL by orchestrator (?sid=) so notes are scoped correctly
  const acpSessionId = url.searchParams.get("sid") ?? undefined;
  const toolMode = resolveToolMode(request);

  // New session needed (initialize request)
  return createSession(workspaceId, false, acpSessionId, toolMode);
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
    "Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID, Routa-Workspace-Id",
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

// ─── Accept-header fix ────────────────────────────────────────────────
//
// The MCP SDK's WebStandardStreamableHTTPServerTransport *always* validates
// that the `Accept` header includes `text/event-stream` (POST also requires
// `application/json`).  The `enableJsonResponse` option only changes the
// *response* format but does NOT skip this validation.
//
// Some MCP clients (notably Claude Code) may omit `text/event-stream` from
// their Accept header, causing a 406 error that silently breaks the connection.
//
// To be maximally compatible we patch the Accept header to include the required
// content types before forwarding the request to the transport.
//

function ensureAcceptHeader(request: NextRequest, ...required: string[]): NextRequest {
  const current = request.headers.get("accept") ?? "";
  const missing = required.filter((r) => !current.includes(r));
  if (missing.length === 0) return request;

  const patched = [current, ...missing].filter(Boolean).join(", ");
  const headers = new Headers(request.headers);
  headers.set("accept", patched);

  // Create a new Request with the patched headers (body is forwarded as a stream)
  return new NextRequest(request.url, {
    method: request.method,
    headers,
    body: request.body,
    duplex: "half",
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
    let requestBody: { method?: string; id?: unknown; params?: Record<string, unknown> } | null = null;
    try {
      requestBody = await clonedReq.json();
      method = requestBody?.method || "unknown";
    } catch {
      // body may not be JSON
    }
    console.log(
      `[MCP Route] POST: method=${method}, session=${sessionId ?? "new"}, accept=${accept}`,
    );

    // Ensure the Accept header satisfies the MCP SDK validation
    const patchedRequest = ensureAcceptHeader(
      request,
      "application/json",
      "text/event-stream",
    );

    const transport = await getOrCreateSession(patchedRequest);
    const response = await transport.handleRequest(patchedRequest);

    // Check if the SDK returned "Server not initialized" error
    // For non-initialize methods, auto-initialize a new session and retry
    if (response.status === 400) {
      const responseClone = response.clone();
      try {
        const errorBody = await responseClone.json();
        if (errorBody?.error?.code === -32000 &&
            errorBody?.error?.message?.includes("not initialized")) {

          // If this is NOT an initialize request, we can auto-initialize
          // and retry the original request transparently
          if (method !== "initialize" && requestBody) {
            console.log(
              `[MCP Route] Auto-initializing MCP session for method=${method} (session ${sessionId ?? "unknown"} was stale)`,
            );

            try {
              // Extract workspace ID from the original request headers
              const wsId = request.headers.get("routa-workspace-id") ||
                process.env.ROUTA_WORKSPACE_ID ||
                "default";
              const toolMode = resolveToolMode(request);

              // Create a fresh session and send an initialize request to it
              const freshTransport = await createSession(wsId, false, undefined, toolMode);
              const initBody = JSON.stringify({
                jsonrpc: "2.0",
                id: `auto-init-${Date.now()}`,
                method: "initialize",
                params: {
                  protocolVersion: "2024-11-05",
                  capabilities: {},
                  clientInfo: { name: "routa-auto", version: "0.1.0" },
                },
              });
              const initRequest = new NextRequest(request.url, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Accept": "application/json, text/event-stream",
                  "Routa-Workspace-Id": wsId,
                },
                body: initBody,
              });
              const initResponse = await freshTransport.handleRequest(initRequest);

              if (initResponse.ok) {
                // Get the new session ID from the response
                const newSessionId = initResponse.headers.get("mcp-session-id") ?? freshTransport.sessionId;
                console.log(
                  `[MCP Route] Auto-initialized new session: ${newSessionId}`,
                );

                // Now send the notification/initialized to complete initialization
                const initializedBody = JSON.stringify({
                  jsonrpc: "2.0",
                  method: "notifications/initialized",
                });
                const notifRequest = new NextRequest(request.url, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                    ...(newSessionId ? { "Mcp-Session-Id": newSessionId } : {}),
                  },
                  body: initializedBody,
                });
                await freshTransport.handleRequest(notifRequest);

                // Replay the original request on the new session
                const retryBody = JSON.stringify(requestBody);
                const retryRequest = new NextRequest(request.url, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                    ...(newSessionId ? { "Mcp-Session-Id": newSessionId } : {}),
                  },
                  body: retryBody,
                });
                const retryResponse = await freshTransport.handleRequest(retryRequest);

                // Add the new session ID header so the client can update its reference
                const retryHeaders = new Headers(retryResponse.headers);
                if (newSessionId) {
                  retryHeaders.set("mcp-session-id", newSessionId);
                }

                console.log(
                  `[MCP Route] Auto-init retry response: ${retryResponse.status}`,
                );
                return withCorsHeaders(
                  new Response(retryResponse.body, {
                    status: retryResponse.status,
                    statusText: retryResponse.statusText,
                    headers: retryHeaders,
                  }),
                );
              }
            } catch (autoInitErr) {
              console.error("[MCP Route] Auto-initialization failed:", autoInitErr);
              // Fall through to return the original error
            }
          }

          console.log(
            `[MCP Route] Server not initialized error - client needs to send initialize first`,
          );
          // Return a more descriptive error
          return withCorsHeaders(
            Response.json(
              {
                jsonrpc: "2.0",
                id: requestBody?.id ?? null,
                error: {
                  code: -32000,
                  message:
                    "MCP session not initialized. Send an 'initialize' request first with protocolVersion and clientInfo.",
                },
              },
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            ),
          );
        }
      } catch {
        // Not JSON, return original response
      }
    }

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

    // Ensure Accept header for GET (SDK requires text/event-stream)
    const patchedRequest = ensureAcceptHeader(request, "text/event-stream");
    const response = await session.transport.handleRequest(patchedRequest);
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
        "Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID, Routa-Workspace-Id",
      "Access-Control-Expose-Headers":
        "Mcp-Session-Id, MCP-Protocol-Version",
    },
  });
}
