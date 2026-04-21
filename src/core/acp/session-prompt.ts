import { getHttpSessionStore, type SessionUpdateNotification } from "@/core/acp/http-session-store";
import { getPresetById } from "@/core/acp/acp-presets";
import { isServerlessEnvironment } from "@/core/acp/api-based-providers";
import { getDockerDetector } from "@/core/acp/docker/detector";
import { DEFAULT_DOCKER_AGENT_IMAGE } from "@/core/acp/docker/utils";
import { AgentRole } from "@/core/models/agent";
import { consumeAcpPromptResponse } from "@/core/acp/prompt-response";
import { buildCoordinatorPrompt } from "@/core/orchestration/specialist-prompts";
import {
  createTraceRecord,
  withWorkspaceId,
  withMetadata,
  recordTrace,
} from "@/core/trace";
import {
  loadSessionFromDb,
  loadSessionFromLocalStorage,
  persistSessionToDb,
  updateSessionExecutionBindingInDb,
} from "@/core/acp/session-db-persister";
import { resolveSkillContent } from "@/core/skills/skill-resolver";
import {
  buildExecutionBinding,
  getEmbeddedOwnershipIssue,
  refreshExecutionBinding,
} from "@/core/acp/execution-backend";
import type { McpServerProfile } from "@/core/mcp/mcp-server-profiles";
import { pendingAcpCreations } from "@/core/acp/pending-acp-creations";
import { persistSessionHistorySnapshot } from "@/core/acp/session-history";

type JsonRpcResponseFactory = (
  id: string | number | null,
  result: unknown,
  error?: { code: number; message: string; data?: Record<string, unknown> }
) => Response;

type SessionUpdateForwarderFactory = (
  store: ReturnType<typeof getHttpSessionStore>,
  sessionId: string,
) => (msg: { method?: string; params?: Record<string, unknown> }) => void;

type ClaudeMcpConfigBuilder = (
  workspaceId?: string,
  sessionId?: string,
  toolMode?: "essential" | "full",
  mcpProfile?: McpServerProfile,
) => Promise<string[]>;

type WorkspaceIdResolver = (value: unknown) => string | null;
type SsePayloadEncoder = (payload: unknown) => string;

interface DispatchSessionPromptParams {
  sessionId: string;
  prompt: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  workspaceId?: string;
  provider?: string;
  cwd?: string;
  skillName?: string;
  skillContent?: string;
}

type AcpErrorLike = Error & {
  code: number;
  authMethods?: unknown;
  agentInfo?: unknown;
  data?: unknown;
};

function inlineJsonrpcResponse(
  id: string | number | null,
  result: unknown,
  error?: { code: number; message: string; data?: Record<string, unknown> },
): Response {
  const body = error
    ? { jsonrpc: "2.0", id, error }
    : { jsonrpc: "2.0", id, result };
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

function inlineRequireWorkspaceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function inlineEncodeSsePayload(payload: unknown): string {
  const params = typeof payload === "object" && payload !== null
    ? (payload as { params?: { eventId?: string } }).params
    : undefined;
  const eventId = typeof params?.eventId === "string" ? params.eventId : undefined;
  return `${eventId ? `id: ${eventId}\n` : ""}data: ${JSON.stringify(payload)}\n\n`;
}

function inlineCreateSessionUpdateForwarder(
  store: ReturnType<typeof getHttpSessionStore>,
  sessionId: string,
): (msg: { method?: string; params?: Record<string, unknown> }) => void {
  return (msg) => {
    if (msg.method !== "session/update" || !msg.params) return;
    store.pushNotification({
      ...msg.params,
      sessionId,
    } as SessionUpdateNotification);
  };
}

async function inlineBuildMcpConfigForClaude(
  workspaceId?: string,
  sessionId?: string,
  toolMode?: "essential" | "full",
  mcpProfile?: McpServerProfile,
): Promise<string[]> {
  const [
    { getDefaultRoutaMcpConfig },
    { ensureMcpForProvider },
  ] = await Promise.all([
    import("@/core/acp/mcp-config-generator"),
    import("@/core/acp/mcp-setup"),
  ]);
  const config = workspaceId
    ? getDefaultRoutaMcpConfig(workspaceId, sessionId, toolMode, mcpProfile)
    : undefined;
  const result = await ensureMcpForProvider("claude", config);
  return result.mcpConfigs;
}

function markSessionPromptError(
  store: ReturnType<typeof getHttpSessionStore>,
  sessionId: string,
  error: unknown,
  fallbackMessage: string,
): string {
  const message = error instanceof Error ? error.message : fallbackMessage;
  store.updateSessionAcpStatus(sessionId, "error", message);
  return message;
}

export function isSessionPromptTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes("Timeout waiting for session/prompt");
}

