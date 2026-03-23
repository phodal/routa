use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use reqwest::{header::CONTENT_TYPE, Client, Response, StatusCode};
use serde_json::{json, Value};

use routa_server::{start_server, ServerConfig};

struct ApiFixture {
    base_url: String,
    client: Client,
    db_path: PathBuf,
}

impl ApiFixture {
    async fn new() -> Self {
        let db_path = random_db_path();
        let config = ServerConfig {
            host: "127.0.0.1".to_string(),
            port: 0,
            db_path: db_path.to_string_lossy().to_string(),
            static_dir: None,
        };

        let addr = start_server(config)
            .await
            .expect("start server for mcp route tests");
        let fixture = Self {
            base_url: format!("http://{addr}"),
            client: Client::new(),
            db_path,
        };
        fixture.wait_until_ready().await;
        fixture
    }

    fn endpoint(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    async fn wait_until_ready(&self) {
        for _ in 0..50 {
            if self
                .client
                .get(self.endpoint("/api/health"))
                .send()
                .await
                .is_ok_and(|resp| resp.status() == StatusCode::OK)
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("server did not become ready");
    }

    async fn initialize_session(&self, query: Option<&str>) -> (String, Value) {
        let mut endpoint = "/api/mcp".to_string();
        if let Some(query) = query {
            endpoint.push('?');
            endpoint.push_str(query);
        }

        let response = self
            .client
            .post(self.endpoint(&endpoint))
            .json(&json!({
                "jsonrpc": "2.0",
                "id": "init",
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18"
                }
            }))
            .send()
            .await
            .expect("initialize MCP session");

        assert_eq!(response.status(), StatusCode::OK);
        let session_id = response
            .headers()
            .get("mcp-session-id")
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
            .expect("initialize response should include mcp-session-id");
        let body: Value = response.json().await.expect("decode initialize response");
        (session_id, body)
    }
}

impl Drop for ApiFixture {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.db_path);
    }
}

fn random_db_path() -> PathBuf {
    std::env::temp_dir().join(format!("routa-server-mcp-api-{}.db", uuid::Uuid::new_v4()))
}

async fn read_json(response: Response, label: &str) -> Value {
    response
        .json()
        .await
        .unwrap_or_else(|_| panic!("decode JSON response: {label}"))
}

#[tokio::test]
async fn api_mcp_session_lifecycle_and_sse_contract() {
    let fixture = ApiFixture::new().await;

    let get_without_session = fixture
        .client
        .get(fixture.endpoint("/api/mcp"))
        .send()
        .await
        .expect("GET /api/mcp without session");
    assert_eq!(get_without_session.status(), StatusCode::BAD_REQUEST);
    let get_without_session_json = read_json(get_without_session, "get without session").await;
    assert_eq!(get_without_session_json["error"]["code"], json!(-32600));

    let delete_without_session = fixture
        .client
        .delete(fixture.endpoint("/api/mcp"))
        .send()
        .await
        .expect("DELETE /api/mcp without session");
    assert_eq!(delete_without_session.status(), StatusCode::BAD_REQUEST);
    let delete_without_session_json =
        read_json(delete_without_session, "delete without session").await;
    assert_eq!(
        delete_without_session_json["error"],
        json!("Missing Mcp-Session-Id header")
    );

    let (session_id, initialize_json) = fixture.initialize_session(None).await;
    assert_eq!(
        initialize_json["result"]["protocolVersion"],
        json!("2025-06-18")
    );

    let get_with_session = fixture
        .client
        .get(fixture.endpoint("/api/mcp"))
        .header("mcp-session-id", &session_id)
        .send()
        .await
        .expect("GET /api/mcp with session");
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

    let delete_session = fixture
        .client
        .delete(fixture.endpoint("/api/mcp"))
        .header("mcp-session-id", &session_id)
        .send()
        .await
        .expect("DELETE /api/mcp with active session");
    assert_eq!(delete_session.status(), StatusCode::NO_CONTENT);

    let get_after_delete = fixture
        .client
        .get(fixture.endpoint("/api/mcp"))
        .header("mcp-session-id", &session_id)
        .send()
        .await
        .expect("GET /api/mcp after delete");
    assert_eq!(get_after_delete.status(), StatusCode::BAD_REQUEST);
    let get_after_delete_json = read_json(get_after_delete, "get after delete").await;
    assert_eq!(get_after_delete_json["error"]["code"], json!(-32600));
}

#[tokio::test]
async fn api_mcp_unknown_method_returns_jsonrpc_method_not_found() {
    let fixture = ApiFixture::new().await;

    let response = fixture
        .client
        .post(fixture.endpoint("/api/mcp"))
        .json(&json!({
            "jsonrpc": "2.0",
            "id": "unknown-method",
            "method": "does/not/exist"
        }))
        .send()
        .await
        .expect("POST /api/mcp unknown method");
    assert_eq!(response.status(), StatusCode::OK);

    let body = read_json(response, "unknown method response").await;
    assert_eq!(body["error"]["code"], json!(-32601));
}

#[tokio::test]
async fn api_mcp_kanban_profile_filters_tools_list() {
    let fixture = ApiFixture::new().await;
    let (session_id, _) = fixture
        .initialize_session(Some("mcpProfile=kanban-planning"))
        .await;

    let response = fixture
        .client
        .post(fixture.endpoint("/api/mcp"))
        .header("mcp-session-id", &session_id)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": "tools-list",
            "method": "tools/list"
        }))
        .send()
        .await
        .expect("tools/list for kanban profile");
    assert_eq!(response.status(), StatusCode::OK);

    let body = read_json(response, "kanban tools/list response").await;
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
        "update_card",
        "move_card",
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
async fn api_mcp_kanban_profile_rejects_disallowed_tool_call() {
    let fixture = ApiFixture::new().await;
    let (session_id, _) = fixture
        .initialize_session(Some("mcpProfile=kanban-planning"))
        .await;

    let response = fixture
        .client
        .post(fixture.endpoint("/api/mcp"))
        .header("mcp-session-id", &session_id)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": "tools-call",
            "method": "tools/call",
            "params": {
                "name": "list_agents",
                "arguments": {}
            }
        }))
        .send()
        .await
        .expect("tools/call with disallowed tool");
    assert_eq!(response.status(), StatusCode::OK);

    let body = read_json(response, "disallowed tools/call response").await;
    assert_eq!(body["error"]["code"], json!(-32602));
    assert!(
        body["error"]["message"]
            .as_str()
            .is_some_and(|msg| msg.contains("Tool not allowed for MCP profile")),
        "expected MCP profile rejection message, got: {body}"
    );
}
