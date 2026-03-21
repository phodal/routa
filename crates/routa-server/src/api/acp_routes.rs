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
use std::sync::Arc;
use tokio_stream::StreamExt as _;

use crate::acp;
use crate::error::ServerError;
use crate::state::AppState;
use routa_core::acp::SessionLaunchOptions;
use routa_core::models::agent::{Agent, AgentRole};
use routa_core::orchestration::{OrchestratorConfig, RoutaOrchestrator, SpecialistConfig};
use routa_core::storage::{LocalSessionProvider, SessionRecord};

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(acp_sse).post(acp_rpc))
}

/// Type alias for the SSE stream used in ACP responses.
type AcpSseStream =
    std::pin::Pin<Box<dyn tokio_stream::Stream<Item = Result<Event, Infallible>> + Send>>;

/// Response type that can be either JSON or SSE stream.
enum AcpResponse {
    Json(Json<serde_json::Value>),
    Sse(Sse<AcpSseStream>),
}

fn build_coordinator_context_prompt(
    agent_id: &str,
    workspace_id: &str,
    user_request: &str,
) -> String {
    format!(
        "**Your Agent ID:** {}\n**Workspace ID:** {}\n\n## User Request\n\n{}\n",
        agent_id, workspace_id, user_request
    )
}

async fn ensure_routa_agent_registration(
    state: &AppState,
    session_id: &str,
    workspace_id: &str,
    role: Option<&str>,
    specialist_id: Option<&str>,
    existing_routa_agent_id: Option<&str>,
) -> Result<Option<String>, String> {
    if role != Some("ROUTA") {
        return Ok(existing_routa_agent_id.map(|value| value.to_string()));
    }

    if workspace_id == "default" {
        state
            .workspace_store
            .ensure_default()
            .await
            .map_err(|error| error.to_string())?;
    }

    let mut routa_agent_id = existing_routa_agent_id.map(|value| value.to_string());

    if let Some(existing_id) = routa_agent_id.as_deref() {
        let existing_agent = state
            .agent_store
            .get(existing_id)
            .await
            .map_err(|error| error.to_string())?;
        if existing_agent.is_none() {
            routa_agent_id = None;
        }
    }

    if routa_agent_id.is_none() {
        let name_prefix = if specialist_id == Some("team-agent-lead") {
            "team-lead"
        } else {
            "routa-coordinator"
        };
        let agent = Agent::new(
            uuid::Uuid::new_v4().to_string(),
            format!("{}-{}", name_prefix, &session_id[..session_id.len().min(8)]),
            AgentRole::Routa,
            workspace_id.to_string(),
            None,
            None,
            None,
        );
        state
            .agent_store
            .save(&agent)
            .await
            .map_err(|error| error.to_string())?;
        routa_agent_id = Some(agent.id);
    }

    let acp = Arc::new(state.acp_manager.clone());
    let orchestrator = RoutaOrchestrator::new(
        OrchestratorConfig::default(),
        acp,
        state.agent_store.clone(),
        state.task_store.clone(),
        state.event_bus.clone(),
    );
    let routa_agent_id = routa_agent_id.expect("routa agent id must exist for ROUTA session");
    orchestrator
        .register_agent_session(&routa_agent_id, session_id)
        .await;
    let _ = state
        .acp_manager
        .set_routa_agent_id(session_id, &routa_agent_id)
        .await;
    state
        .acp_session_store
        .set_routa_agent_id(session_id, Some(&routa_agent_id))
        .await
        .map_err(|error| error.to_string())?;

    Ok(Some(routa_agent_id))
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
    let method = body.get("method").and_then(|m| m.as_str()).unwrap_or("");
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

            if let Ok(response) =
                reqwest::get("https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json")
                    .await
            {
                if let Ok(registry) = response.json::<serde_json::Value>().await {
                    if let Some(agents) = registry.get("agents").and_then(|a| a.as_array()) {
                        for agent in agents {
                            let agent_id = agent.get("id").and_then(|v| v.as_str()).unwrap_or("");
                            if agent_id.is_empty() {
                                continue;
                            }

                            let name = agent
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or(agent_id);
                            let desc = agent
                                .get("description")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let dist = agent.get("distribution");

                            let (command, status) = if let Some(dist) = dist {
                                if dist.get("npx").is_some() && npx_available {
                                    let pkg = dist
                                        .get("npx")
                                        .and_then(|v| v.get("package"))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or(agent_id);
                                    (format!("npx {}", pkg), "available")
                                } else if dist.get("uvx").is_some() && uvx_available {
                                    let pkg = dist
                                        .get("uvx")
                                        .and_then(|v| v.get("package"))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or(agent_id);
                                    (format!("uvx {}", pkg), "available")
                                } else if dist.get("binary").is_some() {
                                    (agent_id.to_string(), "unavailable")
                                } else if dist.get("npx").is_some() {
                                    let pkg = dist
                                        .get("npx")
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
                                (
                                    format!("{}-registry", agent_id),
                                    format!("{} (Registry)", name),
                                )
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
            let specialist_id = params
                .get("specialistId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let specialist = specialist_id.as_deref().and_then(SpecialistConfig::resolve);
            let role = params
                .get("role")
                .and_then(|v| v.as_str())
                .map(|s| s.to_uppercase())
                .or_else(|| specialist.as_ref().map(|s| s.role.as_str().to_string()));
            let model = params
                .get("model")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let parent_session_id = params
                .get("parentSessionId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let tool_mode = params
                .get("toolMode")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let mcp_profile = params
                .get("mcpProfile")
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

            let launch_options = SessionLaunchOptions {
                specialist_id: specialist_id.clone(),
                specialist_system_prompt: specialist
                    .as_ref()
                    .and_then(build_specialist_system_prompt),
                allowed_native_tools: derive_allowed_native_tools(specialist_id.as_deref()),
            };

            // Spawn agent process, initialize protocol, create agent session
            match state
                .acp_manager
                .create_session_with_options(
                    session_id.clone(),
                    cwd.clone(),
                    workspace_id.clone(),
                    provider.clone(),
                    role.clone(),
                    model.clone(),
                    parent_session_id.clone(),
                    tool_mode.clone(),
                    mcp_profile.clone(),
                    launch_options,
                )
                .await
            {
                Ok((_our_sid, _agent_sid)) => {
                    // Assign worktree session now that creation succeeded
                    if let Some(ref wt_id) = validated_worktree_id {
                        if let Err(e) = state
                            .worktree_store
                            .assign_session(wt_id, Some(&session_id))
                            .await
                        {
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

                    let routa_agent_id = match ensure_routa_agent_registration(
                        &state,
                        &session_id,
                        &workspace_id,
                        role.as_deref(),
                        specialist_id.as_deref(),
                        None,
                    )
                    .await
                    {
                        Ok(agent_id) => agent_id,
                        Err(error) => {
                            tracing::error!(
                                "[ACP Route] Failed to register ROUTA agent for {}: {}",
                                session_id,
                                error
                            );
                            return Ok(AcpResponse::Json(Json(serde_json::json!({
                                "jsonrpc": "2.0",
                                "id": id,
                                "error": {
                                    "code": -32000,
                                    "message": format!("Failed to register ROUTA coordinator: {}", error)
                                }
                            }))));
                        }
                    };

                    // Also persist to local JSONL file for file-level persistence
                    persist_session_to_jsonl(
                        &session_id,
                        &cwd,
                        &workspace_id,
                        provider.as_deref(),
                        role.as_deref(),
                        parent_session_id.as_deref(),
                    )
                    .await;

                    Ok(AcpResponse::Json(Json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "sessionId": session_id,
                            "provider": provider.as_deref().unwrap_or("opencode"),
                            "role": role.as_deref().unwrap_or("CRAFTER"),
                            "routaAgentId": routa_agent_id,
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
            let mut prompt_text = prompt_blocks
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

            let mut persisted_session = state
                .acp_session_store
                .get(&session_id)
                .await
                .ok()
                .flatten();

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
                    .map(|value| value.to_string())
                    .or_else(|| {
                        persisted_session
                            .as_ref()
                            .map(|session| session.cwd.clone())
                    })
                    .unwrap_or_else(|| ".".to_string());
                let provider = params
                    .get("provider")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| {
                        persisted_session
                            .as_ref()
                            .and_then(|session| session.provider.clone())
                    });
                let specialist_id = params
                    .get("specialistId")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let specialist = specialist_id.as_deref().and_then(SpecialistConfig::resolve);
                let workspace_id = params
                    .get("workspaceId")
                    .and_then(|v| v.as_str())
                    .map(|value| value.to_string())
                    .or_else(|| {
                        persisted_session
                            .as_ref()
                            .map(|session| session.workspace_id.clone())
                    })
                    .unwrap_or_else(|| "default".to_string());
                let parent_session_id = persisted_session
                    .as_ref()
                    .and_then(|session| session.parent_session_id.clone());
                let tool_mode = params
                    .get("toolMode")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let mcp_profile = params
                    .get("mcpProfile")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let role = params
                    .get("role")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_uppercase())
                    .or_else(|| {
                        persisted_session
                            .as_ref()
                            .and_then(|session| session.role.clone())
                    })
                    .or_else(|| specialist.as_ref().map(|s| s.role.as_str().to_string()))
                    .or(Some("CRAFTER".to_string()));
                let launch_options = SessionLaunchOptions {
                    specialist_id: specialist_id.clone(),
                    specialist_system_prompt: specialist
                        .as_ref()
                        .and_then(build_specialist_system_prompt),
                    allowed_native_tools: derive_allowed_native_tools(specialist_id.as_deref()),
                };

                // Create the session
                match state
                    .acp_manager
                    .create_session_with_options(
                        session_id.clone(),
                        cwd.clone(),
                        workspace_id.clone(),
                        provider.clone(),
                        role.clone(),
                        None, // model
                        parent_session_id.clone(),
                        tool_mode,
                        mcp_profile,
                        launch_options,
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
                                parent_session_id.as_deref(),
                            )
                            .await
                        {
                            tracing::warn!(
                                "[ACP Route] Failed to persist auto-created session: {}",
                                e
                            );
                        }

                        // Also persist to local JSONL file
                        persist_session_to_jsonl(
                            &session_id,
                            &cwd,
                            &workspace_id,
                            provider.as_deref(),
                            role.as_deref(),
                            parent_session_id.as_deref(),
                        )
                        .await;

                        match ensure_routa_agent_registration(
                            &state,
                            &session_id,
                            &workspace_id,
                            role.as_deref(),
                            specialist_id.as_deref(),
                            persisted_session
                                .as_ref()
                                .and_then(|session| session.routa_agent_id.as_deref()),
                        )
                        .await
                        {
                            Ok(routa_agent_id) => {
                                if let Some(agent_id) = routa_agent_id {
                                    tracing::info!(
                                        "[ACP Route] Registered ROUTA coordinator {} for session {}",
                                        agent_id,
                                        session_id
                                    );
                                }
                            }
                            Err(error) => {
                                tracing::error!(
                                    "[ACP Route] Failed to register ROUTA coordinator for {}: {}",
                                    session_id,
                                    error
                                );
                                return Ok(AcpResponse::Json(Json(serde_json::json!({
                                    "jsonrpc": "2.0",
                                    "id": id,
                                    "error": {
                                        "code": -32000,
                                        "message": format!("Failed to register ROUTA coordinator: {}", error)
                                    }
                                }))));
                            }
                        }

                        persisted_session = state
                            .acp_session_store
                            .get(&session_id)
                            .await
                            .ok()
                            .flatten();
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

            let session_record = state.acp_manager.get_session(&session_id).await;
            if persisted_session.is_none() {
                persisted_session = state
                    .acp_session_store
                    .get(&session_id)
                    .await
                    .ok()
                    .flatten();
            }

            let session_role = session_record
                .as_ref()
                .and_then(|session| session.role.clone())
                .or_else(|| {
                    persisted_session
                        .as_ref()
                        .and_then(|session| session.role.clone())
                });
            let session_workspace_id = session_record
                .as_ref()
                .map(|session| session.workspace_id.clone())
                .or_else(|| {
                    persisted_session
                        .as_ref()
                        .map(|session| session.workspace_id.clone())
                })
                .unwrap_or_else(|| "default".to_string());
            let session_specialist_id = session_record
                .as_ref()
                .and_then(|session| session.specialist_id.clone());

            let routa_agent_id = match ensure_routa_agent_registration(
                &state,
                &session_id,
                &session_workspace_id,
                session_role.as_deref(),
                session_specialist_id.as_deref(),
                session_record
                    .as_ref()
                    .and_then(|session| session.routa_agent_id.as_deref())
                    .or_else(|| {
                        persisted_session
                            .as_ref()
                            .and_then(|session| session.routa_agent_id.as_deref())
                    }),
            )
            .await
            {
                Ok(agent_id) => agent_id,
                Err(error) => {
                    tracing::error!(
                        "[ACP Route] Failed to ensure ROUTA registration for {}: {}",
                        session_id,
                        error
                    );
                    return Ok(AcpResponse::Json(Json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": {
                            "code": -32000,
                            "message": format!("Failed to ensure ROUTA coordinator: {}", error)
                        }
                    }))));
                }
            };

            let first_prompt_sent = persisted_session
                .as_ref()
                .map(|row| row.first_prompt_sent)
                .unwrap_or(false);

            if !first_prompt_sent && session_role.as_deref() == Some("ROUTA") {
                if let Some(agent_id) = routa_agent_id.as_deref() {
                    prompt_text = build_coordinator_context_prompt(
                        agent_id,
                        &session_workspace_id,
                        &prompt_text,
                    );
                }
            }

            if let Some(session) = &session_record {
                if !first_prompt_sent {
                    if let Some(specialist_prompt) = &session.specialist_system_prompt {
                        if session.provider.as_deref() != Some("claude") {
                            prompt_text =
                                format!("{}\n\n---\n\n{}", specialist_prompt, prompt_text);
                        }
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
                    let _ = state
                        .acp_session_store
                        .set_first_prompt_sent(&session_id)
                        .await;
                    if let Some(history) = state.acp_manager.get_session_history(&session_id).await
                    {
                        let _ = state
                            .acp_session_store
                            .save_history(&session_id, &history)
                            .await;
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

fn build_specialist_system_prompt(specialist: &SpecialistConfig) -> Option<String> {
    if specialist.system_prompt.trim().is_empty() {
        return None;
    }

    if specialist.role_reminder.trim().is_empty() {
        return Some(specialist.system_prompt.clone());
    }

    Some(format!(
        "{}\n\n---\n**Reminder:** {}\n",
        specialist.system_prompt, specialist.role_reminder
    ))
}

fn derive_allowed_native_tools(specialist_id: Option<&str>) -> Option<Vec<String>> {
    if specialist_id == Some("team-agent-lead") {
        return Some(Vec::new());
    }

    None
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
    let stream: SseStream = if let Some(mut rx) = state.acp_manager.subscribe(&session_id).await {
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
