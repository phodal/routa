use axum::{
    extract::State as AxumState, http::HeaderMap, routing::get, routing::post, Json as AxumJson,
    Router,
};
use std::fs;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use std::time::Duration;
use tokio::net::TcpListener;

use reqwest::{Client, StatusCode};
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
            .expect("start server for api fixture");
        let base_url = format!("http://{addr}");
        let client = Client::new();
        let fixture = Self {
            base_url,
            client,
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
}

impl Drop for ApiFixture {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.db_path);
    }
}

fn random_db_path() -> PathBuf {
    std::env::temp_dir().join(format!("routa-server-api-{}.db", uuid::Uuid::new_v4()))
}

fn json_has_error(resp: &Value, expected: &str) -> bool {
    resp.get("error")
        .and_then(Value::as_str)
        .is_some_and(|message| message.contains(expected))
}

async fn start_mock_a2a_server() -> String {
    #[derive(Clone)]
    struct MockA2AState {
        base_url: String,
        get_task_calls: Arc<AtomicUsize>,
        required_headers: Option<std::collections::HashMap<String, String>>,
    }

    async fn card(
        AxumState(state): AxumState<MockA2AState>,
        headers: HeaderMap,
    ) -> AxumJson<Value> {
        if !headers_match(&headers, state.required_headers.as_ref()) {
            return AxumJson(json!({
                "error": "missing auth"
            }));
        }
        AxumJson(json!({
            "name": "Mock A2A Agent",
            "description": "Test agent",
            "protocolVersion": "0.3.0",
            "version": "0.1.0",
            "url": format!("{}/rpc", state.base_url),
        }))
    }

    async fn rpc(
        AxumState(state): AxumState<MockA2AState>,
        headers: HeaderMap,
        AxumJson(body): AxumJson<Value>,
    ) -> AxumJson<Value> {
        if !headers_match(&headers, state.required_headers.as_ref()) {
            return AxumJson(json!({
                "jsonrpc": "2.0",
                "id": body.get("id").cloned().unwrap_or(json!(null)),
                "error": {
                    "code": 401,
                    "message": "missing auth"
                }
            }));
        }
        let id = body.get("id").cloned().unwrap_or(json!(null));
        let method = body.get("method").and_then(Value::as_str).unwrap_or("");
        let response = match method {
            "SendMessage" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "task": {
                        "id": "remote-task-1",
                        "contextId": "ctx-1",
                        "status": {
                            "state": "submitted",
                            "timestamp": "2026-03-21T00:00:00Z"
                        }
                    }
                }
            }),
            "GetTask" => {
                let call = state.get_task_calls.fetch_add(1, Ordering::SeqCst);
                let state = if call == 0 { "working" } else { "completed" };
                json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "task": {
                            "id": "remote-task-1",
                            "contextId": "ctx-1",
                            "status": {
                                "state": state,
                                "timestamp": if state == "completed" {
                                    "2026-03-21T00:00:05Z"
                                } else {
                                    "2026-03-21T00:00:01Z"
                                }
                            },
                            "history": []
                        }
                    }
                })
            }
            _ => json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32601,
                    "message": format!("Unsupported method: {}", method)
                }
            }),
        };
        AxumJson(response)
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind mock a2a server");
    let addr = listener.local_addr().expect("mock a2a local addr");
    let base_url = format!("http://{}", addr);
    let state = MockA2AState {
        base_url: base_url.clone(),
        get_task_calls: Arc::new(AtomicUsize::new(0)),
        required_headers: None,
    };
    let router = Router::new()
        .route("/card", get(card))
        .route("/rpc", post(rpc))
        .with_state(state);

    tokio::spawn(async move {
        axum::serve(listener, router)
            .await
            .expect("serve mock a2a server");
    });

    base_url
}

fn headers_match(
    headers: &HeaderMap,
    required_headers: Option<&std::collections::HashMap<String, String>>,
) -> bool {
    required_headers.is_none_or(|required_headers| {
        required_headers.iter().all(|(name, value)| {
            headers
                .get(name)
                .and_then(|header| header.to_str().ok())
                .is_some_and(|header| header == value)
        })
    })
}

