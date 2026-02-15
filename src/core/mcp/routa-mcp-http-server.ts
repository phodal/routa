/**
 * RoutaMcpHttpServer - TypeScript port of routa-core RoutaMcpWebSocketServer.kt
 *
 * Manages a standalone MCP server with both Streamable HTTP and WebSocket transports.
 *
 * Transports:
 *   - **Streamable HTTP** at /mcp (POST / GET / DELETE) — 2025-06-18 protocol
 *     Used by Claude Code, Copilot, Auggie, Codex, Gemini, Kimi, etc.
 *   - **WebSocket** at /ws — for MCP Inspector and other WebSocket clients
 *
 * The server uses a **dynamic port** (port 0) so it can coexist with the main
 * Next.js application (which runs on port 3000).
 *
 * Usage:
 * ```typescript
 * const server = new RoutaMcpHttpServer("my-workspace");
 * const port = await server.start();
 * // Provider configs should point to: http://127.0.0.1:{port}/mcp
 * // WebSocket clients can connect to: ws://127.0.0.1:{port}/ws
 * await server.stop();
 * ```
 *
 * Architecture (matches Java):
 * ```
 *   ┌──────────────────────────────────┐
 *   │     RoutaMcpHttpServer           │
 *   │  ┌────────────────────────────┐  │
 *   │  │   Node.js HTTP Server      │  │
 *   │  │                            │  │
 *   │  │  POST/GET/DELETE /mcp      │──┼──▶ StreamableHTTPServerTransport
 *   │  │                            │  │       ↕
 *   │  │  Upgrade: WebSocket /ws    │──┼──▶ WebSocketServerTransport
 *   │  │                            │  │       ↕
 *   │  └────────────────────────────┘  │    McpServer (with Routa tools)
 *   └──────────────────────────────────┘
 * ```
 */

import * as http from "http";
import { WebSocketServer, type WebSocket } from "ws";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createRoutaMcpServer } from "./routa-mcp-server";
import { WebSocketServerTransport } from "./ws-server-transport";

