/**
 * ACP Agent Presets
 *
 * Well-known ACP agent presets with their standard command-line invocations.
 * Each preset defines how to spawn and communicate with a specific ACP-compliant
 * CLI tool (OpenCode, Gemini, Codex, Copilot, Auggie, etc.).
 *
 * Ported from AcpAgentPresets.kt with TypeScript adaptations.
 */

import { which } from "./utils";

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
  // 1. Check environment variable override
  if (preset.envBinOverride) {
    const envValue = process.env[preset.envBinOverride];
    if (envValue) return envValue;
  }

  // 2. Check node_modules/.bin (for locally installed packages)
  const path = require("path");
  const localBinPath = path.join(process.cwd(), "node_modules", ".bin", preset.command);
  const fs = require("fs");
  try {
    if (fs.existsSync(localBinPath)) {
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
