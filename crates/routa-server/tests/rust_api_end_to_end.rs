use std::fs::{self, File};
use std::io::Write as _;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

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

fn random_repo_path() -> PathBuf {
    std::env::temp_dir().join(format!("routa-server-repo-{}", uuid::Uuid::new_v4()))
}

fn write_repo_file(path: &std::path::Path, file_name: &str, content: &str) {
    let file_path = path.join(file_name);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    let mut file = File::create(file_path).unwrap();
    file.write_all(content.as_bytes()).unwrap();
}

fn run_git(repo_path: &std::path::Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .status()
        .expect("run git command");
    assert!(status.success(), "git {:?} should succeed", args);
}

fn init_git_repo(repo_path: &std::path::Path) {
    fs::create_dir_all(repo_path).expect("create repo dir");
    run_git(repo_path, &["init", "--initial-branch=main"]);
    run_git(repo_path, &["config", "user.email", "test@example.com"]);
    run_git(repo_path, &["config", "user.name", "Routa Test"]);
}

fn json_has_error(resp: &Value, expected: &str) -> bool {
    resp.get("error")
        .and_then(Value::as_str)
        .is_some_and(|message| message.contains(expected))
}

#[tokio::test]
async fn api_workspace_and_note_flow() {
    let fixture = ApiFixture::new().await;

    // Use-case: start from default workspace, create workspace, and persist notes under it.
    let list_response = fixture
        .client
        .get(fixture.endpoint("/api/workspaces"))
        .send()
        .await
        .expect("list workspaces");
    assert_eq!(list_response.status(), StatusCode::OK);

    let list_json: Value = list_response.json().await.expect("decode workspace list");
    let has_default = list_json
        .get("workspaces")
        .and_then(Value::as_array)
        .expect("workspaces array")
        .iter()
        .any(|workspace| workspace.get("id").and_then(Value::as_str) == Some("default"));
    assert!(has_default, "default workspace should exist");

    let create_workspace = fixture
        .client
        .post(fixture.endpoint("/api/workspaces"))
        .json(&json!({"title":"Rust API Workspace"}))
        .send()
        .await
        .expect("create workspace");
    assert_eq!(create_workspace.status(), StatusCode::OK);

    let created_workspace: Value = create_workspace
        .json()
        .await
        .expect("decode workspace create response");
    let workspace_id = created_workspace["workspace"]["id"]
        .as_str()
        .expect("workspace id");

    let get_workspace = fixture
        .client
        .get(fixture.endpoint(&format!("/api/workspaces/{workspace_id}")))
        .send()
        .await
        .expect("get created workspace");
    assert_eq!(get_workspace.status(), StatusCode::OK);

    let updated_workspace = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/workspaces/{workspace_id}")))
        .json(&json!({"title":"Rust API Workspace v2"}))
        .send()
        .await
        .expect("update workspace");
    assert_eq!(updated_workspace.status(), StatusCode::OK);

    let updated_workspace: Value = updated_workspace
        .json()
        .await
        .expect("decode workspace update response");
    assert_eq!(
        updated_workspace["workspace"]["title"]
            .as_str()
            .expect("workspace title"),
        "Rust API Workspace v2"
    );

    let note_response = fixture
        .client
        .post(fixture.endpoint("/api/notes"))
        .json(&json!({
            "title":"Use-case note",
            "content":"track workspace flow",
            "workspaceId": workspace_id,
            "noteType": "general"
        }))
        .send()
        .await
        .expect("create note");
    assert_eq!(note_response.status(), StatusCode::OK);

    let note_json: Value = note_response
        .json()
        .await
        .expect("decode create note response");
    let note_id = note_json["note"]["id"].as_str().expect("note id");

    let list_notes = fixture
        .client
        .get(fixture.endpoint(&format!("/api/notes?workspaceId={workspace_id}")))
        .send()
        .await
        .expect("list workspace notes");
    assert_eq!(list_notes.status(), StatusCode::OK);
    let notes: Value = list_notes.json().await.expect("decode notes list");
    assert!(notes.get("notes").and_then(Value::as_array).is_some());

    let get_note = fixture
        .client
        .get(fixture.endpoint(&format!(
            "/api/notes?workspaceId={workspace_id}&noteId={note_id}"
        )))
        .send()
        .await
        .expect("get note by id");
    assert_eq!(get_note.status(), StatusCode::OK);
    let note_item: Value = get_note.json().await.expect("decode note query");
    assert_eq!(note_item["note"]["id"].as_str().expect("note id"), note_id);

    let archived_workspace = fixture
        .client
        .post(fixture.endpoint(&format!("/api/workspaces/{workspace_id}/archive")))
        .send()
        .await
        .expect("archive workspace");
    assert_eq!(archived_workspace.status(), StatusCode::OK);
    let archived_json: Value = archived_workspace
        .json()
        .await
        .expect("decode archived workspace");
    assert_eq!(
        archived_json["workspace"]["status"]
            .as_str()
            .expect("workspace status"),
        "archived"
    );

    let active_only_response = fixture
        .client
        .get(fixture.endpoint("/api/workspaces?status=active"))
        .send()
        .await
        .expect("list active workspaces");
    assert_eq!(active_only_response.status(), StatusCode::OK);
    let active_only_json: Value = active_only_response
        .json()
        .await
        .expect("decode active workspace list");
    let active_has_archived_workspace = active_only_json
        .get("workspaces")
        .and_then(Value::as_array)
        .expect("active workspaces array")
        .iter()
        .any(|workspace| workspace.get("id").and_then(Value::as_str) == Some(workspace_id));
    assert!(
        !active_has_archived_workspace,
        "archived workspace should not appear in active workspace list"
    );

    let archived_only_response = fixture
        .client
        .get(fixture.endpoint("/api/workspaces?status=archived"))
        .send()
        .await
        .expect("list archived workspaces");
    assert_eq!(archived_only_response.status(), StatusCode::OK);
    let archived_only_json: Value = archived_only_response
        .json()
        .await
        .expect("decode archived workspace list");
    let archived_has_workspace = archived_only_json
        .get("workspaces")
        .and_then(Value::as_array)
        .expect("archived workspaces array")
        .iter()
        .any(|workspace| workspace.get("id").and_then(Value::as_str) == Some(workspace_id));
    assert!(
        archived_has_workspace,
        "archived workspace should appear in archived workspace list"
    );

    let delete_note = fixture
        .client
        .delete(fixture.endpoint(&format!(
            "/api/notes?noteId={note_id}&workspaceId={workspace_id}"
        )))
        .send()
        .await
        .expect("delete note");
    assert_eq!(delete_note.status(), StatusCode::OK);

    let delete_workspace = fixture
        .client
        .delete(fixture.endpoint(&format!("/api/workspaces/{workspace_id}")))
        .send()
        .await
        .expect("delete workspace");
    assert_eq!(delete_workspace.status(), StatusCode::OK);

    let deleted_workspace = fixture
        .client
        .get(fixture.endpoint(&format!("/api/workspaces/{workspace_id}")))
        .send()
        .await
        .expect("get deleted workspace");
    assert_eq!(deleted_workspace.status(), StatusCode::NOT_FOUND);
    let deleted_workspace_json: Value = deleted_workspace
        .json()
        .await
        .expect("decode deleted workspace response");
    assert!(json_has_error(
        &deleted_workspace_json,
        &format!("Workspace {} not found", workspace_id),
    ));
}