async fn start_mock_a2a_server_with_headers(
    required_headers: std::collections::HashMap<String, String>,
) -> String {
    #[derive(Clone)]
    struct MockA2AState {
        base_url: String,
        _get_task_calls: Arc<AtomicUsize>,
        required_headers: Option<std::collections::HashMap<String, String>>,
    }

    async fn card(
        AxumState(state): AxumState<MockA2AState>,
        headers: HeaderMap,
    ) -> AxumJson<Value> {
        if !headers_match(&headers, state.required_headers.as_ref()) {
            return AxumJson(json!({ "error": "missing auth" }));
        }
        AxumJson(json!({
            "name": "Mock A2A Agent",
            "description": "Test agent",
            "protocolVersion": "0.3.0",
            "version": "0.1.0",
            "url": format!("{}/rpc", state.base_url),
        }))
    }

    async fn rpc(
        AxumState(state): AxumState<MockA2AState>,
        headers: HeaderMap,
        AxumJson(body): AxumJson<Value>,
    ) -> AxumJson<Value> {
        if !headers_match(&headers, state.required_headers.as_ref()) {
            return AxumJson(json!({
                "jsonrpc": "2.0",
                "id": body.get("id").cloned().unwrap_or(json!(null)),
                "error": { "code": 401, "message": "missing auth" }
            }));
        }
        let id = body.get("id").cloned().unwrap_or(json!(null));
        let method = body.get("method").and_then(Value::as_str).unwrap_or("");
        let response = match method {
            "SendMessage" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "task": {
                        "id": "remote-task-1",
                        "contextId": "ctx-1",
                        "status": {
                            "state": "submitted",
                            "timestamp": "2026-03-21T00:00:00Z"
                        }
                    }
                }
            }),
            "GetTask" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "task": {
                        "id": "remote-task-1",
                        "contextId": "ctx-1",
                        "status": {
                            "state": "completed",
                            "timestamp": "2026-03-21T00:00:05Z"
                        },
                        "history": []
                    }
                }
            }),
            _ => json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32601,
                    "message": format!("Unsupported method: {}", method)
                }
            }),
        };
        AxumJson(response)
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind mock a2a server");
    let addr = listener.local_addr().expect("mock a2a local addr");
    let base_url = format!("http://{}", addr);
    let state = MockA2AState {
        base_url: base_url.clone(),
        required_headers: Some(required_headers),
        _get_task_calls: Arc::new(AtomicUsize::new(0)),
    };
    let router = Router::new()
        .route("/card", get(card))
        .route("/rpc", post(rpc))
        .with_state(state);

    tokio::spawn(async move {
        axum::serve(listener, router)
            .await
            .expect("serve mock a2a server");
    });

    base_url
}

