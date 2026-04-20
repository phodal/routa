//! `routa task` — Task management commands.

use routa_core::rpc::RpcRouter;
use routa_core::state::AppState;

use super::{format_rfc3339_timestamp, print_json, truncate_text};

pub async fn list(state: &AppState, workspace_id: &str, limit: usize) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tasks.list",
            "params": { "workspaceId": workspace_id }
        }))
        .await;

    if let Some(tasks) = response
        .get("result")
        .and_then(|result| result.get("tasks"))
        .and_then(|value| value.as_array())
    {
        let shown = tasks.len().min(limit);
        let hidden = tasks.len().saturating_sub(shown);
        println!("Tasks ({shown} shown, {hidden} hidden) in workspace {workspace_id}:");
        for task in tasks.iter().take(limit) {
            let status = task
                .get("status")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown");
            let lane = task
                .get("columnId")
                .and_then(|value| value.as_str())
                .unwrap_or("-");
            let title = task
                .get("title")
                .and_then(|value| value.as_str())
                .unwrap_or("untitled");
            let assigned_role = task
                .get("assignedRole")
                .and_then(|value| value.as_str())
                .unwrap_or("-");
            let updated_at =
                format_rfc3339_timestamp(task.get("updatedAt").and_then(|value| value.as_str()));
            let id = task
                .get("id")
                .and_then(|value| value.as_str())
                .unwrap_or("?");
            println!(
                "  {:<18} {:<10} {:<12} {:<16} {}  {}",
                status,
                lane,
                assigned_role,
                updated_at,
                short_id(id),
                truncate_text(title, 52)
            );
        }
    } else {
        print_json(&response);
    }

    Ok(())
}

fn short_id(value: &str) -> &str {
    value.get(..8).unwrap_or(value)
}

pub async fn create(
    state: &AppState,
    title: &str,
    objective: &str,
    workspace_id: &str,
    scope: Option<&str>,
    acceptance_criteria: Option<Vec<String>>,
) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let mut params = serde_json::json!({
        "title": title,
        "objective": objective,
        "workspaceId": workspace_id
    });
    if let Some(s) = scope {
        params["scope"] = serde_json::json!(s);
    }
    if let Some(ac) = acceptance_criteria {
        params["acceptanceCriteria"] = serde_json::json!(ac);
    }
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tasks.create",
            "params": params
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn get(state: &AppState, task_id: &str) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tasks.get",
            "params": { "id": task_id }
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn update_status(
    state: &AppState,
    task_id: &str,
    status: &str,
    _agent_id: &str,
    _summary: Option<&str>,
) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tasks.updateStatus",
            "params": {
                "id": task_id,
                "status": status
            }
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn list_artifacts(
    state: &AppState,
    task_id: &str,
    artifact_type: Option<&str>,
) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let mut params = serde_json::json!({
        "taskId": task_id
    });
    if let Some(artifact_type) = artifact_type {
        params["type"] = serde_json::json!(artifact_type);
    }
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tasks.listArtifacts",
            "params": params
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn provide_artifact(
    state: &AppState,
    task_id: &str,
    agent_id: &str,
    artifact_type: &str,
    content: &str,
    context: Option<&str>,
) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let mut params = serde_json::json!({
        "taskId": task_id,
        "agentId": agent_id,
        "type": artifact_type,
        "content": content
    });
    if let Some(context) = context {
        params["context"] = serde_json::json!(context);
    }
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tasks.provideArtifact",
            "params": params
        }))
        .await;
    print_json(&response);
    Ok(())
}
