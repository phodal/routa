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
 *   │  claude    │  stdio proxy script via --mcp-config <file>        │
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
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import TOML from "smol-toml";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import {
  getDefaultRoutaMcpConfig,
  type RoutaMcpConfig,
} from "./mcp-config-generator";
import { getServerBridge } from "@/core/platform";
import {
  type CustomMcpServerConfig,
  getCustomMcpServerStore,
  mergeCustomMcpServers,
} from "../store/custom-mcp-server-store";

// ─── Types ─────────────────────────────────────────────────────────────

export type McpSupportedProvider =
  | "claude"
  | "auggie"
  | "opencode"
  | "codex"
  | "gemini"
  | "kimi"
  | "copilot"
  | "qoder";

export interface McpSetupCleanup {
  action: "qoder-remove";
  providerId: string;
  serverName: string;
  scope: "local" | "project" | "user";
  cwd: string;
}

/**
 * Result of a file-based MCP setup (OpenCode / Auggie).
 * `mcpConfigs` is the array of strings that should end up in
 * AcpProcessConfig.mcpConfigs (empty for OpenCode because it reads a file).
 */
export interface McpSetupResult {
  /** Strings to pass as --mcp-config <value> */
  mcpConfigs: string[];
  /** Additional provider-specific CLI arguments (for example Codex -c overrides) */
  providerArgs?: string[];
  /** Human-readable summary for logs */
  summary: string;
  /** Provider-specific teardown instructions for session-end cleanup */
  cleanup?: McpSetupCleanup;
}

// ─── Public API ────────────────────────────────────────────────────────

function normalizeProviderIdForMcp(providerId: string): string {
  return providerId.endsWith("-registry")
    ? providerId.slice(0, -"-registry".length)
    : providerId;
}

export function providerSupportsMcp(providerId: string): boolean {
  const baseId = normalizeProviderIdForMcp(providerId);
  if (baseId === "codex-acp") {
    return true;
  }
  const supported: McpSupportedProvider[] = ["claude", "auggie", "opencode", "codex", "gemini", "kimi", "copilot", "qoder"];
  return supported.includes(baseId as McpSupportedProvider);
}

const QODER_MCP_SERVER_NAME = "routa-coordination";
const QODER_MCP_SCOPE = "local" as const;

interface CommandResult {
  stdout: string;
  stderr: string;
}

function resolveProviderCommand(providerId: string, fallbackCommand: string): string {
  if (providerId === "qoder") {
    const override = process.env.QODER_BIN?.trim();
    if (override) {
      return override;
    }
  }

  return fallbackCommand;
}

async function runCommand(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> },
): Promise<CommandResult> {
  const bridge = getServerBridge();
  if (!bridge.process.isAvailable()) {
    throw new Error("Process execution is not available on this platform");
  }

  const inheritedEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const env: Record<string, string> = options?.env
    ? { ...inheritedEnv, ...options.env }
    : inheritedEnv;
  if (options?.cwd) {
    // Some CLIs scope project-local config using the inherited PWD env var
    // rather than only getcwd(2). Keep both aligned when we override cwd.
    try {
      env.PWD = fs.realpathSync(options.cwd);
    } catch {
      env.PWD = options.cwd;
    }
  }

  const handle = bridge.process.spawn(command, args, {
    cwd: options?.cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    detached: false,
  });

  let stdout = "";
  let stderr = "";

  handle.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf-8");
  });
  handle.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf-8");
  });

  const exitPromise = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    handle.on("exit", (code, signal) => resolve({ code, signal }));
    handle.on("error", reject);
  });

  if (handle.ready) {
    await handle.ready;
  }

  const exit = await exitPromise;

  if ((exit.code ?? 0) !== 0) {
    const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
    const signalSuffix = exit.signal ? `, signal=${exit.signal}` : "";
    throw new Error(
      output
        ? `exit code ${exit.code ?? "unknown"}${signalSuffix}: ${output}`
        : `exit code ${exit.code ?? "unknown"}${signalSuffix}`,
    );
  }

  return { stdout, stderr };
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

  const baseId = normalizeProviderIdForMcp(providerId);

  switch (baseId) {
    case "opencode":
      return await ensureMcpForOpenCode(mcpEndpoint, cfg.workspaceId, customServers);
    case "auggie":
      return await ensureMcpForAuggie(mcpEndpoint, cfg.workspaceId, customServers);
    case "claude":
      return await ensureMcpForClaude(mcpEndpoint, cfg.workspaceId, customServers);
    case "codex":
      return await ensureMcpForCodex(mcpEndpoint, customServers, cfg.cwd);
    case "codex-acp":
      return {
        mcpConfigs: [],
        summary: "codex-acp: ACP mcpServers only",
      };
    case "gemini":
      return await ensureMcpForGemini(mcpEndpoint, customServers);
    case "kimi":
      return await ensureMcpForKimi(mcpEndpoint, customServers);
    case "copilot":
      return await ensureMcpForCopilot(mcpEndpoint, cfg.workspaceId, customServers);
    case "qoder":
      return await ensureMcpForQoder(mcpEndpoint, cfg.cwd);
    default:
      return { mcpConfigs: [], summary: `${providerId}: unknown` };
  }
}

