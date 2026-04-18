//! `routa chat` — Interactive chat session with an agent.
//!
//! Creates an ACP session and provides a REPL-style interface for
//! sending prompts and receiving responses, mirroring the Next.js
//! ChatPanel experience from the homepage.
//!
//! Typing `@` at the start of your message opens an interactive specialist
//! picker so you can switch context without leaving the chat.

use std::io::{self, BufRead, Write};
use std::sync::Arc;

use console::style;
use dialoguer::{theme::ColorfulTheme, Select};
use routa_core::models::agent::AgentRole;
use routa_core::orchestration::{OrchestratorConfig, RoutaOrchestrator, SpecialistConfig};
use routa_core::rpc::RpcRouter;
use routa_core::state::AppState;
use routa_core::store::acp_session_store::CreateAcpSessionParams;
use tokio::sync::broadcast;

use super::prompt::update_agent_status;
use super::review::stream_parser::update_contains_turn_complete;
use super::tui::{update_has_visible_terminal_activity, IdleExitPolicy, TuiRenderer};

pub async fn run(
    state: &AppState,
    workspace_id: &str,
    provider: &str,
    role: &str,
    requested_session_id: Option<&str>,
) -> Result<(), String> {
    let _agent_role = AgentRole::from_str(role)
        .ok_or_else(|| format!("Invalid role: {role}. Use ROUTA, CRAFTER, GATE, or DEVELOPER"))?;

    let router = RpcRouter::new(state.clone());

    // Create agent for this chat session via RPC
    let agent_name = format!("cli-{}", role.to_lowercase());
    let create_response = router
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

    let agent_id = create_response
        .get("result")
        .and_then(|r| r.get("agentId"))
        .and_then(|v| v.as_str())
        .ok_or("Failed to get agent ID from creation result")?
        .to_string();

    let resumed_session = if let Some(session_id) = requested_session_id {
        Some(
            state
                .acp_session_store
                .get(session_id)
                .await
                .map_err(|e| format!("Failed to load session {session_id}: {e}"))?
                .ok_or_else(|| format!("Session not found: {session_id}"))?,
        )
    } else {
        None
    };
    let session_id = resumed_session
        .as_ref()
        .map(|session| session.id.clone())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let cwd = resumed_session
        .as_ref()
        .map(|session| session.cwd.clone())
        .unwrap_or_else(|| {
            std::env::current_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| ".".to_string())
        });
    let effective_workspace_id = resumed_session
        .as_ref()
        .map(|session| session.workspace_id.clone())
        .unwrap_or_else(|| workspace_id.to_string());
    let effective_provider = resumed_session
        .as_ref()
        .and_then(|session| session.provider.clone())
        .unwrap_or_else(|| provider.to_string());
    let effective_role = resumed_session
        .as_ref()
        .and_then(|session| session.role.clone())
        .unwrap_or_else(|| role.to_string());

    println!("╔══════════════════════════════════════════════════════════╗");
    println!("║  Routa CLI Chat                                         ║");
    println!("╠══════════════════════════════════════════════════════════╣");
    println!(
        "║  Agent : {:<48} ║",
        format!("{} ({})", &agent_id[..8], effective_role)
    );
    println!("║  Workspace : {effective_workspace_id:<44} ║");
    println!("║  Provider  : {effective_provider:<44} ║");
    println!("╚══════════════════════════════════════════════════════════╝");

    let session_exists = state.acp_manager.get_session(&session_id).await.is_some();
    let mut final_status = "COMPLETED";

    if !session_exists {
        let spawn_result = state
            .acp_manager
            .create_session(
                session_id.clone(),
                cwd.clone(),
                effective_workspace_id.clone(),
                Some(effective_provider.clone()),
                Some(effective_role.clone()),
                None,
                resumed_session
                    .as_ref()
                    .and_then(|session| session.parent_session_id.clone()),
                None, // tool_mode
                None, // mcp_profile
            )
            .await;

        match spawn_result {
            Ok((sid, _)) => {
                println!("  {} Session: {}", style("●").green(), sid);
                if let Err(err) = update_agent_status(&router, &agent_id, "ACTIVE").await {
                    eprintln!("Failed to mark agent {agent_id} ACTIVE: {err}");
                }
                if resumed_session.is_none() {
                    state
                        .acp_session_store
                        .create(CreateAcpSessionParams {
                            id: &session_id,
                            cwd: &cwd,
                            branch: None,
                            workspace_id: &effective_workspace_id,
                            provider: Some(&effective_provider),
                            role: Some(&effective_role),
                            custom_command: None,
                            custom_args: None,
                            parent_session_id: None,
                        })
                        .await
                        .map_err(|e| format!("Failed to persist session {session_id}: {e}"))?;
                }
            }
            Err(e) => {
                final_status = "ERROR";
                if let Err(err) = update_agent_status(&router, &agent_id, "ERROR").await {
                    eprintln!("Failed to mark agent {agent_id} ERROR: {err}");
                }
                println!(
                    "  {} Could not create ACP session: {}. Running in offline mode.",
                    style("!").yellow(),
                    e
                );
            }
        }
    } else {
        println!("  {} Session: {}", style("●").green(), session_id);
    }

    let acp = Arc::new(state.acp_manager.clone());
    let orchestrator = RoutaOrchestrator::new(
        OrchestratorConfig::default(),
        acp,
        state.agent_store.clone(),
        state.task_store.clone(),
        state.event_bus.clone(),
    );
    orchestrator
        .register_agent_session(&agent_id, &session_id)
        .await;
    let mut session_rx = state.acp_manager.subscribe(&session_id).await;

    println!();
    println!(
        "{}",
        style("Type your message and press Enter. /quit to exit.").dim()
    );
    println!(
        "{}",
        style("  Start with @ to pick a specialist  •  /agents  /tasks  /status").dim()
    );
    println!();

    // Pre-load specialists for @ menu
    let specialists = SpecialistConfig::list_available();

    // We need to read stdin line-by-line. Because ACP responses arrive async
    // we drain the broadcast channel after each prompt send.
    let stdin = io::stdin();
    let reader = stdin.lock();

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read input: {e}"))?;
        let trimmed = line.trim();

        if trimmed.is_empty() {
            print!("> ");
            io::stdout().flush().ok();
            continue;
        }

        // ── Slash commands ───────────────────────────────────────────────
        match trimmed {
            "/quit" | "/exit" | "/q" => {
                if let Err(err) = update_agent_status(&router, &agent_id, final_status).await {
                    eprintln!("Failed to mark agent {agent_id} COMPLETED: {err}");
                }
                println!("{}", style("Goodbye!").dim());
                state.acp_manager.kill_session(&session_id).await;
                break;
            }
            "/agents" => {
                let response = router
                    .handle_value(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "agents.list",
                        "params": { "workspaceId": effective_workspace_id }
                    }))
                    .await;
                if let Some(result) = response.get("result") {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(result).unwrap_or_default()
                    );
                }
                print!("\n> ");
                io::stdout().flush().ok();
                continue;
            }
            "/tasks" => {
                let response = router
                    .handle_value(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "tasks.list",
                        "params": { "workspaceId": effective_workspace_id }
                    }))
                    .await;
                if let Some(result) = response.get("result") {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(result).unwrap_or_default()
                    );
                }
                print!("\n> ");
                io::stdout().flush().ok();
                continue;
            }
            "/status" => {
                let response = router
                    .handle_value(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "agents.get",
                        "params": { "id": &agent_id }
                    }))
                    .await;
                if let Some(result) = response.get("result") {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(result).unwrap_or_default()
                    );
                }
                print!("\n> ");
                io::stdout().flush().ok();
                continue;
            }
            _ => {}
        }

        // ── @ mention — interactive specialist selector ──────────────────
        let final_prompt = if trimmed.starts_with('@') {
            let (specialist_id, remainder) = parse_at_mention(trimmed);

            let selected = if let Some(id) = specialist_id {
                // Exact match from inline @id
                specialists
                    .iter()
                    .find(|s| s.id == id)
                    .cloned()
                    .or_else(|| {
                        // Show picker pre-filtered to the typed prefix
                        pick_specialist_interactive(&specialists, Some(&id))
                    })
            } else {
                // Bare `@` — open picker
                pick_specialist_interactive(&specialists, None)
            };

            match selected {
                Some(specialist) => {
                    // Inline remainder or ask for prompt
                    let user_req = if let Some(rem) = remainder.filter(|r| !r.is_empty()) {
                        rem
                    } else {
                        // Use dialoguer Input for the user request
                        dialoguer::Input::with_theme(&ColorfulTheme::default())
                            .with_prompt(format!("Prompt for {}", specialist.name))
                            .interact_text()
                            .unwrap_or_default()
                    };
                    build_specialist_prompt(
                        &specialist,
                        &agent_id,
                        &effective_workspace_id,
                        &user_req,
                    )
                }
                None => {
                    // User cancelled picker — skip this line
                    print!("\n> ");
                    io::stdout().flush().ok();
                    continue;
                }
            }
        } else {
            trimmed.to_string()
        };

        if final_prompt.trim().is_empty() {
            print!("\n> ");
            io::stdout().flush().ok();
            continue;
        }

        // ── Send prompt ──────────────────────────────────────────────────
        let prompt_result = if let Some(ref mut rx) = session_rx {
            prompt_and_stream_until_idle(rx, state, &session_id, &final_prompt).await
        } else {
            state
                .acp_manager
                .prompt(&session_id, &final_prompt)
                .await
                .map(|_| ())
        };

        match prompt_result {
            Ok(_) => {
                if let Err(e) = state
                    .acp_session_store
                    .set_first_prompt_sent(&session_id)
                    .await
                {
                    eprintln!("Failed to mark first prompt sent: {e}");
                }
                if let Some(history) = state.acp_manager.get_session_history(&session_id).await {
                    if let Err(e) = state
                        .acp_session_store
                        .save_history(&session_id, &history)
                        .await
                    {
                        eprintln!("Failed to persist session history: {e}");
                    }
                }
            }
            Err(e) => {
                final_status = "ERROR";
                if let Err(status_err) = update_agent_status(&router, &agent_id, "ERROR").await {
                    eprintln!("Failed to mark agent {agent_id} ERROR: {status_err}");
                }
                println!("{} Failed to send prompt: {}", style("✘").red(), e);
            }
        }

        print!("\n> ");
        io::stdout().flush().ok();
    }

    if let Err(err) = update_agent_status(&router, &agent_id, final_status).await {
        eprintln!("Failed to mark agent {agent_id} {final_status}: {err}");
    }

    Ok(())
}