#[tokio::test]
async fn api_task_flow_with_validation() {
    let fixture = ApiFixture::new().await;

    let create_task = fixture
        .client
        .post(fixture.endpoint("/api/tasks"))
        .json(&json!({
            "title": "Rust API Task",
            "objective": "Drive API coverage and state transition",
            "workspaceId": "default"
        }))
        .send()
        .await
        .expect("create task");
    assert_eq!(create_task.status(), StatusCode::CREATED);

    let created_task: Value = create_task
        .json()
        .await
        .expect("decode task create response");
    let task_id = created_task["task"]["id"].as_str().expect("task id");

    let get_task = fixture
        .client
        .get(fixture.endpoint(&format!("/api/tasks/{task_id}")))
        .send()
        .await
        .expect("get task");
    assert_eq!(get_task.status(), StatusCode::OK);

    let rename_task = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/tasks/{task_id}")))
        .json(&json!({"title":"Rust API Task v2"}))
        .send()
        .await
        .expect("update task title");
    assert_eq!(rename_task.status(), StatusCode::OK);

    let rename_json: Value = rename_task
        .json()
        .await
        .expect("decode task rename response");
    assert_eq!(
        rename_json["task"]["title"]
            .as_str()
            .expect("updated title"),
        "Rust API Task v2"
    );

    let conflict = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/tasks/{task_id}")))
        .json(&json!({
            "status":"COMPLETED",
            "columnId":"dev",
            "scope":"Drive API validation coverage through the Dev lane.",
            "acceptanceCriteria":["The workflow state must remain internally consistent."],
            "verificationCommands":["cargo test -p routa-server --test rust_api_end_to_end -- api_task_flow_with_validation"]
        }))
        .send()
        .await
        .expect("invalid task transition");
    assert_eq!(conflict.status(), StatusCode::BAD_REQUEST);
    let conflict_json: Value = conflict.json().await.expect("decode conflict response");
    assert!(json_has_error(
        &conflict_json,
        "must describe the same workflow state"
    ));

    let complete_task = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/tasks/{task_id}")))
        .json(&json!({"status":"COMPLETED"}))
        .send()
        .await
        .expect("mark task completed");
    assert_eq!(complete_task.status(), StatusCode::OK);

    let complete_json: Value = complete_task
        .json()
        .await
        .expect("decode task complete response");
    assert_eq!(
        complete_json["task"]["status"]
            .as_str()
            .expect("task status"),
        "COMPLETED"
    );

    let by_status = fixture
        .client
        .get(fixture.endpoint("/api/tasks?workspaceId=default&status=COMPLETED"))
        .send()
        .await
        .expect("list completed tasks");
    assert_eq!(by_status.status(), StatusCode::OK);
    let by_status_json: Value = by_status.json().await.expect("decode task list by status");
    let completed_matches = by_status_json
        .get("tasks")
        .and_then(Value::as_array)
        .expect("tasks array")
        .iter()
        .any(|item| item.get("id").and_then(Value::as_str) == Some(task_id));
    assert!(completed_matches);

    let invalid_status = fixture
        .client
        .post(fixture.endpoint(&format!("/api/tasks/{task_id}/status")))
        .json(&json!({"status":"INVALID"}))
        .send()
        .await
        .expect("task invalid status");
    assert_eq!(invalid_status.status(), StatusCode::BAD_REQUEST);

    let status_update = fixture
        .client
        .post(fixture.endpoint(&format!("/api/tasks/{task_id}/status")))
        .json(&json!({"status":"IN_PROGRESS"}))
        .send()
        .await
        .expect("task status update");
    assert_eq!(status_update.status(), StatusCode::OK);

    let delete_task = fixture
        .client
        .delete(fixture.endpoint(&format!("/api/tasks/{task_id}")))
        .send()
        .await
        .expect("delete task");
    assert_eq!(delete_task.status(), StatusCode::OK);
}

