/**
 * AcpProcess - Manages an ACP-compliant agent child process
 *
 * Spawns any ACP agent CLI (opencode, gemini, codex-acp, auggie, copilot, etc.)
 * with piped stdio and communicates via JSON-RPC (NDJSON).
 *
 * Handles:
 *   - Sending JSON-RPC requests to the agent (stdin)
 *   - Parsing JSON-RPC responses/notifications from the agent (stdout)
 *   - Forwarding `session/update` notifications to the caller
 *   - Handling agent→client requests (fs, terminal, permissions) with auto-responses
 *
 * Provider selection is driven by AcpAgentPreset configurations.
 * See acp-presets.ts for available presets.
 */

import {type AcpAgentPreset, getPresetByIdWithRegistry, resolveCommand,} from "./acp-presets";
import {AcpProcess} from "@/core/acp/acp-process";
import {AcpProcessManager} from "@/core/acp/acp-process-manager";

export type NotificationHandler = (msg: JsonRpcMessage) => void;

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Configuration for creating an AcpProcess.
 * Can be created from a preset or custom command.
 */
export interface AcpProcessConfig {
  /** The preset being used (if any) */
  preset?: AcpAgentPreset;
  /** Resolved command to execute */
  command: string;
  /** Command-line arguments (preset args + any additional args like --cwd) */
  args: string[];
  /** Working directory */
  cwd: string;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Display name for logging */
  displayName: string;
  /** MCP config JSON strings (passed via --mcp-config for providers that support it) */
  mcpConfigs?: string[];
}

export interface AcpSessionContext {
  sessionId: string;
  provider?: string;
  role?: string;
  autoApprovePermissions?: boolean;
}

/**
 * Build an AcpProcessConfig from a preset ID and working directory.
 * Supports both static presets and registry-based agents.
 */
export async function buildConfigFromPreset(
  presetId: string,
  cwd: string,
  extraArgs?: string[],
  extraEnv?: Record<string, string>,
  mcpConfigs?: string[]
): Promise<AcpProcessConfig> {
  const preset = await getPresetByIdWithRegistry(presetId);
  if (!preset) {
    throw new Error(
      `Unknown ACP preset: "${presetId}". Check available providers or install from ACP Registry.`
    );
  }
  if (preset.nonStandardApi) {
    throw new Error(
      `Preset "${presetId}" uses a non-standard API and is not supported by AcpProcess. ` +
        `It requires a separate implementation.`
    );
  }

  const command = resolveCommand(preset);
  const args = [...preset.args];

  // Append --cwd as command-line argument for providers that support it
  // - OpenCode: uses --cwd flag
  // - Others: rely on process cwd + session/new cwd param (ACP protocol)
  if (preset.id === "opencode") {
    args.push("--cwd", cwd);
  }
  // Note: Some providers may require additional flags for cwd support.
  // If a provider doesn't respect the session/new cwd param, add explicit
  // handling here (similar to opencode).

  if (extraArgs) {
    args.push(...extraArgs);
  }

  // Merge preset env with extraEnv
  const mergedEnv = { ...preset.env, ...extraEnv };

  return {
    preset,
    command,
    args,
    cwd,
    env: Object.keys(mergedEnv).length > 0 ? mergedEnv : undefined,
    displayName: preset.name,
    mcpConfigs,
  };
}

/**
 * Build a default config (opencode) for backward compatibility.
 */
export async function buildDefaultConfig(cwd: string): Promise<AcpProcessConfig> {
  return buildConfigFromPreset("opencode", cwd);
}

/**
 * Build an AcpProcessConfig from an inline command and args (custom provider).
 * Used when the user defines a custom ACP provider with their own command/args.
 */
export function buildConfigFromInline(
  command: string,
  args: string[],
  cwd: string,
  displayName: string,
  extraEnv?: Record<string, string>
): AcpProcessConfig {
  return {
    command,
    args: [...args],
    cwd,
    env: extraEnv && Object.keys(extraEnv).length > 0 ? extraEnv : undefined,
    displayName,
  };
}

// ─── Backward-compatible alias ─────────────────────────────────────────

/**
 * @deprecated Use `AcpProcess` instead. This alias exists for backward compatibility.
 */
export const Processer = AcpProcess;

// ─── Process Manager (manages multiple ACP agent processes) ────────────

export interface ManagedProcess {
  process: AcpProcess;
  acpSessionId: string; // Session ID from the agent
  presetId: string; // Which preset was used
  createdAt: Date;
}

// ─── Backward-compatible alias ─────────────────────────────────────────

// Singleton — use globalThis to survive HMR in Next.js dev mode
const GLOBAL_KEY = "__acp_process_manager__";

/**
 * Get the singleton AcpProcessManager instance.
 */
export function getAcpProcessManager(): AcpProcessManager {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new AcpProcessManager();
  }
  return g[GLOBAL_KEY] as AcpProcessManager;
}

/**
 * @deprecated Use `getAcpProcessManager()` instead. This alias exists for backward compatibility.
 */
export const getOpenCodeProcessManager = getAcpProcessManager;
