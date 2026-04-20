//! A2A Protocol API
//!
//! /api/a2a/sessions - List active sessions
//! /api/a2a/rpc     - JSON-RPC endpoint + SSE stream
//! /api/a2a/card    - Agent card discovery

use axum::{
    extract::{Path, Query, State},
    response::sse::{Event, KeepAlive, Sse},
    routing::get,
    Json, Router,
};
use chrono::Utc;
use routa_core::models::task::{Task, TaskStatus};
use serde::Deserialize;
use std::convert::Infallible;
use std::time::Duration;
use tokio_stream::StreamExt as _;

use crate::error::ServerError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/sessions", get(list_sessions))
        .route("/rpc", get(rpc_sse).post(rpc_handler))
        .route("/card", get(agent_card))
        .route("/message", axum::routing::post(send_message))
        .route("/tasks", get(list_tasks))
        .route("/tasks/{id}", get(get_task).post(update_task))
}

// ─── /api/a2a/sessions ────────────────────────────────────────────────

async fn list_sessions(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let sessions = state.acp_manager.list_sessions().await;

    let a2a_sessions: Vec<serde_json::Value> = sessions
        .iter()
        .map(|s| {
            serde_json::json!({
                "id": s.session_id,
                "agentName": format!("routa-{}-{}", s.provider.as_deref().unwrap_or("agent"), &s.session_id[..8.min(s.session_id.len())]),
                "provider": s.provider.as_deref().unwrap_or("unknown"),
                "status": "connected",
                "capabilities": [
                    "initialize", "method_list",
                    "session/new", "session/prompt", "session/cancel", "session/load",
                    "list_agents", "create_agent", "delegate_task", "message_agent"
                ],
                "rpcUrl": format!("/api/a2a/rpc?sessionId={}", s.session_id),
                "eventStreamUrl": format!("/api/a2a/rpc?sessionId={}", s.session_id),
                "createdAt": s.created_at,
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "sessions": a2a_sessions,
        "count": a2a_sessions.len(),
    })))
}

// ─── /api/a2a/card ────────────────────────────────────────────────────

async fn agent_card() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "name": "Routa Multi-Agent Coordinator",
        "description": "Multi-agent coordination platform with ACP and MCP support",
        "protocolVersion": "0.3.0",
        "version": "0.1.0",
        "url": "/api/a2a/rpc",
        "skills": [
            {
                "id": "coordination",
                "name": "Agent Coordination",
                "description": "Create, delegate tasks to, and coordinate multiple AI agents",
                "tags": ["coordination", "multi-agent", "orchestration"],
            },
            {
                "id": "acp-proxy",
                "name": "ACP Session Proxy",
                "description": "Proxy access to backend ACP agent sessions",
                "tags": ["acp", "session", "proxy"],
            }
        ],
        "capabilities": { "pushNotifications": true },
        "defaultInputModes": ["text"],
        "defaultOutputModes": ["text"],
        "additionalInterfaces": [{
            "url": "/api/a2a/rpc",
            "transport": "JSONRPC",
        }],
    }))
}

// ─── /api/a2a/rpc POST ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RpcQuery {
    session_id: Option<String>,
}

