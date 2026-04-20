//! Integration tests for the routa-cli commands.
//!
//! These tests verify that the CLI commands work correctly by
//! exercising the same code paths as the binary, using in-memory
//! SQLite databases for isolation.

use std::sync::Arc;

use routa_cli::commands::kanban as kanban_cmd;
use routa_core::models::kanban_config::KanbanConfig;
use routa_core::rpc::RpcRouter;
use routa_core::state::{AppState, AppStateInner};
use routa_core::Database;

/// Create an in-memory AppState for testing.
async fn test_state() -> AppState {
    let db = Database::open(":memory:").expect("Failed to open in-memory database");
    let state: AppState = Arc::new(AppStateInner::new(db));
    state
        .workspace_store
        .ensure_default()
        .await
        .expect("Failed to initialize default workspace");
    state
}

#[tokio::test]
async fn test_workspace_list() {
    let state = test_state().await;
    let router = RpcRouter::new(state);
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "workspaces.list"
        }))
        .await;

    let result = response.get("result").expect("Expected result field");
    let workspaces = result.get("workspaces").expect("Expected workspaces array");
    assert!(workspaces.is_array());
    assert!(!workspaces.as_array().unwrap().is_empty());

    let default_ws = &workspaces.as_array().unwrap()[0];
    assert_eq!(default_ws["id"], "default");
    assert_eq!(default_ws["title"], "Default Workspace");
}

#[tokio::test]
async fn test_agent_create_and_list() {
    let state = test_state().await;
    let router = RpcRouter::new(state);

    // Create agent
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "agents.create",
            "params": {
                "name": "test-crafter",
                "role": "CRAFTER",
                "workspaceId": "default"
            }
        }))
        .await;

    let result = response.get("result").expect("Expected result");
    let agent_id = result.get("agentId").expect("Expected agentId");
    assert!(agent_id.is_string());

    let agent = result.get("agent").expect("Expected agent");
    assert_eq!(agent["name"], "test-crafter");
    assert_eq!(agent["role"], "CRAFTER");
    assert_eq!(agent["status"], "PENDING");

    // List agents
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "agents.list",
            "params": { "workspaceId": "default" }
        }))
        .await;

    let result = response.get("result").expect("Expected result");
    let agents = result.get("agents").expect("Expected agents");
    assert_eq!(agents.as_array().unwrap().len(), 1);
    assert_eq!(agents[0]["name"], "test-crafter");
}

#[tokio::test]
async fn test_task_create_and_list() {
    let state = test_state().await;
    let router = RpcRouter::new(state);

    // Create task
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tasks.create",
            "params": {
                "title": "Test Task",
                "objective": "Verify CLI works",
                "workspaceId": "default"
            }
        }))
        .await;

    let result = response.get("result").expect("Expected result");
    let task = result.get("task").expect("Expected task");
    assert_eq!(task["title"], "Test Task");
    assert_eq!(task["objective"], "Verify CLI works");
    assert_eq!(task["status"], "PENDING");

    let task_id = task["id"].as_str().unwrap();

    // Get task
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tasks.get",
            "params": { "id": task_id }
        }))
        .await;

    let result = response.get("result").expect("Expected result");
    assert_eq!(result["title"], "Test Task");

    // List tasks
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tasks.list",
            "params": { "workspaceId": "default" }
        }))
        .await;

    let result = response.get("result").expect("Expected result");
    let tasks = result.get("tasks").expect("Expected tasks");
    assert_eq!(tasks.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn test_task_update_status() {
    let state = test_state().await;
    let router = RpcRouter::new(state);

    // Create task
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tasks.create",
            "params": {
                "title": "Status Test",
                "objective": "Test status updates"
            }
        }))
        .await;

    let task_id = response["result"]["task"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Update status
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tasks.updateStatus",
            "params": {
                "id": task_id,
                "status": "IN_PROGRESS"
            }
        }))
        .await;

    assert_eq!(response["result"]["updated"], true);

    // Verify status changed
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tasks.get",
            "params": { "id": task_id }
        }))
        .await;

    assert_eq!(response["result"]["status"], "IN_PROGRESS");
}

#[tokio::test]
async fn test_skills_list() {
    let state = test_state().await;
    let router = RpcRouter::new(state);

    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "skills.list"
        }))
        .await;

    let result = response.get("result").expect("Expected result");
    assert!(result.get("skills").is_some());
}

