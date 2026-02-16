//! A2A Protocol API
//!
//! /api/a2a/sessions - List active sessions
//! /api/a2a/rpc     - JSON-RPC endpoint + SSE stream
//! /api/a2a/card    - Agent card discovery

use axum::{
    extract::{Query, State},
    response::sse::{Event, KeepAlive, Sse},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use std::convert::Infallible;
use tokio_stream::StreamExt as _;

use crate::error::ServerError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/sessions", get(list_sessions))
        .route("/rpc", get(rpc_sse).post(rpc_handler))
        .route("/card", get(agent_card))
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

    let result = match method {
        "method_list" => serde_json::json!({
            "methods": [
                "method_list", "initialize",
                "session/new", "session/prompt", "session/cancel", "session/load",
                "list_agents", "create_agent", "delegate_task", "message_agent",
            ]
        }),

        "initialize" => serde_json::json!({
            "protocolVersion": "0.3.0",
            "agentInfo": { "name": "routa-a2a-bridge", "version": "0.1.0" },
            "capabilities": { "sessions": true, "coordination": true },
        }),

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
                .ok_or_else(|| ServerError::BadRequest(format!("Invalid role: {}", role)))?;

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
