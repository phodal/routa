//! `routa team` — Team coordination with an agent lead.
//!
//! Launches a team session where an agent-lead (ROUTA specialist) receives
//! a user requirement, decomposes it into tasks, and delegates to specialist
//! team members (CRAFTER, GATE, DEVELOPER agents).

use std::io::{self, BufRead, Write};
use std::sync::Arc;

use dialoguer::{theme::ColorfulTheme, Input};
use routa_core::acp::SessionLaunchOptions;
use routa_core::models::agent::AgentRole;
use routa_core::orchestration::{OrchestratorConfig, RoutaOrchestrator, SpecialistConfig};
use routa_core::rpc::RpcRouter;
use routa_core::state::AppState;
use routa_core::store::acp_session_store::CreateAcpSessionParams;
use tokio::sync::broadcast;

use super::prompt::{print_session_summary, truncate_path, update_agent_status};
use super::review::stream_parser::update_contains_turn_complete;
use super::tui::{update_has_visible_terminal_activity, IdleExitPolicy, TuiRenderer};

/// Run the team coordination flow with an agent lead.
pub async fn run(
    state: &AppState,
    task_prompt: &str,
    workspace_id: &str,
    provider: &str,
    interactive: bool,
) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());

    // ── 1. Resolve workspace ─────────────────────────────────────────────
    let workspace_id = if workspace_id == "default" {
        "default".to_string()
    } else {
        ensure_workspace(&router, workspace_id).await?
    };

    // ── 2. Load team-agent-lead specialist ───────────────────────────────
    let specialist = SpecialistConfig::resolve("team-agent-lead")
        .or_else(|| SpecialistConfig::by_role(&AgentRole::Routa))
        .unwrap_or_else(SpecialistConfig::crafter);

    // ── 3. Discover team members ─────────────────────────────────────────
    let team_members = discover_team_members();
    let team_roster = format_team_roster(&team_members);
    let team_count = team_members.len();

    // ── 4. Create team lead agent via RPC ────────────────────────────────
    let agent_name = "cli-team-lead";
    let create_response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "agents.create",
            "params": {
                "name": agent_name,
                "role": specialist.role.as_str(),
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
            format!("Failed to create team lead agent: {error_msg}")
        })?
        .to_string();

    // ── 5. Print team info banner ────────────────────────────────────────
    println!("╔══════════════════════════════════════════════════════════╗");
    println!("║  Routa CLI — Team Mode                                   ║");
    println!("╠══════════════════════════════════════════════════════════╣");
    println!(
        "║  Team Lead  : {:<43} ║",
        format!("{} ({})", specialist.name, specialist.role.as_str())
    );
    println!(
        "║  Members    : {:<43} ║",
        format!("{} specialists available", team_count)
    );
    println!("║  Workspace  : {:<43} ║", &workspace_id);
    println!("║  Provider   : {provider:<43} ║");
    println!("║  CWD        : {:<43} ║", truncate_path(&cwd, 43));
    println!("╚══════════════════════════════════════════════════════════╝");
    println!();
    println!("📋 Requirement: {task_prompt}");
    println!();

    // ── 6. Create ACP session for the team lead ──────────────────────────
    let session_id = uuid::Uuid::new_v4().to_string();

    let spawn_result = state
        .acp_manager
        .create_session_with_options(
            session_id.clone(),
            cwd.clone(),
            workspace_id.clone(),
            Some(provider.to_string()),
            Some(specialist.role.as_str().to_string()),
            None,
            None,
            None, // tool_mode
            None, // mcp_profile
            build_team_launch_options(provider, &specialist, &team_roster),
        )
        .await;

    match spawn_result {
        Ok((sid, _)) => {
            tracing::info!("Team lead session created: {}", sid);
            if let Err(err) = update_agent_status(&router, &agent_id, "ACTIVE").await {
                eprintln!("Failed to mark agent {agent_id} ACTIVE: {err}");
            }
            if let Err(e) = state
                .acp_session_store
                .create(CreateAcpSessionParams {
                    id: &session_id,
                    cwd: &cwd,
                    branch: None,
                    workspace_id: &workspace_id,
                    provider: Some(provider),
                    role: Some(specialist.role.as_str()),
                    custom_command: None,
                    custom_args: None,
                    parent_session_id: None,
                })
                .await
            {
                eprintln!("Failed to persist team lead session {session_id}: {e}");
            }
        }
        Err(e) => {
            if let Err(err) = update_agent_status(&router, &agent_id, "ERROR").await {
                eprintln!("Failed to mark agent {agent_id} ERROR: {err}");
            }
            return Err(format!("Failed to create ACP session: {e}"));
        }
    }

    // ── 7. Register with orchestrator ────────────────────────────────────
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

    // ── 8. Subscribe to session updates ──────────────────────────────────
    let mut rx = match state.acp_manager.subscribe(&session_id).await {
        Some(rx) => rx,
        None => {
            if let Err(err) = update_agent_status(&router, &agent_id, "ERROR").await {
                eprintln!("Failed to mark agent {agent_id} ERROR: {err}");
            }
            state.acp_manager.kill_session(&session_id).await;
            orchestrator.cleanup(&session_id).await;
            return Err("Failed to subscribe to session updates".to_string());
        }
    };

    // ── 9. Build and send team lead prompt ───────────────────────────────
    let coordinator_prompt = build_team_prompt(
        provider,
        &specialist,
        &agent_id,
        &workspace_id,
        task_prompt,
        &team_roster,
    );

    println!("🚀 Sending requirement to team lead...");
    println!();

    let final_status = "COMPLETED";
    if let Err(err) =
        prompt_and_stream_until_idle(&mut rx, state, &session_id, &coordinator_prompt).await
    {
        if let Err(status_err) = update_agent_status(&router, &agent_id, "ERROR").await {
            eprintln!("Failed to mark agent {agent_id} ERROR: {status_err}");
        }
        state.acp_manager.kill_session(&session_id).await;
        orchestrator.cleanup(&session_id).await;
        return Err(format!("Failed to send prompt: {err}"));
    }

    // ── 10. Enter interactive REPL if requested ──────────────────────────
    if interactive && state.acp_manager.is_alive(&session_id).await {
        if let Err(err) = run_interactive_repl(
            state,
            &agent_id,
            &session_id,
            &router,
            &workspace_id,
            &team_members,
            &mut rx,
        )
        .await
        {
            if let Err(status_err) = update_agent_status(&router, &agent_id, "ERROR").await {
                eprintln!("Failed to mark agent {agent_id} ERROR: {status_err}");
            }
            state.acp_manager.kill_session(&session_id).await;
            orchestrator.cleanup(&session_id).await;
            return Err(err);
        }
    }

    if let Err(err) = update_agent_status(&router, &agent_id, final_status).await {
        eprintln!("Failed to mark agent {agent_id} {final_status}: {err}");
    }

    // ── 11. Print summary ────────────────────────────────────────────────
    println!();
    print_session_summary(&router, &workspace_id, Some(&agent_id), Some(&session_id)).await;

    // ── 12. Cleanup ──────────────────────────────────────────────────────
    state.acp_manager.kill_session(&session_id).await;
    orchestrator.cleanup(&session_id).await;

    Ok(())
}

