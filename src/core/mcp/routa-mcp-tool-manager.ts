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
import {
  assembleTaskAdaptiveHarnessFromToolArgs,
  CONFIRM_FEATURE_TREE_STORY_CONTEXT_TOOL_NAME,
  FILE_SESSION_CONTEXT_TOOL_NAME,
  inspectTranscriptTurnsFromToolArgs,
  LOAD_FEATURE_TREE_CONTEXT_TOOL_NAME,
  LOAD_RETROSPECTIVE_MEMORY_TOOL_NAME,
  loadFeatureRetrospectiveMemoryFromToolArgs,
  SAVE_RETROSPECTIVE_MEMORY_TOOL_NAME,
  saveFeatureRetrospectiveMemoryFromToolArgs,
  summarizeFileSessionContextFromToolArgs,
  summarizeTaskHistoryContextFromToolArgs,
  TASK_ADAPTIVE_HARNESS_TOOL_NAME,
  TASK_HISTORY_SUMMARY_TOOL_NAME,
  TRANSCRIPT_TURN_INSPECTION_TOOL_NAME,
} from "../harness/task-adaptive-tool";
import { readCanvasSdkResource } from "../canvas/sdk-resource-contract";
import { readFeatureTreeSpecResource } from "../spec/feature-tree-spec-resource-contract";
import {
  registerConfirmFeatureTreeStoryContextTool,
  registerLoadFeatureTreeContextTool,
} from "./feature-tree-context-tools";

/**
 * Tool registration mode for MCP server.
 * - "essential": 12 core coordination tools (Agent + Note) for Routa workflow
 * - "full": All 34 tools (Task, Agent, Note, Workspace, Git)
 */
export type ToolMode = "essential" | "full";

const taskContextSearchSpecSchema = z.object({
  query: z.string().optional().describe("Free-text retrieval query for relevant history or feature context."),
  featureCandidates: z.array(z.string()).optional().describe("Candidate Feature Tree IDs that may own this task."),
  relatedFiles: z.array(z.string()).optional().describe("Repository-relative files already believed to be relevant."),
  routeCandidates: z.array(z.string()).optional().describe("Candidate routes or pages related to the task."),
  apiCandidates: z.array(z.string()).optional().describe("Candidate API paths or RPC surfaces related to the task."),
  moduleHints: z.array(z.string()).optional().describe("Module or subsystem hints to narrow history search."),
  symptomHints: z.array(z.string()).optional().describe("User-visible errors, failure symptoms, or friction hints."),
});

const taskJitContextAnalysisSchema = z.object({
  updatedAt: z.string().optional().describe("ISO timestamp for when this structured history analysis was produced."),
  summary: z.string().describe("Compressed explanation of what the matched history means for this task."),
  topFiles: z.array(z.string()).optional().describe("Highest-priority files to inspect first."),
  topSessions: z.array(z.object({
    sessionId: z.string().describe("Matched Codex/Claude session ID."),
    provider: z.string().optional().describe("Provider label for the matched session."),
    reason: z.string().describe("Why this session is worth following up."),
  })).optional().describe("Highest-priority sessions to inspect first."),
  reusablePrompts: z.array(z.string()).optional().describe("2-4 reusable follow-up prompts."),
  recommendedContextSearchSpec: taskContextSearchSpecSchema.optional().describe("Structured retrieval hints to reuse in future JIT Context loads."),
});

type DelegationOrchestrator = {
  getSessionForAgent(agentId: string): string | undefined;
  delegateTaskWithSpawn(params: {
    taskId: string;
    callerAgentId: string;
    callerSessionId: string;
    workspaceId: string;
    specialist: string;
    provider?: string;
    cwd?: string;
    additionalInstructions?: string;
    waitMode?: "immediate" | "after_all";
  }): Promise<ToolResult>;
};

export class RoutaMcpToolManager {
  private orchestrator?: DelegationOrchestrator;
  private noteTools?: NoteTools;
  private workspaceTools?: WorkspaceTools;
  private kanbanTools?: KanbanTools;
  private toolMode: ToolMode = "essential";
  private allowedTools?: ReadonlySet<string>;
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

  setAllowedTools(allowedTools?: ReadonlySet<string>): void {
    this.allowedTools = allowedTools;
  }

