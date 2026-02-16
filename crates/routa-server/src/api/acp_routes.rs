use axum::{
    extract::{Query, State},
    response::sse::{Event, Sse},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use std::convert::Infallible;
use tokio_stream::StreamExt as _;

use crate::acp;
use crate::error::ServerError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(acp_sse).post(acp_rpc))
}

/// POST /api/acp — Handle ACP JSON-RPC requests.
/// Compatible with the Next.js frontend's acp-client.ts.
async fn acp_rpc(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let method = body
        .get("method")
        .and_then(|m| m.as_str())
        .unwrap_or("");
    let id = body.get("id").cloned().unwrap_or(serde_json::json!(null));
    let params = body.get("params").cloned().unwrap_or_default();

    match method {
        "initialize" => {
            let protocol_version = params
                .get("protocolVersion")
                .and_then(|v| v.as_u64())
                .unwrap_or(1);

            Ok(Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": protocol_version,
                    "agentCapabilities": { "loadSession": false },
                    "agentInfo": {
                        "name": "routa-acp",
                        "version": "0.1.0"
                    }
                }
            })))
        }

        "_providers/list" => {
            use crate::shell_env;

            let presets = acp::get_presets();

            let mut providers: Vec<serde_json::Value> = Vec::new();
            for preset in &presets {
                let installed = shell_env::which(&preset.command).is_some();

                providers.push(serde_json::json!({
                    "id": preset.name,
                    "name": preset.name,
                    "description": preset.description,
                    "command": preset.command,
                    "status": if installed { "available" } else { "unavailable" },
                }));
            }

            // Sort: available first
            providers.sort_by(|a, b| {
                let a_status = a.get("status").and_then(|v| v.as_str()).unwrap_or("");
                let b_status = b.get("status").and_then(|v| v.as_str()).unwrap_or("");
                if a_status == b_status {
                    let a_name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    let b_name = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    a_name.cmp(b_name)
                } else if a_status == "available" {
                    std::cmp::Ordering::Less
                } else {
                    std::cmp::Ordering::Greater
                }
            });

            Ok(Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "providers": providers }
            })))
        }

        "session/new" => {
            let cwd = params
                .get("cwd")
                .and_then(|v| v.as_str())
                .unwrap_or(".")
                .to_string();
            let provider = params
                .get("provider")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let role = params
                .get("role")
                .and_then(|v| v.as_str())
                .map(|s| s.to_uppercase());

            let session_id = uuid::Uuid::new_v4().to_string();

            tracing::info!(
                "[ACP Route] Creating session: provider={:?}, cwd={}, role={:?}",
                provider,
                cwd,
                role
            );

            // Spawn agent process, initialize protocol, create agent session
            match state
                .acp_manager
                .create_session(
                    session_id.clone(),
                    cwd,
                    "default".to_string(),
                    provider.clone(),
                )
                .await
            {
                Ok((_our_sid, _agent_sid)) => {
                    Ok(Json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "sessionId": session_id,
                            "provider": provider.as_deref().unwrap_or("opencode"),
                            "role": role.as_deref().unwrap_or("CRAFTER"),
                        }
                    })))
                }
                Err(e) => {
                    tracing::error!("[ACP Route] Failed to create session: {}", e);
                    Ok(Json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": {
                            "code": -32000,
                            "message": format!("Failed to create session: {}", e)
                        }
                    })))
                }
            }
        }

        "session/prompt" => {
            let session_id = params.get("sessionId").and_then(|v| v.as_str());

            let session_id = match session_id {
                Some(sid) => sid.to_string(),
                None => {
                    return Ok(Json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": { "code": -32602, "message": "Missing sessionId" }
                    })));
                }
            };

            // Extract prompt text from content blocks
            let prompt_blocks = params.get("prompt").and_then(|v| v.as_array());
            let prompt_text = prompt_blocks
                .map(|blocks| {
                    blocks
                        .iter()
                        .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
                        .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .unwrap_or_default();

            tracing::info!(
                "[ACP Route] session/prompt: session={}, prompt_len={}",
                session_id,
                prompt_text.len()
            );

            // Forward to the live agent process
            match state.acp_manager.prompt(&session_id, &prompt_text).await {
                Ok(result) => Ok(Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": result,
                }))),
                Err(e) => {
                    tracing::error!("[ACP Route] Prompt failed: {}", e);
                    Ok(Json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": {
                            "code": -32000,
                            "message": e
                        }
                    })))
                }
            }
        }

        "session/cancel" => {
            if let Some(sid) = params.get("sessionId").and_then(|v| v.as_str()) {
                state.acp_manager.cancel(sid).await;
            }
            Ok(Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "cancelled": true }
            })))
        }

        "session/load" => Ok(Json(serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32601,
                "message": "session/load not supported - create a new session instead"
            }
        }))),

        "session/set_mode" => {
            let _session_id = params.get("sessionId").and_then(|v| v.as_str());
            let _mode_id = params
                .get("modeId")
                .or_else(|| params.get("mode"))
                .and_then(|v| v.as_str());

            // Acknowledge (mode switching stub)
            Ok(Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {}
            })))
        }

        _ if method.starts_with('_') => Ok(Json(serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32601,
                "message": format!("Extension method not supported: {}", method)
            }
        }))),

        _ => Ok(Json(serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32601,
                "message": format!("Method not found: {}", method)
            }
        }))),
    }
}

/// GET /api/acp?sessionId=xxx — SSE stream for session/update notifications.
///
/// Subscribes to the agent process's broadcast channel so the frontend
/// receives real-time `session/update` events (thought chunks, tool calls, etc.).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AcpSseQuery {
    session_id: Option<String>,
}

async fn acp_sse(
    State(state): State<AppState>,
    Query(query): Query<AcpSseQuery>,
) -> Sse<std::pin::Pin<Box<dyn tokio_stream::Stream<Item = Result<Event, Infallible>> + Send>>> {
    let session_id = query.session_id.clone().unwrap_or_default();

    // Send initial connected event
    let connected_event = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": session_id,
            "update": {
                "sessionUpdate": "agent_thought_chunk",
                "content": { "type": "text", "text": "Connected to ACP session." }
            }
        }
    });

    let initial = tokio_stream::once(Ok::<_, Infallible>(
        Event::default().data(connected_event.to_string()),
    ));

    // Heartbeat (keep connection alive)
    let heartbeat = tokio_stream::wrappers::IntervalStream::new(tokio::time::interval(
        std::time::Duration::from_secs(15),
    ))
    .map(|_| Ok(Event::default().comment("heartbeat")));

    type SseStream =
        std::pin::Pin<Box<dyn tokio_stream::Stream<Item = Result<Event, Infallible>> + Send>>;

    // Subscribe to agent notifications for this session
    let stream: SseStream = if let Some(mut rx) =
        state.acp_manager.subscribe(&session_id).await
    {
        let notifications = async_stream::stream! {
            while let Ok(msg) = rx.recv().await {
                yield Ok::<_, Infallible>(
                    Event::default().data(msg.to_string())
                );
            }
        };
        // Merge initial + notifications + heartbeat
        Box::pin(initial.chain(tokio_stream::StreamExt::merge(notifications, heartbeat)))
    } else {
        // No process yet — just initial + heartbeat
        Box::pin(initial.chain(heartbeat))
    };

    Sse::new(stream)
}