#[tokio::test]
async fn api_task_artifact_flow_and_gate() {
    let fixture = ApiFixture::new().await;

    let boards_response = fixture
        .client
        .get(fixture.endpoint("/api/kanban/boards?workspaceId=default"))
        .send()
        .await
        .expect("list boards");
    assert_eq!(boards_response.status(), StatusCode::OK);
    let boards_json: Value = boards_response.json().await.expect("decode boards");
    let board_id = boards_json["boards"][0]["id"].as_str().expect("board id");

    let board_response = fixture
        .client
        .get(fixture.endpoint(&format!("/api/kanban/boards/{board_id}")))
        .send()
        .await
        .expect("get board");
    assert_eq!(board_response.status(), StatusCode::OK);
    let board_json: Value = board_response.json().await.expect("decode board");
    let mut columns = board_json["board"]["columns"]
        .as_array()
        .expect("columns array")
        .clone();
    let dev = columns
        .iter_mut()
        .find(|column| column["id"].as_str() == Some("dev"))
        .expect("dev column");
    dev["automation"] = json!({
        "enabled": true,
        "requiredArtifacts": ["screenshot"]
    });
    let review = columns
        .iter_mut()
        .find(|column| column["id"].as_str() == Some("review"))
        .expect("review column");
    review["automation"] = json!({
        "enabled": true,
        "requiredArtifacts": ["screenshot"]
    });

    let update_board = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/kanban/boards/{board_id}")))
        .json(&json!({ "columns": columns }))
        .send()
        .await
        .expect("update board");
    assert_eq!(update_board.status(), StatusCode::OK);

    let create_task = fixture
        .client
        .post(fixture.endpoint("/api/tasks"))
        .json(&json!({
            "title": "Artifact gated task",
            "objective": "Require screenshot before review",
            "workspaceId": "default",
            "boardId": board_id,
            "columnId": "todo"
        }))
        .send()
        .await
        .expect("create task");
    assert_eq!(create_task.status(), StatusCode::CREATED);
    let task_json: Value = create_task.json().await.expect("decode task");
    let task_id = task_json["task"]["id"].as_str().expect("task id");
    assert_eq!(task_json["task"]["artifactSummary"]["total"], json!(0));
    assert_eq!(
        task_json["task"]["artifactSummary"]["requiredSatisfied"],
        json!(false)
    );
    assert_eq!(
        task_json["task"]["artifactSummary"]["missingRequired"],
        json!(["screenshot"])
    );
    assert_eq!(
        task_json["task"]["evidenceSummary"]["runs"]["latestStatus"],
        json!("idle")
    );
    assert_eq!(
        task_json["task"]["storyReadiness"]["requiredTaskFields"],
        json!([])
    );
    assert_eq!(
        task_json["task"]["investValidation"]["source"],
        json!("heuristic")
    );

    let blocked_move = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/tasks/{task_id}")))
        .json(&json!({ "columnId": "review" }))
        .send()
        .await
        .expect("move blocked");
    assert_eq!(blocked_move.status(), StatusCode::BAD_REQUEST);
    let blocked_json: Value = blocked_move.json().await.expect("decode blocked move");
    assert!(json_has_error(
        &blocked_json,
        "missing required artifacts: screenshot"
    ));

    let create_artifact = fixture
        .client
        .post(fixture.endpoint(&format!("/api/tasks/{task_id}/artifacts")))
        .json(&json!({
            "agentId": "agent-1",
            "type": "screenshot",
            "content": "base64-image",
            "context": "Review screenshot"
        }))
        .send()
        .await
        .expect("create artifact");
    assert_eq!(create_artifact.status(), StatusCode::CREATED);

    let get_task = fixture
        .client
        .get(fixture.endpoint(&format!("/api/tasks/{task_id}")))
        .send()
        .await
        .expect("get task");
    assert_eq!(get_task.status(), StatusCode::OK);
    let get_task_json: Value = get_task.json().await.expect("decode task");
    assert_eq!(get_task_json["task"]["artifactSummary"]["total"], json!(1));
    assert_eq!(
        get_task_json["task"]["artifactSummary"]["byType"]["screenshot"],
        json!(1)
    );
    assert_eq!(
        get_task_json["task"]["artifactSummary"]["requiredSatisfied"],
        json!(true)
    );
    assert_eq!(
        get_task_json["task"]["artifactSummary"]["missingRequired"],
        json!([])
    );
    assert_eq!(
        get_task_json["task"]["evidenceSummary"]["artifact"]["byType"]["screenshot"],
        json!(1)
    );
    assert_eq!(
        get_task_json["task"]["storyReadiness"]["requiredTaskFields"],
        json!([])
    );

    let list_artifacts = fixture
        .client
        .get(fixture.endpoint(&format!("/api/tasks/{task_id}/artifacts")))
        .send()
        .await
        .expect("list artifacts");
    assert_eq!(list_artifacts.status(), StatusCode::OK);
    let artifacts_json: Value = list_artifacts.json().await.expect("decode artifacts");
    assert_eq!(
        artifacts_json["artifacts"]
            .as_array()
            .expect("artifact array")
            .len(),
        1
    );

    let list_tasks = fixture
        .client
        .get(fixture.endpoint("/api/tasks?workspaceId=default"))
        .send()
        .await
        .expect("list tasks");
    assert_eq!(list_tasks.status(), StatusCode::OK);
    let list_tasks_json: Value = list_tasks.json().await.expect("decode tasks");
    let listed_task = list_tasks_json["tasks"]
        .as_array()
        .expect("task array")
        .iter()
        .find(|task| task["id"].as_str() == Some(task_id))
        .expect("listed task");
    assert_eq!(listed_task["artifactSummary"]["total"], json!(1));
    assert_eq!(
        listed_task["evidenceSummary"]["artifact"]["requiredSatisfied"],
        json!(true)
    );
    assert_eq!(
        listed_task["investValidation"]["source"],
        json!("heuristic")
    );

    let ready_tasks = fixture
        .client
        .get(fixture.endpoint("/api/tasks/ready?workspaceId=default"))
        .send()
        .await
        .expect("ready tasks");
    assert_eq!(ready_tasks.status(), StatusCode::OK);
    let ready_tasks_json: Value = ready_tasks.json().await.expect("decode ready tasks");
    let ready_task = ready_tasks_json["tasks"]
        .as_array()
        .expect("ready task array")
        .iter()
        .find(|task| task["id"].as_str() == Some(task_id))
        .expect("ready task");
    assert_eq!(ready_task["artifactSummary"]["total"], json!(1));
    assert_eq!(
        ready_task["evidenceSummary"]["artifact"]["requiredSatisfied"],
        json!(true)
    );
    assert_eq!(ready_task["storyReadiness"]["ready"], json!(true));

    let allowed_move = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/tasks/{task_id}")))
        .json(&json!({ "columnId": "review" }))
        .send()
        .await
        .expect("move allowed");
    assert_eq!(allowed_move.status(), StatusCode::OK);
}

