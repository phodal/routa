//! `routa workspace` — Workspace management commands.

use routa_core::rpc::RpcRouter;
use routa_core::state::AppState;

use super::{format_rfc3339_timestamp, print_json, truncate_text};

pub async fn list(state: &AppState, limit: usize) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "workspaces.list"
        }))
        .await;

    if let Some(workspaces) = response
        .get("result")
        .and_then(|result| result.get("workspaces"))
        .and_then(|value| value.as_array())
    {
        let shown = workspaces.len().min(limit);
        let hidden = workspaces.len().saturating_sub(shown);
        println!("Workspaces ({shown} shown, {hidden} hidden):");
        for workspace in workspaces.iter().take(limit) {
            let status = workspace
                .get("status")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown");
            let title = workspace
                .get("title")
                .and_then(|value| value.as_str())
                .unwrap_or("untitled");
            let updated_at = format_rfc3339_timestamp(
                workspace.get("updatedAt").and_then(|value| value.as_str()),
            );
            let id = workspace
                .get("id")
                .and_then(|value| value.as_str())
                .unwrap_or("?");
            println!(
                "  {:<8} {:<18} {:<34} {}",
                status,
                truncate_text(id, 18),
                truncate_text(title, 34),
                updated_at
            );
        }
    } else {
        print_json(&response);
    }

    Ok(())
}

pub async fn create(state: &AppState, name: &str) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "workspaces.create",
            "params": { "title": name }
        }))
        .await;
    print_json(&response);
    Ok(())
}