  /**
   * Set the orchestrator for process-spawning delegation.
   */
  setOrchestrator(orchestrator: DelegationOrchestrator): void {
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
    const register = (toolName: string, callback: () => void) => {
      if (!this.shouldRegisterTool(toolName)) {
        return;
      }
      callback();
    };

    if (this.toolMode === "essential") {
      // Essential mode: 14 core coordination tools
      // Task tools (1) - needed so delegate_task_to_agent has a taskId to work with
      register("create_task", () => this.registerCreateTask(server));
      // Agent tools (7)
      register("list_agents", () => this.registerListAgents(server));
      register("read_agent_conversation", () => this.registerReadAgentConversation(server));
      register("create_agent", () => this.registerCreateAgent(server));
      register("set_agent_name", () => this.registerSetAgentName(server));
      register("delegate_task", () => this.registerDelegateTask(server));
      register("delegate_task_to_agent", () => this.registerDelegateTaskToNewAgent(server));
      register("send_message_to_agent", () => this.registerSendMessageToAgent(server));
      register("report_to_parent", () => this.registerReportToParent(server));
      // Note tools (5) - critical for Spec workflow and @@@task blocks
      register("create_note", () => this.registerCreateNote(server));
      register("read_note", () => this.registerReadNote(server));
      register("list_notes", () => this.registerListNotes(server));
      register("set_note_content", () => this.registerSetNoteContent(server));
      register("convert_task_blocks", () => this.registerConvertTaskBlocks(server));
      // Kanban tools (2) - needed for card-assigned agents to update their cards
      register("update_card", () => this.registerUpdateCard(server));
      register("move_card", () => this.registerMoveCard(server));
      register("request_previous_lane_handoff", () => this.registerRequestPreviousLaneHandoff(server));
      register("submit_lane_handoff", () => this.registerSubmitLaneHandoff(server));
      // Artifact tools (6) - critical for multi-agent coordination and desk check workflow
      register("request_artifact", () => this.registerRequestArtifact(server));
      register("provide_artifact", () => this.registerProvideArtifact(server));
      register("list_artifacts", () => this.registerListArtifacts(server));
      register("get_artifact", () => this.registerGetArtifact(server));
      register("list_pending_artifact_requests", () => this.registerListPendingArtifactRequests(server));
      register("capture_screenshot", () => this.registerCaptureScreenshot(server));
      register("read_specialist_spec_resource", () => this.registerReadSpecialistSpecResource(server));
      register(TASK_ADAPTIVE_HARNESS_TOOL_NAME, () => this.registerAssembleTaskAdaptiveHarness(server));
      register(TASK_HISTORY_SUMMARY_TOOL_NAME, () => this.registerSummarizeTaskHistoryContext(server));
      register(FILE_SESSION_CONTEXT_TOOL_NAME, () => this.registerSummarizeFileSessionContext(server));
      register(TRANSCRIPT_TURN_INSPECTION_TOOL_NAME, () => this.registerInspectTranscriptTurns(server));
      register("save_history_memory_context", () => this.registerSaveJitContext(server));
      register(LOAD_FEATURE_TREE_CONTEXT_TOOL_NAME, () => this.registerLoadFeatureTreeContext(server));
      register(CONFIRM_FEATURE_TREE_STORY_CONTEXT_TOOL_NAME, () => this.registerConfirmFeatureTreeStoryContext(server));
      register(LOAD_RETROSPECTIVE_MEMORY_TOOL_NAME, () => this.registerLoadRetrospectiveMemory(server));
      register(SAVE_RETROSPECTIVE_MEMORY_TOOL_NAME, () => this.registerSaveRetrospectiveMemory(server));
      return;
    }

    // Full mode: All tools
    // Task tools
    register("create_task", () => this.registerCreateTask(server));
    register("list_tasks", () => this.registerListTasks(server));
    register("update_task_status", () => this.registerUpdateTaskStatus(server));
    register("update_task", () => this.registerUpdateTask(server));
    register("save_history_memory_context", () => this.registerSaveJitContext(server));
    register(LOAD_FEATURE_TREE_CONTEXT_TOOL_NAME, () => this.registerLoadFeatureTreeContext(server));
    register(CONFIRM_FEATURE_TREE_STORY_CONTEXT_TOOL_NAME, () => this.registerConfirmFeatureTreeStoryContext(server));
    // Agent tools
    register("list_agents", () => this.registerListAgents(server));
    register("read_agent_conversation", () => this.registerReadAgentConversation(server));
    register("create_agent", () => this.registerCreateAgent(server));
    register("set_agent_name", () => this.registerSetAgentName(server));
    register("delegate_task", () => this.registerDelegateTask(server));
    register("delegate_task_to_agent", () => this.registerDelegateTaskToNewAgent(server));
    register("send_message_to_agent", () => this.registerSendMessageToAgent(server));
    register("report_to_parent", () => this.registerReportToParent(server));
    register("wake_or_create_task_agent", () => this.registerWakeOrCreateTaskAgent(server));
    register("send_message_to_task_agent", () => this.registerSendMessageToTaskAgent(server));
    register("get_agent_status", () => this.registerGetAgentStatus(server));
    register("get_agent_summary", () => this.registerGetAgentSummary(server));
    register("subscribe_to_events", () => this.registerSubscribeToEvents(server));
    register("unsubscribe_from_events", () => this.registerUnsubscribeFromEvents(server));
    // Note tools
    register("create_note", () => this.registerCreateNote(server));
    register("read_note", () => this.registerReadNote(server));
    register("list_notes", () => this.registerListNotes(server));
    register("set_note_content", () => this.registerSetNoteContent(server));
    register("append_to_note", () => this.registerAppendToNote(server));
    register("get_my_task", () => this.registerGetMyTask(server));
    register("convert_task_blocks", () => this.registerConvertTaskBlocks(server));
    // Workspace tools
    register("git_status", () => this.registerGitStatus(server));
    register("git_diff", () => this.registerGitDiff(server));
    register("git_commit", () => this.registerGitCommit(server));
    register("get_workspace_info", () => this.registerGetWorkspaceInfo(server));
    register("get_workspace_details", () => this.registerGetWorkspaceDetails(server));
    register("set_workspace_title", () => this.registerSetWorkspaceTitle(server));
    register("list_workspaces", () => this.registerListWorkspaces(server));
    register("create_workspace", () => this.registerCreateWorkspace(server));
    register("list_specialists", () => this.registerListSpecialists(server));
    // Kanban tools
    register("create_board", () => this.registerCreateBoard(server));
    register("list_boards", () => this.registerListBoards(server));
    register("get_board", () => this.registerGetBoard(server));
    register("create_card", () => this.registerCreateCard(server));
    register("move_card", () => this.registerMoveCard(server));
    register("update_card", () => this.registerUpdateCard(server));
    register("delete_card", () => this.registerDeleteCard(server));
    register("create_column", () => this.registerCreateColumn(server));
    register("delete_column", () => this.registerDeleteColumn(server));
    register("search_cards", () => this.registerSearchCards(server));
    register("list_cards_by_column", () => this.registerListCardsByColumn(server));
    register("decompose_tasks", () => this.registerDecomposeTasks(server));
    register("request_previous_lane_handoff", () => this.registerRequestPreviousLaneHandoff(server));
    register("submit_lane_handoff", () => this.registerSubmitLaneHandoff(server));
    // Artifact tools
    register("request_artifact", () => this.registerRequestArtifact(server));
    register("provide_artifact", () => this.registerProvideArtifact(server));
    register("list_artifacts", () => this.registerListArtifacts(server));
    register("get_artifact", () => this.registerGetArtifact(server));
    register("list_pending_artifact_requests", () => this.registerListPendingArtifactRequests(server));
    register("capture_screenshot", () => this.registerCaptureScreenshot(server));
    register("read_canvas_sdk_resource", () => this.registerReadCanvasSdkResource(server));
    register("read_specialist_spec_resource", () => this.registerReadSpecialistSpecResource(server));
    register(TASK_ADAPTIVE_HARNESS_TOOL_NAME, () => this.registerAssembleTaskAdaptiveHarness(server));
    register(TASK_HISTORY_SUMMARY_TOOL_NAME, () => this.registerSummarizeTaskHistoryContext(server));
    register(FILE_SESSION_CONTEXT_TOOL_NAME, () => this.registerSummarizeFileSessionContext(server));
    register(TRANSCRIPT_TURN_INSPECTION_TOOL_NAME, () => this.registerInspectTranscriptTurns(server));
    register(LOAD_RETROSPECTIVE_MEMORY_TOOL_NAME, () => this.registerLoadRetrospectiveMemory(server));
    register(SAVE_RETROSPECTIVE_MEMORY_TOOL_NAME, () => this.registerSaveRetrospectiveMemory(server));
  }