#[tokio::test]
async fn api_blocks_transition_when_required_task_fields_are_missing() {
    let fixture = ApiFixture::new().await;

    let board_response = fixture
        .client
        .get(fixture.endpoint("/api/kanban/boards?workspaceId=default"))
        .send()
        .await
        .expect("list boards");
    assert_eq!(board_response.status(), StatusCode::OK);
    let boards_json: Value = board_response.json().await.expect("decode boards");
    let board_id = boards_json["boards"][0]["id"]
        .as_str()
        .expect("default board id")
        .to_string();

    let board_detail = fixture
        .client
        .get(fixture.endpoint(&format!("/api/kanban/boards/{board_id}")))
        .send()
        .await
        .expect("get board");
    assert_eq!(board_detail.status(), StatusCode::OK);
    let mut board_json: Value = board_detail.json().await.expect("decode board");
    let columns = board_json["board"]["columns"]
        .as_array_mut()
        .expect("columns array");
    let dev = columns
        .iter_mut()
        .find(|column| column["id"].as_str() == Some("dev"))
        .expect("dev column");
    dev["automation"] = json!({
        "enabled": true,
        "requiredTaskFields": ["scope", "acceptance_criteria", "verification_plan"]
    });

    let update_board = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/kanban/boards/{board_id}")))
        .json(&json!({ "columns": columns }))
        .send()
        .await
        .expect("update board");
    assert_eq!(update_board.status(), StatusCode::OK);

    let create_task = fixture
        .client
        .post(fixture.endpoint("/api/tasks"))
        .json(&json!({
            "title": "Missing scope",
            "objective": "This story is not ready for dev",
            "workspaceId": "default",
            "boardId": board_id,
            "columnId": "todo"
        }))
        .send()
        .await
        .expect("create task");
    assert_eq!(create_task.status(), StatusCode::CREATED);
    let task_json: Value = create_task.json().await.expect("decode task");
    let task_id = task_json["task"]["id"].as_str().expect("task id");

    let blocked_move = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/tasks/{task_id}")))
        .json(&json!({ "columnId": "dev" }))
        .send()
        .await
        .expect("move blocked");
    assert_eq!(blocked_move.status(), StatusCode::BAD_REQUEST);
    let blocked_json: Value = blocked_move.json().await.expect("decode blocked move");
    assert!(json_has_error(
        &blocked_json,
        "missing required task fields"
    ));
}

