//! MCP Streamable HTTP API - /api/mcp
//!
//! POST   /api/mcp - JSON-RPC messages (initialize, tools/list, tools/call)
//! GET    /api/mcp - SSE stream for server-initiated messages
//! DELETE /api/mcp - Terminate an MCP session
//! OPTIONS /api/mcp - CORS preflight
//!
//! Implements the MCP Streamable HTTP protocol (2025-06-18).

mod tool_catalog;
mod tool_executor;

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

use crate::error::ServerError;
use crate::state::AppState;

/// In-memory session store for MCP sessions.
type McpSessions = Arc<RwLock<HashMap<String, McpSessionData>>>;

#[derive(Clone)]
struct McpSessionData {
    workspace_id: String,
    mcp_profile: Option<String>,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct McpRequestQuery {
    #[serde(rename = "wsId")]
    ws_id: Option<String>,
    mcp_profile: Option<String>,
}

pub fn router() -> Router<AppState> {
    let sessions: McpSessions = Arc::new(RwLock::new(HashMap::new()));

    Router::new().route(
        "/",
        get({
            let sessions = sessions.clone();
            move |headers, state| mcp_get(headers, state, sessions)
        })
        .post({
            let sessions = sessions.clone();
            move |headers, state, query, body| mcp_post(headers, state, query, body, sessions)
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
    Query(query): Query<McpRequestQuery>,
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
                    workspace_id: query.ws_id.unwrap_or_else(|| "default".to_string()),
                    mcp_profile: query.mcp_profile,
                },
            );

            response_headers.insert("mcp-session-id", new_session_id.parse().unwrap());

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
            let session_data = {
                let store = sessions.read().await;
                session_id.as_ref().and_then(|sid| store.get(sid).cloned())
            };
            let profile = session_data
                .as_ref()
                .and_then(|item| item.mcp_profile.as_deref());
            let tools = tool_catalog::build_tool_list_for_profile(profile);

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
            let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let mut arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or(serde_json::json!({}));
            let normalized_tool_name = normalize_tool_name_public(tool_name).to_string();
            let session_data = {
                let store = sessions.read().await;
                session_id.as_ref().and_then(|sid| store.get(sid).cloned())
            };

            if let Some(session) = session_data.as_ref() {
                if !tool_catalog::tool_allowed_for_profile(
                    &normalized_tool_name,
                    session.mcp_profile.as_deref(),
                ) {
                    return Ok((
                        response_headers,
                        Json(serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": {
                                "code": -32602,
                                "message": format!("Tool not allowed for MCP profile: {}", tool_name)
                            }
                        })),
                    ));
                }
                inject_workspace_id(&mut arguments, &session.workspace_id);
            }

            let result = execute_tool_public(&state, &normalized_tool_name, &arguments).await;

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

async fn mcp_get(
    headers: HeaderMap,
    State(_state): State<AppState>,
    sessions: McpSessions,
) -> Result<
    Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>,
    (axum::http::StatusCode, Json<serde_json::Value>),
> {
    let session_id = headers.get("mcp-session-id").and_then(|v| v.to_str().ok());

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
        Err(ServerError::BadRequest(
            "Missing Mcp-Session-Id header".into(),
        ))
    }
}

// ─── Public Tool Surface (used by mcp_tools module) ───────────────────

pub fn build_tool_list_public() -> Vec<serde_json::Value> {
    tool_catalog::build_tool_list_public()
}

pub async fn execute_tool_public(
    state: &AppState,
    name: &str,
    args: &serde_json::Value,
) -> serde_json::Value {
    tool_executor::execute_tool_public(state, name, args).await
}

pub fn normalize_tool_name_public(name: &str) -> &str {
    tool_executor::normalize_tool_name_public(name)
}

fn inject_workspace_id(args: &mut serde_json::Value, workspace_id: &str) {
    if !args.is_object() {
        *args = serde_json::json!({ "workspaceId": workspace_id });
        return;
    }

    if let Some(object) = args.as_object_mut() {
        object
            .entry("workspaceId".to_string())
            .or_insert_with(|| serde_json::json!(workspace_id));
    }
}

#[cfg(test)]
mod tests {
    use super::inject_workspace_id;

    #[test]
    fn inject_workspace_id_sets_for_non_object_args() {
        let mut args = serde_json::json!("not-an-object");
        inject_workspace_id(&mut args, "workspace-a");
        assert_eq!(args, serde_json::json!({ "workspaceId": "workspace-a" }));
    }

    #[test]
    fn inject_workspace_id_adds_when_missing() {
        let mut args = serde_json::json!({ "name": "demo" });
        inject_workspace_id(&mut args, "workspace-b");
        assert_eq!(
            args,
            serde_json::json!({ "name": "demo", "workspaceId": "workspace-b" })
        );
    }

    #[test]
    fn inject_workspace_id_preserves_existing_value() {
        let mut args = serde_json::json!({ "workspaceId": "existing", "name": "demo" });
        inject_workspace_id(&mut args, "workspace-new");
        assert_eq!(
            args,
            serde_json::json!({ "workspaceId": "existing", "name": "demo" })
        );
    }
}
