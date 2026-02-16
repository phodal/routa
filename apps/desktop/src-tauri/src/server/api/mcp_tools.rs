//! MCP Tools API - /api/mcp/tools
//!
//! GET  /api/mcp/tools - List all MCP tool definitions
//! POST /api/mcp/tools - Execute a specific tool by name

use axum::{extract::State, routing::get, Json, Router};
use serde::Deserialize;

use crate::server::error::ServerError;
use crate::server::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(list_tools).post(execute_tool))
}

async fn list_tools(State(_state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "tools": super::mcp_routes::build_tool_list_public()
    }))
}

#[derive(Debug, Deserialize)]
struct ExecuteToolRequest {
    name: Option<String>,
    args: Option<serde_json::Value>,
}

async fn execute_tool(
    State(state): State<AppState>,
    Json(body): Json<ExecuteToolRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let name = body
        .name
        .as_deref()
        .ok_or_else(|| ServerError::BadRequest("Tool name is required".into()))?;

    let args = body.args.unwrap_or(serde_json::json!({}));

    let tool_names: Vec<&str> = vec![
        "list_agents",
        "create_agent",
        "list_tasks",
        "create_task",
        "update_task_status",
        "list_notes",
        "create_note",
        "read_note",
        "list_workspaces",
        "list_skills",
    ];

    if !tool_names.contains(&name) {
        return Err(ServerError::BadRequest(format!("Unknown tool: {}", name)));
    }

    let result = super::mcp_routes::execute_tool_public(&state, name, &args).await;
    Ok(Json(result))
}