/// Drain the broadcast channel until idle (no message for 2 s) or turn_complete.
async fn prompt_and_stream_until_idle(
    rx: &mut broadcast::Receiver<serde_json::Value>,
    state: &AppState,
    session_id: &str,
    prompt: &str,
) -> Result<(), String> {
    let mut renderer = TuiRenderer::new();
    let mut idle_policy = IdleExitPolicy::new(30, 5);
    let mut prompt_finished = false;
    let prompt_future = state.acp_manager.prompt(session_id, prompt);
    tokio::pin!(prompt_future);

    loop {
        let tick = tokio::time::sleep(std::time::Duration::from_secs(1));
        tokio::pin!(tick);

        tokio::select! {
            prompt_result = &mut prompt_future, if !prompt_finished => {
                prompt_finished = true;
                if let Err(error) = prompt_result {
                    renderer.finish();
                    return Err(error);
                }
            }
            recv_result = rx.recv() => {
                match recv_result {
                    Ok(update) => {
                        if update_has_visible_terminal_activity(&update) {
                            idle_policy.record_update();
                        }

                        let is_done = update
                            .get("params")
                            .and_then(|p| p.get("update"))
                            .and_then(|u| u.get("sessionUpdate"))
                            .and_then(|v| v.as_str())
                            == Some("turn_complete");
                        renderer.handle_update(&update);
                        if is_done {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            _ = &mut tick => {
                if let Some(history) = state.acp_manager.get_session_history(session_id).await {
                    if update_contains_turn_complete(&history) {
                        break;
                    }
                }

                if prompt_finished && idle_policy.should_exit_on_idle_tick() {
                    break;
                }

                if !state.acp_manager.is_alive(session_id).await {
                    break;
                }
            }
        }
    }
    renderer.finish();
    Ok(())
}

/// Parse `@specialist-id rest of prompt` from a single trimmed line.
///
/// Returns `(Option<id>, Option<remainder>)`.
fn parse_at_mention(input: &str) -> (Option<String>, Option<String>) {
    let without = match input.strip_prefix('@') {
        Some(s) => s,
        None => return (None, None),
    };

    let mut parts = without.splitn(2, char::is_whitespace);
    let id = parts
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_lowercase());
    let remainder = parts
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    (id, remainder)
}

/// Show a dialoguer Select menu filtered to specialists whose id starts with `prefix`.
fn pick_specialist_interactive(
    specialists: &[SpecialistConfig],
    prefix: Option<&str>,
) -> Option<SpecialistConfig> {
    let filtered: Vec<&SpecialistConfig> = if let Some(p) = prefix {
        let lower = p.to_lowercase();
        let exact: Vec<_> = specialists.iter().filter(|s| s.id == lower).collect();
        if !exact.is_empty() {
            return exact.into_iter().next().cloned();
        }
        specialists
            .iter()
            .filter(|s| s.id.starts_with(&lower))
            .collect()
    } else {
        specialists.iter().collect()
    };

    if filtered.is_empty() {
        println!("{}", style("No matching specialists found.").yellow());
        return None;
    }

    let items: Vec<String> = filtered
        .iter()
        .map(|s| {
            format!(
                "{} ({}){}",
                s.id,
                s.role.as_str(),
                s.description
                    .as_ref()
                    .map(|d| format!(" — {d}"))
                    .unwrap_or_default()
            )
        })
        .collect();

    let theme = ColorfulTheme::default();
    match Select::with_theme(&theme)
        .with_prompt("Select specialist (@)")
        .items(&items)
        .default(0)
        .interact_opt()
    {
        Ok(Some(idx)) => Some(filtered[idx].clone()),
        _ => None,
    }
}

/// Build the specialist system prompt + user request for injection.
fn build_specialist_prompt(
    specialist: &SpecialistConfig,
    agent_id: &str,
    workspace_id: &str,
    user_req: &str,
) -> String {
    format!(
        "{}\n\n---\n\n**Your Agent ID:** {}\n**Workspace ID:** {}\n\n## User Request\n\n{}\n\n---\n**Reminder:** {}\n",
        specialist
            .system_prompt_body()
            .unwrap_or_else(|| specialist.system_prompt.clone()),
        agent_id,
        workspace_id,
        user_req,
        specialist.role_reminder
    )
}