/// Show team status (agents and tasks in workspace).
pub async fn status(state: &AppState, workspace_id: &str) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    print_session_summary(&router, workspace_id, None, None).await;
    Ok(())
}

/// Interactive REPL for team mode.
async fn run_interactive_repl(
    state: &AppState,
    agent_id: &str,
    session_id: &str,
    router: &RpcRouter,
    workspace_id: &str,
    team_members: &[SpecialistConfig],
    session_rx: &mut tokio::sync::broadcast::Receiver<serde_json::Value>,
) -> Result<(), String> {
    println!();
    println!("Team interactive mode. Commands:");
    println!("  /status  — Show team agents and tasks");
    println!("  /members — List available team specialists");
    println!("  /quit    — Exit team session");
    println!("  (any text) — Send message to team lead");
    println!();

    let stdin = io::stdin();
    let reader = stdin.lock();

    print!("team> ");
    io::stdout().flush().ok();

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read input: {e}"))?;
        let trimmed = line.trim();

        if trimmed.is_empty() {
            print!("team> ");
            io::stdout().flush().ok();
            continue;
        }

        match trimmed {
            "/quit" | "/exit" | "/q" => {
                println!("Exiting team session...");
                break;
            }
            "/status" => {
                print_session_summary(router, workspace_id, Some(agent_id), Some(session_id)).await;
            }
            "/members" => {
                println!();
                println!("Available Team Specialists:");
                println!("┌────────────────────────┬────────────┬──────────────────────────────────────┐");
                println!("│ Specialist ID          │ Role       │ Description                          │");
                println!("├────────────────────────┼────────────┼──────────────────────────────────────┤");
                for member in team_members {
                    let member_id = member.id.chars().take(22).collect::<String>();
                    let desc = member
                        .description
                        .as_deref()
                        .unwrap_or("")
                        .chars()
                        .take(36)
                        .collect::<String>();
                    println!(
                        "│ {:<22} │ {:<10} │ {:<36} │",
                        member_id,
                        member.role.as_str(),
                        desc
                    );
                }
                println!("└────────────────────────┴────────────┴──────────────────────────────────────┘");
                println!();
            }
            _ => {
                // Send message to team lead
                match prompt_and_stream_until_idle(session_rx, state, session_id, trimmed).await {
                    Ok(_) => {}
                    Err(e) => {
                        println!("Failed to send message: {e}");
                    }
                }
            }
        }

        print!("\nteam> ");
        io::stdout().flush().ok();
    }

    Ok(())
}

