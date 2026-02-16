/**
 * RoutaMcpToolManager - port of routa-core RoutaMcpToolManager.kt
 *
 * Registers all 12 AgentTools as MCP tools on an McpServer instance.
 * Each tool maps directly to an AgentTools method.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AgentTools } from "../tools/agent-tools";
import { NoteTools } from "../tools/note-tools";
import { WorkspaceTools } from "../tools/workspace-tools";
import { ToolResult } from "../tools/tool-result";
import type { RoutaOrchestrator } from "../orchestration/orchestrator";

export class RoutaMcpToolManager {
  private orchestrator?: RoutaOrchestrator;
  private noteTools?: NoteTools;
  private workspaceTools?: WorkspaceTools;

  constructor(
    private tools: AgentTools,
    private workspaceId: string
  ) {}

  /**
   * Set the orchestrator for process-spawning delegation.
   */
  setOrchestrator(orchestrator: RoutaOrchestrator): void {
    this.orchestrator = orchestrator;
  }

  /**
   * Set the note tools for note management.
   */
  setNoteTools(noteTools: NoteTools): void {
    this.noteTools = noteTools;
  }

  /**
   * Set the workspace tools for git and workspace management.
   */
  setWorkspaceTools(workspaceTools: WorkspaceTools): void {
    this.workspaceTools = workspaceTools;
  }

  /**
   * Register all coordination tools with the MCP server.
   */
  registerTools(server: McpServer): void {
    this.registerCreateTask(server);
    this.registerListTasks(server);
    this.registerListAgents(server);
    this.registerReadAgentConversation(server);
    this.registerCreateAgent(server);
    this.registerDelegateTask(server);
    this.registerDelegateTaskToNewAgent(server);
    this.registerSendMessageToAgent(server);
    this.registerReportToParent(server);
    this.registerWakeOrCreateTaskAgent(server);
    this.registerSendMessageToTaskAgent(server);
    this.registerGetAgentStatus(server);
    this.registerGetAgentSummary(server);
    this.registerSubscribeToEvents(server);
    this.registerUnsubscribeFromEvents(server);
    // Note tools
    this.registerCreateNote(server);
    this.registerReadNote(server);
    this.registerListNotes(server);
    this.registerSetNoteContent(server);
    this.registerAppendToNote(server);
    this.registerGetMyTask(server);
    this.registerConvertTaskBlocks(server);
    // Workspace tools
    this.registerGitStatus(server);
    this.registerGitDiff(server);
    this.registerGitCommit(server);
    this.registerGetWorkspaceInfo(server);
    this.registerListSpecialists(server);
  }

  // ─── Task Tools ────────────────────────────────────────────────────

  private registerCreateTask(server: McpServer) {
    server.tool(
      "create_task",
      "Create a new task in the task store. Returns the taskId for later delegation.",
      {
        title: z.string().describe("Task title"),
        objective: z.string().describe("What this task should achieve"),
        workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
        scope: z.string().optional().describe("What files/areas are in scope"),
        acceptanceCriteria: z.array(z.string()).optional().describe("List of acceptance criteria / definition of done"),
        verificationCommands: z.array(z.string()).optional().describe("Commands to run for verification"),
        dependencies: z.array(z.string()).optional().describe("Task IDs that must complete first"),
        parallelGroup: z.string().optional().describe("Group ID for parallel execution"),
      },
      async (params) => {
        const result = await this.tools.createTask({
          ...params,
          workspaceId: params.workspaceId ?? this.workspaceId,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerListTasks(server: McpServer) {
    server.tool(
      "list_tasks",
      "List all tasks in the workspace with their status, assignee, and verification verdict.",
      {
        workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
      },
      async (params) => {
        const result = await this.tools.listTasks(params.workspaceId ?? this.workspaceId);
        return this.toMcpResult(result);
      }
    );
  }

  /**
   * Enhanced delegate_task that spawns a real agent process.
   * This is the primary delegation tool for coordinators.
   */
  private registerDelegateTaskToNewAgent(server: McpServer) {
    server.tool(
      "delegate_task_to_agent",
      `Delegate a task to a new agent by spawning a real agent process. This is the primary way to delegate work.
Use specialist="CRAFTER" for implementation tasks and specialist="GATE" for verification tasks.
The agent will start working immediately and you'll be notified when it completes.`,
      {
        taskId: z.string().describe("ID of the task to delegate (from create_task)"),
        callerAgentId: z.string().describe("Your agent ID (the coordinator's agent ID)"),
        callerSessionId: z.string().optional().describe("Your session ID (if known)"),
        specialist: z.enum(["CRAFTER", "GATE", "DEVELOPER", "crafter", "gate", "developer"]).describe("Specialist type: CRAFTER for implementation, GATE for verification, DEVELOPER for solo plan+implement"),
        provider: z.string().optional().describe("ACP provider to use (e.g., 'claude', 'copilot', 'opencode'). Uses default if omitted."),
        cwd: z.string().optional().describe("Working directory for the agent"),
        additionalInstructions: z.string().optional().describe("Extra instructions beyond the task content"),
        waitMode: z.enum(["immediate", "after_all"]).optional().describe("When to notify: 'immediate' (per agent) or 'after_all' (when all in group complete)"),
      },
      async (params) => {
        if (!this.orchestrator) {
          return this.toMcpResult({
            success: false,
            error: "Orchestrator not available. Multi-agent delegation requires orchestrator setup.",
          });
        }

        // Try to find the caller's session from the orchestrator
        const callerSessionId =
          params.callerSessionId ??
          this.orchestrator.getSessionForAgent(params.callerAgentId) ??
          "unknown";

        const result = await this.orchestrator.delegateTaskWithSpawn({
          taskId: params.taskId,
          callerAgentId: params.callerAgentId,
          callerSessionId,
          workspaceId: this.workspaceId,
          specialist: params.specialist,
          provider: params.provider,
          cwd: params.cwd,
          additionalInstructions: params.additionalInstructions,
          waitMode: params.waitMode as "immediate" | "after_all" | undefined,
        });
        return this.toMcpResult(result);
      }
    );
  }

  // ─── Agent Tools ──────────────────────────────────────────────────

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
        role: z.enum(["ROUTA", "CRAFTER", "GATE", "DEVELOPER"]).describe("Agent role"),
        workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
        parentId: z.string().optional().describe("Parent agent ID"),
        modelTier: z.enum(["SMART", "BALANCED", "FAST"]).optional().describe("Model tier (default: SMART)"),
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
        modelTier: z.enum(["SMART", "BALANCED", "FAST"]).optional().describe("Model tier for new agent"),
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

  // ─── Note Tools ──────────────────────────────────────────────────────

  private registerCreateNote(server: McpServer) {
    server.tool(
      "create_note",
      "Create a new note in the workspace. Notes are shared documents for agent collaboration.",
      {
        title: z.string().describe("Note title"),
        content: z.string().optional().describe("Initial note content"),
        noteId: z.string().optional().describe("Custom note ID (auto-generated if omitted)"),
        type: z.enum(["spec", "task", "general"]).optional().describe("Note type (default: general)"),
        workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
      },
      async (params) => {
        if (!this.noteTools) {
          return this.toMcpResult({ success: false, error: "Note tools not available." });
        }
        const result = await this.noteTools.createNote({
          ...params,
          workspaceId: params.workspaceId ?? this.workspaceId,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerReadNote(server: McpServer) {
    server.tool(
      "read_note",
      "Read the content of a note. Use noteId='spec' to read the workspace spec note.",
      {
        noteId: z.string().describe("ID of the note to read (use 'spec' for the spec note)"),
        workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
      },
      async (params) => {
        if (!this.noteTools) {
          return this.toMcpResult({ success: false, error: "Note tools not available." });
        }
        const result = await this.noteTools.readNote({
          noteId: params.noteId,
          workspaceId: params.workspaceId ?? this.workspaceId,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerListNotes(server: McpServer) {
    server.tool(
      "list_notes",
      "List all notes in the workspace. Optionally filter by type (spec, task, general).",
      {
        type: z.enum(["spec", "task", "general"]).optional().describe("Filter by note type"),
        workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
      },
      async (params) => {
        if (!this.noteTools) {
          return this.toMcpResult({ success: false, error: "Note tools not available." });
        }
        const result = await this.noteTools.listNotes({
          workspaceId: params.workspaceId ?? this.workspaceId,
          type: params.type,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerSetNoteContent(server: McpServer) {
    server.tool(
      "set_note_content",
      "Set (replace) the content of a note. The spec note is auto-created if it doesn't exist.",
      {
        noteId: z.string().describe("ID of the note to update"),
        content: z.string().describe("New content for the note (replaces existing content)"),
        title: z.string().optional().describe("Update the note title"),
        workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
      },
      async (params) => {
        if (!this.noteTools) {
          return this.toMcpResult({ success: false, error: "Note tools not available." });
        }
        const result = await this.noteTools.setNoteContent({
          noteId: params.noteId,
          content: params.content,
          title: params.title,
          workspaceId: params.workspaceId ?? this.workspaceId,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerAppendToNote(server: McpServer) {
    server.tool(
      "append_to_note",
      "Append content to an existing note. Useful for adding verification reports, progress updates, etc.",
      {
        noteId: z.string().describe("ID of the note to append to"),
        content: z.string().describe("Content to append"),
        workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
      },
      async (params) => {
        if (!this.noteTools) {
          return this.toMcpResult({ success: false, error: "Note tools not available." });
        }
        const result = await this.noteTools.appendToNote({
          noteId: params.noteId,
          content: params.content,
          workspaceId: params.workspaceId ?? this.workspaceId,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerGetMyTask(server: McpServer) {
    server.tool(
      "get_my_task",
      "Get the task note(s) assigned to the calling agent. Returns task details including objective, scope, and acceptance criteria.",
      {
        agentId: z.string().describe("ID of the calling agent"),
        workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
      },
      async (params) => {
        if (!this.noteTools) {
          return this.toMcpResult({ success: false, error: "Note tools not available." });
        }
        const result = await this.noteTools.getMyTask({
          agentId: params.agentId,
          workspaceId: params.workspaceId ?? this.workspaceId,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerConvertTaskBlocks(server: McpServer) {
    server.tool(
      "convert_task_blocks",
      "Convert @@@task blocks in a note into structured Task Notes and Task records. Returns the created task IDs and note IDs.",
      {
        noteId: z.string().describe("ID of the note containing @@@task blocks (typically 'spec')"),
        workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
      },
      async (params) => {
        if (!this.noteTools) {
          return this.toMcpResult({ success: false, error: "Note tools not available." });
        }
        const result = await this.noteTools.convertTaskBlocks({
          noteId: params.noteId,
          workspaceId: params.workspaceId ?? this.workspaceId,
        });
        return this.toMcpResult(result);
      }
    );
  }

  // ─── Workspace Tools ─────────────────────────────────────────────────

  private registerGitStatus(server: McpServer) {
    server.tool(
      "git_status",
      "Get the current git status (staged, unstaged, untracked files, current branch).",
      {
        cwd: z.string().optional().describe("Working directory (default: project root)"),
      },
      async (params) => {
        if (!this.workspaceTools) {
          return this.toMcpResult({ success: false, error: "Workspace tools not available." });
        }
        const result = await this.workspaceTools.gitStatus({ cwd: params.cwd });
        return this.toMcpResult(result);
      }
    );
  }

  private registerGitDiff(server: McpServer) {
    server.tool(
      "git_diff",
      "Get git diff output. Optionally scope to staged changes or a specific file.",
      {
        cwd: z.string().optional().describe("Working directory"),
        staged: z.boolean().optional().describe("Show only staged changes (--cached)"),
        file: z.string().optional().describe("Scope to a specific file path"),
      },
      async (params) => {
        if (!this.workspaceTools) {
          return this.toMcpResult({ success: false, error: "Workspace tools not available." });
        }
        const result = await this.workspaceTools.gitDiff(params);
        return this.toMcpResult(result);
      }
    );
  }

  private registerGitCommit(server: McpServer) {
    server.tool(
      "git_commit",
      "Create a git commit with the given message. Optionally stage all changes first.",
      {
        message: z.string().describe("Commit message"),
        cwd: z.string().optional().describe("Working directory"),
        stageAll: z.boolean().optional().describe("Run 'git add -A' before committing"),
      },
      async (params) => {
        if (!this.workspaceTools) {
          return this.toMcpResult({ success: false, error: "Workspace tools not available." });
        }
        const result = await this.workspaceTools.gitCommit(params);
        return this.toMcpResult(result);
      }
    );
  }

  private registerGetWorkspaceInfo(server: McpServer) {
    server.tool(
      "get_workspace_info",
      "Get workspace details including agent counts, task status summary, and notes overview.",
      {
        workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
      },
      async (params) => {
        if (!this.workspaceTools) {
          return this.toMcpResult({ success: false, error: "Workspace tools not available." });
        }
        const result = await this.workspaceTools.getWorkspaceInfo({
          workspaceId: params.workspaceId ?? this.workspaceId,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerListSpecialists(server: McpServer) {
    server.tool(
      "list_specialists",
      "List all available specialist configurations (roles, model tiers, descriptions).",
      {},
      async () => {
        if (!this.workspaceTools) {
          return this.toMcpResult({ success: false, error: "Workspace tools not available." });
        }
        const result = await this.workspaceTools.listSpecialists();
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
