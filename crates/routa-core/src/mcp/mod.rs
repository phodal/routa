//! MCP (Model Context Protocol) server integration using the official Rust SDK (rmcp).
//!
//! Exposes Routa's tools (agents, tasks, notes, workspace management) as MCP tools
//! so that AI assistants can interact with the multi-agent coordination system.

use rmcp::{
    handler::server::tool::ToolRouter, model::*, tool, tool_handler, tool_router, ErrorData,
    ServerHandler,
};

use crate::state::AppState;

/// MCP Server handler that exposes Routa tools to AI assistants.
#[derive(Clone)]
pub struct RoutaMcpServer {
    state: AppState,
    tool_router: ToolRouter<Self>,
}

#[tool_router]
impl RoutaMcpServer {
    pub fn new(state: AppState) -> Self {
        Self {
            state,
            tool_router: Self::tool_router(),
        }
    }

    // ── Agent Tools ──────────────────────────────────────────────────

    #[tool(description = "List all agents in the default workspace")]
    async fn list_agents(&self) -> Result<CallToolResult, ErrorData> {
        let agents = self
            .state
            .agent_store
            .list_by_workspace("default")
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
        let json = serde_json::to_string_pretty(&agents).unwrap_or_default();
        Ok(CallToolResult::success(vec![Content::text(json)]))
    }

    // ── Task Tools ───────────────────────────────────────────────────

    #[tool(description = "List all tasks in the default workspace")]
    async fn list_tasks(&self) -> Result<CallToolResult, ErrorData> {
        let tasks = self
            .state
            .task_store
            .list_by_workspace("default")
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
        let json = serde_json::to_string_pretty(&tasks).unwrap_or_default();
        Ok(CallToolResult::success(vec![Content::text(json)]))
    }

    #[tool(description = "Find tasks that are ready to execute (all dependencies completed)")]
    async fn find_ready_tasks(&self) -> Result<CallToolResult, ErrorData> {
        let tasks = self
            .state
            .task_store
            .find_ready_tasks("default")
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
        let json = serde_json::to_string_pretty(&tasks).unwrap_or_default();
        Ok(CallToolResult::success(vec![Content::text(json)]))
    }

    // ── Note Tools ───────────────────────────────────────────────────

    #[tool(description = "List all notes in the default workspace")]
    async fn list_notes(&self) -> Result<CallToolResult, ErrorData> {
        let notes = self
            .state
            .note_store
            .list_by_workspace("default")
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
        let json = serde_json::to_string_pretty(&notes).unwrap_or_default();
        Ok(CallToolResult::success(vec![Content::text(json)]))
    }

    #[tool(description = "Read the spec note for the default workspace")]
    async fn read_spec(&self) -> Result<CallToolResult, ErrorData> {
        let note = self
            .state
            .note_store
            .ensure_spec("default")
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
        let json = serde_json::to_string_pretty(&note).unwrap_or_default();
        Ok(CallToolResult::success(vec![Content::text(json)]))
    }

    // ── Workspace Tools ──────────────────────────────────────────────

    #[tool(description = "List all workspaces")]
    async fn list_workspaces(&self) -> Result<CallToolResult, ErrorData> {
        let workspaces = self
            .state
            .workspace_store
            .list()
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
        let json = serde_json::to_string_pretty(&workspaces).unwrap_or_default();
        Ok(CallToolResult::success(vec![Content::text(json)]))
    }

    // ── Skill Tools ──────────────────────────────────────────────────

    #[tool(description = "List all discovered skills")]
    async fn list_skills(&self) -> Result<CallToolResult, ErrorData> {
        let skills = self.state.skill_registry.list_skills();
        let json = serde_json::to_string_pretty(&skills).unwrap_or_default();
        Ok(CallToolResult::success(vec![Content::text(json)]))
    }
}

#[tool_handler]
impl ServerHandler for RoutaMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            instructions: Some(
                "Routa multi-agent coordination platform. \
                 Use these tools to manage agents, tasks, notes, and workspaces."
                    .into(),
            ),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}
