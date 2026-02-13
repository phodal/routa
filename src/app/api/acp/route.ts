/**
 * ACP Server API Route - /api/acp
 *
 * Proxies ACP JSON-RPC to a spawned ACP agent process per session.
 * Supports multiple ACP providers (opencode, gemini, codex-acp, auggie, copilot).
 *
 * - POST: JSON-RPC requests (initialize, session/new, session/prompt, etc.)
 *         → forwarded to the ACP agent via stdin, responses returned to client
 * - GET : SSE stream for `session/update` notifications from the agent
 *
 * Flow:
 *   1. Client sends `initialize` → we return our capabilities (no process yet)
 *   2. Client sends `session/new` → we spawn agent, initialize it, create session
 *      - Optional `provider` param selects the agent (default: "opencode")
 *   3. Client connects SSE with sessionId → we pipe agent's session/update to SSE
 *   4. Client sends `session/prompt` → we forward to agent, it streams via session/update
 */

import { NextRequest, NextResponse } from "next/server";
import { getAcpProcessManager } from "@/core/acp/opencode-process";
import { getHttpSessionStore } from "@/core/acp/http-session-store";
import { getStandardPresets } from "@/core/acp/acp-presets";
import { v4 as uuidv4 } from "uuid";

export const dynamic = "force-dynamic";

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

    // ── initialize ─────────────────────────────────────────────────────
    // No agent process yet; return our own capabilities.
    if (method === "initialize") {
      return jsonrpcResponse(id ?? null, {
        protocolVersion: (params as { protocolVersion?: number })?.protocolVersion ?? 1,
        agentCapabilities: {
          loadSession: false,
        },
        agentInfo: {
          name: "routa-acp",
          version: "0.1.0",
        },
      });
    }

    // ── session/new ────────────────────────────────────────────────────
    // Spawn an ACP agent process and create a session.
    // Optional `provider` param selects the agent (default: "opencode").
    if (method === "session/new") {
      const p = (params ?? {}) as Record<string, unknown>;
      const cwd = (p.cwd as string | undefined) ?? process.cwd();
      const provider = (p.provider as string | undefined) ?? "opencode";
      const sessionId = uuidv4();

      const store = getHttpSessionStore();
      const manager = getAcpProcessManager();

      // Spawn the selected ACP agent and wire up notification forwarding
      const acpSessionId = await manager.createSession(
        sessionId,
        cwd,
        (msg) => {
          // Forward all notifications from the agent to SSE
          if (msg.method === "session/update" && msg.params) {
            // Rewrite the sessionId: the agent uses its own internal ID,
            // but the browser knows our sessionId.
            const params = msg.params as Record<string, unknown>;
            store.pushNotification({
              ...params,
              sessionId, // Override with our sessionId (MUST come after spread)
            } as never);
          }
        },
        provider // Pass the selected provider preset ID
      );

      // Persist session for UI listing
      store.upsertSession({
        sessionId,
        cwd,
        workspaceId: "default",
        routaAgentId: acpSessionId,
        provider,
        createdAt: new Date().toISOString(),
      });

      console.log(
        `[ACP Route] Session created: ${sessionId} (provider: ${provider}, agent session: ${acpSessionId})`
      );

      return jsonrpcResponse(id ?? null, { sessionId, provider });
    }

    // ── session/prompt ─────────────────────────────────────────────────
    // Forward prompt to the ACP agent process.
    if (method === "session/prompt") {
      const p = (params ?? {}) as Record<string, unknown>;
      const sessionId = p.sessionId as string;

      if (!sessionId) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32602,
          message: "Missing sessionId",
        });
      }

      const manager = getAcpProcessManager();
      const proc = manager.getProcess(sessionId);
      const acpSessionId = manager.getAcpSessionId(sessionId);

      if (!proc || !acpSessionId) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32000,
          message: `No ACP agent process for session: ${sessionId}`,
        });
      }

      if (!proc.alive) {
        const presetId = manager.getPresetId(sessionId) ?? "unknown";
        return jsonrpcResponse(id ?? null, null, {
          code: -32000,
          message: `ACP agent (${presetId}) process is not running`,
        });
      }

      // Extract prompt text
      const promptBlocks = p.prompt as Array<{ type: string; text?: string }> | undefined;
      const promptText =
        promptBlocks
          ?.filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("\n") ?? "";

      try {
        // Forward to agent (responses stream via session/update → SSE)
        const result = await proc.prompt(acpSessionId, promptText);
        return jsonrpcResponse(id ?? null, result);
      } catch (err) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32000,
          message: err instanceof Error ? err.message : "Prompt failed",
        });
      }
    }

    // ── session/cancel ─────────────────────────────────────────────────
    if (method === "session/cancel") {
      const p = (params ?? {}) as Record<string, unknown>;
      const sessionId = p.sessionId as string;

      if (sessionId) {
        const manager = getAcpProcessManager();
        const proc = manager.getProcess(sessionId);
        const acpSessionId = manager.getAcpSessionId(sessionId);
        if (proc && acpSessionId) {
          await proc.cancel(acpSessionId);
        }
      }

      return jsonrpcResponse(id ?? null, {});
    }

    // ── session/load ───────────────────────────────────────────────────
    if (method === "session/load") {
      return jsonrpcResponse(id ?? null, null, {
        code: -32601,
        message: "session/load not supported - create a new session instead",
      });
    }

    // ── session/set_mode ───────────────────────────────────────────────
    if (method === "session/set_mode") {
      // TODO: forward to the agent when supported
      return jsonrpcResponse(id ?? null, {});
    }

    // ── Extension methods ──────────────────────────────────────────────

    // _providers/list - List available ACP agent presets
    if (method === "_providers/list") {
      const presets = getStandardPresets().map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        command: p.command,
      }));
      return jsonrpcResponse(id ?? null, { providers: presets });
    }

    if (method.startsWith("_")) {
      return jsonrpcResponse(id ?? null, null, {
        code: -32601,
        message: `Extension method not supported: ${method}`,
      });
    }

    return jsonrpcResponse(id ?? null, null, {
      code: -32601,
      message: `Method not found: ${method}`,
    });
  } catch (error) {
    console.error("[ACP Route] Error:", error);
    return jsonrpcResponse(null, null, {
      code: -32603,
      message: error instanceof Error ? error.message : "Internal error",
    });
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

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