#[tokio::test]
async fn api_codebase_and_file_search_flow() {
    let fixture = ApiFixture::new().await;
    let repo_path = random_repo_path();
    init_git_repo(&repo_path);
    write_repo_file(&repo_path, "README.md", "# routa\n");
    write_repo_file(&repo_path, "src/lib.rs", "pub fn main() {}\n");
    run_git(&repo_path, &["add", "."]);
    run_git(&repo_path, &["commit", "-m", "initial"]);
    write_repo_file(
        &repo_path,
        "src/lib.rs",
        "pub fn main() { println!(\"changed\"); }\n",
    );
    write_repo_file(&repo_path, "notes/todo.md", "- pending\n");

    let codebase_created = fixture
        .client
        .post(fixture.endpoint("/api/workspaces/default/codebases"))
        .json(&json!({
            "repoPath": repo_path.to_string_lossy().to_string(),
            "label": "unit-test-fixture",
            "isDefault": true
        }))
        .send()
        .await
        .expect("create codebase");
    assert_eq!(codebase_created.status(), StatusCode::OK);
    let codebase_json: Value = codebase_created
        .json()
        .await
        .expect("decode codebase response");
    let codebase_id = codebase_json["codebase"]["id"]
        .as_str()
        .expect("codebase id");

    let duplicate_codebase = fixture
        .client
        .post(fixture.endpoint("/api/workspaces/default/codebases"))
        .json(&json!({
            "repoPath": repo_path.to_string_lossy().to_string(),
            "label": "duplicate"
        }))
        .send()
        .await
        .expect("duplicate codebase");
    assert_eq!(duplicate_codebase.status(), StatusCode::CONFLICT);

    let update_codebase = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/codebases/{codebase_id}")))
        .json(&json!({
            "branch":"main"
        }))
        .send()
        .await
        .expect("update codebase");
    assert_eq!(update_codebase.status(), StatusCode::OK);

    let default_codebase = fixture
        .client
        .post(fixture.endpoint(&format!("/api/codebases/{codebase_id}/default")))
        .send()
        .await
        .expect("set default codebase");
    assert_eq!(default_codebase.status(), StatusCode::OK);
    let default_json: Value = default_codebase
        .json()
        .await
        .expect("decode default codebase response");
    assert!(default_json["codebase"]["isDefault"]
        .as_bool()
        .expect("isDefault"));

    let search = fixture
        .client
        .get(fixture.endpoint(&format!(
            "/api/files/search?repoPath={}&q=lib&limit=5",
            repo_path.to_string_lossy()
        )))
        .send()
        .await
        .expect("search repo files");
    assert_eq!(search.status(), StatusCode::OK);
    let search_json: Value = search.json().await.expect("decode files search response");
    let search_files = search_json
        .get("files")
        .and_then(Value::as_array)
        .expect("files array");
    assert!(search_files.iter().any(|item| {
        item.get("path")
            .and_then(Value::as_str)
            .is_some_and(|path| path.contains("lib.rs"))
    }));

    let changes = fixture
        .client
        .get(fixture.endpoint("/api/workspaces/default/codebases/changes"))
        .send()
        .await
        .expect("list codebase changes");
    assert_eq!(changes.status(), StatusCode::OK);
    let changes_json: Value = changes.json().await.expect("decode codebase changes");
    let repos = changes_json["repos"].as_array().expect("repos array");
    assert_eq!(repos.len(), 1);
    assert_eq!(repos[0]["branch"].as_str(), Some("main"));
    assert_eq!(repos[0]["status"]["modified"].as_i64(), Some(1));
    assert_eq!(repos[0]["status"]["untracked"].as_i64(), Some(1));
    let files = repos[0]["files"].as_array().expect("files array");
    assert!(files
        .iter()
        .any(|item| item["path"].as_str() == Some("src/lib.rs")));
    assert!(files
        .iter()
        .any(|item| item["path"].as_str() == Some("notes/todo.md")));

    let invalid_search = fixture
        .client
        .get(fixture.endpoint("/api/files/search?q=main"))
        .send()
        .await
        .expect("invalid search request");
    assert_eq!(invalid_search.status(), StatusCode::BAD_REQUEST);

    let delete_codebase = fixture
        .client
        .delete(fixture.endpoint(&format!("/api/codebases/{codebase_id}")))
        .send()
        .await
        .expect("delete codebase");
    assert_eq!(delete_codebase.status(), StatusCode::OK);

    let _ = fs::remove_dir_all(&repo_path);
}

