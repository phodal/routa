/**
 * MCP Setup for ACP Providers
 *
 * Configures MCP (Model Context Protocol) so that each provider can reach
 * the Routa MCP coordination server at /api/mcp.
 *
 * Each provider uses a different mechanism:
 *
 *   ┌────────────┬────────────────────────────────────────────────────────┐
 *   │  Provider  │  How MCP is injected                                  │
 *   ├────────────┼────────────────────────────────────────────────────────┤
 *   │  opencode  │  Merge into ~/.config/opencode/opencode.json (mcp)   │
 *   │  auggie    │  Write ~/.augment/mcp-config.json, pass file path    │
 *   │            │  via  --mcp-config <path>                            │
 *   │  claude    │  Inline JSON via --mcp-config <json>                 │
 *   │  codex     │  Merge into ~/.codex/config.toml (TOML format)      │
 *   │            │  [mcp_servers.routa-coordination]                    │
 *   └────────────┴────────────────────────────────────────────────────────┘
 *
 * Codex docs: https://developers.openai.com/codex/mcp/
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import TOML from "smol-toml";
import {
  getDefaultRoutaMcpConfig,
  type RoutaMcpConfig,
} from "./mcp-config-generator";

// ─── Types ─────────────────────────────────────────────────────────────

export type McpSupportedProvider = "claude" | "auggie" | "opencode" | "codex";

/**
 * Result of a file-based MCP setup (OpenCode / Auggie).
 * `mcpConfigs` is the array of strings that should end up in
 * AcpProcessConfig.mcpConfigs (empty for OpenCode because it reads a file).
 */
export interface McpSetupResult {
  /** Strings to pass as --mcp-config <value> */
  mcpConfigs: string[];
  /** Human-readable summary for logs */
  summary: string;
}

// ─── Public API ────────────────────────────────────────────────────────

export function providerSupportsMcp(providerId: string): boolean {
  const supported: McpSupportedProvider[] = ["claude", "auggie", "opencode", "codex"];
  return supported.includes(providerId as McpSupportedProvider);
}

/**
 * Ensure MCP is configured for `providerId` and return the values that
 * should be forwarded to the process (if any).
 *
 * Call this **before** spawning the process.
 */
export function ensureMcpForProvider(
  providerId: string,
  config?: RoutaMcpConfig,
): McpSetupResult {
  if (!providerSupportsMcp(providerId)) {
    return { mcpConfigs: [], summary: `${providerId}: MCP not supported` };
  }

  const cfg = config || getDefaultRoutaMcpConfig();
  const mcpEndpoint = `${cfg.routaServerUrl}/api/mcp`;

  switch (providerId) {
    case "opencode":
      return ensureMcpForOpenCode(mcpEndpoint, cfg.workspaceId);
    case "auggie":
      return ensureMcpForAuggie(mcpEndpoint, cfg.workspaceId);
    case "claude":
      return ensureMcpForClaude(mcpEndpoint, cfg.workspaceId);
    case "codex":
      return ensureMcpForCodex(mcpEndpoint);
    default:
      return { mcpConfigs: [], summary: `${providerId}: unknown` };
  }
}

// ─── OpenCode ──────────────────────────────────────────────────────────
//
// Config lives at ~/.config/opencode/opencode.json
// We merge a "routa-coordination" entry into the top-level "mcp" object,
// preserving any existing entries the user already has.

const OPENCODE_CONFIG_DIR = path.join(os.homedir(), ".config", "opencode");
const OPENCODE_CONFIG_FILE = path.join(OPENCODE_CONFIG_DIR, "opencode.json");

function ensureMcpForOpenCode(
  mcpEndpoint: string,
  _workspaceId?: string,
): McpSetupResult {
  try {
    // Read existing config (or start fresh)
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(OPENCODE_CONFIG_FILE)) {
      const raw = fs.readFileSync(OPENCODE_CONFIG_FILE, "utf-8");
      existing = JSON.parse(raw);
    }

    // Ensure "mcp" key exists
    const mcp = (existing.mcp ?? {}) as Record<string, unknown>;

    // OpenCode schema: type must be "remote" (not "http"),
    // only allows: type, url, enabled, headers, oauth, timeout
    mcp["routa-coordination"] = {
      type: "remote",
      url: mcpEndpoint,
      enabled: true,
    };

    existing.mcp = mcp;

    // Write back
    fs.mkdirSync(OPENCODE_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
      OPENCODE_CONFIG_FILE,
      JSON.stringify(existing, null, 2) + "\n",
      "utf-8",
    );

    console.log(
      `[MCP:OpenCode] Wrote routa-coordination to ${OPENCODE_CONFIG_FILE}`,
    );

    // OpenCode reads the file itself – nothing to pass on the CLI
    return {
      mcpConfigs: [],
      summary: `opencode: wrote ${OPENCODE_CONFIG_FILE}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MCP:OpenCode] Failed to write config: ${msg}`);
    return { mcpConfigs: [], summary: `opencode: config write failed – ${msg}` };
  }
}

// ─── Auggie ────────────────────────────────────────────────────────────
//
// Auggie accepts  --mcp-config <file-path>
// The file must be a JSON object: { mcpServers: { name: { url, type, … } } }

