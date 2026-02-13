/**
 * RoutaMcpServer - port of routa-core RoutaMcpServer.kt
 *
 * Creates and configures an MCP Server with all Routa coordination tools.
 * Equivalent to the Kotlin RoutaMcpServer.create() factory.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RoutaMcpToolManager } from "./routa-mcp-tool-manager";
import { RoutaSystem, getRoutaSystem } from "../routa-system";

export interface RoutaMcpServerResult {
  server: McpServer;
  system: RoutaSystem;
}

/**
 * Create a configured MCP server with all Routa coordination tools.
 */
export function createRoutaMcpServer(
  workspaceId: string,
  system?: RoutaSystem
): RoutaMcpServerResult {
  const routaSystem = system ?? getRoutaSystem();

  const server = new McpServer({
    name: "routa-mcp",
    version: "0.1.0",
  });

  const toolManager = new RoutaMcpToolManager(routaSystem.tools, workspaceId);
  toolManager.registerTools(server);

  return { server, system: routaSystem };
}
