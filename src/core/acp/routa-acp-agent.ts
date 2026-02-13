/**
 * RoutaAcpAgent - ACP Agent implementation using @agentclientprotocol/sdk
 *
 * Implements the ACP Agent interface to expose Routa's multi-agent
 * coordination capabilities via the Agent Client Protocol.
 *
 * Flow:
 *   Client -> initialize -> session/new -> session/prompt -> streaming updates
 */

import type {
  Agent,
  AgentSideConnection,
  InitializeRequest,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import { v4 as uuidv4 } from "uuid";
import { RoutaSystem } from "../routa-system";
import { SkillRegistry } from "../skills/skill-registry";
import { AgentRole } from "../models/agent";

interface AcpSession {
  id: string;
  cwd: string;
  routaAgentId?: string;
  workspaceId: string;
}

/**
 * Send a session update notification via the ACP connection.
 * Uses `unknown` cast because the ACP SDK's SessionUpdate is a complex discriminated union.
 */
function sendUpdate(
  connection: AgentSideConnection,
  sessionId: string,
  update: Record<string, unknown>
): void {
  const notification = { sessionId, update } as unknown as SessionNotification;
  connection.sessionUpdate(notification);
}

/**
 * Creates a text content block for session updates
 */
function textContent(text: string) {
  return {
    content: { type: "text" as const, text },
  };
}

/**
 * Creates a Routa ACP Agent handler for use with AgentSideConnection.
 */
export function createRoutaAcpAgent(
  system: RoutaSystem,
  skillRegistry?: SkillRegistry
) {
  const sessions = new Map<string, AcpSession>();

  return function agentHandler(connection: AgentSideConnection): Agent {
    return {
      async initialize(params: InitializeRequest): Promise<InitializeResponse> {
        return {
          protocolVersion: params.protocolVersion,
          agentCapabilities: {
            loadSession: true,
          },
          agentInfo: {
            name: "routa-acp",
            version: "0.1.0",
          },
        };
      },

      async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
        const sessionId = uuidv4();
        const workspaceId = params.cwd ?? "default";

        const createResult = await system.tools.createAgent({
          name: `routa-session-${sessionId.slice(0, 8)}`,
          role: AgentRole.ROUTA,
          workspaceId,
        });

        const routaAgentId =
          createResult.success && createResult.data
            ? (createResult.data as { agentId: string }).agentId
            : undefined;

        const session: AcpSession = {
          id: sessionId,
          cwd: params.cwd ?? process.cwd(),
          routaAgentId,
          workspaceId,
        };
        sessions.set(sessionId, session);

        // Send available commands (skills as slash commands)
        if (skillRegistry) {
          const skills = skillRegistry.listSkills();
          if (skills.length > 0) {
            sendUpdate(connection, sessionId, {
              sessionUpdate: "available_commands_update",
              availableCommands: skills.map((s) => ({
                name: s.name,
                description: s.description,
              })),
            });
          }
        }

        return { sessionId };
      },

      async prompt(params: PromptRequest): Promise<PromptResponse> {
        const session = sessions.get(params.sessionId);
        if (!session) {
          throw new Error(`Session not found: ${params.sessionId}`);
        }

        const promptText =
          params.prompt
            ?.filter((p) => p.type === "text")
            .map((p) => (p as { type: "text"; text: string }).text)
            .join("\n") ?? "";

        // Skill invocation (/command)
        if (promptText.startsWith("/") && skillRegistry) {
          const skillName = promptText.slice(1).split(" ")[0];
          const skill = skillRegistry.getSkill(skillName);
          if (skill) {
            sendUpdate(connection, params.sessionId, {
              sessionUpdate: "agent_message_chunk",
              ...textContent(`[Loading skill: ${skill.name}]\n\n${skill.content}`),
            });
            return { stopReason: "end_turn" };
          }
        }

        // Route through Routa tools
        if (session.routaAgentId) {
          sendUpdate(connection, params.sessionId, {
            sessionUpdate: "agent_thought_chunk",
            ...textContent("Analyzing request and coordinating agents..."),
          });

          const agentListResult = await system.tools.listAgents(session.workspaceId);

          const toolCallId = uuidv4();
          sendUpdate(connection, params.sessionId, {
            sessionUpdate: "tool_call",
            toolCallId,
            title: "list_agents",
            rawInput: { workspaceId: session.workspaceId },
            status: "running",
          });

          sendUpdate(connection, params.sessionId, {
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: "completed",
            rawOutput: agentListResult.data,
          });

          const responseText =
            `Routa Coordinator ready.\n\n` +
            `Workspace: ${session.workspaceId}\n` +
            `Available agents: ${JSON.stringify(agentListResult.data, null, 2)}\n\n` +
            `Received prompt: ${promptText}\n\n` +
            `Use the coordination tools (create_agent, delegate_task, etc.) to orchestrate work.`;

          sendUpdate(connection, params.sessionId, {
            sessionUpdate: "agent_message_chunk",
            ...textContent(responseText),
          });
        }

        return { stopReason: "end_turn" };
      },

      async cancel(): Promise<void> {
        // Cancel any running operations
      },

      async authenticate(): Promise<void> {
        // No authentication required
      },

      async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
        const session = sessions.get(params.sessionId);
        if (!session) {
          throw new Error(`Session not found: ${params.sessionId}`);
        }
        return {};
      },

      async extMethod(
        method: string,
        params: Record<string, unknown>
      ): Promise<Record<string, unknown>> {
        if (method === "skills/list" && skillRegistry) {
          return { skills: skillRegistry.listSkillSummaries() };
        }

        if (method === "skills/load" && skillRegistry) {
          const skill = skillRegistry.getSkill(params.name as string);
          if (skill) {
            return {
              name: skill.name,
              description: skill.description,
              content: skill.content,
            };
          }
          throw new Error(`Skill not found: ${params.name}`);
        }

        if (method === "tools/call") {
          const result = await dispatchTool(
            system,
            params.name as string,
            params.arguments as Record<string, unknown>
          );
          return result as unknown as Record<string, unknown>;
        }

        throw new Error(`Unknown extension method: ${method}`);
      },
    };
  };
}

async function dispatchTool(
  system: RoutaSystem,
  name: string,
  args: Record<string, unknown>
) {
  const tools = system.tools;
  switch (name) {
    case "list_agents":
      return tools.listAgents((args.workspaceId as string) ?? "default");
    case "create_agent":
      return tools.createAgent({
        name: args.name as string,
        role: args.role as string,
        workspaceId: (args.workspaceId as string) ?? "default",
        parentId: args.parentId as string | undefined,
        modelTier: args.modelTier as string | undefined,
      });
    case "get_agent_status":
      return tools.getAgentStatus(args.agentId as string);
    case "get_agent_summary":
      return tools.getAgentSummary(args.agentId as string);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
