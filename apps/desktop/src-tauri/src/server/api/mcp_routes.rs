//! MCP Streamable HTTP API - /api/mcp
//!
//! POST   /api/mcp - JSON-RPC messages (initialize, tools/list, tools/call)
//! GET    /api/mcp - SSE stream for server-initiated messages
//! DELETE /api/mcp - Terminate an MCP session
//! OPTIONS /api/mcp - CORS preflight
//!
//! Implements the MCP Streamable HTTP protocol (2025-06-18).

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    response::sse::{Event, KeepAlive, Sse},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_stream::StreamExt as _;

use crate::server::error::ServerError;
use crate::server::state::AppState;

/// In-memory session store for MCP sessions.
type McpSessions = Arc<RwLock<HashMap<String, McpSessionData>>>;

struct McpSessionData {
    #[allow(dead_code)]
    workspace_id: String,
}

pub fn router() -> Router<AppState> {
    let sessions: McpSessions = Arc::new(RwLock::new(HashMap::new()));

    Router::new()
        .route(
            "/",
            get({
                let sessions = sessions.clone();
                move |headers, state, query| mcp_get(headers, state, query, sessions)
            })
            .post({
                let sessions = sessions.clone();
                move |headers, state, body| mcp_post(headers, state, body, sessions)
            })
            .delete({
                let sessions = sessions.clone();
                move |headers, state| mcp_delete(headers, state, sessions)
            }),
        )
}

// ─── POST /api/mcp ────────────────────────────────────────────────────

async fn mcp_post(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
    sessions: McpSessions,
) -> Result<(HeaderMap, Json<serde_json::Value>), ServerError> {
    let session_id = headers
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let method = body.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let id = body.get("id").cloned().unwrap_or(serde_json::json!(null));
    let params = body.get("params").cloned().unwrap_or_default();

    tracing::info!(
        "[MCP Route] POST: method={}, session={:?}",
        method,
        session_id
    );

    let mut response_headers = HeaderMap::new();
    response_headers.insert("access-control-allow-origin", "*".parse().unwrap());
    response_headers.insert(
        "access-control-expose-headers",
        "Mcp-Session-Id, MCP-Protocol-Version".parse().unwrap(),
    );

    match method {
        "initialize" => {
            let new_session_id = uuid::Uuid::new_v4().to_string();
            let protocol_version = params
                .get("protocolVersion")
                .and_then(|v| v.as_str())
                .unwrap_or("2024-11-05");

            sessions.write().await.insert(
                new_session_id.clone(),
                McpSessionData {
                    workspace_id: "default".to_string(),
                },
            );

            response_headers.insert(
                "mcp-session-id",
                new_session_id.parse().unwrap(),
            );

            let active_count = sessions.read().await.len();
            tracing::info!(
                "[MCP Route] Session created: {} (active: {})",
                new_session_id,
                active_count
            );

            Ok((
                response_headers,
                Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "protocolVersion": protocol_version,
                        "capabilities": {
                            "tools": { "listChanged": false }
                        },
                        "serverInfo": {
                            "name": "routa-mcp",
                            "version": "0.1.0"
                        }
                    }
                })),
            ))
        }

        "tools/list" => {
            let tools = build_tool_list(&state);
            Ok((
                response_headers,
                Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": { "tools": tools }
                })),
            ))
        }

        "tools/call" => {
            let tool_name = params
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or(serde_json::json!({}));

            let result = execute_tool(&state, tool_name, &arguments).await;

            Ok((
                response_headers,
                Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": result
                })),
            ))
        }

        "notifications/initialized" => {
            // Client confirms initialization — no-op
            Ok((
                response_headers,
                Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {}
                })),
            ))
        }

        _ => Ok((
            response_headers,
            Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32601,
                    "message": format!("Method not found: {}", method)
                }
            })),
        )),
    }
}

// ─── GET /api/mcp (SSE) ──────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct McpGetQuery {
    #[allow(dead_code)]
    session_id: Option<String>,
}

async fn mcp_get(
    headers: HeaderMap,
    State(_state): State<AppState>,
    Query(_query): Query<McpGetQuery>,
    sessions: McpSessions,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, (axum::http::StatusCode, Json<serde_json::Value>)>
{
    let session_id = headers
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok());

    if session_id.is_none() || !sessions.read().await.contains_key(session_id.unwrap_or("")) {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "jsonrpc": "2.0",
                "error": {
                    "code": -32600,
                    "message": "No active session. Send an initialize POST request first."
                }
            })),
        ));
    }

    let heartbeat = tokio_stream::wrappers::IntervalStream::new(tokio::time::interval(
        std::time::Duration::from_secs(30),
    ))
    .map(|_| Ok(Event::default().comment("heartbeat")));

    Ok(Sse::new(heartbeat).keep_alive(KeepAlive::default()))
}

