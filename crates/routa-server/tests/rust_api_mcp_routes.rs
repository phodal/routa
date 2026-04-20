use std::collections::HashSet;

use reqwest::{header::CONTENT_TYPE, Response, StatusCode};
use serde_json::{json, Value};

#[path = "common/mod.rs"]
mod common;
use common::ApiFixture;

impl ApiFixture {
    fn mcp_endpoint(&self, query: Option<&str>) -> String {
        let mut endpoint = "/api/mcp".to_string();
        if let Some(query) = query {
            endpoint.push('?');
            endpoint.push_str(query);
        }
        self.endpoint(&endpoint)
    }

    async fn post_mcp(
        &self,
        query: Option<&str>,
        session_id: Option<&str>,
        body: Value,
    ) -> Response {
        let mut request = self
            .client
            .post(self.mcp_endpoint(query))
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream");

        if let Some(session_id) = session_id {
            request = request.header("mcp-session-id", session_id);
        }

        request.json(&body).send().await.expect("POST /api/mcp")
    }

    async fn get_mcp(&self, session_id: Option<&str>) -> Response {
        let mut request = self
            .client
            .get(self.endpoint("/api/mcp"))
            .header("accept", "text/event-stream");

        if let Some(session_id) = session_id {
            request = request.header("mcp-session-id", session_id);
        }

        request.send().await.expect("GET /api/mcp")
    }

    async fn delete_mcp(&self, session_id: Option<&str>) -> Response {
        let mut request = self.client.delete(self.endpoint("/api/mcp"));
        if let Some(session_id) = session_id {
            request = request.header("mcp-session-id", session_id);
        }
        request.send().await.expect("DELETE /api/mcp")
    }

    async fn initialize_session(&self, query: Option<&str>) -> (String, Value) {
        let response = self
            .post_mcp(
                query,
                None,
                json!({
                    "jsonrpc": "2.0",
                    "id": "init",
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2025-06-18",
                        "capabilities": {},
                        "clientInfo": {
                            "name": "routa-server-test",
                            "version": "1.0.0"
                        }
                    }
                }),
            )
            .await;

        assert_eq!(response.status(), StatusCode::OK);
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        assert!(
            content_type.contains("text/event-stream"),
            "initialize should return SSE, got: {content_type}"
        );

        let session_id = response
            .headers()
            .get("mcp-session-id")
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
            .expect("initialize response should include mcp-session-id");
        let body = read_first_sse_json(response, "initialize response").await;
        (session_id, body)
    }

    async fn complete_initialization(&self, query: Option<&str>, session_id: &str) {
        let response = self
            .post_mcp(
                query,
                Some(session_id),
                json!({
                    "jsonrpc": "2.0",
                    "method": "notifications/initialized"
                }),
            )
            .await;
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        let body = read_text(response, "initialized notification response").await;
        assert!(
            body.trim().is_empty(),
            "notifications/initialized should not return a body, got: {body:?}"
        );
    }
}

async fn read_json(response: Response, label: &str) -> Value {
    response
        .json()
        .await
        .unwrap_or_else(|_| panic!("decode JSON response: {label}"))
}

async fn read_text(response: Response, label: &str) -> String {
    response
        .text()
        .await
        .unwrap_or_else(|_| panic!("decode text response: {label}"))
}

async fn read_first_sse_json(response: Response, label: &str) -> Value {
    let body = read_text(response, label).await;
    first_sse_json(&body, label)
}

fn first_sse_json(body: &str, label: &str) -> Value {
    for event in body.split("\n\n") {
        let data = event
            .lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .map(str::trim_start)
            .collect::<Vec<_>>()
            .join("\n");

        if data.trim().is_empty() {
            continue;
        }

        if let Ok(value) = serde_json::from_str(&data) {
            return value;
        }
    }

    panic!("expected JSON SSE event for {label}, got body: {body}");
}

