//! `routa -p "requirement"` — Run a single quick prompt from CLI.
//!
//! Flow:
//! 1. Creates a workspace (or uses default)
//! 2. Spawns a DEVELOPER agent
//! 3. Sends the user's prompt as-is
//! 4. Streams session updates (agent messages, tool calls, process output)
//! 5. Prints a run-scoped summary

use std::collections::HashSet;

use routa_core::rpc::RpcRouter;
use routa_core::state::AppState;

use super::review::stream_parser::{extract_update_text, update_contains_turn_complete};
use super::tui::TuiRenderer;

/// Run a single DEVELOPER prompt flow for a user prompt.
pub async fn run(
    state: &AppState,
    prompt: &str,
    workspace_id: &str,
    provider: &str,
) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());

    // ── 1. Use default workspace (always exists) ────────────────────────
    let workspace_id = if workspace_id == "default" {
        "default".to_string()
    } else {
        // For non-default workspaces, try to get or create
        let ws_response = router
            .handle_value(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "workspaces.get",
                "params": { "id": workspace_id }
            }))
            .await;

        if ws_response.get("error").is_some() {
            // Create workspace if it doesn't exist
            let create_resp = router
                .handle_value(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "workspaces.create",
                    "params": {
                        "title": workspace_id
                    }
                }))
                .await;

            if let Some(err) = create_resp.get("error") {
                let err_msg = err
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown error");
                return Err(format!("Failed to create workspace: {err_msg}"));
            }

            // Get the created workspace ID
            let created_ws_id = create_resp
                .get("result")
                .and_then(|r| r.get("workspace"))
                .and_then(|w| w.get("id"))
                .and_then(|id| id.as_str())
                .ok_or("Failed to get created workspace ID")?
                .to_string();

            println!("Created workspace: {created_ws_id}");
            created_ws_id
        } else {
            workspace_id.to_string()
        }
    };

    // ── 2. Create DEVELOPER agent ───────────────────────────────────────
    let agent_name = "cli-developer";
    let create_response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "agents.create",
            "params": {
                "name": agent_name,
                "role": "DEVELOPER",
                "workspaceId": &workspace_id
            }
        }))
        .await;

    let agent_id = create_response
        .get("result")
        .and_then(|r| r.get("agentId"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            let error_msg = create_response
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown error");
            format!("Failed to create developer agent: {error_msg}")
        })?
        .to_string();

    // ── 3. Use the raw user prompt without a CLI-specific wrapper ───────
    let prompt_text = prompt.trim();

    // ── 4. Create ACP session for the developer ─────────────────────────
    let session_id = uuid::Uuid::new_v4().to_string();

    println!("╔══════════════════════════════════════════════════════════╗");
    println!("║  Routa CLI — Quick Prompt                               ║");
    println!("╠══════════════════════════════════════════════════════════╣");
    println!("║  Workspace : {:<42} ║", &workspace_id);
    println!("║  Agent     : {} (DEVELOPER) {:<23} ║", &agent_id[..8], "");
    println!("║  Provider  : {provider:<42} ║");
    println!("║  CWD       : {:<42} ║", truncate_path(&cwd, 42));
    println!("╚══════════════════════════════════════════════════════════╝");
    println!();
    println!("📋 Requirement: {prompt}");
    println!();

    let spawn_result = state
        .acp_manager
        .create_session(
            session_id.clone(),
            cwd.clone(),
            workspace_id.clone(),
            Some(provider.to_string()),
            Some("DEVELOPER".to_string()),
            None,
            None, // branch
            None, // tool_mode
            None, // mcp_profile
        )
        .await;

    match spawn_result {
        Ok((sid, _)) => {
            tracing::info!("Developer session created: {}", sid);
            if let Err(err) = update_agent_status(&router, &agent_id, "ACTIVE").await {
                eprintln!("Failed to mark agent {agent_id} ACTIVE: {err}");
            }
        }
        Err(e) => {
            if let Err(err) = update_agent_status(&router, &agent_id, "ERROR").await {
                eprintln!("Failed to mark agent {agent_id} ERROR: {err}");
            }
            return Err(format!("Failed to create ACP session: {e}"));
        }
    }

    // ── 5. Subscribe to session updates ─────────────────────────────────
    let mut rx = match state.acp_manager.subscribe(&session_id).await {
        Some(rx) => rx,
        None => {
            if let Err(err) = update_agent_status(&router, &agent_id, "ERROR").await {
                eprintln!("Failed to mark agent {agent_id} ERROR: {err}");
            }
            state.acp_manager.kill_session(&session_id).await;
            return Err("Failed to subscribe to session updates".to_string());
        }
    };

    // ── 6. Send the raw user prompt ─────────────────────────────────────
    println!("🚀 Sending prompt to developer...");
    println!();

    let mut renderer = TuiRenderer::new();
    let mut idle_count = 0u32;
    let max_idle = 600; // 10 minutes at 1s intervals
    let initial_wait_notice_threshold = 3;
    let prompt_finished_idle_threshold = 3;
    let mut prompt_finished = false;
    let mut prompt_error: Option<String> = None;
    let mut saw_output = false;
    let mut waiting_notice_shown = false;
    let mut final_status = "COMPLETED";
    let prompt_future = state.acp_manager.prompt(&session_id, prompt_text);
    tokio::pin!(prompt_future);

    loop {
        let tick = tokio::time::sleep(std::time::Duration::from_secs(1));
        tokio::pin!(tick);

        tokio::select! {
            prompt_result = &mut prompt_future, if !prompt_finished => {
                prompt_finished = true;
                if let Err(err) = prompt_result {
                    renderer.finish();
                    prompt_error = Some(format!("Failed to send prompt: {err}"));
                    final_status = "ERROR";
                    break;
                }
            }
            recv_result = rx.recv() => {
                match recv_result {
                    Ok(update) => {
                        idle_count = 0;
                        let update_payload = update
                            .get("params")
                            .and_then(|params| params.get("update"))
                            .and_then(|value| value.as_object());
                        if let Some(update_payload) = update_payload {
                            if let Some(text) = extract_update_text(update_payload) {
                                if !text.trim().is_empty() {
                                    saw_output = true;
                                }
                            }
                        }
                        let is_done = update
                            .get("params")
                            .and_then(|params| params.get("update"))
                            .and_then(|value| value.get("sessionUpdate"))
                            .and_then(|value| value.as_str())
                            == Some("turn_complete");
                        renderer.handle_update(&update);
                        if is_done {
                            renderer.finish();
                            println!("═══ Agent turn complete ═══");
                            break;
                        }
                    }
                    Err(_) => {
                        renderer.finish();
                        final_status = "ERROR";
                        println!("═══ Agent session ended ═══");
                        break;
                    }
                }
            }
            _ = &mut tick => {
                idle_count += 1;
                if !waiting_notice_shown
                    && !saw_output
                    && idle_count >= initial_wait_notice_threshold
                {
                    println!("… Waiting for agent output");
                    waiting_notice_shown = true;
                }

                if let Some(history) = state.acp_manager.get_session_history(&session_id).await {
                    if update_contains_turn_complete(&history) {
                        renderer.finish();
                        println!("═══ Agent turn complete ═══");
                        break;
                    }
                }

                if prompt_finished && idle_count >= prompt_finished_idle_threshold {
                    renderer.finish();
                    println!("═══ Agent response complete ═══");
                    break;
                }

                if idle_count >= max_idle {
                    renderer.finish();
                    final_status = "ERROR";
                    println!("⏰ Timeout: no activity for {max_idle} seconds");
                    break;
                }

                if !state.acp_manager.is_alive(&session_id).await {
                    renderer.finish();
                    final_status = "ERROR";
                    println!("═══ Agent process exited ═══");
                    break;
                }
            }
        }
    }

    if let Some(error) = prompt_error {
        if let Err(err) = update_agent_status(&router, &agent_id, "ERROR").await {
            eprintln!("Failed to mark agent {agent_id} ERROR: {err}");
        }
        state.acp_manager.kill_session(&session_id).await;
        return Err(error);
    }

    if let Err(err) = update_agent_status(&router, &agent_id, final_status).await {
        eprintln!("Failed to mark agent {agent_id} {final_status}: {err}");
    }

    // ── 9. Print summary ────────────────────────────────────────────────
    println!();
    print_session_summary(&router, &workspace_id, Some(&agent_id), Some(&session_id)).await;

    // ── 10. Cleanup ─────────────────────────────────────────────────────
    state.acp_manager.kill_session(&session_id).await;

    Ok(())
}

