pub(super) fn build_tool_list_public() -> Vec<serde_json::Value> {
    build_tool_list_inner()
}

pub(super) fn build_tool_list_for_profile(profile: Option<&str>) -> Vec<serde_json::Value> {
    let tools = build_tool_list_inner();
    match profile {
        Some("kanban-planning") => tools
            .into_iter()
            .filter(|tool| {
                tool.get("name")
                    .and_then(|value| value.as_str())
                    .is_some_and(|name| tool_allowed_for_profile(name, Some("kanban-planning")))
            })
            .collect(),
        _ => tools,
    }
}

pub(super) fn tool_allowed_for_profile(name: &str, profile: Option<&str>) -> bool {
    match profile {
        Some("kanban-planning") => matches!(
            name,
            "create_card"
                | "decompose_tasks"
                | "search_cards"
                | "list_cards_by_column"
                | "update_task"
                | "update_card"
                | "move_card"
                | "request_previous_lane_handoff"
                | "submit_lane_handoff"
        ),
        _ => true,
    }
}

fn build_tool_list_inner() -> Vec<serde_json::Value> {
    vec![
        // ── Agent tools ──────────────────────────────────────────────────
        tool_def("list_agents", "List all agents in the workspace", serde_json::json!({
            "type": "object",
            "properties": {
                "workspaceId": { "type": "string", "description": "Workspace ID (default if omitted)" }
            }
        })),
        tool_def("create_agent", "Create a new agent (ROUTA=coordinator, CRAFTER=implementor, GATE=verifier, DEVELOPER=solo)", serde_json::json!({
            "type": "object",
            "properties": {
                "name": { "type": "string", "description": "Agent name" },
                "role": { "type": "string", "enum": ["ROUTA", "CRAFTER", "GATE", "DEVELOPER"], "description": "Agent role" },
                "workspaceId": { "type": "string" },
                "parentId": { "type": "string", "description": "Parent agent ID" },
                "modelTier": { "type": "string", "enum": ["SMART", "BALANCED", "FAST"], "description": "Model tier (default: SMART)" }
            },
            "required": ["name", "role"]
        })),
        tool_def("read_agent_conversation", "Read conversation history of another agent", serde_json::json!({
            "type": "object",
            "properties": {
                "agentId": { "type": "string", "description": "Agent ID to read conversation from" },
                "limit": { "type": "integer", "description": "Max messages to return (default: 50)" }
            },
            "required": ["agentId"]
        })),
        tool_def("get_agent_status", "Get agent status, message count, and tasks", serde_json::json!({
            "type": "object",
            "properties": {
                "agentId": { "type": "string", "description": "Agent ID" }
            },
            "required": ["agentId"]
        })),
        tool_def("get_agent_summary", "Get agent summary with last response and active tasks", serde_json::json!({
            "type": "object",
            "properties": {
                "agentId": { "type": "string", "description": "Agent ID" }
            },
            "required": ["agentId"]
        })),
        // ── Task tools ───────────────────────────────────────────────────
        tool_def("list_tasks", "List all tasks in the workspace with status and assignments", serde_json::json!({
            "type": "object",
            "properties": {
                "workspaceId": { "type": "string" }
            }
        })),
        tool_def("create_task", "Create a new task in the task store. Returns a taskId for delegation.", serde_json::json!({
            "type": "object",
            "properties": {
                "title": { "type": "string", "description": "Task title" },
                "objective": { "type": "string", "description": "Task objective" },
                "workspaceId": { "type": "string" },
                "sessionId": { "type": "string", "description": "Session that created the task" },
                "scope": { "type": "string", "description": "Task scope" },
                "acceptanceCriteria": { "type": "array", "items": { "type": "string" }, "description": "Acceptance criteria" },
                "creationSource": { "type": "string", "enum": ["manual", "agent", "api", "session"] }
            },
            "required": ["title", "objective"]
        })),
        tool_def("update_task_status", "Atomically update a task's status. Emits TASK_STATUS_CHANGED event.", serde_json::json!({
            "type": "object",
            "properties": {
                "taskId": { "type": "string", "description": "Task ID" },
                "status": { "type": "string", "enum": ["PENDING","IN_PROGRESS","REVIEW_REQUIRED","COMPLETED","NEEDS_FIX","BLOCKED","CANCELLED"] },
                "agentId": { "type": "string", "description": "Agent making the update" },
                "reason": { "type": "string", "description": "Reason for status change" }
            },
            "required": ["taskId", "status", "agentId"]
        })),
        tool_def("update_task", "Atomically update structured task fields. Use this for story-readiness fields such as scope, acceptance criteria, verification commands, and test cases. agentId is optional for Kanban sessions.", serde_json::json!({
            "type": "object",
            "properties": {
                "taskId": { "type": "string", "description": "Task ID" },
                "agentId": { "type": "string", "description": "Agent making the update (optional in Kanban sessions)" },
                "title": { "type": "string", "description": "Updated task title" },
                "objective": { "type": "string", "description": "Updated task objective" },
                "scope": { "type": "string", "description": "Structured implementation scope" },
                "acceptanceCriteria": { "type": "array", "items": { "type": "string" }, "description": "Structured acceptance criteria" },
                "verificationCommands": { "type": "array", "items": { "type": "string" }, "description": "Runnable verification commands" },
                "testCases": { "type": "array", "items": { "type": "string" }, "description": "Human-readable test cases" },
                "status": { "type": "string", "enum": ["PENDING","IN_PROGRESS","REVIEW_REQUIRED","COMPLETED","NEEDS_FIX","BLOCKED","CANCELLED"] }
            },
            "required": ["taskId"]
        })),
        tool_def("get_my_task", "Get the task(s) assigned to the calling agent, including objective, scope, and acceptance criteria.", serde_json::json!({
            "type": "object",
            "properties": {
                "agentId": { "type": "string", "description": "Your agent ID" }
            },
            "required": ["agentId"]
        })),
        tool_def("provide_artifact", "Provide an artifact for a task, such as a screenshot, test results, code diff, or logs.", serde_json::json!({
            "type": "object",
            "properties": {
                "workspaceId": { "type": "string" },
                "agentId": { "type": "string", "description": "Agent providing the artifact" },
                "taskId": { "type": "string", "description": "Task ID" },
                "type": { "type": "string", "enum": ["screenshot", "test_results", "code_diff", "logs"], "description": "Artifact type" },
                "content": { "type": "string", "description": "Artifact content" },
                "context": { "type": "string", "description": "Optional artifact context" },
                "requestId": { "type": "string", "description": "Optional request ID being fulfilled" },
                "metadata": { "type": "object", "description": "Optional artifact metadata" }
            },
            "required": ["agentId", "taskId", "type", "content"]
        })),
        tool_def("list_artifacts", "List artifacts for a task, optionally filtered by type.", serde_json::json!({
            "type": "object",
            "properties": {
                "workspaceId": { "type": "string" },
                "taskId": { "type": "string", "description": "Task ID" },
                "type": { "type": "string", "enum": ["screenshot", "test_results", "code_diff", "logs"], "description": "Artifact type filter" }
            },
            "required": ["taskId"]
        })),
        // ── Delegation tools ─────────────────────────────────────────────
        tool_def("delegate_task_to_agent", "Delegate a task to a new agent by spawning a real process. Use specialist='CRAFTER' for implementation, specialist='GATE' for verification, specialist='DEVELOPER' for solo plan+implement.", serde_json::json!({
            "type": "object",
            "properties": {
                "taskId": { "type": "string", "description": "Task ID to delegate" },
                "callerAgentId": { "type": "string", "description": "Your agent ID (the delegator)" },
                "callerSessionId": { "type": "string", "description": "Session ID of the delegator agent (optional)" },
                "specialist": { "type": "string", "enum": ["CRAFTER", "GATE", "DEVELOPER"], "description": "Specialist type" },
                "provider": { "type": "string", "description": "ACP provider (claude, auggie, opencode, etc.)" },
                "cwd": { "type": "string", "description": "Working directory for the child agent" },
                "additionalInstructions": { "type": "string", "description": "Extra context or constraints for the child agent" },
                "waitMode": { "type": "string", "enum": ["immediate", "after_all", "fire_and_forget"], "description": "Wait mode (default: after_all, fire_and_forget behaves like immediate)" }
            },
            "required": ["taskId", "callerAgentId", "specialist"]
        })),
        tool_def("report_to_parent", "Submit completion report to parent agent. MUST be called when task is done.", serde_json::json!({
            "type": "object",
            "properties": {
                "agentId": { "type": "string", "description": "Your agent ID" },
                "taskId": { "type": "string", "description": "Task ID being reported" },
                "summary": { "type": "string", "description": "Summary of work done" },
                "success": { "type": "boolean", "description": "Whether task succeeded" }
            },
            "required": ["agentId", "taskId", "summary", "success"]
        })),
        tool_def("send_message_to_agent", "Send message from one agent to another", serde_json::json!({
            "type": "object",
            "properties": {
                "fromAgentId": { "type": "string", "description": "Sender agent ID" },
                "toAgentId": { "type": "string", "description": "Recipient agent ID" },
                "message": { "type": "string", "description": "Message content" }
            },
            "required": ["fromAgentId", "toAgentId", "message"]
        })),
        // ── Note tools ───────────────────────────────────────────────────
        tool_def("list_notes", "List all notes in the workspace. Optionally filter by type.", serde_json::json!({
            "type": "object",
            "properties": {
                "workspaceId": { "type": "string" },
                "type": { "type": "string", "enum": ["spec", "task", "general"], "description": "Filter by type" }
            }
        })),
        tool_def("create_note", "Create a new note in the workspace for agent collaboration.", serde_json::json!({
            "type": "object",
            "properties": {
                "noteId": { "type": "string" },
                "title": { "type": "string", "description": "Note title" },
                "content": { "type": "string", "description": "Note content" },
                "workspaceId": { "type": "string" },
                "type": { "type": "string", "enum": ["spec", "task", "general"] }
            },
            "required": ["title"]
        })),
        tool_def("read_note", "Read the content of a note. Use noteId='spec' for the workspace spec note.", serde_json::json!({
            "type": "object",
            "properties": {
                "noteId": { "type": "string", "description": "Note ID ('spec' for spec note)" },
                "workspaceId": { "type": "string" }
            },
            "required": ["noteId"]
        })),
        tool_def("set_note_content", "Set (replace) the content of a note. Spec note is auto-created if missing.", serde_json::json!({
            "type": "object",
            "properties": {
                "noteId": { "type": "string", "description": "Note ID" },
                "content": { "type": "string", "description": "New content" },
                "workspaceId": { "type": "string" }
            },
            "required": ["noteId", "content"]
        })),
        tool_def("append_to_note", "Append content to an existing note (for progress updates, reports, etc.).", serde_json::json!({
            "type": "object",
            "properties": {
                "noteId": { "type": "string", "description": "Note ID" },
                "content": { "type": "string", "description": "Content to append" }
            },
            "required": ["noteId", "content"]
        })),
        // ── Workspace tools ──────────────────────────────────────────────
        tool_def("list_workspaces", "List all workspaces with their id, title, status, and branch.", serde_json::json!({
            "type": "object",
            "properties": {}
        })),
        tool_def("get_workspace_info", "Get workspace details including agents, tasks, and notes summary.", serde_json::json!({
            "type": "object",
            "properties": {
                "workspaceId": { "type": "string", "description": "Workspace ID" }
            }
        })),
        tool_def("list_skills", "List all discovered skills", serde_json::json!({
            "type": "object",
            "properties": {}
        })),
        tool_def("list_specialists", "List all available specialist configurations (roles, model tiers, descriptions).", serde_json::json!({
            "type": "object",
            "properties": {}
        })),
        tool_def("read_canvas_sdk_resource", "Read the Routa Canvas SDK manifest or a generated definition resource by resource URI. Use this when your provider cannot call MCP resources/read directly.", serde_json::json!({
            "type": "object",
            "properties": {
                "uri": { "type": "string", "description": "Canvas SDK resource URI, e.g. resource://routa/canvas-sdk/manifest" }
            },
            "required": ["uri"]
        })),
        tool_def("read_specialist_spec_resource", "Read a bundled specialist framework spec resource by URI. Use this when your provider cannot call MCP resources/read directly.", serde_json::json!({
            "type": "object",
            "properties": {
                "uri": { "type": "string", "description": "Specialist spec resource URI, e.g. resource://routa/specialists/feature-tree/manifest" }
            },
            "required": ["uri"]
        })),
        // ── Event tools ──────────────────────────────────────────────────
        tool_def("subscribe_to_events", "Subscribe to workspace events", serde_json::json!({
            "type": "object",
            "properties": {
                "agentId": { "type": "string", "description": "Your agent ID" },
                "agentName": { "type": "string", "description": "Your agent name" },
                "eventTypes": { "type": "array", "items": { "type": "string" }, "description": "Event types to subscribe to" }
            },
            "required": ["agentId", "agentName", "eventTypes"]
        })),
        tool_def("unsubscribe_from_events", "Remove an event subscription", serde_json::json!({
            "type": "object",
            "properties": {
                "subscriptionId": { "type": "string", "description": "Subscription ID to remove" }
            },
            "required": ["subscriptionId"]
        })),
        // ── Kanban tools ─────────────────────────────────────────────────
        tool_def("create_board", "Create a new Kanban board", serde_json::json!({
            "type": "object",
            "properties": {
                "name": { "type": "string", "description": "Board name" },
                "columns": { "type": "array", "items": { "type": "string" }, "description": "Default column names" },
                "workspaceId": { "type": "string", "description": "Workspace ID" }
            },
            "required": ["name"]
        })),
        tool_def("list_boards", "List all Kanban boards", serde_json::json!({
            "type": "object",
            "properties": {
                "workspaceId": { "type": "string", "description": "Workspace ID" }
            }
        })),
        tool_def("get_board", "Get a board with all columns and cards", serde_json::json!({
            "type": "object",
            "properties": {
                "boardId": { "type": "string", "description": "Board ID" }
            },
            "required": ["boardId"]
        })),
        tool_def("create_card", "Create a new card in a column", serde_json::json!({
            "type": "object",
            "properties": {
                "boardId": { "type": "string", "description": "Board ID" },
                "columnId": { "type": "string", "description": "Column ID" },
                "title": { "type": "string", "description": "Card title" },
                "description": { "type": "string", "description": "Card description" },
                "priority": { "type": "string", "enum": ["low", "medium", "high", "urgent"], "description": "Card priority" },
                "labels": { "type": "array", "items": { "type": "string" }, "description": "Card labels" },
                "workspaceId": { "type": "string", "description": "Workspace ID" }
            },
            "required": ["boardId", "columnId", "title"]
        })),
        tool_def("move_card", "Move a card to a different column or position", serde_json::json!({
            "type": "object",
            "properties": {
                "cardId": { "type": "string", "description": "Card ID" },
                "targetColumnId": { "type": "string", "description": "Target column ID" },
                "position": { "type": "integer", "description": "Position in the column" }
            },
            "required": ["cardId", "targetColumnId"]
        })),
        tool_def("update_card", "Update card fields (title, description, comment, priority, labels). From dev onward, use comment because description is frozen. For story-readiness fields such as scope, acceptance criteria, verification commands, or test cases, use update_task instead.", serde_json::json!({
            "type": "object",
            "properties": {
                "cardId": { "type": "string", "description": "Card ID" },
                "title": { "type": "string", "description": "New title" },
                "description": { "type": "string", "description": "New description" },
                "comment": { "type": "string", "description": "Comment or progress note to append" },
                "priority": { "type": "string", "enum": ["low", "medium", "high", "urgent"], "description": "New priority" },
                "labels": { "type": "array", "items": { "type": "string" }, "description": "New labels" }
            },
            "required": ["cardId"]
        })),
        tool_def("delete_card", "Delete a card from the board", serde_json::json!({
            "type": "object",
            "properties": {
                "cardId": { "type": "string", "description": "Card ID" }
            },
            "required": ["cardId"]
        })),
        tool_def("create_column", "Create a new column in a board", serde_json::json!({
            "type": "object",
            "properties": {
                "boardId": { "type": "string", "description": "Board ID" },
                "name": { "type": "string", "description": "Column name" },
                "color": { "type": "string", "description": "Column color" }
            },
            "required": ["boardId", "name"]
        })),
        tool_def("delete_column", "Delete a column (and optionally its cards)", serde_json::json!({
            "type": "object",
            "properties": {
                "columnId": { "type": "string", "description": "Column ID" },
                "boardId": { "type": "string", "description": "Board ID" },
                "deleteCards": { "type": "boolean", "description": "Whether to delete cards in the column" }
            },
            "required": ["columnId", "boardId"]
        })),
        tool_def("search_cards", "Search cards across boards by title, labels, or assignee", serde_json::json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "Search query" },
                "boardId": { "type": "string", "description": "Limit search to a specific board" },
                "workspaceId": { "type": "string", "description": "Workspace ID" }
            },
            "required": ["query"]
        })),
        tool_def("list_cards_by_column", "List all cards in a specific column", serde_json::json!({
            "type": "object",
            "properties": {
                "columnId": { "type": "string", "description": "Column ID" },
                "boardId": { "type": "string", "description": "Board ID" }
            },
            "required": ["columnId", "boardId"]
        })),
        tool_def("decompose_tasks", "Create multiple Kanban cards from a list of decomposed tasks", serde_json::json!({
            "type": "object",
            "properties": {
                "boardId": { "type": "string", "description": "Board ID" },
                "workspaceId": { "type": "string", "description": "Workspace ID" },
                "columnId": { "type": "string", "description": "Target column ID" },
                "tasks": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": { "type": "string" },
                            "description": { "type": "string" },
                            "priority": { "type": "string" },
                            "labels": { "type": "array", "items": { "type": "string" } }
                        },
                        "required": ["title"]
                    }
                }
            },
            "required": ["tasks"]
        })),
        tool_def("request_previous_lane_handoff", "Ask the immediately previous Kanban lane to prepare environment, provide runtime context, or rerun a focused command for this card.", serde_json::json!({
            "type": "object",
            "properties": {
                "taskId": { "type": "string", "description": "Card/task ID" },
                "requestType": { "type": "string", "enum": ["environment_preparation", "runtime_context", "clarification", "rerun_command"] },
                "request": { "type": "string", "description": "Concrete request for the previous lane" },
                "sessionId": { "type": "string", "description": "Current ACP session ID" }
            },
            "required": ["taskId", "requestType", "request", "sessionId"]
        })),
        tool_def("submit_lane_handoff", "Submit the result of a lane handoff request after preparing runtime support for another Kanban lane.", serde_json::json!({
            "type": "object",
            "properties": {
                "taskId": { "type": "string", "description": "Card/task ID" },
                "handoffId": { "type": "string", "description": "Lane handoff request ID" },
                "status": { "type": "string", "enum": ["completed", "blocked", "failed"] },
                "summary": { "type": "string", "description": "Concise summary of what was prepared or why it is blocked" },
                "sessionId": { "type": "string", "description": "Current ACP session ID" }
            },
            "required": ["taskId", "handoffId", "status", "summary", "sessionId"]
        })),
    ]
}