#[tokio::test]
async fn api_mcp_session_lifecycle_and_sse_contract() {
    let fixture = ApiFixture::new().await;

    let get_without_session = fixture.get_mcp(None).await;
    assert_eq!(get_without_session.status(), StatusCode::UNAUTHORIZED);
    let get_without_session_text = read_text(get_without_session, "get without session").await;
    assert!(
        get_without_session_text.contains("Session ID is required"),
        "unexpected GET without session response: {get_without_session_text}"
    );

    let delete_without_session = fixture.delete_mcp(None).await;
    assert_eq!(delete_without_session.status(), StatusCode::UNAUTHORIZED);
    let delete_without_session_text =
        read_text(delete_without_session, "delete without session").await;
    assert!(
        delete_without_session_text.contains("Session ID is required"),
        "unexpected DELETE without session response: {delete_without_session_text}"
    );

    let (session_id, initialize_json) = fixture.initialize_session(None).await;
    assert_eq!(
        initialize_json["result"]["protocolVersion"],
        json!("2025-06-18")
    );

    let initialized_response = fixture
        .post_mcp(
            None,
            Some(&session_id),
            json!({
                "jsonrpc": "2.0",
                "method": "notifications/initialized"
            }),
        )
        .await;
    assert_eq!(initialized_response.status(), StatusCode::ACCEPTED);
    let initialized_body = read_text(initialized_response, "initialized response").await;
    assert!(
        initialized_body.trim().is_empty(),
        "notifications/initialized should not return a body, got: {initialized_body:?}"
    );

    let get_with_session = fixture.get_mcp(Some(&session_id)).await;
    assert_eq!(get_with_session.status(), StatusCode::OK);
    let content_type = get_with_session
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    assert!(
        content_type.contains("text/event-stream"),
        "expected SSE content type, got: {content_type}"
    );

    let delete_session = fixture.delete_mcp(Some(&session_id)).await;
    assert_eq!(delete_session.status(), StatusCode::ACCEPTED);
    let delete_body = read_text(delete_session, "delete session response").await;
    assert!(
        delete_body.trim().is_empty(),
        "DELETE /api/mcp should not return a body, got: {delete_body:?}"
    );

    let get_after_delete = fixture.get_mcp(Some(&session_id)).await;
    assert_eq!(get_after_delete.status(), StatusCode::UNAUTHORIZED);
    let get_after_delete_text = read_text(get_after_delete, "get after delete").await;
    assert!(
        get_after_delete_text.contains("Session not found"),
        "unexpected GET after delete response: {get_after_delete_text}"
    );
}

#[tokio::test]
async fn api_mcp_unknown_method_returns_jsonrpc_method_not_found() {
    let fixture = ApiFixture::new().await;
    let (session_id, _) = fixture.initialize_session(None).await;
    fixture.complete_initialization(None, &session_id).await;

    let response = fixture
        .post_mcp(
            None,
            Some(&session_id),
            json!({
                "jsonrpc": "2.0",
                "id": "unknown-method",
                "method": "does/not/exist"
            }),
        )
        .await;
    assert_eq!(response.status(), StatusCode::OK);

    let body = read_first_sse_json(response, "unknown method response").await;
    assert_eq!(body["error"]["code"], json!(-32601));
}

#[tokio::test]
async fn api_mcp_kanban_profile_filters_tools_list() {
    let fixture = ApiFixture::new().await;
    let profile_query = "mcpProfile=kanban-planning";
    let (session_id, _) = fixture.initialize_session(Some(profile_query)).await;
    fixture
        .complete_initialization(Some(profile_query), &session_id)
        .await;

    let response = fixture
        .post_mcp(
            Some(profile_query),
            Some(&session_id),
            json!({
                "jsonrpc": "2.0",
                "id": "tools-list",
                "method": "tools/list",
                "params": {}
            }),
        )
        .await;
    assert_eq!(response.status(), StatusCode::OK);

    let body = read_first_sse_json(response, "kanban tools/list response").await;
    let tools = body["result"]["tools"]
        .as_array()
        .expect("tools/list should return tools array");
    let names: Vec<&str> = tools
        .iter()
        .filter_map(|tool| tool["name"].as_str())
        .collect();
    assert!(!names.is_empty(), "kanban profile should expose tools");

    let allowed: HashSet<&str> = [
        "create_card",
        "decompose_tasks",
        "search_cards",
        "list_cards_by_column",
        "update_task",
        "update_card",
        "move_card",
        "request_previous_lane_handoff",
        "submit_lane_handoff",
    ]
    .into_iter()
    .collect();

    assert!(
        names.iter().all(|name| allowed.contains(name)),
        "kanban profile should only expose allowed tools, got: {names:?}"
    );
    assert!(
        names.contains(&"create_card") && names.contains(&"decompose_tasks"),
        "kanban profile should include planning tools, got: {names:?}"
    );
}