pub(crate) async fn update_agent_status(
    router: &RpcRouter,
    agent_id: &str,
    status: &str,
) -> Result<(), String> {
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 102,
            "method": "agents.updateStatus",
            "params": {
                "id": agent_id,
                "status": status
            }
        }))
        .await;

    if let Some(error) = response.get("error") {
        let error_msg = error
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("Unknown error");
        return Err(error_msg.to_string());
    }

    Ok(())
}

/// Print a summary of agents and tasks after the session completes.
pub(crate) async fn print_session_summary(
    router: &RpcRouter,
    workspace_id: &str,
    root_agent_id: Option<&str>,
    session_id: Option<&str>,
) {
    println!("╔══════════════════════════════════════════════════════════╗");
    println!("║  Session Summary                                        ║");
    println!("╚══════════════════════════════════════════════════════════╝");

    // List agents
    let agents_resp = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 100,
            "method": "agents.list",
            "params": { "workspaceId": workspace_id }
        }))
        .await;

    let related_agent_ids = if let Some(result) = agents_resp.get("result") {
        if let Some(agents) = result.get("agents").and_then(|a| a.as_array()) {
            let related_agent_ids = collect_related_agent_ids(agents, root_agent_id);
            let visible_agents: Vec<&serde_json::Value> = if related_agent_ids.is_empty() {
                agents.iter().collect()
            } else {
                agents
                    .iter()
                    .filter(|agent| {
                        agent_id(agent)
                            .map(|id| related_agent_ids.contains(id))
                            .unwrap_or(false)
                    })
                    .collect()
            };

            println!();
            print_summary_heading(
                "Agents",
                visible_agents.len(),
                agents.len().saturating_sub(visible_agents.len()),
            );
            for agent in visible_agents {
                let name = agent.get("name").and_then(|v| v.as_str()).unwrap_or("?");
                let role = agent.get("role").and_then(|v| v.as_str()).unwrap_or("?");
                let status = agent.get("status").and_then(|v| v.as_str()).unwrap_or("?");
                let icon = match status {
                    "COMPLETED" => "✅",
                    "ACTIVE" => "🔄",
                    "ERROR" => "❌",
                    _ => "⏳",
                };
                println!("    {icon} {name} ({role}) — {status}");
            }

            related_agent_ids
        } else {
            HashSet::new()
        }
    } else {
        HashSet::new()
    };

    if root_agent_id.is_some() && related_agent_ids.is_empty() {
        println!();
        println!("  Agents: no run-related agents found");
    }

    // List tasks
    let tasks_resp = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 101,
            "method": "tasks.list",
            "params": { "workspaceId": workspace_id }
        }))
        .await;

    if let Some(result) = tasks_resp.get("result") {
        if let Some(tasks) = result.get("tasks").and_then(|a| a.as_array()) {
            let visible_tasks: Vec<&serde_json::Value> =
                if root_agent_id.is_none() && session_id.is_none() {
                    tasks.iter().collect()
                } else {
                    tasks
                        .iter()
                        .filter(|task| is_run_related_task(task, &related_agent_ids, session_id))
                        .collect()
                };

            println!();
            print_summary_heading(
                "Tasks",
                visible_tasks.len(),
                tasks.len().saturating_sub(visible_tasks.len()),
            );
            for task in visible_tasks {
                let title = task.get("title").and_then(|v| v.as_str()).unwrap_or("?");
                let status = task.get("status").and_then(|v| v.as_str()).unwrap_or("?");
                let icon = match status {
                    "COMPLETED" => "✅",
                    "IN_PROGRESS" => "🔄",
                    "NEEDS_FIX" => "🔧",
                    "BLOCKED" => "🚫",
                    "CANCELLED" => "🗑️",
                    _ => "⏳",
                };
                println!("    {icon} {title} — {status}");
            }
        }
    }

    println!();
}

