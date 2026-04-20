mod agents_tasks;
mod delegation;
mod events_kanban;
mod notes_workspace;

use crate::rpc::RpcRouter;
use crate::state::AppState;

pub(super) async fn execute_tool_public(
    state: &AppState,
    name: &str,
    args: &serde_json::Value,
) -> serde_json::Value {
    execute_tool(state, normalize_tool_name(name), args).await
}

pub(super) fn normalize_tool_name_public(name: &str) -> &str {
    normalize_tool_name(name)
}

async fn execute_tool(state: &AppState, name: &str, args: &serde_json::Value) -> serde_json::Value {
    let workspace_id = args
        .get("workspaceId")
        .and_then(|v| v.as_str())
        .unwrap_or("default");

    if let Some(result) = agents_tasks::execute(state, name, args, workspace_id).await {
        return result;
    }
    if let Some(result) = delegation::execute(state, name, args, workspace_id).await {
        return result;
    }
    if let Some(result) = notes_workspace::execute(state, name, args, workspace_id).await {
        return result;
    }
    if let Some(result) = events_kanban::execute(state, name, args, workspace_id).await {
        return result;
    }

    tool_result_error(&format!("Unknown tool: {name}"))
}

fn normalize_tool_name(name: &str) -> &str {
    name.strip_prefix("routa-coordination_")
        .or_else(|| name.strip_prefix("kanban-planning-mcp_"))
        .unwrap_or(name)
}

pub(super) fn tool_result_text(text: &str) -> serde_json::Value {
    serde_json::json!({
        "isError": false,
        "content": [{ "type": "text", "text": text }]
    })
}

pub(super) async fn rpc_tool_result(
    state: &AppState,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let rpc = RpcRouter::new(state.clone());
    let response = rpc
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        }))
        .await;

    if let Some(result) = response.get("result") {
        Ok(result.clone())
    } else {
        Err(response
            .get("error")
            .and_then(|value| value.get("message"))
            .and_then(|value| value.as_str())
            .unwrap_or("RPC error")
            .to_string())
    }
}

pub(super) fn tool_result_json(value: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "isError": false,
        "content": [{ "type": "text", "text": serde_json::to_string_pretty(value).unwrap_or_default() }]
    })
}

pub(super) fn tool_result_error(msg: &str) -> serde_json::Value {
    serde_json::json!({
        "isError": true,
        "content": [{ "type": "text", "text": msg }]
    })
}

#[cfg(test)]
mod tests {
    use super::normalize_tool_name_public;

    #[test]
    fn normalize_tool_name_supports_compat_prefixes() {
        assert_eq!(
            normalize_tool_name_public("routa-coordination_list_agents"),
            "list_agents"
        );
        assert_eq!(
            normalize_tool_name_public("kanban-planning-mcp_create_card"),
            "create_card"
        );
        assert_eq!(normalize_tool_name_public("list_tasks"), "list_tasks");
    }
}
