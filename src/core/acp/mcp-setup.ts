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
 *   │  gemini    │  Merge into ~/.gemini/settings.json (JSON)           │
 *   │            │  mcpServers.routa-coordination { httpUrl }           │
 *   │  kimi      │  Merge into ~/.kimi/config.toml (TOML format)       │
 *   │            │  [mcp.servers.routa-coordination]                    │
 *   │  copilot   │  Merge into ~/.copilot/mcp-config.json (JSON)       │
 *   │            │  Copilot reads this file automatically              │
 *   └────────────┴────────────────────────────────────────────────────────┘
 *
 * Docs:
 *   - Codex:  https://developers.openai.com/codex/mcp/
 *   - Gemini: https://geminicli.com/docs/tools/mcp-server/
 *   - Kimi:   https://moonshotai.github.io/kimi-cli/en/configuration/config-files.html#mcp
 *   - Copilot: https://docs.github.com/copilot/customizing-copilot/extending-copilot-coding-agent-with-mcp
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import TOML from "smol-toml";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import {
  getDefaultRoutaMcpConfig,
  type RoutaMcpConfig,
} from "./mcp-config-generator";
import {
  type CustomMcpServerConfig,
  getCustomMcpServerStore,
  mergeCustomMcpServers,
} from "../store/custom-mcp-server-store";

// ─── Types ─────────────────────────────────────────────────────────────

export type McpSupportedProvider = "claude" | "auggie" | "opencode" | "codex" | "gemini" | "kimi" | "copilot";

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
  // Strip -registry suffix to check base provider ID
  const baseId = providerId.endsWith("-registry")
    ? providerId.slice(0, -"-registry".length)
    : providerId;
  const supported: McpSupportedProvider[] = ["claude", "auggie", "opencode", "codex", "gemini", "kimi", "copilot"];
  return supported.includes(baseId as McpSupportedProvider);
}

/**
 * Load enabled custom MCP servers from the database.
 * Returns an empty array if the database is unavailable.
 */