async fn rpc_handler(
    State(state): State<AppState>,
    Query(query): Query<RpcQuery>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let method = body.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let id = body.get("id").cloned().unwrap_or(serde_json::json!(null));
    let params = body.get("params").cloned().unwrap_or_default();

    let result =
        match method {
            "method_list" => serde_json::json!({
                "methods": [
                    "SendMessage", "GetTask", "ListTasks", "CancelTask",
                    "method_list", "initialize",
                    "session/new", "session/prompt", "session/cancel", "session/load",
                    "list_agents", "create_agent", "delegate_task", "message_agent",
                ]
            }),

            "initialize" => serde_json::json!({
                "protocolVersion": "0.3.0",
                "agentInfo": { "name": "routa-a2a-bridge", "version": "0.1.0" },
                "capabilities": { "sessions": true, "coordination": true, "tasks": true },
            }),

            "SendMessage" => {
                let workspace_id = params
                    .get("metadata")
                    .and_then(|value| value.get("workspaceId"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("default")
                    .to_string();
                let prompt = extract_a2a_prompt(&params)?;
                let task_id = uuid::Uuid::new_v4().to_string();
                let context_id = params
                    .get("message")
                    .and_then(|value| value.get("contextId"))
                    .and_then(|value| value.as_str())
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                let title = prompt
                    .lines()
                    .find(|line| !line.trim().is_empty())
                    .map(|line| truncate_text(line.trim(), 80))
                    .filter(|line| !line.is_empty())
                    .unwrap_or_else(|| "A2A task".to_string());

                let task = Task::new(
                    task_id.clone(),
                    title,
                    prompt,
                    workspace_id,
                    Some(context_id.clone()),
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                );
                state.task_store.save(&task).await?;

                let state_clone = state.clone();
                let task_id_clone = task_id.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    let _ = state_clone
                        .task_store
                        .update_status(&task_id_clone, &TaskStatus::Completed)
                        .await;
                });

                build_a2a_task_payload(&task, "submitted", Some(Utc::now().to_rfc3339()))
            }

            "GetTask" => {
                let task_id = params
                    .get("id")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| ServerError::BadRequest("Missing task id".into()))?;
                let task =
                    state.task_store.get(task_id).await?.ok_or_else(|| {
                        ServerError::NotFound(format!("Task {task_id} not found"))
                    })?;
                build_a2a_task_payload(
                    &task,
                    map_task_status_to_a2a_state(&task.status),
                    Some(task.updated_at.to_rfc3339()),
                )
            }

            "ListTasks" => {
                let workspace_id = params
                    .get("workspaceId")
                    .and_then(|value| value.as_str())
                    .unwrap_or("default");
                let tasks = state.task_store.list_by_workspace(workspace_id).await?;
                serde_json::json!({
                    "tasks": tasks
                        .iter()
                        .map(|task| {
                            build_a2a_task_payload(
                                task,
                                map_task_status_to_a2a_state(&task.status),
                                Some(task.updated_at.to_rfc3339()),
                            )["task"].clone()
                        })
                        .collect::<Vec<_>>()
                })
            }

            "CancelTask" => {
                let task_id = params
                    .get("id")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| ServerError::BadRequest("Missing task id".into()))?;
                state
                    .task_store
                    .update_status(task_id, &TaskStatus::Cancelled)
                    .await?;
                let task =
                    state.task_store.get(task_id).await?.ok_or_else(|| {
                        ServerError::NotFound(format!("Task {task_id} not found"))
                    })?;
                build_a2a_task_payload(&task, "canceled", Some(task.updated_at.to_rfc3339()))
            }

            "list_agents" => {
                let workspace_id = params
                    .get("workspaceId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("default");
                let agents = state.agent_store.list_by_workspace(workspace_id).await?;
                serde_json::json!({ "agents": agents })
            }

            "create_agent" => {
                let name = params
                    .get("name")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ServerError::BadRequest("Missing name".into()))?;
                let role = params
                    .get("role")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ServerError::BadRequest("Missing role".into()))?;
                let workspace_id = params
                    .get("workspaceId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("default");

                let agent_role = crate::models::agent::AgentRole::from_str(role)
                    .ok_or_else(|| ServerError::BadRequest(format!("Invalid role: {role}")))?;

                let agent = crate::models::agent::Agent::new(
                    uuid::Uuid::new_v4().to_string(),
                    name.to_string(),
                    agent_role,
                    workspace_id.to_string(),
                    None,
                    None,
                    None,
                );
                state.agent_store.save(&agent).await?;
                serde_json::json!({ "success": true, "agentId": agent.id })
            }

            "delegate_task" | "message_agent" => {
                // Acknowledge and return stub
                serde_json::json!({
                    "status": "forwarded",
                    "sessionId": query.session_id,
                    "method": method,
                    "message": "Request forwarded to backend session",
                })
            }

            _ => {
                return Ok(Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32601, "message": format!("Unknown method: {}", method) }
                })));
            }
        };

    Ok(Json(serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result,
    })))
}

// ─── /api/a2a/rpc GET (SSE) ──────────────────────────────────────────

async fn rpc_sse(
    Query(query): Query<RpcQuery>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, axum::http::StatusCode>
{
    let session_id = match query.session_id {
        Some(id) => id,
        None => return Err(axum::http::StatusCode::BAD_REQUEST),
    };

    let connected_event = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notification",
        "params": {
            "type": "connected",
            "sessionId": session_id,
            "message": "A2A event stream connected",
        }
    });

    let initial = tokio_stream::once(Ok::<_, Infallible>(
        Event::default().data(connected_event.to_string()),
    ));

    let heartbeat = tokio_stream::wrappers::IntervalStream::new(tokio::time::interval(
        std::time::Duration::from_secs(30),
    ))
    .map(|_| Ok(Event::default().comment("keep-alive")));

    let stream = initial.chain(heartbeat);

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

