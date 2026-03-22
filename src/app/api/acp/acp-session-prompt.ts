import { getAcpProcessManager } from "@/core/acp/processer";
import { getHttpSessionStore } from "@/core/acp/http-session-store";
import { getPresetById } from "@/core/acp/acp-presets";
import { isServerlessEnvironment } from "@/core/acp/api-based-providers";
import { isOpencodeServerConfigured } from "@/core/acp/opencode-sdk-adapter";
import { getDockerDetector, DEFAULT_DOCKER_AGENT_IMAGE } from "@/core/acp/docker";
import { isClaudeCodeSdkConfigured } from "@/core/acp/claude-code-sdk-adapter";
import { getRoutaOrchestrator } from "@/core/orchestration/orchestrator-singleton";
import { getRoutaSystem } from "@/core/routa-system";
import { AgentRole } from "@/core/models/agent";
import { buildCoordinatorPrompt } from "@/core/orchestration/specialist-prompts";
import {
  createTraceRecord,
  withWorkspaceId,
  withMetadata,
  withConversation,
  recordTrace,
} from "@/core/trace";
import { persistSessionToDb, updateSessionExecutionBindingInDb } from "@/core/acp/session-db-persister";
import { resolveSkillContent } from "@/core/skills/skill-resolver";
import {
  buildExecutionBinding,
  refreshExecutionBinding,
} from "@/core/acp/execution-backend";
import type { McpServerProfile } from "@/core/mcp/mcp-server-profiles";
import { pendingAcpCreations } from "./acp-session-create";
import { persistSessionHistorySnapshot } from "./acp-session-history";

type JsonRpcResponseFactory = (
  id: string | number | null,
  result: unknown,
  error?: { code: number; message: string }
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
  const manager = getAcpProcessManager();
  const store = getHttpSessionStore();
  const forwardSessionUpdate = createSessionUpdateForwarder(store, sessionId);

  const sessionExists =
    manager.getProcess(sessionId) !== undefined ||
    manager.getClaudeProcess(sessionId) !== undefined ||
    manager.isDockerAdapterSession(sessionId) ||
    manager.isClaudeCodeSdkSession(sessionId) ||
    manager.isOpencodeAdapterSession(sessionId) ||
    (await manager.isClaudeCodeSdkSessionAsync(sessionId)) ||
    (await manager.isOpencodeSdkSessionAsync(sessionId));

  if (sessionExists) {
    return null;
  }

  console.log(`[ACP Route] Session ${sessionId} not found, auto-creating with default settings...`);

  const storedSession = store.getSession(sessionId);
  const cwd = storedSession?.cwd ?? (params.cwd as string | undefined) ?? process.cwd();
  const defaultProvider = isServerlessEnvironment() ? "claude-code-sdk" : "opencode";
  const provider = (params.provider as string | undefined) ?? storedSession?.provider ?? defaultProvider;
  const workspaceId = requireWorkspaceId(params.workspaceId) ?? storedSession?.workspaceId;
  if (!workspaceId) {
    return jsonrpcResponse(id ?? null, null, {
      code: -32602,
      message: "workspaceId is required to recreate the session",
    });
  }
  const role = storedSession?.role ?? "CRAFTER";
  const toolMode = storedSession?.toolMode;
  const mcpProfile = storedSession?.mcpProfile;
  const allowedNativeTools = storedSession?.allowedNativeTools;
  const specialistId = storedSession?.specialistId;
  const specialistSystemPrompt = storedSession?.specialistSystemPrompt;

  try {
    const preset = getPresetById(provider);
    const isClaudeCode = preset?.nonStandardApi === true || provider === "claude";
    const isClaudeCodeSdk = provider === "claude-code-sdk";
    const isOpencodeSdk = provider === "opencode-sdk";
    const isDockerOpenCode = provider === "docker-opencode";

    let acpSessionId: string;

    if (isOpencodeSdk) {
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
    async start(controller) {
      await run(controller, encoder);
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

  const orchestrator = getRoutaOrchestrator();
  if (orchestrator) {
    const sessionRecord = store.getSession(sessionId);
    if (sessionRecord?.routaAgentId) {
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

  store.pushUserMessage(sessionId, promptText);
  await persistSessionHistorySnapshot(sessionId, store);

  const sessionRecord = store.getSession(sessionId);
  const userMsgTrace = withConversation(
    createTraceRecord(sessionId, "user_message", { provider: sessionRecord?.provider ?? "unknown" }),
    {
      role: "user",
      contentPreview: promptText.slice(0, 200),
    },
  );
  recordTrace(sessionRecord?.cwd ?? process.cwd(), userMsgTrace);

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
      manager.killSession(sessionId);
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
        const message = markSessionPromptError(store, sessionId, err, "Claude Code prompt failed after restart");
        store.flushAgentBuffer(sessionId);
        void persistSessionHistorySnapshot(sessionId, store);
        return jsonrpcResponse(id ?? null, null, {
          code: -32000,
          message,
        });
      }
    }

    try {
      const result = await claudeProc.prompt(sessionId, promptText);
      store.flushAgentBuffer(sessionId);
      void persistSessionHistorySnapshot(sessionId, store);
      return jsonrpcResponse(id ?? null, result);
    } catch (err) {
      const message = markSessionPromptError(store, sessionId, err, "Claude Code prompt failed");
      store.flushAgentBuffer(sessionId);
      void persistSessionHistorySnapshot(sessionId, store);
      return jsonrpcResponse(id ?? null, null, {
        code: -32000,
        message,
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
    const message = markSessionPromptError(store, sessionId, err, "Prompt failed");
    store.flushAgentBuffer(sessionId);
    void persistSessionHistorySnapshot(sessionId, store);
    return jsonrpcResponse(id ?? null, null, {
      code: -32000,
      message,
    });
  }
}