#[tokio::test]
async fn api_agent_flow_with_validation() {
    let fixture = ApiFixture::new().await;

    let initial_list = fixture
        .client
        .get(fixture.endpoint("/api/agents?workspaceId=default"))
        .send()
        .await
        .expect("list agents");
    assert_eq!(initial_list.status(), StatusCode::OK);
    let initial: Value = initial_list
        .json()
        .await
        .expect("decode initial agent list");
    assert!(initial.get("agents").and_then(Value::as_array).is_some());

    let created_agent = fixture
        .client
        .post(fixture.endpoint("/api/agents"))
        .json(&json!({
            "name": "AI Fitness Verifier",
            "role": "GATE",
            "workspaceId": "default"
        }))
        .send()
        .await
        .expect("create agent");
    assert_eq!(created_agent.status(), StatusCode::OK);

    let created: Value = created_agent.json().await.expect("decode created agent");
    let agent_id = created["agent"]["id"]
        .as_str()
        .expect("agent id should exist");

    let get_by_path = fixture
        .client
        .get(fixture.endpoint(&format!("/api/agents/{agent_id}")))
        .send()
        .await
        .expect("get created agent");
    assert_eq!(get_by_path.status(), StatusCode::OK);
    let get_by_path_json: Value = get_by_path
        .json()
        .await
        .expect("decode get by path response");
    assert_eq!(get_by_path_json["id"].as_str().expect("agent id"), agent_id);
    assert_eq!(
        get_by_path_json["name"].as_str().expect("agent name"),
        "AI Fitness Verifier"
    );
    assert_eq!(
        get_by_path_json["status"].as_str().expect("agent status"),
        "PENDING"
    );

    let get_by_query = fixture
        .client
        .get(fixture.endpoint(&format!("/api/agents?id={agent_id}")))
        .send()
        .await
        .expect("get by query");
    assert_eq!(get_by_query.status(), StatusCode::OK);
    let get_by_query_json: Value = get_by_query.json().await.expect("decode query response");
    assert_eq!(
        get_by_query_json["id"].as_str().expect("agent id"),
        agent_id
    );

    let status_update = fixture
        .client
        .post(fixture.endpoint(&format!("/api/agents/{agent_id}/status")))
        .json(&json!({"status":"ACTIVE"}))
        .send()
        .await
        .expect("update agent status");
    assert_eq!(status_update.status(), StatusCode::OK);
    let status_update_json: Value = status_update
        .json()
        .await
        .expect("decode status update response");
    assert!(status_update_json["updated"].as_bool().unwrap_or(false));

    let get_after_update = fixture
        .client
        .get(fixture.endpoint(&format!("/api/agents/{agent_id}")))
        .send()
        .await
        .expect("get updated agent");
    let updated_agent: Value = get_after_update.json().await.expect("decode updated agent");
    assert_eq!(
        updated_agent["status"].as_str().expect("agent status"),
        "ACTIVE"
    );

    let list_active = fixture
        .client
        .get(fixture.endpoint("/api/agents?workspaceId=default&status=ACTIVE"))
        .send()
        .await
        .expect("list active agents");
    assert_eq!(list_active.status(), StatusCode::OK);
    let list_active_json: Value = list_active.json().await.expect("decode active agents");
    assert!(
        list_active_json
            .get("agents")
            .and_then(Value::as_array)
            .expect("agents array")
            .iter()
            .any(|agent| agent.get("id").and_then(Value::as_str) == Some(agent_id)),
        "active agent should be listable by status"
    );

    let invalid_status = fixture
        .client
        .post(fixture.endpoint(&format!("/api/agents/{agent_id}/status")))
        .json(&json!({"status":"INVALID"}))
        .send()
        .await
        .expect("invalid status");
    assert_eq!(invalid_status.status(), StatusCode::BAD_REQUEST);

    let delete_agent = fixture
        .client
        .delete(fixture.endpoint(&format!("/api/agents/{agent_id}")))
        .send()
        .await
        .expect("delete agent");
    assert_eq!(delete_agent.status(), StatusCode::OK);
    let delete_json: Value = delete_agent.json().await.expect("decode delete response");
    assert!(delete_json["deleted"].as_bool().unwrap_or(false));

    let after_delete = fixture
        .client
        .get(fixture.endpoint(&format!("/api/agents/{agent_id}")))
        .send()
        .await
        .expect("get deleted agent");
    assert_eq!(after_delete.status(), StatusCode::NOT_FOUND);

    let invalid_role = fixture
        .client
        .post(fixture.endpoint("/api/agents"))
        .json(&json!({
            "name": "Invalid Role Agent",
            "role": "UNKNOWN",
            "workspaceId": "default"
        }))
        .send()
        .await
        .expect("create invalid role agent");
    assert_eq!(invalid_role.status(), StatusCode::BAD_REQUEST);

    let final_list = fixture
        .client
        .get(fixture.endpoint("/api/agents?workspaceId=default"))
        .send()
        .await
        .expect("list agents again");
    assert_eq!(final_list.status(), StatusCode::OK);
    let final_json: Value = final_list.json().await.expect("decode final agent list");
    let final_count = final_json
        .get("agents")
        .and_then(Value::as_array)
        .expect("final agents array")
        .len();
    assert!(
        final_count
            >= initial
                .get("agents")
                .and_then(Value::as_array)
                .map(|v| v.len())
                .unwrap_or(0)
    );
}

