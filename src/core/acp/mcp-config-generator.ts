/**
 * MCP Configuration Generator
 *
 * Generates MCP configuration JSON for connecting AI providers
 * (Claude Code, Codex, OpenCode) to the Routa MCP server.
 *
 * The Routa MCP server exposes coordination tools via HTTP at /api/mcp.
 * This module creates the necessary MCP config JSON that can be passed
 * to providers via --mcp-config flags.
 */

import type { ToolMode } from "../mcp/routa-mcp-tool-manager";
import type { McpServerProfile } from "../mcp/mcp-server-profiles";

export interface RoutaMcpConfig {
  /** Base URL of the routa-js server (e.g., http://localhost:3000) */
  routaServerUrl: string;
  /**
   * Optional working directory used by provider-specific MCP setup flows
   * that scope configuration to a project path (for example qodercli local MCP).
   */
  cwd?: string;
  /** Workspace ID for the MCP session */
  workspaceId?: string;
  /**
   * ACP session ID to scope note/task creation to a specific session.
   * When set, appended as ?sid= query param so the MCP server can associate
   * notes and tasks with the originating session.
   */
  sessionId?: string;
  /**
   * Direct MCP endpoint URL override.
   * When set, this is used instead of `routaServerUrl + "/api/mcp"`.
   * Used by the standalone RoutaMcpHttpServer which serves at /mcp (not /api/mcp).
   */
  mcpEndpoint?: string;
  /**
   * Whether to include user-defined custom MCP servers from the database.
   * Defaults to true. Set to false to only use the built-in routa-coordination server.
   */
  includeCustomServers?: boolean;
  /** MCP tool exposure for this session. Defaults to the server global mode. */
  toolMode?: ToolMode;
  /** Specialized MCP profile for tool subsets such as Kanban planning. */
  mcpProfile?: McpServerProfile;
}

export interface McpServerConfig {
  /** MCP server name/identifier */
  name: string;
  /** Server type: "http" for HTTP-based MCP servers */
  type: "http" | "stdio";
  /** HTTP endpoint URL (for type: "http") */
  url?: string;
  /** Command to execute (for type: "stdio") */
  command?: string;
  /** Command arguments (for type: "stdio") */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
}

/**
 * Generate MCP configuration JSON for connecting to Routa MCP server.
 *
 * This creates a configuration that tells the AI provider (Claude Code, Codex, OpenCode)
 * how to connect to the Routa MCP server to access coordination tools.
 *
 * @param config - Routa MCP configuration
 * @returns MCP server configuration object
 */
export function generateRoutaMcpConfig(config: RoutaMcpConfig): McpServerConfig {
  const { routaServerUrl, workspaceId } = config;

  // Construct the MCP endpoint URL
  const mcpEndpoint = `${routaServerUrl}/api/mcp`;

  return {
    name: "routa-coordination",
    type: "http",
    url: mcpEndpoint,
    env: {
      ROUTA_WORKSPACE_ID: workspaceId ?? "",
    },
  };
}

/**
 * Generate MCP configuration JSON string for command-line usage.
 *
 * This creates a JSON string that can be passed directly to providers
 * via the --mcp-config flag.
 *
 * Example usage:
 *   const mcpConfigJson = generateRoutaMcpConfigJson({ routaServerUrl: "http://localhost:3000" });
 *   // Pass to Claude Code: claude --mcp-config <mcpConfigJson>
 *
 * @param config - Routa MCP configuration
 * @returns JSON string for MCP configuration
 */
export function generateRoutaMcpConfigJson(config: RoutaMcpConfig): string {
  const mcpConfig = generateRoutaMcpConfig(config);
  return JSON.stringify(mcpConfig);
}

/**
 * Generate MCP configuration for multiple Routa servers.
 *
 * This is useful when you want to connect to multiple Routa instances
 * or expose multiple MCP servers to the AI provider.
 *
 * @param configs - Array of Routa MCP configurations
 * @returns Array of MCP server configurations
 */