const AUGGIE_CONFIG_DIR = path.join(os.homedir(), ".augment");
const AUGGIE_MCP_CONFIG_FILE = path.join(AUGGIE_CONFIG_DIR, "mcp-config.json");

function ensureMcpForAuggie(
  mcpEndpoint: string,
  workspaceId?: string,
): McpSetupResult {
  try {
    const mcpConfigObj = {
      mcpServers: {
        "routa-coordination": {
          url: mcpEndpoint,
          type: "http",
          env: {
            ROUTA_WORKSPACE_ID: workspaceId || "default",
          },
        },
      },
    };

    fs.mkdirSync(AUGGIE_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
      AUGGIE_MCP_CONFIG_FILE,
      JSON.stringify(mcpConfigObj, null, 2) + "\n",
      "utf-8",
    );

    console.log(
      `[MCP:Auggie] Wrote routa-coordination to ${AUGGIE_MCP_CONFIG_FILE}`,
    );

    // Pass the *file path* on the CLI
    return {
      mcpConfigs: [AUGGIE_MCP_CONFIG_FILE],
      summary: `auggie: --mcp-config ${AUGGIE_MCP_CONFIG_FILE}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MCP:Auggie] Failed to write config: ${msg}`);
    return { mcpConfigs: [], summary: `auggie: config write failed – ${msg}` };
  }
}

// ─── Claude Code ───────────────────────────────────────────────────────
//
// Claude Code accepts inline JSON via --mcp-config <json>

function ensureMcpForClaude(
  mcpEndpoint: string,
  workspaceId?: string,
): McpSetupResult {
  const json = JSON.stringify({
    mcpServers: {
      "routa-coordination": {
        url: mcpEndpoint,
        type: "http",
        env: {
          ROUTA_WORKSPACE_ID: workspaceId || "default",
        },
      },
    },
  });

  return {
    mcpConfigs: [json],
    summary: `claude: inline JSON (${json.length} bytes)`,
  };
}

// ─── Codex (OpenAI) ─────────────────────────────────────────────────────
//
// Codex stores MCP config in TOML format at ~/.codex/config.toml
// https://developers.openai.com/codex/mcp/
//
// Streamable HTTP servers use:
//   [mcp_servers.<server-name>]
//   url = "http://..."
//   enabled = true
//
// We merge a "routa-coordination" entry preserving all existing settings.

const CODEX_CONFIG_DIR = path.join(os.homedir(), ".codex");
const CODEX_CONFIG_FILE = path.join(CODEX_CONFIG_DIR, "config.toml");

function ensureMcpForCodex(mcpEndpoint: string): McpSetupResult {
  try {
    // Read existing config (or start fresh)
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(CODEX_CONFIG_FILE)) {
      const raw = fs.readFileSync(CODEX_CONFIG_FILE, "utf-8");
      existing = TOML.parse(raw) as Record<string, unknown>;
    }

    // Ensure "mcp_servers" key exists as an object
    const mcpServers = (existing.mcp_servers ?? {}) as Record<
      string,
      unknown
    >;

    // Add / update the routa-coordination server entry
    mcpServers["routa-coordination"] = {
      url: mcpEndpoint,
      enabled: true,
    };

    existing.mcp_servers = mcpServers;

    // Write back
    fs.mkdirSync(CODEX_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
      CODEX_CONFIG_FILE,
      TOML.stringify(existing as Record<string, unknown>) + "\n",
      "utf-8",
    );

    console.log(
      `[MCP:Codex] Wrote routa-coordination to ${CODEX_CONFIG_FILE}`,
    );

    // Codex reads the config file itself – nothing to pass on the CLI
    return {
      mcpConfigs: [],
      summary: `codex: wrote ${CODEX_CONFIG_FILE}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MCP:Codex] Failed to write config: ${msg}`);
    return {
      mcpConfigs: [],
      summary: `codex: config write failed – ${msg}`,
    };
  }
}

// ─── Legacy convenience wrappers ───────────────────────────────────────

/** @deprecated Use ensureMcpForProvider("claude", config) */
export function setupMcpForProvider(
  providerId: McpSupportedProvider,
  config?: RoutaMcpConfig,
): string[] {
  return ensureMcpForProvider(providerId, config).mcpConfigs;
}

export function setupMcpForClaudeCode(config?: RoutaMcpConfig): string[] {
  return ensureMcpForProvider("claude", config).mcpConfigs;
}

export function setupMcpForAuggie(config?: RoutaMcpConfig): string[] {
  return ensureMcpForProvider("auggie", config).mcpConfigs;
}

export function setupMcpForCodex(config?: RoutaMcpConfig): string[] {
  return ensureMcpForProvider("codex", config).mcpConfigs;
}

// ─── Helpers (unchanged) ───────────────────────────────────────────────

export function isMcpConfigured(mcpConfigs?: string[]): boolean {
  return !!mcpConfigs && mcpConfigs.length > 0;
}

export function getMcpStatus(
  providerId: string,
  mcpConfigs?: string[],
): { supported: boolean; configured: boolean; configCount: number } {
  return {
    supported: providerSupportsMcp(providerId),
    configured: isMcpConfigured(mcpConfigs),
    configCount: mcpConfigs?.length || 0,
  };
}