fn tool_def(name: &str, description: &str, input_schema: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "name": name,
        "description": description,
        "inputSchema": input_schema,
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::{build_tool_list_for_profile, tool_allowed_for_profile};

    #[test]
    fn kanban_profile_only_allows_kanban_tools() {
        assert!(tool_allowed_for_profile(
            "create_card",
            Some("kanban-planning")
        ));
        assert!(!tool_allowed_for_profile(
            "list_agents",
            Some("kanban-planning")
        ));
        assert!(tool_allowed_for_profile("list_agents", None));
    }

    #[test]
    fn build_tool_list_for_kanban_profile_filters_to_allowed_set() {
        let tools = build_tool_list_for_profile(Some("kanban-planning"));
        let names: Vec<&str> = tools
            .iter()
            .filter_map(|tool| tool.get("name").and_then(|v| v.as_str()))
            .collect();

        let allowed: HashSet<&str> = [
            "create_card",
            "decompose_tasks",
            "search_cards",
            "list_cards_by_column",
            "update_task",
            "update_card",
            "move_card",
            "request_previous_lane_handoff",
            "submit_lane_handoff",
        ]
        .into_iter()
        .collect();

        assert!(!names.is_empty());
        assert!(names.iter().all(|name| allowed.contains(name)));
    }
}
