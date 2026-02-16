/**
 * ACP Agent Presets
 *
 * Well-known ACP agent presets with their standard command-line invocations.
 * Each preset defines how to spawn and communicate with a specific ACP-compliant
 * CLI tool (OpenCode, Gemini, Codex, Copilot, Auggie, etc.).
 *
 * Supports two modes:
 * 1. Static presets - hardcoded agent configurations
 * 2. Registry-based - dynamically loaded from ACP Registry
 *
 * Ported from AcpAgentPresets.kt with TypeScript adaptations.
 */

import { which } from "./utils";
import {
  type RegistryAgent,
  fetchRegistry,
  getRegistryAgent,
  detectPlatformTarget,
} from "./acp-registry";
import { type DistributionType, buildAgentCommand } from "./acp-installer";

/** Source of the preset configuration */
export type PresetSource = "static" | "registry";

/** Distribution type for registry-sourced presets */
export type PresetDistributionType = DistributionType;

export interface AcpAgentPreset {
  /** Unique identifier for this preset (e.g. "opencode", "gemini") */
  id: string;
  /** Human-readable display name */
  name: string;
  /** CLI command to execute */
  command: string;
  /** Command-line arguments for ACP mode */
  args: string[];
  /** Short description of the agent */
  description: string;
  /** Optional environment variable for overriding the binary path */
  envBinOverride?: string;
  /**
   * Whether this agent uses a non-standard ACP API.
   * Claude Code natively supports ACP without needing an --acp flag.
   * Non-standard providers are excluded from the standard AcpProcess flow.
   */
  nonStandardApi?: boolean;
  /** Source of this preset (static hardcoded or from registry) */
  source?: PresetSource;
  /** Distribution type when from registry */
  distributionType?: PresetDistributionType;
  /** Agent version (for registry agents) */
  version?: string;
  /** Icon URL (for registry agents) */
  icon?: string;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Repository URL */
  repository?: string;
  /** License */
  license?: string;
}

/**
 * All known ACP agent presets.
 */
export const ACP_AGENT_PRESETS: readonly AcpAgentPreset[] = [
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    args: ["acp"],
    description: "OpenCode AI coding agent",
    envBinOverride: "OPENCODE_BIN",
  },
  {
    id: "gemini",
    name: "Gemini",
    command: "gemini",
    args: ["--experimental-acp"],
    description: "Google Gemini CLI",
    envBinOverride: "GEMINI_BIN",
  },
  {
    id: "codex",
    name: "Codex",
    command: "codex-acp",
    args: [],
    description: "OpenAI Codex CLI (via codex-acp wrapper)",
    envBinOverride: "CODEX_ACP_BIN",
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    command: "copilot",
    args: ["--acp"],
    description: "GitHub Copilot CLI",
    envBinOverride: "COPILOT_BIN",
  },
  {
    id: "auggie",
    name: "Auggie",
    command: "auggie",
    args: ["--acp"],
    description: "Augment Code's AI agent",
    envBinOverride: "AUGGIE_BIN",
  },
  {
    id: "kimi",
    name: "Kimi",
    command: "kimi",
    args: ["acp"],
    description: "Moonshot AI's Kimi CLI",
    envBinOverride: "KIMI_BIN",
  },
  // Claude Code uses a non-standard API and requires separate handling
  {
    id: "claude",
    name: "Claude Code",
    command: "claude",
    args: [],
    description: "Anthropic Claude Code (native ACP support)",
    nonStandardApi: true,
  },
] as const;

/**
 * Get a preset by its ID.
 */
export function getPresetById(id: string): AcpAgentPreset | undefined {
  return ACP_AGENT_PRESETS.find((p) => p.id === id);
}

/**
 * Get the default preset (opencode).
 */
export function getDefaultPreset(): AcpAgentPreset {
  return ACP_AGENT_PRESETS[0]; // opencode
}

/**
 * Get all standard ACP presets (excluding non-standard ones like Claude Code).
 */
export function getStandardPresets(): AcpAgentPreset[] {
  return ACP_AGENT_PRESETS.filter((p) => !p.nonStandardApi);
}

/**
 * Resolve the actual binary path for a preset.
 * Checks in this order:
 * 1. Environment variable override (e.g., OPENCODE_BIN)
 * 2. node_modules/.bin (for locally installed packages)
 * 3. Default command (for globally installed or in PATH)
 */
export function resolveCommand(preset: AcpAgentPreset): string {
  // Import bridge lazily to avoid circular dependencies at module load time
  const { getServerBridge } = require("@/core/platform");
  const bridge = getServerBridge();

  // 1. Check environment variable override
  if (preset.envBinOverride) {
    const envValue = bridge.env.getEnv(preset.envBinOverride);
    if (envValue) return envValue;
  }

  // 2. Check node_modules/.bin (for locally installed packages)
  const path = require("path");
  const localBinPath = path.join(bridge.env.currentDir(), "node_modules", ".bin", preset.command);
  try {
    if (bridge.fs.existsSync(localBinPath)) {
      return localBinPath;
    }
  } catch {
    // Ignore errors, fall through to default
  }

  // 3. Fall back to default command (assumes it's in PATH)
  return preset.command;
}

