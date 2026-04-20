//! MCP Streamable HTTP API - /api/mcp
//!
//! Uses the official rmcp `StreamableHttpService` for session management,
//! SSE framing, and JSON-RPC transport behavior.

mod rmcp_service;
mod tool_catalog;
mod tool_executor;

use axum::{
    body::Body,
    http::{header::ACCEPT, HeaderValue, Request, Response},
    response::IntoResponse,
    routing::get,
    Router,
};
use serde::Deserialize;

use crate::state::AppState;

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct McpRequestQuery {
    #[serde(rename = "wsId")]
    ws_id: Option<String>,
    mcp_profile: Option<String>,
}

pub fn router(state: AppState) -> Router<AppState> {
    let service = rmcp_service::build_service(state);

    Router::new().route(
        "/",
        get({
            let service = service.clone();
            move |request| handle_get(service, request)
        })
        .post({
            let service = service.clone();
            move |request| handle_post(service, request)
        })
        .delete(move |request| handle_delete(service, request)),
    )
}

async fn handle_get(
    service: rmcp_service::SharedMcpHttpService,
    request: Request<Body>,
) -> impl IntoResponse {
    with_exposed_headers(
        service
            .handle(ensure_accept_header(request, &["text/event-stream"]))
            .await,
    )
}

async fn handle_post(
    service: rmcp_service::SharedMcpHttpService,
    request: Request<Body>,
) -> impl IntoResponse {
    with_exposed_headers(
        service
            .handle(ensure_accept_header(
                request,
                &["application/json", "text/event-stream"],
            ))
            .await,
    )
}

async fn handle_delete(
    service: rmcp_service::SharedMcpHttpService,
    request: Request<Body>,
) -> impl IntoResponse {
    with_exposed_headers(service.handle(request).await)
}

fn ensure_accept_header(mut request: Request<Body>, required: &[&str]) -> Request<Body> {
    let current = request
        .headers()
        .get(ACCEPT)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if required.iter().all(|value| current.contains(value)) {
        return request;
    }

    let mut parts = current
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    for value in required {
        if !parts.iter().any(|existing| existing == value) {
            parts.push((*value).to_string());
        }
    }

    if let Ok(value) = HeaderValue::from_str(&parts.join(", ")) {
        request.headers_mut().insert(ACCEPT, value);
    }
    request
}

fn with_exposed_headers<B>(mut response: Response<B>) -> Response<B> {
    response.headers_mut().insert(
        "access-control-expose-headers",
        HeaderValue::from_static("Mcp-Session-Id, MCP-Protocol-Version"),
    );
    response
}

// ─── Public Tool Surface (used by mcp_tools module) ───────────────────

pub fn build_tool_list_public() -> Vec<serde_json::Value> {
    tool_catalog::build_tool_list_public()
}

pub async fn execute_tool_public(
    state: &AppState,
    name: &str,
    args: &serde_json::Value,
) -> serde_json::Value {
    tool_executor::execute_tool_public(state, name, args).await
}

pub fn normalize_tool_name_public(name: &str) -> &str {
    tool_executor::normalize_tool_name_public(name)
}

pub(super) fn inject_workspace_id(args: &mut serde_json::Value, workspace_id: &str) {
    if !args.is_object() {
        *args = serde_json::json!({ "workspaceId": workspace_id });
        return;
    }

    if let Some(object) = args.as_object_mut() {
        object
            .entry("workspaceId".to_string())
            .or_insert_with(|| serde_json::json!(workspace_id));
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::{
        body::Body,
        http::{header::ACCEPT, Request},
    };

    use super::{
        build_tool_list_public, ensure_accept_header, execute_tool_public, inject_workspace_id,
        normalize_tool_name_public,
    };

    #[test]
    fn inject_workspace_id_sets_for_non_object_args() {
        let mut args = serde_json::json!("not-an-object");
        inject_workspace_id(&mut args, "workspace-a");
        assert_eq!(args, serde_json::json!({ "workspaceId": "workspace-a" }));
    }

    #[test]
    fn inject_workspace_id_adds_when_missing() {
        let mut args = serde_json::json!({ "name": "demo" });
        inject_workspace_id(&mut args, "workspace-b");
        assert_eq!(
            args,
            serde_json::json!({ "name": "demo", "workspaceId": "workspace-b" })
        );
    }

    #[test]
    fn inject_workspace_id_preserves_existing_value() {
        let mut args = serde_json::json!({ "workspaceId": "existing", "name": "demo" });
        inject_workspace_id(&mut args, "workspace-new");
        assert_eq!(
            args,
            serde_json::json!({ "workspaceId": "existing", "name": "demo" })
        );
    }

    #[test]
    fn ensure_accept_header_appends_missing_values() {
        let request = Request::builder()
            .uri("/api/mcp")
            .header(ACCEPT, "application/json")
            .body(Body::empty())
            .expect("build request");

        let request = ensure_accept_header(request, &["application/json", "text/event-stream"]);
        let accept = request
            .headers()
            .get(ACCEPT)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");

        assert!(accept.contains("application/json"));
        assert!(accept.contains("text/event-stream"));
    }

    #[test]
    fn build_tool_list_public_contains_expected_tool() {
        let tools = build_tool_list_public();
        let has_delegate_tool = tools.iter().any(|tool| {
            tool.get("name").and_then(|v| v.as_str()) == Some("delegate_task_to_agent")
        });
        assert!(
            has_delegate_tool,
            "delegate_task_to_agent should exist in MCP tool list"
        );
    }

    #[test]
    fn normalize_tool_name_public_handles_aliases() {
        assert_eq!(
            normalize_tool_name_public("routa-coordination_list_agents"),
            "list_agents"
        );
        assert_eq!(
            normalize_tool_name_public("kanban-planning-mcp_create_card"),
            "create_card"
        );
    }

    #[tokio::test]
    async fn execute_tool_public_returns_error_for_unknown_tool() {
        let db = crate::db::Database::open(":memory:").expect("open in-memory database");
        let state: crate::state::AppState = Arc::new(crate::state::AppStateInner::new(db));
        state
            .workspace_store
            .ensure_default()
            .await
            .expect("ensure default workspace");

        let result = execute_tool_public(&state, "unknown_tool_name", &serde_json::json!({})).await;
        assert_eq!(result.get("isError").and_then(|v| v.as_bool()), Some(true));
    }
}