export async function cleanupMcpForProvider(cleanup: McpSetupCleanup): Promise<string> {
  switch (cleanup.action) {
    case "qoder-remove": {
      const command = resolveProviderCommand(cleanup.providerId, "qodercli");
      try {
        await runCommand(
          command,
          ["mcp", "remove", cleanup.serverName, "-s", cleanup.scope],
          { cwd: cleanup.cwd },
        );
        return `qoder: removed ${cleanup.serverName} from ${cleanup.scope} config`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `qoder: mcp remove failed – ${message}`;
      }
    }
    default:
      return `${cleanup.providerId}: no cleanup action`;
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
// Claude Code accepts --mcp-config <json|file-path>.
// We write a temporary JSON file and pass the file path to avoid shell
// escaping issues on Windows (cmd.exe mangles {}, :, & in inline JSON
// when shell:true is used for .cmd/.bat binaries).

const CLAUDE_MCP_CONFIG_PREFIX = "routa-mcp-";
const CLAUDE_MCP_CONFIG_DIRNAME = path.join(".claude", "mcp-tmp");
const CLAUDE_MCP_CONFIG_MAX_FILES = 64;
const CLAUDE_MCP_CONFIG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CLAUDE_PROXY_SCRIPT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../scripts/mcp-http-proxy.mjs",
);

function getClaudeMcpConfigDir(): string {
  return path.join(os.homedir(), CLAUDE_MCP_CONFIG_DIRNAME);
}

function toClaudeProxyServerConfig(
  proxyScriptPath: string,
  endpoint: string,
  env?: Record<string, string>,
  headers?: Record<string, string>,
): Record<string, unknown> {
  const args = headers && Object.keys(headers).length > 0
    ? [proxyScriptPath, endpoint, JSON.stringify(headers)]
    : [proxyScriptPath, endpoint];

  return {
    command: process.execPath,
    args,
    ...(env && Object.keys(env).length > 0 ? { env } : {}),
  };
}

function pruneClaudeMcpConfigDir(configDir: string, currentConfigPath: string): void {
  const now = Date.now();

  type ClaudeConfigFile = {
    path: string;
    mtimeMs: number;
  };

  const files: ClaudeConfigFile[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(configDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.startsWith(CLAUDE_MCP_CONFIG_PREFIX) || !entry.name.endsWith(".json")) {
      continue;
    }

    const filePath = path.join(configDir, entry.name);
    try {
      const stats = fs.statSync(filePath);
      files.push({ path: filePath, mtimeMs: stats.mtimeMs });
    } catch {
      // Ignore files that disappear mid-prune.
    }
  }

  files.sort((left, right) => right.mtimeMs - left.mtimeMs);

  let keptStaleConfigs = 0;
  for (const file of files) {
    if (file.path === currentConfigPath) {
      continue;
    }

    const ageMs = Math.max(0, now - file.mtimeMs);
    const shouldKeep =
      ageMs <= CLAUDE_MCP_CONFIG_MAX_AGE_MS &&
      keptStaleConfigs < CLAUDE_MCP_CONFIG_MAX_FILES;

    if (shouldKeep) {
      keptStaleConfigs += 1;
      continue;
    }

    try {
      fs.unlinkSync(file.path);
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function ensureMcpForClaude(
  mcpEndpoint: string,
  workspaceId?: string,
  customServers: CustomMcpServerConfig[] = [],
): McpSetupResult {
  // Claude Code CLI's --mcp-config only supports stdio-type MCP servers.
  // HTTP/SSE type configs are silently ignored (tested on CLI <=2.1.x).
  // Solution: use a stdio proxy script that forwards to Routa's Streamable HTTP endpoint.
  const proxyScriptPath = CLAUDE_PROXY_SCRIPT_PATH;
  if (!fs.existsSync(proxyScriptPath)) {
    throw new Error(`Claude MCP proxy script not found at ${proxyScriptPath}`);
  }

  const builtIn: Record<string, unknown> = {
    "routa-coordination": toClaudeProxyServerConfig(
      proxyScriptPath,
      mcpEndpoint,
      { ROUTA_WORKSPACE_ID: workspaceId || "" },
    ),
  };
  const mcpServers = mergeCustomMcpServers(builtIn, []);
  for (const server of customServers) {
    if (!server.enabled || mcpServers[server.name]) {
      continue;
    }

    if (server.type === "stdio") {
      mcpServers[server.name] = {
        type: "stdio",
        command: server.command,
        args: server.args ?? [],
        ...(server.env && Object.keys(server.env).length > 0 ? { env: server.env } : {}),
      };
      continue;
    }

    if (server.type === "http" && server.url) {
      mcpServers[server.name] = toClaudeProxyServerConfig(
        proxyScriptPath,
        server.url,
        server.env,
        server.headers,
      );
      continue;
    }

    console.warn(
      `[MCP:Claude] Skipping custom server "${server.name}" of type "${server.type}" because Claude only supports stdio servers`,
    );
  }

  const mcpConfigObj = { mcpServers };
  const json = JSON.stringify(mcpConfigObj);

  // Write to a temp file so shell:true on Windows doesn't mangle the JSON.
  // Use a stable filename keyed by workspaceId + mcpEndpoint hash so that
  // sessions with different mcpProfile (e.g. kanban-planning vs coordination)
  // get separate config files instead of overwriting each other.
  const hash = workspaceId
    ? Buffer.from(workspaceId).toString("base64url").slice(0, 16)
    : "default";
  // Include a short hash of the mcpEndpoint so different profiles (which have
  // different query params like mcpProfile=kanban-planning) produce different
  // files. This prevents a later session without mcpProfile from overwriting
  // an earlier kanban-planning session's config file.
  // SHA-256 digest ensures uniform distribution even when URLs share a long
  // common prefix (e.g. http://localhost:3000/api/mcp?wsId=...).
  const endpointDigest = createHash("sha256")
    .update(mcpEndpoint)
    .digest("base64url")
    .slice(0, 12);
  const configDir = getClaudeMcpConfigDir();
  const configPath = path.join(configDir, `${CLAUDE_MCP_CONFIG_PREFIX}${hash}-${endpointDigest}.json`);

  try {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(configPath, json, { encoding: "utf-8", mode: 0o600 });
    pruneClaudeMcpConfigDir(configDir, configPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (process.platform === "win32") {
      throw new Error(`Failed to write Claude MCP config file: ${msg}`, {
        cause: err,
      });
    }

    // Fallback to inline JSON if file write fails on non-Windows.
    console.warn(`[MCP:Claude] Failed to write config file: ${msg}, falling back to inline JSON`);
    return {
      mcpConfigs: [json],
      summary: `claude: inline JSON fallback (${json.length} bytes)`,
    };
  }

  return {
    mcpConfigs: [configPath],
    summary: `claude: config file ${configPath}`,
  };
}

// ─── Codex (OpenAI) ─────────────────────────────────────────────────────
//
// Routa keeps Codex MCP state in a private overlay and passes the effective
// values via `codex-acp -c key=value` overrides. This avoids mutating the
// user's shared ~/.codex/config.toml while still using Codex's highest-
// precedence config surface.

const ROUTA_CODEX_CONFIG_DIR = path.join(os.homedir(), ".routa", "codex");
const ROUTA_CODEX_CONFIG_FILE = path.join(ROUTA_CODEX_CONFIG_DIR, "config.toml");

type CodexServerConfig = {
  enabled: boolean;
  url?: string;
  type?: "stdio";
  command?: string;
  args?: string[];
};

function normalizeCodexServerConfigs(
  mcpEndpoint: string,
  customServers: CustomMcpServerConfig[] = [],
): Record<string, CodexServerConfig> {
  const builtIn: Record<string, unknown> = {
    "routa-coordination": { url: mcpEndpoint, enabled: true },
  };
  const merged = mergeCustomMcpServers(builtIn, customServers);
  const normalized: Record<string, CodexServerConfig> = {};

  for (const [name, cfg] of Object.entries(merged)) {
    const serverCfg = cfg as Record<string, unknown>;
    if (serverCfg.type === "stdio") {
      const args = Array.isArray(serverCfg.args)
        ? serverCfg.args.filter((arg): arg is string => typeof arg === "string")
        : undefined;
      normalized[name] = {
        type: "stdio",
        enabled: true,
        ...(typeof serverCfg.command === "string" ? { command: serverCfg.command } : {}),
        ...(args ? { args } : {}),
      };
      continue;
    }

    normalized[name] = {
      enabled: true,
      ...(typeof serverCfg.url === "string" ? { url: serverCfg.url } : {}),
    };
  }

  return normalized;
}

function quoteCodexConfigSegment(segment: string): string {
  return /^[A-Za-z0-9_-]+$/.test(segment) ? segment : JSON.stringify(segment);
}

function buildCodexProjectTrustOverride(cwd: string): string {
  return `projects.${JSON.stringify(cwd)}.trust_level="trusted"`;
}

function buildCodexProviderArgs(
  cwd: string | undefined,
  mcpServers: Record<string, CodexServerConfig>,
): string[] {
  const overrides: string[] = [];

  if (cwd) {
    overrides.push(buildCodexProjectTrustOverride(cwd));
  }

  for (const [name, serverCfg] of Object.entries(mcpServers)) {
    const serverPath = `mcp_servers.${quoteCodexConfigSegment(name)}`;
    if (serverCfg.url) {
      overrides.push(`${serverPath}.url=${JSON.stringify(serverCfg.url)}`);
    }
    if (serverCfg.type) {
      overrides.push(`${serverPath}.type=${JSON.stringify(serverCfg.type)}`);
    }
    if (serverCfg.command) {
      overrides.push(`${serverPath}.command=${JSON.stringify(serverCfg.command)}`);
    }
    if (serverCfg.args) {
      overrides.push(`${serverPath}.args=${JSON.stringify(serverCfg.args)}`);
    }
    overrides.push(`${serverPath}.enabled=${serverCfg.enabled ? "true" : "false"}`);
  }

  return overrides.flatMap((override) => ["-c", override]);
}

async function ensureMcpForCodex(
  mcpEndpoint: string,
  customServers: CustomMcpServerConfig[] = [],
  cwd?: string,
): Promise<McpSetupResult> {
  try {
    const mcpServers = normalizeCodexServerConfigs(mcpEndpoint, customServers);
    const providerArgs = buildCodexProviderArgs(cwd, mcpServers);

    await fs.promises.mkdir(ROUTA_CODEX_CONFIG_DIR, { recursive: true });
    await fs.promises.writeFile(
      ROUTA_CODEX_CONFIG_FILE,
      TOML.stringify({ mcp_servers: mcpServers }) + "\n",
      "utf-8",
    );

    console.log(
      `[MCP:Codex] Wrote private Routa overlay to ${ROUTA_CODEX_CONFIG_FILE}`,
    );

    return {
      mcpConfigs: [],
      providerArgs,
      summary: `codex: wrote private overlay ${ROUTA_CODEX_CONFIG_FILE}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MCP:Codex] Failed to write config: ${msg}`);
    return {
      mcpConfigs: [],
      providerArgs: [],
      summary: `codex: private overlay write failed – ${msg}`,
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

async function ensureMcpForQoder(
  mcpEndpoint: string,
  cwd?: string,
): Promise<McpSetupResult> {
  const command = resolveProviderCommand("qoder", "qodercli");
  const effectiveCwd = cwd?.trim() || process.cwd();

  try {
    await runCommand(
      command,
      [
        "mcp",
        "add",
        QODER_MCP_SERVER_NAME,
        mcpEndpoint,
        "-t",
        "streamable-http",
        "-s",
        QODER_MCP_SCOPE,
      ],
      { cwd: effectiveCwd },
    );

    return {
      mcpConfigs: [],
      summary: `qoder: added ${QODER_MCP_SERVER_NAME} via ${QODER_MCP_SCOPE} config`,
      cleanup: {
        action: "qoder-remove",
        providerId: "qoder",
        serverName: QODER_MCP_SERVER_NAME,
        scope: QODER_MCP_SCOPE,
        cwd: effectiveCwd,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MCP:Qoder] Failed to add MCP server: ${msg}`);
    return {
      mcpConfigs: [],
      summary: `qoder: mcp add failed – ${msg}`,
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

export async function setupMcpForQoder(config?: RoutaMcpConfig): Promise<string[]> {
  return (await ensureMcpForProvider("qoder", config)).mcpConfigs;
}

// ─── Helpers (unchanged) ───────────────────────────────────────────────

export function isMcpConfigured(mcpConfigs?: string[]): boolean {
  return !!mcpConfigs && mcpConfigs.length > 0;
}

/**
 * Parse MCP config into the SDK's `mcpServers` object.
 * Supports both inline JSON strings and file paths (reads file content).
 * Ignores unreadable entries so callers can fall back safely.
 */
export function parseMcpServersFromConfigs(mcpConfigs?: string[]): Record<string, McpServerConfig> | undefined {
  if (!mcpConfigs || mcpConfigs.length === 0) {
    return undefined;
  }

  const merged: Record<string, McpServerConfig> = {};

  for (const rawConfig of mcpConfigs) {
    let jsonStr = rawConfig;

    // If it looks like a file path (not starting with '{'), try reading the file
    if (!rawConfig.trimStart().startsWith("{")) {
      try {
        jsonStr = fs.readFileSync(rawConfig, "utf-8");
      } catch {
        // Not a readable file path — skip
        continue;
      }
    }

    try {
      const parsed = JSON.parse(jsonStr) as { mcpServers?: Record<string, McpServerConfig> } | null;
      if (parsed?.mcpServers && typeof parsed.mcpServers === "object") {
        Object.assign(merged, parsed.mcpServers);
      }
    } catch {
      // Ignore unparseable configs
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
