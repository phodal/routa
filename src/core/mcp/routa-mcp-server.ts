/**
 * RoutaMcpServer - port of routa-core RoutaMcpServer.kt
 *
 * Creates and configures an MCP Server with all Routa coordination tools.
 * Equivalent to the Kotlin RoutaMcpServer.create() factory.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RoutaMcpToolManager, ToolMode } from "./routa-mcp-tool-manager";
import { RoutaSystem, getRoutaSystem } from "../routa-system";
import { initRoutaOrchestrator } from "../orchestration/orchestrator-singleton";
import { KanbanTools } from "../tools/kanban-tools";
import { startWorkflowOrchestrator as startKanbanWorkflowOrchestrator } from "../kanban/workflow-orchestrator-singleton";
import { getMcpProfileToolAllowlist, getMcpServerName, type McpServerProfile } from "./mcp-server-profiles";
import { registerCanvasSdkResources } from "./canvas-sdk-resources";
import { registerFeatureTreeSpecResources } from "./feature-tree-spec-resources";

export interface RoutaMcpServerResult {
  server: McpServer;
  system: RoutaSystem;
  toolManager: RoutaMcpToolManager;
}

export interface CreateMcpServerOptions {
  /** Workspace ID */
  workspaceId: string;
  /** Tool mode: "essential" (7 tools) or "full" (all tools). Default: "essential" */
  toolMode?: ToolMode;
  /** Optional logical MCP server profile for specialized tool subsets. */
  mcpProfile?: McpServerProfile;
  /** Optional existing RoutaSystem instance */
  system?: RoutaSystem;
  /**
   * ACP session ID to scope note/task creation to a specific session.
   * When set, notes created without an explicit sessionId will inherit this.
   */
  sessionId?: string;
}

/**
 * Create a configured MCP server with Routa coordination tools.
 * If an orchestrator is available, it will be wired in for process-spawning delegation.
 *
 * @param options.toolMode - "essential" for 7 core tools (weak models), "full" for all 34 tools
 */
export function createRoutaMcpServer(
  workspaceIdOrOptions: string | CreateMcpServerOptions,
  system?: RoutaSystem
): RoutaMcpServerResult {
  // Support both old signature (workspaceId, system?) and new (options)
  const opts: CreateMcpServerOptions =
    typeof workspaceIdOrOptions === "string"
      ? { workspaceId: workspaceIdOrOptions, system, toolMode: "essential" }
      : workspaceIdOrOptions;

  const routaSystem = opts.system ?? getRoutaSystem();
  const toolMode = opts.toolMode ?? "essential";

  const server = new McpServer({
    name: getMcpServerName(opts.mcpProfile),
    version: "0.1.0",
  });

  const toolManager = new RoutaMcpToolManager(routaSystem.tools, opts.workspaceId);
  toolManager.setToolMode(toolMode);
  toolManager.setAllowedTools(getMcpProfileToolAllowlist(opts.mcpProfile));

  // Scope note/task creation to this ACP session when provided
  if (opts.sessionId) {
    toolManager.setSessionId(opts.sessionId);
  }

  // Wire in orchestrator — auto-initialize if not yet created (e.g. after server restart).
  // initRoutaOrchestrator is idempotent: returns existing instance if already created.
  const orchestrator = initRoutaOrchestrator();
  toolManager.setOrchestrator(orchestrator);

  // Wire in note tools and workspace tools
  toolManager.setNoteTools(routaSystem.noteTools);
  toolManager.setWorkspaceTools(routaSystem.workspaceTools);

  // Wire in kanban tools with event bus for column transition events
  const kanbanTools = new KanbanTools(routaSystem.kanbanBoardStore, routaSystem.taskStore);
  kanbanTools.setEventBus(routaSystem.eventBus);
  kanbanTools.setAutomationSystem(routaSystem);
  toolManager.setKanbanTools(kanbanTools);

  // Initialize the workflow orchestrator singleton (listens for column transitions)
  startKanbanWorkflowOrchestrator(routaSystem);

  toolManager.registerTools(server);
  registerCanvasSdkResources(server);
  registerFeatureTreeSpecResources(server);

  return { server, system: routaSystem, toolManager };
}