async function loadCustomMcpServers(workspaceId?: string): Promise<CustomMcpServerConfig[]> {
  try {
    const store = getCustomMcpServerStore();
    if (!store) return [];
    return await store.listEnabled(workspaceId);
  } catch (err) {
    console.warn("[MCP] Failed to load custom MCP servers:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Ensure MCP is configured for `providerId` and return the values that
 * should be forwarded to the process (if any).
 *
 * Call this **before** spawning the process.
 *
 * When `config.includeCustomServers` is not explicitly false, custom MCP servers
 * from the database are merged alongside the built-in routa-coordination server.
 */
export async function ensureMcpForProvider(
  providerId: string,
  config?: RoutaMcpConfig,
): Promise<McpSetupResult> {
  if (!providerSupportsMcp(providerId)) {
    return { mcpConfigs: [], summary: `${providerId}: MCP not supported` };
  }

  const cfg = config || getDefaultRoutaMcpConfig();
  // Use the direct endpoint override if the standalone MCP server is running
  const mcpEndpoint = cfg.mcpEndpoint || `${cfg.routaServerUrl}/api/mcp`;

  // Load custom MCP servers from DB
  let customServers: CustomMcpServerConfig[] = [];
  if (cfg.includeCustomServers !== false) {
    customServers = await loadCustomMcpServers(cfg.workspaceId);
    if (customServers.length > 0) {
      console.log(`[MCP] Loaded ${customServers.length} custom MCP server(s)`);
    }
  }

  // Strip -registry suffix to get base provider ID for MCP setup
  const baseId = providerId.endsWith("-registry")
    ? providerId.slice(0, -"-registry".length)
    : providerId;

  switch (baseId) {
    case "opencode":
      return await ensureMcpForOpenCode(mcpEndpoint, cfg.workspaceId, customServers);
    case "auggie":
      return await ensureMcpForAuggie(mcpEndpoint, cfg.workspaceId, customServers);
    case "claude":
      return await ensureMcpForClaude(mcpEndpoint, cfg.workspaceId, customServers);
    case "codex":
      return await ensureMcpForCodex(mcpEndpoint, customServers);
    case "gemini":
      return await ensureMcpForGemini(mcpEndpoint, customServers);
    case "kimi":
      return await ensureMcpForKimi(mcpEndpoint, customServers);
    case "copilot":
      return await ensureMcpForCopilot(mcpEndpoint, cfg.workspaceId, customServers);
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

async function ensureMcpForOpenCode(
  mcpEndpoint: string,
  _workspaceId?: string,
  customServers: CustomMcpServerConfig[] = [],
): Promise<McpSetupResult> {
  try {
    // Read existing config (or start fresh)
    let existing: Record<string, unknown> = {};
    try {
      const raw = await fs.promises.readFile(OPENCODE_CONFIG_FILE, "utf-8");
      existing = JSON.parse(raw);
    } catch {
      // file doesn't exist yet
    }

    // Ensure "mcp" key exists
    const mcp = (existing.mcp ?? {}) as Record<string, unknown>;

    // OpenCode schema: type must be "remote" (not "http"),
    // only allows: type, url, enabled, headers, oauth, timeout
    const builtIn: Record<string, unknown> = {
      "routa-coordination": {
        type: "remote",
        url: mcpEndpoint,
        enabled: true,
      },
    };

    // Merge custom servers (OpenCode uses "remote" for http, "stdio" for stdio)
    const merged = mergeCustomMcpServers(builtIn, customServers);
    for (const [name, cfg] of Object.entries(merged)) {
      const serverCfg = cfg as Record<string, unknown>;
      if (serverCfg.type === "http" || serverCfg.type === "sse") {
        mcp[name] = { type: "remote", url: serverCfg.url, enabled: true };
      } else {
        mcp[name] = { ...serverCfg, enabled: true };
      }
    }

    existing.mcp = mcp;

    // Write back
    await fs.promises.mkdir(OPENCODE_CONFIG_DIR, { recursive: true });
    await fs.promises.writeFile(
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

async function ensureMcpForAuggie(
  mcpEndpoint: string,
  workspaceId?: string,
  customServers: CustomMcpServerConfig[] = [],
): Promise<McpSetupResult> {
  try {
    const builtIn: Record<string, unknown> = {
      "routa-coordination": {
        url: mcpEndpoint,
        type: "http",
        env: { ROUTA_WORKSPACE_ID: workspaceId || "" },
      },
    };
    const mcpConfigObj = {
      mcpServers: mergeCustomMcpServers(builtIn, customServers),
    };

    await fs.promises.mkdir(AUGGIE_CONFIG_DIR, { recursive: true });
    await fs.promises.writeFile(
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
  customServers: CustomMcpServerConfig[] = [],
): McpSetupResult {
  const builtIn: Record<string, unknown> = {
    "routa-coordination": {
      url: mcpEndpoint,
      type: "http",
      env: { ROUTA_WORKSPACE_ID: workspaceId || "" },
    },
  };
  const json = JSON.stringify({
    mcpServers: mergeCustomMcpServers(builtIn, customServers),
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

async function ensureMcpForCodex(mcpEndpoint: string, customServers: CustomMcpServerConfig[] = []): Promise<McpSetupResult> {
  try {
    // Read existing config (or start fresh)
    let existing: Record<string, unknown> = {};
    try {
      const raw = await fs.promises.readFile(CODEX_CONFIG_FILE, "utf-8");
      existing = TOML.parse(raw) as Record<string, unknown>;
    } catch {
      // file doesn't exist yet
    }

    // Ensure "mcp_servers" key exists as an object
    const mcpServers = (existing.mcp_servers ?? {}) as Record<string, unknown>;

    // Built-in server
    const builtIn: Record<string, unknown> = {
      "routa-coordination": { url: mcpEndpoint, enabled: true },
    };
    // Merge custom servers — Codex uses url-based entries with enabled flag
    const merged = mergeCustomMcpServers(builtIn, customServers);
    for (const [name, cfg] of Object.entries(merged)) {
      const serverCfg = cfg as Record<string, unknown>;
      if (serverCfg.type === "stdio") {
        mcpServers[name] = { command: serverCfg.command, args: serverCfg.args ?? [], enabled: true };
      } else {
        mcpServers[name] = { url: serverCfg.url, enabled: true };
      }
    }

    existing.mcp_servers = mcpServers;

    // Write back
    await fs.promises.mkdir(CODEX_CONFIG_DIR, { recursive: true });
    await fs.promises.writeFile(
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

// ─── Gemini CLI ─────────────────────────────────────────────────────────
//
// Gemini stores MCP config in JSON format at ~/.gemini/settings.json
// https://geminicli.com/docs/tools/mcp-server/
//
// Streamable HTTP servers use "httpUrl" (NOT "url" which is for SSE):
//   { "mcpServers": { "<name>": { "httpUrl": "...", "timeout": 30000 } } }
//
// We merge a "routa-coordination" entry preserving all existing settings.

const GEMINI_CONFIG_DIR = path.join(os.homedir(), ".gemini");
const GEMINI_CONFIG_FILE = path.join(GEMINI_CONFIG_DIR, "settings.json");

async function ensureMcpForGemini(mcpEndpoint: string, customServers: CustomMcpServerConfig[] = []): Promise<McpSetupResult> {
  try {
    // Read existing settings (or start fresh)
    let existing: Record<string, unknown> = {};
    try {
      const raw = await fs.promises.readFile(GEMINI_CONFIG_FILE, "utf-8");
      existing = JSON.parse(raw);
    } catch {
      // file doesn't exist yet
    }

    // Ensure "mcpServers" key exists
    const mcpServers = (existing.mcpServers ?? {}) as Record<string, unknown>;

    // Built-in: Gemini uses "httpUrl" for Streamable HTTP transport
    const builtIn: Record<string, unknown> = {
      "routa-coordination": { httpUrl: mcpEndpoint, timeout: 30000 },
    };
    // Merge custom servers — Gemini uses httpUrl for http, command for stdio
    const merged = mergeCustomMcpServers(builtIn, customServers);
    for (const [name, cfg] of Object.entries(merged)) {
      const serverCfg = cfg as Record<string, unknown>;
      if (name === "routa-coordination") {
        mcpServers[name] = serverCfg; // already formatted
      } else if (serverCfg.type === "stdio") {
        mcpServers[name] = { command: serverCfg.command, args: serverCfg.args ?? [], timeout: 30000 };
      } else {
        mcpServers[name] = { httpUrl: serverCfg.url, timeout: 30000 };
      }
    }

    existing.mcpServers = mcpServers;

    // Write back
    await fs.promises.mkdir(GEMINI_CONFIG_DIR, { recursive: true });
    await fs.promises.writeFile(
      GEMINI_CONFIG_FILE,
      JSON.stringify(existing, null, 2) + "\n",
      "utf-8",
    );

    console.log(
      `[MCP:Gemini] Wrote routa-coordination to ${GEMINI_CONFIG_FILE}`,
    );

    // Gemini reads settings.json itself – nothing to pass on the CLI
    return {
      mcpConfigs: [],
      summary: `gemini: wrote ${GEMINI_CONFIG_FILE}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MCP:Gemini] Failed to write config: ${msg}`);
    return {
      mcpConfigs: [],
      summary: `gemini: config write failed – ${msg}`,
    };
  }
}

// ─── Kimi CLI ───────────────────────────────────────────────────────────
//
// Kimi stores config in TOML format at ~/.kimi/config.toml
// https://moonshotai.github.io/kimi-cli/en/configuration/config-files.html#mcp
//
// Existing [mcp] section has [mcp.client] for client behavior.
// MCP server definitions go under [mcp.servers.<name>]:
//
//   [mcp.servers.routa-coordination]
//   type = "http"
//   url  = "http://..."
//
// We merge into the existing config preserving all user settings.

const KIMI_CONFIG_DIR = path.join(os.homedir(), ".kimi");
const KIMI_CONFIG_FILE = path.join(KIMI_CONFIG_DIR, "config.toml");

async function ensureMcpForKimi(mcpEndpoint: string, customServers: CustomMcpServerConfig[] = []): Promise<McpSetupResult> {
  try {
    // Read existing config (or start fresh)
    let existing: Record<string, unknown> = {};
    try {
      const raw = await fs.promises.readFile(KIMI_CONFIG_FILE, "utf-8");
      existing = TOML.parse(raw) as Record<string, unknown>;
    } catch {
      // file doesn't exist yet
    }

    // Ensure nested "mcp" → "servers" path exists
    const mcp = (existing.mcp ?? {}) as Record<string, unknown>;
    const servers = (mcp.servers ?? {}) as Record<string, unknown>;

    // Built-in server
    const builtIn: Record<string, unknown> = {
      "routa-coordination": { type: "http", url: mcpEndpoint },
    };
    const merged = mergeCustomMcpServers(builtIn, customServers);
    for (const [name, cfg] of Object.entries(merged)) {
      servers[name] = cfg;
    }

    mcp.servers = servers;
    existing.mcp = mcp;

    // Write back
    await fs.promises.mkdir(KIMI_CONFIG_DIR, { recursive: true });
    await fs.promises.writeFile(
      KIMI_CONFIG_FILE,
      TOML.stringify(existing as Record<string, unknown>) + "\n",
      "utf-8",
    );

    console.log(
      `[MCP:Kimi] Wrote routa-coordination to ${KIMI_CONFIG_FILE}`,
    );

    // Kimi reads config.toml itself – nothing to pass on the CLI
    return {
      mcpConfigs: [],
      summary: `kimi: wrote ${KIMI_CONFIG_FILE}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MCP:Kimi] Failed to write config: ${msg}`);
    return {
      mcpConfigs: [],
      summary: `kimi: config write failed – ${msg}`,
    };
  }
}

// ─── GitHub Copilot ─────────────────────────────────────────────────────
//
// GitHub Copilot CLI reads MCP config from ~/.copilot/mcp-config.json
// and also supports --additional-mcp-config <json|@file> for extra servers.
// https://docs.github.com/copilot/customizing-copilot/extending-copilot-coding-agent-with-mcp
//
// We write to the default config file (~/.copilot/mcp-config.json) so that
// the config is picked up automatically without needing special CLI flags.
//
// Format: { "mcpServers": { "<name>": { "type": "http", "url": "...", "tools": ["*"] } } }

const COPILOT_CONFIG_DIR = path.join(os.homedir(), ".copilot");
const COPILOT_MCP_CONFIG_FILE = path.join(COPILOT_CONFIG_DIR, "mcp-config.json");

async function ensureMcpForCopilot(
  mcpEndpoint: string,
  workspaceId?: string,
  customServers: CustomMcpServerConfig[] = [],
): Promise<McpSetupResult> {
  try {
    // Read existing config (or start fresh)
    let existing: Record<string, unknown> = {};
    try {
      const raw = await fs.promises.readFile(COPILOT_MCP_CONFIG_FILE, "utf-8");
      existing = JSON.parse(raw);
    } catch {
      // file doesn't exist yet
    }

    // Ensure "mcpServers" key exists
    const mcpServers = (existing.mcpServers ?? {}) as Record<string, unknown>;

    // Built-in server
    const builtIn: Record<string, unknown> = {
      "routa-coordination": {
        type: "http",
        url: mcpEndpoint,
        tools: ["*"],
        env: { ROUTA_WORKSPACE_ID: workspaceId || "" },
      },
    };
    // Merge custom servers — Copilot uses type, url, tools
    const merged = mergeCustomMcpServers(builtIn, customServers);
    for (const [name, cfg] of Object.entries(merged)) {
      const serverCfg = cfg as Record<string, unknown>;
      if (name === "routa-coordination") {
        mcpServers[name] = serverCfg; // already formatted
      } else {
        mcpServers[name] = { ...serverCfg, tools: ["*"] };
      }
    }

    existing.mcpServers = mcpServers;

    // Write back
    await fs.promises.mkdir(COPILOT_CONFIG_DIR, { recursive: true });
    await fs.promises.writeFile(
      COPILOT_MCP_CONFIG_FILE,
      JSON.stringify(existing, null, 2) + "\n",
      "utf-8",
    );

    console.log(
      `[MCP:Copilot] Wrote routa-coordination to ${COPILOT_MCP_CONFIG_FILE}`,
    );

    // Copilot reads ~/.copilot/mcp-config.json automatically – no CLI args needed
    return {
      mcpConfigs: [],
      summary: `copilot: wrote ${COPILOT_MCP_CONFIG_FILE}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MCP:Copilot] Failed to write config: ${msg}`);
    return {
      mcpConfigs: [],
      summary: `copilot: config write failed – ${msg}`,
    };
  }
}

// ─── Legacy convenience wrappers ───────────────────────────────────────

/** @deprecated Use ensureMcpForProvider("claude", config) */
export async function setupMcpForProvider(
  providerId: McpSupportedProvider,
  config?: RoutaMcpConfig,
): Promise<string[]> {
  return (await ensureMcpForProvider(providerId, config)).mcpConfigs;
}

export async function setupMcpForClaudeCode(config?: RoutaMcpConfig): Promise<string[]> {
  return (await ensureMcpForProvider("claude", config)).mcpConfigs;
}

export async function setupMcpForAuggie(config?: RoutaMcpConfig): Promise<string[]> {
  return (await ensureMcpForProvider("auggie", config)).mcpConfigs;
}

export async function setupMcpForCodex(config?: RoutaMcpConfig): Promise<string[]> {
  return (await ensureMcpForProvider("codex", config)).mcpConfigs;
}

export async function setupMcpForGemini(config?: RoutaMcpConfig): Promise<string[]> {
  return (await ensureMcpForProvider("gemini", config)).mcpConfigs;
}

export async function setupMcpForKimi(config?: RoutaMcpConfig): Promise<string[]> {
  return (await ensureMcpForProvider("kimi", config)).mcpConfigs;
}

export async function setupMcpForCopilot(config?: RoutaMcpConfig): Promise<string[]> {
  return (await ensureMcpForProvider("copilot", config)).mcpConfigs;
}

// ─── Helpers (unchanged) ───────────────────────────────────────────────

export function isMcpConfigured(mcpConfigs?: string[]): boolean {
  return !!mcpConfigs && mcpConfigs.length > 0;
}

/**
 * Parse Claude-style inline MCP config JSON into the SDK's `mcpServers` object.
 * Ignores unreadable entries so callers can fall back safely.
 */
export function parseMcpServersFromConfigs(mcpConfigs?: string[]): Record<string, McpServerConfig> | undefined {
  if (!mcpConfigs || mcpConfigs.length === 0) {
    return undefined;
  }

  const merged: Record<string, McpServerConfig> = {};

  for (const rawConfig of mcpConfigs) {
    try {
      const parsed = JSON.parse(rawConfig) as { mcpServers?: Record<string, McpServerConfig> } | null;
      if (parsed?.mcpServers && typeof parsed.mcpServers === "object") {
        Object.assign(merged, parsed.mcpServers);
      }
    } catch {
      // Ignore non-inline configs; Claude SDK path only relies on JSON strings.
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
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
