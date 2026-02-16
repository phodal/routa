/**
 * MCP Tool Executor
 *
 * Shared logic for executing MCP tools and providing tool definitions.
 * Used by both /api/mcp route and /api/mcp/tools route.
 */

import { AgentTools } from "@/core/tools/agent-tools";
import { NoteTools } from "@/core/tools/note-tools";
import { WorkspaceTools } from "@/core/tools/workspace-tools";
import { getRoutaOrchestrator } from "@/core/orchestration/orchestrator-singleton";

const DEFAULT_WORKSPACE_ID = "default";

export async function executeMcpTool(
  tools: AgentTools,
  name: string,
  args: Record<string, unknown>,
  noteTools?: NoteTools,
  workspaceTools?: WorkspaceTools
) {
  const workspace = (args.workspaceId as string) ?? DEFAULT_WORKSPACE_ID;

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
          verificationCommands: args.verificationCommands as string[] | undefined,
          dependencies: args.dependencies as string[] | undefined,
          parallelGroup: args.parallelGroup as string | undefined,
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
          agentId: args.agentId as string,
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
          },
        })
      );

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
          renameBranch: args.renameBranch as boolean | undefined,
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
          repoPath: args.repoPath as string | undefined,
          branch: args.branch as string | undefined,
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

export function getMcpToolDefinitions() {
  return [
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
      description: "Delegate a task to a new agent by spawning a real process. Use specialist='CRAFTER' for implementation, specialist='GATE' for verification, specialist='DEVELOPER' for solo plan+implement.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task ID to delegate" },
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
      description: "Atomically update task fields with optimistic locking. Provide expectedVersion to detect conflicts.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task ID" },
          expectedVersion: { type: "number", description: "Expected version for optimistic locking" },
          agentId: { type: "string", description: "Agent performing the update" },
          title: { type: "string" },
          objective: { type: "string" },
          scope: { type: "string" },
          status: { type: "string" },
          completionSummary: { type: "string" },
          verificationVerdict: { type: "string", enum: ["APPROVED", "NOT_APPROVED", "BLOCKED"] },
          verificationReport: { type: "string" },
          assignedTo: { type: "string" },
          acceptanceCriteria: { type: "array", items: { type: "string" } },
        },
        required: ["taskId", "agentId"],
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
  ];
}
