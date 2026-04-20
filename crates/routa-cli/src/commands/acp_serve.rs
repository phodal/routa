//! `routa acp` — Run Routa as an ACP (Agent Client Protocol) server.
//!
//! This makes Routa itself an ACP-compatible agent that other tools can
//! connect to via stdio JSON-RPC. Routa acts as a "renderer" — receiving
//! prompts and orchestrating multi-agent work internally.
//!
//! ACP Protocol (stdio JSON-RPC):
//!   Client → initialize       → capabilities exchange
//!   Client → session/new      → create a new coordination session
//!   Client → session/prompt   → send a requirement to the coordinator
//!   Server → session/update   → stream progress notifications
//!
//! This enables Routa to be used as an ACP provider by other agents,
//! implementing the Routa ACP protocol as a render target.

use std::sync::Arc;

use routa_core::models::agent::AgentRole;
use routa_core::orchestration::{OrchestratorConfig, RoutaOrchestrator, SpecialistConfig};
use routa_core::rpc::RpcRouter;
use routa_core::state::AppState;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

/// ACP server state for managing sessions.
struct AcpServerState {
    state: AppState,
    router: RpcRouter,
    /// Map: acp_session_id → (routa_session_id, agent_id, workspace_id)
    sessions: std::collections::HashMap<String, SessionRecord>,
    orchestrators: std::collections::HashMap<String, Arc<RoutaOrchestrator>>,
}

struct SessionRecord {
    routa_session_id: String,
    agent_id: String,
    workspace_id: String,
    cwd: String,
}

/// Run Routa as an ACP server over stdio.
pub async fn run(state: &AppState, workspace_id: &str, provider: &str) -> Result<(), String> {
    let mut server = AcpServerState {
        state: state.clone(),
        router: RpcRouter::new(state.clone()),
        sessions: std::collections::HashMap::new(),
        orchestrators: std::collections::HashMap::new(),
    };

    let stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let reader = BufReader::new(stdin);
    let mut lines = reader.lines();

    tracing::info!("[ACP Server] Routa ACP server started on stdio");

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        let msg: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                let err_resp = make_error_response(None, -32700, &format!("Parse error: {e}"));
                write_response(&mut stdout, &err_resp).await;
                continue;
            }
        };

        let id = msg.get("id").cloned();
        let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let params = msg
            .get("params")
            .cloned()
            .unwrap_or(Value::Object(Default::default()));

        let response = match method {
            "initialize" => handle_initialize(id.clone()),
            "session/new" => {
                handle_session_new(&mut server, id.clone(), &params, workspace_id, provider).await
            }
            "session/prompt" => {
                handle_session_prompt(&mut server, id.clone(), &params, &mut stdout).await
            }
            "session/cancel" => handle_session_cancel(&mut server, id.clone(), &params).await,
            "session/list" => handle_session_list(&server, id.clone()),
            _ => make_error_response(id.clone(), -32601, &format!("Method not found: {method}")),
        };

        write_response(&mut stdout, &response).await;
    }

    tracing::info!("[ACP Server] stdin closed, shutting down");
    Ok(())
}

/// Handle `initialize` — return server capabilities.
fn handle_initialize(id: Option<Value>) -> Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "protocolVersion": 1,
            "serverInfo": {
                "name": "routa",
                "version": env!("CARGO_PKG_VERSION"),
                "description": "Routa multi-agent coordination platform"
            },
            "capabilities": {
                "session": {
                    "new": true,
                    "prompt": true,
                    "cancel": true,
                    "list": true
                },
                "modes": [
                    {
                        "id": "coordinator",
                        "name": "Coordinator",
                        "description": "Full multi-agent coordination with task delegation"
                    },
                    {
                        "id": "developer",
                        "name": "Developer",
                        "description": "Solo agent mode — plans and implements directly"
                    }
                ]
            }
        }
    })
}

/// Handle `session/new` — create a workspace, coordinator agent, and ACP session.
async fn handle_session_new(
    server: &mut AcpServerState,
    id: Option<Value>,
    params: &Value,
    default_workspace_id: &str,
    default_provider: &str,
) -> Value {
    let cwd = params
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            std::env::current_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| ".".to_string())
        });

    let workspace_id = params
        .get("workspaceId")
        .and_then(|v| v.as_str())
        .unwrap_or(default_workspace_id);

    let provider = params
        .get("provider")
        .and_then(|v| v.as_str())
        .unwrap_or(default_provider);

    let mode = params
        .get("modeId")
        .and_then(|v| v.as_str())
        .unwrap_or("coordinator");

    let role = if mode == "developer" {
        "DEVELOPER"
    } else {
        "ROUTA"
    };

    // Create agent
    let agent_name = format!("acp-{}", role.to_lowercase());
    let create_resp = server
        .router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "agents.create",
            "params": {
                "name": agent_name,
                "role": role,
                "workspaceId": workspace_id
            }
        }))
        .await;

    let agent_id = match create_resp
        .get("result")
        .and_then(|r| r.get("agentId"))
        .and_then(|v| v.as_str())
    {
        Some(id_str) => id_str.to_string(),
        None => {
            return make_error_response(id.clone(), -32000, "Failed to create agent");
        }
    };

    // Create ACP session for the underlying provider
    let routa_session_id = uuid::Uuid::new_v4().to_string();

    let spawn_result = server
        .state
        .acp_manager
        .create_session(
            routa_session_id.clone(),
            cwd.clone(),
            workspace_id.to_string(),
            Some(provider.to_string()),
            Some(role.to_string()),
            None,
            None, // branch
            None, // tool_mode
            None, // mcp_profile
        )
        .await;

    if let Err(e) = spawn_result {
        return make_error_response(
            id.clone(),
            -32000,
            &format!("Failed to create ACP session: {e}"),
        );
    }

    // Register with orchestrator
    let acp = Arc::new(server.state.acp_manager.clone());
    let orchestrator = RoutaOrchestrator::new(
        OrchestratorConfig::default(),
        acp,
        server.state.agent_store.clone(),
        server.state.task_store.clone(),
        server.state.event_bus.clone(),
    );
    orchestrator
        .register_agent_session(&agent_id, &routa_session_id)
        .await;

    let acp_session_id = uuid::Uuid::new_v4().to_string();

    server.sessions.insert(
        acp_session_id.clone(),
        SessionRecord {
            routa_session_id: routa_session_id.clone(),
            agent_id: agent_id.clone(),
            workspace_id: workspace_id.to_string(),
            cwd,
        },
    );
    server
        .orchestrators
        .insert(acp_session_id.clone(), Arc::new(orchestrator));

    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "sessionId": acp_session_id,
            "agentId": agent_id,
            "workspaceId": workspace_id,
            "role": role,
            "provider": provider
        }
    })
}