pub(crate) fn truncate_path(path: &str, max_len: usize) -> String {
    if path.len() <= max_len {
        path.to_string()
    } else {
        format!("...{}", &path[path.len() - (max_len - 3)..])
    }
}

fn print_summary_heading(label: &str, visible: usize, hidden: usize) {
    if hidden > 0 {
        println!("  {label} ({visible} shown, {hidden} hidden):");
    } else {
        println!("  {label} ({visible}):");
    }
}

fn collect_related_agent_ids(
    agents: &[serde_json::Value],
    root_agent_id: Option<&str>,
) -> HashSet<String> {
    let mut related = HashSet::new();
    let Some(root_agent_id) = root_agent_id else {
        return related;
    };

    related.insert(root_agent_id.to_string());
    let mut changed = true;
    while changed {
        changed = false;
        for agent in agents {
            let Some(agent_id) = agent_id(agent) else {
                continue;
            };
            if related.contains(agent_id) {
                continue;
            }

            let parent_id = agent.get("parentId").and_then(|value| value.as_str());
            if parent_id
                .map(|parent_id| related.contains(parent_id))
                .unwrap_or(false)
            {
                related.insert(agent_id.to_string());
                changed = true;
            }
        }
    }

    related
}

fn is_run_related_task(
    task: &serde_json::Value,
    related_agent_ids: &HashSet<String>,
    session_id: Option<&str>,
) -> bool {
    assigned_to_matches(task, related_agent_ids)
        || session_matches(task, session_id)
        || lane_session_agent_matches(task, related_agent_ids)
}

