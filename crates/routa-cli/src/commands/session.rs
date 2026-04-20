//! `routa session` — ACP session discovery and resume helpers.

use dialoguer::{theme::ColorfulTheme, Select};
use routa_core::state::AppState;
use routa_core::store::acp_session_store::AcpSessionRow;

use super::{chat, format_timestamp_millis, print_json, truncate_text};

pub async fn list(
    state: &AppState,
    workspace_id: Option<&str>,
    limit: usize,
) -> Result<(), String> {
    let sessions = state
        .acp_session_store
        .list(workspace_id, Some(limit))
        .await
        .map_err(|e| format!("Failed to list sessions: {e}"))?;

    println!(
        "Sessions ({}){}:",
        sessions.len(),
        workspace_id
            .map(|id| format!(" in workspace {id}"))
            .unwrap_or_default()
    );
    for session in &sessions {
        println!("  {}", format_session_row(session));
    }

    Ok(())
}

pub async fn get(state: &AppState, session_id: &str) -> Result<(), String> {
    let session = state
        .acp_session_store
        .get(session_id)
        .await
        .map_err(|e| format!("Failed to load session {session_id}: {e}"))?
        .ok_or_else(|| format!("Session not found: {session_id}"))?;
    let response = serde_json::json!({ "session": session });
    print_json(&response);
    Ok(())
}

pub async fn pick(
    state: &AppState,
    workspace_id: Option<&str>,
    provider: &str,
    role: &str,
    limit: usize,
) -> Result<(), String> {
    let sessions = state
        .acp_session_store
        .list(workspace_id, Some(limit))
        .await
        .map_err(|e| format!("Failed to list sessions: {e}"))?;

    if sessions.is_empty() {
        return Err("No persisted sessions found".to_string());
    }

    let items: Vec<String> = sessions.iter().map(format_session_row).collect();
    let selection = Select::with_theme(&ColorfulTheme::default())
        .with_prompt("Select a session")
        .items(&items)
        .default(0)
        .interact_opt()
        .map_err(|e| format!("Failed to choose session: {e}"))?;

    let Some(index) = selection else {
        return Ok(());
    };
    let session = &sessions[index];
    chat::run(
        state,
        &session.workspace_id,
        provider,
        role,
        Some(&session.id),
    )
    .await
}

fn format_session_row(session: &AcpSessionRow) -> String {
    let title = session
        .name
        .clone()
        .unwrap_or_else(|| format!("session {}", short_id(&session.id)));
    let provider = session.provider.as_deref().unwrap_or("unknown");
    let role = session.role.as_deref().unwrap_or("unknown");
    let updated_at = format_timestamp_millis(session.updated_at);
    let prompt_status = if session.first_prompt_sent {
        "sent"
    } else {
        "idle"
    };

    format!(
        "{} [{} / {}] {}  {}  {}",
        truncate_text(&title, 36),
        provider,
        role,
        updated_at,
        prompt_status,
        short_id(&session.id)
    )
}

fn short_id(value: &str) -> &str {
    value.get(..8).unwrap_or(value)
}