export function generateMultipleRoutaMcpConfigs(
  configs: RoutaMcpConfig[]
): McpServerConfig[] {
  return configs.map(generateRoutaMcpConfig);
}

/**
 * Get the default Routa MCP configuration for local development.
 *
 * Dynamically detects the server URL based on the current process.
 * If the standalone RoutaMcpHttpServer is running (on a dynamic port),
 * it returns its URL directly (e.g. http://127.0.0.1:54321/mcp).
 * Otherwise, falls back to the Next.js /api/mcp route.
 *
 * @param workspaceId - Optional workspace ID; falls back to ROUTA_WORKSPACE_ID when set
 * @returns Default MCP configuration
 */
export function getDefaultRoutaMcpConfig(
  workspaceId?: string,
  sessionId?: string,
  toolMode?: ToolMode,
  mcpProfile?: McpServerProfile,
): RoutaMcpConfig {
  const effectiveWorkspaceId = workspaceId || process.env.ROUTA_WORKSPACE_ID || "";

  // Build query string with workspace and session context so MCP server can scope notes correctly
  const withContextParams = (url: string) => {
    const params: string[] = [];
    if (effectiveWorkspaceId) {
      params.push(`wsId=${encodeURIComponent(effectiveWorkspaceId)}`);
    }
    if (sessionId) {
      params.push(`sid=${encodeURIComponent(sessionId)}`);
    }
    if (toolMode) {
      params.push(`toolMode=${encodeURIComponent(toolMode)}`);
    }
    if (mcpProfile && mcpProfile !== "coordination") {
      params.push(`mcpProfile=${encodeURIComponent(mcpProfile)}`);
    }
    return params.length > 0 ? `${url}?${params.join("&")}` : url;
  };
  // Keep backward-compat alias
  const withWsParam = withContextParams;

  // Try to determine the server URL
  let routaServerUrl = process.env.ROUTA_SERVER_URL;
  
  if (!routaServerUrl) {
    // Check if standalone MCP server is running (provides WebSocket + HTTP)
    try {
      // Dynamic import to avoid circular dependency
      const { getMcpServer } = require("@/core/mcp/mcp-server-singleton");
      const standaloneServer = getMcpServer();
      if (standaloneServer?.isRunning) {
        // Standalone server serves at /mcp (not /api/mcp).
        // Use mcpEndpoint override so mcp-setup doesn't append "/api/mcp".
        const port = process.env.PORT || "3000";
        const host = process.env.HOST || "localhost";
        return {
          routaServerUrl: `http://${host}:${port}`,
          mcpEndpoint: withWsParam(standaloneServer.mcpUrl),
          workspaceId: effectiveWorkspaceId,
          toolMode,
          mcpProfile,
        };
      }
    } catch {
      // mcp-server-singleton not available (e.g., test environment)
    }

    // If running in Next.js, try to detect the port
    const port = process.env.PORT || "3000";
    const host = process.env.HOST || "localhost";
    routaServerUrl = `http://${host}:${port}`;
  }
  
  return {
    routaServerUrl,
    mcpEndpoint: withContextParams(`${routaServerUrl}/api/mcp`),
    workspaceId: effectiveWorkspaceId,
    sessionId,
    toolMode,
    mcpProfile,
  };
}

/**
 * Validate MCP configuration.
 *
 * Checks if the configuration is valid and the server is reachable.
 *
 * @param config - MCP configuration to validate
 * @returns Promise that resolves to true if valid, false otherwise
 */
export async function validateRoutaMcpConfig(
  config: RoutaMcpConfig
): Promise<boolean> {
  try {
    const mcpEndpoint = `${config.routaServerUrl}/api/mcp`;
    
    // Try to make a simple health check or initialize request
    const response = await fetch(mcpEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "routa-config-validator", version: "0.1.0" },
        },
      }),
    });

    if (!response.ok) {
      console.error(`MCP server returned status ${response.status}`);
      return false;
    }

    const result = await response.json();
    return result.result && result.result.serverInfo;
  } catch (error) {
    console.error("Failed to validate MCP config:", error);
    return false;
  }
}
