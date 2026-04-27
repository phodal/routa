/**
 * MCP Tool Executor
 *
 * Shared logic for executing MCP tools and providing tool definitions.
 * Used by both /api/mcp route and /api/mcp/tools route.
 */

import { AgentTools } from "@/core/tools/agent-tools";
import { NoteTools } from "@/core/tools/note-tools";
import { WorkspaceTools } from "@/core/tools/workspace-tools";
import { KanbanTools } from "@/core/tools/kanban-tools";
import { getRoutaOrchestrator } from "@/core/orchestration/orchestrator-singleton";
import {
  assembleTaskAdaptiveHarnessFromToolArgs,
  CONFIRM_FEATURE_TREE_STORY_CONTEXT_TOOL_NAME,
  FILE_SESSION_CONTEXT_TOOL_NAME,
  confirmFeatureTreeStoryContextFromToolArgs,
  inspectTranscriptTurnsFromToolArgs,
  LOAD_FEATURE_TREE_CONTEXT_TOOL_NAME,
  LOAD_RETROSPECTIVE_MEMORY_TOOL_NAME,
  loadFeatureTreeContextFromToolArgs,
  loadFeatureRetrospectiveMemoryFromToolArgs,
  SAVE_RETROSPECTIVE_MEMORY_TOOL_NAME,
  saveFeatureRetrospectiveMemoryFromToolArgs,
  summarizeFileSessionContextFromToolArgs,
  summarizeTaskHistoryContextFromToolArgs,
  TASK_ADAPTIVE_HARNESS_TOOL_NAME,
  TASK_HISTORY_SUMMARY_TOOL_NAME,
  TRANSCRIPT_TURN_INSPECTION_TOOL_NAME,
} from "@/core/harness/task-adaptive-tool";
import { readFeatureTreeSpecResource } from "@/core/spec/feature-tree-spec-resource-contract";
import { ToolMode } from "./routa-mcp-tool-manager";
import { getMcpProfileToolAllowlist, type McpServerProfile } from "./mcp-server-profiles";
import { parseTaskJitContextAnalysis } from "../models/task";
import {
  CONFIRM_FEATURE_TREE_STORY_CONTEXT_DESCRIPTION,
  CONFIRM_FEATURE_TREE_STORY_CONTEXT_INPUT_SCHEMA,
  LOAD_FEATURE_TREE_CONTEXT_DESCRIPTION,
  LOAD_FEATURE_TREE_CONTEXT_INPUT_SCHEMA,
} from "./feature-tree-context-tools";

async function resolveSessionProvider(sessionId: string | undefined): Promise<string | undefined> {
  if (!sessionId) return undefined;

  try {
    const { getHttpSessionStore } = await import("@/core/acp/http-session-store");
    const liveProvider = getHttpSessionStore().getSession(sessionId)?.provider;
    if (liveProvider) return liveProvider;
  } catch {
    // Ignore and try persisted metadata next.
  }

  try {
    const { loadSessionFromDb, loadSessionFromLocalStorage } = await import("@/core/acp/session-db-persister");
    const persisted = await loadSessionFromDb(sessionId) ?? await loadSessionFromLocalStorage(sessionId);
    return persisted?.provider;
  } catch {
    return undefined;
  }
}

const TASK_CONTEXT_SEARCH_SPEC_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", description: "Free-text retrieval query for relevant history or feature context." },
    featureCandidates: {
      type: "array",
      items: { type: "string" },
      description: "Candidate Feature Tree IDs that may own this task.",
    },
    relatedFiles: {
      type: "array",
      items: { type: "string" },
      description: "Repository-relative files already believed to be relevant.",
    },
    routeCandidates: {
      type: "array",
      items: { type: "string" },
      description: "Candidate routes or pages related to the task.",
    },
    apiCandidates: {
      type: "array",
      items: { type: "string" },
      description: "Candidate API paths or RPC surfaces related to the task.",
    },
    moduleHints: {
      type: "array",
      items: { type: "string" },
      description: "Module or subsystem hints to narrow history search.",
    },
    symptomHints: {
      type: "array",
      items: { type: "string" },
      description: "User-visible errors, failure symptoms, or friction hints.",
    },
  },
} as const;

const TASK_JIT_CONTEXT_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    updatedAt: {
      type: "string",
      description: "ISO timestamp for when this structured history analysis was produced. Optional; the server can fill it.",
    },
    summary: {
      type: "string",
      description: "Compressed explanation of what the matched history actually means for this task.",
    },
    topFiles: {
      type: "array",
      items: { type: "string" },
      description: "Highest-priority files to inspect first next time.",
    },
    topSessions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          provider: { type: "string" },
          reason: { type: "string" },
        },
        required: ["sessionId", "reason"],
      },
      description: "Highest-priority matched sessions to inspect first next time.",
    },
    reusablePrompts: {
      type: "array",
      items: { type: "string" },
      description: "2-4 reusable follow-up prompts.",
    },
    recommendedContextSearchSpec: {
      ...TASK_CONTEXT_SEARCH_SPEC_SCHEMA,
      description: "Structured retrieval hints that should be reused by future JIT Context loads.",
    },
  },
  required: ["summary"],
} as const;

/**
 * Essential tools for weak models - minimum viable coordination.
 * Core coordination tools plus Kanban and artifact tools for card-assigned agents.
 */
const ESSENTIAL_TOOL_NAMES = new Set([
  "list_agents",
  "read_agent_conversation",
  "create_agent",
  "set_agent_name",
  "delegate_task",
  "delegate_task_to_agent",
  "send_message_to_agent",
  "report_to_parent",
  "fetch_webpage",
  // Kanban tools - needed for card-assigned agents to update their cards
  "update_card",
  "move_card",
  "request_previous_lane_handoff",
  "submit_lane_handoff",
  // Artifact tools - needed for Kanban evidence gates
  "request_artifact",
  "provide_artifact",
  "list_artifacts",
  "get_artifact",
  "list_pending_artifact_requests",
  "capture_screenshot",
  "read_specialist_spec_resource",
  TASK_ADAPTIVE_HARNESS_TOOL_NAME,
  TASK_HISTORY_SUMMARY_TOOL_NAME,
  FILE_SESSION_CONTEXT_TOOL_NAME,
  TRANSCRIPT_TURN_INSPECTION_TOOL_NAME,
  "save_history_memory_context",
  LOAD_RETROSPECTIVE_MEMORY_TOOL_NAME,
  SAVE_RETROSPECTIVE_MEMORY_TOOL_NAME,
  LOAD_FEATURE_TREE_CONTEXT_TOOL_NAME,
  CONFIRM_FEATURE_TREE_STORY_CONTEXT_TOOL_NAME,
]);

