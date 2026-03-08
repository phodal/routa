/**
 * RoutaMcpToolManager - port of routa-core RoutaMcpToolManager.kt
 *
 * Registers all 12 AgentTools as MCP tools on an McpServer instance.
 * Each tool maps directly to an AgentTools method.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AgentTools } from "../tools/agent-tools";
import { KanbanTools } from "../tools/kanban-tools";
import { NoteTools } from "../tools/note-tools";
import { WorkspaceTools } from "../tools/workspace-tools";
import { ToolResult } from "../tools/tool-result";
import type { RoutaOrchestrator } from "../orchestration/orchestrator";

/**
 * Tool registration mode for MCP server.
 * - "essential": 12 core coordination tools (Agent + Note) for Routa workflow
 * - "full": All 34 tools (Task, Agent, Note, Workspace, Git)
 */
export type ToolMode = "essential" | "full";

export class RoutaMcpToolManager {
  private orchestrator?: RoutaOrchestrator;
  private noteTools?: NoteTools;
  private workspaceTools?: WorkspaceTools;
  private kanbanTools?: KanbanTools;
  private toolMode: ToolMode = "essential";
  private sessionId?: string;

  constructor(
    private tools: AgentTools,
    private workspaceId: string
  ) {}

  /**
   * Set the tool registration mode.
   * - "essential": 12 core coordination tools (Agent + Note)
   * - "full": All tools
   */
  setToolMode(mode: ToolMode): void {
    this.toolMode = mode;
  }

  /**
   * Get the current tool mode.
   */
  getToolMode(): ToolMode {
    return this.toolMode;
  }

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
   * Set the kanban tools for board and card management.
   */
  setKanbanTools(kanbanTools: KanbanTools): void {
    this.kanbanTools = kanbanTools;
  }

