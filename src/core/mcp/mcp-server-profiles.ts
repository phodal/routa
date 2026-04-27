export type McpServerProfile = "coordination" | "kanban-planning" | "team-coordination";

const KANBAN_PLANNING_TOOL_NAMES = [
  "assemble_task_adaptive_harness",
  "summarize_task_history_context",
  "summarize_file_session_context",
  "inspect_transcript_turns",
  "load_feature_retrospective_memory",
  "load_feature_tree_context",
  "confirm_feature_tree_story_context",
  "save_feature_retrospective_memory",
  "create_card",
  "decompose_tasks",
  "search_cards",
  "list_cards_by_column",
  "save_history_memory_context",
  "update_task",
  "update_card",
  "move_card",
] as const;

const TEAM_COORDINATION_TOOL_NAMES = [
  "assemble_task_adaptive_harness",
  "summarize_task_history_context",
  "summarize_file_session_context",
  "inspect_transcript_turns",
  "load_feature_retrospective_memory",
  "load_feature_tree_context",
  "confirm_feature_tree_story_context",
  "save_feature_retrospective_memory",
  "create_task",
  "list_agents",
  "read_agent_conversation",
  "set_agent_name",
  "delegate_task",
  "delegate_task_to_agent",
  "send_message_to_agent",
  "report_to_parent",
  "create_note",
  "read_note",
  "list_notes",
  "set_note_content",
  "convert_task_blocks",
  "save_history_memory_context",
  "update_task",
  "update_card",
  "move_card",
  "request_previous_lane_handoff",
  "submit_lane_handoff",
  "request_artifact",
  "provide_artifact",
  "list_artifacts",
  "get_artifact",
  "list_pending_artifact_requests",
  "capture_screenshot",
] as const;

export function resolveMcpServerProfile(value?: string): McpServerProfile | undefined {
  if (value === "coordination" || value === "kanban-planning" || value === "team-coordination") {
    return value;
  }
  return undefined;
}

export function getMcpProfileToolAllowlist(profile?: McpServerProfile): ReadonlySet<string> | undefined {
  if (profile === "kanban-planning") {
    return new Set(KANBAN_PLANNING_TOOL_NAMES);
  }
  if (profile === "team-coordination") {
    return new Set(TEAM_COORDINATION_TOOL_NAMES);
  }
  return undefined;
}

export function getMcpServerName(profile?: McpServerProfile): string {
  return profile === "kanban-planning"
    ? "kanban-planning-mcp"
    : profile === "team-coordination"
      ? "team-coordination-mcp"
      : "routa-mcp";
}