fn assigned_to_matches(task: &serde_json::Value, related_agent_ids: &HashSet<String>) -> bool {
    task.get("assignedTo")
        .and_then(|value| value.as_str())
        .map(|assigned_to| related_agent_ids.contains(assigned_to))
        .unwrap_or(false)
}

fn session_matches(task: &serde_json::Value, session_id: Option<&str>) -> bool {
    let Some(session_id) = session_id else {
        return false;
    };

    task.get("sessionId")
        .and_then(|value| value.as_str())
        .map(|value| value == session_id)
        .unwrap_or(false)
        || task
            .get("triggerSessionId")
            .and_then(|value| value.as_str())
            .map(|value| value == session_id)
            .unwrap_or(false)
        || task
            .get("sessionIds")
            .and_then(|value| value.as_array())
            .map(|values| {
                values
                    .iter()
                    .any(|value| value.as_str() == Some(session_id))
            })
            .unwrap_or(false)
}

fn lane_session_agent_matches(
    task: &serde_json::Value,
    related_agent_ids: &HashSet<String>,
) -> bool {
    task.get("laneSessions")
        .and_then(|value| value.as_array())
        .map(|lane_sessions| {
            lane_sessions.iter().any(|lane_session| {
                lane_session
                    .get("routaAgentId")
                    .and_then(|value| value.as_str())
                    .map(|agent_id| related_agent_ids.contains(agent_id))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn agent_id(agent: &serde_json::Value) -> Option<&str> {
    agent.get("id").and_then(|value| value.as_str())
}