export async function executeMcpTool(
  tools: AgentTools,
  name: string,
  args: Record<string, unknown>,
  noteTools?: NoteTools,
  workspaceTools?: WorkspaceTools,
  kanbanTools?: KanbanTools,
) {
  // ── Tools that don't require workspaceId ─────────────────────────────
  // ── Tools that don't require workspaceId ─────────────────────────────
  // set_agent_name is a lightweight identity setter — no workspace context needed
  if (name === "set_agent_name") {
    const agentName = args.name as string;
    if (!agentName) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "name is required" }) }], isError: true };
    }
    return formatResult({
      success: true,
      data: { ok: true, name: agentName },
    });
  }

  if (name === "fetch_webpage") {
    const url = args.url as string;
    if (!url) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "url is required" }) }], isError: true };
    }
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Routa/1.0)" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        return { content: [{ type: "text", text: JSON.stringify({ error: `HTTP ${res.status}: ${res.statusText}` }) }], isError: true };
      }
      const contentType = res.headers.get("content-type") ?? "";
      const raw = await res.text();
      let text: string;
      if (contentType.includes("text/html")) {
        // Strip HTML tags and condense whitespace
        text = raw
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/[ \t]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      } else {
        text = raw;
      }
      // Truncate to ~12k chars to avoid context overflow
      if (text.length > 12000) {
        text = text.slice(0, 12000) + `\n\n[...truncated ${text.length - 12000} chars]`;
      }
      return { content: [{ type: "text", text }], isError: false };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true };
    }
  }

  if (name === "read_specialist_spec_resource") {
    const uri = args.uri;
    if (typeof uri !== "string" || !uri.trim()) {
      return formatResult({ success: false, error: "uri is required" });
    }

    const resource = readFeatureTreeSpecResource(uri);
    return formatResult(
      resource
        ? { success: true, data: resource }
        : { success: false, error: `Unknown specialist spec resource URI: ${uri}` },
    );
  }

  const workspace = args.workspaceId as string;
  if (!workspace) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "workspaceId is required" }) }],
      isError: true,
    };
  }

  switch (name) {
    // ── Task tools ────────────────────────────────────────────────────
    case "create_task":
      return formatResult(
        await tools.createTask({
          title: args.title as string,
          objective: args.objective as string,
          workspaceId: (args.workspaceId as string) ?? workspace,
          scope: args.scope as string | undefined,
          acceptanceCriteria: args.acceptanceCriteria as string[] | undefined,
          testCases: args.testCases as string[] | undefined,
          verificationCommands: args.verificationCommands as string[] | undefined,
          dependencies: args.dependencies as string[] | undefined,
          parallelGroup: args.parallelGroup as string | undefined,
          creationSource: args.creationSource as "manual" | "agent" | "api" | "session" | undefined,
        })
      );
    case "list_tasks":
      return formatResult(
        await tools.listTasks((args.workspaceId as string) ?? workspace)
      );
    case "update_task_status":
      return formatResult(
        await tools.updateTaskStatus({
          taskId: args.taskId as string,
          status: args.status as string,
          agentId: args.agentId as string,
          summary: args.summary as string | undefined,
        })
      );
    case "update_task":
      return formatResult(
        await tools.updateTask({
          taskId: args.taskId as string,
          expectedVersion: args.expectedVersion as number | undefined,
          agentId: (args.agentId as string | undefined) ?? "system",
          sessionId: args.sessionId as string | undefined,
          updates: {
            title: args.title as string | undefined,
            objective: args.objective as string | undefined,
            scope: args.scope as string | undefined,
            status: args.status as string | undefined,
            completionSummary: args.completionSummary as string | undefined,
            verificationVerdict: args.verificationVerdict as string | undefined,
            verificationReport: args.verificationReport as string | undefined,
            assignedTo: args.assignedTo as string | undefined,
            acceptanceCriteria: args.acceptanceCriteria as string[] | undefined,
            verificationCommands: args.verificationCommands as string[] | undefined,
            testCases: args.testCases as string[] | undefined,
            contextSearchSpec: args.contextSearchSpec as Record<string, unknown> | undefined,
            jitContextAnalysis: args.jitContextAnalysis === null
              ? null
              : parseTaskJitContextAnalysis(args.jitContextAnalysis),
          },
        })
      );
    case "save_history_memory_context":
      return formatResult(
        await tools.saveJitContext({
          taskId: args.taskId as string,
          result: parseTaskJitContextAnalysis({
            updatedAt: args.updatedAt,
            summary: args.summary,
            topFiles: args.topFiles,
            topSessions: args.topSessions,
            reusablePrompts: args.reusablePrompts,
            recommendedContextSearchSpec: args.recommendedContextSearchSpec,
          }) ?? {
            summary: String(args.summary ?? ""),
            topFiles: [],
            topSessions: [],
            reusablePrompts: [],
          },
          agentId: (args.agentId as string | undefined) ?? "system",
        })
      );
    case LOAD_FEATURE_TREE_CONTEXT_TOOL_NAME:
      return formatResult({
        success: true,
        data: await loadFeatureTreeContextFromToolArgs(args, workspace),
      });
    case CONFIRM_FEATURE_TREE_STORY_CONTEXT_TOOL_NAME:
      return formatResult({
        success: true,
        data: await confirmFeatureTreeStoryContextFromToolArgs(args, workspace),
      });

    // ── Enhanced delegation with process spawning ─────────────────────
    case "delegate_task_to_agent": {
      const orchestrator = getRoutaOrchestrator();
      if (!orchestrator) {
        return formatResult({
          success: false,
          error: "Orchestrator not initialized. Start a session first.",
        });
      }

      const callerSessionId =
        (args.callerSessionId as string) ??
        orchestrator.getSessionForAgent(args.callerAgentId as string) ??
        "unknown";

      return formatResult(
        await orchestrator.delegateTaskWithSpawn({
          taskId: args.taskId as string,
          callerAgentId: args.callerAgentId as string,
          callerSessionId,
          workspaceId: (args.workspaceId as string) ?? workspace,
          specialist: args.specialist as string,
          provider: args.provider as string | undefined,
          cwd: args.cwd as string | undefined,
          additionalInstructions: args.additionalInstructions as string | undefined,
          waitMode: args.waitMode as "immediate" | "after_all" | undefined,
        })
      );
    }

    // ── Agent tools ──────────────────────────────────────────────────
    case "list_agents":
      return formatResult(await tools.listAgents(workspace));
    case "read_agent_conversation":
      return formatResult(await tools.readAgentConversation(args as never));
    case "create_agent":
      return formatResult(
        await tools.createAgent({
          name: args.name as string,
          role: args.role as string,
          workspaceId: (args.workspaceId as string) ?? workspace,
          parentId: args.parentId as string | undefined,
          modelTier: args.modelTier as string | undefined,
        })
      );
    // set_agent_name is handled before the workspaceId check above
    // (kept as a comment for reference – the case is unreachable)
    case "delegate_task":
      return formatResult(await tools.delegate(args as never));
    case "send_message_to_agent":
      return formatResult(await tools.messageAgent(args as never));
    case "report_to_parent":
      return formatResult(
        await tools.reportToParent({
          agentId: args.agentId as string,
          report: {
            agentId: args.agentId as string,
            taskId: args.taskId as string,
            summary: args.summary as string,
            filesModified: args.filesModified as string[] | undefined,
            success: args.success as boolean,
          },
        })
      );
    case "wake_or_create_task_agent":
      return formatResult(
        await tools.wakeOrCreateTaskAgent({
          taskId: args.taskId as string,
          contextMessage: args.contextMessage as string,
          callerAgentId: args.callerAgentId as string,
          workspaceId: (args.workspaceId as string) ?? workspace,
          agentName: args.agentName as string | undefined,
          modelTier: args.modelTier as string | undefined,
        })
      );
    case TASK_ADAPTIVE_HARNESS_TOOL_NAME:
      return formatResult({
        success: true,
        data: await assembleTaskAdaptiveHarnessFromToolArgs(args, workspace),
      });
    case TASK_HISTORY_SUMMARY_TOOL_NAME:
      return formatResult({
        success: true,
        data: await summarizeTaskHistoryContextFromToolArgs(args, workspace),
      });
    case FILE_SESSION_CONTEXT_TOOL_NAME:
      return formatResult({
        success: true,
        data: await summarizeFileSessionContextFromToolArgs(args, workspace),
      });
    case TRANSCRIPT_TURN_INSPECTION_TOOL_NAME:
      return formatResult({
        success: true,
        data: await inspectTranscriptTurnsFromToolArgs(args, workspace),
      });
    case LOAD_RETROSPECTIVE_MEMORY_TOOL_NAME:
      return formatResult({
        success: true,
        data: await loadFeatureRetrospectiveMemoryFromToolArgs(args, workspace),
      });
    case SAVE_RETROSPECTIVE_MEMORY_TOOL_NAME:
      return formatResult({
        success: true,
        data: await saveFeatureRetrospectiveMemoryFromToolArgs(args, workspace),
      });
    case "send_message_to_task_agent":
      return formatResult(await tools.sendMessageToTaskAgent(args as never));
    case "get_agent_status":
      return formatResult(await tools.getAgentStatus(args.agentId as string));
    case "get_agent_summary":
      return formatResult(await tools.getAgentSummary(args.agentId as string));
    case "subscribe_to_events":
      return formatResult(await tools.subscribeToEvents(args as never));
    case "unsubscribe_from_events":
      return formatResult(
        await tools.unsubscribeFromEvents(args.subscriptionId as string)
      );

    // ── Artifact tools ───────────────────────────────────────────────
    case "request_artifact":
      return formatResult(
        await tools.requestArtifact({
          fromAgentId: args.fromAgentId as string,
          toAgentId: args.toAgentId as string,
          artifactType: args.artifactType as "screenshot" | "test_results" | "code_diff" | "logs",
          taskId: args.taskId as string,
          workspaceId: (args.workspaceId as string) ?? workspace,
          context: args.context as string | undefined,
        })
      );
    case "provide_artifact":
      return formatResult(
        await tools.provideArtifact({
          agentId: args.agentId as string,
          type: args.type as "screenshot" | "test_results" | "code_diff" | "logs",
          taskId: args.taskId as string,
          workspaceId: (args.workspaceId as string) ?? workspace,
          content: args.content as string,
          context: args.context as string | undefined,
          requestId: args.requestId as string | undefined,
          metadata: args.metadata as Record<string, string> | undefined,
        })
      );
    case "list_artifacts":
      return formatResult(
        await tools.listArtifacts({
          taskId: args.taskId as string,
          type: args.type as "screenshot" | "test_results" | "code_diff" | "logs" | undefined,
        })
      );
    case "get_artifact":
      return formatResult(await tools.getArtifact(args.artifactId as string));
    case "list_pending_artifact_requests":
      return formatResult(await tools.listPendingArtifactRequests(args.agentId as string));
    case "capture_screenshot":
      return formatResult(
        await tools.captureScreenshot({
          agentId: args.agentId as string,
          taskId: args.taskId as string,
          workspaceId: (args.workspaceId as string) ?? workspace,
          url: args.url as string | undefined,
          fullPage: args.fullPage as boolean | undefined,
          annotate: args.annotate as boolean | undefined,
          context: args.context as string | undefined,
          outputPath: args.outputPath as string | undefined,
        })
      );
    // ── Note tools ───────────────────────────────────────────────────
    case "create_note":
      if (!noteTools) return formatResult({ success: false, error: "Note tools not available." });
      return formatResult(
        await noteTools.createNote({
          title: args.title as string,
          content: args.content as string | undefined,
          workspaceId: (args.workspaceId as string) ?? workspace,
          noteId: args.noteId as string | undefined,
          type: args.type as "spec" | "task" | "general" | undefined,
          sessionId: args.sessionId as string | undefined,
        })
      );
    case "read_note":
      if (!noteTools) return formatResult({ success: false, error: "Note tools not available." });
      return formatResult(
        await noteTools.readNote({
          noteId: args.noteId as string,
          workspaceId: (args.workspaceId as string) ?? workspace,
        })
      );
    case "list_notes":
      if (!noteTools) return formatResult({ success: false, error: "Note tools not available." });
      return formatResult(
        await noteTools.listNotes({
          workspaceId: (args.workspaceId as string) ?? workspace,
          type: args.type as "spec" | "task" | "general" | undefined,
        })
      );
    case "set_note_content":
      if (!noteTools) return formatResult({ success: false, error: "Note tools not available." });
      return formatResult(
        await noteTools.setNoteContent({
          noteId: args.noteId as string,
          content: args.content as string,
          title: args.title as string | undefined,
          workspaceId: (args.workspaceId as string) ?? workspace,
          sessionId: args.sessionId as string | undefined,
        })
      );
    case "append_to_note":
      if (!noteTools) return formatResult({ success: false, error: "Note tools not available." });
      return formatResult(
        await noteTools.appendToNote({
          noteId: args.noteId as string,
          content: args.content as string,
          workspaceId: (args.workspaceId as string) ?? workspace,
        })
      );
    case "get_my_task":
      if (!noteTools) return formatResult({ success: false, error: "Note tools not available." });
      return formatResult(
        await noteTools.getMyTask({
          agentId: args.agentId as string,
          workspaceId: (args.workspaceId as string) ?? workspace,
        })
      );
    case "convert_task_blocks":
      if (!noteTools) return formatResult({ success: false, error: "Note tools not available." });
      return formatResult(
        await noteTools.convertTaskBlocks({
          noteId: args.noteId as string,
          workspaceId: (args.workspaceId as string) ?? workspace,
        })
      );

    // ── Workspace tools ──────────────────────────────────────────────
    case "git_status":
      if (!workspaceTools) return formatResult({ success: false, error: "Workspace tools not available." });
      return formatResult(await workspaceTools.gitStatus({ cwd: args.cwd as string | undefined }));
    case "git_diff":
      if (!workspaceTools) return formatResult({ success: false, error: "Workspace tools not available." });
      return formatResult(
        await workspaceTools.gitDiff({
          cwd: args.cwd as string | undefined,
          staged: args.staged as boolean | undefined,
          file: args.file as string | undefined,
        })
      );
    case "git_commit":
      if (!workspaceTools) return formatResult({ success: false, error: "Workspace tools not available." });
      return formatResult(
        await workspaceTools.gitCommit({
          message: args.message as string,
          cwd: args.cwd as string | undefined,
          stageAll: args.stageAll as boolean | undefined,
        })
      );
    case "get_workspace_info":
      if (!workspaceTools) return formatResult({ success: false, error: "Workspace tools not available." });
      return formatResult(
        await workspaceTools.getWorkspaceInfo({
          workspaceId: (args.workspaceId as string) ?? workspace,
        })
      );
    case "list_specialists":
      if (!workspaceTools) return formatResult({ success: false, error: "Workspace tools not available." });
      return formatResult(await workspaceTools.listSpecialists());

    // ── Workspace management tools ────────────────────────────────────
    case "get_workspace_details":
      if (!workspaceTools) return formatResult({ success: false, error: "Workspace tools not available." });
      return formatResult(
        await workspaceTools.getWorkspaceDetails({
          workspaceId: (args.workspaceId as string) ?? workspace,
        })
      );
    case "set_workspace_title":
      if (!workspaceTools) return formatResult({ success: false, error: "Workspace tools not available." });
      return formatResult(
        await workspaceTools.setWorkspaceTitle({
          workspaceId: (args.workspaceId as string) ?? workspace,
          title: args.title as string,
        })
      );
    case "list_workspaces":
      if (!workspaceTools) return formatResult({ success: false, error: "Workspace tools not available." });
      return formatResult(await workspaceTools.listWorkspaces());
    case "create_workspace":
      if (!workspaceTools) return formatResult({ success: false, error: "Workspace tools not available." });
      return formatResult(
        await workspaceTools.createWorkspace({
          id: args.id as string,
          title: args.title as string,
        })
      );

    // ── Kanban tools ──────────────────────────────────────────────────
    case "create_board":
      if (!kanbanTools) return formatResult({ success: false, error: "Kanban tools not available." });
      return formatResult(
        await kanbanTools.createBoard({
          workspaceId: (args.workspaceId as string) ?? workspace,
          name: args.name as string,
          columns: args.columns as string[] | undefined,
        })
      );
    case "list_boards":
      if (!kanbanTools) return formatResult({ success: false, error: "Kanban tools not available." });
      return formatResult(await kanbanTools.listBoards((args.workspaceId as string) ?? workspace));
    case "get_board":
      if (!kanbanTools) return formatResult({ success: false, error: "Kanban tools not available." });
      return formatResult(await kanbanTools.getBoard(args.boardId as string));
    case "create_card":
      if (!kanbanTools) return formatResult({ success: false, error: "Kanban tools not available." });
      {
        const assignedProvider = (args.assignedProvider as string | undefined)
          ?? await resolveSessionProvider(args.sessionId as string | undefined);
      return formatResult(
        await kanbanTools.createCard({
          boardId: args.boardId as string | undefined,
          workspaceId: (args.workspaceId as string) ?? workspace,
          title: args.title as string,
          description: args.description as string | undefined,
          contextSearchSpec: args.contextSearchSpec as Record<string, unknown> | undefined,
          sessionId: args.sessionId as string | undefined,
          columnId: (args.columnId as string | undefined) ?? (args.column as string | undefined) ?? "backlog",
          priority: args.priority as "low" | "medium" | "high" | "urgent" | undefined,
          labels: args.labels as string[] | undefined,
          assignedProvider,
        })
      );
      }
    case "move_card":
      if (!kanbanTools) return formatResult({ success: false, error: "Kanban tools not available." });
      return formatResult(
        await kanbanTools.moveCard({
          cardId: args.cardId as string,
          targetColumnId: args.targetColumnId as string,
          position: args.position as number | undefined,
        })
      );
    case "update_card":
      if (!kanbanTools) return formatResult({ success: false, error: "Kanban tools not available." });
      return formatResult(
        await kanbanTools.updateCard({
          cardId: args.cardId as string,
          title: args.title as string | undefined,
          description: args.description as string | undefined,
          comment: args.comment as string | undefined,
          agentId: args.agentId as string | undefined,
          sessionId: args.sessionId as string | undefined,
          priority: args.priority as "low" | "medium" | "high" | "urgent" | undefined,
          labels: args.labels as string[] | undefined,
        })
      );
    case "delete_card":
      if (!kanbanTools) return formatResult({ success: false, error: "Kanban tools not available." });
      return formatResult(await kanbanTools.deleteCard(args.cardId as string));
    case "search_cards":
      if (!kanbanTools) return formatResult({ success: false, error: "Kanban tools not available." });
      return formatResult(
        await kanbanTools.searchCards({
          query: args.query as string,
          boardId: args.boardId as string | undefined,
          workspaceId: (args.workspaceId as string) ?? workspace,
        })
      );
    case "list_cards_by_column":
      if (!kanbanTools) return formatResult({ success: false, error: "Kanban tools not available." });
      return formatResult(
        await kanbanTools.listCardsByColumn(
          args.columnId as string,
          args.boardId as string | undefined,
          workspace,
        )
      );
    case "decompose_tasks":
      if (!kanbanTools) return formatResult({ success: false, error: "Kanban tools not available." });
      {
        const defaultAssignedProvider = (args.assignedProvider as string | undefined)
          ?? await resolveSessionProvider(args.sessionId as string | undefined);
      return formatResult(
        await kanbanTools.decomposeTasks({
          boardId: args.boardId as string | undefined,
          workspaceId: (args.workspaceId as string) ?? workspace,
          tasks: ((args.tasks as Array<Record<string, unknown>> | undefined) ?? []).map((task) => ({
            title: task.title as string,
            description: task.description as string | undefined,
            contextSearchSpec: task.contextSearchSpec as Record<string, unknown> | undefined,
            priority: task.priority as "low" | "medium" | "high" | "urgent" | undefined,
            labels: task.labels as string[] | undefined,
            assignedProvider: (task.assignedProvider as string | undefined) ?? defaultAssignedProvider,
          })),
          columnId: (args.columnId as string | undefined) ?? (args.column as string | undefined),
          sessionId: args.sessionId as string | undefined,
        })
      );
      }
    case "request_previous_lane_handoff":
      if (!kanbanTools) return formatResult({ success: false, error: "Kanban tools not available." });
      if (!args.sessionId) return formatResult({ success: false, error: "Current ACP session is required for lane handoff." });
      return formatResult(
        await kanbanTools.requestPreviousLaneHandoff({
          taskId: args.taskId as string,
          requestType: args.requestType as "environment_preparation" | "runtime_context" | "clarification" | "rerun_command",
          request: args.request as string,
          sessionId: args.sessionId as string,
        })
      );
    case "submit_lane_handoff":
      if (!kanbanTools) return formatResult({ success: false, error: "Kanban tools not available." });
      if (!args.sessionId) return formatResult({ success: false, error: "Current ACP session is required for lane handoff." });
      return formatResult(
        await kanbanTools.submitLaneHandoff({
          taskId: args.taskId as string,
          handoffId: args.handoffId as string,
          status: args.status as "completed" | "blocked" | "failed",
          summary: args.summary as string,
          sessionId: args.sessionId as string,
        })
      );

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
}