// ─── DELETE /api/mcp ──────────────────────────────────────────────────

async fn mcp_delete(
    headers: HeaderMap,
    State(_state): State<AppState>,
    sessions: McpSessions,
) -> Result<axum::http::StatusCode, ServerError> {
    let session_id = headers
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    if let Some(sid) = session_id {
        let mut store = sessions.write().await;
        if store.remove(&sid).is_some() {
            tracing::info!(
                "[MCP Route] Session closed: {} (active: {})",
                sid,
                store.len()
            );
            Ok(axum::http::StatusCode::NO_CONTENT)
        } else {
            Err(ServerError::NotFound("Session not found".into()))
        }
    } else {
        Err(ServerError::BadRequest("Missing Mcp-Session-Id header".into()))
    }
}

// ─── Tool Definitions ─────────────────────────────────────────────────

/// Public accessor for tool list (used by mcp_tools module).
pub fn build_tool_list_public() -> Vec<serde_json::Value> {
    build_tool_list_inner()
}

/// Public accessor for tool execution (used by mcp_tools module).
pub async fn execute_tool_public(
    state: &AppState,
    name: &str,
    args: &serde_json::Value,
) -> serde_json::Value {
    execute_tool(state, name, args).await
}

fn build_tool_list(_state: &AppState) -> Vec<serde_json::Value> {
    build_tool_list_inner()
}