#[tokio::test]
async fn api_kanban_import_export_roundtrip() {
    let fixture = ApiFixture::new().await;

    let import_response = fixture
        .client
        .post(fixture.endpoint("/api/kanban/import"))
        .json(&json!({
            "workspaceId": "kanban-sync",
            "yamlContent": r#"
version: 1
name: Sync Workspace
workspaceId: ignored-by-override
boards:
  - id: main
    name: Imported Board
    isDefault: true
    columns:
      - id: backlog
        name: Backlog
        stage: backlog
      - id: review
        name: Review
        stage: review
        automation:
          providerId: routa-native
          role: GATE
"#
        }))
        .send()
        .await
        .expect("import kanban yaml");
    assert_eq!(import_response.status(), StatusCode::OK);

    let export_response = fixture
        .client
        .get(fixture.endpoint("/api/kanban/export?workspaceId=kanban-sync"))
        .send()
        .await
        .expect("export kanban yaml");
    assert_eq!(export_response.status(), StatusCode::OK);
    assert!(export_response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.contains("application/yaml")));
    assert!(export_response
        .headers()
        .get("content-disposition")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.contains("kanban-kanban-sync.yaml")));

    let exported_yaml = export_response.text().await.expect("export yaml body");
    assert!(exported_yaml.contains("workspaceId: kanban-sync"));
    assert!(exported_yaml.contains("name: Sync Workspace Kanban"));
    assert!(exported_yaml.contains("name: Imported Board"));
    assert!(exported_yaml.contains("enabled: true"));

    let missing_workspace = fixture
        .client
        .get(fixture.endpoint("/api/kanban/export"))
        .send()
        .await
        .expect("export without workspaceId");
    assert_eq!(missing_workspace.status(), StatusCode::BAD_REQUEST);
    let missing_workspace_json: Value = missing_workspace
        .json()
        .await
        .expect("decode missing workspace response");
    assert!(json_has_error(
        &missing_workspace_json,
        "workspaceId is required"
    ));
}

#[tokio::test]
async fn api_task_create_triggers_a2a_lane_automation_and_persists_lane_metadata() {
    let fixture = ApiFixture::new().await;
    let mock_a2a_base = start_mock_a2a_server().await;

    let boards_response = fixture
        .client
        .get(fixture.endpoint("/api/kanban/boards?workspaceId=default"))
        .send()
        .await
        .expect("list boards");
    assert_eq!(boards_response.status(), StatusCode::OK);
    let boards_json: Value = boards_response.json().await.expect("decode boards");
    let board_id = boards_json["boards"][0]["id"].as_str().expect("board id");

    let board_response = fixture
        .client
        .get(fixture.endpoint(&format!("/api/kanban/boards/{board_id}")))
        .send()
        .await
        .expect("get board");
    assert_eq!(board_response.status(), StatusCode::OK);
    let board_json: Value = board_response.json().await.expect("decode board");
    let mut columns = board_json["board"]["columns"]
        .as_array()
        .expect("columns array")
        .clone();
    let todo = columns
        .iter_mut()
        .find(|column| column["id"].as_str() == Some("todo"))
        .expect("todo column");
    todo["automation"] = json!({
        "enabled": true,
        "steps": [
            {
                "id": "todo-a2a",
                "transport": "a2a",
                "role": "CRAFTER",
                "specialistName": "Todo Remote Worker",
                "agentCardUrl": format!("{}/card", mock_a2a_base),
                "skillId": "remote-skill"
            }
        ]
    });

    let update_board = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/kanban/boards/{board_id}")))
        .json(&json!({ "columns": columns }))
        .send()
        .await
        .expect("update board");
    assert_eq!(update_board.status(), StatusCode::OK);

    let create_task = fixture
        .client
        .post(fixture.endpoint("/api/tasks"))
        .json(&json!({
            "title": "A2A lane task",
            "objective": "Trigger remote A2A automation",
            "workspaceId": "default",
            "boardId": board_id,
            "columnId": "todo"
        }))
        .send()
        .await
        .expect("create task");
    assert_eq!(create_task.status(), StatusCode::CREATED);
    let task_json: Value = create_task.json().await.expect("decode task");
    let task_id = task_json["task"]["id"].as_str().expect("task id");

    let get_task = fixture
        .client
        .get(fixture.endpoint(&format!("/api/tasks/{task_id}")))
        .send()
        .await
        .expect("get task");
    assert_eq!(get_task.status(), StatusCode::OK);
    let persisted_json: Value = get_task.json().await.expect("decode persisted task");

    let trigger_session_id = persisted_json["task"]["triggerSessionId"]
        .as_str()
        .expect("trigger session id");
    assert!(
        trigger_session_id.starts_with("a2a-"),
        "expected synthetic a2a session id, got {trigger_session_id}"
    );
    assert_eq!(
        persisted_json["task"]["sessionIds"]
            .as_array()
            .expect("session ids")
            .len(),
        1
    );
    assert_eq!(
        persisted_json["task"]["sessionIds"][0].as_str(),
        Some(trigger_session_id)
    );
    assert_eq!(
        persisted_json["task"]["laneSessions"]
            .as_array()
            .expect("lane sessions")
            .len(),
        1
    );
    assert_eq!(
        persisted_json["task"]["laneSessions"][0]["transport"].as_str(),
        Some("a2a")
    );
    assert_eq!(
        persisted_json["task"]["laneSessions"][0]["externalTaskId"].as_str(),
        Some("remote-task-1")
    );
    assert_eq!(
        persisted_json["task"]["laneSessions"][0]["contextId"].as_str(),
        Some("ctx-1")
    );
    assert_eq!(
        persisted_json["task"]["laneSessions"][0]["stepId"].as_str(),
        Some("todo-a2a")
    );
}