/// Handle `session/prompt` — build coordinator prompt and send to the agent,
/// streaming session/update notifications back to the ACP client.
async fn handle_session_prompt(
    server: &mut AcpServerState,
    id: Option<Value>,
    params: &Value,
    _stdout: &mut tokio::io::Stdout,
) -> Value {
    let session_id = match params.get("sessionId").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => {
            return make_error_response(id.clone(), -32602, "Missing sessionId");
        }
    };

    let text = match params.get("text").and_then(|v| v.as_str()) {
        Some(t) => t.to_string(),
        None => {
            return make_error_response(id.clone(), -32602, "Missing text");
        }
    };

    let record = match server.sessions.get(&session_id) {
        Some(r) => r,
        None => {
            return make_error_response(
                id.clone(),
                -32000,
                &format!("Unknown session: {session_id}"),
            );
        }
    };

    // Build the coordinator prompt with specialist system prompt
    let role = AgentRole::from_str("ROUTA").unwrap_or(AgentRole::Routa);
    let specialist = SpecialistConfig::by_role(&role).unwrap_or_else(SpecialistConfig::crafter);

    let full_prompt = format!(
        "{}\n\n---\n\n\
         **Your Agent ID:** {}\n\
         **Workspace ID:** {}\n\n\
         ## User Request\n\n{}\n\n\
         ---\n**Reminder:** {}\n",
        specialist
            .system_prompt_body()
            .unwrap_or_else(|| specialist.system_prompt.clone()),
        record.agent_id,
        record.workspace_id,
        text,
        specialist.role_reminder
    );

    // Subscribe to updates before sending prompt
    let mut rx = match server
        .state
        .acp_manager
        .subscribe(&record.routa_session_id)
        .await
    {
        Some(rx) => rx,
        None => {
            return make_error_response(id.clone(), -32000, "Failed to subscribe to session");
        }
    };

    // Send prompt to the underlying ACP session
    if let Err(e) = server
        .state
        .acp_manager
        .prompt(&record.routa_session_id, &full_prompt)
        .await
    {
        return make_error_response(id.clone(), -32000, &format!("Failed to send prompt: {e}"));
    }

    // Stream updates as session/update notifications to the ACP client
    let acp_session_id = session_id.clone();
    let routa_session_id = record.routa_session_id.clone();
    let acp_manager = server.state.acp_manager.clone();

    // Spawn a background task to forward notifications
    let mut stdout_clone = tokio::io::stdout();
    tokio::spawn(async move {
        loop {
            match tokio::time::timeout(std::time::Duration::from_secs(1), rx.recv()).await {
                Ok(Ok(update)) => {
                    // Rewrite sessionId to the ACP session ID
                    let mut notification = update.clone();
                    if let Some(params) = notification.get_mut("params") {
                        if params.get("sessionId").is_some() {
                            params["sessionId"] = Value::String(acp_session_id.clone());
                        }
                    }
                    write_response(&mut stdout_clone, &notification).await;
                }
                Ok(Err(_)) => {
                    // Channel closed
                    break;
                }
                Err(_) => {
                    // Timeout — check if still alive
                    if !acp_manager.is_alive(&routa_session_id).await {
                        break;
                    }
                }
            }
        }
    });

    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "sessionId": session_id,
            "status": "streaming"
        }
    })
}

/// Handle `session/cancel` — cancel the running session.
async fn handle_session_cancel(
    server: &mut AcpServerState,
    id: Option<Value>,
    params: &Value,
) -> Value {
    let session_id = match params.get("sessionId").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => {
            return make_error_response(id.clone(), -32602, "Missing sessionId");
        }
    };

    if let Some(record) = server.sessions.get(&session_id) {
        server
            .state
            .acp_manager
            .cancel(&record.routa_session_id)
            .await;
    }

    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": { "cancelled": true }
    })
}

/// Handle `session/list` — list active sessions.
fn handle_session_list(server: &AcpServerState, id: Option<Value>) -> Value {
    let sessions: Vec<Value> = server
        .sessions
        .iter()
        .map(|(sid, record)| {
            serde_json::json!({
                "sessionId": sid,
                "agentId": record.agent_id,
                "workspaceId": record.workspace_id,
                "cwd": record.cwd
            })
        })
        .collect();

    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": { "sessions": sessions }
    })
}

/// Write a JSON-RPC response/notification to stdout.
async fn write_response(stdout: &mut tokio::io::Stdout, value: &Value) {
    let data = format!("{}\n", serde_json::to_string(value).unwrap_or_default());
    let _ = stdout.write_all(data.as_bytes()).await;
    let _ = stdout.flush().await;
}

/// Create a JSON-RPC error response.
fn make_error_response(id: Option<Value>, code: i64, message: &str) -> Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message
        }
    })
}
