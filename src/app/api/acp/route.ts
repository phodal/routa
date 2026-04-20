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
import { getDefaultRoutaMcpConfig } from "@/core/acp/mcp-config-generator";
import { resolveMcpServerProfile, type McpServerProfile } from "@/core/mcp/mcp-server-profiles";
import { isServerlessEnvironment } from "@/core/acp/api-based-providers";
import { isOpencodeServerConfigured } from "@/core/acp/opencode-sdk-adapter";
import { AcpError } from "@/core/acp/acp-process";
import {
  loadHistorySinceEventIdFromDb,
  loadSessionFromDb,
  loadSessionFromLocalStorage,
  persistSessionToDb,
  renameSessionInDb,
  updateSessionExecutionBindingInDb,
} from "@/core/acp/session-db-persister";
import type { SessionUpdateNotification } from "@/core/acp/http-session-store";
import type { RoutaSessionRecord } from "@/core/acp/http-session-store";
import { getTerminalManager } from "@/core/acp/terminal-manager";
import {
  buildExecutionBinding,
  getEmbeddedOwnershipIssue,
  refreshExecutionBinding,
  requiresRunnerProxy,
  shouldUseRunnerForProvider,
} from "@/core/acp/execution-backend";
import {
  getRequiredRunnerUrl,
  getSessionRoutingRecord,
  isForwardedAcpRequest,
  proxyRequestToRunner,
  runnerUnavailableResponse,
} from "@/core/acp/runner-routing";
import { handleSessionNew } from "./acp-session-create";
import { getSessionWriteBuffer } from "./acp-session-history";
import { handleSessionPrompt } from "./acp-session-prompt";

export const dynamic = "force-dynamic";

function isAcpErrorLike(error: unknown): error is AcpError {
  if (error instanceof AcpError) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as Record<string, unknown>;
  return candidate.name === "AcpError" && typeof candidate.message === "string";
}

function encodeSsePayload(payload: unknown): string {
  const params = typeof payload === "object" && payload !== null
    ? (payload as { params?: { eventId?: string } }).params
    : undefined;
  const eventId = typeof params?.eventId === "string" ? params.eventId : undefined;
  return `${eventId ? `id: ${eventId}\n` : ""}data: ${JSON.stringify(payload)}\n\n`;
}

function shouldFlushForwardedSessionUpdate(
  notification: SessionUpdateNotification,
): boolean {
  const update = notification.update as Record<string, unknown> | undefined;
  const sessionUpdate = typeof update?.sessionUpdate === "string" ? update.sessionUpdate : undefined;
  if (!sessionUpdate) return false;

  if (
    sessionUpdate === "turn_complete"
    || sessionUpdate === "task_completion"
    || sessionUpdate === "completed"
    || sessionUpdate === "ended"
    || sessionUpdate === "error"
  ) {
    return true;
  }

  if (sessionUpdate === "tool_call_update") {
    const status = typeof update?.status === "string" ? update.status : undefined;
    return status === "completed" || status === "failed";
  }

  return false;
}

function pushAndPersistForwardedNotification(
  store: ReturnType<typeof getHttpSessionStore>,
  sessionId: string,
  data: unknown,
): void {
  const notification = {
    ...(data as Record<string, unknown>),
    sessionId,
  } as SessionUpdateNotification;

  store.pushNotification(notification);

  const buffer = getSessionWriteBuffer();
  buffer.add(sessionId, notification);
  if (shouldFlushForwardedSessionUpdate(notification)) {
    void buffer.flush(sessionId);
  }
}

function markMissingInteractiveRequestAsFailed(
  sessionId: string,
  toolCallId: string,
  response: Record<string, unknown>,
): void {
  const store = getHttpSessionStore();
  pushAndPersistForwardedNotification(store, sessionId, {
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId,
      title: "UserInputResponse",
      status: "failed",
      rawInput: response,
      rawOutput: {
        message: "No pending interactive request found for this session",
      },
    },
  });
}

function requireWorkspaceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function refreshEmbeddedSessionLease(
  store: ReturnType<typeof getHttpSessionStore>,
  session: RoutaSessionRecord | undefined,
): void {
  if (!session || session.executionMode !== "embedded") {
    return;
  }

  const refreshed = refreshExecutionBinding(session);
  store.upsertSession(refreshed);
  void updateSessionExecutionBindingInDb(session.sessionId, {
    executionMode: refreshed.executionMode,
    ownerInstanceId: refreshed.ownerInstanceId,
    leaseExpiresAt: refreshed.leaseExpiresAt,
  });
}

// ─── GET: SSE stream for session/update ────────────────────────────────

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  const isProbe = request.nextUrl.searchParams.get("probe") === "1";
  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing sessionId query param" },
      { status: 400 }
    );
  }

  let sessionRoutingRecord: Awaited<ReturnType<typeof getSessionRoutingRecord>> | undefined;
  if (!isForwardedAcpRequest(request)) {
    sessionRoutingRecord = await getSessionRoutingRecord(sessionId);
    const runnerUrl = getRequiredRunnerUrl();
    if (sessionRoutingRecord?.executionMode === "runner") {
      if (!runnerUrl) return runnerUnavailableResponse();
      return proxyRequestToRunner(request, { runnerUrl, path: "/api/acp" });
    }

    const ownershipIssue = getEmbeddedOwnershipIssue(sessionRoutingRecord);
    if (ownershipIssue) {
      return NextResponse.json(
        {
          error: ownershipIssue,
          ownerInstanceId: sessionRoutingRecord?.ownerInstanceId,
          leaseExpiresAt: sessionRoutingRecord?.leaseExpiresAt,
        },
        { status: 409 },
      );
    }
  }

  const store = getHttpSessionStore();
  refreshEmbeddedSessionLease(store, sessionRoutingRecord);

  if (isProbe) {
    return new NextResponse(null, { status: 204 });
  }

  // ─── Improved SSE cleanup with multiple safeguards ──────────────────────
  // In Vercel serverless, connections may drop silently. We implement
  // multiple cleanup mechanisms to ensure resources are released:
  // 1. Request abort event (client disconnect)
  // 2. Controller close event (stream closed)
  // 3. Heartbeat timeout (detect stale connections)
  // 4. Connection close event (transport-level close)

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let isCleanedUp = false;

  const cleanup = (reason: string) => {
    if (isCleanedUp) return;
    isCleanedUp = true;

    console.log(`[ACP Route] SSE cleanup for session ${sessionId}: ${reason}`);

    // Clear heartbeat timer
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    // Detach SSE from store
    store.detachSse(sessionId);

    // Flush any buffered agent content
    try {
      store.flushAgentBuffer(sessionId);
    } catch {
      // Ignore errors during cleanup
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const lastEventId = request.headers.get("last-event-id")
        ?? request.nextUrl.searchParams.get("lastEventId");
      let replayedFromLastEventId = false;
      if (lastEventId) {
        const history = await loadHistorySinceEventIdFromDb(
          sessionId,
          lastEventId,
          store.getSession(sessionId)?.cwd,
        );
        if (history.length > 0) {
          replayedFromLastEventId = true;
          const encoder = new TextEncoder();
          for (const entry of history) {
            controller.enqueue(encoder.encode(encodeSsePayload({
              jsonrpc: "2.0",
              method: "session/update",
              params: entry,
            })));
          }
        }
      }

      store.attachSse(sessionId, controller, { skipPending: replayedFromLastEventId });
      store.pushConnected(sessionId);

      // ─── Heartbeat mechanism ─────────────────────────────────────────────
      // Send a comment every 30 seconds to keep the connection alive
      // and detect dead connections. If the write fails, cleanup is triggered.
      heartbeatTimer = setInterval(() => {
        try {
          const encoder = new TextEncoder();
          const heartbeat = ": heartbeat\n\n";
          controller.enqueue(encoder.encode(heartbeat));
        } catch {
          // Write failed - connection is dead
          cleanup("heartbeat write failed");
        }
      }, 30000); // 30 second heartbeat

      // ─── Cleanup on request abort (client disconnect) ───────────────────
      const abortHandler = () => {
        cleanup("client aborted");
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener("abort", abortHandler);

      // ─── Cleanup on controller close (stream ended) ─────────────────────
      // Note: ReadableStream doesn't expose a direct 'closed' promise on the controller
      // We rely on the abort handler and heartbeat for cleanup
    },

    cancel(reason) {
      // Called when the stream is canceled by the reader
      cleanup(`stream canceled: ${reason}`);
    },
  });

  // ─── Return response with proper headers ─────────────────────────────────────
  const response = new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    },
  });

  return response;
}

