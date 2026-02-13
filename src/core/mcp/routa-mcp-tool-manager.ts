/**
 * RoutaMcpToolManager - port of routa-core RoutaMcpToolManager.kt
 *
 * Registers all 12 AgentTools as MCP tools on an McpServer instance.
 * Each tool maps directly to an AgentTools method.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AgentTools } from "../tools/agent-tools";
import { ToolResult } from "../tools/tool-result";

export class RoutaMcpToolManager {
  constructor(
    private tools: AgentTools,
    private workspaceId: string
  ) {}

  /**
   * Register all 12 coordination tools with the MCP server.
   */
  registerTools(server: McpServer): void {
    this.registerListAgents(server);
    this.registerReadAgentConversation(server);
    this.registerCreateAgent(server);
    this.registerDelegateTask(server);
    this.registerSendMessageToAgent(server);
    this.registerReportToParent(server);
    this.registerWakeOrCreateTaskAgent(server);
    this.registerSendMessageToTaskAgent(server);
    this.registerGetAgentStatus(server);
    this.registerGetAgentSummary(server);
    this.registerSubscribeToEvents(server);
    this.registerUnsubscribeFromEvents(server);
  }

  private registerListAgents(server: McpServer) {
    server.tool(
      "list_agents",
      "List all agents in the current workspace with their id, name, role, status, and parentId",
      {
        workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
      },
      async (params) => {
        const result = await this.tools.listAgents(params.workspaceId ?? this.workspaceId);
        return this.toMcpResult(result);
      }
    );
  }

  private registerReadAgentConversation(server: McpServer) {
    server.tool(
      "read_agent_conversation",
      "Read conversation history of another agent. Use lastN for recent messages or startTurn/endTurn for a range.",
      {
        agentId: z.string().describe("ID of the agent whose conversation to read"),
        lastN: z.number().optional().describe("Number of recent messages to retrieve"),
        startTurn: z.number().optional().describe("Start turn number (inclusive)"),
        endTurn: z.number().optional().describe("End turn number (inclusive)"),
        includeToolCalls: z.boolean().optional().describe("Include tool call messages (default: false)"),
      },
      async (params) => {
        const result = await this.tools.readAgentConversation(params);
        return this.toMcpResult(result);
      }
    );
  }

  private registerCreateAgent(server: McpServer) {
    server.tool(
      "create_agent",
      "Create a new agent with a role (ROUTA=coordinator, CRAFTER=implementor, GATE=verifier)",
      {
        name: z.string().describe("Name for the new agent"),
        role: z.enum(["ROUTA", "CRAFTER", "GATE"]).describe("Agent role"),
        workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
        parentId: z.string().optional().describe("Parent agent ID"),
        modelTier: z.enum(["SMART", "FAST"]).optional().describe("Model tier (default: SMART)"),
      },
      async (params) => {
        const result = await this.tools.createAgent({
          ...params,
          workspaceId: params.workspaceId ?? this.workspaceId,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerDelegateTask(server: McpServer) {
    server.tool(
      "delegate_task",
      "Assign a task to an agent and activate it. The agent will begin working on the task.",
      {
        agentId: z.string().describe("ID of the agent to delegate to"),
        taskId: z.string().describe("ID of the task to delegate"),
        callerAgentId: z.string().describe("ID of the calling agent"),
      },
      async (params) => {
        const result = await this.tools.delegate(params);
        return this.toMcpResult(result);
      }
    );
  }

  private registerSendMessageToAgent(server: McpServer) {
    server.tool(
      "send_message_to_agent",
      "Send a message from one agent to another. The message is added to the target agent's conversation.",
      {
        fromAgentId: z.string().describe("ID of the sending agent"),
        toAgentId: z.string().describe("ID of the receiving agent"),
        message: z.string().describe("Message content"),
      },
      async (params) => {
        const result = await this.tools.messageAgent(params);
        return this.toMcpResult(result);
      }
    );
  }

  private registerReportToParent(server: McpServer) {
    server.tool(
      "report_to_parent",
      "Submit a completion report to the parent agent. Updates task status and notifies the parent.",
      {
        agentId: z.string().describe("ID of the reporting agent"),
        taskId: z.string().describe("ID of the completed task"),
        summary: z.string().describe("Summary of what was accomplished"),
        filesModified: z.array(z.string()).optional().describe("List of modified files"),
        verificationResults: z.string().optional().describe("Verification output"),
        success: z.boolean().describe("Whether the task was completed successfully"),
      },
      async (params) => {
        const result = await this.tools.reportToParent({
          agentId: params.agentId,
          report: {
            agentId: params.agentId,
            taskId: params.taskId,
            summary: params.summary,
            filesModified: params.filesModified,
            verificationResults: params.verificationResults,
            success: params.success,
          },
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerWakeOrCreateTaskAgent(server: McpServer) {
    server.tool(
      "wake_or_create_task_agent",
      "Wake an existing agent assigned to a task, or create a new Crafter agent if none exists.",
      {
        taskId: z.string().describe("ID of the task"),
        contextMessage: z.string().describe("Context message for the agent"),
        callerAgentId: z.string().describe("ID of the calling agent"),
        workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
        agentName: z.string().optional().describe("Name for new agent (if created)"),
        modelTier: z.enum(["SMART", "FAST"]).optional().describe("Model tier for new agent"),
      },
      async (params) => {
        const result = await this.tools.wakeOrCreateTaskAgent({
          ...params,
          workspaceId: params.workspaceId ?? this.workspaceId,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerSendMessageToTaskAgent(server: McpServer) {
    server.tool(
      "send_message_to_task_agent",
      "Send a message to the agent currently assigned to a task.",
      {
        taskId: z.string().describe("ID of the task"),
        message: z.string().describe("Message content"),
        callerAgentId: z.string().describe("ID of the calling agent"),
      },
      async (params) => {
        const result = await this.tools.sendMessageToTaskAgent(params);
        return this.toMcpResult(result);
      }
    );
  }

  private registerGetAgentStatus(server: McpServer) {
    server.tool(
      "get_agent_status",
      "Get the current status, message count, and assigned tasks for an agent.",
      {
        agentId: z.string().describe("ID of the agent"),
      },
      async (params) => {
        const result = await this.tools.getAgentStatus(params.agentId);
        return this.toMcpResult(result);
      }
    );
  }

  private registerGetAgentSummary(server: McpServer) {
    server.tool(
      "get_agent_summary",
      "Get a summary of an agent including last response, tool call counts, and active tasks.",
      {
        agentId: z.string().describe("ID of the agent"),
      },
      async (params) => {
        const result = await this.tools.getAgentSummary(params.agentId);
        return this.toMcpResult(result);
      }
    );
  }

  private registerSubscribeToEvents(server: McpServer) {
    server.tool(
      "subscribe_to_events",
      "Subscribe an agent to workspace events (AGENT_CREATED, TASK_COMPLETED, etc.)",
      {
        agentId: z.string().describe("ID of the subscribing agent"),
        agentName: z.string().describe("Name of the subscribing agent"),
        eventTypes: z.array(z.string()).describe("Event types to subscribe to"),
        excludeSelf: z.boolean().optional().describe("Exclude self-generated events (default: true)"),
      },
      async (params) => {
        const result = await this.tools.subscribeToEvents(params);
        return this.toMcpResult(result);
      }
    );
  }

  private registerUnsubscribeFromEvents(server: McpServer) {
    server.tool(
      "unsubscribe_from_events",
      "Remove an event subscription.",
      {
        subscriptionId: z.string().describe("ID of the subscription to remove"),
      },
      async (params) => {
        const result = await this.tools.unsubscribeFromEvents(params.subscriptionId);
        return this.toMcpResult(result);
      }
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private toMcpResult(result: ToolResult) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result.success ? result.data : { error: result.error }, null, 2),
        },
      ],
      isError: !result.success,
    };
  }
}