#[tokio::test]
async fn api_mcp_default_profile_exposes_canvas_sdk_resource_tool() {
    let fixture = ApiFixture::new().await;
    let (session_id, _) = fixture.initialize_session(None).await;
    fixture.complete_initialization(None, &session_id).await;

    let list_response = fixture
        .post_mcp(
            None,
            Some(&session_id),
            json!({
                "jsonrpc": "2.0",
                "id": "tools-list-default",
                "method": "tools/list",
                "params": {}
            }),
        )
        .await;
    assert_eq!(list_response.status(), StatusCode::OK);

    let list_body = read_first_sse_json(list_response, "default tools/list response").await;
    let tools = list_body["result"]["tools"]
        .as_array()
        .expect("tools/list should return tools array");
    assert!(
        tools
            .iter()
            .any(|tool| tool["name"] == "read_canvas_sdk_resource"),
        "default profile should expose read_canvas_sdk_resource"
    );
    assert!(
        tools
            .iter()
            .any(|tool| tool["name"] == "read_specialist_spec_resource"),
        "default profile should expose read_specialist_spec_resource"
    );

    let call_response = fixture
        .post_mcp(
            None,
            Some(&session_id),
            json!({
                "jsonrpc": "2.0",
                "id": "tools-call-canvas-sdk",
                "method": "tools/call",
                "params": {
                    "name": "read_canvas_sdk_resource",
                    "arguments": {
                        "uri": "resource://routa/canvas-sdk/manifest"
                    }
                }
            }),
        )
        .await;
    assert_eq!(call_response.status(), StatusCode::OK);

    let call_body = read_first_sse_json(call_response, "canvas sdk tool call response").await;
    let content_text = call_body["result"]["content"][0]["text"]
        .as_str()
        .expect("tool call should return text content");
    let payload: Value = serde_json::from_str(content_text).expect("parse tool payload");
    assert_eq!(
        payload["uri"],
        json!("resource://routa/canvas-sdk/manifest")
    );
    assert_eq!(payload["mimeType"], json!("application/json"));
    assert!(
        payload["text"]
            .as_str()
            .is_some_and(|text| text.contains("\"moduleSpecifier\": \"@canvas-sdk\"")),
        "manifest payload should contain canvas sdk module specifier"
    );

    let feature_tree_call_response = fixture
        .post_mcp(
            None,
            Some(&session_id),
            json!({
                "jsonrpc": "2.0",
                "id": "tools-call-feature-tree-spec",
                "method": "tools/call",
                "params": {
                    "name": "read_specialist_spec_resource",
                    "arguments": {
                        "uri": "resource://routa/specialists/feature-tree/manifest"
                    }
                }
            }),
        )
        .await;
    assert_eq!(feature_tree_call_response.status(), StatusCode::OK);

    let feature_tree_call_body = read_first_sse_json(
        feature_tree_call_response,
        "feature tree spec tool call response",
    )
    .await;
    let feature_tree_content_text = feature_tree_call_body["result"]["content"][0]["text"]
        .as_str()
        .expect("feature tree tool call should return text content");
    let feature_tree_payload: Value =
        serde_json::from_str(feature_tree_content_text).expect("parse feature tree tool payload");
    assert_eq!(
        feature_tree_payload["uri"],
        json!("resource://routa/specialists/feature-tree/manifest")
    );
    assert_eq!(feature_tree_payload["mimeType"], json!("application/json"));
    assert!(
        feature_tree_payload["text"]
            .as_str()
            .is_some_and(|text| text.contains("\"availableSpecIds\"")),
        "feature tree manifest payload should contain bundled spec ids"
    );
}