#[tokio::test]
async fn api_task_runs_returns_normalized_a2a_ledger_entries() {
    let fixture = ApiFixture::new().await;
    let mock_a2a_base = start_mock_a2a_server().await;

    let boards_response = fixture
        .client
        .get(fixture.endpoint("/api/kanban/boards?workspaceId=default"))
        .send()
        .await
        .expect("list boards");
    assert_eq!(boards_response.status(), StatusCode::OK);
    let boards_json: Value = boards_response.json().await.expect("decode boards");
    let board_id = boards_json["boards"][0]["id"].as_str().expect("board id");

    let board_response = fixture
        .client
        .get(fixture.endpoint(&format!("/api/kanban/boards/{board_id}")))
        .send()
        .await
        .expect("get board");
    assert_eq!(board_response.status(), StatusCode::OK);
    let board_json: Value = board_response.json().await.expect("decode board");
    let mut columns = board_json["board"]["columns"]
        .as_array()
        .expect("columns array")
        .clone();
    let todo = columns
        .iter_mut()
        .find(|column| column["id"].as_str() == Some("todo"))
        .expect("todo column");
    todo["automation"] = json!({
        "enabled": true,
        "steps": [
            {
                "id": "todo-a2a",
                "transport": "a2a",
                "role": "CRAFTER",
                "specialistName": "Todo Remote Worker",
                "agentCardUrl": format!("{}/card", mock_a2a_base),
                "skillId": "remote-skill"
            }
        ]
    });

    let update_board = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/kanban/boards/{board_id}")))
        .json(&json!({ "columns": columns }))
        .send()
        .await
        .expect("update board");
    assert_eq!(update_board.status(), StatusCode::OK);

    let create_task = fixture
        .client
        .post(fixture.endpoint("/api/tasks"))
        .json(&json!({
            "title": "A2A ledger task",
            "objective": "Return normalized runs",
            "workspaceId": "default",
            "boardId": board_id,
            "columnId": "todo"
        }))
        .send()
        .await
        .expect("create task");
    assert_eq!(create_task.status(), StatusCode::CREATED);
    let task_json: Value = create_task.json().await.expect("decode task");
    let task_id = task_json["task"]["id"].as_str().expect("task id");

    let runs_response = fixture
        .client
        .get(fixture.endpoint(&format!("/api/tasks/{task_id}/runs")))
        .send()
        .await
        .expect("get task runs");
    assert_eq!(runs_response.status(), StatusCode::OK);
    let runs_json: Value = runs_response.json().await.expect("decode task runs");
    let runs = runs_json["runs"].as_array().expect("runs array");
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["kind"].as_str(), Some("a2a_task"));
    assert_eq!(runs[0]["status"].as_str(), Some("running"));
    assert_eq!(runs[0]["externalTaskId"].as_str(), Some("remote-task-1"));
    assert_eq!(runs[0]["contextId"].as_str(), Some("ctx-1"));
    assert_eq!(
        runs[0]["resumeTarget"]["type"].as_str(),
        Some("external_task")
    );
    assert_eq!(
        runs[0]["resumeTarget"]["id"].as_str(),
        Some("remote-task-1")
    );
}

