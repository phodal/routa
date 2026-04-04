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
use routa_core::acp::terminal_manager::TerminalManager;
use routa_core::acp::SessionLaunchOptions;
use routa_core::models::agent::{Agent, AgentRole};
use routa_core::orchestration::{OrchestratorConfig, RoutaOrchestrator, SpecialistConfig};
use routa_core::storage::{LocalSessionProvider, SessionRecord};
use routa_core::store::acp_session_store::{AcpSessionRow, CreateAcpSessionParams};

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(acp_sse).post(acp_rpc))
}

fn has_explicit_cwd(value: Option<&str>) -> bool {
    value
        .map(str::trim)
        .map(|cwd| !cwd.is_empty() && cwd != ".")
        .unwrap_or(false)
}

async fn resolve_session_cwd(
    state: &AppState,
    workspace_id: &str,
    requested_cwd: Option<&str>,
) -> String {
    if let Some(cwd) = requested_cwd.filter(|value| has_explicit_cwd(Some(value))) {
        return cwd.trim().to_string();
    }

    if let Ok(Some(codebase)) = state.codebase_store.get_default(workspace_id).await {
        if !codebase.repo_path.trim().is_empty() {
            return codebase.repo_path;
        }
    }

    if let Ok(codebases) = state.codebase_store.list_by_workspace(workspace_id).await {
        if let Some(codebase) = codebases
            .into_iter()
            .find(|codebase| !codebase.repo_path.trim().is_empty())
        {
            return codebase.repo_path;
        }
    }

    std::env::current_dir()
        .ok()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CustomProviderLaunch {
    command: String,
    args: Vec<String>,
}

fn extract_custom_provider_launch(
    params: &serde_json::Value,
) -> Result<Option<CustomProviderLaunch>, String> {
    let Some(raw_command) = params.get("customCommand") else {
        return Ok(None);
    };

    let command = raw_command
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "customCommand must be a non-empty string".to_string())?
        .to_string();

    let args = match params.get("customArgs") {
        None => Vec::new(),
        Some(value) => value
            .as_array()
            .ok_or_else(|| "customArgs must be an array of strings".to_string())?
            .iter()
            .map(|item| {
                item.as_str()
                    .map(|value| value.to_string())
                    .ok_or_else(|| "customArgs must be an array of strings".to_string())
            })
            .collect::<Result<Vec<_>, _>>()?,
    };

    Ok(Some(CustomProviderLaunch { command, args }))
}