#[tokio::test]
async fn test_rpc_method_not_found() {
    let state = test_state().await;
    let router = RpcRouter::new(state);

    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "nonexistent.method"
        }))
        .await;

    assert!(response.get("error").is_some());
    assert_eq!(response["error"]["code"], -32601);
}

#[tokio::test]
async fn test_agent_roles() {
    let state = test_state().await;
    let router = RpcRouter::new(state);

    // Test creating agents with all valid roles
    for role in &["ROUTA", "CRAFTER", "GATE", "DEVELOPER"] {
        let response = router
            .handle_value(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "agents.create",
                "params": {
                    "name": format!("test-{}", role.to_lowercase()),
                    "role": role,
                    "workspaceId": "default"
                }
            }))
            .await;

        assert!(
            response.get("result").is_some(),
            "Failed to create agent with role {role}"
        );
        assert_eq!(response["result"]["agent"]["role"], *role);
    }

    // List should show all 4 agents
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "agents.list",
            "params": { "workspaceId": "default" }
        }))
        .await;

    assert_eq!(response["result"]["agents"].as_array().unwrap().len(), 4);
}

#[tokio::test]
async fn test_workspace_create() {
    let state = test_state().await;
    let router = RpcRouter::new(state);

    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "workspaces.create",
            "params": { "title": "my-project" }
        }))
        .await;

    assert!(response.get("result").is_some());

    // List should show default + new workspace
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "workspaces.list"
        }))
        .await;

    let workspaces = response["result"]["workspaces"].as_array().unwrap();
    assert!(workspaces.len() >= 2);
}

// ── Kanban YAML config integration tests ──────────────────────────────────────

const SAMPLE_YAML: &str = r#"
version: 1
name: test-kanban
workspaceId: default
boards:
  - id: board-alpha
    name: Alpha Board
    isDefault: true
    columns:
      - id: backlog
        name: Backlog
        color: slate
        stage: backlog
      - id: dev
        name: Dev
        color: amber
        stage: dev
        automation:
          enabled: true
          providerId: routa-native
          role: CRAFTER
          transitionType: entry
          requiredArtifacts:
            - test_results
            - code_diff
          autoAdvanceOnSuccess: false
"#;

/// Phase 1 – YAML schema: parse → validate → round-trip entirely in-memory.
#[test]
fn test_kanban_yaml_parse_and_validate() {
    let config = KanbanConfig::from_yaml(SAMPLE_YAML).expect("YAML should parse");
    assert_eq!(config.version, 1);
    assert_eq!(config.boards.len(), 1);
    assert_eq!(config.boards[0].id, "board-alpha");
    assert_eq!(config.boards[0].columns.len(), 2);

    let auto = config.boards[0].columns[1].automation.as_ref().unwrap();
    assert!(auto.enabled);
    assert_eq!(auto.provider_id.as_deref(), Some("routa-native"));
    assert_eq!(auto.role.as_deref(), Some("CRAFTER"));
    assert_eq!(auto.transition_type.as_deref(), Some("entry"));
    assert_eq!(auto.required_artifacts.as_ref().unwrap().len(), 2);

    config.validate().expect("config should be valid");
}

/// Phase 1 – YAML round-trip: serialise then re-parse, validation still passes.
#[test]
fn test_kanban_yaml_roundtrip() {
    let config = KanbanConfig::from_yaml(SAMPLE_YAML).unwrap();
    let yaml = config.to_yaml().expect("serialisation should succeed");
    let reparsed = KanbanConfig::from_yaml(&yaml).expect("reparsed config should be valid YAML");
    reparsed
        .validate()
        .expect("round-tripped config should be valid");
    assert_eq!(config.boards[0].id, reparsed.boards[0].id);
    assert_eq!(config.boards[0].columns, reparsed.boards[0].columns);
}

/// Phase 1 – validate rejects an invalid config (duplicate board id).
#[test]
fn test_kanban_yaml_validate_rejects_invalid() {
    let bad_yaml = r#"
version: 1
boards:
  - id: dup
    name: Board A
    columns:
      - id: c1
        name: Col
        stage: backlog
  - id: dup
    name: Board B
    columns:
      - id: c1
        name: Col
        stage: backlog
"#;
    let config = KanbanConfig::from_yaml(bad_yaml).unwrap();
    let errs = config.validate().unwrap_err();
    assert!(errs.iter().any(|e| e.contains("'dup' is duplicated")));
}