#[tokio::test]
async fn api_task_create_reconciles_a2a_lane_terminal_state() {
    let fixture = ApiFixture::new().await;
    let mock_a2a_base = start_mock_a2a_server().await;

    let boards_response = fixture
        .client
        .get(fixture.endpoint("/api/kanban/boards?workspaceId=default"))
        .send()
        .await
        .expect("list boards");
    assert_eq!(boards_response.status(), StatusCode::OK);
    let boards_json: Value = boards_response.json().await.expect("decode boards");
    let board_id = boards_json["boards"][0]["id"].as_str().expect("board id");

    let board_response = fixture
        .client
        .get(fixture.endpoint(&format!("/api/kanban/boards/{board_id}")))
        .send()
        .await
        .expect("get board");
    assert_eq!(board_response.status(), StatusCode::OK);
    let board_json: Value = board_response.json().await.expect("decode board");
    let mut columns = board_json["board"]["columns"]
        .as_array()
        .expect("columns array")
        .clone();
    let todo = columns
        .iter_mut()
        .find(|column| column["id"].as_str() == Some("todo"))
        .expect("todo column");
    todo["automation"] = json!({
        "enabled": true,
        "steps": [
            {
                "id": "todo-a2a",
                "transport": "a2a",
                "role": "CRAFTER",
                "specialistName": "Todo Remote Worker",
                "agentCardUrl": format!("{}/card", mock_a2a_base),
                "skillId": "remote-skill"
            }
        ]
    });

    let update_board = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/kanban/boards/{board_id}")))
        .json(&json!({ "columns": columns }))
        .send()
        .await
        .expect("update board");
    assert_eq!(update_board.status(), StatusCode::OK);

    let create_task = fixture
        .client
        .post(fixture.endpoint("/api/tasks"))
        .json(&json!({
            "title": "A2A lane terminal state",
            "objective": "Track the remote A2A task until completion",
            "workspaceId": "default",
            "boardId": board_id,
            "columnId": "todo"
        }))
        .send()
        .await
        .expect("create task");
    assert_eq!(create_task.status(), StatusCode::CREATED);
    let task_json: Value = create_task.json().await.expect("decode task");
    let task_id = task_json["task"]["id"].as_str().expect("task id");

    let mut completed_task = None;
    for _ in 0..40 {
        let response = fixture
            .client
            .get(fixture.endpoint(&format!("/api/tasks/{task_id}")))
            .send()
            .await
            .expect("get task");
        assert_eq!(response.status(), StatusCode::OK);
        let persisted_json: Value = response.json().await.expect("decode persisted task");
        let lane_session = &persisted_json["task"]["laneSessions"][0];
        if lane_session["status"].as_str() == Some("completed") {
            completed_task = Some(persisted_json);
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let persisted_json = completed_task.expect("expected A2A lane session to complete");
    assert_eq!(persisted_json["task"]["triggerSessionId"], Value::Null);
    assert_eq!(
        persisted_json["task"]["laneSessions"][0]["status"].as_str(),
        Some("completed")
    );
    assert_eq!(
        persisted_json["task"]["laneSessions"][0]["completedAt"].as_str(),
        Some("2026-03-21T00:00:05Z")
    );
    assert_eq!(persisted_json["task"]["lastSyncError"], Value::Null);
}

#[tokio::test]
async fn api_task_create_applies_a2a_auth_config_headers() {
    let fixture = ApiFixture::new().await;
    let mock_a2a_base = start_mock_a2a_server_with_headers(std::collections::HashMap::from([
        (
            "authorization".to_string(),
            "Bearer secret-token".to_string(),
        ),
        ("x-tenant".to_string(), "review-team".to_string()),
    ]))
    .await;

    std::env::set_var(
        "ROUTA_A2A_AUTH_CONFIGS",
        r#"{"remote-review-auth":{"headers":{"Authorization":"Bearer secret-token","X-Tenant":"review-team"}}}"#,
    );

    let boards_response = fixture
        .client
        .get(fixture.endpoint("/api/kanban/boards?workspaceId=default"))
        .send()
        .await
        .expect("list boards");
    assert_eq!(boards_response.status(), StatusCode::OK);
    let boards_json: Value = boards_response.json().await.expect("decode boards");
    let board_id = boards_json["boards"][0]["id"].as_str().expect("board id");

    let board_response = fixture
        .client
        .get(fixture.endpoint(&format!("/api/kanban/boards/{board_id}")))
        .send()
        .await
        .expect("get board");
    assert_eq!(board_response.status(), StatusCode::OK);
    let board_json: Value = board_response.json().await.expect("decode board");
    let mut columns = board_json["board"]["columns"]
        .as_array()
        .expect("columns array")
        .clone();
    let todo = columns
        .iter_mut()
        .find(|column| column["id"].as_str() == Some("todo"))
        .expect("todo column");
    todo["automation"] = json!({
        "enabled": true,
        "steps": [
            {
                "id": "todo-a2a",
                "transport": "a2a",
                "role": "CRAFTER",
                "specialistName": "Todo Remote Worker",
                "agentCardUrl": format!("{}/card", mock_a2a_base),
                "skillId": "remote-skill",
                "authConfigId": "remote-review-auth"
            }
        ]
    });

    let update_board = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/kanban/boards/{board_id}")))
        .json(&json!({ "columns": columns }))
        .send()
        .await
        .expect("update board");
    assert_eq!(update_board.status(), StatusCode::OK);

    let create_task = fixture
        .client
        .post(fixture.endpoint("/api/tasks"))
        .json(&json!({
            "title": "A2A lane auth task",
            "objective": "Trigger remote A2A automation with auth",
            "workspaceId": "default",
            "boardId": board_id,
            "columnId": "todo"
        }))
        .send()
        .await
        .expect("create task");
    assert_eq!(create_task.status(), StatusCode::CREATED);
    let task_json: Value = create_task.json().await.expect("decode task");
    let task_id = task_json["task"]["id"].as_str().expect("task id");

    let get_task = fixture
        .client
        .get(fixture.endpoint(&format!("/api/tasks/{task_id}")))
        .send()
        .await
        .expect("get task");
    assert_eq!(get_task.status(), StatusCode::OK);
    let persisted_json: Value = get_task.json().await.expect("decode persisted task");
    assert_eq!(
        persisted_json["task"]["laneSessions"][0]["externalTaskId"].as_str(),
        Some("remote-task-1")
    );

    std::env::remove_var("ROUTA_A2A_AUTH_CONFIGS");
}

#[tokio::test]
async fn api_a2a_rpc_supports_spec_task_methods() {
    let fixture = ApiFixture::new().await;

    let method_list = fixture
        .client
        .post(fixture.endpoint("/api/a2a/rpc"))
        .json(&json!({
            "jsonrpc": "2.0",
            "id": "1",
            "method": "method_list"
        }))
        .send()
        .await
        .expect("method_list request");
    assert_eq!(method_list.status(), StatusCode::OK);
    let method_list_json: Value = method_list.json().await.expect("decode method list");
    let methods = method_list_json["result"]["methods"]
        .as_array()
        .expect("methods array");
    assert!(methods
        .iter()
        .any(|value| value.as_str() == Some("SendMessage")));
    assert!(methods
        .iter()
        .any(|value| value.as_str() == Some("GetTask")));

    let send_message = fixture
        .client
        .post(fixture.endpoint("/api/a2a/rpc"))
        .json(&json!({
            "jsonrpc": "2.0",
            "id": "2",
            "method": "SendMessage",
            "params": {
                "message": {
                    "role": "user",
                    "parts": [{ "type": "text", "text": "Verify Rust A2A JSON-RPC flow" }]
                },
                "metadata": {
                    "workspaceId": "default"
                }
            }
        }))
        .send()
        .await
        .expect("send message request");
    assert_eq!(send_message.status(), StatusCode::OK);
    let send_json: Value = send_message.json().await.expect("decode send message");
    let task_id = send_json["result"]["task"]["id"]
        .as_str()
        .expect("task id")
        .to_string();
    assert_eq!(
        send_json["result"]["task"]["status"]["state"].as_str(),
        Some("submitted")
    );

    tokio::time::sleep(Duration::from_millis(300)).await;

    let get_task = fixture
        .client
        .post(fixture.endpoint("/api/a2a/rpc"))
        .json(&json!({
            "jsonrpc": "2.0",
            "id": "3",
            "method": "GetTask",
            "params": { "id": task_id }
        }))
        .send()
        .await
        .expect("get task request");
    assert_eq!(get_task.status(), StatusCode::OK);
    let get_task_json: Value = get_task.json().await.expect("decode get task");
    assert_eq!(
        get_task_json["result"]["task"]["status"]["state"].as_str(),
        Some("completed")
    );
}
