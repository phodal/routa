/**
 * MCP Configuration Examples
 *
 * Shows how each provider gets MCP configured:
 *
 *   - OpenCode: config file at ~/.config/opencode/opencode.json
 *   - Auggie:   file at ~/.augment/mcp-config.json, passed via --mcp-config <path>
 *   - Claude:   inline JSON via --mcp-config <json>
 *   - Codex:    TOML config at ~/.codex/config.toml [mcp_servers.routa-coordination]
 */

import { AcpProcess } from "@/core/acp/acp-process";
import { ClaudeCodeProcess } from "@/core/acp/claude-code-process";
import { buildConfigFromPreset } from "@/core/acp/opencode-process";
import { getPresetById } from "@/core/acp/acp-presets";
import { ensureMcpForProvider, getMcpStatus } from "@/core/acp/mcp-setup";

// ─── Example 1: OpenCode with MCP (config file) ───────────────────────

export async function startOpenCodeWithMcp(workspacePath: string) {
  // Writes routa-coordination entry into ~/.config/opencode/opencode.json
  const mcp = ensureMcpForProvider("opencode");
  console.log("OpenCode MCP:", mcp.summary);

  const config = buildConfigFromPreset("opencode", workspacePath);
  const process = new AcpProcess(config, (n) => console.log("notification:", n));
  await process.start();
  return process;
}

// ─── Example 2: Auggie with MCP (file path) ───────────────────────────

export async function startAuggieWithMcp(workspacePath: string) {
  // Writes ~/.augment/mcp-config.json and returns the path
  const mcp = ensureMcpForProvider("auggie");
  console.log("Auggie MCP:", mcp.summary);
  console.log("MCP Status:", getMcpStatus("auggie", mcp.mcpConfigs));

  const config = buildConfigFromPreset(
    "auggie",
    workspacePath,
    [],
    {},
    mcp.mcpConfigs,
  );

  const process = new AcpProcess(config, (n) => console.log("notification:", n));
  await process.start();
  return process;
}

// ─── Example 3: Claude Code with MCP (inline JSON) ────────────────────

export async function startClaudeCodeWithMcp(workspacePath: string) {
  const mcp = ensureMcpForProvider("claude");
  console.log("Claude MCP:", mcp.summary);

  const preset = getPresetById("claude");
  if (!preset) throw new Error("Claude preset not found");

  const config = {
    preset,
    command: "claude",
    cwd: workspacePath,
    displayName: "Claude Code",
    permissionMode: "acceptEdits",
    mcpConfigs: mcp.mcpConfigs,
  };

  const process = new ClaudeCodeProcess(config, (n) =>
    console.log("notification:", n),
  );
  await process.start();
  return process;
}

// ─── Example 4: Codex with MCP (TOML config file) ──────────────────────

export async function startCodexWithMcp(workspacePath: string) {
  // Merges routa-coordination entry into ~/.codex/config.toml
  // using TOML format: [mcp_servers.routa-coordination]
  const mcp = ensureMcpForProvider("codex");
  console.log("Codex MCP:", mcp.summary);

  const config = buildConfigFromPreset("codex", workspacePath);
  const process = new AcpProcess(config, (n) => console.log("notification:", n));
  await process.start();
  return process;
}
