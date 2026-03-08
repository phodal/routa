use axum::{
    extract::{Query, State},
    response::{
        sse::{Event, Sse},
        IntoResponse, Response,
    },
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use std::convert::Infallible;
use tokio_stream::StreamExt as _;

use crate::acp;
use crate::error::ServerError;
use crate::state::AppState;
use routa_core::storage::{LocalSessionProvider, SessionRecord};

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(acp_sse).post(acp_rpc))
}

/// Response type that can be either JSON or SSE stream.
enum AcpResponse {
    Json(Json<serde_json::Value>),
    Sse(Sse<std::pin::Pin<Box<dyn tokio_stream::Stream<Item = Result<Event, Infallible>> + Send>>>),
}

impl IntoResponse for AcpResponse {
    fn into_response(self) -> Response {
        match self {
            AcpResponse::Json(json) => json.into_response(),
            AcpResponse::Sse(sse) => sse.into_response(),
        }
    }
}

/// POST /api/acp — Handle ACP JSON-RPC requests.
/// Compatible with the Next.js frontend's acp-client.ts.
///
/// For Claude sessions, `session/prompt` returns an SSE stream so the frontend
/// receives real-time notifications as they're generated.
async fn acp_rpc(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<AcpResponse, ServerError> {
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

            Ok(AcpResponse::Json(Json(serde_json::json!({
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
            }))))
        }

        "_providers/list" => {
            use crate::shell_env;

            let presets = acp::get_presets();
            let mut static_ids = std::collections::HashSet::new();

            let mut providers: Vec<serde_json::Value> = Vec::new();
            for preset in &presets {
                let installed = shell_env::which(&preset.command).is_some();
                static_ids.insert(preset.name.clone());

                providers.push(serde_json::json!({
                    "id": preset.name,
                    "name": preset.name,
                    "description": preset.description,
                    "command": preset.command,
                    "status": if installed { "available" } else { "unavailable" },
                    "source": "static",
                }));
            }

            // Merge registry agents (including those that overlap with static presets)
            // For overlapping agents, use a different ID to allow both versions to coexist
            let npx_available = shell_env::which("npx").is_some();
            let uvx_available = shell_env::which("uv").is_some();

            if let Ok(response) = reqwest::get(
                "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json",
            ).await {
                if let Ok(registry) = response.json::<serde_json::Value>().await {
                    if let Some(agents) = registry.get("agents").and_then(|a| a.as_array()) {
                        for agent in agents {
                            let agent_id = agent.get("id").and_then(|v| v.as_str()).unwrap_or("");
                            if agent_id.is_empty() {
                                continue;
                            }

                            let name = agent.get("name").and_then(|v| v.as_str()).unwrap_or(agent_id);
                            let desc = agent.get("description").and_then(|v| v.as_str()).unwrap_or("");
                            let dist = agent.get("distribution");

                            let (command, status) = if let Some(dist) = dist {
                                if dist.get("npx").is_some() && npx_available {
                                    let pkg = dist.get("npx")
                                        .and_then(|v| v.get("package"))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or(agent_id);
                                    (format!("npx {}", pkg), "available")
                                } else if dist.get("uvx").is_some() && uvx_available {
                                    let pkg = dist.get("uvx")
                                        .and_then(|v| v.get("package"))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or(agent_id);
                                    (format!("uvx {}", pkg), "available")
                                } else if dist.get("binary").is_some() {
                                    (agent_id.to_string(), "unavailable")
                                } else if dist.get("npx").is_some() {
                                    let pkg = dist.get("npx")
                                        .and_then(|v| v.get("package"))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or(agent_id);
                                    (format!("npx {}", pkg), "unavailable")
                                } else {
                                    (agent_id.to_string(), "unavailable")
                                }
                            } else {
                                (agent_id.to_string(), "unavailable")
                            };

                            // If this agent ID conflicts with a built-in preset, use a suffixed ID
                            // to allow both versions to coexist in the UI
                            let (provider_id, provider_name) = if static_ids.contains(agent_id) {
                                (format!("{}-registry", agent_id), format!("{} (Registry)", name))
                            } else {
                                (agent_id.to_string(), name.to_string())
                            };

                            providers.push(serde_json::json!({
                                "id": provider_id,
                                "name": provider_name,
                                "description": desc,
                                "command": command,
                                "status": status,
                                "source": "registry",
                            }));
                        }
                    }
                }
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

            Ok(AcpResponse::Json(Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "providers": providers }
            }))))
        }

        "session/new" => {
            let mut cwd = params
                .get("cwd")
                .and_then(|v| v.as_str())
                .unwrap_or(".")
                .to_string();
            let workspace_id = params
                .get("workspaceId")
                .and_then(|v| v.as_str())
                .unwrap_or("default")
                .to_string();
            let provider = params
                .get("provider")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let role = params
                .get("role")
                .and_then(|v| v.as_str())
                .map(|s| s.to_uppercase());
            let model = params
                .get("model")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let parent_session_id = params
                .get("parentSessionId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let worktree_id = params
                .get("worktreeId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let session_id = uuid::Uuid::new_v4().to_string();

            // If worktreeId is provided, validate and override cwd with worktree path
            // Session assignment is deferred until create_session succeeds
            let mut validated_worktree_id: Option<String> = None;
            if let Some(ref wt_id) = worktree_id {
                match state.worktree_store.get(wt_id).await {
                    Ok(Some(wt)) if wt.status == "active" && wt.workspace_id == workspace_id => {
                        if wt.session_id.is_some() {
                            return Ok(AcpResponse::Json(Json(serde_json::json!({
                                "jsonrpc": "2.0",
                                "id": id,
                                "error": {
                                    "code": -32602,
                                    "message": "Worktree is already assigned to another session"
                                }
                            }))));
                        }
                        cwd = wt.worktree_path.clone();
                        validated_worktree_id = Some(wt_id.clone());
                    }
                    Ok(Some(_)) => {
                        return Ok(AcpResponse::Json(Json(serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": {
                                "code": -32602,
                                "message": "Worktree is not active or does not belong to this workspace"
                            }
                        }))));
                    }
                    _ => {
                        return Ok(AcpResponse::Json(Json(serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": {
                                "code": -32602,
                                "message": "Worktree not found"
                            }
                        }))));
                    }
                }
            }

            tracing::info!(
                "[ACP Route] Creating session: provider={:?}, cwd={}, role={:?}, parent={:?}",
                provider,
                cwd,
                role,
                parent_session_id
            );

            // Spawn agent process, initialize protocol, create agent session
            match state
                .acp_manager
                .create_session(
                    session_id.clone(),
                    cwd.clone(),
                    workspace_id.clone(),
                    provider.clone(),
                    role.clone(),
                    model.clone(),
                    parent_session_id.clone(),
                )
                .await
            {
                Ok((_our_sid, _agent_sid)) => {
                    // Assign worktree session now that creation succeeded
                    if let Some(ref wt_id) = validated_worktree_id {
                        if let Err(e) = state.worktree_store.assign_session(wt_id, Some(&session_id)).await {
                            tracing::warn!("[ACP Route] Failed to assign worktree session: {}", e);
                        }
                    }

                    // Persist the session to the database immediately so it survives restarts
                    if let Err(e) = state
                        .acp_session_store
                        .create(
                            &session_id,
                            &cwd,
                            &workspace_id,
                            provider.as_deref(),
                            role.as_deref(),
                            parent_session_id.as_deref(),
                        )
                        .await
                    {
                        tracing::warn!("[ACP Route] Failed to persist session to DB: {}", e);
                    } else {
                        tracing::info!("[ACP Route] Session {} persisted to DB", session_id);
                    }

                    // Also persist to local JSONL file for file-level persistence
                    persist_session_to_jsonl(&session_id, &cwd, &workspace_id, provider.as_deref(), role.as_deref(), parent_session_id.as_deref()).await;

                    Ok(AcpResponse::Json(Json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "sessionId": session_id,
                            "provider": provider.as_deref().unwrap_or("opencode"),
                            "role": role.as_deref().unwrap_or("CRAFTER"),
                        }
                    }))))
                }
                Err(e) => {
                    tracing::error!("[ACP Route] Failed to create session: {}", e);
                    Ok(AcpResponse::Json(Json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": {
                            "code": -32000,
                            "message": format!("Failed to create session: {}", e)
                        }
                    }))))
                }
            }
        }

        "session/prompt" => {
            let session_id = params.get("sessionId").and_then(|v| v.as_str());

            let session_id = match session_id {
                Some(sid) => sid.to_string(),
                None => {
                    return Ok(AcpResponse::Json(Json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": { "code": -32602, "message": "Missing sessionId" }
                    }))));
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

            // ── Auto-create session if it doesn't exist ────────────────────────
            // Check if session exists
            let session_exists = state.acp_manager.get_session(&session_id).await.is_some();

            if !session_exists {
                tracing::info!(
                    "[ACP Route] Session {} not found, auto-creating with default settings...",
                    session_id
                );

                // Use default settings for auto-created session
                let cwd = params
                    .get("cwd")
                    .and_then(|v| v.as_str())
                    .unwrap_or(".")
                    .to_string();
                let provider = params
                    .get("provider")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let workspace_id = params
                    .get("workspaceId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("default")
                    .to_string();
                let role = Some("CRAFTER".to_string()); // Default role for auto-created sessions

                // Create the session
                match state
                    .acp_manager
                    .create_session(
                        session_id.clone(),
                        cwd.clone(),
                        workspace_id.clone(),
                        provider.clone(),
                        role.clone(),
                        None, // model
                        None, // parent_session_id
                    )
                    .await
                {
                    Ok((_our_sid, agent_sid)) => {
                        tracing::info!(
                            "[ACP Route] Auto-created session: {} (provider: {:?}, agent session: {})",
                            session_id,
                            provider.as_deref().unwrap_or("opencode"),
                            agent_sid
                        );
                        // Persist auto-created session to DB
                        if let Err(e) = state
                            .acp_session_store
                            .create(
                                &session_id,
                                &cwd,
                                &workspace_id,
                                provider.as_deref(),
                                role.as_deref(),
                                None,
                            )
                            .await
                        {
                            tracing::warn!("[ACP Route] Failed to persist auto-created session: {}", e);
                        }

                        // Also persist to local JSONL file
                        persist_session_to_jsonl(&session_id, &cwd, &workspace_id, provider.as_deref(), role.as_deref(), None).await;
                    }
                    Err(e) => {
                        tracing::error!("[ACP Route] Failed to auto-create session: {}", e);
                        return Ok(AcpResponse::Json(Json(serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": {
                                "code": -32000,
                                "message": format!("Failed to auto-create session: {}", e)
                            }
                        }))));
                    }
                }
            }

            // Check if this is a Claude session - if so, return SSE stream
            let is_claude = state.acp_manager.is_claude_session(&session_id).await;

            if is_claude {
                // For Claude, return SSE stream so frontend receives real-time notifications
                tracing::info!(
                    "[ACP Route] Claude session detected, returning SSE stream for prompt"
                );

                // Subscribe to notifications before starting the prompt
                let rx = state.acp_manager.subscribe(&session_id).await;

                // Start the prompt asynchronously
                if let Err(e) = state
                    .acp_manager
                    .prompt_claude_async(&session_id, &prompt_text)
                    .await
                {
                    tracing::error!("[ACP Route] Failed to start Claude prompt: {}", e);
                    return Ok(AcpResponse::Json(Json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": {
                            "code": -32000,
                            "message": e
                        }
                    }))));
                }

                // Return SSE stream
                type SseStream = std::pin::Pin<
                    Box<dyn tokio_stream::Stream<Item = Result<Event, Infallible>> + Send>,
                >;

                let stream: SseStream = if let Some(mut rx) = rx {
                    let session_id_clone = session_id.clone();
                    let state_clone = state.clone();
                    Box::pin(async_stream::stream! {
                        // Stream notifications until turn_complete or disconnect
                        loop {
                            match rx.recv().await {
                                Ok(msg) => {
                                    // Check if this is turn_complete
                                    let is_turn_complete = msg
                                        .get("params")
                                        .and_then(|p| p.get("update"))
                                        .and_then(|u| u.get("sessionUpdate"))
                                        .and_then(|s| s.as_str())
                                        == Some("turn_complete");

                                    yield Ok::<_, Infallible>(
                                        Event::default().data(msg.to_string())
                                    );

                                    if is_turn_complete {
                                        tracing::info!(
                                            "[ACP Route] Claude prompt complete for session {}",
                                            session_id_clone
                                        );
                                        break;
                                    }
                                }
                                Err(e) => {
                                    tracing::warn!(
                                        "[ACP Route] SSE stream error for session {}: {}",
                                        session_id_clone,
                                        e
                                    );
                                    break;
                                }
                            }
                        }
                        // Persist history and mark first_prompt_sent after turn completes
                        let _ = state_clone.acp_session_store.set_first_prompt_sent(&session_id_clone).await;
                        if let Some(history) = state_clone.acp_manager.get_session_history(&session_id_clone).await {
                            let _ = state_clone.acp_session_store.save_history(&session_id_clone, &history).await;
                        }
                    })
                } else {
                    // No broadcast channel - return empty stream with error
                    Box::pin(tokio_stream::once(Ok::<_, Infallible>(
                        Event::default().data(
                            serde_json::json!({
                                "jsonrpc": "2.0",
                                "method": "session/update",
                                "params": {
                                    "sessionId": session_id,
                                    "update": {
                                        "sessionUpdate": "turn_complete",
                                        "stopReason": "error"
                                    }
                                }
                            })
                            .to_string(),
                        ),
                    )))
                };

                return Ok(AcpResponse::Sse(Sse::new(stream)));
            }

            // For ACP providers, use the traditional JSON response
            match state.acp_manager.prompt(&session_id, &prompt_text).await {
                Ok(result) => {
                    // Persist history and mark first_prompt_sent after turn completes
                    let _ = state.acp_session_store.set_first_prompt_sent(&session_id).await;
                    if let Some(history) = state.acp_manager.get_session_history(&session_id).await {
                        let _ = state.acp_session_store.save_history(&session_id, &history).await;
                    }
                    Ok(AcpResponse::Json(Json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": result,
                    }))))
                }
                Err(e) => {
                    tracing::error!("[ACP Route] Prompt failed: {}", e);
                    Ok(AcpResponse::Json(Json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": {
                            "code": -32000,
                            "message": e
                        }
                    }))))
                }
            }
        }

        "session/cancel" => {
            if let Some(sid) = params.get("sessionId").and_then(|v| v.as_str()) {
                state.acp_manager.cancel(sid).await;
            }
            Ok(AcpResponse::Json(Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "cancelled": true }
            }))))
        }

        "session/load" => Ok(AcpResponse::Json(Json(serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32601,
                "message": "session/load not supported - create a new session instead"
            }
        })))),

        "session/set_mode" => {
            let _session_id = params.get("sessionId").and_then(|v| v.as_str());
            let _mode_id = params
                .get("modeId")
                .or_else(|| params.get("mode"))
                .and_then(|v| v.as_str());

            // Acknowledge (mode switching stub)
            Ok(AcpResponse::Json(Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {}
            }))))
        }

        _ if method.starts_with('_') => Ok(AcpResponse::Json(Json(serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32601,
                "message": format!("Extension method not supported: {}", method)
            }
        })))),

        _ => Ok(AcpResponse::Json(Json(serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32601,
                "message": format!("Method not found: {}", method)
            }
        })))),
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
                "sessionUpdate": "acp_status",
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

/// Persist a session to local JSONL file (best-effort, non-blocking).
async fn persist_session_to_jsonl(
    session_id: &str,
    cwd: &str,
    workspace_id: &str,
    provider: Option<&str>,
    role: Option<&str>,
    parent_session_id: Option<&str>,
) {
    let now = chrono::Utc::now().to_rfc3339();
    let record = SessionRecord {
        id: session_id.to_string(),
        name: None,
        cwd: cwd.to_string(),
        branch: None,
        workspace_id: workspace_id.to_string(),
        routa_agent_id: None,
        provider: provider.map(|s| s.to_string()),
        role: role.map(|s| s.to_string()),
        mode_id: None,
        model: None,
        parent_session_id: parent_session_id.map(|s| s.to_string()),
        created_at: now.clone(),
        updated_at: now,
    };
    let local = LocalSessionProvider::new(cwd);
    if let Err(e) = local.save(&record).await {
        tracing::warn!("[ACP Route] Failed to persist session to JSONL: {}", e);
    }
}