#[tokio::test]
async fn api_session_contract_with_negative_paths() {
    let fixture = ApiFixture::new().await;

    let list_sessions = fixture
        .client
        .get(fixture.endpoint("/api/sessions?workspaceId=default&limit=10"))
        .send()
        .await
        .expect("list sessions");
    assert_eq!(list_sessions.status(), StatusCode::OK);
    let list_json: Value = list_sessions.json().await.expect("decode session list");
    assert!(list_json
        .get("sessions")
        .and_then(Value::as_array)
        .is_some());

    let fake_session = uuid::Uuid::new_v4().to_string();

    let history = fixture
        .client
        .get(fixture.endpoint(&format!("/api/sessions/{fake_session}/history")))
        .send()
        .await
        .expect("get missing session history");
    assert_eq!(history.status(), StatusCode::OK);
    let history_json: Value = history.json().await.expect("decode session history");
    assert!(history_json
        .get("history")
        .and_then(Value::as_array)
        .is_some());

    let context = fixture
        .client
        .get(fixture.endpoint(&format!("/api/sessions/{fake_session}/context")))
        .send()
        .await
        .expect("get missing session context");
    assert_eq!(context.status(), StatusCode::NOT_FOUND);

    let rename = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/sessions/{fake_session}")))
        .json(&json!({"name":"should-not-exist"}))
        .send()
        .await
        .expect("rename missing session");
    assert_eq!(rename.status(), StatusCode::NOT_FOUND);

    let disconnect = fixture
        .client
        .post(fixture.endpoint(&format!("/api/sessions/{fake_session}/disconnect")))
        .send()
        .await
        .expect("disconnect missing session");
    assert_eq!(disconnect.status(), StatusCode::NOT_FOUND);

    let delete = fixture
        .client
        .delete(fixture.endpoint(&format!("/api/sessions/{fake_session}")))
        .send()
        .await
        .expect("delete missing session");
    assert_eq!(delete.status(), StatusCode::OK);

    let acp_initialize = fixture
        .client
        .post(fixture.endpoint("/api/acp"))
        .json(&json!({
            "jsonrpc": "2.0",
            "id": "fitness-acp-health",
            "method": "initialize",
            "params": { "protocolVersion": 1 }
        }))
        .send()
        .await
        .expect("initialize acp");
    assert_eq!(acp_initialize.status(), StatusCode::OK);
    let initialize_json: Value = acp_initialize
        .json()
        .await
        .expect("decode acp initialize response");
    assert_eq!(
        initialize_json["result"]["protocolVersion"]
            .as_u64()
            .expect("protocolVersion"),
        1
    );
    assert_eq!(
        initialize_json["result"]["agentInfo"]["name"]
            .as_str()
            .expect("agent name"),
        "routa-acp"
    );

    let acp_unknown_method = fixture
        .client
        .post(fixture.endpoint("/api/acp"))
        .json(&json!({
            "jsonrpc": "2.0",
            "id": "fitness-acp-unknown",
            "method": "unknownMethod"
        }))
        .send()
        .await
        .expect("acp unknown method");
    assert_eq!(acp_unknown_method.status(), StatusCode::OK);
    let unknown_json: Value = acp_unknown_method
        .json()
        .await
        .expect("decode acp unknown response");
    assert_eq!(
        unknown_json["error"]["code"].as_i64().expect("error code"),
        -32601
    );
}

