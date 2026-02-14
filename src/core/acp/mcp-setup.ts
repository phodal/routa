/**
 * MCP Setup for ACP Providers
 *
 * Provides helper functions to configure MCP (Model Context Protocol) for
 * different ACP providers (Claude Code, Codex, OpenCode) to connect to
 * the Routa MCP server.
 *
 * Usage:
 *   import { setupMcpForProvider } from './mcp-setup';
 *   
 *   const mcpConfigs = setupMcpForProvider('codex', {
 *     routaServerUrl: 'http://localhost:3000',
 *     workspaceId: 'my-workspace'
 *   });
 *   
 *   const config = buildConfigFromPreset('codex', '/path/to/workspace', [], {}, mcpConfigs);
 */

import {
  generateRoutaMcpConfigJson,
  getDefaultRoutaMcpConfig,
  type RoutaMcpConfig,
} from "./mcp-config-generator";

/**
 * Provider IDs that support MCP configuration via --mcp-config flag
 * 
 * Verified support:
 * - auggie: ✓ Supports --mcp-config with {mcpServers: {...}} format
 * - claude: ✓ Supports --mcp-config with {mcpServers: {...}} format
 * 
 * Not supported (will cause process exit):
 * - opencode: Uses separate `opencode mcp` command for configuration
 * - codex: No MCP support in codex-acp wrapper
 * - gemini: Uses different MCP configuration mechanism
 */
export type McpSupportedProvider = "claude" | "auggie";

/**
 * Check if a provider supports MCP configuration via --mcp-config flag.
 *
 * @param providerId - Provider ID to check
 * @returns True if the provider supports --mcp-config
 */
export function providerSupportsMcp(providerId: string): boolean {
  const supportedProviders: McpSupportedProvider[] = [
    "claude",
    "auggie",
  ];
  return supportedProviders.includes(providerId as McpSupportedProvider);
}

/**
 * Setup MCP configuration for a specific provider.
 *
 * This generates the MCP configuration JSON strings that can be passed
 * to the provider via --mcp-config flags.
 *
 * Currently supported providers:
 * - Auggie: Uses {mcpServers: {name: {url, type, env}}} format
 * - Claude: Uses {mcpServers: {name: {url, type, env}}} format
 *
 * Not supported (will be ignored):
 * - OpenCode: Requires separate `opencode mcp add` configuration
 * - Codex: No MCP support in current wrapper
 * - Gemini: Uses different configuration mechanism
 *
 * @param providerId - Provider ID (claude, auggie)
 * @param config - Routa MCP configuration (optional, uses defaults if not provided)
 * @returns Array of MCP config JSON strings
 */
export function setupMcpForProvider(
  providerId: McpSupportedProvider,
  config?: RoutaMcpConfig
): string[] {
  if (!providerSupportsMcp(providerId)) {
    console.warn(`Provider "${providerId}" does not support --mcp-config flag`);
    return [];
  }

  const mcpConfig = config || getDefaultRoutaMcpConfig();
  
  // Auggie and Claude both use {mcpServers: {name: {url, type, env}}} format
  const mcpEndpoint = `${mcpConfig.routaServerUrl}/api/mcp`;
  const mcpConfigJson = JSON.stringify({
    mcpServers: {
      "routa-coordination": {
        url: mcpEndpoint,
        type: "http",
        env: {
          ROUTA_WORKSPACE_ID: mcpConfig.workspaceId || "default",
        },
      },
    },
  });
  return [mcpConfigJson];
}

/**
 * Setup MCP for Claude Code.
 *
 * Claude Code uses the --mcp-config flag to specify MCP server configurations.
 *
 * @param config - Routa MCP configuration
 * @returns Array of MCP config JSON strings for Claude Code
 */
export function setupMcpForClaudeCode(config?: RoutaMcpConfig): string[] {
  return setupMcpForProvider("claude", config);
}

/**
 * Setup MCP for Auggie.
 *
 * Auggie supports --mcp-config flag natively.
 *
 * @param config - Routa MCP configuration
 * @returns Array of MCP config JSON strings for Auggie
 */
export function setupMcpForAuggie(config?: RoutaMcpConfig): string[] {
  return setupMcpForProvider("auggie", config);
}

/**
 * Check if MCP is configured for a provider.
 *
 * This checks if the provider has MCP configs set up.
 *
 * @param mcpConfigs - MCP config array to check
 * @returns True if MCP is configured
 */
export function isMcpConfigured(mcpConfigs?: string[]): boolean {
  return !!mcpConfigs && mcpConfigs.length > 0;
}

/**
 * Get MCP status for a provider.
 *
 * @param providerId - Provider ID
 * @param mcpConfigs - Current MCP configs
 * @returns MCP status object
 */
export function getMcpStatus(
  providerId: string,
  mcpConfigs?: string[]
): {
  supported: boolean;
  configured: boolean;
  configCount: number;
} {
  return {
    supported: providerSupportsMcp(providerId),
    configured: isMcpConfigured(mcpConfigs),
    configCount: mcpConfigs?.length || 0,
  };
}