function getPromptErrorData(error: unknown): Record<string, unknown> | undefined {
  if (isAcpErrorLike(error)) {
    return {
      source: "acp",
      code: error.code,
      authMethods: error.authMethods,
      agentInfo: error.agentInfo,
      data: error.data,
    };
  }
  if (error instanceof Error) {
    return {
      source: "app",
      errorName: error.name,
      errorMessage: error.message,
    };
  }
  return undefined;
}

function isAcpErrorLike(error: unknown): error is AcpErrorLike {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Record<string, unknown>;
  return candidate.name === "AcpError"
    && typeof candidate.message === "string"
    && typeof candidate.code === "number";
}

function buildCoordinatorContextPrompt(input: {
  agentId: string;
  workspaceId: string;
  userRequest: string;
}): string {
  return `**Your Agent ID:** ${input.agentId}\n`
    + `**Workspace ID:** ${input.workspaceId}\n\n`
    + `## User Request\n\n${input.userRequest}\n`;
}

function buildTeamLeadFirstTurnContract(): string {
  return [
    "## First-Turn Operating Contract",
    "",
    "You are the team lead for a live Team Run.",
    "",
    "On your first working turn:",
    "1. Do not browse the repository yourself with read/glob/grep/search tools.",
    "2. Keep the active wave small. Spawn at most 3 real child sessions at once.",
    "3. Do not create placeholder teammates or idle agents just to mirror the roster.",
    "4. If codebase context is unknown, your first action must be `create_task` plus `delegate_task_to_agent` for a real `researcher` child session.",
    "5. After delegating, stop and wait for child updates unless the user must answer a blocking question.",
    "6. Never create teammate-specific specialist files like `frontend-dev-lee.yaml` or `backend-dev-bill.yaml`.",
    "7. The team specialist catalog is one canonical file per role under `resources/specialists/team/`.",
    "8. Teammate names belong in roster text, prompts, or runtime labels, not in new YAML filenames or specialist ids.",
    "",
    "Use Team UI motion as the source of truth: visible child sessions first, lead-side exploration later.",
  ].join("\n");
}

function buildCoordinatorFirstPrompt(input: {
  agentId: string;
  workspaceId: string;
  userRequest: string;
  specialistId?: string;
  specialistSystemPrompt?: string;
  provider?: string;
}): string {
  const contextPrompt = buildCoordinatorContextPrompt({
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    userRequest: input.userRequest,
  });
  const teamLeadFirstTurnContract = input.specialistId === "team-agent-lead"
    ? `\n\n---\n\n${buildTeamLeadFirstTurnContract()}`
    : "";

  if (input.provider === "claude-code-sdk" && input.specialistSystemPrompt) {
    return `${contextPrompt}${teamLeadFirstTurnContract}`;
  }

  if (input.specialistSystemPrompt) {
    return `${input.specialistSystemPrompt}\n\n---\n\n${contextPrompt}${teamLeadFirstTurnContract}`;
  }

  return `${buildCoordinatorPrompt({
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    userRequest: input.userRequest,
  })}${teamLeadFirstTurnContract}`;
}