/**
 * Detect which presets have their CLI tools installed on the system.
 * Only checks standard ACP presets (non-standard ones like Claude are excluded).
 */
export async function detectInstalledPresets(): Promise<AcpAgentPreset[]> {
  const standardPresets = getStandardPresets();
  const results: AcpAgentPreset[] = [];

  for (const preset of standardPresets) {
    const resolvedCmd = resolveCommand(preset);
    const found = await which(resolvedCmd);
    if (found) {
      results.push({ ...preset, command: found });
    }
  }

  return results;
}

// ─── Registry-Based Presets ─────────────────────────────────────────────────

/**
 * Convert a registry agent to an AcpAgentPreset.
 * Uses the best available distribution type (npx > uvx > binary).
 */
export function registryAgentToPreset(
  agent: RegistryAgent,
  command: string,
  args: string[],
  distType: DistributionType,
  env?: Record<string, string>
): AcpAgentPreset {
  return {
    id: agent.id,
    name: agent.name,
    command,
    args,
    description: agent.description,
    source: "registry",
    distributionType: distType,
    version: agent.version,
    icon: agent.icon,
    env,
    repository: agent.repository,
    license: agent.license,
    // Registry agents use standard ACP API unless explicitly marked
    nonStandardApi: false,
  };
}

/**
 * Fetch all presets from the ACP Registry.
 * Only returns presets that can be run on the current platform.
 */
export async function fetchRegistryPresets(): Promise<AcpAgentPreset[]> {
  const registry = await fetchRegistry();
  const presets: AcpAgentPreset[] = [];

  for (const agent of registry.agents) {
    const cmdInfo = await buildAgentCommand(agent.id);
    if (cmdInfo) {
      // Determine distribution type
      let distType: DistributionType = "npx";
      if (cmdInfo.command === "uvx") distType = "uvx";
      else if (!cmdInfo.command.includes("npx") && !cmdInfo.command.includes("uvx")) {
        distType = "binary";
      }

      presets.push(
        registryAgentToPreset(agent, cmdInfo.command, cmdInfo.args, distType, cmdInfo.env)
      );
    }
  }

  return presets;
}

/**
 * Get a preset from the registry by ID.
 * Returns null if not found or not available on current platform.
 */
export async function getRegistryPresetById(id: string): Promise<AcpAgentPreset | null> {
  const agent = await getRegistryAgent(id);
  if (!agent) return null;

  const cmdInfo = await buildAgentCommand(id);
  if (!cmdInfo) return null;

  let distType: DistributionType = "npx";
  if (cmdInfo.command === "uvx") distType = "uvx";
  else if (!cmdInfo.command.includes("npx") && !cmdInfo.command.includes("uvx")) {
    distType = "binary";
  }

  return registryAgentToPreset(agent, cmdInfo.command, cmdInfo.args, distType, cmdInfo.env);
}

/**
 * Get all available presets (static + registry).
 * Prefers static presets when IDs conflict.
 */
export async function getAllAvailablePresets(): Promise<AcpAgentPreset[]> {
  const staticPresets: AcpAgentPreset[] = [...ACP_AGENT_PRESETS].map((p) => ({
    ...p,
    source: "static" as PresetSource,
  }));

  const staticIds = new Set(staticPresets.map((p) => p.id));

  try {
    const registryPresets = await fetchRegistryPresets();
    // Add registry presets that don't conflict with static ones
    for (const preset of registryPresets) {
      if (!staticIds.has(preset.id)) {
        staticPresets.push(preset);
      }
    }
  } catch (error) {
    console.warn("[AcpPresets] Failed to fetch registry presets:", error);
    // Continue with static presets only
  }

  return staticPresets;
}

/**
 * Get preset by ID, checking both static and registry sources.
 * Static presets take precedence.
 */
export async function getPresetByIdWithRegistry(
  id: string
): Promise<AcpAgentPreset | undefined> {
  // Check static presets first
  const staticPreset = getPresetById(id);
  if (staticPreset) {
    return { ...staticPreset, source: "static" };
  }

  // Fall back to registry
  const registryPreset = await getRegistryPresetById(id);
  return registryPreset ?? undefined;
}

/**
 * Sync static presets with registry data.
 * Updates version, icon, and other metadata from registry.
 */
export async function syncPresetsWithRegistry(): Promise<AcpAgentPreset[]> {
  const registry = await fetchRegistry();
  const registryMap = new Map(registry.agents.map((a) => [a.id, a]));

  const synced: AcpAgentPreset[] = [];

  for (const preset of ACP_AGENT_PRESETS) {
    const registryAgent = registryMap.get(preset.id);
    if (registryAgent) {
      synced.push({
        ...preset,
        source: "static",
        version: registryAgent.version,
        icon: registryAgent.icon,
        repository: registryAgent.repository,
        license: registryAgent.license,
      });
    } else {
      synced.push({ ...preset, source: "static" });
    }
  }

  return synced;
}
