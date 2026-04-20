/**
 * Agent Instance Factory & Manager
 *
 * Provides a clean separation between:
 *   - **Config resolution**: determines which model / maxTurns to use for a given
 *     specialist, role, or explicit override.
 *   - **Instance creation**: builds a properly configured adapter instance.
 *   - **Instance lifecycle**: tracks running instances per session for observability
 *     and resource cleanup.
 *
 * Resolution priority (highest → lowest):
 *   1. Explicit model override (from session/new `model` param)
 *   2. Specialist model (from specialist config in DB / file)
 *   3. Role-based model tier (from PROVIDER_MODEL_TIERS)
 *   4. Global env var (ANTHROPIC_MODEL)
 *   5. SDK default fallback
 */

import { ClaudeCodeSdkAdapter } from "./claude-code-sdk-adapter";
import { PROVIDER_MODEL_TIERS, type ModelTierType } from "./provider-registry";
import {
  getSpecialistById,
  getSpecialistByRole,
  type SpecialistConfig,
} from "../orchestration/specialist-prompts";
import type { NotificationHandler } from "./protocol-types";
import { type AgentRole } from "../models/agent";
import type { LifecycleNotifier } from "./lifecycle-notifier";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

// ─── Agent Instance Config ─────────────────────────────────────────────────

/**
 * Configuration for a single agent adapter instance.
 * Produced by the factory from specialist / role / explicit inputs.
 */
export interface AgentInstanceConfig {
  /** Explicit model identifier override (e.g. "claude-sonnet-4-20250514") */
  model?: string;
  /** Provider identifier (e.g. "claude-code-sdk", "opencode") */
  provider?: string;
  /** Maximum tool-use turns for the agent loop */
  maxTurns?: number;
  /** Specialist ID that was used to produce this config */
  specialistId?: string;
  /** Agent role (ROUTA / CRAFTER / GATE / DEVELOPER or custom) */
  role?: string;
  /** Custom API base URL override (e.g. https://open.bigmodel.cn/api/anthropic) */
  baseUrl?: string;
  /** API key / auth token override */
  apiKey?: string;
  /** Optional allowlist for provider-native tools such as Bash/Read/Edit */
  allowedNativeTools?: string[];
  /** Optional MCP servers exposed to the adapter session */
  mcpServers?: Record<string, McpServerConfig>;
  /** Optional system prompt append content passed through to the provider SDK */
  systemPromptAppend?: string;
}

/**
 * Resolved config with the final model picked by the resolution chain.
 */
export interface ResolvedAgentConfig extends AgentInstanceConfig {
  /** The model that will actually be used (after resolution) */
  resolvedModel?: string;
  /** The specialist config that was matched, if any */
  specialist?: SpecialistConfig;
}

// ─── Managed Instance Record ───────────────────────────────────────────────

/**
 * A tracked agent instance with its resolved config for observability.
 */
export interface ManagedAgentInstance {
  sessionId: string;
  config: ResolvedAgentConfig;
  createdAt: Date;
}

// ─── Factory ───────────────────────────────────────────────────────────────

/**
 * Resolve the effective model from a tier + provider combination.
 *
 * Maps (tier=FAST, provider=claude-code-sdk) → "claude-3-5-haiku-20241022" etc.
 */
function resolveModelFromTier(
  tier: string,
  provider?: string,
): string | undefined {
  // Map provider IDs to PROVIDER_MODEL_TIERS keys
  const providerKey =
    provider === "claude-code-sdk"
      ? "claudeCodeSdk"
      : provider === "claude"
        ? "claude"
        : provider ?? "claudeCodeSdk";

  const tiers = PROVIDER_MODEL_TIERS[providerKey];
  if (!tiers) return undefined;

  const tierKey = tier.toLowerCase() as ModelTierType;
  return tiers[tierKey] || undefined;
}

