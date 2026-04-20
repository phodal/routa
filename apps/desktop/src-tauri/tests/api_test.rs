//! Integration test: start the Rust backend server and verify API endpoints.

use axum::{
    body::{to_bytes, Body},
    http::{Method, Request, StatusCode},
};
use serde_json::{json, Value};
use tower::util::ServiceExt;

async fn request_json(
    app: &axum::Router,
    method: Method,
    uri: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(uri);
    let request = if let Some(body) = body {
        builder = builder.header("content-type", "application/json");
        builder.body(Body::from(body.to_string())).unwrap()
    } else {
        builder.body(Body::empty()).unwrap()
    };

    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };

    (status, body)
}

async fn get_json(app: &axum::Router, uri: &str) -> (StatusCode, Value) {
    request_json(app, Method::GET, uri, None).await
}

async fn post_json(app: &axum::Router, uri: &str, body: Value) -> (StatusCode, Value) {
    request_json(app, Method::POST, uri, Some(body)).await
}

#[tokio::test]
async fn test_rust_backend_api() {
    // Start server on a random port
    // We need to manually set up the server for testing
    let db = routa_desktop_lib::server::db::Database::open_in_memory().unwrap();
    let state: routa_desktop_lib::server::state::AppState =
        std::sync::Arc::new(routa_desktop_lib::server::state::AppStateInner::new(db));

    state.workspace_store.ensure_default().await.unwrap();

    let cors = tower_http::cors::CorsLayer::new()
        .allow_origin(tower_http::cors::Any)
        .allow_methods(tower_http::cors::Any)
        .allow_headers(tower_http::cors::Any);

    let app = axum::Router::new()
        .merge(routa_desktop_lib::server::api::api_router(state.clone()))
        .route(
            "/api/health",
            axum::routing::get(|| async { axum::Json(serde_json::json!({"status": "ok"})) }),
        )
        .layer(cors)
        .with_state(state);

    // ── Test 1: Health Check ──────────────────────────────────────
    println!("=== Test 1: Health Check ===");
    let (status, body) = request_json(&app, Method::GET, "/api/health", None).await;
    assert_eq!(status, 200);
    assert_eq!(body["status"], "ok");
    println!("  PASS: {body}");

    // ── Test 2: List Workspaces ────────────────────────────────────
    println!("=== Test 2: List Workspaces ===");
    let (status, body) = request_json(&app, Method::GET, "/api/workspaces", None).await;
    assert_eq!(status, 200);
    let workspaces = body["workspaces"].as_array().unwrap();
    assert!(!workspaces.is_empty(), "Should have default workspace");
    println!("  PASS: {} workspace(s)", workspaces.len());

    // ── Test 3: List Agents (empty) ─────────────────────────────────
    println!("=== Test 3: List Agents (empty) ===");
    let (status, body) = request_json(&app, Method::GET, "/api/agents", None).await;
    assert_eq!(status, 200);
    let agents = body["agents"].as_array().unwrap();
    assert_eq!(agents.len(), 0);
    println!("  PASS: {} agents", agents.len());

    // ── Test 4: Create Agent ────────────────────────────────────────
    println!("=== Test 4: Create Agent ===");
    let (status, body) = request_json(
        &app,
        Method::POST,
        "/api/agents",
        Some(json!({
            "name": "Test ROUTA",
            "role": "ROUTA"
        })),
    )
    .await;
    assert_eq!(status, 200);
    let agent_id = body["agentId"].as_str().unwrap().to_string();
    assert!(!agent_id.is_empty());
    println!("  PASS: created agent {agent_id}");

    // ── Test 5: List Agents (should have 1) ─────────────────────────
    println!("=== Test 5: List Agents (should have 1) ===");
    let (_, body) = request_json(&app, Method::GET, "/api/agents", None).await;
    let agents = body["agents"].as_array().unwrap();
    assert_eq!(agents.len(), 1);
    assert_eq!(agents[0]["name"], "Test ROUTA");
    assert_eq!(agents[0]["role"], "ROUTA");
    println!(
        "  PASS: {} agents, first is '{}'",
        agents.len(),
        agents[0]["name"]
    );

    // ── Test 6: Get Agent by query param (Next.js compatible) ───────
    println!("=== Test 6: Get Agent by ?id= ===");
    let (status, body) = request_json(
        &app,
        Method::GET,
        &format!("/api/agents?id={agent_id}"),
        None,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body["name"], "Test ROUTA");
    println!("  PASS: got agent by ?id=");

    // ── Test 7: Create Note ─────────────────────────────────────────
    println!("=== Test 7: Create Note ===");
    let (status, body) = request_json(
        &app,
        Method::POST,
        "/api/notes",
        Some(json!({
            "noteId": "test-note-1",
            "title": "Test Note",
            "content": "Hello from Rust backend!",
            "workspaceId": "default",
            "source": "user"
        })),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body["note"]["id"], "test-note-1");
    println!("  PASS: created note '{}'", body["note"]["title"]);

    // ── Test 8: List Notes ────────────────────────────────────────
    println!("=== Test 8: List Notes ===");
    let (status, body) =
        request_json(&app, Method::GET, "/api/notes?workspaceId=default", None).await;
    assert_eq!(status, 200);
    let notes = body["notes"].as_array().unwrap();
    assert!(!notes.is_empty());
    println!("  PASS: {} note(s)", notes.len());

    // ── Test 9: Get Note by query param (Next.js compatible) ────────
    println!("=== Test 9: Get Note by ?noteId= ===");
    let (status, body) = request_json(
        &app,
        Method::GET,
        "/api/notes?workspaceId=default&noteId=test-note-1",
        None,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body["note"]["title"], "Test Note");
    println!("  PASS: got note by ?noteId=");

    // ── Test 10: Delete Note (Next.js compatible query params) ────
    println!("=== Test 10: Delete Note via query params ===");
    let (status, body) = request_json(
        &app,
        Method::DELETE,
        "/api/notes?noteId=test-note-1&workspaceId=default",
        None,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body["deleted"], true);
    println!("  PASS: deleted note via query params");

    // ── Test 11: Create Task ────────────────────────────────────────
    println!("=== Test 11: Create Task ===");
    let (status, body) = request_json(
        &app,
        Method::POST,
        "/api/tasks",
        Some(json!({
            "title": "Implement feature X",
            "objective": "Build the feature X module",
            "workspaceId": "default"
        })),
    )
    .await;
    assert_eq!(status, 201);
    assert_eq!(body["task"]["title"], "Implement feature X");
    println!("  PASS: created task");

    // ── Test 12: List Tasks ─────────────────────────────────────────
    println!("=== Test 12: List Tasks ===");
    let (status, body) =
        request_json(&app, Method::GET, "/api/tasks?workspaceId=default", None).await;
    assert_eq!(status, 200);
    let tasks = body["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 1);
    println!("  PASS: {} task(s)", tasks.len());

    // ── Test 13: Skills ─────────────────────────────────────────────
    println!("=== Test 13: List Skills ===");
    let (status, body) = get_json(&app, "/api/skills").await;
    assert_eq!(status, 200);
    println!(
        "  PASS: {} skills",
        body["skills"].as_array().unwrap().len()
    );

    // ── Test 14: ACP Sessions ───────────────────────────────────────
    println!("=== Test 14: ACP Sessions ===");
    let (status, body) = get_json(&app, "/api/sessions").await;
    assert_eq!(status, 200);
    assert!(body["sessions"].as_array().is_some());
    println!("  PASS: sessions endpoint works");

    // ── Test 15: ACP JSON-RPC ───────────────────────────────────────
    println!("=== Test 15: ACP JSON-RPC ===");
    let (status, body) = post_json(
        &app,
        "/api/acp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {}
        }),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body["result"]["agentInfo"]["name"], "routa-acp");
    println!("  PASS: ACP initialize works");

    // ── Test 16: ACP providers list ─────────────────────────────────
    println!("=== Test 16: ACP Providers List ===");
    let (status, body) = post_json(
        &app,
        "/api/acp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "_providers/list",
            "params": {}
        }),
    )
    .await;
    assert_eq!(status, 200);
    let providers = body["result"]["providers"].as_array().unwrap();
    assert!(providers.len() >= 4);
    println!("  PASS: {} providers", providers.len());

    // ── Test 17: ACP session/new ──────────────────────────────────
    println!("=== Test 17: ACP session/new ===");
    let (status, body) = post_json(
        &app,
        "/api/acp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "session/new",
            "params": { "cwd": ".", "provider": "opencode" }
        }),
    )
    .await;
    assert_eq!(status, 200);
    let acp_session_id = body["result"]["sessionId"].as_str().map(str::to_string);
    if let Some(acp_session_id) = acp_session_id {
        assert!(!acp_session_id.is_empty());
        println!("  PASS: created ACP session {}", &acp_session_id[..8]);

        // ── Test 18: ACP session/cancel ───────────────────────────────
        println!("=== Test 18: ACP session/cancel ===");
        let (status, body) = post_json(
            &app,
            "/api/acp",
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": 4,
                "method": "session/cancel",
                "params": { "sessionId": acp_session_id }
            }),
        )
        .await;
        assert_eq!(status, 200);
        assert_eq!(body["result"]["cancelled"], true);
        println!("  PASS: cancelled session");
    } else {
        assert!(
            body["error"].is_object(),
            "session/new should return result or error"
        );
        println!("  PASS: session/new returned environment-dependent error");
    }

    // ── Test 19: ACP session/load (unsupported) ───────────────────
    println!("=== Test 19: ACP session/load ===");
    let (status, body) = post_json(
        &app,
        "/api/acp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 5,
            "method": "session/load",
            "params": {}
        }),
    )
    .await;
    assert_eq!(status, 200);
    assert!(body["error"].is_object());
    println!("  PASS: session/load correctly returns error");

    // ── Test 20: MCP Streamable HTTP initialize ──────────────────
    println!("=== Test 20: MCP initialize ===");
    let (status, body) = post_json(
        &app,
        "/api/mcp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": { "protocolVersion": "2024-11-05" }
        }),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body["result"]["serverInfo"]["name"], "routa-mcp");
    println!("  PASS: MCP initialized");

    // ── Test 21: MCP tools/list ──────────────────────────────────
    println!("=== Test 21: MCP tools/list ===");
    let (status, body) = post_json(
        &app,
        "/api/mcp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {}
        }),
    )
    .await;
    assert_eq!(status, 200);
    let tools = body["result"]["tools"].as_array().unwrap();
    assert!(tools.len() >= 5, "Should have at least 5 tools");
    println!("  PASS: {} MCP tools", tools.len());

    // ── Test 22: MCP tools/call ──────────────────────────────────
    println!("=== Test 22: MCP tools/call (list_workspaces) ===");
    let (status, body) = post_json(
        &app,
        "/api/mcp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "list_workspaces",
                "arguments": {}
            }
        }),
    )
    .await;
    assert_eq!(status, 200);
    assert!(body["result"]["content"].as_array().is_some());
    println!("  PASS: MCP tools/call returned content");

    // ── Test 23: /api/mcp/tools GET ──────────────────────────────
    println!("=== Test 23: /api/mcp/tools GET ===");
    let (status, body) = get_json(&app, "/api/mcp/tools").await;
    assert_eq!(status, 200);
    assert!(body["tools"].as_array().is_some());
    println!(
        "  PASS: {} tools from /api/mcp/tools",
        body["tools"].as_array().unwrap().len()
    );

    // ── Test 24: /api/mcp/tools POST ─────────────────────────────
    println!("=== Test 24: /api/mcp/tools POST ===");
    let (status, body) = post_json(
        &app,
        "/api/mcp/tools",
        serde_json::json!({
            "name": "list_agents",
            "args": { "workspaceId": "default" }
        }),
    )
    .await;
    assert_eq!(status, 200);
    assert!(body["content"].as_array().is_some());
    println!("  PASS: executed tool via /api/mcp/tools");

    // ── Test 25: MCP Server Management ───────────────────────────
    println!("=== Test 25: /api/mcp-server ===");
    let (status, body) = get_json(&app, "/api/mcp-server").await;
    assert_eq!(status, 200);
    assert_eq!(body["running"], false);
    println!("  PASS: MCP server status OK");

    let (status, body) = post_json(&app, "/api/mcp-server", serde_json::json!({})).await;
    assert_eq!(status, 200);
    assert_eq!(body["running"], true);
    println!("  PASS: MCP server started");

    // ── Test 26: Test MCP ────────────────────────────────────────
    println!("=== Test 26: /api/test-mcp ===");
    let (status, body) = get_json(&app, "/api/test-mcp").await;
    assert_eq!(status, 200);
    assert!(body["providers"].is_object());
    assert!(body["mcpEndpoint"].is_string());
    println!("  PASS: test-mcp endpoint works");

    // ── Test 27: Clone repos list ────────────────────────────────
    println!("=== Test 27: /api/clone GET ===");
    let (status, body) = get_json(&app, "/api/clone").await;
    assert_eq!(status, 200);
    assert!(body["repos"].as_array().is_some());
    println!("  PASS: clone list endpoint works");

    // ── Test 28: A2A Sessions ────────────────────────────────────
    println!("=== Test 28: /api/a2a/sessions ===");
    let (status, body) = get_json(&app, "/api/a2a/sessions").await;
    assert_eq!(status, 200);
    assert!(body["sessions"].as_array().is_some());
    println!("  PASS: A2A sessions");

    // ── Test 29: A2A Agent Card ──────────────────────────────────
    println!("=== Test 29: /api/a2a/card ===");
    let (status, body) = get_json(&app, "/api/a2a/card").await;
    assert_eq!(status, 200);
    assert_eq!(body["name"], "Routa Multi-Agent Coordinator");
    assert_eq!(body["protocolVersion"], "0.3.0");
    println!("  PASS: A2A agent card");

    // ── Test 30: A2A RPC ─────────────────────────────────────────
    println!("=== Test 30: /api/a2a/rpc POST ===");
    let (status, body) = post_json(
        &app,
        "/api/a2a/rpc",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {}
        }),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body["result"]["agentInfo"]["name"], "routa-a2a-bridge");
    println!("  PASS: A2A RPC initialize");

    // ── Test 31: A2A RPC method_list ─────────────────────────────
    println!("=== Test 31: /api/a2a/rpc method_list ===");
    let (status, body) = post_json(
        &app,
        "/api/a2a/rpc",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "method_list",
            "params": {}
        }),
    )
    .await;
    assert_eq!(status, 200);
    let methods = body["result"]["methods"].as_array().unwrap();
    assert!(methods.len() >= 5);
    println!("  PASS: {} A2A methods", methods.len());

    // ══════════════════════════════════════════════════════════════════
    // NEW TESTS: EventBus, Orchestration, and Extended MCP Tools
    // ══════════════════════════════════════════════════════════════════

    // ── Test 32: MCP tools/call (get_agent_status) ────────────────────
    println!("=== Test 32: MCP tools/call (get_agent_status) ===");
    let (status, body) = post_json(
        &app,
        "/api/mcp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 32,
            "method": "tools/call",
            "params": {
                "name": "get_agent_status",
                "arguments": { "agentId": agent_id }
            }
        }),
    )
    .await;
    assert_eq!(status, 200);
    let content = body["result"]["content"].as_array().unwrap();
    assert!(!content.is_empty());
    let text = content[0]["text"].as_str().unwrap();
    assert!(text.contains("agentId") || text.contains("Agent not found"));
    println!("  PASS: get_agent_status tool works");

    // ── Test 33: MCP tools/call (get_agent_summary) ───────────────────
    println!("=== Test 33: MCP tools/call (get_agent_summary) ===");
    let (status, body) = post_json(
        &app,
        "/api/mcp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 33,
            "method": "tools/call",
            "params": {
                "name": "get_agent_summary",
                "arguments": { "agentId": agent_id }
            }
        }),
    )
    .await;
    assert_eq!(status, 200);
    assert!(body["result"]["content"].as_array().is_some());
    println!("  PASS: get_agent_summary tool works");

    // ── Test 34: MCP tools/call (list_specialists) ────────────────────
    println!("=== Test 34: MCP tools/call (list_specialists) ===");
    let (status, body) = post_json(
        &app,
        "/api/mcp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 34,
            "method": "tools/call",
            "params": {
                "name": "list_specialists",
                "arguments": {}
            }
        }),
    )
    .await;
    assert_eq!(status, 200);
    let content = body["result"]["content"].as_array().unwrap();
    assert!(!content.is_empty());
    let text = content[0]["text"].as_str().unwrap();
    assert!(text.contains("CRAFTER") || text.contains("GATE") || text.contains("DEVELOPER"));
    println!("  PASS: list_specialists tool works");

    // ── Test 35: MCP tools/call (get_workspace_info) ──────────────────
    println!("=== Test 35: MCP tools/call (get_workspace_info) ===");
    let (status, body) = post_json(
        &app,
        "/api/mcp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 35,
            "method": "tools/call",
            "params": {
                "name": "get_workspace_info",
                "arguments": { "workspaceId": "default" }
            }
        }),
    )
    .await;
    assert_eq!(status, 200);
    let content = body["result"]["content"].as_array().unwrap();
    assert!(!content.is_empty());
    let text = content[0]["text"].as_str().unwrap();
    // Response contains "workspace" field with workspace details, or error message
    assert!(
        text.contains("workspace")
            || text.contains("agentCount")
            || text.contains("Workspace not found")
    );
    println!("  PASS: get_workspace_info tool works");

    // ── Test 36: MCP tools/call (subscribe_to_events) ─────────────────
    println!("=== Test 36: MCP tools/call (subscribe_to_events) ===");
    let (status, body) = post_json(
        &app,
        "/api/mcp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 36,
            "method": "tools/call",
            "params": {
                "name": "subscribe_to_events",
                "arguments": {
                    "agentId": agent_id,
                    "agentName": "Test Agent",
                    "eventTypes": ["TASK_STATUS_CHANGED", "AGENT_COMPLETED"]
                }
            }
        }),
    )
    .await;
    assert_eq!(status, 200);
    let content = body["result"]["content"].as_array().unwrap();
    assert!(!content.is_empty());
    let text = content[0]["text"].as_str().unwrap();
    assert!(text.contains("subscriptionId"));
    // Extract subscription ID for later unsubscribe test
    let sub_data: serde_json::Value = serde_json::from_str(text).unwrap_or_default();
    let subscription_id = sub_data["subscriptionId"]
        .as_str()
        .unwrap_or("")
        .to_string();
    println!(
        "  PASS: subscribe_to_events tool works, id={}",
        &subscription_id[..8.min(subscription_id.len())]
    );

    // ── Test 37: MCP tools/call (unsubscribe_from_events) ─────────────
    println!("=== Test 37: MCP tools/call (unsubscribe_from_events) ===");
    let (status, body) = post_json(
        &app,
        "/api/mcp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 37,
            "method": "tools/call",
            "params": {
                "name": "unsubscribe_from_events",
                "arguments": { "subscriptionId": subscription_id }
            }
        }),
    )
    .await;
    assert_eq!(status, 200);
    assert!(body["result"]["content"].as_array().is_some());
    println!("  PASS: unsubscribe_from_events tool works");

    // ── Test 38: MCP tools/call (delegate_task_to_agent) ──────────────
    println!("=== Test 38: MCP tools/call (delegate_task_to_agent) ===");
    let (status, body) = post_json(
        &app,
        "/api/mcp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 38,
            "method": "tools/call",
            "params": {
                "name": "delegate_task_to_agent",
                "arguments": {
                    "taskId": "test-task-1",
                    "callerAgentId": agent_id,
                    "specialist": "CRAFTER",
                    "provider": "claude",
                    "waitMode": "after_all"
                }
            }
        }),
    )
    .await;
    assert_eq!(status, 200);
    let content = body["result"]["content"].as_array().unwrap();
    assert!(!content.is_empty());
    let text = content[0]["text"].as_str().unwrap();
    let delegate_result: Value = serde_json::from_str(text).expect("decode delegate tool result");
    let success = delegate_result["success"].as_bool().unwrap_or(false);
    if success {
        let data = delegate_result["data"]
            .as_object()
            .expect("delegate success should include data");
        assert_eq!(data["taskId"], "test-task-1");
        assert!(data.get("agentId").and_then(Value::as_str).is_some());
        assert!(data.get("sessionId").and_then(Value::as_str).is_some());
        assert_eq!(data["waitMode"], "after_all");
        let specialist = data["specialist"].as_str().unwrap_or_default();
        assert!(specialist == "crafter" || specialist == "CRAFTER");
    } else {
        let error = delegate_result["error"].as_str().unwrap_or_default();
        assert!(
            error.contains("Failed to delegate task")
                || error.contains("Task not found")
                || error.contains("Failed to spawn agent process"),
            "unexpected delegate_task_to_agent error: {error}"
        );
    }
    println!("  PASS: delegate_task_to_agent tool works");

    // ── Test 39: MCP tools/call (report_to_parent) ────────────────────
    println!("=== Test 39: MCP tools/call (report_to_parent) ===");
    // First create a task to report on
    let (status, task_body) = post_json(
        &app,
        "/api/tasks",
        serde_json::json!({
            "title": "Report Test Task",
            "objective": "Test reporting",
            "workspaceId": "default"
        }),
    )
    .await;
    assert_eq!(status, 201);
    let report_task_id = task_body["task"]["id"]
        .as_str()
        .unwrap_or("test-task")
        .to_string();

    let (status, body) = post_json(
        &app,
        "/api/mcp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 39,
            "method": "tools/call",
            "params": {
                "name": "report_to_parent",
                "arguments": {
                    "agentId": agent_id,
                    "taskId": report_task_id,
                    "summary": "Task completed successfully",
                    "success": true
                }
            }
        }),
    )
    .await;
    assert_eq!(status, 200);
    let content = body["result"]["content"].as_array().unwrap();
    assert!(!content.is_empty());
    println!("  PASS: report_to_parent tool works");

    // ── Test 40: MCP tools/call (send_message_to_agent) ───────────────
    println!("=== Test 40: MCP tools/call (send_message_to_agent) ===");
    // Create a second agent to send message to
    let (status, agent2_body) = post_json(
        &app,
        "/api/agents",
        serde_json::json!({
            "name": "Test CRAFTER",
            "role": "CRAFTER"
        }),
    )
    .await;
    assert_eq!(status, 200);
    let agent2_id = agent2_body["agentId"]
        .as_str()
        .unwrap_or("agent2")
        .to_string();

    let (status, body) = post_json(
        &app,
        "/api/mcp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 40,
            "method": "tools/call",
            "params": {
                "name": "send_message_to_agent",
                "arguments": {
                    "fromAgentId": agent_id,
                    "toAgentId": agent2_id,
                    "message": "Hello from ROUTA!"
                }
            }
        }),
    )
    .await;
    assert_eq!(status, 200);
    let content = body["result"]["content"].as_array().unwrap();
    assert!(!content.is_empty());
    let text = content[0]["text"].as_str().unwrap();
    assert!(text.contains("messageId") || text.contains("success"));
    println!("  PASS: send_message_to_agent tool works");

    // ── Test 41: MCP tools/call (read_agent_conversation) ─────────────
    println!("=== Test 41: MCP tools/call (read_agent_conversation) ===");
    let (status, body) = post_json(
        &app,
        "/api/mcp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 41,
            "method": "tools/call",
            "params": {
                "name": "read_agent_conversation",
                "arguments": {
                    "agentId": agent2_id,
                    "limit": 10
                }
            }
        }),
    )
    .await;
    assert_eq!(status, 200);
    let content = body["result"]["content"].as_array().unwrap();
    assert!(!content.is_empty());
    println!("  PASS: read_agent_conversation tool works");

    // ── Test 42: MCP tools/call (get_my_task) ─────────────────────────
    println!("=== Test 42: MCP tools/call (get_my_task) ===");
    let (status, body) = post_json(
        &app,
        "/api/mcp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 42,
            "method": "tools/call",
            "params": {
                "name": "get_my_task",
                "arguments": { "agentId": agent_id }
            }
        }),
    )
    .await;
    assert_eq!(status, 200);
    assert!(body["result"]["content"].as_array().is_some());
    println!("  PASS: get_my_task tool works");

    // ── Test 43: MCP tools/call (set_note_content) ────────────────────
    println!("=== Test 43: MCP tools/call (set_note_content) ===");
    // First create a note
    let (status, _) = post_json(
        &app,
        "/api/notes",
        serde_json::json!({
            "noteId": "test-note-set",
            "title": "Set Content Test",
            "content": "Initial content",
            "workspaceId": "default",
            "source": "user"
        }),
    )
    .await;
    assert_eq!(status, 200);

    let (status, body) = post_json(
        &app,
        "/api/mcp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 43,
            "method": "tools/call",
            "params": {
                "name": "set_note_content",
                "arguments": {
                    "noteId": "test-note-set",
                    "content": "Updated content via MCP tool"
                }
            }
        }),
    )
    .await;
    assert_eq!(status, 200);
    let content = body["result"]["content"].as_array().unwrap();
    assert!(!content.is_empty());
    let text = content[0]["text"].as_str().unwrap();
    assert!(text.contains("success"));
    println!("  PASS: set_note_content tool works");

    // ── Test 44: MCP tools/call (append_to_note) ──────────────────────
    println!("=== Test 44: MCP tools/call (append_to_note) ===");
    let (status, body) = post_json(
        &app,
        "/api/mcp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 44,
            "method": "tools/call",
            "params": {
                "name": "append_to_note",
                "arguments": {
                    "noteId": "test-note-set",
                    "content": "\nAppended content"
                }
            }
        }),
    )
    .await;
    assert_eq!(status, 200);
    let content = body["result"]["content"].as_array().unwrap();
    assert!(!content.is_empty());
    let text = content[0]["text"].as_str().unwrap();
    assert!(text.contains("success"));
    println!("  PASS: append_to_note tool works");

    // ── Test 45: MCP tools/call (update_task_status) ──────────────────
    println!("=== Test 45: MCP tools/call (update_task_status) ===");
    let (status, body) = post_json(
        &app,
        "/api/mcp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 45,
            "method": "tools/call",
            "params": {
                "name": "update_task_status",
                "arguments": {
                    "taskId": report_task_id,
                    "status": "IN_PROGRESS",
                    "agentId": agent_id,
                    "reason": "Starting work on task"
                }
            }
        }),
    )
    .await;
    assert_eq!(status, 200);
    let content = body["result"]["content"].as_array().unwrap();
    assert!(!content.is_empty());
    println!("  PASS: update_task_status tool works");

    // ── Test 46: Verify MCP tools count increased ─────────────────────
    println!("=== Test 46: Verify MCP tools count ===");
    let (status, body) = post_json(
        &app,
        "/api/mcp",
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 46,
            "method": "tools/list",
            "params": {}
        }),
    )
    .await;
    assert_eq!(status, 200);
    let tools = body["result"]["tools"].as_array().unwrap();
    // We added 14 new tools, so should have at least 20+ tools now
    assert!(
        tools.len() >= 20,
        "Should have at least 20 tools, got {}",
        tools.len()
    );

    // Verify specific new tools exist
    let tool_names: Vec<&str> = tools.iter().filter_map(|t| t["name"].as_str()).collect();
    assert!(
        tool_names.contains(&"delegate_task_to_agent"),
        "Missing delegate_task_to_agent"
    );
    assert!(
        tool_names.contains(&"report_to_parent"),
        "Missing report_to_parent"
    );
    assert!(
        tool_names.contains(&"send_message_to_agent"),
        "Missing send_message_to_agent"
    );
    assert!(
        tool_names.contains(&"get_agent_status"),
        "Missing get_agent_status"
    );
    assert!(
        tool_names.contains(&"subscribe_to_events"),
        "Missing subscribe_to_events"
    );
    assert!(
        tool_names.contains(&"list_specialists"),
        "Missing list_specialists"
    );
    println!(
        "  PASS: {} MCP tools (including new coordination tools)",
        tools.len()
    );

    println!("\n=== ALL 46 TESTS PASSED ===");
}
