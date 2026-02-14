/**
 * MCP Configuration Examples
 *
 * This file demonstrates how to configure MCP for ACP providers
 * that support --mcp-config flag (currently: Auggie and Claude Code).
 * 
 * Note: OpenCode and Codex do not support --mcp-config in ACP mode.
 */

import { AcpProcess } from "@/core/acp/acp-process";
import { ClaudeCodeProcess } from "@/core/acp/claude-code-process";
import { buildConfigFromPreset } from "@/core/acp/opencode-process";
import { getPresetById } from "@/core/acp/acp-presets";
import {
  setupMcpForClaudeCode,
  setupMcpForAuggie,
  getMcpStatus,
} from "@/core/acp/mcp-setup";
import { getDefaultRoutaMcpConfig } from "@/core/acp/mcp-config-generator";

// ─── Example 1: Auggie with MCP ────────────────────────────────────────

export async function startAuggieWithMcp(workspacePath: string) {
  console.log("Starting Auggie with MCP configuration...");

  // Setup MCP configuration
  const mcpConfigs = setupMcpForAuggie({
    routaServerUrl: "http://localhost:3000",
    workspaceId: "my-workspace",
  });

  // Build process config
  const config = buildConfigFromPreset(
    "auggie",
    workspacePath,
    [], // extra args
    {}, // extra env
    mcpConfigs // MCP configs
  );

  // Check MCP status
  const status = getMcpStatus("auggie", mcpConfigs);
  console.log("MCP Status:", status);

  // Create and start process
  const process = new AcpProcess(config, (notification) => {
    console.log("Auggie notification:", notification);
  });

  await process.start();
  console.log("Auggie started with MCP enabled");

  return process;
}

// ─── Example 2: Claude Code with MCP ───────────────────────────────────

export async function startClaudeCodeWithMcp(workspacePath: string) {
  console.log("Starting Claude Code with MCP configuration...");

  // Setup MCP configuration
  const mcpConfigs = setupMcpForClaudeCode({
    routaServerUrl: "http://localhost:3000",
    workspaceId: "my-workspace",
  });

  // Build Claude Code config
  const preset = getPresetById("claude");
  if (!preset) {
    throw new Error("Claude preset not found");
  }

  const config = {
    preset,
    command: "claude",
    cwd: workspacePath,
    displayName: "Claude Code",
    permissionMode: "acceptEdits",
    mcpConfigs, // MCP configs
  };

  // Create and start process
  const process = new ClaudeCodeProcess(config, (notification) => {
    console.log("Claude Code notification:", notification);
  });

  await process.start();
  console.log("Claude Code started with MCP enabled");

  return process;
}

// ─── Example 3: Using Environment Variables ────────────────────────────

export async function startProviderWithDefaultMcp(
  providerId: "auggie" | "claude",
  workspacePath: string
) {
  console.log(`Starting ${providerId} with default MCP configuration...`);

  // Use default config from environment variables
  const defaultConfig = getDefaultRoutaMcpConfig();
  console.log("Default MCP config:", defaultConfig);

  let mcpConfigs: string[];
  if (providerId === "auggie") {
    mcpConfigs = setupMcpForAuggie(defaultConfig);
  } else {
    mcpConfigs = setupMcpForClaudeCode(defaultConfig);
  }

  const config = buildConfigFromPreset(
    providerId,
    workspacePath,
    [],
    {},
    mcpConfigs
  );

  const process = new AcpProcess(config, (notification) => {
    console.log(`${providerId} notification:`, notification);
  });

  await process.start();
  return process;
}

// ─── Example Usage ──────────────────────────────────────────────────────

if (require.main === module) {
  const workspacePath = process.cwd();

  // Example: Start Auggie with MCP
  startAuggieWithMcp(workspacePath)
    .then((process) => {
      console.log("Auggie process started successfully");
      // You can now send prompts to the process
    })
    .catch((error) => {
      console.error("Failed to start Auggie:", error);
    });
}