  private shouldRegisterTool(toolName: string): boolean {
    return !this.allowedTools || this.allowedTools.has(toolName);
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
        testCases: z.array(z.string()).optional().describe("Human-readable test cases to create or verify"),
        verificationCommands: z.array(z.string()).optional().describe("Commands to run for verification"),
        dependencies: z.array(z.string()).optional().describe("Task IDs that must complete first"),
        parallelGroup: z.string().optional().describe("Group ID for parallel execution"),
        creationSource: z.enum(["manual", "agent", "api", "session"]).optional().describe("How the task was created"),
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
      "Atomically update structured task fields with optimistic locking. Use this for story-readiness fields such as scope, acceptance criteria, verification commands, and test cases. agentId is optional for Kanban sessions.",
      {
        taskId: z.string().describe("ID of the task to update"),
        expectedVersion: z.number().optional().describe("Expected version for optimistic locking (from prior task read)"),
        agentId: z.string().optional().describe("ID of the agent performing the update (optional in Kanban sessions)"),
        title: z.string().optional().describe("Update the task title"),
        objective: z.string().optional().describe("Update the task objective"),
        scope: z.string().optional().describe("Update the task scope"),
        status: z.string().optional().describe("Update the task status"),
        completionSummary: z.string().optional().describe("Set completion summary"),
        verificationVerdict: z.enum(["APPROVED", "NOT_APPROVED", "BLOCKED"]).optional().describe("Set verification verdict"),
        verificationReport: z.string().optional().describe("Set verification report"),
        assignedTo: z.string().optional().describe("Assign to agent ID"),
        acceptanceCriteria: z.array(z.string()).optional().describe("Update acceptance criteria"),
        verificationCommands: z.array(z.string()).optional().describe("Update verification commands"),
        testCases: z.array(z.string()).optional().describe("Update test cases"),
        contextSearchSpec: taskContextSearchSpecSchema.optional().describe("Confirmed retrieval hints for JIT Context and history search. In backlog planning, only persist this after repo inspection or load_feature_tree_context confirms the feature/files."),
        jitContextAnalysis: taskJitContextAnalysisSchema.nullable().optional().describe("Structured JIT/history analysis to persist on the task for later reuse."),
      },
      async (params) => {
        const { taskId, expectedVersion, agentId, ...updates } = params;
        const result = await this.tools.updateTask({
          taskId,
          expectedVersion,
          updates: {
            ...updates,
            jitContextAnalysis: params.jitContextAnalysis as import("../models/task").TaskJitContextAnalysis | null | undefined,
          },
          agentId: agentId ?? "system",
          sessionId: this.sessionId,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerSaveJitContext(server: McpServer) {
    server.tool(
      "save_history_memory_context",
      "Persist the minimal task-adaptive history memory result for a task so later sessions can load it directly.",
      {
        taskId: z.string().describe("ID of the task to update"),
        agentId: z.string().optional().describe("ID of the agent performing the save (optional in Kanban sessions)"),
        updatedAt: z.string().optional().describe("ISO timestamp for when the result was produced."),
        summary: z.string().describe("Compressed reusable task-adaptive history memory conclusion for the task."),
        topFiles: z.array(z.string()).optional().describe("Highest-priority files to inspect first next time."),
        topSessions: z.array(z.object({
          sessionId: z.string().describe("Matched Codex/Claude session ID."),
          provider: z.string().optional().describe("Provider label for the matched session."),
          reason: z.string().describe("Why this session is worth following up."),
        })).optional().describe("Highest-priority sessions to inspect first."),
        reusablePrompts: z.array(z.string()).optional().describe("2-4 reusable follow-up prompts."),
        recommendedContextSearchSpec: taskContextSearchSpecSchema.optional().describe("Structured retrieval hints to reuse next time."),
      },
      async (params) => {
        const result = await this.tools.saveJitContext({
          taskId: params.taskId,
          result: {
            updatedAt: params.updatedAt,
            summary: params.summary,
            topFiles: params.topFiles ?? [],
            topSessions: params.topSessions ?? [],
            reusablePrompts: params.reusablePrompts ?? [],
            recommendedContextSearchSpec: params.recommendedContextSearchSpec,
          },
          agentId: params.agentId ?? "system",
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerLoadFeatureTreeContext(server: McpServer) {
    registerLoadFeatureTreeContextTool({
      server,
      workspaceId: this.workspaceId,
      toMcpResult: (result) => this.toMcpResult(result as ToolResult),
    });
  }

  private registerConfirmFeatureTreeStoryContext(server: McpServer) {
    registerConfirmFeatureTreeStoryContextTool({
      server,
      workspaceId: this.workspaceId,
      toMcpResult: (result) => this.toMcpResult(result as ToolResult),
    });
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
        boardId: z.string().optional().describe("Board ID (defaults to the workspace default board)"),
        columnId: z.string().optional().describe("Column ID"),
        column: z.string().optional().describe("Column ID alias"),
        title: z.string().describe("Card title"),
        description: z.string().optional().describe("Card description"),
        contextSearchSpec: taskContextSearchSpecSchema.optional().describe("Confirmed retrieval hints for JIT Context and history search. In backlog planning, omit this until repo inspection or load_feature_tree_context confirms the feature/files."),
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
          columnId: params.columnId ?? params.column,
          title: params.title,
          description: params.description,
          contextSearchSpec: params.contextSearchSpec,
          sessionId: this.sessionId,
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
      "Move a card to a different column. Use 'dev' when starting work, 'review' for code review, 'done' when complete.",
      {
        cardId: z.string().describe("Card ID"),
        targetColumnId: z.string().describe("Target column ID. Valid columns: 'backlog', 'todo', 'dev' (in progress), 'review', 'blocked', 'done'"),
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
      "Update card fields (title, description, comment, priority, labels). From dev onward, prefer comment because description is frozen. For story-readiness fields such as scope, acceptance criteria, verification commands, or test cases, use update_task instead.",
      {
        cardId: z.string().describe("Card ID"),
        title: z.string().optional().describe("New title"),
        description: z.string().optional().describe("New description"),
        comment: z.string().optional().describe("Comment or progress note to append"),
        agentId: z.string().optional().describe("Agent ID adding the progress note"),
        sessionId: z.string().optional().describe("Session ID adding the progress note"),
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
          comment: params.comment,
          agentId: params.agentId,
          sessionId: params.sessionId,
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
        boardId: z.string().optional().describe("Board ID (defaults to the workspace default board)"),
      },
      async (params) => {
        if (!this.kanbanTools) {
          return this.toMcpResult({ success: false, error: "Kanban tools not available." });
        }
        const result = await this.kanbanTools.listCardsByColumn(params.columnId, params.boardId, this.workspaceId);
        return this.toMcpResult(result);
      }
    );
  }

  private registerRequestPreviousLaneHandoff(server: McpServer) {
    server.tool(
      "request_previous_lane_handoff",
      "Request runtime help from the immediately previous Kanban lane for the same card. Use this when review needs environment preparation or setup context from dev.",
      {
        taskId: z.string().describe("Card/task ID"),
        requestType: z.enum(["environment_preparation", "runtime_context", "clarification", "rerun_command"])
          .describe("Type of help needed from the previous lane"),
        request: z.string().describe("Concrete request for the previous lane session"),
      },
      async (params) => {
        if (!this.kanbanTools) {
          return this.toMcpResult({ success: false, error: "Kanban tools not available." });
        }
        if (!this.sessionId) {
          return this.toMcpResult({ success: false, error: "Current ACP session is not available for lane handoff." });
        }
        const result = await this.kanbanTools.requestPreviousLaneHandoff({
          taskId: params.taskId,
          requestType: params.requestType,
          request: params.request,
          sessionId: this.sessionId,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerSubmitLaneHandoff(server: McpServer) {
    server.tool(
      "submit_lane_handoff",
      "Submit the result of a lane handoff request after preparing environment or runtime context for another Kanban lane.",
      {
        taskId: z.string().describe("Card/task ID"),
        handoffId: z.string().describe("Lane handoff request ID"),
        status: z.enum(["completed", "blocked", "failed"]).describe("Outcome of the handoff support work"),
        summary: z.string().describe("Concise summary of what was prepared or why it is blocked"),
      },
      async (params) => {
        if (!this.kanbanTools) {
          return this.toMcpResult({ success: false, error: "Kanban tools not available." });
        }
        if (!this.sessionId) {
          return this.toMcpResult({ success: false, error: "Current ACP session is not available for lane handoff." });
        }
        const result = await this.kanbanTools.submitLaneHandoff({
          taskId: params.taskId,
          handoffId: params.handoffId,
          status: params.status,
          summary: params.summary,
          sessionId: this.sessionId,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerDecomposeTasks(server: McpServer) {
    server.tool(
      "decompose_tasks",
      "Create multiple Kanban cards from a list of decomposed tasks. Use this to bulk-create cards from a task breakdown.",
      {
        boardId: z.string().optional().describe("Board ID (defaults to the workspace default board)"),
        workspaceId: z.string().optional().describe("Workspace ID (uses default if omitted)"),
        tasks: z.array(z.object({
          title: z.string().describe("Task title"),
          description: z.string().optional().describe("Task description"),
          contextSearchSpec: taskContextSearchSpecSchema.optional().describe("Confirmed retrieval hints for JIT Context and history search. In backlog planning, omit this until repo inspection or load_feature_tree_context confirms the feature/files."),
          priority: z.enum(["low", "medium", "high", "urgent"]).optional().describe("Task priority"),
          labels: z.array(z.string()).optional().describe("Task labels"),
        })).describe("Array of tasks to create"),
        columnId: z.string().optional().default("backlog").describe("Target column ID (default: backlog)"),
        column: z.string().optional().describe("Column ID alias"),
      },
      async (params) => {
        if (!this.kanbanTools) {
          return this.toMcpResult({ success: false, error: "Kanban tools not available." });
        }
        const result = await this.kanbanTools.decomposeTasks({
          boardId: params.boardId,
          workspaceId: params.workspaceId ?? this.workspaceId,
          tasks: params.tasks,
          columnId: params.columnId ?? params.column,
          sessionId: this.sessionId,
        });
        return this.toMcpResult(result);
      }
    );
  }

  // ─── Artifact Tools ───────────────────────────────────────────────────

  private registerRequestArtifact(server: McpServer) {
    server.tool(
      "request_artifact",
      `Request an artifact from another agent (e.g., screenshot, test results).
Used by verification agents to request evidence from implementation agents.`,
      {
        fromAgentId: z.string().describe("ID of the requesting agent"),
        toAgentId: z.string().describe("ID of the agent to provide the artifact"),
        artifactType: z.enum(["screenshot", "test_results", "code_diff", "logs"]).describe("Type of artifact"),
        taskId: z.string().describe("Task ID this artifact is for"),
        context: z.string().optional().describe("Context or instructions for the request"),
      },
      async (params) => {
        const result = await this.tools.requestArtifact({
          ...params,
          workspaceId: this.workspaceId,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerProvideArtifact(server: McpServer) {
    server.tool(
      "provide_artifact",
      `Provide an artifact (screenshot, test results, etc.) for a task.
Can be in response to a request or proactively provided.`,
      {
        agentId: z.string().describe("ID of the providing agent"),
        type: z.enum(["screenshot", "test_results", "code_diff", "logs"]).describe("Type of artifact"),
        taskId: z.string().describe("Task ID this artifact is for"),
        content: z.string().describe("Artifact content (base64 for images, text for others)"),
        context: z.string().optional().describe("Description or context"),
        requestId: z.string().optional().describe("Request ID if fulfilling a request"),
        metadata: z.record(z.string(), z.string()).optional().describe("Additional metadata"),
      },
      async (params) => {
        const result = await this.tools.provideArtifact({
          agentId: params.agentId,
          type: params.type as "screenshot" | "test_results" | "code_diff" | "logs",
          taskId: params.taskId,
          workspaceId: this.workspaceId,
          content: params.content,
          context: params.context,
          requestId: params.requestId,
          metadata: params.metadata,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerListArtifacts(server: McpServer) {
    server.tool(
      "list_artifacts",
      "List artifacts for a task",
      {
        taskId: z.string().describe("Task ID to list artifacts for"),
        type: z.enum(["screenshot", "test_results", "code_diff", "logs"]).optional().describe("Filter by type"),
      },
      async (params) => {
        const result = await this.tools.listArtifacts({
          taskId: params.taskId,
          type: params.type as "screenshot" | "test_results" | "code_diff" | "logs" | undefined,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerGetArtifact(server: McpServer) {
    server.tool(
      "get_artifact",
      "Get a specific artifact by ID",
      {
        artifactId: z.string().describe("Artifact ID"),
      },
      async (params) => {
        const result = await this.tools.getArtifact(params.artifactId);
        return this.toMcpResult(result);
      }
    );
  }

  private registerListPendingArtifactRequests(server: McpServer) {
    server.tool(
      "list_pending_artifact_requests",
      "List pending artifact requests for an agent",
      {
        agentId: z.string().describe("Agent ID to list pending requests for"),
      },
      async (params) => {
        const result = await this.tools.listPendingArtifactRequests(params.agentId);
        return this.toMcpResult(result);
      }
    );
  }

  private registerCaptureScreenshot(server: McpServer) {
    server.tool(
      "capture_screenshot",
      "Capture a screenshot using agent-browser and store it as an artifact",
      {
        agentId: z.string().describe("ID of the agent capturing the screenshot"),
        taskId: z.string().describe("Task ID this screenshot is for"),
        url: z.string().optional().describe("URL to navigate to before capturing"),
        fullPage: z.boolean().optional().describe("Capture full page (default: false)"),
        annotate: z.boolean().optional().describe("Annotate interactive elements (default: false)"),
        context: z.string().optional().describe("Description or context for this screenshot"),
        outputPath: z.string().optional().describe("Path to save screenshot (optional)"),
      },
      async (params) => {
        const result = await this.tools.captureScreenshot({
          agentId: params.agentId,
          taskId: params.taskId,
          workspaceId: this.workspaceId,
          url: params.url,
          fullPage: params.fullPage,
          annotate: params.annotate,
          context: params.context,
          outputPath: params.outputPath,
        });
        return this.toMcpResult(result);
      }
    );
  }

  private registerReadCanvasSdkResource(server: McpServer) {
    server.tool(
      "read_canvas_sdk_resource",
      "Read the Routa Canvas SDK manifest or a generated definition resource by resource URI. Use this when your provider cannot call MCP resources/read directly.",
      {
        uri: z.string().describe("Canvas SDK resource URI, e.g. resource://routa/canvas-sdk/manifest"),
      },
      async (params) => {
        const resource = readCanvasSdkResource(params.uri);
        if (!resource) {
          return this.toMcpResult({
            success: false,
            error: `Unknown Canvas SDK resource URI: ${params.uri}`,
          });
        }
        return this.toMcpResult({
          success: true,
          data: resource,
        });
      }
    );
  }

  private registerReadSpecialistSpecResource(server: McpServer) {
    server.tool(
      "read_specialist_spec_resource",
      "Read a bundled specialist framework spec resource by URI. Use this when your provider cannot call MCP resources/read directly.",
      {
        uri: z.string().describe("Specialist spec resource URI, e.g. resource://routa/specialists/feature-tree/manifest"),
      },
      async (params) => {
        const resource = readFeatureTreeSpecResource(params.uri);
        if (!resource) {
          return this.toMcpResult({
            success: false,
            error: `Unknown specialist spec resource URI: ${params.uri}`,
          });
        }
        return this.toMcpResult({
          success: true,
          data: resource,
        });
      }
    );
  }

  private registerAssembleTaskAdaptiveHarness(server: McpServer) {
    server.tool(
      TASK_ADAPTIVE_HARNESS_TOOL_NAME,
      "Compile a Task-Adaptive Harness pack by retrieving relevant history sessions, file signals, and prior read failures for the current task.",
      {
        workspaceId: z.string().optional().describe("Workspace ID override. Uses the current MCP session workspace when omitted."),
        codebaseId: z.string().optional().describe("Optional codebase ID override."),
        repoPath: z.string().optional().describe("Optional repository path override."),
        taskLabel: z.string().optional().describe("Short label for the current task or request."),
        locale: z.string().optional().describe("Optional locale hint, e.g. en or zh-CN."),
        featureId: z.string().optional().describe("Optional Feature Explorer feature ID."),
        featureIds: z.array(z.string()).optional().describe("Optional ordered candidate Feature Tree IDs."),
        filePaths: z.array(z.string()).optional().describe("Optional repository-relative file paths already known to be relevant."),
        routeCandidates: z.array(z.string()).optional().describe("Optional route hints for file inference."),
        apiCandidates: z.array(z.string()).optional().describe("Optional API hints for file inference."),
        historySessionIds: z.array(z.string()).optional().describe("Optional history session IDs to prioritize."),
        moduleHints: z.array(z.string()).optional().describe("Optional module or subsystem hints."),
        symptomHints: z.array(z.string()).optional().describe("Optional user-visible symptom hints."),
        taskType: z.enum(["implementation", "planning", "analysis", "review"]).optional()
          .describe("Task type hint used for recommendation heuristics."),
        maxFiles: z.number().int().positive().optional().describe("Maximum number of files to include."),
        maxSessions: z.number().int().positive().optional().describe("Maximum number of history sessions to include."),
        role: z.string().optional().describe("Optional agent role hint, e.g. ROUTA or CRAFTER."),
      },
      async (params) => {
        try {
          const result = await assembleTaskAdaptiveHarnessFromToolArgs(params, this.workspaceId);
          return this.toMcpResult({
            success: true,
            data: result,
          });
        } catch (error) {
          return this.toMcpResult({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    );
  }

  private registerSummarizeTaskHistoryContext(server: McpServer) {
    server.tool(
      TASK_HISTORY_SUMMARY_TOOL_NAME,
      "Compress linked history sessions into a History Summary so analysts can start from seeds and friction signals instead of rereading every transcript.",
      {
        workspaceId: z.string().optional().describe("Workspace ID override. Uses the current MCP session workspace when omitted."),
        codebaseId: z.string().optional().describe("Optional codebase ID override."),
        repoPath: z.string().optional().describe("Optional repository path override."),
        taskLabel: z.string().optional().describe("Short label for the current task or request."),
        locale: z.string().optional().describe("Optional locale hint, e.g. en or zh-CN."),
        featureId: z.string().optional().describe("Optional Feature Explorer feature ID."),
        featureIds: z.array(z.string()).optional().describe("Optional ordered candidate Feature Tree IDs."),
        filePaths: z.array(z.string()).optional().describe("Optional repository-relative file paths already known to be relevant."),
        routeCandidates: z.array(z.string()).optional().describe("Optional route hints for file inference."),
        apiCandidates: z.array(z.string()).optional().describe("Optional API hints for file inference."),
        historySessionIds: z.array(z.string()).optional().describe("Optional linked history session IDs to summarize."),
        moduleHints: z.array(z.string()).optional().describe("Optional module or subsystem hints."),
        symptomHints: z.array(z.string()).optional().describe("Optional user-visible symptom hints."),
        taskType: z.enum(["implementation", "planning", "analysis", "review"]).optional()
          .describe("Task type hint used for retrieval heuristics."),
        maxFiles: z.number().int().positive().optional().describe("Maximum number of files to include."),
        maxSessions: z.number().int().positive().optional().describe("Maximum number of history seed sessions to summarize."),
        role: z.string().optional().describe("Optional agent role hint, e.g. ROUTA or CRAFTER."),
      },
      async (params) => {
        try {
          const result = await summarizeTaskHistoryContextFromToolArgs(params, this.workspaceId);
          return this.toMcpResult({
            success: true,
            data: result,
          });
        } catch (error) {
          return this.toMcpResult({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    );
  }

  private registerSummarizeFileSessionContext(server: McpServer) {
    server.tool(
      FILE_SESSION_CONTEXT_TOOL_NAME,
      "Build a file-session context summary that separates direct file evidence, adjacent evidence, scope drift, input friction, and environment friction for specialist analysis.",
      {
        workspaceId: z.string().optional().describe("Workspace ID override. Uses the current MCP session workspace when omitted."),
        codebaseId: z.string().optional().describe("Optional codebase ID override."),
        repoPath: z.string().optional().describe("Optional repository path override."),
        taskLabel: z.string().optional().describe("Short label for the current task or request."),
        locale: z.string().optional().describe("Optional locale hint, e.g. en or zh-CN."),
        featureId: z.string().optional().describe("Optional Feature Explorer feature ID."),
        featureIds: z.array(z.string()).optional().describe("Optional ordered candidate Feature Tree IDs."),
        filePaths: z.array(z.string()).optional().describe("Optional repository-relative file paths already known to be relevant."),
        routeCandidates: z.array(z.string()).optional().describe("Optional route hints for file inference."),
        apiCandidates: z.array(z.string()).optional().describe("Optional API hints for file inference."),
        historySessionIds: z.array(z.string()).optional().describe("Optional linked history session IDs to prioritize."),
        moduleHints: z.array(z.string()).optional().describe("Optional module or subsystem hints."),
        symptomHints: z.array(z.string()).optional().describe("Optional user-visible symptom hints."),
        taskType: z.enum(["implementation", "planning", "analysis", "review"]).optional()
          .describe("Task type hint used for retrieval heuristics."),
        maxFiles: z.number().int().positive().optional().describe("Maximum number of files to include."),
        maxSessions: z.number().int().positive().optional().describe("Maximum number of history sessions to include."),
        role: z.string().optional().describe("Optional agent role hint, e.g. ROUTA or CRAFTER."),
      },
      async (params) => {
        try {
          const result = await summarizeFileSessionContextFromToolArgs(params, this.workspaceId);
          return this.toMcpResult({
            success: true,
            data: result,
          });
        } catch (error) {
          return this.toMcpResult({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    );
  }

  private registerInspectTranscriptTurns(server: McpServer) {
    server.tool(
      TRANSCRIPT_TURN_INSPECTION_TOOL_NAME,
      "Inspect specific transcript sessions and extract real user turns, file-targeted commands, failed commands, and scope-drift prompts for read-only specialist analysis.",
      {
        workspaceId: z.string().optional().describe("Workspace ID override. Uses the current MCP session workspace when omitted."),
        codebaseId: z.string().optional().describe("Optional codebase ID override."),
        repoPath: z.string().optional().describe("Optional repository path override."),
        sessionIds: z.array(z.string()).optional().describe("Explicit session IDs to inspect. Prefer the highest-relevance sessions first."),
        historySessionIds: z.array(z.string()).optional().describe("Alias for sessionIds for compatibility with existing task-adaptive flows."),
        featureId: z.string().optional().describe("Optional Feature Explorer feature ID used to preserve feature-level evidence."),
        filePaths: z.array(z.string()).optional().describe("Optional repository-relative focus files. Signals are filtered to these files when provided."),
        maxUserPrompts: z.number().int().positive().optional().describe("Maximum number of user prompts to keep per inspected session."),
        maxSignals: z.number().int().positive().optional().describe("Maximum number of relevant signals and failed signals to keep per session."),
      },
      async (params) => {
        try {
          const result = await inspectTranscriptTurnsFromToolArgs(params, this.workspaceId);
          return this.toMcpResult({
            success: true,
            data: result,
          });
        } catch (error) {
          return this.toMcpResult({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    );
  }

  private registerLoadRetrospectiveMemory(server: McpServer) {
    server.tool(
      LOAD_RETROSPECTIVE_MEMORY_TOOL_NAME,
      "Load previously saved prompt-ready retrospective memory for selected files or a feature before transcript rereads.",
      {
        workspaceId: z.string().optional().describe("Workspace ID override. Uses the current MCP session workspace when omitted."),
        codebaseId: z.string().optional().describe("Optional codebase ID override."),
        repoPath: z.string().optional().describe("Optional repository path override."),
        featureId: z.string().optional().describe("Optional Feature Explorer feature ID."),
        filePaths: z.array(z.string()).optional().describe("Optional repository-relative files to load file-level memory for."),
      },
      async (params) => {
        try {
          const result = await loadFeatureRetrospectiveMemoryFromToolArgs(params, this.workspaceId);
          return this.toMcpResult({
            success: true,
            data: result,
          });
        } catch (error) {
          return this.toMcpResult({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    );
  }

  private registerSaveRetrospectiveMemory(server: McpServer) {
    server.tool(
      SAVE_RETROSPECTIVE_MEMORY_TOOL_NAME,
      "Persist a short prompt-ready retrospective summary for a file or feature so future specialist runs can reuse it as durable memory.",
      {
        workspaceId: z.string().optional().describe("Workspace ID override. Uses the current MCP session workspace when omitted."),
        codebaseId: z.string().optional().describe("Optional codebase ID override."),
        repoPath: z.string().optional().describe("Optional repository path override."),
        scope: z.enum(["file", "feature"]).describe("Whether to save file-level or feature-level retrospective memory."),
        targetId: z.string().optional().describe("Optional explicit target key. Prefer filePath or featureId when available."),
        filePath: z.string().optional().describe("Repository-relative file path when scope=file."),
        featureId: z.string().optional().describe("Feature Tree ID when scope=feature or to keep file memory attached to a feature."),
        featureName: z.string().optional().describe("Optional human-readable feature name."),
        summary: z.string().describe("Short prompt-ready summary to reuse in the next analysis session."),
      },
      async (params) => {
        try {
          const result = await saveFeatureRetrospectiveMemoryFromToolArgs(params, this.workspaceId);
          return this.toMcpResult({
            success: true,
            data: result,
          });
        } catch (error) {
          return this.toMcpResult({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
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
