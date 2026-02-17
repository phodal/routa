/**
 * ACP Server API Route - /api/acp
 *
 * Proxies ACP JSON-RPC to a spawned ACP agent process per session.
 * Supports multiple ACP providers (opencode, gemini, codex-acp, auggie, copilot, claude).
 *
 * - POST: JSON-RPC requests (initialize, session/new, session/prompt, etc.)
 *         → forwarded to the ACP agent via stdin, responses returned to client
 * - GET : SSE stream for `session/update` notifications from the agent
 *
 * Flow:
 *   1. Client sends `initialize` → we return our capabilities (no process yet)
 *   2. Client sends `session/new` → we spawn agent, initialize it, create session
 *      - Optional `provider` param selects the agent (default: "opencode")
 *      - For `claude` provider: spawns Claude Code with stream-json protocol
 *   3. Client connects SSE with sessionId → we pipe agent's session/update to SSE
 *   4. Client sends `session/prompt` → we forward to agent, it streams via session/update
 */

import { NextRequest, NextResponse } from "next/server";
import { getAcpProcessManager } from "@/core/acp/processer";
import { getHttpSessionStore } from "@/core/acp/http-session-store";
import { getStandardPresets, getPresetById, resolveCommand } from "@/core/acp/acp-presets";
import { which } from "@/core/acp/utils";
import { fetchRegistry, detectPlatformTarget } from "@/core/acp/acp-registry";
import { ensureMcpForProvider } from "@/core/acp/mcp-setup";
import { v4 as uuidv4 } from "uuid";
import { isServerlessEnvironment } from "@/core/acp/api-based-providers";
import { shouldUseOpencodeAdapter, isOpencodeServerConfigured } from "@/core/acp/opencode-sdk-adapter";
import { initRoutaOrchestrator, getRoutaOrchestrator } from "@/core/orchestration/orchestrator-singleton";
import { getRoutaSystem } from "@/core/routa-system";
import { AgentRole } from "@/core/models/agent";
import { buildCoordinatorPrompt, getSpecialistByRole } from "@/core/orchestration/specialist-prompts";
import { AcpError } from "@/core/acp/acp-process";

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
    // For `claude` provider: spawns Claude Code with stream-json + MCP.
    if (method === "session/new") {
      const p = (params ?? {}) as Record<string, unknown>;
      const cwd = (p.cwd as string | undefined) ?? process.cwd();
      const provider = (p.provider as string | undefined) ?? "opencode";
      const modeId = (p.modeId as string | undefined) ?? (p.mode as string | undefined);
      const role = (p.role as string | undefined)?.toUpperCase();
      const sessionId = uuidv4();

      // Default provider for CRAFTER/GATE delegation (can be overridden per-task)
      const crafterProvider = (p.crafterProvider as string | undefined) ?? provider;
      const gateProvider = (p.gateProvider as string | undefined) ?? provider;

      console.log(`[ACP Route] Creating session: provider=${provider}, cwd=${cwd}, modeId=${modeId}, role=${role ?? "CRAFTER"}`);

      const store = getHttpSessionStore();
      const manager = getAcpProcessManager();

      const preset = getPresetById(provider);
      const isClaudeCode = preset?.nonStandardApi === true || provider === "claude";

      let acpSessionId: string;

      if (isClaudeCode) {
        // ── Claude Code: stream-json protocol with MCP ───────────────
        const mcpConfigs = buildMcpConfigForClaude();

        acpSessionId = await manager.createClaudeSession(
          sessionId,
          cwd,
          (msg) => {
            if (msg.method === "session/update" && msg.params) {
              const params = msg.params as Record<string, unknown>;
              store.pushNotification({
                ...params,
                sessionId,
              } as never);
            }
          },
          mcpConfigs,
          modeId,
          role, // Pass role so ROUTA gets bypassPermissions
        );
      } else {
        // ── Standard ACP agent ───────────────────────────────────────
        acpSessionId = await manager.createSession(
          sessionId,
          cwd,
          (msg) => {
            if (msg.method === "session/update" && msg.params) {
              const params = msg.params as Record<string, unknown>;
              store.pushNotification({
                ...params,
                sessionId,
              } as never);
            }
          },
          provider,
          modeId,
        );
      }

      // ── Register with orchestrator if role is ROUTA ──────────────
      let routaAgentId: string | undefined;

      if (role === "ROUTA") {
        // Initialize orchestrator
        // Detect actual server port for MCP URL generation
        const serverPort = process.env.PORT ?? "3000";
        const orchestrator = initRoutaOrchestrator({
          defaultCrafterProvider: crafterProvider,
          defaultGateProvider: gateProvider,
          defaultCwd: cwd,
          serverPort,
        });

        // Create a ROUTA agent record
        const system = getRoutaSystem();
        const agentResult = await system.tools.createAgent({
          name: `routa-coordinator-${sessionId.slice(0, 8)}`,
          role: AgentRole.ROUTA,
          workspaceId: "default",
        });

        if (agentResult.success && agentResult.data) {
          routaAgentId = (agentResult.data as { agentId: string }).agentId;
          orchestrator.registerAgentSession(routaAgentId, sessionId);

          // Set up notification handler for child agent updates
          orchestrator.setNotificationHandler((targetSessionId, data) => {
            store.pushNotification({
              ...data as Record<string, unknown>,
              sessionId: targetSessionId,
            } as never);
          });

          console.log(
            `[ACP Route] ROUTA coordinator agent created: ${routaAgentId}`
          );
        }
      }

      // Persist session for UI listing
      store.upsertSession({
        sessionId,
        cwd,
        workspaceId: "default",
        routaAgentId: routaAgentId ?? acpSessionId,
        provider,
        modeId,
        createdAt: new Date().toISOString(),
      });

      console.log(
        `[ACP Route] Session created: ${sessionId} (provider: ${provider}, agent session: ${acpSessionId}, role: ${role ?? "CRAFTER"})`
      );

      return jsonrpcResponse(id ?? null, {
        sessionId,
        provider,
        role: role ?? "CRAFTER",
        routaAgentId,
      });
    }

    // ── session/prompt ─────────────────────────────────────────────────
    // Forward prompt to the ACP agent process (or Claude Code).
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

      // Extract prompt text
      const promptBlocks = p.prompt as Array<{ type: string; text?: string }> | undefined;
      let promptText =
        promptBlocks
          ?.filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("\n") ?? "";

      // Check if this is a ROUTA coordinator session - inject coordinator context
      const orchestrator = getRoutaOrchestrator();
      if (orchestrator) {
        const store = getHttpSessionStore();
        const sessionRecord = store.getSession(sessionId);
        if (sessionRecord?.routaAgentId) {
          const system = getRoutaSystem();
          const agent = await system.agentStore.get(sessionRecord.routaAgentId);
          if (agent?.role === AgentRole.ROUTA) {
            // First prompt for this coordinator - wrap with coordinator context
            const isFirstPrompt = !sessionRecord.firstPromptSent;
            if (isFirstPrompt) {
              promptText = buildCoordinatorPrompt({
                agentId: agent.id,
                workspaceId: "default",
                userRequest: promptText,
              });
              store.markFirstPromptSent(sessionId);
            }
          }
        }
      }

      // ── Claude Code session ─────────────────────────────────────────
      if (manager.isClaudeSession(sessionId)) {
        const claudeProc = manager.getClaudeProcess(sessionId);
        if (!claudeProc) {
          return jsonrpcResponse(id ?? null, null, {
            code: -32000,
            message: `No Claude Code process for session: ${sessionId}`,
          });
        }

        if (!claudeProc.alive) {
          return jsonrpcResponse(id ?? null, null, {
            code: -32000,
            message: "Claude Code process is not running",
          });
        }

        try {
          const result = await claudeProc.prompt(sessionId, promptText);
          return jsonrpcResponse(id ?? null, result);
        } catch (err) {
          return jsonrpcResponse(id ?? null, null, {
            code: -32000,
            message: err instanceof Error ? err.message : "Claude Code prompt failed",
          });
        }
      }

      // ── Standard ACP session ────────────────────────────────────────
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

        // Check if Claude Code session
        if (manager.isClaudeSession(sessionId)) {
          const claudeProc = manager.getClaudeProcess(sessionId);
          if (claudeProc) {
            await claudeProc.cancel();
          }
        } else {
          const proc = manager.getProcess(sessionId);
          const acpSessionId = manager.getAcpSessionId(sessionId);
          if (proc && acpSessionId) {
            await proc.cancel(acpSessionId);
          }
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
      const p = (params ?? {}) as Record<string, unknown>;
      const sessionId = p.sessionId as string | undefined;
      const modeId = (p.modeId as string | undefined) ?? (p.mode as string | undefined);
      if (!sessionId || !modeId) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32602,
          message: "Missing sessionId or modeId",
        });
      }
      const manager = getAcpProcessManager();
      const store = getHttpSessionStore();
      try {
        await manager.setSessionMode(sessionId, modeId);
        store.updateSessionMode(sessionId, modeId);
        // Push a mode update so UI can immediately reflect the change.
        store.pushNotification({
          sessionId,
          update: {
            sessionUpdate: "current_mode_update",
            currentModeId: modeId,
          },
        } as never);
      } catch (err) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32000,
          message: err instanceof Error ? err.message : "Failed to set mode",
        });
      }
      return jsonrpcResponse(id ?? null, {});
    }

    // ── Extension methods ──────────────────────────────────────────────

    // _providers/list - List available ACP agent presets with install status
    // Merges static presets with dynamically-loaded ACP Registry agents.
    if (method === "_providers/list") {
      const allPresets = [...getStandardPresets()];
      const claudePreset = getPresetById("claude");
      if (claudePreset) allPresets.push(claudePreset);

      type ProviderEntry = {
        id: string;
        name: string;
        description: string;
        command: string;
        status: "available" | "unavailable";
        source: "static" | "registry";
      };

      // Check which static preset commands are installed in parallel
      const staticProviders: ProviderEntry[] = await Promise.all(
        allPresets.map(async (p): Promise<ProviderEntry> => {
          const cmd = resolveCommand(p);
          const resolved = await which(cmd);
          return {
            id: p.id,
            name: p.name,
            description: p.description,
            command: p.command,
            status: resolved ? "available" : "unavailable",
            source: "static",
          };
        })
      );

      // Merge registry agents that aren't already covered by static presets
      const staticIds = new Set(staticProviders.map((p) => p.id));
      try {
        const registry = await fetchRegistry();
        const npxPath = await which("npx");
        const uvxPath = await which("uv");
        const platform = detectPlatformTarget();

        for (const agent of registry.agents) {
          if (staticIds.has(agent.id)) continue;

          const dist = agent.distribution;
          let command = "";
          let status: "available" | "unavailable" = "unavailable";

          if (dist.npx && npxPath) {
            command = `npx ${dist.npx.package}`;
            status = "available";
          } else if (dist.uvx && uvxPath) {
            command = `uvx ${dist.uvx.package}`;
            status = "available";
          } else if (dist.binary && platform && dist.binary[platform]) {
            command = dist.binary[platform]!.cmd ?? agent.id;
            status = "unavailable"; // binary needs install first
          } else if (dist.npx) {
            command = `npx ${dist.npx.package}`;
            status = "unavailable";
          } else if (dist.uvx) {
            command = `uvx ${dist.uvx.package}`;
            status = "unavailable";
          }

          staticProviders.push({
            id: agent.id,
            name: agent.name,
            description: agent.description,
            command,
            status,
            source: "registry",
          });
        }
      } catch (err) {
        console.warn("[ACP Route] Failed to fetch registry for providers:", err);
      }

      const providers = staticProviders;

      // In serverless environments, add OpenCode SDK as a provider option
      if (isServerlessEnvironment()) {
        const sdkConfigured = isOpencodeServerConfigured();
        providers.unshift({
          id: "opencode-sdk",
          name: "OpenCode SDK",
          description: sdkConfigured
            ? "Connect to remote OpenCode server (configured)"
            : "Connect to remote OpenCode server (set OPENCODE_SERVER_URL)",
          command: "sdk",
          status: sdkConfigured ? "available" : "unavailable",
          source: "static",
        });
      }

      // Sort: available first, then alphabetical
      providers.sort((a, b) => {
        if (a.status === b.status) return a.name.localeCompare(b.name);
        return a.status === "available" ? -1 : 1;
      });

      return jsonrpcResponse(id ?? null, { providers });
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

    // Handle AcpError with auth information
    if (error instanceof AcpError) {
      return jsonrpcResponse(null, null, {
        code: error.code,
        message: error.message,
        authMethods: error.authMethods,
        agentInfo: error.agentInfo,
      });
    }

    return jsonrpcResponse(null, null, {
      code: -32603,
      message: error instanceof Error ? error.message : "Internal error",
    });
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

interface JsonRpcError {
  code: number;
  message: string;
  authMethods?: Array<{ id: string; name: string; description: string }>;
  agentInfo?: { name: string; version: string };
}

function jsonrpcResponse(
  id: string | number | null,
  result: unknown,
  error?: JsonRpcError
) {
  if (error) {
    return NextResponse.json({ jsonrpc: "2.0", id, error });
  }
  return NextResponse.json({ jsonrpc: "2.0", id, result });
}

/**
 * Build MCP configuration JSON for Claude Code.
 * Injects the routa-mcp server so Claude Code can use Routa coordination tools.
 *
 * Claude Code accepts --mcp-config with an inline JSON object.
 * We reuse the shared provider setup path to avoid config drift.
 */
function buildMcpConfigForClaude(): string[] {
  // Keep Claude MCP setup consistent with all other providers.
  // This path uses streamable HTTP via /api/mcp and includes workspace env.
  const result = ensureMcpForProvider("claude");
  console.log(`[ACP Route] MCP config for Claude Code: ${result.summary}`);
  return result.mcpConfigs;
}