  /**
   * Set the session ID for scoping notes to a specific session.
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * Register coordination tools with the MCP server.
   * In "essential" mode, 12 core coordination tools are registered (Agent + Note).
   * In "full" mode, all 34 tools are registered.
   */
  registerTools(server: McpServer): void {
    if (this.toolMode === "essential") {
      // Essential mode: 12 core coordination tools
      // Task tools (1) - needed so delegate_task_to_agent has a taskId to work with
      this.registerCreateTask(server);
      // Agent tools (7)
      this.registerListAgents(server);
      this.registerReadAgentConversation(server);
      this.registerCreateAgent(server);
      this.registerSetAgentName(server);
      this.registerDelegateTask(server);
      this.registerDelegateTaskToNewAgent(server);
      this.registerSendMessageToAgent(server);
      this.registerReportToParent(server);
      // Note tools (5) - critical for Spec workflow and @@@task blocks
      this.registerCreateNote(server);
      this.registerReadNote(server);
      this.registerListNotes(server);
      this.registerSetNoteContent(server);
      this.registerConvertTaskBlocks(server);
      return;
    }

    // Full mode: All tools
    // Task tools
    this.registerCreateTask(server);
    this.registerListTasks(server);
    this.registerUpdateTaskStatus(server);
    this.registerUpdateTask(server);
    // Agent tools
    this.registerListAgents(server);
    this.registerReadAgentConversation(server);
    this.registerCreateAgent(server);
    this.registerSetAgentName(server);
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
    this.registerGetWorkspaceDetails(server);
    this.registerSetWorkspaceTitle(server);
    this.registerListWorkspaces(server);
    this.registerCreateWorkspace(server);
    this.registerListSpecialists(server);
    // Kanban tools
    this.registerCreateBoard(server);
    this.registerListBoards(server);
    this.registerGetBoard(server);
    this.registerCreateCard(server);
    this.registerMoveCard(server);
    this.registerUpdateCard(server);
    this.registerDeleteCard(server);
    this.registerCreateColumn(server);
    this.registerDeleteColumn(server);
    this.registerSearchCards(server);
    this.registerListCardsByColumn(server);
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

  private registerUpdateTaskStatus(server: McpServer) {
    server.tool(
      "update_task_status",
      "Atomically update a task's status. Emits TASK_STATUS_CHANGED event.",
      {
        taskId: z.string().describe("ID of the task to update"),
        status: z.enum(["PENDING", "IN_PROGRESS", "REVIEW_REQUIRED", "COMPLETED", "NEEDS_FIX", "BLOCKED", "CANCELLED"])
          .describe("New task status"),
        agentId: z.string().describe("ID of the agent performing the update"),
        summary: z.string().optional().describe("Completion summary (for COMPLETED/NEEDS_FIX)"),
      },
      async (params) => {
        const result = await this.tools.updateTaskStatus(params);
        return this.toMcpResult(result);
      }
    );
  }

  private registerUpdateTask(server: McpServer) {
    server.tool(
      "update_task",
      "Atomically update task fields with optimistic locking. Provide expectedVersion from a prior read to detect conflicts.",
      {
        taskId: z.string().describe("ID of the task to update"),
        expectedVersion: z.number().optional().describe("Expected version for optimistic locking (from prior task read)"),
        agentId: z.string().describe("ID of the agent performing the update"),
        title: z.string().optional().describe("Update the task title"),
        objective: z.string().optional().describe("Update the task objective"),
        scope: z.string().optional().describe("Update the task scope"),
        status: z.string().optional().describe("Update the task status"),
        completionSummary: z.string().optional().describe("Set completion summary"),
        verificationVerdict: z.enum(["APPROVED", "NOT_APPROVED", "BLOCKED"]).optional().describe("Set verification verdict"),
        verificationReport: z.string().optional().describe("Set verification report"),
        assignedTo: z.string().optional().describe("Assign to agent ID"),
        acceptanceCriteria: z.array(z.string()).optional().describe("Update acceptance criteria"),
      },
      async (params) => {
        const { taskId, expectedVersion, agentId, ...updates } = params;
        const result = await this.tools.updateTask({
          taskId,
          expectedVersion,
          updates,
          agentId,
        });
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
The agent will start working immediately and you'll be notified when it completes.

IMPORTANT: The taskId parameter must be a UUID returned by create_task (e.g., "dda97509-b414-4c50-9835-73a1ec2f...").
Do NOT use task names or @@@task identifiers. First call create_task to create the task and get a UUID, then use that UUID here.
You can also use convert_task_blocks to convert @@@task blocks into tasks, or list_tasks to see existing tasks with their UUIDs.`,
      {
        taskId: z.string().describe("UUID of the task to delegate (MUST be a UUID from create_task, NOT a task name)"),
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

  private registerSetAgentName(server: McpServer) {
    server.tool(
      "set_agent_name",
      "Set your name to reflect your current task. Call this at the beginning of your first response to name yourself appropriately. Names should be short (1-5 words).",
      {
        name: z.string().describe("Short task-focused name (1-5 words)"),
      },
      async (params) => {
        return this.toMcpResult({
          success: true,
          data: {
            ok: true,
            name: params.name,
          },
        });
      }
    );
  }

  private registerDelegateTask(server: McpServer) {
    server.tool(
      "delegate_task",
      `Assign a task to an existing agent and activate it. The agent will begin working on the task.
Note: taskId must be a UUID from create_task, not a task name.`,
      {
        agentId: z.string().describe("UUID of the agent to delegate to"),
        taskId: z.string().describe("UUID of the task to delegate (from create_task, NOT a task name)"),
        callerAgentId: z.string().describe("UUID of the calling agent"),
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
      "Subscribe an agent to workspace events (AGENT_CREATED, TASK_COMPLETED, TASK_STATUS_CHANGED, etc.). Supports one-shot mode and priority.",
      {
        agentId: z.string().describe("ID of the subscribing agent"),
        agentName: z.string().describe("Name of the subscribing agent"),
        eventTypes: z.array(z.string()).describe("Event types to subscribe to"),
        excludeSelf: z.boolean().optional().describe("Exclude self-generated events (default: true)"),
        oneShot: z.boolean().optional().describe("Auto-remove after first matching event (default: false)"),
        waitGroupId: z.string().optional().describe("Wait group ID for after_all semantics"),
        priority: z.number().optional().describe("Priority (higher = notified first, default: 0)"),
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
        sessionId: z.string().optional().describe("Session ID to scope this note to a specific session"),
      },
      async (params) => {
        if (!this.noteTools) {
          return this.toMcpResult({ success: false, error: "Note tools not available." });
        }
        const result = await this.noteTools.createNote({
          ...params,
          workspaceId: params.workspaceId ?? this.workspaceId,
          sessionId: params.sessionId ?? this.sessionId,
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
        sessionId: z.string().optional().describe("Session ID for scoping auto-created task notes"),
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
          sessionId: params.sessionId ?? this.sessionId,
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

  private registerGetWorkspaceDetails(server: McpServer) {
    server.tool(
      "get_workspace_details",
      "Get comprehensive workspace details: metadata, agent counts, task summary, notes overview, and Git branch.",
      {
        workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
      },
      async (params) => {
        if (!this.workspaceTools) {
          return this.toMcpResult({ success: false, error: "Workspace tools not available." });
        }
        const result = await this.workspaceTools.getWorkspaceDetails({
          workspaceId: params.workspaceId ?? this.workspaceId,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerSetWorkspaceTitle(server: McpServer) {
    server.tool(
      "set_workspace_title",
      "Set or rename the workspace title. Optionally renames the Git branch to match.",
      {
        workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
        title: z.string().describe("New workspace title"),
      },
      async (params) => {
        if (!this.workspaceTools) {
          return this.toMcpResult({ success: false, error: "Workspace tools not available." });
        }
        const result = await this.workspaceTools.setWorkspaceTitle({
          workspaceId: params.workspaceId ?? this.workspaceId,
          title: params.title,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerListWorkspaces(server: McpServer) {
    server.tool(
      "list_workspaces",
      "List all workspaces with their id, title, status, and branch.",
      {},
      async () => {
        if (!this.workspaceTools) {
          return this.toMcpResult({ success: false, error: "Workspace tools not available." });
        }
        const result = await this.workspaceTools.listWorkspaces();
        return this.toMcpResult(result);
      }
    );
  }

  private registerCreateWorkspace(server: McpServer) {
    server.tool(
      "create_workspace",
      "Create a new workspace with a title and optional repo path / branch.",
      {
        id: z.string().describe("Unique workspace ID"),
        title: z.string().describe("Workspace title"),
        repoPath: z.string().optional().describe("Local path to Git repository"),
        branch: z.string().optional().describe("Git branch name"),
      },
      async (params) => {
        if (!this.workspaceTools) {
          return this.toMcpResult({ success: false, error: "Workspace tools not available." });
        }
        const result = await this.workspaceTools.createWorkspace(params);
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

  // ─── Kanban Tools ───────────────────────────────────────────────────────

  private registerCreateBoard(server: McpServer) {
    server.tool(
      "create_board",
      "Create a new Kanban board",
      {
        name: z.string().describe("Board name"),
        columns: z.array(z.string()).optional().describe("Default column names"),
        workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
      },
      async (params) => {
        if (!this.kanbanTools) {
          return this.toMcpResult({ success: false, error: "Kanban tools not available." });
        }
        const result = await this.kanbanTools.createBoard({
          workspaceId: params.workspaceId ?? this.workspaceId,
          name: params.name,
          columns: params.columns,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerListBoards(server: McpServer) {
    server.tool(
      "list_boards",
      "List all Kanban boards",
      {
        workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
      },
      async (params) => {
        if (!this.kanbanTools) {
          return this.toMcpResult({ success: false, error: "Kanban tools not available." });
        }
        const result = await this.kanbanTools.listBoards(params.workspaceId ?? this.workspaceId);
        return this.toMcpResult(result);
      }
    );
  }

  private registerGetBoard(server: McpServer) {
    server.tool(
      "get_board",
      "Get a board with all columns and cards",
      {
        boardId: z.string().describe("Board ID"),
      },
      async (params) => {
        if (!this.kanbanTools) {
          return this.toMcpResult({ success: false, error: "Kanban tools not available." });
        }
        const result = await this.kanbanTools.getBoard(params.boardId);
        return this.toMcpResult(result);
      }
    );
  }

  private registerCreateCard(server: McpServer) {
    server.tool(
      "create_card",
      "Create a new card in a column",
      {
        boardId: z.string().describe("Board ID"),
        columnId: z.string().describe("Column ID"),
        title: z.string().describe("Card title"),
        description: z.string().optional().describe("Card description"),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional().describe("Card priority"),
        labels: z.array(z.string()).optional().describe("Card labels"),
        workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
      },
      async (params) => {
        if (!this.kanbanTools) {
          return this.toMcpResult({ success: false, error: "Kanban tools not available." });
        }
        const result = await this.kanbanTools.createCard({
          boardId: params.boardId,
          columnId: params.columnId,
          title: params.title,
          description: params.description,
          priority: params.priority,
          labels: params.labels,
          workspaceId: params.workspaceId ?? this.workspaceId,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerMoveCard(server: McpServer) {
    server.tool(
      "move_card",
      "Move a card to a different column or position",
      {
        cardId: z.string().describe("Card ID"),
        targetColumnId: z.string().describe("Target column ID"),
        position: z.number().optional().describe("Position in the column"),
      },
      async (params) => {
        if (!this.kanbanTools) {
          return this.toMcpResult({ success: false, error: "Kanban tools not available." });
        }
        const result = await this.kanbanTools.moveCard({
          cardId: params.cardId,
          targetColumnId: params.targetColumnId,
          position: params.position,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerUpdateCard(server: McpServer) {
    server.tool(
      "update_card",
      "Update card fields (title, description, priority, labels)",
      {
        cardId: z.string().describe("Card ID"),
        title: z.string().optional().describe("New title"),
        description: z.string().optional().describe("New description"),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional().describe("New priority"),
        labels: z.array(z.string()).optional().describe("New labels"),
      },
      async (params) => {
        if (!this.kanbanTools) {
          return this.toMcpResult({ success: false, error: "Kanban tools not available." });
        }
        const result = await this.kanbanTools.updateCard({
          cardId: params.cardId,
          title: params.title,
          description: params.description,
          priority: params.priority,
          labels: params.labels,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerDeleteCard(server: McpServer) {
    server.tool(
      "delete_card",
      "Delete a card from the board",
      {
        cardId: z.string().describe("Card ID"),
      },
      async (params) => {
        if (!this.kanbanTools) {
          return this.toMcpResult({ success: false, error: "Kanban tools not available." });
        }
        const result = await this.kanbanTools.deleteCard(params.cardId);
        return this.toMcpResult(result);
      }
    );
  }

  private registerCreateColumn(server: McpServer) {
    server.tool(
      "create_column",
      "Create a new column in a board",
      {
        boardId: z.string().describe("Board ID"),
        name: z.string().describe("Column name"),
        color: z.string().optional().describe("Column color"),
      },
      async (params) => {
        if (!this.kanbanTools) {
          return this.toMcpResult({ success: false, error: "Kanban tools not available." });
        }
        const result = await this.kanbanTools.createColumn({
          boardId: params.boardId,
          name: params.name,
          color: params.color,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerDeleteColumn(server: McpServer) {
    server.tool(
      "delete_column",
      "Delete a column (and optionally its cards)",
      {
        columnId: z.string().describe("Column ID"),
        boardId: z.string().describe("Board ID"),
        deleteCards: z.boolean().optional().describe("Whether to delete cards in the column"),
      },
      async (params) => {
        if (!this.kanbanTools) {
          return this.toMcpResult({ success: false, error: "Kanban tools not available." });
        }
        const result = await this.kanbanTools.deleteColumn({
          columnId: params.columnId,
          boardId: params.boardId,
          deleteCards: params.deleteCards,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerSearchCards(server: McpServer) {
    server.tool(
      "search_cards",
      "Search cards across boards by title, labels, or assignee",
      {
        query: z.string().describe("Search query"),
        boardId: z.string().optional().describe("Limit search to a specific board"),
        workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
      },
      async (params) => {
        if (!this.kanbanTools) {
          return this.toMcpResult({ success: false, error: "Kanban tools not available." });
        }
        const result = await this.kanbanTools.searchCards({
          query: params.query,
          boardId: params.boardId,
          workspaceId: params.workspaceId ?? this.workspaceId,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerListCardsByColumn(server: McpServer) {
    server.tool(
      "list_cards_by_column",
      "List all cards in a specific column",
      {
        columnId: z.string().describe("Column ID"),
        boardId: z.string().describe("Board ID"),
      },
      async (params) => {
        if (!this.kanbanTools) {
          return this.toMcpResult({ success: false, error: "Kanban tools not available." });
        }
        const result = await this.kanbanTools.listCardsByColumn(params.columnId, params.boardId);
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
