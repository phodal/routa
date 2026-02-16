use axum::{
    extract::{Query, State},
    response::sse::{Event, KeepAlive, Sse},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use std::convert::Infallible;
use tokio_stream::StreamExt as _;

use crate::server::acp;
use crate::server::error::ServerError;
use crate::server::state::AppState;

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
            let presets = acp::get_presets();

            // Check which commands are installed
            let mut providers: Vec<serde_json::Value> = Vec::new();
            for preset in &presets {
                let cmd = preset.command.clone();
                let installed = tokio::task::spawn_blocking(move || {
                    std::process::Command::new("which")
                        .arg(&cmd)
                        .output()
                        .map(|o| o.status.success())
                        .unwrap_or(false)
                })
                .await
                .unwrap_or(false);

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
            let _mode_id = params
                .get("modeId")
                .or_else(|| params.get("mode"))
                .and_then(|v| v.as_str());
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

            let session = state
                .acp_manager
                .create_session(
                    session_id.clone(),
                    cwd,
                    "default".to_string(),
                    provider.clone(),
                )
                .await;

            Ok(Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "sessionId": session.session_id,
                    "provider": provider.as_deref().unwrap_or("opencode"),
                    "role": role.as_deref().unwrap_or("CRAFTER"),
                }
            })))
        }

        "session/prompt" => {
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str());

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

            let _session = state.acp_manager.get_session(&session_id).await;

            // Extract prompt text
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

            // Try to spawn and communicate with the agent process
            let provider = state
                .acp_manager
                .get_session(&session_id)
                .await
                .and_then(|s| s.provider.clone())
                .unwrap_or_else(|| "opencode".to_string());

            let preset = acp::get_presets()
                .into_iter()
                .find(|p| p.name == provider);

            match preset {
                Some(preset) => {
                    // Attempt to spawn and forward prompt
                    let result = spawn_and_prompt(
                        &preset.command,
                        &preset.args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
                        &prompt_text,
                    )
                    .await;

                    match result {
                        Ok(output) => Ok(Json(serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": {
                                "stopReason": "end_turn",
                                "output": output,
                            }
                        }))),
                        Err(e) => Ok(Json(serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": {
                                "code": -32000,
                                "message": format!("Agent process error: {}", e)
                            }
                        }))),
                    }
                }
                None => Ok(Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": -32000,
                        "message": format!("Unknown provider: {}", provider)
                    }
                }))),
            }
        }

        "session/cancel" => {
            if let Some(sid) = params.get("sessionId").and_then(|v| v.as_str()) {
                state.acp_manager.remove_session(sid).await;
            }
            Ok(Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "cancelled": true }
            })))
        }

        "session/load" => {
            Ok(Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32601,
                    "message": "session/load not supported - create a new session instead"
                }
            })))
        }

        "session/set_mode" => {
            let session_id = params.get("sessionId").and_then(|v| v.as_str());
            let mode_id = params
                .get("modeId")
                .or_else(|| params.get("mode"))
                .and_then(|v| v.as_str());

            if session_id.is_none() || mode_id.is_none() {
                return Ok(Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32602, "message": "Missing sessionId or modeId" }
                })));
            }

            Ok(Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {}
            })))
        }

        _ if method.starts_with('_') => {
            Ok(Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32601,
                    "message": format!("Extension method not supported: {}", method)
                }
            })))
        }

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

/// Attempt to spawn an ACP agent process and send a prompt via stdio JSON-RPC.
async fn spawn_and_prompt(
    command: &str,
    args: &[&str],
    prompt_text: &str,
) -> Result<String, String> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let mut child = tokio::process::Command::new(command)
        .args(args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn '{}': {}. Is it installed?", command, e))?;

    let mut stdin = child.stdin.take().ok_or("No stdin")?;
    let stdout = child.stdout.take().ok_or("No stdout")?;

    // Send initialize
    let init_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": 1,
            "clientInfo": { "name": "routa-desktop", "version": "0.1.0" }
        }
    });
    let init_line = format!("{}\n", serde_json::to_string(&init_req).unwrap());
    stdin
        .write_all(init_line.as_bytes())
        .await
        .map_err(|e| format!("Write init: {}", e))?;

    // Send session/new
    let new_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "session/new",
        "params": { "cwd": ".", "mcpServers": [] }
    });
    let new_line = format!("{}\n", serde_json::to_string(&new_req).unwrap());
    stdin
        .write_all(new_line.as_bytes())
        .await
        .map_err(|e| format!("Write session/new: {}", e))?;

    // Send session/prompt
    let prompt_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "session/prompt",
        "params": {
            "sessionId": "pending",
            "prompt": [{ "type": "text", "text": prompt_text }]
        }
    });
    let prompt_line = format!("{}\n", serde_json::to_string(&prompt_req).unwrap());
    stdin
        .write_all(prompt_line.as_bytes())
        .await
        .map_err(|e| format!("Write prompt: {}", e))?;

    // Read responses with timeout
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    let mut collected = Vec::new();
    let timeout = tokio::time::Duration::from_secs(300); // 5 min

    let result = tokio::time::timeout(timeout, async {
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&line) {
                // Check if this is the prompt response (id=3)
                if msg.get("id") == Some(&serde_json::json!(3)) {
                    if let Some(result) = msg.get("result") {
                        collected.push(result.to_string());
                        break;
                    }
                    if let Some(error) = msg.get("error") {
                        return Err(format!(
                            "Agent error: {}",
                            error
                                .get("message")
                                .and_then(|m| m.as_str())
                                .unwrap_or("unknown")
                        ));
                    }
                }
            }
        }
        Ok(collected.join("\n"))
    })
    .await
    .map_err(|_| "Agent response timeout (5 min)".to_string())?;

    // Kill the process
    let _ = child.kill().await;

    result
}

/// GET /api/acp?sessionId=xxx — SSE stream for session updates.
/// Compatible with the Next.js frontend's acp-client.ts EventSource.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AcpSseQuery {
    session_id: Option<String>,
}

async fn acp_sse(
    Query(query): Query<AcpSseQuery>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let session_id = query.session_id.unwrap_or_default();

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

    let heartbeat = tokio_stream::wrappers::IntervalStream::new(tokio::time::interval(
        std::time::Duration::from_secs(15),
    ))
    .map(|_| Ok(Event::default().comment("heartbeat")));

    let stream = initial.chain(heartbeat);

    Sse::new(stream).keep_alive(KeepAlive::default())
}
