//! ACP/provider execution primitives for `routa review`.

use std::time::Duration;

use routa_core::state::AppState;
use routa_core::workflow::specialist::SpecialistDef;

use super::output::{print_security_acp_runtime_diagnostics, truncate};
use super::shared::{find_command_in_path, provider_runtime_binary};
use super::stream_parser::{
    extract_agent_output_from_history, extract_agent_output_from_process_output,
    extract_text_from_prompt_result, extract_update_text, update_contains_turn_complete,
};

pub(crate) fn resolve_security_provider(specialist: &SpecialistDef) -> String {
    std::env::var("ROUTA_REVIEW_PROVIDER")
        .ok()
        .or_else(|| specialist.default_provider.clone())
        .unwrap_or_else(|| "opencode".to_string())
}

pub(crate) async fn call_security_specialist_via_acp(
    state: &AppState,
    specialist: &SpecialistDef,
    user_request: &str,
    verbose: bool,
    provider: &str,
    cwd: &str,
) -> Result<String, String> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let workspace_id = "default".to_string();
    let cwd = cwd.to_string();

    if verbose {
        println!("╔══════════════════════════════════════════════════════════╗");
        println!("║  Security Specialist ACP Execution                    ║");
        println!("╠══════════════════════════════════════════════════════════╣");
        println!("║  Specialist: {:<40} ║", truncate(&specialist.id, 40));
        println!("║  Provider  : {:<40} ║", truncate(provider, 40));
        println!("║  Role      : {:<40} ║", truncate(&specialist.role, 40));
        println!("║  Workspace : {:<40} ║", truncate(&workspace_id, 40));
        println!("║  CWD       : {:<40} ║", truncate(&cwd, 40));
        println!("╚══════════════════════════════════════════════════════════╝");

        let runtime_binary = provider_runtime_binary(provider);
        let runtime_in_path = find_command_in_path(&runtime_binary);
        print_security_acp_runtime_diagnostics(
            provider,
            &cwd,
            &runtime_binary,
            runtime_in_path.as_deref(),
        );
    }

    state
        .acp_manager
        .create_session(
            session_id.clone(),
            cwd.clone(),
            workspace_id.clone(),
            Some(provider.to_string()),
            Some(specialist.role.clone()),
            specialist.default_model.clone(),
            None,
            None,
            None,
        )
        .await
        .map_err(|error| format!("Failed to create ACP session: {error}"))?;

    let mut maybe_rx = state.acp_manager.subscribe(&session_id).await;
    let prompt = build_security_final_prompt(specialist, user_request);

    let prompt_response = state
        .acp_manager
        .prompt(&session_id, &prompt)
        .await
        .map_err(|error| format!("Failed to send prompt: {error}"))?;

    let streamed_output = if let Some(mut rx) = maybe_rx.take() {
        wait_for_turn_complete_with_updates(state, &session_id, &mut rx, verbose).await?
    } else {
        wait_for_turn_complete_without_updates(state, &session_id).await?;
        String::new()
    };

    let history = state
        .acp_manager
        .get_session_history(&session_id)
        .await
        .unwrap_or_default();
    let output = if streamed_output.trim().is_empty() {
        extract_agent_output_from_history(&history)
    } else {
        streamed_output
    };
    let output = if output.trim().is_empty() {
        extract_text_from_prompt_result(&prompt_response).unwrap_or_default()
    } else {
        output
    };
    let output = if output.trim().is_empty() {
        extract_agent_output_from_process_output(&history)
    } else {
        output
    };

    state.acp_manager.kill_session(&session_id).await;

    if output.trim().is_empty() {
        let response_preview = truncate(&prompt_response.to_string(), 600);
        return Err(format!(
            "Security specialist completed without producing an output. prompt_response={}, history_entries={}",
            response_preview,
            history.len()
        ));
    }

    Ok(output)
}