// ─── /api/a2a/message ────────────────────────────────────────────────

/// POST /api/a2a/message — Send a message via the A2A protocol
async fn send_message(Json(body): Json<serde_json::Value>) -> Json<serde_json::Value> {
    let method = body
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("sendMessage");

    let session_id = body
        .get("params")
        .and_then(|p| p.get("sessionId"))
        .and_then(|v| v.as_str())
        .unwrap_or("default");

    Json(serde_json::json!({
        "jsonrpc": "2.0",
        "id": body.get("id"),
        "result": {
            "status": "accepted",
            "method": method,
            "sessionId": session_id,
        }
    }))
}

// ─── /api/a2a/tasks ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TasksQuery {
    session_id: Option<String>,
    workspace_id: Option<String>,
}

/// GET /api/a2a/tasks — List A2A tasks (mapped from Routa tasks)
async fn list_tasks(
    State(state): State<AppState>,
    Query(q): Query<TasksQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let tasks = if let Some(session_id) = &q.session_id {
        state.task_store.list_by_session(session_id).await?
    } else {
        let ws = q.workspace_id.as_deref().unwrap_or("default");
        state.task_store.list_by_workspace(ws).await?
    };
    Ok(Json(serde_json::json!({ "tasks": tasks })))
}

/// GET /api/a2a/tasks/{id} — Get an A2A task by ID
async fn get_task(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    state
        .task_store
        .get(&id)
        .await?
        .map(|t| Json(serde_json::json!(t)))
        .ok_or_else(|| ServerError::NotFound(format!("Task {id} not found")))
}

/// POST /api/a2a/tasks/{id} — Update / respond to an A2A task
async fn update_task(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, ServerError> {
    if let Some(status) = body.get("status").and_then(|v| v.as_str()) {
        let task_status = crate::models::task::TaskStatus::from_str(status)
            .ok_or_else(|| ServerError::BadRequest(format!("Invalid status: {status}")))?;
        state.task_store.update_status(&id, &task_status).await?;
        Ok(Json(
            serde_json::json!({ "updated": true, "id": id, "status": status }),
        ))
    } else {
        Ok(Json(
            serde_json::json!({ "updated": false, "id": id, "message": "No status change requested" }),
        ))
    }
}

fn extract_a2a_prompt(params: &serde_json::Value) -> Result<String, ServerError> {
    let parts = params
        .get("message")
        .and_then(|value| value.get("parts"))
        .and_then(|value| value.as_array())
        .ok_or_else(|| ServerError::BadRequest("Missing message parts".into()))?;
    let prompt = parts
        .iter()
        .filter_map(|part| part.get("text").and_then(|value| value.as_str()))
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if prompt.is_empty() {
        return Err(ServerError::BadRequest(
            "A2A message must contain at least one text part".into(),
        ));
    }
    Ok(prompt)
}

fn truncate_text(text: &str, max_len: usize) -> String {
    if text.chars().count() <= max_len {
        return text.to_string();
    }
    text.chars().take(max_len).collect()
}

fn map_task_status_to_a2a_state(status: &TaskStatus) -> &'static str {
    match status {
        TaskStatus::Completed => "completed",
        TaskStatus::Cancelled => "canceled",
        TaskStatus::Blocked | TaskStatus::NeedsFix => "failed",
        TaskStatus::Pending => "submitted",
        TaskStatus::InProgress | TaskStatus::ReviewRequired => "working",
    }
}

fn build_a2a_task_payload(
    task: &Task,
    state: &str,
    timestamp: Option<String>,
) -> serde_json::Value {
    let timestamp = timestamp.unwrap_or_else(|| Utc::now().to_rfc3339());
    serde_json::json!({
        "task": {
            "id": task.id,
            "contextId": task.session_id,
            "status": {
                "state": state,
                "timestamp": timestamp,
            },
            "history": [{
                "messageId": format!("msg-{}", task.id),
                "role": "user",
                "parts": [{ "text": task.objective }],
                "contextId": task.session_id,
                "taskId": task.id,
            }],
            "artifacts": [],
            "metadata": {
                "workspaceId": task.workspace_id,
                "columnId": task.column_id,
            }
        }
    })
}