fn custom_provider_launch_from_row(session: &AcpSessionRow) -> Option<CustomProviderLaunch> {
    let command = session
        .custom_command
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();

    Some(CustomProviderLaunch {
        command,
        args: session.custom_args.clone(),
    })
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
            let custom_provider_launch = match extract_custom_provider_launch(&params) {
                Ok(value) => value,
                Err(message) => {
                    return Ok(AcpResponse::Json(Json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": {
                            "code": -32602,
                            "message": message
                        }
                    }))));
                }
            };
            let requested_cwd = params
                .get("cwd")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let workspace_id = params
                .get("workspaceId")
                .and_then(|v| v.as_str())
                .unwrap_or("default")
                .to_string();
            let branch = params
                .get("branch")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
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

            let mut cwd =
                resolve_session_cwd(&state, &workspace_id, requested_cwd.as_deref()).await;
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
                specialist_system_prompt: params
                    .get("systemPrompt")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|prompt| !prompt.is_empty())
                    .map(str::to_string)
                    .or_else(|| specialist.as_ref().and_then(build_specialist_system_prompt)),
                allowed_native_tools: derive_allowed_native_tools(specialist_id.as_deref()),
                ..SessionLaunchOptions::default()
            };
            let persisted_custom_provider_launch = custom_provider_launch.clone();
            let effective_provider = provider
                .clone()
                .or_else(|| custom_provider_launch.as_ref().map(|custom| custom.command.clone()));

            // Spawn agent process, initialize protocol, create agent session
            let create_result = if let Some(custom) = custom_provider_launch {
                state
                    .acp_manager
                    .create_session_from_inline(
                        session_id.clone(),
                        cwd.clone(),
                        workspace_id.clone(),
                        effective_provider
                            .clone()
                            .unwrap_or_else(|| custom.command.clone()),
                        role.clone(),
                        model.clone(),
                        parent_session_id.clone(),
                        custom.command,
                        custom.args,
                        launch_options,
                    )
                    .await
            } else {
                state
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
            };

            match create_result {
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
                        .create(CreateAcpSessionParams {
                            id: &session_id,
                            cwd: &cwd,
                            branch: branch.as_deref(),
                            workspace_id: &workspace_id,
                            provider: effective_provider.as_deref(),
                            role: role.as_deref(),
                            custom_command: persisted_custom_provider_launch
                                .as_ref()
                                .map(|launch| launch.command.as_str()),
                            custom_args: persisted_custom_provider_launch
                                .as_ref()
                                .map(|launch| launch.args.as_slice()),
                            parent_session_id: parent_session_id.as_deref(),
                        })
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
                        branch.as_deref(),
                        &workspace_id,
                        effective_provider.as_deref(),
                        role.as_deref(),
                        persisted_custom_provider_launch
                            .as_ref()
                            .map(|launch| launch.command.as_str()),
                        persisted_custom_provider_launch
                            .as_ref()
                            .map(|launch| launch.args.as_slice()),
                        parent_session_id.as_deref(),
                    )
                    .await;

                    Ok(AcpResponse::Json(Json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "sessionId": session_id,
                            "provider": effective_provider.as_deref().unwrap_or("opencode"),
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
            let request_custom_provider_launch = match extract_custom_provider_launch(&params) {
                Ok(value) => value,
                Err(message) => {
                    return Ok(AcpResponse::Json(Json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": {
                            "code": -32602,
                            "message": message
                        }
                    }))));
                }
            };
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
                let custom_provider_launch = request_custom_provider_launch
                    .clone()
                    .or_else(|| persisted_session.as_ref().and_then(custom_provider_launch_from_row));
                let effective_provider = provider.clone().or_else(|| {
                    custom_provider_launch
                        .as_ref()
                        .map(|launch| launch.command.clone())
                });
                let launch_options = SessionLaunchOptions {
                    specialist_id: specialist_id.clone(),
                    specialist_system_prompt: params
                        .get("systemPrompt")
                        .and_then(|v| v.as_str())
                        .map(str::trim)
                        .filter(|prompt| !prompt.is_empty())
                        .map(str::to_string)
                        .or_else(|| specialist.as_ref().and_then(build_specialist_system_prompt)),
                    allowed_native_tools: derive_allowed_native_tools(specialist_id.as_deref()),
                    ..SessionLaunchOptions::default()
                };

                // Create the session
                let create_result = if let Some(custom) = custom_provider_launch.clone() {
                    state
                        .acp_manager
                        .create_session_from_inline(
                            session_id.clone(),
                            cwd.clone(),
                            workspace_id.clone(),
                            effective_provider
                                .clone()
                                .unwrap_or_else(|| custom.command.clone()),
                            role.clone(),
                            None, // model
                            parent_session_id.clone(),
                            custom.command,
                            custom.args,
                            launch_options,
                        )
                        .await
                } else {
                    state
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
                };

                match create_result {
                    Ok((_our_sid, agent_sid)) => {
                        tracing::info!(
                            "[ACP Route] Auto-created session: {} (provider: {:?}, agent session: {})",
                            session_id,
                            effective_provider.as_deref().unwrap_or("opencode"),
                            agent_sid
                        );
                        // Persist auto-created session to DB
                        if let Err(e) = state
                            .acp_session_store
                            .create(CreateAcpSessionParams {
                                id: &session_id,
                                cwd: &cwd,
                                branch: persisted_session
                                    .as_ref()
                                    .and_then(|session| session.branch.as_deref()),
                                workspace_id: &workspace_id,
                                provider: effective_provider.as_deref(),
                                role: role.as_deref(),
                                custom_command: custom_provider_launch
                                    .as_ref()
                                    .map(|launch| launch.command.as_str()),
                                custom_args: custom_provider_launch
                                    .as_ref()
                                    .map(|launch| launch.args.as_slice()),
                                parent_session_id: parent_session_id.as_deref(),
                            })
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
                            persisted_session
                                .as_ref()
                                .and_then(|session| session.branch.as_deref()),
                            &workspace_id,
                            effective_provider.as_deref(),
                            role.as_deref(),
                            custom_provider_launch
                                .as_ref()
                                .map(|launch| launch.command.as_str()),
                            custom_provider_launch
                                .as_ref()
                                .map(|launch| launch.args.as_slice()),
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
                                    let rewritten = match msg.get("params").cloned() {
                                        Some(params) => serde_json::json!({
                                            "jsonrpc": "2.0",
                                            "method": "session/update",
                                            "params": routa_core::acp::AcpManager::rewrite_notification_session_id(&session_id_clone, params),
                                        }),
                                        None => msg.clone(),
                                    };
                                    // Check if this is turn_complete
                                    let is_turn_complete = rewritten
                                        .get("params")
                                        .and_then(|p| p.get("update"))
                                        .and_then(|u| u.get("sessionUpdate"))
                                        .and_then(|s| s.as_str())
                                        == Some("turn_complete");

                                    yield Ok::<_, Infallible>(
                                        Event::default().data(rewritten.to_string())
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
                let should_emit_turn_complete = state.acp_manager.is_claude_session(sid).await;
                state.acp_manager.cancel(sid).await;
                if should_emit_turn_complete {
                    let _ = state
                        .acp_manager
                        .emit_session_update(
                            sid,
                            serde_json::json!({
                                "sessionUpdate": "turn_complete",
                                "stopReason": "cancelled"
                            }),
                        )
                        .await;
                }
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

        "session/respond_user_input" => {
            let session_id = params.get("sessionId").and_then(|v| v.as_str());
            let tool_call_id = params.get("toolCallId").and_then(|v| v.as_str());
            let response = params.get("response");

            if session_id.is_none() || tool_call_id.is_none() || response.is_none() {
                return Ok(AcpResponse::Json(Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": -32602,
                        "message": "Missing sessionId, toolCallId, or response"
                    }
                }))));
            }

            let session_id = session_id.unwrap_or_default();
            let session_exists = state.acp_manager.get_session(session_id).await.is_some()
                || state
                    .acp_session_store
                    .get(session_id)
                    .await
                    .ok()
                    .flatten()
                    .is_some();
            if !session_exists {
                return Ok(AcpResponse::Json(Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": -32000,
                        "message": format!("Session not found: {}", session_id)
                    }
                }))));
            }

            Ok(AcpResponse::Json(Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32000,
                    "message": "No pending AskUserQuestion request found for this session"
                }
            }))))
        }

        "terminal/write" => {
            let session_id = params.get("sessionId").and_then(|v| v.as_str());
            let terminal_id = params.get("terminalId").and_then(|v| v.as_str());
            let data = params.get("data").and_then(|v| v.as_str());

            if session_id.is_none() || terminal_id.is_none() || data.is_none() {
                return Ok(AcpResponse::Json(Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": -32602,
                        "message": "Missing sessionId, terminalId, or data"
                    }
                }))));
            }

            let session_id = session_id.unwrap_or_default();
            let terminal_id = terminal_id.unwrap_or_default();
            if !TerminalManager::global()
                .has_terminal(session_id, terminal_id)
                .await
            {
                return Ok(AcpResponse::Json(Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": -32000,
                        "message": "Terminal not found for this session"
                    }
                }))));
            }
            if let Err(error) = TerminalManager::global()
                .write(terminal_id, data.unwrap_or(""))
                .await
            {
                return Ok(AcpResponse::Json(Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": -32000,
                        "message": error
                    }
                }))));
            }

            Ok(AcpResponse::Json(Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "ok": true }
            }))))
        }

        "terminal/resize" => {
            let session_id = params.get("sessionId").and_then(|v| v.as_str());
            let terminal_id = params.get("terminalId").and_then(|v| v.as_str());

            if session_id.is_none() || terminal_id.is_none() {
                return Ok(AcpResponse::Json(Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": -32602,
                        "message": "Missing sessionId or terminalId"
                    }
                }))));
            }

            let session_id = session_id.unwrap_or_default();
            let terminal_id = terminal_id.unwrap_or_default();
            if !TerminalManager::global()
                .has_terminal(session_id, terminal_id)
                .await
            {
                return Ok(AcpResponse::Json(Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": -32000,
                        "message": "Terminal not found for this session"
                    }
                }))));
            }
            let cols = params
                .get("cols")
                .and_then(|v| v.as_u64())
                .map(|v| v as u16);
            let rows = params
                .get("rows")
                .and_then(|v| v.as_u64())
                .map(|v| v as u16);
            if let Err(error) = TerminalManager::global()
                .resize(terminal_id, cols, rows)
                .await
            {
                return Ok(AcpResponse::Json(Json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": -32000,
                        "message": error
                    }
                }))));
            }

            Ok(AcpResponse::Json(Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "ok": true }
            }))))
        }

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
    branch: Option<&str>,
    workspace_id: &str,
    provider: Option<&str>,
    role: Option<&str>,
    custom_command: Option<&str>,
    custom_args: Option<&[String]>,
    parent_session_id: Option<&str>,
) {
    let now = chrono::Utc::now().to_rfc3339();
    let record = SessionRecord {
        id: session_id.to_string(),
        name: None,
        cwd: cwd.to_string(),
        branch: branch.map(|value| value.to_string()),
        workspace_id: workspace_id.to_string(),
        routa_agent_id: None,
        provider: provider.map(|s| s.to_string()),
        role: role.map(|s| s.to_string()),
        mode_id: None,
        model: None,
        custom_command: custom_command.map(|value| value.to_string()),
        custom_args: custom_args.unwrap_or(&[]).to_vec(),
        parent_session_id: parent_session_id.map(|s| s.to_string()),
        created_at: now.clone(),
        updated_at: now,
    };
    let local = LocalSessionProvider::new(cwd);
    if let Err(e) = local.save(&record).await {
        tracing::warn!("[ACP Route] Failed to persist session to JSONL: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::{extract::State, Json};
    use routa_core::models::codebase::Codebase;
    use routa_core::store::acp_session_store::{AcpSessionRow, CreateAcpSessionParams};
    use routa_core::{db::Database, state::AppStateInner};
    use serde_json::json;
    use tokio::sync::broadcast;

    use super::{
        acp_rpc, custom_provider_launch_from_row, extract_custom_provider_launch,
        has_explicit_cwd, resolve_session_cwd, AcpResponse, CustomProviderLaunch,
    };
    use routa_core::acp::terminal_manager::TerminalManager;

    fn json_response_value(response: AcpResponse) -> serde_json::Value {
        match response {
            AcpResponse::Json(Json(value)) => value,
            AcpResponse::Sse(_) => panic!("expected JSON response"),
        }
    }

    #[test]
    fn explicit_cwd_rejects_empty_and_dot() {
        assert!(has_explicit_cwd(Some("/tmp/repo")));
        assert!(!has_explicit_cwd(None));
        assert!(!has_explicit_cwd(Some("")));
        assert!(!has_explicit_cwd(Some("   ")));
        assert!(!has_explicit_cwd(Some(".")));
    }

    #[test]
    fn custom_provider_launch_extracts_command_and_args() {
        let launch = extract_custom_provider_launch(&json!({
            "customCommand": "codex-acp2",
            "customArgs": ["--stdio", "--verbose"]
        }))
        .expect("custom provider should parse")
        .expect("custom provider should exist");

        assert_eq!(
            launch,
            CustomProviderLaunch {
                command: "codex-acp2".to_string(),
                args: vec!["--stdio".to_string(), "--verbose".to_string()],
            }
        );
    }

    #[test]
    fn custom_provider_launch_rejects_non_string_args() {
        let error = extract_custom_provider_launch(&json!({
            "customCommand": "codex-acp2",
            "customArgs": ["--stdio", 123]
        }))
        .expect_err("invalid custom args should fail");

        assert_eq!(error, "customArgs must be an array of strings");
    }

    #[test]
    fn custom_provider_launch_from_row_uses_persisted_inline_command() {
        let session = AcpSessionRow {
            id: "session-custom-provider".to_string(),
            name: None,
            cwd: "/tmp".to_string(),
            branch: Some("main".to_string()),
            workspace_id: "default".to_string(),
            routa_agent_id: None,
            provider: Some("custom-inline".to_string()),
            role: Some("CRAFTER".to_string()),
            mode_id: None,
            custom_command: Some("uvx".to_string()),
            custom_args: vec!["codex-acp".to_string(), "--stdio".to_string()],
            first_prompt_sent: false,
            message_history: Vec::new(),
            created_at: 1,
            updated_at: 1,
            parent_session_id: None,
        };

        let launch = custom_provider_launch_from_row(&session).expect("launch should exist");
        assert_eq!(launch.command, "uvx");
        assert_eq!(launch.args, vec!["codex-acp".to_string(), "--stdio".to_string()]);
    }

    #[tokio::test]
    async fn resolve_session_cwd_prefers_workspace_default_codebase_when_missing() {
        let db = Database::open_in_memory().expect("db should open");
        let state = Arc::new(AppStateInner::new(db));
        state
            .workspace_store
            .ensure_default()
            .await
            .expect("default workspace should exist");

        let codebase = Codebase::new(
            "cb-default".to_string(),
            "default".to_string(),
            "/Users/phodal/.routa/repos/phodal--routa".to_string(),
            Some("main".to_string()),
            Some("routa".to_string()),
            true,
            None,
            None,
        );
        state
            .codebase_store
            .save(&codebase)
            .await
            .expect("codebase should persist");

        let cwd = resolve_session_cwd(&state, "default", None).await;

        assert_eq!(cwd, "/Users/phodal/.routa/repos/phodal--routa");
    }

    #[tokio::test]
    async fn resolve_session_cwd_keeps_explicit_repo_path() {
        let db = Database::open_in_memory().expect("db should open");
        let state = Arc::new(AppStateInner::new(db));
        state
            .workspace_store
            .ensure_default()
            .await
            .expect("default workspace should exist");

        let cwd = resolve_session_cwd(&state, "default", Some("/tmp/explicit-repo")).await;

        assert_eq!(cwd, "/tmp/explicit-repo");
    }

    #[tokio::test]
    async fn session_respond_user_input_returns_explicit_no_pending_error() {
        let db = Database::open_in_memory().expect("db should open");
        let state = Arc::new(AppStateInner::new(db));
        state
            .workspace_store
            .ensure_default()
            .await
            .expect("default workspace should exist");
        state
            .acp_session_store
            .create(CreateAcpSessionParams {
                id: "session-respond-user-input",
                cwd: "/tmp",
                branch: Some("main"),
                workspace_id: "default",
                provider: Some("opencode"),
                role: Some("DEVELOPER"),
                custom_command: None,
                custom_args: None,
                parent_session_id: None,
            })
            .await
            .expect("session should persist");

        let response = acp_rpc(
            State(state),
            Json(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "session/respond_user_input",
                "params": {
                    "sessionId": "session-respond-user-input",
                    "toolCallId": "tool-1",
                    "response": { "answer": "yes" }
                }
            })),
        )
        .await
        .expect("request should succeed");

        let value = json_response_value(response);
        assert_eq!(
            value["error"]["message"].as_str(),
            Some("No pending AskUserQuestion request found for this session")
        );
    }

    #[tokio::test]
    async fn terminal_write_and_resize_use_real_terminal_manager() {
        let db = Database::open_in_memory().expect("db should open");
        let state = Arc::new(AppStateInner::new(db));
        state
            .workspace_store
            .ensure_default()
            .await
            .expect("default workspace should exist");
        let session_id = "session-terminal-route";
        state
            .acp_session_store
            .create(CreateAcpSessionParams {
                id: session_id,
                cwd: "/tmp",
                branch: Some("main"),
                workspace_id: "default",
                provider: Some("opencode"),
                role: Some("DEVELOPER"),
                custom_command: None,
                custom_args: None,
                parent_session_id: None,
            })
            .await
            .expect("session should persist");

        let (tx, _rx) = broadcast::channel(32);
        let created = TerminalManager::global()
            .create(
                &json!({
                    "command": if cfg!(windows) { "cmd" } else { "/bin/cat" },
                    "args": if cfg!(windows) { vec!["/c", "echo"] } else { vec![] },
                    "cwd": std::env::temp_dir().to_string_lossy().to_string(),
                    "cols": 80,
                    "rows": 24
                }),
                session_id,
                &tx,
            )
            .await
            .expect("terminal should create");
        let terminal_id = created["terminalId"]
            .as_str()
            .expect("terminal id")
            .to_string();

        let write_response = acp_rpc(
            State(state.clone()),
            Json(json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "terminal/write",
                "params": {
                    "sessionId": session_id,
                    "terminalId": terminal_id,
                    "data": "route terminal write\\n"
                }
            })),
        )
        .await
        .expect("write should succeed");

        let write_value = json_response_value(write_response);
        assert_eq!(write_value["result"]["ok"], json!(true));

        let resize_response = acp_rpc(
            State(state.clone()),
            Json(json!({
                "jsonrpc": "2.0",
                "id": 3,
                "method": "terminal/resize",
                "params": {
                    "sessionId": session_id,
                    "terminalId": terminal_id,
                    "cols": 120,
                    "rows": 40
                }
            })),
        )
        .await
        .expect("resize should succeed");

        let resize_value = json_response_value(resize_response);
        assert_eq!(resize_value["result"]["ok"], json!(true));

        TerminalManager::global()
            .kill(&terminal_id)
            .await
            .expect("terminal should kill");
        TerminalManager::global().release(&terminal_id).await;
    }
}
