import { v4 as uuidv4 } from "uuid";
import { getAcpProcessManager } from "@/core/acp/processer";
import { getHttpSessionStore } from "@/core/acp/http-session-store";
import { getPresetById } from "@/core/acp/acp-presets";
import { isServerlessEnvironment } from "@/core/acp/api-based-providers";
import { isOpencodeServerConfigured } from "@/core/acp/opencode-sdk-adapter";
import { getDockerDetector, DEFAULT_DOCKER_AGENT_IMAGE } from "@/core/acp/docker";
import { isClaudeCodeSdkConfigured } from "@/core/acp/claude-code-sdk-adapter";
import type { AgentInstanceConfig } from "@/core/acp/agent-instance-factory";
import { initRoutaOrchestrator } from "@/core/orchestration/orchestrator-singleton";
import { getRoutaSystem } from "@/core/routa-system";
import { AgentRole } from "@/core/models/agent";
import { getSpecialistById, type SpecialistConfig } from "@/core/orchestration/specialist-prompts";
import { getDatabase, isPostgres } from "@/core/db";
import { PostgresSpecialistStore } from "@/core/store/specialist-store";
import {
  createTraceRecord,
  withWorkspaceId,
  withMetadata,
  recordTrace,
} from "@/core/trace";
import { persistSessionToDb } from "@/core/acp/session-db-persister";
import { createWorkspaceSessionSandbox } from "@/core/sandbox/permissions";
import {
  buildExecutionBinding,
  refreshExecutionBinding,
} from "@/core/acp/execution-backend";
import type { McpServerProfile } from "@/core/mcp/mcp-server-profiles";
import { pendingAcpCreations } from "@/core/acp/pending-acp-creations";
import { buildFeatureTreeSpecPromptSection } from "@/core/spec/feature-tree-spec-resource-contract";

export interface IdempotencyEntry {
  sessionId: string;
  provider: string;
  role: string;
  createdAt: number;
}

export const idempotencyCache = new Map<string, IdempotencyEntry>();
export { pendingAcpCreations };

const IDEMPOTENCY_TTL_MS = 30_000;

export function cleanupIdempotencyCache() {
  const now = Date.now();
  for (const [key, entry] of idempotencyCache.entries()) {
    if (now - entry.createdAt > IDEMPOTENCY_TTL_MS) {
      idempotencyCache.delete(key);
    }
  }
}

function isWorkspaceProvider(provider: string): boolean {
  const normalized = provider.toLowerCase();
  return normalized === "workspace" || normalized === "workspace-agent" || normalized === "routa-native";
}

export async function loadSpecialistConfig(
  specialistId: string | undefined,
  locale: string,
): Promise<SpecialistConfig | null> {
  if (!specialistId) return null;
  const normalizedId = specialistId.toLowerCase();

  if (normalizedId === "team-agent-lead") {
    return getSpecialistById(normalizedId, locale) ?? null;
  }

  if (isPostgres()) {
    try {
      const db = getDatabase();
      const specStore = new PostgresSpecialistStore(db);
      const specialist = await specStore.get(normalizedId);
      if (specialist) return specialist;
    } catch (err) {
      console.warn("[ACP Route] DB specialist lookup failed, falling back to file cache:", err);
    }
  }

  return getSpecialistById(normalizedId, locale) ?? null;
}

function buildSpecialistSystemPrompt(
  specialist: SpecialistConfig | null,
): string | undefined {
  if (!specialist?.systemPrompt) {
    return undefined;
  }

  const sections = [specialist.systemPrompt.trim()];

  if (specialist.id === "feature-surface-metadata-analyst" || specialist.id === "feature-tree-orchestrator") {
    sections.push(buildFeatureTreeSpecPromptSection());
  }

  if (specialist.roleReminder) {
    sections.push(`**Reminder:** ${specialist.roleReminder}`);
  }

  return sections.join("\n\n---\n");
}

function deriveAllowedNativeTools(
  requestedTools: unknown,
  specialistId?: string,
): string[] | undefined {
  if (Array.isArray(requestedTools)) {
    return requestedTools.filter((tool): tool is string => typeof tool === "string");
  }

  if (specialistId === "team-agent-lead") {
    return [];
  }

  return undefined;
}

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

type ForwardedNotificationWriter = (
  store: ReturnType<typeof getHttpSessionStore>,
  sessionId: string,
  data: unknown,
) => void;