export class RoutaMcpHttpServer {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private _port = 0;
  private readonly sessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport }
  >();

  constructor(
    private readonly workspaceId: string = "default",
    private readonly host: string = "127.0.0.1",
  ) {}

  // ─── Properties ──────────────────────────────────────────────────────

  get port(): number {
    return this._port;
  }

  get isRunning(): boolean {
    return this.httpServer !== null;
  }

  /** Streamable HTTP URL, e.g. http://127.0.0.1:12345/mcp */
  get mcpUrl(): string {
    return `http://${this.host}:${this._port}/mcp`;
  }

  /** WebSocket URL, e.g. ws://127.0.0.1:12345/ws */
  get wsUrl(): string {
    return `ws://${this.host}:${this._port}/ws`;
  }

  // ─── Start / Stop ───────────────────────────────────────────────────

  /**
   * Start the MCP server on a dynamically allocated port.
   * Returns the actual port number.
   */
  async start(): Promise<number> {
    if (this.httpServer) {
      return this._port;
    }

    // Create HTTP server for Streamable HTTP transport
    this.httpServer = http.createServer(
      this.handleHttpRequest.bind(this),
    );

    // Create WebSocket server for MCP Inspector and WS clients
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("connection", this.handleWebSocketConnection.bind(this));

    // Handle HTTP → WebSocket upgrade
    this.httpServer.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url || "/", `http://${this.host}`);

      if (url.pathname === "/ws") {
        this.wss!.handleUpgrade(req, socket, head, (ws) => {
          this.wss!.emit("connection", ws, req);
        });
      } else {
        // Not a recognized WebSocket path
        socket.destroy();
      }
    });

    // Listen on dynamic port (port 0 = OS picks an available port)
    return new Promise<number>((resolve, reject) => {
      this.httpServer!.listen(0, this.host, () => {
        const addr = this.httpServer!.address();
        if (addr && typeof addr === "object") {
          this._port = addr.port;
          console.log(
            `[RoutaMcpHttpServer] Started on ${this.host}:${this._port}`,
          );
          console.log(
            `[RoutaMcpHttpServer] Streamable HTTP: ${this.mcpUrl}`,
          );
          console.log(`[RoutaMcpHttpServer] WebSocket: ${this.wsUrl}`);
          resolve(this._port);
        } else {
          reject(new Error("Failed to get server address"));
        }
      });

      this.httpServer!.on("error", reject);
    });
  }

  /**
   * Stop the MCP server and release resources.
   */
  async stop(): Promise<void> {
    // Close all active transports
    for (const [id, session] of this.sessions) {
      try {
        await session.transport.close();
      } catch {
        // ignore
      }
      this.sessions.delete(id);
    }

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    this._port = 0;
    console.log("[RoutaMcpHttpServer] Stopped");
  }

  // ─── MCP Config Generators ──────────────────────────────────────────

  /**
   * Generate a JSON MCP config for Streamable HTTP transport.
   *
   * Use this with Claude Code `--mcp-config <json>`, Auggie, Copilot, etc.
   *
   * @example
   * ```json
   * {"mcpServers":{"routa-coordination":{"url":"http://127.0.0.1:12345/mcp","type":"http"}}}
   * ```
   */
  toMcpConfigJson(): string {
    if (!this.isRunning) throw new Error("Server is not running");

    return JSON.stringify({
      mcpServers: {
        "routa-coordination": {
          url: this.mcpUrl,
          type: "http",
        },
      },
    });
  }

  /**
   * Generate a JSON MCP config for WebSocket transport.
   */
  toWebSocketConfigJson(): string {
    if (!this.isRunning) throw new Error("Server is not running");

    return JSON.stringify({
      mcpServers: {
        "routa-coordination": {
          url: this.wsUrl,
          type: "websocket",
        },
      },
    });
  }

  // ─── HTTP Request Handler (Streamable HTTP) ─────────────────────────

  private async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url || "/", `http://${this.host}:${this._port}`);

    // Health check endpoint
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          transport: ["streamable-http", "websocket"],
          sessions: this.sessions.size,
        }),
      );
      return;
    }

    // Only handle /mcp path for Streamable HTTP
    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found. Use /mcp for Streamable HTTP or /ws for WebSocket.");
      return;
    }

    // CORS headers for cross-origin requests
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, DELETE, OPTIONS",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
    );
    res.setHeader(
      "Access-Control-Expose-Headers",
      "Mcp-Session-Id, MCP-Protocol-Version",
    );

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // Route to existing session or create new one
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let session = sessionId ? this.sessions.get(sessionId) : undefined;

      if (!session) {
        // Create a new transport + MCP server for this session
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          // Return JSON instead of SSE for better client compatibility
          enableJsonResponse: true,
          onsessioninitialized: (id) => {
            this.sessions.set(id, { transport });
            console.log(
              `[RoutaMcpHttpServer] New session: ${id} (total: ${this.sessions.size})`,
            );
          },
        });

        const { server } = createRoutaMcpServer(this.workspaceId);
        await server.connect(transport);

        // For DELETE requests, handle session cleanup
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) {
            this.sessions.delete(sid);
            console.log(
              `[RoutaMcpHttpServer] Session closed: ${sid} (total: ${this.sessions.size})`,
            );
          }
        };

        session = { transport };
      }

      // Delegate to the MCP SDK's transport handler
      await session.transport.handleRequest(req, res);
    } catch (err) {
      console.error("[RoutaMcpHttpServer] Error handling request:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message:
                err instanceof Error ? err.message : "Internal server error",
            },
          }),
        );
      }
    }
  }

  // ─── WebSocket Handler ─────────────────────────────────────────────

  private async handleWebSocketConnection(ws: WebSocket): Promise<void> {
    console.log("[RoutaMcpHttpServer] WebSocket client connected");

    try {
      // Each WebSocket connection gets a fresh MCP server
      // (same pattern as Java: mcpWebSocket("/mcp") { RoutaMcpServer.create(...) })
      const transport = new WebSocketServerTransport(ws);
      const { server } = createRoutaMcpServer(this.workspaceId);
      await server.connect(transport);

      ws.on("close", () => {
        console.log("[RoutaMcpHttpServer] WebSocket client disconnected");
      });
    } catch (err) {
      console.error(
        "[RoutaMcpHttpServer] WebSocket connection error:",
        err,
      );
      ws.close();
    }
  }
}