// ─── POST: JSON-RPC request handler ────────────────────────────────────

export async function POST(request: NextRequest) {
  let requestId: string | number | null = null;
  let requestMethod = "unknown";
  try {
    const body = await request.json();
    const { method, params, id } = body as {
      jsonrpc: "2.0";
      id?: string | number | null;
      method: string;
      params?: Record<string, unknown>;
    };
    requestId = id ?? null;
    requestMethod = method;

    // ── initialize ─────────────────────────────────────────────────────
    // No agent process yet; return our own capabilities.
    if (method === "initialize") {
      return jsonrpcResponse(id ?? null, {
        protocolVersion: (params as { protocolVersion?: number })?.protocolVersion ?? 1,
        agentCapabilities: {
          loadSession: true,
        },
        agentInfo: {
          name: "routa-acp",
          version: "0.1.0",
        },
      });
    }

    if (!isForwardedAcpRequest(request)) {
      const runnerUrl = getRequiredRunnerUrl();

      if (method === "session/new") {
        const provider = ((params ?? {}) as Record<string, unknown>).provider as string | undefined;
        const defaultProvider = isServerlessEnvironment() ? "claude-code-sdk" : "opencode";
        const effectiveProvider = provider ?? defaultProvider;
        if (runnerUrl && shouldUseRunnerForProvider(effectiveProvider)) {
          const forwardedResponse = await proxyRequestToRunner(request, {
            runnerUrl,
            path: "/api/acp",
            method: "POST",
            body: body as Record<string, unknown>,
          });
          const forwardedPayload = await forwardedResponse.json() as Record<string, unknown>;

          const result = forwardedPayload.result as Record<string, unknown> | undefined;
          const sessionId = typeof result?.sessionId === "string" ? result.sessionId : undefined;
          const workspaceId = requireWorkspaceId(((params ?? {}) as Record<string, unknown>).workspaceId);
          const cwd = typeof ((params ?? {}) as Record<string, unknown>).cwd === "string"
            ? (((params ?? {}) as Record<string, unknown>).cwd as string)
            : process.cwd();
          const executionBinding = buildExecutionBinding("runner");

          if (sessionId && workspaceId) {
            getHttpSessionStore().upsertSession({
              sessionId,
              name: typeof ((params ?? {}) as Record<string, unknown>).name === "string"
                ? (((params ?? {}) as Record<string, unknown>).name as string)
                : undefined,
              cwd,
              branch: typeof ((params ?? {}) as Record<string, unknown>).branch === "string"
                ? (((params ?? {}) as Record<string, unknown>).branch as string)
                : undefined,
              workspaceId,
              provider: effectiveProvider,
              role: typeof result?.role === "string"
                ? result.role
                : (typeof ((params ?? {}) as Record<string, unknown>).role === "string"
                    ? (((params ?? {}) as Record<string, unknown>).role as string)
                    : "CRAFTER"),
              modeId: typeof ((params ?? {}) as Record<string, unknown>).modeId === "string"
                ? (((params ?? {}) as Record<string, unknown>).modeId as string)
                : undefined,
              model: typeof result?.model === "string" ? result.model : undefined,
              parentSessionId: typeof ((params ?? {}) as Record<string, unknown>).parentSessionId === "string"
                ? (((params ?? {}) as Record<string, unknown>).parentSessionId as string)
                : undefined,
              acpStatus: typeof result?.acpStatus === "string"
                ? (result.acpStatus as "connecting" | "ready" | "error")
                : "connecting",
              createdAt: new Date().toISOString(),
              ...executionBinding,
            });
          }

          if (result) {
            forwardedPayload.result = {
              ...result,
              ...executionBinding,
            };
          }

          return NextResponse.json(forwardedPayload, {
            status: forwardedResponse.status,
            headers: { "Cache-Control": "no-store" },
          });
        }
      }

      const sessionMethods = new Set([
        "session/load",
        "session/prompt",
        "session/respond_user_input",
        "session/cancel",
        "terminal/write",
        "terminal/resize",
        "session/set_mode",
      ]);

      if (runnerUrl && sessionMethods.has(method)) {
        const sessionId = ((params ?? {}) as Record<string, unknown>).sessionId as string | undefined;
        if (sessionId) {
          const session = await getSessionRoutingRecord(sessionId);
          if (requiresRunnerProxy(session?.executionMode)) {
            return proxyRequestToRunner(request, {
              runnerUrl,
              path: "/api/acp",
              method: "POST",
              body: body as Record<string, unknown>,
            });
          }
          const ownershipIssue = getEmbeddedOwnershipIssue(session);
          if (ownershipIssue) {
            return jsonrpcResponse(id ?? null, null, {
              code: -32010,
              message: ownershipIssue,
            });
          }
          refreshEmbeddedSessionLease(getHttpSessionStore(), session);
        }
      }
    }

    // ── session/new ────────────────────────────────────────────────────
    // Spawn an ACP agent process and create a session.
    // Optional `provider` param selects the agent.
    // Default provider: claude-code-sdk in serverless (Vercel), opencode otherwise.
    // For `claude` provider: spawns Claude Code with stream-json + MCP.
    // Supports idempotencyKey to prevent duplicate session creation.
    if (method === "session/new") {
      const resolvedMcpProfile = resolveMcpServerProfile(
        typeof (params as Record<string, unknown> | undefined)?.mcpProfile === "string"
          ? ((params as Record<string, unknown>).mcpProfile as string)
          : undefined,
      );
      return handleSessionNew({
        id: id ?? null,
        params: {
          ...(params ?? {}),
          mcpProfile: resolvedMcpProfile ?? (((params ?? {}) as Record<string, unknown>).specialistId === "team-agent-lead"
            ? "team-coordination"
            : undefined),
        },
        jsonrpcResponse,
        createSessionUpdateForwarder,
        buildMcpConfigForClaude,
        requireWorkspaceId,
        pushAndPersistForwardedNotification,
      });
    }

    // ── session/prompt ─────────────────────────────────────────────────
    // Forward prompt to the ACP agent process (or Claude Code).
    // If session doesn't exist, auto-create one with default settings.
    if (method === "session/prompt") {
      return handleSessionPrompt({
        id: id ?? null,
        params: (params ?? {}) as Record<string, unknown>,
        jsonrpcResponse,
        createSessionUpdateForwarder,
        buildMcpConfigForClaude,
        requireWorkspaceId,
        encodeSsePayload,
      });
    }

    // ── session/load ──────────────────────────────────────────────────
    if (method === "session/load") {
      const p = (params ?? {}) as Record<string, unknown>;
      const sessionId = typeof p.sessionId === "string" ? p.sessionId : undefined;
      const manager = getAcpProcessManager();
      const store = getHttpSessionStore();

      if (!sessionId) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32602,
          message: "Missing sessionId",
        });
      }

      const existingSession = manager.hasActiveSession(sessionId);

      const storedSession = store.getSession(sessionId);
      const persistedSession = storedSession
        ? null
        : (await loadSessionFromDb(sessionId)) ?? (await loadSessionFromLocalStorage(sessionId));
      const recoveredSession = storedSession ?? persistedSession ?? undefined;

      if (!recoveredSession) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32004,
          message: `Persisted session not found: ${sessionId}`,
        });
      }

      const ownershipIssue = getEmbeddedOwnershipIssue(recoveredSession);
      if (ownershipIssue) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32010,
          message: ownershipIssue,
        });
      }

      const provider = recoveredSession.provider ?? (isServerlessEnvironment() ? "claude-code-sdk" : "opencode");
      const cwd = (typeof p.cwd === "string" ? p.cwd : recoveredSession.cwd) ?? process.cwd();
      const workspaceId = recoveredSession.workspaceId;
      const role = recoveredSession.role ?? "CRAFTER";
      const providerSessionId = recoveredSession.routaAgentId ?? sessionId;

      if (existingSession) {
        store.upsertSession({
          sessionId,
          name: recoveredSession.name,
          cwd,
          branch: recoveredSession.branch,
          workspaceId,
          routaAgentId: manager.getAcpSessionId(sessionId) ?? recoveredSession.routaAgentId,
          provider,
          role,
          modeId: recoveredSession.modeId,
          model: recoveredSession.model,
          parentSessionId: recoveredSession.parentSessionId,
          specialistId: recoveredSession.specialistId,
          executionMode: recoveredSession.executionMode,
          ownerInstanceId: recoveredSession.ownerInstanceId,
          leaseExpiresAt: recoveredSession.leaseExpiresAt,
          createdAt: recoveredSession.createdAt instanceof Date
            ? recoveredSession.createdAt.toISOString()
            : (recoveredSession.createdAt ?? new Date().toISOString()),
          acpStatus: "ready",
        });
        return jsonrpcResponse(id ?? null, {
          sessionId,
          provider,
          role,
          acpStatus: "ready",
          resumeMode: "attached",
        });
      }

      const forwardSessionUpdate = createSessionUpdateForwarder(store, sessionId);
      let acpSessionId: string;
      let resumeMode: "native" | "recreated" = "recreated";
      let nativeResumeError: string | undefined;

      // Determine whether native resume should be attempted based on provider capabilities
      const preset = getPresetById(provider);
      const supportsNativeResume = preset?.resume?.supported && (preset.resume.mode === "native" || preset.resume.mode === "both");

      try {
        if (supportsNativeResume) {
          acpSessionId = await manager.loadSession(
            sessionId,
            cwd,
            forwardSessionUpdate,
            provider,
            workspaceId,
            storedSession?.toolMode,
            storedSession?.mcpProfile,
            {
              provider,
              role,
            },
            providerSessionId,
          );
          resumeMode = "native";
        } else {
          throw new Error(`Native resume not supported for provider: ${provider} (mode: replay)`);
        }
      } catch (error) {
        nativeResumeError = error instanceof Error ? error.message : "Native resume failed";
        console.warn(`[ACP Route] Native resume failed for ${sessionId} (provider: ${provider}), falling back to recreate:`, error);
        acpSessionId = await manager.createSession(
          sessionId,
          cwd,
          forwardSessionUpdate,
          provider,
          storedSession?.modeId,
          undefined,
          undefined,
          workspaceId,
          storedSession?.toolMode,
          storedSession?.mcpProfile,
          {
            provider,
            role,
          },
        );
      }

      const executionBinding = buildExecutionBinding("embedded");
      const now = new Date().toISOString();
      const sessionRecord = {
        sessionId,
        name: recoveredSession.name,
        cwd,
        branch: recoveredSession.branch,
        workspaceId,
        routaAgentId: acpSessionId,
        provider,
        role,
        modeId: recoveredSession.modeId,
        model: recoveredSession.model,
        parentSessionId: recoveredSession.parentSessionId,
        specialistId: recoveredSession.specialistId,
        createdAt: now,
        acpStatus: "ready" as const,
        ...refreshExecutionBinding(executionBinding),
      };
      store.upsertSession(sessionRecord);
      void persistSessionToDb({
        id: sessionId,
        name: recoveredSession.name,
        cwd,
        branch: recoveredSession.branch,
        workspaceId,
        routaAgentId: acpSessionId,
        provider,
        role,
        parentSessionId: recoveredSession.parentSessionId,
        modeId: recoveredSession.modeId,
        model: recoveredSession.model,
        specialistId: recoveredSession.specialistId,
        executionMode: sessionRecord.executionMode,
        ownerInstanceId: sessionRecord.ownerInstanceId,
        leaseExpiresAt: sessionRecord.leaseExpiresAt,
      });
      void updateSessionExecutionBindingInDb(sessionId, {
        executionMode: sessionRecord.executionMode,
        ownerInstanceId: sessionRecord.ownerInstanceId,
        leaseExpiresAt: sessionRecord.leaseExpiresAt,
      });

      return jsonrpcResponse(id ?? null, {
        sessionId,
        provider,
        role,
        acpStatus: "ready",
        resumeMode,
        resumeCapabilities: preset?.resume ?? { supported: false, mode: "replay" },
        ...(nativeResumeError ? { nativeResumeError } : {}),
      });
    }

    // ── session/cancel ─────────────────────────────────────────────────
    if (method === "session/respond_user_input") {
      const p = (params ?? {}) as Record<string, unknown>;
      const sessionId = p.sessionId as string | undefined;
      const toolCallId = p.toolCallId as string | undefined;
      const response = (typeof p.response === "object" && p.response !== null)
        ? p.response as Record<string, unknown>
        : undefined;

      if (!sessionId || !toolCallId || !response) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32602,
          message: "Missing sessionId, toolCallId, or response",
        });
      }

      const manager = getAcpProcessManager();
      const handled = manager.respondToUserInput(sessionId, toolCallId, response);
      if (!handled) {
        markMissingInteractiveRequestAsFailed(sessionId, toolCallId, response);
        return jsonrpcResponse(id ?? null, null, {
          code: -32000,
          message: "No pending interactive request found for this session",
        });
      }

      return jsonrpcResponse(id ?? null, { ok: true });
    }

    // ── session/cancel ─────────────────────────────────────────────────
    if (method === "session/cancel") {
      const p = (params ?? {}) as Record<string, unknown>;
      const sessionId = p.sessionId as string;

      if (sessionId) {
        const manager = getAcpProcessManager();
        const store = getHttpSessionStore();

        // Check if OpenCode SDK session
        if (manager.isOpencodeAdapterSession(sessionId)) {
          const opcAdapter = manager.getOpencodeAdapter(sessionId);
          if (opcAdapter) {
            opcAdapter.cancel();
          }
        }
        // Check if Docker OpenCode session
        else if (manager.isDockerAdapterSession(sessionId)) {
          const dockerAdapter = manager.getDockerAdapter(sessionId);
          if (dockerAdapter) {
            dockerAdapter.cancel();
          }
        }
        // Check if Claude Code SDK session
        else if (manager.isClaudeCodeSdkSession(sessionId)) {
          // Try to get existing adapter, or recreate for cancel (though cancel is less critical)
          const adapter = await manager.getOrRecreateClaudeCodeSdkAdapter(
            sessionId,
            createSessionUpdateForwarder(store, sessionId)
          );
          if (adapter) {
            adapter.cancel();
          }
        }
        // Check if Claude Code CLI session
        else if (manager.isClaudeSession(sessionId)) {
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

    // ── terminal/write ────────────────────────────────────────────────
    if (method === "terminal/write") {
      const p = (params ?? {}) as Record<string, unknown>;
      const sessionId = p.sessionId as string | undefined;
      const terminalId = p.terminalId as string | undefined;
      const data = p.data as string | undefined;
      if (!sessionId || !terminalId || typeof data !== "string") {
        return jsonrpcResponse(id ?? null, null, {
          code: -32602,
          message: "Missing sessionId, terminalId, or data",
        });
      }

      const terminalManager = getTerminalManager();
      if (!terminalManager.hasTerminal(sessionId, terminalId)) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32000,
          message: "Terminal not found for this session",
        });
      }

      try {
        terminalManager.write(terminalId, data);
        return jsonrpcResponse(id ?? null, { ok: true });
      } catch (err) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32000,
          message: err instanceof Error ? err.message : "Failed to write terminal input",
        });
      }
    }

    // ── terminal/resize ───────────────────────────────────────────────
    if (method === "terminal/resize") {
      const p = (params ?? {}) as Record<string, unknown>;
      const sessionId = p.sessionId as string | undefined;
      const terminalId = p.terminalId as string | undefined;
      const cols = typeof p.cols === "number" ? p.cols : undefined;
      const rows = typeof p.rows === "number" ? p.rows : undefined;
      if (!sessionId || !terminalId) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32602,
          message: "Missing sessionId or terminalId",
        });
      }

      const terminalManager = getTerminalManager();
      if (!terminalManager.hasTerminal(sessionId, terminalId)) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32000,
          message: "Terminal not found for this session",
        });
      }

      try {
        terminalManager.resize(terminalId, cols, rows);
        return jsonrpcResponse(id ?? null, { ok: true });
      } catch (err) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32000,
          message: err instanceof Error ? err.message : "Failed to resize terminal",
        });
      }
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

      // Merge registry agents (including those that overlap with static presets)
      // For overlapping agents, use a different ID to allow both versions to coexist
      const staticIds = new Set(staticProviders.map((p) => p.id));
      try {
        const registry = await fetchRegistry();
        const npxPath = await which("npx");
        const uvxPath = await which("uv");
        const platform = detectPlatformTarget();

        for (const agent of registry.agents) {
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

          // If this agent ID conflicts with a built-in preset, use a suffixed ID
          // to allow both versions to coexist in the UI
          const providerId = staticIds.has(agent.id) ? `${agent.id}-registry` : agent.id;
          const providerName = staticIds.has(agent.id) ? `${agent.name} (Registry)` : agent.name;

          staticProviders.push({
            id: providerId,
            name: providerName,
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

      // Add OpenCode SDK as a provider option (available in any environment when configured)
      {
        const sdkConfigured = isOpencodeServerConfigured();
        providers.unshift({
          id: "opencode-sdk",
          name: "OpenCode SDK",
          description: sdkConfigured
            ? "OpenCode via SDK (configured)"
            : "OpenCode SDK (set OPENCODE_SERVER_URL or OPENCODE_API_KEY)",
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
    if (isAcpErrorLike(error)) {
      return jsonrpcResponse(null, null, {
        code: error.code,
        message: error.message,
        authMethods: error.authMethods,
        agentInfo: error.agentInfo,
        data: {
          method: requestMethod,
          requestId,
          errorName: error.name,
          errorMessage: error.message,
          errorData: error.data,
        },
      });
    }

    return jsonrpcResponse(null, null, {
      code: -32603,
      message: error instanceof Error ? error.message : "Internal error",
      data: error instanceof Error
        ? {
          method: requestMethod,
          requestId,
          errorName: error.name,
          errorMessage: error.message,
        }
        : {
          method: requestMethod,
          requestId,
          errorMessage: "Internal error",
        },
    });
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

interface JsonRpcError {
  code: number;
  message: string;
  data?: Record<string, unknown>;
  authMethods?: Array<{ id: string; name: string; description: string }>;
  agentInfo?: { name: string; version: string };
  /** Optional flag indicating the session may continue processing despite this error */
  sessionMayContinue?: boolean;
}

function createSessionUpdateForwarder(
  store: ReturnType<typeof getHttpSessionStore>,
  sessionId: string,
) {
  return (msg: { method?: string; params?: Record<string, unknown> }) => {
    if (msg.method !== "session/update" || !msg.params) return;

    const params = msg.params as Record<string, unknown>;
    const notification = {
      ...params,
      sessionId,
    } as SessionUpdateNotification;

    const renamedTitle = extractSetAgentNameTitle(notification);
    if (renamedTitle) {
      void renameSessionFromToolCall(store, sessionId, renamedTitle);
    }

    store.pushNotification(notification);
  };
}

function extractSetAgentNameTitle(notification: SessionUpdateNotification): string | undefined {
  const update = notification.update as Record<string, unknown> | undefined;
  if (!update) return undefined;

  const sessionUpdate = update.sessionUpdate as string | undefined;
  if (!sessionUpdate || !sessionUpdate.startsWith("tool_call")) return undefined;

  const candidates = [
    update.kind,
    update.title,
    update.toolName,
  ]
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.toLowerCase());

  // Case 1: Direct set_agent_name tool call
  const isSetAgentNameCall = candidates.some((c) =>
    c.includes("set_agent_name") || c.includes("set agent name")
  );
  if (isSetAgentNameCall) {
    const rawInput =
      typeof update.rawInput === "object" && update.rawInput !== null
        ? (update.rawInput as Record<string, unknown>)
        : undefined;
    const rawName = rawInput?.name;
    if (typeof rawName !== "string") return undefined;
    return normalizeAgentSessionTitle(rawName);
  }

  // Case 2: Bash fallback — Claude Code SDK agent uses Bash echo when
  // set_agent_name tool isn't available in its built-in tool set.
  // Detect patterns like: echo "Agent name: My Cool Agent"
  const isBashCall = candidates.some((c) => c === "bash");
  if (isBashCall) {
    const rawInput =
      typeof update.rawInput === "object" && update.rawInput !== null
        ? (update.rawInput as Record<string, unknown>)
        : undefined;
    if (rawInput) {
      const command = rawInput.command as string | undefined;
      if (typeof command === "string") {
        const bashName = extractAgentNameFromBashCommand(command);
        if (bashName) return normalizeAgentSessionTitle(bashName);
      }
      // Also check description for naming intent (e.g. "Set agent name identity")
      const description = rawInput.description as string | undefined;
      if (typeof description === "string" && typeof command === "string") {
        const descLower = description.toLowerCase();
        if (descLower.includes("agent name") || descLower.includes("set_agent_name") || descLower.includes("name identity")) {
          const echoMatch = command.match(/echo\s+["']?(.+?)["']?\s*$/i);
          if (echoMatch) {
            const cleaned = echoMatch[1]
              .replace(/["'\\]/g, "")
              .replace(/^Agent\s*name:\s*/i, "")
              .replace(/^set_agent_name:\s*/i, "")
              .trim();
            if (cleaned) return normalizeAgentSessionTitle(cleaned);
          }
        }
      }
    }
  }

  return undefined;
}

/**
 * Extract agent name from a Bash echo command.
 * Handles patterns like:
 *   echo "Agent name: My Cool Agent"
 *   echo 'Agent name: My Cool Agent'
 *   echo "set_agent_name: My Cool Agent"
 */
function extractAgentNameFromBashCommand(command: string): string | null {
  const patterns = [
    /echo\s+["']?Agent\s*name:\s*(.+?)["']?\s*$/i,
    /echo\s+["']?set_agent_name:\s*(.+?)["']?\s*$/i,
    /echo\s+["']?Agent:\s*(.+?)["']?\s*$/i,
  ];
  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match?.[1]) {
      const name = match[1].replace(/["'\\]/g, "").trim();
      if (name) return name;
    }
  }
  return null;
}

function normalizeAgentSessionTitle(rawName: string): string | undefined {
  const trimmed = rawName.trim().replace(/\s+/g, " ");
  if (!trimmed) return undefined;

  const words = trimmed.split(" ").slice(0, 5);
  const normalized = words.join(" ").slice(0, 80).trim();
  return normalized || undefined;
}

async function renameSessionFromToolCall(
  store: ReturnType<typeof getHttpSessionStore>,
  sessionId: string,
  name: string,
): Promise<void> {
  const existing = store.getSession(sessionId);
  if (!existing) return;
  if (existing.name === name) return;

  const renamed = store.renameSession(sessionId, name);
  if (!renamed) return;

  await renameSessionInDb(sessionId, name);

  store.pushNotification({
    sessionId,
    update: {
      sessionUpdate: "session_renamed",
      name,
    },
  });
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
async function buildMcpConfigForClaude(
  workspaceId?: string,
  sessionId?: string,
  toolMode?: "essential" | "full",
  mcpProfile?: McpServerProfile,
): Promise<string[]> {
  // Keep Claude MCP setup consistent with all other providers.
  // Pass workspace ID and session ID so they're embedded in the MCP endpoint URL
  // (?wsId=...&sid=...) allowing the MCP server to scope notes to the correct session.
  const config = workspaceId
    ? getDefaultRoutaMcpConfig(workspaceId, sessionId, toolMode, mcpProfile)
    : undefined;
  const result = await ensureMcpForProvider("claude", config);
  console.log(`[ACP Route] MCP config for Claude Code: ${result.summary}`);
  return result.mcpConfigs;
}