/// Stream updates until idle or turn_complete.
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

/// Discover available team-* specialists (excluding team-agent-lead).
fn discover_team_members() -> Vec<SpecialistConfig> {
    SpecialistConfig::list_available()
        .into_iter()
        .filter(|s| s.id.starts_with("team-") && s.id != "team-agent-lead")
        .collect()
}

/// Format team members into a markdown roster table.
fn format_team_roster(members: &[SpecialistConfig]) -> String {
    if members.is_empty() {
        return "## Available Team Members\n\nNo team specialists configured.".to_string();
    }

    let mut table = String::from("## Available Team Members\n\n");
    table.push_str("| Specialist ID | Role | Description |\n");
    table.push_str("|---|---|---|\n");

    for member in members {
        let desc = member.description.as_deref().unwrap_or("No description");
        table.push_str(&format!(
            "| {} | {} | {} |\n",
            member.id,
            member.role.as_str(),
            desc
        ));
    }

    table
}

/// Build the full prompt for the team lead.
fn build_team_prompt(
    provider: &str,
    specialist: &SpecialistConfig,
    agent_id: &str,
    workspace_id: &str,
    user_requirement: &str,
    team_roster: &str,
) -> String {
    if provider == "claude" {
        return build_team_user_prompt(agent_id, workspace_id, user_requirement);
    }

    format!(
        "{}\n\n---\n\n\
         {}\n\n\
         **Your Agent ID:** {}\n\
         **Workspace ID:** {}\n\n\
         ## User Requirement\n\n{}\n\n\
         ---\n**Reminder:** {}\n",
        specialist
            .system_prompt_body()
            .unwrap_or_else(|| specialist.system_prompt.clone()),
        team_roster,
        agent_id,
        workspace_id,
        user_requirement,
        specialist.role_reminder
    )
}

fn build_team_user_prompt(agent_id: &str, workspace_id: &str, user_requirement: &str) -> String {
    format!(
        "**Your Agent ID:** {agent_id}\n\
         **Workspace ID:** {workspace_id}\n\n\
         ## User Requirement\n\n{user_requirement}\n"
    )
}

fn build_team_system_prompt(specialist: &SpecialistConfig, team_roster: &str) -> String {
    format!(
        "{}\n\n---\n\n{}\n\n---\n**Reminder:** {}\n",
        specialist
            .system_prompt_body()
            .unwrap_or_else(|| specialist.system_prompt.clone()),
        team_roster,
        specialist.role_reminder
    )
}

fn build_team_launch_options(
    provider: &str,
    specialist: &SpecialistConfig,
    team_roster: &str,
) -> SessionLaunchOptions {
    if provider != "claude" {
        return SessionLaunchOptions::default();
    }

    let allowed_native_tools = if specialist.id == "team-agent-lead" {
        Some(Vec::new())
    } else {
        None
    };

    SessionLaunchOptions {
        specialist_id: Some(specialist.id.clone()),
        specialist_system_prompt: Some(build_team_system_prompt(specialist, team_roster)),
        allowed_native_tools,
        ..SessionLaunchOptions::default()
    }
}

/// Interactively prompt for the task description.
pub fn prompt_for_task() -> Result<String, String> {
    let theme = ColorfulTheme::default();
    Input::with_theme(&theme)
        .with_prompt("Enter team task requirement")
        .interact_text()
        .map_err(|e| format!("Failed to read task: {e}"))
}

/// Ensure workspace exists, creating if necessary.
async fn ensure_workspace(router: &RpcRouter, workspace_id: &str) -> Result<String, String> {
    let ws_response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "workspaces.get",
            "params": { "id": workspace_id }
        }))
        .await;

    if ws_response.get("error").is_none() {
        return Ok(workspace_id.to_string());
    }

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

    let created_ws_id = create_resp
        .get("result")
        .and_then(|r| r.get("workspace"))
        .and_then(|w| w.get("id"))
        .and_then(|id| id.as_str())
        .ok_or("Failed to get created workspace ID")?
        .to_string();

    println!("Created workspace: {created_ws_id}");
    Ok(created_ws_id)
}