async function ensurePromptSessionExists(args: {
  id: string | number | null;
  params: Record<string, unknown>;
  sessionId: string;
  jsonrpcResponse: JsonRpcResponseFactory;
  createSessionUpdateForwarder: SessionUpdateForwarderFactory;
  buildMcpConfigForClaude: ClaudeMcpConfigBuilder;
  requireWorkspaceId: WorkspaceIdResolver;
}): Promise<Response | null> {
  const {
    id,
    params,
    sessionId,
    jsonrpcResponse,
    createSessionUpdateForwarder,
    buildMcpConfigForClaude,
    requireWorkspaceId,
  } = args;
  const { getAcpProcessManager } = await import("@/core/acp/processer");
  const manager = getAcpProcessManager();
  const store = getHttpSessionStore();
  const forwardSessionUpdate = createSessionUpdateForwarder(store, sessionId);

  const sessionExists =
    manager.hasActiveSession(sessionId);

  if (sessionExists) {
    return null;
  }

  console.log(`[ACP Route] Session ${sessionId} not found, auto-creating with default settings...`);

  const storedSession = store.getSession(sessionId);
  const persistedSession =
    storedSession
      ? null
      : (await loadSessionFromDb(sessionId)) ?? (await loadSessionFromLocalStorage(sessionId));
  const recoveredSession = storedSession ?? persistedSession ?? undefined;
  const ownershipIssue = getEmbeddedOwnershipIssue(recoveredSession);
  if (ownershipIssue) {
    return jsonrpcResponse(id ?? null, null, {
      code: -32010,
      message: ownershipIssue,
      data: {
        source: "app",
        sessionId,
      },
    });
  }

  const cwd = recoveredSession?.cwd ?? (params.cwd as string | undefined) ?? process.cwd();
  const defaultProvider = isServerlessEnvironment() ? "claude-code-sdk" : "opencode";
  const provider = (params.provider as string | undefined) ?? recoveredSession?.provider ?? defaultProvider;
  const workspaceId = requireWorkspaceId(params.workspaceId) ?? recoveredSession?.workspaceId;
  if (!workspaceId) {
    return jsonrpcResponse(id ?? null, null, {
      code: -32602,
      message: "workspaceId is required to recreate the session",
    });
  }
  const role = recoveredSession?.role ?? "CRAFTER";
  const toolMode = storedSession?.toolMode;
  const mcpProfile = storedSession?.mcpProfile;
  const allowedNativeTools = storedSession?.allowedNativeTools;
  const specialistId = recoveredSession?.specialistId;
  const specialistSystemPrompt = storedSession?.specialistSystemPrompt;
  const providerSessionId = recoveredSession?.routaAgentId ?? sessionId;

  try {
    const preset = getPresetById(provider);
    const isClaudeCode = preset?.nonStandardApi === true || provider === "claude";
    const isClaudeCodeSdk = provider === "claude-code-sdk";
    const isOpencodeSdk = provider === "opencode-sdk";
    const isDockerOpenCode = provider === "docker-opencode";
    const isCodex = provider === "codex";

    let acpSessionId: string;

    if (isOpencodeSdk) {
      const { isOpencodeServerConfigured } = await import("@/core/acp/opencode-sdk-adapter");
      if (!isOpencodeServerConfigured()) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32002,
          message: "Cannot auto-create session: OpenCode SDK not configured. Set OPENCODE_SERVER_URL environment variable.",
        });
      }

      acpSessionId = await manager.createOpencodeSdkSession(
        sessionId,
        forwardSessionUpdate,
      );
    } else if (isDockerOpenCode) {
      const dockerStatus = await getDockerDetector().checkAvailability();
      if (!dockerStatus.available) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32003,
          message: dockerStatus.error
            ? `Cannot auto-create Docker session: ${dockerStatus.error}`
            : "Cannot auto-create Docker session: Docker daemon unavailable.",
        });
      }

      const authJson = (params.authJson as string | undefined);
      acpSessionId = await manager.createDockerSession(
        sessionId,
        cwd,
        forwardSessionUpdate,
        process.env.ROUTA_DOCKER_OPENCODE_IMAGE ?? DEFAULT_DOCKER_AGENT_IMAGE,
        undefined,
        authJson,
      );
    } else if (isClaudeCodeSdk) {
      const { isClaudeCodeSdkConfigured } = await import("@/core/acp/claude-code-sdk-adapter");
      if (!isClaudeCodeSdkConfigured()) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32002,
          message: "Cannot auto-create session: Claude Code SDK not configured. Set ANTHROPIC_AUTH_TOKEN environment variable.",
        });
      }

      acpSessionId = await manager.createClaudeCodeSdkSession(
        sessionId,
        cwd,
        forwardSessionUpdate,
        {
          provider: "claude-code-sdk",
          role,
          specialistId,
          model: storedSession?.model,
          allowedNativeTools,
          systemPromptAppend: specialistSystemPrompt,
        },
      );
    } else if (isClaudeCode) {
      const mcpConfigs = await buildMcpConfigForClaude(workspaceId, sessionId, toolMode, mcpProfile);
      acpSessionId = await manager.createClaudeSession(
        sessionId,
        cwd,
        forwardSessionUpdate,
        mcpConfigs,
        undefined,
        role,
        undefined,
        allowedNativeTools,
      );
    } else if (isCodex) {
      try {
        acpSessionId = await manager.loadSession(
          sessionId,
          cwd,
          forwardSessionUpdate,
          "codex",
          workspaceId,
          toolMode,
          mcpProfile,
          {
            provider,
            role,
          },
          providerSessionId,
        );
        console.log(`[ACP Route] Native Codex resume succeeded for session ${sessionId}`);
      } catch (resumeError) {
        console.warn(`[ACP Route] Native Codex resume failed for ${sessionId}, falling back to recreate:`, resumeError);
        acpSessionId = await manager.createSession(
          sessionId,
          cwd,
          forwardSessionUpdate,
          provider,
          undefined,
          undefined,
          undefined,
          workspaceId,
          toolMode,
          mcpProfile,
          {
            provider,
            role,
          },
        );
      }
    } else {
      acpSessionId = await manager.createSession(
        sessionId,
        cwd,
        forwardSessionUpdate,
        provider,
        undefined,
        undefined,
        undefined,
        workspaceId,
        toolMode,
        mcpProfile,
        {
          provider,
          role,
        },
      );
    }

    const now = new Date();
    const executionBinding = buildExecutionBinding("embedded");
    store.upsertSession({
      sessionId,
      cwd,
      workspaceId,
      routaAgentId: acpSessionId,
      provider,
      role,
      toolMode,
      mcpProfile,
      allowedNativeTools,
      specialistId,
      specialistSystemPrompt,
      createdAt: now.toISOString(),
      ...executionBinding,
    });

    await persistSessionToDb({
      id: sessionId,
      cwd,
      workspaceId,
      routaAgentId: acpSessionId,
      provider,
      role,
      specialistId: specialistId ?? undefined,
      ...executionBinding,
    });

    console.log(`[ACP Route] Auto-created session: ${sessionId} (provider: ${provider}, agent session: ${acpSessionId})`);

    const sessionStartTrace = withMetadata(
      withMetadata(
        withWorkspaceId(
          createTraceRecord(sessionId, "session_start", { provider }),
          workspaceId,
        ),
        "cwd",
        cwd,
      ),
      "role",
      role,
    );
    recordTrace(cwd, sessionStartTrace);
    return null;
  } catch (err) {
    console.error("[ACP Route] Failed to auto-create session:", err);
    return jsonrpcResponse(id ?? null, null, {
      code: -32000,
      message: `Failed to auto-create session: ${err instanceof Error ? err.message : "Unknown error"}`,
    });
  }
}

