import { type AcpAgentPreset, getPresetByIdWithRegistry, resolveCommand } from "./acp-presets";

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
  mcpConfigs?: string[],
): Promise<AcpProcessConfig> {
  const preset = await getPresetByIdWithRegistry(presetId);
  if (!preset) {
    throw new Error(
      `Unknown ACP preset: "${presetId}". Check available providers or install from ACP Registry.`,
    );
  }
  if (preset.nonStandardApi) {
    throw new Error(
      `Preset "${presetId}" uses a non-standard API and is not supported by AcpProcess. `
        + "It requires a separate implementation.",
    );
  }

  const command = resolveCommand(preset);
  const args = [...preset.args];

  if (preset.id === "opencode") {
    args.push("--cwd", cwd);
  }

  if (extraArgs) {
    args.push(...extraArgs);
  }

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
  extraEnv?: Record<string, string>,
  mcpConfigs?: string[],
): AcpProcessConfig {
  return {
    command,
    args: [...args],
    cwd,
    env: extraEnv && Object.keys(extraEnv).length > 0 ? extraEnv : undefined,
    displayName,
    mcpConfigs,
  };
}