/// Phase 2 – validate_config command reads from a temp file and succeeds.
#[tokio::test]
async fn test_kanban_validate_config_from_file() {
    let dir = tempfile::tempdir().expect("failed to create tempdir");
    let path = dir.path().join("kanban.yaml");
    std::fs::write(&path, SAMPLE_YAML).unwrap();
    kanban_cmd::validate_config(path.to_str().unwrap())
        .await
        .expect("validate_config should succeed");
}

/// Phase 2 – apply_config dry-run should not create boards, only plan output.
#[tokio::test]
async fn test_kanban_apply_dry_run_no_writes() {
    let state = test_state().await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("kanban.yaml");
    std::fs::write(&path, SAMPLE_YAML).unwrap();

    kanban_cmd::apply_config(&state, path.to_str().unwrap(), None, true, false)
        .await
        .expect("dry-run apply should succeed");

    // Verify nothing was written: board should not exist.
    let router = RpcRouter::new(state);
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "kanban.listBoards",
            "params": { "workspaceId": "default" }
        }))
        .await;
    let boards = response["result"]["boards"].as_array().unwrap();
    assert!(
        boards.iter().all(|b| b["id"] != "board-alpha"),
        "dry-run must not create any board"
    );
}

/// Phase 2 – apply_config (non-dry-run) creates board with correct columns.
#[tokio::test]
async fn test_kanban_apply_creates_board() {
    let state = test_state().await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("kanban.yaml");
    std::fs::write(&path, SAMPLE_YAML).unwrap();

    kanban_cmd::apply_config(&state, path.to_str().unwrap(), None, false, false)
        .await
        .expect("apply should succeed");

    // Board must now exist with the expected columns.
    let router = RpcRouter::new(state);
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "kanban.getBoard",
            "params": { "boardId": "board-alpha" }
        }))
        .await;
    let board = &response["result"];
    assert_eq!(board["id"], "board-alpha");
    assert_eq!(board["name"], "Alpha Board");
    let cols = board["columns"].as_array().unwrap();
    assert_eq!(cols.len(), 2);
    assert_eq!(cols[0]["id"], "backlog");
    assert_eq!(cols[1]["id"], "dev");
    assert_eq!(cols[1]["stage"], "dev");
}

/// Phase 2 – apply_config is idempotent: running twice must not error.
#[tokio::test]
async fn test_kanban_apply_idempotent() {
    let state = test_state().await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("kanban.yaml");
    std::fs::write(&path, SAMPLE_YAML).unwrap();

    kanban_cmd::apply_config(&state, path.to_str().unwrap(), None, false, false)
        .await
        .expect("first apply");
    kanban_cmd::apply_config(&state, path.to_str().unwrap(), None, false, false)
        .await
        .expect("second apply should also succeed (idempotent)");
}

/// Phase 2 – export_config produces YAML that passes validate_config.
#[tokio::test]
async fn test_kanban_export_roundtrip() {
    let state = test_state().await;
    let dir = tempfile::tempdir().unwrap();
    let apply_path = dir.path().join("kanban.yaml");
    std::fs::write(&apply_path, SAMPLE_YAML).unwrap();

    // Apply first so there is something to export.
    kanban_cmd::apply_config(&state, apply_path.to_str().unwrap(), None, false, false)
        .await
        .expect("apply before export");

    let export_path = dir.path().join("kanban_exported.yaml");
    kanban_cmd::export_config(&state, "default", Some(export_path.to_str().unwrap()))
        .await
        .expect("export should succeed");

    // The exported YAML must pass validate.
    kanban_cmd::validate_config(export_path.to_str().unwrap())
        .await
        .expect("exported YAML must be valid");

    let exported = std::fs::read_to_string(&export_path).expect("exported yaml should be readable");
    let config = KanbanConfig::from_yaml(&exported).expect("exported yaml should parse");
    let automation = config.boards[0].columns[1]
        .automation
        .as_ref()
        .expect("export should preserve automation");
    assert!(automation.enabled);
    assert_eq!(automation.provider_id.as_deref(), Some("routa-native"));
    assert_eq!(automation.role.as_deref(), Some("CRAFTER"));
    assert_eq!(automation.transition_type.as_deref(), Some("entry"));
}