#[tokio::test]
async fn api_mcp_kanban_profile_rejects_disallowed_tool_call() {
    let fixture = ApiFixture::new().await;
    let profile_query = "mcpProfile=kanban-planning";
    let (session_id, _) = fixture.initialize_session(Some(profile_query)).await;
    fixture
        .complete_initialization(Some(profile_query), &session_id)
        .await;

    let response = fixture
        .post_mcp(
            Some(profile_query),
            Some(&session_id),
            json!({
                "jsonrpc": "2.0",
                "id": "tools-call",
                "method": "tools/call",
                "params": {
                    "name": "list_agents",
                    "arguments": {}
                }
            }),
        )
        .await;
    assert_eq!(response.status(), StatusCode::OK);

    let body = read_first_sse_json(response, "disallowed tools/call response").await;
    assert_eq!(body["error"]["code"], json!(-32602));
    assert!(
        body["error"]["message"]
            .as_str()
            .is_some_and(|msg| msg.contains("Tool not allowed for MCP profile")),
        "expected MCP profile rejection message, got: {body}"
    );
}

#[tokio::test]
async fn api_mcp_kanban_profile_allows_update_task_for_story_readiness() {
    let fixture = ApiFixture::new().await;

    let create_response = fixture
        .client
        .post(fixture.endpoint("/api/tasks"))
        .json(&json!({
            "title": "Refine story contract",
            "objective": "Clarify the card before dev",
            "workspaceId": "default"
        }))
        .send()
        .await
        .expect("POST /api/tasks");
    assert_eq!(create_response.status(), StatusCode::CREATED);
    let create_body = read_json(create_response, "create task response").await;
    let task_id = create_body["task"]["id"]
        .as_str()
        .expect("created task should include id");

    let profile_query = "mcpProfile=kanban-planning";
    let (session_id, _) = fixture.initialize_session(Some(profile_query)).await;
    fixture
        .complete_initialization(Some(profile_query), &session_id)
        .await;

    let update_response = fixture
        .post_mcp(
            Some(profile_query),
            Some(&session_id),
            json!({
                "jsonrpc": "2.0",
                "id": "tools-call-update-task",
                "method": "tools/call",
                "params": {
                    "name": "update_task",
                    "arguments": {
                        "taskId": task_id,
                        "scope": "Touch only the kanban readiness path",
                        "acceptanceCriteria": ["Gate lists missing structured fields"],
                        "verificationCommands": ["npm run test -- kanban"],
                        "testCases": ["Move to Dev is unblocked once fields exist"]
                    }
                }
            }),
        )
        .await;
    assert_eq!(update_response.status(), StatusCode::OK);
    let update_body = read_first_sse_json(update_response, "update_task response").await;
    let update_text = update_body["result"]["content"][0]["text"]
        .as_str()
        .expect("update_task should return text payload");
    let update_json: Value = serde_json::from_str(update_text).expect("parse update_task payload");
    assert_eq!(update_json["success"], json!(true));

    let get_response = fixture
        .client
        .get(fixture.endpoint(&format!("/api/tasks/{task_id}")))
        .send()
        .await
        .expect("GET /api/tasks/{id}");
    assert_eq!(get_response.status(), StatusCode::OK);
    let get_body = read_json(get_response, "get task after update_task").await;
    assert_eq!(
        get_body["task"]["scope"],
        json!("Touch only the kanban readiness path")
    );
    assert_eq!(
        get_body["task"]["acceptanceCriteria"],
        json!(["Gate lists missing structured fields"])
    );
    assert_eq!(
        get_body["task"]["verificationCommands"],
        json!(["npm run test -- kanban"])
    );
    assert_eq!(
        get_body["task"]["testCases"],
        json!(["Move to Dev is unblocked once fields exist"])
    );
}