#[tokio::test]
async fn api_health_contract() {
    let fixture = ApiFixture::new().await;

    let health = fixture
        .client
        .get(fixture.endpoint("/api/health"))
        .send()
        .await
        .expect("health check");
    assert_eq!(health.status(), StatusCode::OK);

    let payload: Value = health.json().await.expect("decode health response");

    assert_eq!(payload["status"].as_str().expect("status"), "ok");
    assert!(payload["server"]
        .as_str()
        .is_some_and(|server| server == "routa-server"));
    let timestamp = payload["timestamp"].as_str().expect("timestamp");
    chrono::DateTime::parse_from_rfc3339(timestamp).expect("timestamp format");
    assert!(payload
        .get("version")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty()));
}

#[tokio::test]
async fn api_contract_negative_filters() {
    let fixture = ApiFixture::new().await;

    let invalid_workspace = fixture
        .client
        .post(fixture.endpoint("/api/workspaces"))
        .json(&json!({"metadata": {"source":"contract"}}))
        .send()
        .await
        .expect("create workspace without title");
    assert_eq!(invalid_workspace.status(), StatusCode::BAD_REQUEST);
    let invalid_workspace_json: Value = invalid_workspace
        .json()
        .await
        .expect("decode invalid workspace response");
    assert!(invalid_workspace_json
        .get("error")
        .and_then(Value::as_str)
        .is_some_and(|message| message.to_lowercase().contains("title")));

    let missing_workspace = fixture
        .client
        .get(fixture.endpoint("/api/workspaces/not-found-workspace"))
        .send()
        .await
        .expect("get missing workspace");
    assert_eq!(missing_workspace.status(), StatusCode::NOT_FOUND);
    let missing_workspace_json: Value = missing_workspace
        .json()
        .await
        .expect("decode missing workspace response");
    assert!(json_has_error(
        &missing_workspace_json,
        "Workspace not-found-workspace not found"
    ));

    let invalid_task_status = fixture
        .client
        .get(fixture.endpoint("/api/tasks?status=INVALID_STATUS"))
        .send()
        .await
        .expect("list tasks with invalid status");
    assert_eq!(invalid_task_status.status(), StatusCode::BAD_REQUEST);
    let invalid_task_status_json: Value = invalid_task_status
        .json()
        .await
        .expect("decode invalid task status response");
    assert!(json_has_error(&invalid_task_status_json, "Invalid status"));

    let fake_session = uuid::Uuid::new_v4().to_string();

    let session_get = fixture
        .client
        .get(fixture.endpoint(&format!("/api/sessions/{fake_session}")))
        .send()
        .await
        .expect("get missing session");
    assert_eq!(session_get.status(), StatusCode::NOT_FOUND);

    let consolidated_history = fixture
        .client
        .get(fixture.endpoint(&format!(
            "/api/sessions/{fake_session}/history?consolidated=true"
        )))
        .send()
        .await
        .expect("get session history consolidated");
    assert_eq!(consolidated_history.status(), StatusCode::OK);
    let consolidated_history_json: Value = consolidated_history
        .json()
        .await
        .expect("decode consolidated history response");
    assert!(consolidated_history_json
        .get("history")
        .and_then(Value::as_array)
        .is_some());
}