interface HandleSessionNewArgs {
  id: string | number | null;
  params: Record<string, unknown>;
  jsonrpcResponse: JsonRpcResponseFactory;
  createSessionUpdateForwarder: SessionUpdateForwarderFactory;
  buildMcpConfigForClaude: ClaudeMcpConfigBuilder;
  requireWorkspaceId: WorkspaceIdResolver;
  pushAndPersistForwardedNotification: ForwardedNotificationWriter;
}

export async function handleSessionNew({
  id,
  params,
  jsonrpcResponse,
  createSessionUpdateForwarder,
  buildMcpConfigForClaude,
  requireWorkspaceId,
  pushAndPersistForwardedNotification,
}: HandleSessionNewArgs): Promise<Response> {
  const p = params;
  let cwd = (p.cwd as string | undefined) ?? process.cwd();
  const branch = (p.branch as string | undefined) || undefined;
  const name = (p.name as string | undefined)?.trim() || undefined;
  const worktreeId = (p.worktreeId as string | undefined) || undefined;
  const specialistId = (p.specialistId as string | undefined);
  const specialistLocale = (p.specialistLocale as string | undefined) ?? "en";
  const specialist = await loadSpecialistConfig(specialistId, specialistLocale);
  const customSystemPrompt = (p.systemPrompt as string | undefined)?.trim() || undefined;

  const defaultProvider = isServerlessEnvironment() ? "claude-code-sdk" : "opencode";
  const requestedProvider = (p.provider as string | undefined);
  const provider = specialistId === "team-agent-lead" &&
    (requestedProvider ?? specialist?.defaultProvider ?? defaultProvider) === "opencode" &&
    isClaudeCodeSdkConfigured()
    ? "claude-code-sdk"
    : requestedProvider ?? specialist?.defaultProvider ?? defaultProvider;

  const modeId = (p.modeId as string | undefined) ?? (p.mode as string | undefined);
  const role = (p.role as string | undefined)?.toUpperCase() ?? specialist?.role;
  const parentSessionId = (p.parentSessionId as string | undefined) || undefined;
  const model = (p.model as string | undefined) ?? specialist?.model;
  let sandboxId = (p.sandboxId as string | undefined)?.trim() || undefined;
  const toolMode = p.toolMode === "full"
    ? "full"
    : p.toolMode === "essential"
      ? "essential"
      : undefined;
  const mcpProfile = typeof p.mcpProfile === "string" ? p.mcpProfile as McpServerProfile : undefined;
  const allowedNativeTools = deriveAllowedNativeTools(
    p.allowedNativeTools,
    specialistId,
  );
  const baseUrl = (p.baseUrl as string | undefined);
  const apiKey = (p.apiKey as string | undefined);
  const workspaceId = requireWorkspaceId(p.workspaceId);
  const idempotencyKey = p.idempotencyKey as string | undefined;
  const customCommand = (p.customCommand as string | undefined);
  const customArgs = Array.isArray(p.customArgs) ? (p.customArgs as string[]) : undefined;
  const authJson = (p.authJson as string | undefined);
  const autoApprovePermissions = p.autoApprovePermissions === true;

  if (customCommand !== undefined && (typeof customCommand !== "string" || !customCommand.trim())) {
    return jsonrpcResponse(id ?? null, null, {
      code: -32602,
      message: "customCommand must be a non-empty string",
    });
  }
  if (customArgs !== undefined && !customArgs.every((arg) => typeof arg === "string")) {
    return jsonrpcResponse(id ?? null, null, {
      code: -32602,
      message: "customArgs must be an array of strings",
    });
  }
  if (!workspaceId) {
    return jsonrpcResponse(id ?? null, null, {
      code: -32602,
      message: "workspaceId is required",
    });
  }

  if (idempotencyKey) {
    cleanupIdempotencyCache();
    const cached = idempotencyCache.get(idempotencyKey);
    if (cached) {
      const cachedSession = getHttpSessionStore().getSession(cached.sessionId);
      console.log(`[ACP Route] Returning cached session for idempotencyKey: ${idempotencyKey} -> ${cached.sessionId}`);
      return jsonrpcResponse(id ?? null, {
        sessionId: cached.sessionId,
        provider: cached.provider,
        role: cached.role,
        sandboxId: cachedSession?.sandboxId,
        executionMode: cachedSession?.executionMode,
        ownerInstanceId: cachedSession?.ownerInstanceId,
        leaseExpiresAt: cachedSession?.leaseExpiresAt,
        cached: true,
      });
    }
  }

  const sessionId = uuidv4();
  const crafterProvider = (p.crafterProvider as string | undefined) ?? provider;
  const gateProvider = (p.gateProvider as string | undefined) ?? provider;

  console.log(`[ACP Route] Creating session: provider=${provider}, cwd=${cwd}, modeId=${modeId}, role=${role ?? "CRAFTER"}, idempotencyKey=${idempotencyKey ?? "none"}`);

  const store = getHttpSessionStore();
  const manager = getAcpProcessManager();
  const forwardSessionUpdate = createSessionUpdateForwarder(store, sessionId);

  const preset = getPresetById(provider);
  const isClaudeCode = preset?.nonStandardApi === true || provider === "claude";
  const isWorkspaceAgent = isWorkspaceProvider(provider);
  const isClaudeCodeSdk = provider === "claude-code-sdk";
  const isOpencodeSdk = provider === "opencode-sdk";
  const isDockerOpenCode = provider === "docker-opencode";

  if (isOpencodeSdk && !isOpencodeServerConfigured()) {
    return jsonrpcResponse(id ?? null, null, {
      code: -32002,
      message: "OpenCode SDK not configured. Set OPENCODE_SERVER_URL or OPENCODE_API_KEY (or ANTHROPIC_AUTH_TOKEN) environment variable.",
    });
  }
  if (isClaudeCodeSdk && !isClaudeCodeSdkConfigured()) {
    return jsonrpcResponse(id ?? null, null, {
      code: -32002,
      message: "Claude Code SDK not configured. Set ANTHROPIC_AUTH_TOKEN environment variable.",
    });
  }
  if (isDockerOpenCode) {
    const dockerStatus = await getDockerDetector().checkAvailability();
    if (!dockerStatus.available) {
      return jsonrpcResponse(id ?? null, null, {
        code: -32003,
        message: dockerStatus.error
          ? `Docker unavailable: ${dockerStatus.error}`
          : "Docker daemon is unavailable. Please start Docker or Colima first.",
      });
    }
  }

  const specialistSystemPrompt = customSystemPrompt ?? buildSpecialistSystemPrompt(specialist);

  let validatedWorktreeId: string | undefined;
  if (worktreeId) {
    const system = getRoutaSystem();
    const worktree = await system.worktreeStore.get(worktreeId);
    if (!worktree || worktree.status !== "active" || worktree.workspaceId !== workspaceId) {
      return jsonrpcResponse(id ?? null, null, {
        code: -32602,
        message: worktree
          ? "Worktree is not active or does not belong to this workspace"
          : "Worktree not found",
      });
    }
    if (worktree.sessionId) {
      return jsonrpcResponse(id ?? null, null, {
        code: -32602,
        message: "Worktree is already assigned to another session",
      });
    }
    cwd = worktree.worktreePath;
    validatedWorktreeId = worktreeId;
  }

  if (isWorkspaceAgent && !sandboxId) {
    sandboxId = (await createWorkspaceSessionSandbox({
      workspaceId,
      workdir: cwd,
    }))?.id;
  }

  const now = new Date();
  const executionBinding = buildExecutionBinding("embedded");
  store.upsertSession({
    sessionId,
    name,
    cwd,
    branch,
    workspaceId,
    provider,
    role: role ?? "CRAFTER",
    toolMode,
    mcpProfile,
    allowedNativeTools,
    parentSessionId,
    modeId,
    model,
    specialistId: specialistId ?? undefined,
    sandboxId,
    specialistSystemPrompt,
    acpStatus: "connecting",
    createdAt: now.toISOString(),
    ...executionBinding,
  });

  if (idempotencyKey) {
    idempotencyCache.set(idempotencyKey, {
      sessionId,
      provider,
      role: role ?? "CRAFTER",
      createdAt: Date.now(),
    });
  }

  const sessionStartTrace = specialistId
    ? withMetadata(
        withMetadata(
          withMetadata(
            withWorkspaceId(
              createTraceRecord(sessionId, "session_start", { provider }),
              workspaceId,
            ),
            "cwd",
            cwd,
          ),
          "role",
          role ?? "CRAFTER",
        ),
        "specialistId",
        specialistId,
      )
    : withMetadata(
        withMetadata(
          withWorkspaceId(
            createTraceRecord(sessionId, "session_start", { provider }),
            workspaceId,
          ),
          "cwd",
          cwd,
        ),
        "role",
        role ?? "CRAFTER",
      );
  recordTrace(cwd, sessionStartTrace);

  const responsePayload = {
    sessionId,
    provider,
    role: role ?? "CRAFTER",
    model,
    sandboxId,
    acpStatus: "connecting" as const,
    ...executionBinding,
  };

  const creationPromise = (async () => {
    try {
      let acpSessionId: string;
      let workspaceSessionAgentId: string | undefined;

      if (isWorkspaceAgent) {
        const system = getRoutaSystem();
        const effectiveRole = (role ?? "DEVELOPER") as AgentRole;
        const agentResult = await system.tools.createAgent({
          name: `workspace-${effectiveRole.toLowerCase()}-${sessionId.slice(0, 8)}`,
          role: effectiveRole,
          workspaceId,
        });
        if (!agentResult.success || !agentResult.data) {
          throw new Error(agentResult.error ?? "Failed to create workspace session agent");
        }
        workspaceSessionAgentId = (agentResult.data as { agentId: string }).agentId;
      }

      if (isWorkspaceAgent) {
        const system = getRoutaSystem();
        acpSessionId = await manager.createWorkspaceAgentSession(
          sessionId,
          cwd,
          forwardSessionUpdate,
          {
            agentTools: system.tools,
            workspaceId,
            agentId: workspaceSessionAgentId,
            sandboxId,
          },
        );
      } else if (isOpencodeSdk) {
        acpSessionId = await manager.createOpencodeSdkSession(
          sessionId,
          forwardSessionUpdate,
        );
      } else if (isDockerOpenCode) {
        const dockerExtraEnv: Record<string, string> = {};
        if (apiKey) {
          dockerExtraEnv.ANTHROPIC_API_KEY = apiKey;
          dockerExtraEnv.ANTHROPIC_AUTH_TOKEN = apiKey;
        }
        if (model) {
          dockerExtraEnv.OPENCODE_MODEL = model;
        }
        acpSessionId = await manager.createDockerSession(
          sessionId,
          cwd,
          forwardSessionUpdate,
          process.env.ROUTA_DOCKER_OPENCODE_IMAGE ?? DEFAULT_DOCKER_AGENT_IMAGE,
          Object.keys(dockerExtraEnv).length > 0 ? dockerExtraEnv : undefined,
          authJson,
        );
      } else if (isClaudeCodeSdk) {
        const mcpConfigs = await buildMcpConfigForClaude(workspaceId, sessionId, toolMode, mcpProfile);
        const instanceConfig: AgentInstanceConfig = {
          model,
          provider: "claude-code-sdk",
          specialistId,
          role,
          baseUrl,
          apiKey,
          allowedNativeTools,
          mcpServers: {},
          systemPromptAppend: specialistSystemPrompt,
        };
        if (mcpConfigs.length > 0) {
          const { parseMcpServersFromConfigs } = await import("@/core/acp/mcp-setup");
          instanceConfig.mcpServers = parseMcpServersFromConfigs(mcpConfigs);
        }
        acpSessionId = await manager.createClaudeCodeSdkSession(
          sessionId,
          cwd,
          forwardSessionUpdate,
          instanceConfig,
        );
      } else if (isClaudeCode) {
        const mcpConfigs = await buildMcpConfigForClaude(workspaceId, sessionId, toolMode, mcpProfile);
        acpSessionId = await manager.createClaudeSession(
          sessionId,
          cwd,
          forwardSessionUpdate,
          mcpConfigs,
          modeId,
          role,
          undefined,
          allowedNativeTools,
        );
      } else if (customCommand) {
        console.log(`[ACP Route] Using custom provider: ${provider}`);
        acpSessionId = await manager.createSessionFromInline(
          sessionId,
          customCommand,
          customArgs ?? [],
          cwd,
          provider,
          forwardSessionUpdate,
          {
            provider,
            role,
            autoApprovePermissions,
          },
        );
      } else {
        const extraArgs: string[] = [];
        if (model && model.trim()) {
          extraArgs.push("-m", model.trim());
        }
        acpSessionId = await manager.createSession(
          sessionId,
          cwd,
          forwardSessionUpdate,
          provider,
          modeId,
          extraArgs.length > 0 ? extraArgs : undefined,
          undefined,
          workspaceId,
          toolMode,
          mcpProfile,
          {
            provider,
            role,
            autoApprovePermissions,
          },
        );
      }

      let routaAgentId: string | undefined;

      if (role === "ROUTA") {
        const serverPort = process.env.PORT ?? "3000";
        const orchestrator = initRoutaOrchestrator({
          defaultCrafterProvider: crafterProvider,
          defaultGateProvider: gateProvider,
          defaultCwd: cwd,
          serverPort,
        });

        const system = getRoutaSystem();
        if (workspaceSessionAgentId) {
          routaAgentId = workspaceSessionAgentId;
        } else {
          const agentMetadata: Record<string, string> = {};
          if (specialistId) {
            agentMetadata.specialist = specialistId;
          }
          if (specialistId === "team-agent-lead") {
            agentMetadata.rosterRoleId = specialistId;
            agentMetadata.displayLabel = specialist?.name ?? "Agent Lead";
          }
          const agentResult = await system.tools.createAgent({
            name: `routa-coordinator-${sessionId.slice(0, 8)}`,
            role: AgentRole.ROUTA,
            workspaceId,
            metadata: Object.keys(agentMetadata).length > 0 ? agentMetadata : undefined,
          });

          if (agentResult.success && agentResult.data) {
            routaAgentId = (agentResult.data as { agentId: string }).agentId;
            orchestrator.registerAgentSession(routaAgentId, sessionId);
          }
        }

        if (routaAgentId) {
          orchestrator.registerAgentSession(routaAgentId, sessionId);

          orchestrator.setNotificationHandler((targetSessionId, data) => {
            pushAndPersistForwardedNotification(store, targetSessionId, data);
          });

          orchestrator.setSessionRegistrationHandler((childSession) => {
            const childExecutionBinding = buildExecutionBinding("embedded");
            store.upsertSession({
              sessionId: childSession.sessionId,
              name: childSession.name,
              cwd: childSession.cwd,
              workspaceId: childSession.workspaceId,
              routaAgentId: childSession.routaAgentId,
              provider: childSession.provider,
              role: childSession.role,
              specialistId: childSession.specialistId,
              parentSessionId: childSession.parentSessionId,
              sandboxId: childSession.sandboxId,
              createdAt: new Date().toISOString(),
              ...childExecutionBinding,
            });
            persistSessionToDb({
              id: childSession.sessionId,
              name: childSession.name,
              cwd: childSession.cwd,
              workspaceId: childSession.workspaceId,
              routaAgentId: childSession.routaAgentId ?? "",
              provider: childSession.provider ?? "",
              role: childSession.role ?? "CRAFTER",
              parentSessionId: childSession.parentSessionId,
              specialistId: childSession.specialistId,
              ...childExecutionBinding,
            }).catch((err: unknown) =>
              console.error(`[ACP Route] Failed to persist child session ${childSession.sessionId}:`, err),
            );
          });

          console.log(`[ACP Route] ROUTA coordinator agent created: ${routaAgentId}`);
        }
      }

      store.upsertSession({
        sessionId,
        name,
        cwd,
        branch,
        workspaceId,
        provider,
        role: role ?? "CRAFTER",
        toolMode,
        mcpProfile,
        allowedNativeTools,
        parentSessionId,
        modeId,
        model,
        routaAgentId: routaAgentId ?? workspaceSessionAgentId ?? acpSessionId,
        specialistId: specialistId ?? undefined,
        sandboxId,
        specialistSystemPrompt,
        acpStatus: "ready",
        createdAt: now.toISOString(),
        ...refreshExecutionBinding(executionBinding),
      });

      store.updateSessionAcpStatus(sessionId, "ready");

      if (validatedWorktreeId) {
        const system = getRoutaSystem();
        await system.worktreeStore.assignSession(validatedWorktreeId, sessionId);
      }

      persistSessionToDb({
        id: sessionId,
        name,
        cwd,
        branch,
        workspaceId,
        routaAgentId: routaAgentId ?? workspaceSessionAgentId ?? acpSessionId,
        provider,
        role: role ?? "CRAFTER",
        parentSessionId,
        modeId,
        model,
        specialistId: specialistId ?? undefined,
        ...refreshExecutionBinding(executionBinding),
      }).catch((err) =>
        console.error(`[ACP Route] Background DB persist failed for ${sessionId}:`, err),
      );

      console.log(
        `[ACP Route] Session ready: ${sessionId} (provider: ${provider}, agent session: ${acpSessionId}, role: ${role ?? "CRAFTER"})`,
      );
    } catch (err) {
      console.error(`[ACP Route] Background ACP creation failed for ${sessionId}:`, err);
      store.updateSessionAcpStatus(
        sessionId,
        "error",
        err instanceof Error ? err.message : "ACP process creation failed",
      );
    } finally {
      pendingAcpCreations.delete(sessionId);
    }
  })();

  pendingAcpCreations.set(sessionId, creationPromise);

  return jsonrpcResponse(id ?? null, responsePayload);
}