fn build_security_final_prompt(specialist: &SpecialistDef, user_request: &str) -> String {
    let mut prompt = specialist.system_prompt.clone();
    if let Some(reminder) = &specialist.role_reminder {
        if !reminder.trim().is_empty() {
            prompt.push_str(&format!("\n\n---\n**Reminder:** {reminder}"));
        }
    }
    prompt.push_str(&format!("\n\n---\n\n## User Request\n\n{user_request}"));
    prompt
}

pub(crate) async fn wait_for_turn_complete_with_updates(
    state: &AppState,
    session_id: &str,
    rx: &mut tokio::sync::broadcast::Receiver<serde_json::Value>,
    verbose: bool,
) -> Result<String, String> {
    let mut renderer = if verbose {
        Some(crate::commands::tui::TuiRenderer::new())
    } else {
        None
    };
    let mut collected_output = String::new();
    let mut idle_count = 0u32;
    let max_idle = 120;
    let idle_with_output_threshold = 15;

    loop {
        match tokio::time::timeout(Duration::from_secs(1), rx.recv()).await {
            Ok(Ok(update)) => {
                if let Some(renderer) = renderer.as_mut() {
                    renderer.handle_update(&update);
                }

                if let Some(text) = update
                    .get("params")
                    .and_then(|params| params.get("update"))
                    .and_then(|value| value.as_object())
                    .and_then(extract_update_text)
                {
                    collected_output.push_str(&text);
                }
                idle_count = 0;

                let is_done = update
                    .get("params")
                    .and_then(|params| params.get("update"))
                    .and_then(|update| update.get("sessionUpdate"))
                    .and_then(|value| value.as_str())
                    == Some("turn_complete");
                if is_done {
                    if let Some(renderer) = renderer.as_mut() {
                        renderer.finish();
                    }
                    return Ok(collected_output);
                }
            }
            Ok(Err(err)) => match err {
                tokio::sync::broadcast::error::RecvError::Lagged(_) => {
                    // Large sessions (for example codex-acp) can emit many updates quickly.
                    // Keep consuming the latest updates instead of terminating early.
                    idle_count = 0;
                }
                tokio::sync::broadcast::error::RecvError::Closed => {
                    if let Some(renderer) = renderer.as_mut() {
                        renderer.finish();
                    }
                    return Ok(collected_output);
                }
            },
            Err(_) => {
                idle_count += 1;
                if idle_count >= idle_with_output_threshold && !collected_output.trim().is_empty() {
                    if let Some(renderer) = renderer.as_mut() {
                        renderer.finish();
                    }
                    return Ok(collected_output);
                }
                if idle_count >= max_idle {
                    if let Some(renderer) = renderer.as_mut() {
                        renderer.finish();
                    }
                    return Ok(collected_output);
                }

                if !state.acp_manager.is_alive(session_id).await {
                    if let Some(renderer) = renderer.as_mut() {
                        renderer.finish();
                    }
                    return Ok(collected_output);
                }
            }
        }

        if let Some(history) = state.acp_manager.get_session_history(session_id).await {
            if update_contains_turn_complete(&history) {
                if let Some(renderer) = renderer.as_mut() {
                    renderer.finish();
                }
                if collected_output.trim().is_empty() {
                    return Ok(extract_agent_output_from_history(&history));
                }
                return Ok(collected_output);
            }
        } else if !state.acp_manager.is_alive(session_id).await {
            if let Some(renderer) = renderer.as_mut() {
                renderer.finish();
            }
            return Ok(collected_output);
        }
    }
}

pub(crate) async fn wait_for_turn_complete_without_updates(
    state: &AppState,
    session_id: &str,
) -> Result<(), String> {
    let mut idle_ticks = 0u32;
    let max_idle = 600;
    loop {
        match state.acp_manager.get_session_history(session_id).await {
            Some(history) if update_contains_turn_complete(&history) => return Ok(()),
            Some(_) => {}
            None => {
                return Err("Session disappeared before completion.".to_string());
            }
        }

        if !state.acp_manager.is_alive(session_id).await {
            return Ok(());
        }

        tokio::time::sleep(Duration::from_secs(1)).await;
        idle_ticks += 1;
        if idle_ticks >= max_idle {
            return Ok(());
        }
    }
}