function formatResult(result: { success: boolean; data?: unknown; error?: string }) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          result.success ? result.data : { error: result.error },
          null,
          2
        ),
      },
    ],
    isError: !result.success,
  };
}

/**
 * Get MCP tool definitions, optionally filtered by tool mode.
 * @param toolMode - "essential" for 7 core tools, "full" for all tools (default: "essential")
 */
export function getMcpToolDefinitions(
  toolMode: ToolMode = "essential",
  mcpProfile?: McpServerProfile,
) {
  const allTools = [
    {
      name: TASK_ADAPTIVE_HARNESS_TOOL_NAME,
      description: "Compile a Task-Adaptive Harness pack for the current task by retrieving relevant history sessions, file signals, and high-friction failures just in time.",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string", description: "Workspace ID. Uses the current MCP session workspace when omitted." },
          codebaseId: { type: "string", description: "Optional codebase ID override for repository resolution." },
          repoPath: { type: "string", description: "Optional repository path override for repository resolution." },
          taskLabel: { type: "string", description: "Short label for the current task or request." },
          locale: { type: "string", description: "Optional locale hint, e.g. en or zh-CN." },
          featureId: { type: "string", description: "Optional Feature Explorer feature ID to ground retrieval." },
          featureIds: {
            type: "array",
            items: { type: "string" },
            description: "Optional ordered candidate Feature Tree IDs to ground retrieval.",
          },
          filePaths: {
            type: "array",
            items: { type: "string" },
            description: "Optional repository-relative file paths already known to be relevant.",
          },
          routeCandidates: {
            type: "array",
            items: { type: "string" },
            description: "Optional route hints for Feature Tree and file inference.",
          },
          apiCandidates: {
            type: "array",
            items: { type: "string" },
            description: "Optional API hints for Feature Tree and file inference.",
          },
          historySessionIds: {
            type: "array",
            items: { type: "string" },
            description: "Optional history session IDs to prioritize during retrieval.",
          },
          moduleHints: {
            type: "array",
            items: { type: "string" },
            description: "Optional module hints for retrieval fallback.",
          },
          symptomHints: {
            type: "array",
            items: { type: "string" },
            description: "Optional user-visible symptom hints for retrieval fallback.",
          },
          taskType: {
            type: "string",
            enum: ["implementation", "planning", "analysis", "review"],
            description: "Task type hint used for tool/profile recommendations.",
          },
          maxFiles: { type: "number", minimum: 1, description: "Maximum number of files to include in the selected context slice." },
          maxSessions: { type: "number", minimum: 1, description: "Maximum number of history sessions to include." },
          role: { type: "string", description: "Optional agent role hint, e.g. ROUTA or CRAFTER." },
        },
      },
    },
    {
      name: TASK_HISTORY_SUMMARY_TOOL_NAME,
      description: "Compress linked history sessions into a History Summary so analysts can reason from seeds, friction signals, and matched files without rereading every transcript.",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string", description: "Workspace ID. Uses the current MCP session workspace when omitted." },
          codebaseId: { type: "string", description: "Optional codebase ID override for repository resolution." },
          repoPath: { type: "string", description: "Optional repository path override for repository resolution." },
          taskLabel: { type: "string", description: "Short label for the current task or request." },
          locale: { type: "string", description: "Optional locale hint, e.g. en or zh-CN." },
          featureId: { type: "string", description: "Optional Feature Explorer feature ID to ground retrieval." },
          featureIds: {
            type: "array",
            items: { type: "string" },
            description: "Optional ordered candidate Feature Tree IDs to ground retrieval.",
          },
          filePaths: {
            type: "array",
            items: { type: "string" },
            description: "Optional repository-relative file paths already known to be relevant.",
          },
          routeCandidates: {
            type: "array",
            items: { type: "string" },
            description: "Optional route hints for Feature Tree and file inference.",
          },
          apiCandidates: {
            type: "array",
            items: { type: "string" },
            description: "Optional API hints for Feature Tree and file inference.",
          },
          historySessionIds: {
            type: "array",
            items: { type: "string" },
            description: "Optional linked history session IDs to compress into seed summaries.",
          },
          moduleHints: {
            type: "array",
            items: { type: "string" },
            description: "Optional module hints for retrieval fallback.",
          },
          symptomHints: {
            type: "array",
            items: { type: "string" },
            description: "Optional user-visible symptom hints for retrieval fallback.",
          },
          taskType: {
            type: "string",
            enum: ["implementation", "planning", "analysis", "review"],
            description: "Task type hint used for retrieval heuristics.",
          },
          maxFiles: { type: "number", minimum: 1, description: "Maximum number of files to include in the selected context slice." },
          maxSessions: { type: "number", minimum: 1, description: "Maximum number of history seed sessions to summarize." },
          role: { type: "string", description: "Optional agent role hint, e.g. ROUTA or CRAFTER." },
        },
      },
    },
    {
      name: FILE_SESSION_CONTEXT_TOOL_NAME,
      description: "Structure file-linked session evidence into direct vs adjacent buckets, scope drift, input friction, environment friction, and repeated hotspots for specialist analysis.",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string", description: "Workspace ID. Uses the current MCP session workspace when omitted." },
          codebaseId: { type: "string", description: "Optional codebase ID override for repository resolution." },
          repoPath: { type: "string", description: "Optional repository path override for repository resolution." },
          taskLabel: { type: "string", description: "Short label for the current task or request." },
          locale: { type: "string", description: "Optional locale hint, e.g. en or zh-CN." },
          featureId: { type: "string", description: "Optional Feature Explorer feature ID to ground retrieval." },
          featureIds: {
            type: "array",
            items: { type: "string" },
            description: "Optional ordered candidate Feature Tree IDs to ground retrieval.",
          },
          filePaths: {
            type: "array",
            items: { type: "string" },
            description: "Optional repository-relative file paths already known to be relevant.",
          },
          routeCandidates: {
            type: "array",
            items: { type: "string" },
            description: "Optional route hints for Feature Tree and file inference.",
          },
          apiCandidates: {
            type: "array",
            items: { type: "string" },
            description: "Optional API hints for Feature Tree and file inference.",
          },
          historySessionIds: {
            type: "array",
            items: { type: "string" },
            description: "Optional linked history session IDs to prioritize.",
          },
          moduleHints: {
            type: "array",
            items: { type: "string" },
            description: "Optional module hints for retrieval fallback.",
          },
          symptomHints: {
            type: "array",
            items: { type: "string" },
            description: "Optional user-visible symptom hints for retrieval fallback.",
          },
          taskType: {
            type: "string",
            enum: ["implementation", "planning", "analysis", "review"],
            description: "Task type hint used for retrieval heuristics.",
          },
          maxFiles: { type: "number", minimum: 1, description: "Maximum number of files to include in the selected context slice." },
          maxSessions: { type: "number", minimum: 1, description: "Maximum number of history sessions to include." },
          role: { type: "string", description: "Optional agent role hint, e.g. ROUTA or CRAFTER." },
        },
      },
    },
    {
      name: TRANSCRIPT_TURN_INSPECTION_TOOL_NAME,
      description: "Inspect specific transcript sessions and extract real user turns, file-targeted commands, failed commands, and scope-drift prompts for read-only specialist analysis.",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string", description: "Workspace ID. Uses the current MCP session workspace when omitted." },
          codebaseId: { type: "string", description: "Optional codebase ID override for repository resolution." },
          repoPath: { type: "string", description: "Optional repository path override for repository resolution." },
          sessionIds: {
            type: "array",
            items: { type: "string" },
            description: "Explicit session IDs to inspect. Prefer the highest-relevance sessions first.",
          },
          historySessionIds: {
            type: "array",
            items: { type: "string" },
            description: "Alias for sessionIds for compatibility with existing task-adaptive flows.",
          },
          featureId: { type: "string", description: "Optional Feature Explorer feature ID used to preserve feature-level evidence." },
          filePaths: {
            type: "array",
            items: { type: "string" },
            description: "Optional repository-relative focus files. Signals are filtered to these files when provided.",
          },
          maxUserPrompts: { type: "number", minimum: 1, description: "Maximum number of user prompts to keep per inspected session." },
          maxSignals: { type: "number", minimum: 1, description: "Maximum number of relevant signals and failed signals to keep per session." },
        },
      },
    },
    // ── Web fetch tool ───────────────────────────────────────────────
    {
      name: "fetch_webpage",
      description: "Fetch the content of a web page or URL and return its text. Strips HTML tags. Use this to read GitHub issues, documentation, or any web resource.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to fetch" },
          query: { type: "string", description: "Optional search query to help focus on relevant content" },
        },
        required: ["url"],
      },
    },
    // ── Task tools ──────────────────────────────────────────────────
    {
      name: "create_task",
      description: "Create a new task in the task store. Returns a taskId for delegation.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title" },
          objective: { type: "string", description: "What this task should achieve" },
          workspaceId: { type: "string", description: "Workspace ID" },
          scope: { type: "string", description: "What files/areas are in scope" },
          acceptanceCriteria: { type: "array", items: { type: "string" }, description: "Definition of done items" },
          testCases: { type: "array", items: { type: "string" }, description: "Human-readable test cases" },
          verificationCommands: { type: "array", items: { type: "string" }, description: "Commands to verify completion" },
          dependencies: { type: "array", items: { type: "string" }, description: "Task IDs that must complete first" },
          parallelGroup: { type: "string", description: "Group for parallel execution" },
        },
        required: ["title", "objective"],
      },
    },
    {
      name: "list_tasks",
      description: "List all tasks in the workspace with status and assignments",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string", description: "Workspace ID" },
        },
      },
    },
    {
      name: "delegate_task_to_agent",
      description: "Delegate a task to a new agent by spawning a real process. Use specialist='CRAFTER' for implementation, specialist='GATE' for verification, specialist='DEVELOPER' for solo plan+implement. IMPORTANT: taskId must be a UUID from create_task (e.g., 'dda97509-b414-4c50-9835-73a1ec2f...'), NOT a task name. First call create_task to create the task and get a UUID.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "UUID of the task to delegate (MUST be a UUID from create_task, NOT a task name)" },
          callerAgentId: { type: "string", description: "Your agent ID" },
          callerSessionId: { type: "string", description: "Your session ID (optional)" },
          specialist: { type: "string", enum: ["CRAFTER", "GATE", "DEVELOPER", "crafter", "gate", "developer"], description: "Agent type to create" },
          provider: { type: "string", description: "ACP provider (claude, copilot, opencode, etc.)" },
          cwd: { type: "string", description: "Working directory" },
          additionalInstructions: { type: "string", description: "Extra context for the agent" },
          waitMode: { type: "string", enum: ["immediate", "after_all"], description: "Notification mode" },
        },
        required: ["taskId", "callerAgentId", "specialist"],
      },
    },
    // ── Agent tools ─────────────────────────────────────────────────
    {
      name: "list_agents",
      description: "List all agents in the current workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string", description: "Workspace ID" },
        },
      },
    },
    {
      name: "read_agent_conversation",
      description: "Read conversation history of another agent",
      inputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          lastN: { type: "number" },
          startTurn: { type: "number" },
          endTurn: { type: "number" },
          includeToolCalls: { type: "boolean" },
        },
        required: ["agentId"],
      },
    },
    {
      name: "create_agent",
      description: "Create a new agent (ROUTA=coordinator, CRAFTER=implementor, GATE=verifier, DEVELOPER=solo)",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: { type: "string", enum: ["ROUTA", "CRAFTER", "GATE", "DEVELOPER"] },
          workspaceId: { type: "string" },
          parentId: { type: "string" },
          modelTier: { type: "string", enum: ["SMART", "BALANCED", "FAST"] },
        },
        required: ["name", "role"],
      },
    },
    {
      name: "set_agent_name",
      description: "Set your name to reflect your current task. Call this at the beginning of your first response to name yourself appropriately. Names should be short (1-5 words).",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short task-focused name (1-5 words)" },
        },
        required: ["name"],
      },
    },
    {
      name: "delegate_task",
      description: "Assign a task to an existing agent (low-level, prefer delegate_task_to_agent)",
      inputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          taskId: { type: "string" },
          callerAgentId: { type: "string" },
        },
        required: ["agentId", "taskId", "callerAgentId"],
      },
    },
    {
      name: "send_message_to_agent",
      description: "Send message from one agent to another",
      inputSchema: {
        type: "object",
        properties: {
          fromAgentId: { type: "string" },
          toAgentId: { type: "string" },
          message: { type: "string" },
        },
        required: ["fromAgentId", "toAgentId", "message"],
      },
    },
    {
      name: "report_to_parent",
      description: "Submit completion report to parent agent. MUST be called when task is done.",
      inputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          taskId: { type: "string" },
          summary: { type: "string" },
          filesModified: { type: "array", items: { type: "string" } },
          success: { type: "boolean" },
        },
        required: ["agentId", "taskId", "summary", "success"],
      },
    },
    {
      name: "wake_or_create_task_agent",
      description: "Wake existing or create new agent for a task",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          contextMessage: { type: "string" },
          callerAgentId: { type: "string" },
          workspaceId: { type: "string" },
          agentName: { type: "string" },
          modelTier: { type: "string" },
        },
        required: ["taskId", "contextMessage", "callerAgentId"],
      },
    },
    {
      name: "send_message_to_task_agent",
      description: "Send message to task's assigned agent",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          message: { type: "string" },
          callerAgentId: { type: "string" },
        },
        required: ["taskId", "message", "callerAgentId"],
      },
    },
    {
      name: "get_agent_status",
      description: "Get agent status, message count, and tasks",
      inputSchema: {
        type: "object",
        properties: { agentId: { type: "string" } },
        required: ["agentId"],
      },
    },
    {
      name: "get_agent_summary",
      description: "Get agent summary with last response and active tasks",
      inputSchema: {
        type: "object",
        properties: { agentId: { type: "string" } },
        required: ["agentId"],
      },
    },
    {
      name: "subscribe_to_events",
      description: "Subscribe to workspace events",
      inputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          agentName: { type: "string" },
          eventTypes: { type: "array", items: { type: "string" } },
          excludeSelf: { type: "boolean" },
        },
        required: ["agentId", "agentName", "eventTypes"],
      },
    },
    {
      name: "unsubscribe_from_events",
      description: "Remove an event subscription",
      inputSchema: {
        type: "object",
        properties: { subscriptionId: { type: "string" } },
        required: ["subscriptionId"],
      },
    },
    // ── Note tools ──────────────────────────────────────────────────
    {
      name: "create_note",
      description: "Create a new note in the workspace for agent collaboration.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Note title" },
          content: { type: "string", description: "Initial note content" },
          noteId: { type: "string", description: "Custom note ID (auto-generated if omitted)" },
          type: { type: "string", enum: ["spec", "task", "general"], description: "Note type" },
          workspaceId: { type: "string" },
        },
        required: ["title"],
      },
    },
    {
      name: "read_note",
      description: "Read the content of a note. Use noteId='spec' for the workspace spec note.",
      inputSchema: {
        type: "object",
        properties: {
          noteId: { type: "string", description: "Note ID ('spec' for spec note)" },
          workspaceId: { type: "string" },
        },
        required: ["noteId"],
      },
    },
    {
      name: "list_notes",
      description: "List all notes in the workspace. Optionally filter by type.",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["spec", "task", "general"], description: "Filter by type" },
          workspaceId: { type: "string" },
        },
      },
    },
    {
      name: "set_note_content",
      description: "Set (replace) the content of a note. Spec note is auto-created if missing.",
      inputSchema: {
        type: "object",
        properties: {
          noteId: { type: "string", description: "Note ID" },
          content: { type: "string", description: "New content (replaces existing)" },
          title: { type: "string", description: "Update the note title" },
          workspaceId: { type: "string" },
        },
        required: ["noteId", "content"],
      },
    },
    {
      name: "append_to_note",
      description: "Append content to an existing note (for progress updates, reports, etc.).",
      inputSchema: {
        type: "object",
        properties: {
          noteId: { type: "string", description: "Note ID" },
          content: { type: "string", description: "Content to append" },
          workspaceId: { type: "string" },
        },
        required: ["noteId", "content"],
      },
    },
    {
      name: "get_my_task",
      description: "Get the task(s) assigned to the calling agent, including objective, scope, and acceptance criteria.",
      inputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "Your agent ID" },
          workspaceId: { type: "string" },
        },
        required: ["agentId"],
      },
    },
    {
      name: "convert_task_blocks",
      description: "Convert @@@task blocks in a note into structured Task Notes and Task records.",
      inputSchema: {
        type: "object",
        properties: {
          noteId: { type: "string", description: "Note ID containing @@@task blocks (typically 'spec')" },
          workspaceId: { type: "string" },
        },
        required: ["noteId"],
      },
    },
    // ── Task atomic update tools ────────────────────────────────────
    {
      name: "update_task_status",
      description: "Atomically update a task's status. Emits TASK_STATUS_CHANGED event.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task ID" },
          status: {
            type: "string",
            enum: ["PENDING", "IN_PROGRESS", "REVIEW_REQUIRED", "COMPLETED", "NEEDS_FIX", "BLOCKED", "CANCELLED"],
            description: "New status",
          },
          agentId: { type: "string", description: "Agent performing the update" },
          summary: { type: "string", description: "Completion summary" },
        },
        required: ["taskId", "status", "agentId"],
      },
    },
    {
      name: "update_task",
      description: "Atomically update structured task fields with optimistic locking. Use this for story-readiness fields such as scope, acceptance criteria, verification commands, and test cases. agentId is optional for Kanban sessions. In backlog planning, only persist contextSearchSpec after repo inspection or feature-tree lookup confirms the feature/files.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task ID" },
          expectedVersion: { type: "number", description: "Expected version for optimistic locking" },
          agentId: { type: "string", description: "Agent performing the update (optional in Kanban sessions)" },
          title: { type: "string" },
          objective: { type: "string" },
          scope: { type: "string" },
          status: { type: "string" },
          completionSummary: { type: "string" },
          verificationVerdict: { type: "string", enum: ["APPROVED", "NOT_APPROVED", "BLOCKED"] },
          verificationReport: { type: "string" },
          assignedTo: { type: "string" },
          acceptanceCriteria: { type: "array", items: { type: "string" } },
          verificationCommands: { type: "array", items: { type: "string" } },
          testCases: { type: "array", items: { type: "string" } },
          contextSearchSpec: TASK_CONTEXT_SEARCH_SPEC_SCHEMA,
          jitContextAnalysis: TASK_JIT_CONTEXT_ANALYSIS_SCHEMA,
        },
        required: ["taskId"],
      },
    },
    {
      name: "save_history_memory_context",
      description: "Persist the minimal task-adaptive history memory result for a task so later sessions can load it directly.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task ID" },
          agentId: { type: "string", description: "Agent performing the save (optional in Kanban sessions)" },
          updatedAt: { type: "string", description: "Optional ISO timestamp for when the saved result was produced." },
          summary: { type: "string", description: "Compressed reusable task-adaptive history memory summary." },
          topFiles: { type: "array", items: { type: "string" } },
          topSessions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                sessionId: { type: "string" },
                provider: { type: "string" },
                reason: { type: "string" },
              },
              required: ["sessionId", "reason"],
            },
          },
          reusablePrompts: { type: "array", items: { type: "string" } },
          recommendedContextSearchSpec: TASK_CONTEXT_SEARCH_SPEC_SCHEMA,
        },
        required: ["taskId", "summary"],
      },
    },
    // ── Workspace tools ─────────────────────────────────────────────
    {
      name: "git_status",
      description: "Get the current git status (staged, unstaged, untracked files).",
      inputSchema: {
        type: "object",
        properties: {
          cwd: { type: "string", description: "Working directory (default: project root)" },
        },
      },
    },
    {
      name: "git_diff",
      description: "Get git diff output. Optionally scope to staged changes or a specific file.",
      inputSchema: {
        type: "object",
        properties: {
          cwd: { type: "string", description: "Working directory" },
          staged: { type: "boolean", description: "Show only staged changes" },
          file: { type: "string", description: "Scope to a specific file path" },
        },
      },
    },
    {
      name: "git_commit",
      description: "Create a git commit with the given message. Optionally stage all changes first.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "Commit message" },
          cwd: { type: "string", description: "Working directory" },
          stageAll: { type: "boolean", description: "Run git add -A before committing" },
        },
        required: ["message"],
      },
    },
    {
      name: "get_workspace_info",
      description: "Get workspace details including agents, tasks, and notes summary.",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string", description: "Workspace ID" },
        },
      },
    },
    {
      name: "list_specialists",
      description: "List all available specialist configurations (roles, model tiers, descriptions).",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    // ── Workspace management tools ──────────────────────────────────
    {
      name: "get_workspace_details",
      description: "Get comprehensive workspace details: metadata, agents, tasks, notes overview, and Git branch.",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string", description: "Workspace ID" },
        },
      },
    },
    {
      name: "set_workspace_title",
      description: "Set or rename the workspace title. Optionally renames Git branch to match.",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string", description: "Workspace ID" },
          title: { type: "string", description: "New workspace title" },
          renameBranch: { type: "boolean", description: "Also rename Git branch" },
        },
        required: ["title"],
      },
    },
    {
      name: "list_workspaces",
      description: "List all workspaces with their id, title, status, and branch.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "create_workspace",
      description: "Create a new workspace with a title and optional repo path / branch.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Unique workspace ID" },
          title: { type: "string", description: "Workspace title" },
          repoPath: { type: "string", description: "Local path to Git repository" },
          branch: { type: "string", description: "Git branch name" },
        },
        required: ["id", "title"],
      },
    },
    // ── Artifact tools ──────────────────────────────────────────────
    {
      name: "request_artifact",
      description: "Request an artifact from another agent, such as a screenshot or test results.",
      inputSchema: {
        type: "object",
        properties: {
          fromAgentId: { type: "string", description: "ID of the requesting agent" },
          toAgentId: { type: "string", description: "ID of the agent to provide the artifact" },
          artifactType: { type: "string", enum: ["screenshot", "test_results", "code_diff", "logs"], description: "Artifact type" },
          taskId: { type: "string", description: "Task/card ID" },
          context: { type: "string", description: "Context or instructions for the request" },
        },
        required: ["fromAgentId", "toAgentId", "artifactType", "taskId"],
      },
    },
    {
      name: "provide_artifact",
      description: "Attach structured evidence to a task/card, such as screenshots, diffs, logs, or test output.",
      inputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "ID of the providing agent" },
          type: { type: "string", enum: ["screenshot", "test_results", "code_diff", "logs"], description: "Artifact type" },
          taskId: { type: "string", description: "Task/card ID" },
          content: { type: "string", description: "Artifact content. Use base64 for screenshots." },
          context: { type: "string", description: "Description or context" },
          requestId: { type: "string", description: "Optional request ID being fulfilled" },
          metadata: { type: "object", additionalProperties: { type: "string" }, description: "Optional metadata such as filename or mediaType" },
        },
        required: ["agentId", "type", "taskId", "content"],
      },
    },
    {
      name: "list_artifacts",
      description: "List the artifacts attached to a task/card.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task/card ID" },
          type: { type: "string", enum: ["screenshot", "test_results", "code_diff", "logs"], description: "Optional artifact type filter" },
        },
        required: ["taskId"],
      },
    },
    {
      name: "get_artifact",
      description: "Get a specific artifact by ID.",
      inputSchema: {
        type: "object",
        properties: {
          artifactId: { type: "string", description: "Artifact ID" },
        },
        required: ["artifactId"],
      },
    },
    {
      name: "list_pending_artifact_requests",
      description: "List pending artifact requests assigned to an agent.",
      inputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "Agent ID" },
        },
        required: ["agentId"],
      },
    },
    {
      name: "capture_screenshot",
      description: "Capture a screenshot with agent-browser and store it as a screenshot artifact on the task/card.",
      inputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "ID of the providing agent" },
          taskId: { type: "string", description: "Task/card ID" },
          url: { type: "string", description: "Optional URL to open before capturing" },
          fullPage: { type: "boolean", description: "Capture full page" },
          annotate: { type: "boolean", description: "Annotate interactive elements" },
          context: { type: "string", description: "Description or context" },
          outputPath: { type: "string", description: "Optional output path for the captured screenshot" },
        },
        required: ["agentId", "taskId"],
      },
    },
    {
      name: "read_specialist_spec_resource",
      description: "Read a bundled specialist framework spec resource by URI. Use this when your provider cannot call MCP resources/read directly.",
      inputSchema: {
        type: "object",
        properties: {
          uri: { type: "string", description: "Specialist spec resource URI, e.g. resource://routa/specialists/feature-tree/manifest" },
        },
        required: ["uri"],
      },
    },
    // ── Kanban tools ──────────────────────────────────────────────────
    {
      name: "create_board",
      description: "Create a new Kanban board.",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string", description: "Workspace ID" },
          name: { type: "string", description: "Board name" },
          columns: { type: "array", items: { type: "string" }, description: "Optional default column names" },
        },
        required: ["name"],
      },
    },
    {
      name: "list_boards",
      description: "List all Kanban boards in the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string", description: "Workspace ID" },
        },
      },
    },
    {
      name: "get_board",
      description: "Get a Kanban board with its columns and cards.",
      inputSchema: {
        type: "object",
        properties: {
          boardId: { type: "string", description: "Board ID" },
        },
        required: ["boardId"],
      },
    },
    {
      name: "create_card",
      description: "Create a new Kanban card in a board column, typically backlog.",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string", description: "Workspace ID" },
          boardId: { type: "string", description: "Optional board ID; uses default board if omitted" },
          title: { type: "string", description: "Card title" },
          description: { type: "string", description: "Card description" },
          contextSearchSpec: {
            ...TASK_CONTEXT_SEARCH_SPEC_SCHEMA,
            description: "Confirmed retrieval hints to help JIT Context recover relevant history and Feature Tree context. In backlog planning, omit this until repo inspection or load_feature_tree_context confirms the feature/files.",
          },
          assignedProvider: { type: "string", description: "Provider override for the created card; defaults to the current session provider when available" },
          columnId: { type: "string", description: "Target column ID" },
          column: { type: "string", description: "Target column alias" },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "Card priority" },
          labels: { type: "array", items: { type: "string" }, description: "Card labels" },
        },
        required: ["title"],
      },
    },
    {
      name: "update_card",
      description: "Update a Kanban card's title, description, comment, priority, or labels. From dev onward, use comment for progress notes because the story description is frozen. For story-readiness fields such as scope, acceptance criteria, verification commands, or test cases, use update_task instead.",
      inputSchema: {
        type: "object",
        properties: {
          cardId: { type: "string", description: "Card ID (same as task ID)" },
          title: { type: "string", description: "New card title" },
          description: { type: "string", description: "New card description/objective" },
          comment: { type: "string", description: "Comment or progress note to append to the card" },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "Card priority" },
          labels: { type: "array", items: { type: "string" }, description: "Card labels" },
        },
        required: ["cardId"],
      },
    },
    {
      name: "move_card",
      description: "Move a Kanban card to a different column. Use 'dev' when starting work, 'review' for code review, 'done' when complete.",
      inputSchema: {
        type: "object",
        properties: {
          cardId: { type: "string", description: "Card ID (same as task ID)" },
          targetColumnId: { type: "string", description: "Target column ID. Valid columns: 'backlog', 'todo', 'dev' (in progress), 'review', 'blocked', 'done'" },
          position: { type: "number", description: "Position within the column (optional)" },
        },
        required: ["cardId", "targetColumnId"],
      },
    },
    {
      name: "delete_card",
      description: "Delete a Kanban card.",
      inputSchema: {
        type: "object",
        properties: {
          cardId: { type: "string", description: "Card ID (same as task ID)" },
        },
        required: ["cardId"],
      },
    },
    {
      name: "search_cards",
      description: "Search cards across boards by title, labels, or assignee.",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string", description: "Workspace ID" },
          boardId: { type: "string", description: "Optional board ID" },
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
    },
    {
      name: "list_cards_by_column",
      description: "List all cards in a specific Kanban column.",
      inputSchema: {
        type: "object",
        properties: {
          boardId: { type: "string", description: "Optional board ID" },
          columnId: { type: "string", description: "Column ID" },
          workspaceId: { type: "string", description: "Workspace ID" },
        },
        required: ["columnId"],
      },
    },
    {
      name: "decompose_tasks",
      description: "Create multiple Kanban cards from a list of decomposed tasks. In backlog planning, only include contextSearchSpec after repo inspection or load_feature_tree_context confirms the feature/files.",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string", description: "Workspace ID" },
          boardId: { type: "string", description: "Optional board ID" },
          columnId: { type: "string", description: "Target column ID" },
          column: { type: "string", description: "Target column alias" },
          tasks: {
            type: "array",
            description: "Tasks to create as cards",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "Card title" },
                description: { type: "string", description: "Card description" },
                contextSearchSpec: TASK_CONTEXT_SEARCH_SPEC_SCHEMA,
                priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "Card priority" },
                labels: { type: "array", items: { type: "string" }, description: "Card labels" },
              },
              required: ["title"],
            },
          },
        },
        required: ["tasks"],
      },
    },
    {
      name: "request_previous_lane_handoff",
      description: "Ask the immediately previous Kanban lane to prepare environment, provide runtime context, or rerun a focused command for this card.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Card/task ID" },
          requestType: { type: "string", enum: ["environment_preparation", "runtime_context", "clarification", "rerun_command"] },
          request: { type: "string", description: "Concrete request for the previous lane" },
        },
        required: ["taskId", "requestType", "request"],
      },
    },
    {
      name: "submit_lane_handoff",
      description: "Submit the result of a lane handoff request after preparing runtime support for another Kanban lane.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Card/task ID" },
          handoffId: { type: "string", description: "Lane handoff request ID" },
          status: { type: "string", enum: ["completed", "blocked", "failed"] },
          summary: { type: "string", description: "Concise summary of what was prepared or why it is blocked" },
        },
        required: ["taskId", "handoffId", "status", "summary"],
      },
    },
    {
      name: LOAD_RETROSPECTIVE_MEMORY_TOOL_NAME,
      description: "Load previously saved prompt-ready retrospective memory for specific files or a feature so analysts can reuse prior conclusions before rereading transcripts.",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string", description: "Workspace ID. Uses the current MCP session workspace when omitted." },
          codebaseId: { type: "string", description: "Optional codebase ID override for repository resolution." },
          repoPath: { type: "string", description: "Optional repository path override for repository resolution." },
          featureId: { type: "string", description: "Optional Feature Explorer feature ID to load feature-level memory." },
          filePaths: {
            type: "array",
            items: { type: "string" },
            description: "Optional repository-relative files to load file-level memory for.",
          },
        },
      },
    },
    {
      name: LOAD_FEATURE_TREE_CONTEXT_TOOL_NAME,
      description: LOAD_FEATURE_TREE_CONTEXT_DESCRIPTION,
      inputSchema: LOAD_FEATURE_TREE_CONTEXT_INPUT_SCHEMA,
    },
    {
      name: CONFIRM_FEATURE_TREE_STORY_CONTEXT_TOOL_NAME,
      description: CONFIRM_FEATURE_TREE_STORY_CONTEXT_DESCRIPTION,
      inputSchema: CONFIRM_FEATURE_TREE_STORY_CONTEXT_INPUT_SCHEMA,
    },
    {
      name: SAVE_RETROSPECTIVE_MEMORY_TOOL_NAME,
      description: "Persist a short prompt-ready retrospective summary for a file or feature so future specialist sessions can reuse it as durable memory.",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string", description: "Workspace ID. Uses the current MCP session workspace when omitted." },
          codebaseId: { type: "string", description: "Optional codebase ID override for repository resolution." },
          repoPath: { type: "string", description: "Optional repository path override for repository resolution." },
          scope: {
            type: "string",
            enum: ["file", "feature"],
            description: "Whether to save file-level or feature-level retrospective memory.",
          },
          targetId: { type: "string", description: "Optional explicit target key. Use filePath or featureId when possible." },
          filePath: { type: "string", description: "Repository-relative target file when scope=file." },
          featureId: { type: "string", description: "Feature Tree ID when scope=feature or when file memory should keep feature context." },
          featureName: { type: "string", description: "Optional human-readable feature name for the saved memory." },
          summary: { type: "string", description: "Short prompt-ready summary to reuse next time." },
        },
        required: ["scope", "summary"],
      },
    },
  ];

  // Filter tools based on mode
  const modeFiltered = toolMode === "essential"
    ? allTools.filter((tool) => ESSENTIAL_TOOL_NAMES.has(tool.name))
    : allTools;
  const profileAllowlist = getMcpProfileToolAllowlist(mcpProfile);
  if (!profileAllowlist) {
    return modeFiltered;
  }
  return modeFiltered.filter((tool) => profileAllowlist.has(tool.name));
}