#[tokio::test]
async fn api_mcp_tools_include_delegate_task_tool() {
    let fixture = ApiFixture::new().await;

    let list_tools = fixture
        .client
        .get(fixture.endpoint("/api/mcp/tools"))
        .send()
        .await
        .expect("list mcp tools");
    assert_eq!(list_tools.status(), StatusCode::OK);

    let tool_payload: Value = list_tools.json().await.expect("decode mcp tools response");
    let tools = tool_payload
        .get("tools")
        .and_then(Value::as_array)
        .expect("tools array");
    let has_delegate = tools
        .iter()
        .filter_map(|tool| tool.get("name").and_then(Value::as_str))
        .any(|name| name == "delegate_task_to_agent");
    assert!(
        has_delegate,
        "delegate_task_to_agent should be discoverable"
    );
}

#[tokio::test]
async fn api_mcp_tools_delegate_task_to_agent_contract() {
    let fixture = ApiFixture::new().await;

    let create_task = fixture
        .client
        .post(fixture.endpoint("/api/tasks"))
        .json(&json!({
            "title": "Run MCP delegate tool",
            "objective": "Smoke validate delegate tool execution path",
            "workspaceId": "default"
        }))
        .send()
        .await
        .expect("create task");
    assert_eq!(create_task.status(), StatusCode::CREATED);
    let created_task: Value = create_task.json().await.expect("decode create task");
    let task_id = created_task["task"]["id"]
        .as_str()
        .expect("task id should exist");

    let delegate_response = fixture
        .client
        .post(fixture.endpoint("/api/mcp/tools"))
        .json(&json!({
            "name": "delegate_task_to_agent",
            "args": {
                "taskId": task_id,
                "callerAgentId": "team-lead-smoke",
                "specialist": "CRAFTER",
                "waitMode": "immediate"
            }
        }))
        .send()
        .await
        .expect("call delegate_task_to_agent");
    assert_eq!(delegate_response.status(), StatusCode::OK);

    let delegate_json: Value = delegate_response
        .json()
        .await
        .expect("decode delegate response");

    let content = delegate_json
        .get("content")
        .and_then(Value::as_array)
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("text"))
        .and_then(Value::as_str)
        .expect("delegate tool should include text result");

    let is_error = delegate_json
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let result = if is_error {
        let error = content;
        assert!(
            error.contains("Failed to delegate task")
                || error.contains("Task not found")
                || error.contains("Failed to spawn agent process"),
            "unexpected delegate error: {}",
            error
        );
        return;
    } else {
        serde_json::from_str::<Value>(content).expect("decode tool result json")
    };

    let success = result
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if success {
        let data = result
            .get("data")
            .and_then(Value::as_object)
            .expect("delegate result should have data");
        assert_eq!(data["taskId"].as_str().expect("taskId"), task_id);
        assert!(data.get("agentId").and_then(Value::as_str).is_some());
        assert!(data.get("sessionId").and_then(Value::as_str).is_some());
        assert_eq!(data["waitMode"].as_str().expect("waitMode"), "immediate");
        let specialist = data["specialist"].as_str().expect("specialist");
        assert!(specialist == "crafter" || specialist == "CRAFTER");
    } else {
        let error = result
            .get("error")
            .and_then(Value::as_str)
            .expect("delegate failure should provide error");
        assert!(
            error.contains("Failed to delegate task")
                || error.contains("Task not found")
                || error.contains("Failed to spawn agent process"),
            "unexpected delegate error: {}",
            error
        );
    }
}

#[tokio::test]
async fn api_mcp_tools_accept_prefixed_tool_name() {
    let fixture = ApiFixture::new().await;

    let response = fixture
        .client
        .post(fixture.endpoint("/api/mcp/tools"))
        .json(&json!({
            "name": "routa-coordination_list_agents",
            "args": {
                "workspaceId": "default"
            }
        }))
        .send()
        .await
        .expect("call prefixed tool");
    assert_eq!(response.status(), StatusCode::OK);

    let body: Value = response
        .json()
        .await
        .expect("decode prefixed tool response");
    let content = body
        .get("content")
        .and_then(Value::as_array)
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("text"))
        .and_then(Value::as_str)
        .expect("tool response should include text content");

    let agents = serde_json::from_str::<Value>(content).expect("decode agents list");
    assert!(
        agents.as_array().is_some(),
        "expected agents array, got {agents}"
    );
}