function createStreamingSseResponse(args: {
  sessionId: string;
  store: ReturnType<typeof getHttpSessionStore>;
  run: (controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder) => Promise<void>;
}): Response {
  const { sessionId, store, run } = args;
  store.enterStreamingMode(sessionId);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Emit an initial comment frame so proxies/clients start consuming the stream early.
      controller.enqueue(encoder.encode(": stream-open\n\n"));

      // Do not await the long-running prompt stream in `start()`.
      // Keeping start non-blocking avoids buffering the whole SSE response.
      void run(controller, encoder).catch((err) => {
        console.error(`[ACP Route] Streaming run failed for session ${sessionId}:`, err);
        try {
          controller.error(err);
        } catch {
          // Stream already closed by the producer path.
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

interface HandleSessionPromptArgs {
  id: string | number | null;
  params: Record<string, unknown>;
  jsonrpcResponse: JsonRpcResponseFactory;
  createSessionUpdateForwarder: SessionUpdateForwarderFactory;
  buildMcpConfigForClaude: ClaudeMcpConfigBuilder;
  requireWorkspaceId: WorkspaceIdResolver;
  encodeSsePayload: SsePayloadEncoder;
}

export async function handleSessionPrompt({
  id,
  params,
  jsonrpcResponse,
  createSessionUpdateForwarder,
  buildMcpConfigForClaude,
  requireWorkspaceId,
  encodeSsePayload,
}: HandleSessionPromptArgs): Promise<Response> {
  const p = params;
  const sessionId = p.sessionId as string;

  if (!sessionId) {
    return jsonrpcResponse(id ?? null, null, {
      code: -32602,
      message: "Missing sessionId",
    });
  }

  const { getAcpProcessManager } = await import("@/core/acp/processer");
  const manager = getAcpProcessManager();
  const store = getHttpSessionStore();
  const forwardSessionUpdate = createSessionUpdateForwarder(store, sessionId);

  const rawPrompt = p.prompt;
  let promptText = "";
  if (typeof rawPrompt === "string") {
    promptText = rawPrompt;
  } else if (Array.isArray(rawPrompt)) {
    const promptBlocks = rawPrompt as Array<{ type: string; text?: string }>;
    promptText = promptBlocks
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");
  }

  const skillName = p.skillName as string | undefined;
  let skillContent = p.skillContent as string | undefined;
  if (skillName && !skillContent) {
    const cwd = (p.cwd as string | undefined) ?? process.cwd();
    console.log(`[ACP Route] Loading skill content for: ${skillName}`);
    skillContent = await resolveSkillContent(skillName, cwd);
    if (!skillContent) {
      console.warn(`[ACP Route] Could not load skill content for: ${skillName}, proceeding without skill`);
    }
  }

  const pendingCreation = pendingAcpCreations.get(sessionId);
  if (pendingCreation) {
    console.log(`[ACP Route] Waiting for pending ACP creation for session ${sessionId}...`);
    await pendingCreation;
  }

  const autoCreateResponse = await ensurePromptSessionExists({
    id,
    params: p,
    sessionId,
    jsonrpcResponse,
    createSessionUpdateForwarder,
    buildMcpConfigForClaude,
    requireWorkspaceId,
  });
  if (autoCreateResponse) {
    return autoCreateResponse;
  }

  const visiblePromptText = promptText;

  const activeSessionRecord = store.getSession(sessionId);
  if (activeSessionRecord?.executionMode) {
    const refreshedBinding = refreshExecutionBinding(activeSessionRecord);
    store.upsertSession(refreshedBinding);
    void updateSessionExecutionBindingInDb(sessionId, {
      executionMode: refreshedBinding.executionMode,
      ownerInstanceId: refreshedBinding.ownerInstanceId,
      leaseExpiresAt: refreshedBinding.leaseExpiresAt,
    });
  }

  const { getRoutaOrchestrator } = await import("@/core/orchestration/orchestrator-singleton");
  const orchestrator = getRoutaOrchestrator();
  if (orchestrator) {
    const sessionRecord = store.getSession(sessionId);
    if (sessionRecord?.routaAgentId) {
      const { getRoutaSystem } = await import("@/core/routa-system");
      const system = getRoutaSystem();
      const agent = await system.agentStore.get(sessionRecord.routaAgentId);
      if (agent?.role === AgentRole.ROUTA) {
        const isFirstPrompt = !sessionRecord.firstPromptSent;
        if (isFirstPrompt) {
          promptText = buildCoordinatorFirstPrompt({
            agentId: agent.id,
            workspaceId: sessionRecord.workspaceId,
            userRequest: promptText,
            specialistId: sessionRecord.specialistId,
            specialistSystemPrompt: sessionRecord.specialistSystemPrompt,
            provider: sessionRecord.provider,
          });
          store.markFirstPromptSent(sessionId);
        }
      }
    }
  }

  {
    const sessionRecord = store.getSession(sessionId);
    if (sessionRecord?.specialistSystemPrompt && !sessionRecord.firstPromptSent) {
      promptText = sessionRecord.provider === "claude-code-sdk"
        ? promptText
        : `${sessionRecord.specialistSystemPrompt}\n\n---\n\n${promptText}`;
      store.markFirstPromptSent(sessionId);
      console.log(
        `[ACP Route] Injected specialist systemPrompt for ${sessionRecord.specialistId} into session ${sessionId}`,
      );
    }
  }

  store.pushUserMessage(sessionId, visiblePromptText);
  await persistSessionHistorySnapshot(sessionId, store);
  const sessionRecord = store.getSession(sessionId);

  if (manager.isOpencodeAdapterSession(sessionId) || await manager.isOpencodeSdkSessionAsync(sessionId)) {
    const opcAdapter = await manager.getOrRecreateOpencodeSdkAdapter(
      sessionId,
      forwardSessionUpdate,
    );

    if (!opcAdapter) {
      return jsonrpcResponse(id ?? null, null, {
        code: -32000,
        message: `No OpenCode SDK adapter for session: ${sessionId}`,
      });
    }

    if (!opcAdapter.alive) {
      return jsonrpcResponse(id ?? null, null, {
        code: -32000,
        message: "OpenCode SDK adapter is not connected",
      });
    }

    return createStreamingSseResponse({
      sessionId,
      store,
      run: async (controller, encoder) => {
        try {
          for await (const event of opcAdapter.promptStream(promptText, sessionId, skillContent, sessionRecord?.workspaceId ?? undefined)) {
            controller.enqueue(encoder.encode(event));
          }
          store.flushAgentBuffer(sessionId);
          store.exitStreamingMode(sessionId);
          await persistSessionHistorySnapshot(sessionId, store);
          controller.close();
        } catch (err) {
          if (isSessionPromptTimeoutError(err)) {
            console.warn(
              `[ACP Route] session/prompt timed out while waiting for ${sessionId}; keeping ACP session alive for continued lifecycle updates.`,
              err,
            );
            store.flushAgentBuffer(sessionId);
            store.exitStreamingMode(sessionId);
            await persistSessionHistorySnapshot(sessionId, store);
            controller.close();
            return;
          }
          const message = markSessionPromptError(store, sessionId, err, "OpenCode SDK prompt failed");
          store.flushAgentBuffer(sessionId);
          store.exitStreamingMode(sessionId);
          await persistSessionHistorySnapshot(sessionId, store);
          controller.enqueue(encoder.encode(encodeSsePayload({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId,
              type: "error",
              error: { message },
            },
          })));
          controller.close();
        }
      },
    });
  }

  if (manager.isDockerAdapterSession(sessionId)) {
    const dockerAdapter = manager.getDockerAdapter(sessionId);
    if (!dockerAdapter) {
      return jsonrpcResponse(id ?? null, null, {
        code: -32000,
        message: `No Docker OpenCode adapter for session: ${sessionId}`,
      });
    }

    if (!dockerAdapter.alive) {
      return jsonrpcResponse(id ?? null, null, {
        code: -32000,
        message: "Docker OpenCode adapter is not connected",
      });
    }

    return createStreamingSseResponse({
      sessionId,
      store,
      run: async (controller, encoder) => {
        try {
          for await (const event of dockerAdapter.promptStream(
            promptText,
            sessionId,
            skillContent,
            sessionRecord?.workspaceId ?? undefined,
          )) {
            controller.enqueue(encoder.encode(event));
          }
          store.flushAgentBuffer(sessionId);
          store.exitStreamingMode(sessionId);
          await persistSessionHistorySnapshot(sessionId, store);
          controller.close();
        } catch (err) {
          if (isSessionPromptTimeoutError(err)) {
            console.warn(
              `[ACP Route] session/prompt timed out while waiting for ${sessionId}; keeping ACP session alive for continued lifecycle updates.`,
              err,
            );
            store.flushAgentBuffer(sessionId);
            store.exitStreamingMode(sessionId);
            await persistSessionHistorySnapshot(sessionId, store);
            controller.close();
            return;
          }
          const message = markSessionPromptError(store, sessionId, err, "Docker OpenCode prompt failed");
          store.flushAgentBuffer(sessionId);
          store.exitStreamingMode(sessionId);
          await persistSessionHistorySnapshot(sessionId, store);
          controller.enqueue(encoder.encode(encodeSsePayload({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId,
              type: "error",
              error: { message },
            },
          })));
          controller.close();
        }
      },
    });
  }

  if (await manager.isClaudeCodeSdkSessionAsync(sessionId)) {
    const adapter = await manager.getOrRecreateClaudeCodeSdkAdapter(
      sessionId,
      forwardSessionUpdate,
    );

    if (!adapter) {
      return jsonrpcResponse(id ?? null, null, {
        code: -32000,
        message: `No Claude Code SDK adapter for session: ${sessionId}`,
      });
    }

    if (!adapter.alive) {
      return jsonrpcResponse(id ?? null, null, {
        code: -32000,
        message: "Claude Code SDK adapter is not connected",
      });
    }

    return createStreamingSseResponse({
      sessionId,
      store,
      run: async (controller, encoder) => {
        try {
          for await (const event of adapter.promptStream(promptText, sessionId, skillContent)) {
            controller.enqueue(encoder.encode(event));
          }
          store.flushAgentBuffer(sessionId);
          store.exitStreamingMode(sessionId);
          await persistSessionHistorySnapshot(sessionId, store);
          controller.close();
        } catch (err) {
          if (isSessionPromptTimeoutError(err)) {
            console.warn(
              `[ACP Route] session/prompt timed out while waiting for ${sessionId}; keeping ACP session alive for continued lifecycle updates.`,
              err,
            );
            store.flushAgentBuffer(sessionId);
            store.exitStreamingMode(sessionId);
            await persistSessionHistorySnapshot(sessionId, store);
            controller.close();
            return;
          }
          const message = markSessionPromptError(store, sessionId, err, "Claude Code SDK prompt failed");
          store.flushAgentBuffer(sessionId);
          store.exitStreamingMode(sessionId);
          await persistSessionHistorySnapshot(sessionId, store);
          controller.enqueue(encoder.encode(encodeSsePayload({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId,
              type: "error",
              error: { message },
            },
          })));
          controller.close();
        }
      },
    });
  }

  if (manager.isClaudeSession(sessionId)) {
    const claudeProc = manager.getClaudeProcess(sessionId);
    if (!claudeProc) {
      return jsonrpcResponse(id ?? null, null, {
        code: -32000,
        message: `No Claude Code process for session: ${sessionId}`,
      });
    }

    if (!claudeProc.alive) {
      console.warn(`[ACP Route] Claude Code process for session ${sessionId} is dead — attempting restart`);
      await manager.killSession(sessionId);
      const restartRecord = store.getSession(sessionId);
      if (!restartRecord) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32000,
          message: `Session ${sessionId} not found in store — cannot restart`,
        });
      }
      const restartCwd = restartRecord.cwd ?? process.cwd();
      const restartWorkspaceId = restartRecord.workspaceId;
      if (!restartWorkspaceId) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32602,
          message: "workspaceId is missing for session restart",
        });
      }
      const restartRole = restartRecord.role ?? "CRAFTER";
      const restartToolMode = restartRecord.toolMode;
      const restartMcpProfile = restartRecord.mcpProfile;
      const restartAllowedNativeTools = restartRecord.allowedNativeTools;
      try {
        const mcpConfigs = await buildMcpConfigForClaude(
          restartWorkspaceId,
          sessionId,
          restartToolMode,
          restartMcpProfile,
        );
        await manager.createClaudeSession(
          sessionId,
          restartCwd,
          forwardSessionUpdate,
          mcpConfigs,
          undefined,
          restartRole,
          undefined,
          restartAllowedNativeTools,
        );
        console.log(`[ACP Route] Restarted Claude Code process for session ${sessionId}`);
      } catch (restartErr) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32000,
          message: `Failed to restart Claude Code process: ${restartErr instanceof Error ? restartErr.message : String(restartErr)}`,
        });
      }
      const restarted = manager.getClaudeProcess(sessionId);
      if (!restarted) {
        return jsonrpcResponse(id ?? null, null, {
          code: -32000,
          message: "Claude Code process restart failed unexpectedly",
        });
      }
      try {
        const result = await restarted.prompt(sessionId, promptText);
        store.flushAgentBuffer(sessionId);
        void persistSessionHistorySnapshot(sessionId, store);
        return jsonrpcResponse(id ?? null, result);
      } catch (err) {
        if (isSessionPromptTimeoutError(err)) {
          console.warn(
            `[ACP Route] session/prompt timed out while waiting for ${sessionId}; keeping ACP session alive for continued lifecycle updates.`,
            err,
          );
          store.flushAgentBuffer(sessionId);
          void persistSessionHistorySnapshot(sessionId, store);
          return jsonrpcResponse(id ?? null, { sessionId, pending: true });
        }
        const message = markSessionPromptError(store, sessionId, err, "Claude Code prompt failed after restart");
        store.flushAgentBuffer(sessionId);
        void persistSessionHistorySnapshot(sessionId, store);
        return jsonrpcResponse(id ?? null, null, {
          code: -32000,
          message,
          data: getPromptErrorData(err),
        });
      }
    }

    try {
      const result = await claudeProc.prompt(sessionId, promptText);
      store.flushAgentBuffer(sessionId);
      void persistSessionHistorySnapshot(sessionId, store);
      return jsonrpcResponse(id ?? null, result);
    } catch (err) {
      if (isSessionPromptTimeoutError(err)) {
        console.warn(
          `[ACP Route] session/prompt timed out while waiting for ${sessionId}; keeping ACP session alive for continued lifecycle updates.`,
          err,
        );
        store.flushAgentBuffer(sessionId);
        void persistSessionHistorySnapshot(sessionId, store);
        return jsonrpcResponse(id ?? null, { sessionId, pending: true });
      }
      const message = markSessionPromptError(store, sessionId, err, "Claude Code prompt failed");
      store.flushAgentBuffer(sessionId);
      void persistSessionHistorySnapshot(sessionId, store);
      return jsonrpcResponse(id ?? null, null, {
        code: -32000,
        message,
        data: getPromptErrorData(err),
      });
    }
  }

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
    const result = await proc.prompt(acpSessionId, promptText);
    store.flushAgentBuffer(sessionId);
    void persistSessionHistorySnapshot(sessionId, store);
    return jsonrpcResponse(id ?? null, result);
  } catch (err) {
    if (isSessionPromptTimeoutError(err)) {
      console.warn(
        `[ACP Route] session/prompt timed out while waiting for ${sessionId}; keeping ACP session alive for continued lifecycle updates.`,
        err,
      );
      store.flushAgentBuffer(sessionId);
      void persistSessionHistorySnapshot(sessionId, store);
      return jsonrpcResponse(id ?? null, { sessionId, pending: true });
    }
    const message = markSessionPromptError(store, sessionId, err, "Prompt failed");
    store.flushAgentBuffer(sessionId);
    void persistSessionHistorySnapshot(sessionId, store);
    return jsonrpcResponse(id ?? null, null, {
      code: -32000,
      message,
      data: getPromptErrorData(err),
    });
  }
}

export async function dispatchSessionPrompt(params: DispatchSessionPromptParams): Promise<void> {
  const response = await handleSessionPrompt({
    id: params.sessionId,
    params: params as unknown as Record<string, unknown>,
    jsonrpcResponse: inlineJsonrpcResponse,
    createSessionUpdateForwarder: inlineCreateSessionUpdateForwarder,
    buildMcpConfigForClaude: inlineBuildMcpConfigForClaude,
    requireWorkspaceId: inlineRequireWorkspaceId,
    encodeSsePayload: inlineEncodeSsePayload,
  });
  await consumeAcpPromptResponse(response);
}