export class AgentInstanceFactory {
  /**
   * Resolve a full config from partial inputs.
   *
   * Applies the priority chain:
   *   explicit model → specialist.model → tier-based → undefined (SDK default)
   */
  static resolveConfig(config: AgentInstanceConfig): ResolvedAgentConfig {
    let specialist: SpecialistConfig | undefined;

    // 1. Explicit model override — use directly
    if (config.model) {
      return { ...config, resolvedModel: config.model };
    }

    // 2. Look up specialist by ID
    if (config.specialistId) {
      specialist = getSpecialistById(config.specialistId);
      if (specialist?.model) {
        return { ...config, resolvedModel: specialist.model, specialist };
      }
      if (specialist) {
        const tierModel = resolveModelFromTier(
          specialist.defaultModelTier,
          config.provider,
        );
        if (tierModel) {
          return { ...config, resolvedModel: tierModel, specialist };
        }
      }
    }

    // 3. Look up specialist by role
    if (config.role) {
      specialist = getSpecialistByRole(config.role as AgentRole);
      if (specialist?.model) {
        return { ...config, resolvedModel: specialist.model, specialist };
      }
      if (specialist) {
        const tierModel = resolveModelFromTier(
          specialist.defaultModelTier,
          config.provider,
        );
        if (tierModel) {
          return { ...config, resolvedModel: tierModel, specialist };
        }
      }
    }

    // 4. Role-based env var overrides (ROUTA_MODEL, CRAFTER_MODEL, GATE_MODEL, DEVELOPER_MODEL)
    if (config.role) {
      const roleEnvVar = `${config.role.toUpperCase()}_MODEL`;
      const roleEnvModel = process.env[roleEnvVar];
      if (roleEnvModel) {
        return { ...config, resolvedModel: roleEnvModel, specialist };
      }
    }

    // 5. No resolution — adapter will fall back to ANTHROPIC_MODEL env var / SDK default
    return { ...config, resolvedModel: undefined, specialist };
  }

  /**
   * Create a Claude Code SDK adapter with the resolved config.
   */
  static createClaudeCodeSdkAdapter(
    cwd: string,
    onNotification: NotificationHandler,
    config?: AgentInstanceConfig,
    lifecycleNotifier?: LifecycleNotifier,
  ): { adapter: ClaudeCodeSdkAdapter; resolved: ResolvedAgentConfig } {
    const resolved = config
      ? AgentInstanceFactory.resolveConfig(config)
      : ({} as ResolvedAgentConfig);

    const adapter = new ClaudeCodeSdkAdapter(cwd, onNotification, {
      model: resolved.resolvedModel,
      maxTurns: resolved.maxTurns,
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      allowedNativeTools: resolved.allowedNativeTools,
      mcpServers: resolved.mcpServers,
      systemPromptAppend: resolved.systemPromptAppend,
      lifecycleNotifier,
    });

    console.log(
      `[AgentInstanceFactory] Created Claude Code SDK adapter:` +
        ` model=${resolved.resolvedModel ?? "(default)"}` +
        ` specialistId=${resolved.specialistId ?? "(none)"}` +
        ` role=${resolved.role ?? "(none)"}`,
    );

    return { adapter, resolved };
  }
}

// ─── Manager ───────────────────────────────────────────────────────────────

/**
 * Tracks running agent instances and their resolved configs.
 * Provides observability (which session uses which model) and cleanup.
 *
 * This is a lightweight tracker — the actual adapter references live
 * in `AcpProcessManager`'s Maps. The manager only stores the config metadata.
 */
export class AgentInstanceManager {
  private instances = new Map<string, ManagedAgentInstance>();

  /** Register a newly created instance. */
  register(sessionId: string, config: ResolvedAgentConfig): void {
    this.instances.set(sessionId, {
      sessionId,
      config,
      createdAt: new Date(),
    });
  }

  /** Get the managed instance record for a session. */
  get(sessionId: string): ManagedAgentInstance | undefined {
    return this.instances.get(sessionId);
  }

  /** Get just the resolved config for a session. */
  getConfig(sessionId: string): ResolvedAgentConfig | undefined {
    return this.instances.get(sessionId)?.config;
  }

  /** Remove an instance (on session close). */
  remove(sessionId: string): void {
    this.instances.delete(sessionId);
  }

  /** List all tracked instances. */
  listAll(): ManagedAgentInstance[] {
    return Array.from(this.instances.values());
  }

  /** Get count of active instances. */
  get size(): number {
    return this.instances.size;
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────

const GLOBAL_KEY = "__routa_agent_instance_manager__";

/**
 * Get or create the global AgentInstanceManager singleton.
 * Survives Next.js HMR via globalThis.
 */
export function getAgentInstanceManager(): AgentInstanceManager {
  let mgr = (globalThis as Record<string, unknown>)[GLOBAL_KEY] as
    | AgentInstanceManager
    | undefined;
  if (!mgr) {
    mgr = new AgentInstanceManager();
    (globalThis as Record<string, unknown>)[GLOBAL_KEY] = mgr;
  }
  return mgr;
}