fn build_tool_list_inner() -> Vec<serde_json::Value> {
    vec![
        tool_def("list_agents", "List all agents in the workspace", serde_json::json!({
            "type": "object",
            "properties": {
                "workspaceId": { "type": "string", "description": "Workspace ID (default if omitted)" }
            }
        })),
        tool_def("create_agent", "Create a new agent", serde_json::json!({
            "type": "object",
            "properties": {
                "name": { "type": "string", "description": "Agent name" },
                "role": { "type": "string", "description": "Agent role (CRAFTER, GATE, ROUTA, etc.)" },
                "workspaceId": { "type": "string" }
            },
            "required": ["name", "role"]
        })),
        tool_def("list_tasks", "List all tasks in the workspace", serde_json::json!({
            "type": "object",
            "properties": {
                "workspaceId": { "type": "string" }
            }
        })),
        tool_def("create_task", "Create a new task", serde_json::json!({
            "type": "object",
            "properties": {
                "title": { "type": "string" },
                "objective": { "type": "string" },
                "workspaceId": { "type": "string" },
                "scope": { "type": "string" },
                "acceptanceCriteria": { "type": "array", "items": { "type": "string" } }
            },
            "required": ["title", "objective"]
        })),
        tool_def("update_task_status", "Update a task's status", serde_json::json!({
            "type": "object",
            "properties": {
                "taskId": { "type": "string" },
                "status": { "type": "string", "enum": ["PENDING","IN_PROGRESS","REVIEW_REQUIRED","COMPLETED","NEEDS_FIX","BLOCKED","CANCELLED"] },
                "agentId": { "type": "string" }
            },
            "required": ["taskId", "status", "agentId"]
        })),
        tool_def("list_notes", "List all notes in the workspace", serde_json::json!({
            "type": "object",
            "properties": {
                "workspaceId": { "type": "string" }
            }
        })),
        tool_def("create_note", "Create or update a note", serde_json::json!({
            "type": "object",
            "properties": {
                "noteId": { "type": "string" },
                "title": { "type": "string" },
                "content": { "type": "string" },
                "workspaceId": { "type": "string" },
                "type": { "type": "string" }
            },
            "required": ["title"]
        })),
        tool_def("read_note", "Read a note by ID", serde_json::json!({
            "type": "object",
            "properties": {
                "noteId": { "type": "string" },
                "workspaceId": { "type": "string" }
            },
            "required": ["noteId"]
        })),
        tool_def("list_workspaces", "List all workspaces", serde_json::json!({
            "type": "object",
            "properties": {}
        })),
        tool_def("list_skills", "List all discovered skills", serde_json::json!({
            "type": "object",
            "properties": {}
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

/// Execute an MCP tool by name.
async fn execute_tool(
    state: &AppState,
    name: &str,
    args: &serde_json::Value,
) -> serde_json::Value {
    let workspace_id = args
        .get("workspaceId")
        .and_then(|v| v.as_str())
        .unwrap_or("default");

    match name {
        "list_agents" => {
            match state.agent_store.list_by_workspace(workspace_id).await {
                Ok(agents) => tool_result_text(&serde_json::to_string_pretty(&agents).unwrap_or_default()),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "create_agent" => {
            let name_val = args.get("name").and_then(|v| v.as_str()).unwrap_or("unnamed");
            let role_str = args.get("role").and_then(|v| v.as_str()).unwrap_or("CRAFTER");
            let role = crate::server::models::agent::AgentRole::from_str(role_str);
            match role {
                Some(r) => {
                    let agent = crate::server::models::agent::Agent::new(
                        uuid::Uuid::new_v4().to_string(),
                        name_val.to_string(),
                        r,
                        workspace_id.to_string(),
                        None, None, None,
                    );
                    match state.agent_store.save(&agent).await {
                        Ok(_) => tool_result_text(&format!("Created agent: {}", agent.id)),
                        Err(e) => tool_result_error(&e.to_string()),
                    }
                }
                None => tool_result_error(&format!("Invalid role: {}", role_str)),
            }
        }
        "list_tasks" => {
            match state.task_store.list_by_workspace(workspace_id).await {
                Ok(tasks) => tool_result_text(&serde_json::to_string_pretty(&tasks).unwrap_or_default()),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "create_task" => {
            let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled");
            let objective = args.get("objective").and_then(|v| v.as_str()).unwrap_or("");
            let task = crate::server::models::task::Task::new(
                uuid::Uuid::new_v4().to_string(),
                title.to_string(),
                objective.to_string(),
                workspace_id.to_string(),
                args.get("scope").and_then(|v| v.as_str()).map(|s| s.to_string()),
                None, None, None, None,
            );
            match state.task_store.save(&task).await {
                Ok(_) => tool_result_text(&format!("Created task: {}", task.id)),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "update_task_status" => {
            let task_id = args.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
            let status_str = args.get("status").and_then(|v| v.as_str()).unwrap_or("");
            match crate::server::models::task::TaskStatus::from_str(status_str) {
                Some(status) => {
                    match state.task_store.update_status(task_id, &status).await {
                        Ok(_) => tool_result_text(&format!("Updated task {} to {}", task_id, status_str)),
                        Err(e) => tool_result_error(&e.to_string()),
                    }
                }
                None => tool_result_error(&format!("Invalid status: {}", status_str)),
            }
        }
        "list_notes" => {
            match state.note_store.list_by_workspace(workspace_id).await {
                Ok(notes) => tool_result_text(&serde_json::to_string_pretty(&notes).unwrap_or_default()),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "create_note" => {
            let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let note_id = args.get("noteId").and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            let note = crate::server::models::note::Note::new(
                note_id,
                title.to_string(),
                content.to_string(),
                workspace_id.to_string(),
                None,
            );
            match state.note_store.save(&note).await {
                Ok(_) => tool_result_text(&format!("Created note: {}", note.id)),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "read_note" => {
            let note_id = args.get("noteId").and_then(|v| v.as_str()).unwrap_or("");
            match state.note_store.get(note_id, workspace_id).await {
                Ok(Some(note)) => tool_result_text(&serde_json::to_string_pretty(&note).unwrap_or_default()),
                Ok(None) => tool_result_error(&format!("Note not found: {}", note_id)),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "list_workspaces" => {
            match state.workspace_store.list().await {
                Ok(ws) => tool_result_text(&serde_json::to_string_pretty(&ws).unwrap_or_default()),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "list_skills" => {
            let skills = state.skill_registry.list_skills();
            tool_result_text(&serde_json::to_string_pretty(&skills).unwrap_or_default())
        }
        _ => tool_result_error(&format!("Unknown tool: {}", name)),
    }
}

fn tool_result_text(text: &str) -> serde_json::Value {
    serde_json::json!({
        "content": [{ "type": "text", "text": text }]
    })
}

fn tool_result_error(msg: &str) -> serde_json::Value {
    serde_json::json!({
        "isError": true,
        "content": [{ "type": "text", "text": msg }]
    })
}
