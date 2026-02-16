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
                "scope": { "type": "string", "description": "Task scope" },
                "acceptanceCriteria": { "type": "array", "items": { "type": "string" }, "description": "Acceptance criteria" }
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
        tool_def("get_my_task", "Get the task(s) assigned to the calling agent, including objective, scope, and acceptance criteria.", serde_json::json!({
            "type": "object",
            "properties": {
                "agentId": { "type": "string", "description": "Your agent ID" }
            },
            "required": ["agentId"]
        })),
        // ── Delegation tools ─────────────────────────────────────────────
        tool_def("delegate_task_to_agent", "Delegate a task to a new agent by spawning a real process. Use specialist='CRAFTER' for implementation, specialist='GATE' for verification, specialist='DEVELOPER' for solo plan+implement.", serde_json::json!({
            "type": "object",
            "properties": {
                "taskId": { "type": "string", "description": "Task ID to delegate" },
                "callerAgentId": { "type": "string", "description": "Your agent ID (the delegator)" },
                "specialist": { "type": "string", "enum": ["CRAFTER", "GATE", "DEVELOPER"], "description": "Specialist type" },
                "provider": { "type": "string", "description": "ACP provider (claude, auggie, opencode, etc.)" },
                "waitMode": { "type": "string", "enum": ["after_all", "fire_and_forget"], "description": "Wait mode (default: after_all)" }
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
        // ── Agent tools ──────────────────────────────────────────────────
        "list_agents" => {
            match state.agent_store.list_by_workspace(workspace_id).await {
                Ok(agents) => tool_result_text(&serde_json::to_string_pretty(&agents).unwrap_or_default()),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "create_agent" => {
            let name_val = args.get("name").and_then(|v| v.as_str()).unwrap_or("unnamed");
            let role_str = args.get("role").and_then(|v| v.as_str()).unwrap_or("CRAFTER");
            let parent_id = args.get("parentId").and_then(|v| v.as_str()).map(|s| s.to_string());
            let role = crate::server::models::agent::AgentRole::from_str(role_str);
            match role {
                Some(r) => {
                    let agent = crate::server::models::agent::Agent::new(
                        uuid::Uuid::new_v4().to_string(),
                        name_val.to_string(),
                        r,
                        workspace_id.to_string(),
                        parent_id,
                        None, None,
                    );
                    match state.agent_store.save(&agent).await {
                        Ok(_) => tool_result_json(&serde_json::json!({
                            "success": true,
                            "agentId": agent.id,
                            "name": agent.name,
                            "role": role_str
                        })),
                        Err(e) => tool_result_error(&e.to_string()),
                    }
                }
                None => tool_result_error(&format!("Invalid role: {}", role_str)),
            }
        }
        "read_agent_conversation" => {
            let agent_id = args.get("agentId").and_then(|v| v.as_str()).unwrap_or("");
            let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(50) as usize;
            match state.conversation_store.get_last_n(agent_id, limit).await {
                Ok(messages) => tool_result_text(&serde_json::to_string_pretty(&messages).unwrap_or_default()),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "get_agent_status" => {
            let agent_id = args.get("agentId").and_then(|v| v.as_str()).unwrap_or("");
            match state.agent_store.get(agent_id).await {
                Ok(Some(agent)) => {
                    let tasks = state.task_store.list_by_assignee(agent_id).await.unwrap_or_default();
                    let msg_count = state.conversation_store.get_message_count(agent_id).await.unwrap_or(0);
                    tool_result_json(&serde_json::json!({
                        "agentId": agent.id,
                        "name": agent.name,
                        "status": agent.status.as_str(),
                        "role": agent.role.as_str(),
                        "messageCount": msg_count,
                        "taskCount": tasks.len(),
                        "tasks": tasks.iter().map(|t| serde_json::json!({
                            "id": t.id,
                            "title": t.title,
                            "status": t.status.as_str()
                        })).collect::<Vec<_>>()
                    }))
                }
                Ok(None) => tool_result_error(&format!("Agent not found: {}", agent_id)),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "get_agent_summary" => {
            let agent_id = args.get("agentId").and_then(|v| v.as_str()).unwrap_or("");
            match state.agent_store.get(agent_id).await {
                Ok(Some(agent)) => {
                    let messages = state.conversation_store.get_last_n(agent_id, 5).await.unwrap_or_default();
                    let tasks = state.task_store.list_by_assignee(agent_id).await.unwrap_or_default();
                    let active_tasks: Vec<_> = tasks.iter()
                        .filter(|t| t.status == crate::server::models::task::TaskStatus::InProgress)
                        .collect();
                    tool_result_json(&serde_json::json!({
                        "agentId": agent.id,
                        "name": agent.name,
                        "status": agent.status.as_str(),
                        "role": agent.role.as_str(),
                        "activeTasks": active_tasks.len(),
                        "recentMessages": messages.len(),
                        "lastActivity": agent.updated_at
                    }))
                }
                Ok(None) => tool_result_error(&format!("Agent not found: {}", agent_id)),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        // ── Task tools ───────────────────────────────────────────────────
        "list_tasks" => {
            match state.task_store.list_by_workspace(workspace_id).await {
                Ok(tasks) => tool_result_text(&serde_json::to_string_pretty(&tasks).unwrap_or_default()),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "create_task" => {
            let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled");
            let objective = args.get("objective").and_then(|v| v.as_str()).unwrap_or("");
            let task_id = uuid::Uuid::new_v4().to_string();
            let task = crate::server::models::task::Task::new(
                task_id.clone(),
                title.to_string(),
                objective.to_string(),
                workspace_id.to_string(),
                args.get("scope").and_then(|v| v.as_str()).map(|s| s.to_string()),
                None, None, None, None,
            );
            match state.task_store.save(&task).await {
                Ok(_) => tool_result_json(&serde_json::json!({
                    "success": true,
                    "taskId": task_id,
                    "title": title
                })),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "update_task_status" => {
            let task_id = args.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
            let status_str = args.get("status").and_then(|v| v.as_str()).unwrap_or("");
            let agent_id = args.get("agentId").and_then(|v| v.as_str()).unwrap_or("");
            let reason = args.get("reason").and_then(|v| v.as_str());
            match crate::server::models::task::TaskStatus::from_str(status_str) {
                Some(status) => {
                    match state.task_store.update_status(task_id, &status).await {
                        Ok(_) => {
                            // Emit event via EventBus
                            let event = crate::server::events::AgentEvent {
                                event_type: crate::server::events::AgentEventType::TaskStatusChanged,
                                agent_id: agent_id.to_string(),
                                workspace_id: workspace_id.to_string(),
                                data: serde_json::json!({
                                    "taskId": task_id,
                                    "status": status_str,
                                    "reason": reason
                                }),
                                timestamp: chrono::Utc::now(),
                            };
                            state.event_bus.emit(event).await;
                            tool_result_json(&serde_json::json!({
                                "success": true,
                                "taskId": task_id,
                                "status": status_str
                            }))
                        }
                        Err(e) => tool_result_error(&e.to_string()),
                    }
                }
                None => tool_result_error(&format!("Invalid status: {}", status_str)),
            }
        }
        "get_my_task" => {
            let agent_id = args.get("agentId").and_then(|v| v.as_str()).unwrap_or("");
            match state.task_store.list_by_assignee(agent_id).await {
                Ok(tasks) => tool_result_text(&serde_json::to_string_pretty(&tasks).unwrap_or_default()),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        // ── Delegation tools ─────────────────────────────────────────────
        "delegate_task_to_agent" => {
            // This is a stub - full implementation requires Orchestrator integration
            let task_id = args.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
            let caller_agent_id = args.get("callerAgentId").and_then(|v| v.as_str()).unwrap_or("");
            let specialist = args.get("specialist").and_then(|v| v.as_str()).unwrap_or("CRAFTER");
            let provider = args.get("provider").and_then(|v| v.as_str()).unwrap_or("claude");
            let wait_mode = args.get("waitMode").and_then(|v| v.as_str()).unwrap_or("after_all");

            // For now, return a placeholder - full implementation needs Orchestrator
            tool_result_json(&serde_json::json!({
                "status": "delegated",
                "taskId": task_id,
                "callerAgentId": caller_agent_id,
                "specialist": specialist,
                "provider": provider,
                "waitMode": wait_mode,
                "message": "Task delegation queued. Full orchestration requires Orchestrator integration."
            }))
        }
        "report_to_parent" => {
            let agent_id = args.get("agentId").and_then(|v| v.as_str()).unwrap_or("");
            let task_id = args.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
            let summary = args.get("summary").and_then(|v| v.as_str()).unwrap_or("");
            let success = args.get("success").and_then(|v| v.as_bool()).unwrap_or(true);

            // Update task status based on success
            let new_status = if success {
                crate::server::models::task::TaskStatus::Completed
            } else {
                crate::server::models::task::TaskStatus::NeedsFix
            };

            if let Err(e) = state.task_store.update_status(task_id, &new_status).await {
                return tool_result_error(&format!("Failed to update task status: {}", e));
            }

            // Emit report event
            let event = crate::server::events::AgentEvent {
                event_type: crate::server::events::AgentEventType::ReportSubmitted,
                agent_id: agent_id.to_string(),
                workspace_id: workspace_id.to_string(),
                data: serde_json::json!({
                    "taskId": task_id,
                    "summary": summary,
                    "success": success
                }),
                timestamp: chrono::Utc::now(),
            };
            state.event_bus.emit(event).await;

            tool_result_json(&serde_json::json!({
                "success": true,
                "taskId": task_id,
                "reported": true,
                "taskStatus": new_status.as_str()
            }))
        }
        "send_message_to_agent" => {
            let from_agent_id = args.get("fromAgentId").and_then(|v| v.as_str()).unwrap_or("");
            let to_agent_id = args.get("toAgentId").and_then(|v| v.as_str()).unwrap_or("");
            let message = args.get("message").and_then(|v| v.as_str()).unwrap_or("");

            // Store message in conversation
            let msg = crate::server::models::message::Message::new(
                uuid::Uuid::new_v4().to_string(),
                to_agent_id.to_string(),
                crate::server::models::message::MessageRole::User,
                message.to_string(),
                None, // tool_name
                None, // tool_args
                None, // turn
            );

            if let Err(e) = state.conversation_store.append(&msg).await {
                return tool_result_error(&format!("Failed to send message: {}", e));
            }

            // Emit message event
            let event = crate::server::events::AgentEvent {
                event_type: crate::server::events::AgentEventType::MessageSent,
                agent_id: from_agent_id.to_string(),
                workspace_id: workspace_id.to_string(),
                data: serde_json::json!({
                    "fromAgentId": from_agent_id,
                    "toAgentId": to_agent_id,
                    "messageId": msg.id
                }),
                timestamp: chrono::Utc::now(),
            };
            state.event_bus.emit(event).await;

            tool_result_json(&serde_json::json!({
                "success": true,
                "messageId": msg.id,
                "fromAgentId": from_agent_id,
                "toAgentId": to_agent_id
            }))
        }
        // ── Note tools ───────────────────────────────────────────────────
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
                note_id.clone(),
                title.to_string(),
                content.to_string(),
                workspace_id.to_string(),
                None,
            );
            match state.note_store.save(&note).await {
                Ok(_) => tool_result_json(&serde_json::json!({
                    "success": true,
                    "noteId": note_id,
                    "title": title
                })),
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
        "set_note_content" => {
            let note_id = args.get("noteId").and_then(|v| v.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            match state.note_store.get(note_id, workspace_id).await {
                Ok(Some(mut note)) => {
                    note.content = content.to_string();
                    note.updated_at = chrono::Utc::now();
                    match state.note_store.save(&note).await {
                        Ok(_) => tool_result_json(&serde_json::json!({
                            "success": true,
                            "noteId": note_id
                        })),
                        Err(e) => tool_result_error(&e.to_string()),
                    }
                }
                Ok(None) => {
                    // Auto-create if spec note
                    if note_id == "spec" {
                        let note = crate::server::models::note::Note::new(
                            "spec".to_string(),
                            "Spec".to_string(),
                            content.to_string(),
                            workspace_id.to_string(),
                            Some(crate::server::models::note::NoteMetadata {
                                note_type: crate::server::models::note::NoteType::Spec,
                                ..Default::default()
                            }),
                        );
                        match state.note_store.save(&note).await {
                            Ok(_) => tool_result_json(&serde_json::json!({
                                "success": true,
                                "noteId": "spec",
                                "created": true
                            })),
                            Err(e) => tool_result_error(&e.to_string()),
                        }
                    } else {
                        tool_result_error(&format!("Note not found: {}", note_id))
                    }
                }
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "append_to_note" => {
            let note_id = args.get("noteId").and_then(|v| v.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            match state.note_store.get(note_id, workspace_id).await {
                Ok(Some(mut note)) => {
                    note.content = format!("{}\n{}", note.content, content);
                    note.updated_at = chrono::Utc::now();
                    match state.note_store.save(&note).await {
                        Ok(_) => tool_result_json(&serde_json::json!({
                            "success": true,
                            "noteId": note_id
                        })),
                        Err(e) => tool_result_error(&e.to_string()),
                    }
                }
                Ok(None) => tool_result_error(&format!("Note not found: {}", note_id)),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        // ── Workspace tools ──────────────────────────────────────────────
        "list_workspaces" => {
            match state.workspace_store.list().await {
                Ok(ws) => tool_result_text(&serde_json::to_string_pretty(&ws).unwrap_or_default()),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "get_workspace_info" => {
            match state.workspace_store.get(workspace_id).await {
                Ok(Some(ws)) => {
                    let agents = state.agent_store.list_by_workspace(workspace_id).await.unwrap_or_default();
                    let tasks = state.task_store.list_by_workspace(workspace_id).await.unwrap_or_default();
                    let notes = state.note_store.list_by_workspace(workspace_id).await.unwrap_or_default();
                    tool_result_json(&serde_json::json!({
                        "workspace": ws,
                        "agentCount": agents.len(),
                        "taskCount": tasks.len(),
                        "noteCount": notes.len(),
                        "agents": agents.iter().map(|a| serde_json::json!({
                            "id": a.id,
                            "name": a.name,
                            "role": a.role.as_str(),
                            "status": a.status.as_str()
                        })).collect::<Vec<_>>()
                    }))
                }
                Ok(None) => tool_result_error(&format!("Workspace not found: {}", workspace_id)),
                Err(e) => tool_result_error(&e.to_string()),
            }
        }
        "list_skills" => {
            let skills = state.skill_registry.list_skills();
            tool_result_text(&serde_json::to_string_pretty(&skills).unwrap_or_default())
        }
        "list_specialists" => {
            // Return specialist configurations matching Next.js
            tool_result_json(&serde_json::json!({
                "specialists": [
                    {
                        "role": "CRAFTER",
                        "description": "Implementation specialist - writes code, creates files, implements features",
                        "modelTiers": ["SMART", "BALANCED", "FAST"],
                        "defaultTier": "SMART"
                    },
                    {
                        "role": "GATE",
                        "description": "Verification specialist - reviews code, runs tests, validates implementations",
                        "modelTiers": ["SMART", "BALANCED"],
                        "defaultTier": "BALANCED"
                    },
                    {
                        "role": "DEVELOPER",
                        "description": "Solo developer - plans and implements independently",
                        "modelTiers": ["SMART", "BALANCED", "FAST"],
                        "defaultTier": "SMART"
                    }
                ]
            }))
        }
        // ── Event tools ──────────────────────────────────────────────────
        "subscribe_to_events" => {
            let agent_id = args.get("agentId").and_then(|v| v.as_str()).unwrap_or("");
            let agent_name = args.get("agentName").and_then(|v| v.as_str()).unwrap_or("");
            let event_types: Vec<crate::server::events::AgentEventType> = args
                .get("eventTypes")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .filter_map(|s| crate::server::events::AgentEventType::from_str(s))
                        .collect()
                })
                .unwrap_or_default();

            let subscription_id = uuid::Uuid::new_v4().to_string();
            let subscription = crate::server::events::EventSubscription {
                id: subscription_id.clone(),
                agent_id: agent_id.to_string(),
                agent_name: agent_name.to_string(),
                event_types,
                exclude_self: true,
                one_shot: false,
                wait_group_id: None,
                priority: 0,
            };
            state.event_bus.subscribe(subscription).await;

            tool_result_json(&serde_json::json!({
                "success": true,
                "subscriptionId": subscription_id
            }))
        }
        "unsubscribe_from_events" => {
            let subscription_id = args.get("subscriptionId").and_then(|v| v.as_str()).unwrap_or("");
            state.event_bus.unsubscribe(subscription_id).await;
            tool_result_json(&serde_json::json!({
                "success": true,
                "subscriptionId": subscription_id
            }))
        }
        _ => tool_result_error(&format!("Unknown tool: {}", name)),
    }
}

fn tool_result_text(text: &str) -> serde_json::Value {
    serde_json::json!({
        "content": [{ "type": "text", "text": text }]
    })
}

fn tool_result_json(value: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "content": [{ "type": "text", "text": serde_json::to_string_pretty(value).unwrap_or_default() }]
    })
}

fn tool_result_error(msg: &str) -> serde_json::Value {
    serde_json::json!({
        "isError": true,
        "content": [{ "type": "text", "text": msg }]
    })
}
