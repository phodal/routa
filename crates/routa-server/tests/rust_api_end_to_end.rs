use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use reqwest::StatusCode;
use serde_json::{json, Value};
use tempfile::TempDir;

#[path = "common/mod.rs"]
mod common;
use common::ApiFixture;

struct GitRepoFixture {
    _temp: TempDir,
    repo_path: PathBuf,
}

impl GitRepoFixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().expect("tempdir should exist");
        let repo_path = temp.path().join("repo");
        fs::create_dir_all(&repo_path).expect("repo dir should exist");

        run_git(&repo_path, &["init", "--no-bare", "-b", "main"]);
        run_git(&repo_path, &["config", "user.name", "Routa Test"]);
        run_git(
            &repo_path,
            &["config", "user.email", "routa-test@example.com"],
        );
        write_file(&repo_path, "README.md", "# Codebase Fixture\n");
        write_file(&repo_path, "src/lib.rs", "pub fn parity_fixture() {}\n");
        run_git(&repo_path, &["add", "README.md", "src/lib.rs"]);
        run_git(&repo_path, &["commit", "-m", "chore: initial repo fixture"]);

        Self {
            _temp: temp,
            repo_path,
        }
    }

    fn new_bare() -> Self {
        let temp = tempfile::tempdir().expect("tempdir should exist");
        let repo_path = temp.path().join("repo.git");
        let output = Command::new("git")
            .args(["init", "--bare", repo_path.to_string_lossy().as_ref()])
            .output()
            .expect("git init --bare should run");
        if !output.status.success() {
            panic!(
                "git init --bare failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }

        Self {
            _temp: temp,
            repo_path,
        }
    }
}

fn run_git(repo_path: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false"])
        .args(args)
        .current_dir(repo_path)
        .output()
        .unwrap_or_else(|error| panic!("git {args:?} failed to start: {error}"));

    if !output.status.success() {
        panic!(
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }

    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn write_file(repo_path: &Path, relative_path: &str, content: &str) {
    let path = repo_path.join(relative_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("parent directory should exist");
    }
    fs::write(path, content).expect("file should be written");
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
        &format!("Workspace {workspace_id} not found"),
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
async fn api_task_patch_explicit_null_clears_worktree() {
    let fixture = ApiFixture::new().await;

    let create_task = fixture
        .client
        .post(fixture.endpoint("/api/tasks"))
        .json(&json!({
            "title": "Rust API worktree clear",
            "objective": "Ensure explicit null clears worktreeId",
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

    let assign_worktree = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/tasks/{task_id}")))
        .json(&json!({ "worktreeId": "worktree-stale" }))
        .send()
        .await
        .expect("assign worktree");
    assert_eq!(assign_worktree.status(), StatusCode::OK);

    let clear_worktree = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/tasks/{task_id}")))
        .json(&json!({ "worktreeId": null }))
        .send()
        .await
        .expect("clear worktree");
    assert_eq!(clear_worktree.status(), StatusCode::OK);
    let clear_json: Value = clear_worktree.json().await.expect("decode clear response");
    assert_eq!(clear_json["task"]["worktreeId"], Value::Null);

    let get_task = fixture
        .client
        .get(fixture.endpoint(&format!("/api/tasks/{task_id}")))
        .send()
        .await
        .expect("get task");
    assert_eq!(get_task.status(), StatusCode::OK);
    let get_json: Value = get_task.json().await.expect("decode task");
    assert_eq!(get_json["task"]["worktreeId"], Value::Null);
}

#[tokio::test]
async fn api_task_changes_contract() {
    let fixture = ApiFixture::new().await;

    let missing_response = fixture
        .client
        .get(fixture.endpoint("/api/tasks/missing-task/changes"))
        .send()
        .await
        .expect("get missing task changes");
    assert_eq!(missing_response.status(), StatusCode::NOT_FOUND);

    let standalone_task = fixture
        .client
        .post(fixture.endpoint("/api/tasks"))
        .json(&json!({
            "title": "No repo task",
            "objective": "Return an empty change payload when no repo is linked",
            "workspaceId": "default"
        }))
        .send()
        .await
        .expect("create standalone task");
    assert_eq!(standalone_task.status(), StatusCode::CREATED);
    let standalone_json: Value = standalone_task
        .json()
        .await
        .expect("decode standalone task");
    let standalone_task_id = standalone_json["task"]["id"]
        .as_str()
        .expect("standalone task id");

    let empty_changes = fixture
        .client
        .get(fixture.endpoint(&format!("/api/tasks/{standalone_task_id}/changes")))
        .send()
        .await
        .expect("get empty task changes");
    assert_eq!(empty_changes.status(), StatusCode::OK);
    let empty_changes_json: Value = empty_changes
        .json()
        .await
        .expect("decode empty task changes");
    assert_eq!(empty_changes_json["changes"]["files"], json!([]));
    assert_eq!(
        empty_changes_json["changes"]["error"],
        json!("No repository or worktree linked to this task")
    );

    let repo = GitRepoFixture::new();
    run_git(&repo.repo_path, &["checkout", "-b", "feature/task-changes"]);
    run_git(&repo.repo_path, &["branch", "--set-upstream-to=main"]);
    write_file(
        &repo.repo_path,
        "src/lib.rs",
        "pub fn parity_fixture() {}\npub fn task_changes_contract() {}\n",
    );
    run_git(&repo.repo_path, &["add", "src/lib.rs"]);
    run_git(
        &repo.repo_path,
        &["commit", "-m", "feat: add task changes coverage"],
    );

    let create_codebase = fixture
        .client
        .post(fixture.endpoint("/api/workspaces/default/codebases"))
        .json(&json!({
            "repoPath": repo.repo_path.to_string_lossy().to_string(),
            "branch": "main",
            "label": "Task changes repo"
        }))
        .send()
        .await
        .expect("create codebase for task changes");
    assert_eq!(create_codebase.status(), StatusCode::CREATED);
    let create_codebase_json: Value = create_codebase
        .json()
        .await
        .expect("decode codebase response");
    let codebase_id = create_codebase_json["codebase"]["id"]
        .as_str()
        .expect("codebase id");

    let create_task = fixture
        .client
        .post(fixture.endpoint("/api/tasks"))
        .json(&json!({
            "title": "Task changes contract",
            "objective": "Surface live commits and branch status from Rust",
            "workspaceId": "default",
            "codebaseIds": [codebase_id]
        }))
        .send()
        .await
        .expect("create task with codebase");
    assert_eq!(create_task.status(), StatusCode::CREATED);
    let create_task_json: Value = create_task
        .json()
        .await
        .expect("decode create task response");
    let task_id = create_task_json["task"]["id"].as_str().expect("task id");

    let changes_response = fixture
        .client
        .get(fixture.endpoint(&format!("/api/tasks/{task_id}/changes")))
        .send()
        .await
        .expect("get task changes");
    assert_eq!(changes_response.status(), StatusCode::OK);

    let changes_json: Value = changes_response
        .json()
        .await
        .expect("decode task changes response");
    assert_eq!(
        changes_json["changes"]["branch"],
        json!("feature/task-changes")
    );
    assert_eq!(changes_json["changes"]["status"]["clean"], json!(true));
    assert_eq!(changes_json["changes"]["status"]["ahead"], json!(1));
    assert_eq!(changes_json["changes"]["mode"], json!("commits"));
    assert_eq!(changes_json["changes"]["baseRef"], json!("main"));
    assert_eq!(changes_json["changes"]["targetBranch"], json!("main"));
    assert_eq!(
        changes_json["changes"]["commits"][0]["summary"],
        json!("feat: add task changes coverage")
    );
    assert_eq!(
        changes_json["changes"]["commits"][0]["shortSha"]
            .as_str()
            .map(str::len),
        Some(7)
    );
}

#[tokio::test]
async fn api_codebase_and_file_search_flow() {
    let fixture = ApiFixture::new().await;
    let repo = GitRepoFixture::new();
    let second_repo = GitRepoFixture::new();
    let bare_repo = GitRepoFixture::new_bare();

    let bare_response = fixture
        .client
        .post(fixture.endpoint("/api/workspaces/default/codebases"))
        .json(&json!({
            "repoPath": bare_repo.repo_path.to_string_lossy().to_string(),
            "label": "Bare repo"
        }))
        .send()
        .await
        .expect("create bare repo codebase");
    assert_eq!(bare_response.status(), StatusCode::BAD_REQUEST);
    let bare_json: Value = bare_response
        .json()
        .await
        .expect("decode bare repo response");
    assert!(json_has_error(
        &bare_json,
        "Cannot add a bare git repository as a codebase",
    ));

    let create_response = fixture
        .client
        .post(fixture.endpoint("/api/workspaces/default/codebases"))
        .json(&json!({
            "repoPath": repo.repo_path.to_string_lossy().to_string(),
            "branch": "main",
            "label": "Parity repo"
        }))
        .send()
        .await
        .expect("create codebase");
    assert_eq!(create_response.status(), StatusCode::CREATED);
    let create_json: Value = create_response
        .json()
        .await
        .expect("decode codebase create response");
    let codebase_id = create_json["codebase"]["id"]
        .as_str()
        .expect("codebase id")
        .to_string();
    assert_eq!(create_json["codebase"]["label"], json!("Parity repo"));
    assert_eq!(create_json["codebase"]["isDefault"], json!(true));

    let duplicate_response = fixture
        .client
        .post(fixture.endpoint("/api/workspaces/default/codebases"))
        .json(&json!({
            "repoPath": repo.repo_path.to_string_lossy().to_string(),
            "label": "Duplicate repo"
        }))
        .send()
        .await
        .expect("create duplicate codebase");
    assert_eq!(duplicate_response.status(), StatusCode::CONFLICT);
    let duplicate_json: Value = duplicate_response
        .json()
        .await
        .expect("decode duplicate codebase response");
    assert_eq!(
        duplicate_json["error"],
        json!("Codebase with this repoPath already exists in the workspace")
    );

    let patch_response = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/codebases/{codebase_id}")))
        .json(&json!({
            "label": "Parity repo updated",
            "branch": "main"
        }))
        .send()
        .await
        .expect("patch codebase");
    assert_eq!(patch_response.status(), StatusCode::OK);
    let patch_json: Value = patch_response.json().await.expect("decode patch response");
    assert_eq!(
        patch_json["codebase"]["label"],
        json!("Parity repo updated")
    );

    let default_response = fixture
        .client
        .post(fixture.endpoint(&format!("/api/codebases/{codebase_id}/default")))
        .send()
        .await
        .expect("set codebase default");
    assert_eq!(default_response.status(), StatusCode::OK);
    let default_json: Value = default_response
        .json()
        .await
        .expect("decode set default response");
    assert_eq!(default_json["codebase"]["id"], json!(codebase_id));
    assert_eq!(default_json["codebase"]["isDefault"], json!(true));

    let files_missing_repo_path = fixture
        .client
        .get(fixture.endpoint("/api/files/search?q=README"))
        .send()
        .await
        .expect("file search without repoPath");
    assert_eq!(files_missing_repo_path.status(), StatusCode::BAD_REQUEST);
    let files_missing_repo_path_json: Value = files_missing_repo_path
        .json()
        .await
        .expect("decode file search missing repoPath response");
    assert!(json_has_error(
        &files_missing_repo_path_json,
        "Missing repoPath parameter",
    ));

    let file_search_response = fixture
        .client
        .get(fixture.endpoint("/api/files/search"))
        .query(&[
            ("q", "readme"),
            ("repoPath", repo.repo_path.to_string_lossy().as_ref()),
            ("limit", "5"),
        ])
        .send()
        .await
        .expect("search files");
    assert_eq!(file_search_response.status(), StatusCode::OK);
    let file_search_json: Value = file_search_response
        .json()
        .await
        .expect("decode file search response");
    let files = file_search_json["files"].as_array().expect("files array");
    assert!(files.iter().any(|file| file["path"] == json!("README.md")));
    assert!(file_search_json["scanned"].as_u64().unwrap_or_default() >= 2);

    let second_create_response = fixture
        .client
        .post(fixture.endpoint("/api/workspaces/default/codebases"))
        .json(&json!({
            "repoPath": second_repo.repo_path.to_string_lossy().to_string(),
            "label": "Second repo"
        }))
        .send()
        .await
        .expect("create second codebase");
    assert_eq!(second_create_response.status(), StatusCode::CREATED);
    let second_create_json: Value = second_create_response
        .json()
        .await
        .expect("decode second codebase response");
    let second_codebase_id = second_create_json["codebase"]["id"]
        .as_str()
        .expect("second codebase id");

    let delete_global_response = fixture
        .client
        .delete(fixture.endpoint(&format!("/api/codebases/{second_codebase_id}")))
        .send()
        .await
        .expect("delete codebase globally");
    assert_eq!(delete_global_response.status(), StatusCode::OK);
    let delete_global_json: Value = delete_global_response
        .json()
        .await
        .expect("decode global delete response");
    assert_eq!(delete_global_json, json!({ "deleted": true }));

    let delete_wrong_workspace = fixture
        .client
        .delete(fixture.endpoint(&format!(
            "/api/workspaces/other-workspace/codebases/{codebase_id}"
        )))
        .send()
        .await
        .expect("delete codebase with wrong workspace");
    assert_eq!(delete_wrong_workspace.status(), StatusCode::NOT_FOUND);
    let delete_wrong_workspace_json: Value = delete_wrong_workspace
        .json()
        .await
        .expect("decode wrong-workspace delete response");
    assert_eq!(
        delete_wrong_workspace_json,
        json!({ "error": "Codebase not found" })
    );

    let delete_workspace_response = fixture
        .client
        .delete(fixture.endpoint(&format!("/api/workspaces/default/codebases/{codebase_id}")))
        .send()
        .await
        .expect("delete codebase by workspace-scoped route");
    assert_eq!(delete_workspace_response.status(), StatusCode::OK);
    let delete_workspace_json: Value = delete_workspace_response
        .json()
        .await
        .expect("decode workspace-scoped delete response");
    assert_eq!(delete_workspace_json, json!({ "deleted": true }));
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

    let has_provide_artifact = tools
        .iter()
        .filter_map(|tool| tool.get("name").and_then(Value::as_str))
        .any(|name| name == "provide_artifact");
    assert!(
        has_provide_artifact,
        "provide_artifact should be discoverable"
    );

    let has_list_artifacts = tools
        .iter()
        .filter_map(|tool| tool.get("name").and_then(Value::as_str))
        .any(|name| name == "list_artifacts");
    assert!(has_list_artifacts, "list_artifacts should be discoverable");
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
            "unexpected delegate error: {error}"
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
            "unexpected delegate error: {error}"
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

#[tokio::test]
async fn api_mcp_tools_provide_and_list_artifacts() {
    let fixture = ApiFixture::new().await;

    let create_task = fixture
        .client
        .post(fixture.endpoint("/api/tasks"))
        .json(&json!({
            "title": "Artifact via MCP tools",
            "objective": "Validate Rust MCP artifact tool parity",
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

    let provide_response = fixture
        .client
        .post(fixture.endpoint("/api/mcp/tools"))
        .json(&json!({
            "name": "provide_artifact",
            "args": {
                "workspaceId": "default",
                "agentId": "agent-artifact-e2e",
                "taskId": task_id,
                "type": "screenshot",
                "content": "base64-image",
                "context": "Review proof",
                "metadata": {
                    "filename": "review-proof.png",
                    "mediaType": "image/png"
                }
            }
        }))
        .send()
        .await
        .expect("call provide_artifact");
    assert_eq!(provide_response.status(), StatusCode::OK);
    let provide_json: Value = provide_response
        .json()
        .await
        .expect("decode provide_artifact response");
    assert_eq!(provide_json["isError"], json!(false));
    let provide_text = provide_json["content"][0]["text"]
        .as_str()
        .expect("provide_artifact text payload");
    let provide_result: Value =
        serde_json::from_str(provide_text).expect("decode provide_artifact payload");
    assert_eq!(provide_result["type"], json!("screenshot"));
    assert_eq!(provide_result["taskId"], json!(task_id));
    assert_eq!(provide_result["status"], json!("provided"));
    assert!(provide_result["artifactId"].as_str().is_some());

    let list_response = fixture
        .client
        .post(fixture.endpoint("/api/mcp/tools"))
        .json(&json!({
            "name": "list_artifacts",
            "args": {
                "workspaceId": "default",
                "taskId": task_id
            }
        }))
        .send()
        .await
        .expect("call list_artifacts");
    assert_eq!(list_response.status(), StatusCode::OK);
    let list_json: Value = list_response
        .json()
        .await
        .expect("decode list_artifacts response");
    assert_eq!(list_json["isError"], json!(false));
    let list_text = list_json["content"][0]["text"]
        .as_str()
        .expect("list_artifacts text payload");
    let list_result: Value =
        serde_json::from_str(list_text).expect("decode list_artifacts payload");
    let artifacts = list_result["artifacts"]
        .as_array()
        .expect("artifacts array");
    assert_eq!(artifacts.len(), 1);
    assert_eq!(artifacts[0]["type"], json!("screenshot"));
    assert_eq!(artifacts[0]["taskId"], json!(task_id));
    assert_eq!(
        artifacts[0]["providedByAgentId"],
        json!("agent-artifact-e2e")
    );
    assert_eq!(artifacts[0]["status"], json!("provided"));
}

#[tokio::test]
async fn api_spec_issues_contract() {
    let fixture = ApiFixture::new().await;
    let repo_root = tempfile::tempdir().expect("temp repo");
    let issues_dir = repo_root.path().join("docs").join("issues");

    std::fs::create_dir_all(&issues_dir).expect("issues dir");
    std::fs::write(
        issues_dir.join("2026-04-11-spec-board.md"),
        r#"---
title: "Spec board"
date: 2026-04-11
kind: progress_note
status: closed
severity: high
area: ui
tags: ["spec", "board"]
reported_by: codex
related_issues: ["https://github.com/phodal/routa/issues/410"]
github_issue: "410"
github_state: closed
github_url: "https://github.com/phodal/routa/issues/410"
---

# Spec board

Rendered as markdown.
"#,
    )
    .expect("write issue file");
    std::fs::write(
        issues_dir.join("2026-04-10-malformed.md"),
        "not frontmatter",
    )
    .expect("write malformed file");

    let success_response = fixture
        .client
        .get(fixture.endpoint("/api/spec/issues"))
        .query(&[("repoPath", repo_root.path().to_string_lossy().to_string())])
        .send()
        .await
        .expect("list spec issues");
    assert_eq!(success_response.status(), StatusCode::OK);

    let success_json: Value = success_response
        .json()
        .await
        .expect("decode spec issues response");
    assert_eq!(
        success_json["repoRoot"],
        json!(repo_root.path().to_string_lossy().to_string())
    );
    let issues = success_json["issues"].as_array().expect("issues array");
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0]["title"], json!("Spec board"));
    assert_eq!(issues[0]["date"], json!("2026-04-11"));
    assert_eq!(issues[0]["status"], json!("resolved"));
    assert_eq!(issues[0]["kind"], json!("progress_note"));
    assert_eq!(issues[0]["githubIssue"], json!(410));

    let missing_repo = repo_root.path().join("missing");
    let error_response = fixture
        .client
        .get(fixture.endpoint("/api/spec/issues"))
        .query(&[("repoPath", missing_repo.to_string_lossy().to_string())])
        .send()
        .await
        .expect("list spec issues with invalid repo");
    assert_eq!(error_response.status(), StatusCode::BAD_REQUEST);

    let error_json: Value = error_response
        .json()
        .await
        .expect("decode invalid repo response");
    assert!(
        json_has_error(&error_json, "repoPath"),
        "expected invalid repoPath error, got {error_json:?}"
    );
}

#[tokio::test]
async fn api_spec_surface_index_contract() {
    let fixture = ApiFixture::new().await;
    let repo_root = tempfile::tempdir().expect("temp repo");
    let specs_dir = repo_root.path().join("docs").join("product-specs");

    std::fs::create_dir_all(&specs_dir).expect("product specs dir");
    std::fs::write(
        specs_dir.join("feature-tree.index.json"),
        r#"{
  "generatedAt": "2026-04-16T12:00:00.000Z",
  "pages": [
    {
      "route": "/workspace/:workspaceId/spec",
      "title": "Workspace / Spec",
      "description": "Dense issue relationship board",
      "sourceFile": "src/app/workspace/[workspaceId]/spec/page.tsx"
    }
  ],
  "apis": [
    {
      "domain": "spec",
      "method": "GET",
      "path": "/api/spec/issues",
      "operationId": "listSpecIssues",
      "summary": "List local issue specs"
    }
  ],
  "contractApis": [
    {
      "domain": "spec",
      "method": "GET",
      "path": "/api/spec/issues",
      "summary": "List local issue specs"
    }
  ],
  "rustApis": [
    {
      "domain": "spec",
      "method": "GET",
      "path": "/api/spec/issues",
      "sourceFiles": ["crates/routa-server/src/api/spec.rs"]
    }
  ],
  "metadata": {
    "capabilityGroups": [
      {
        "id": "governance-settings",
        "name": "Governance and Settings"
      }
    ]
  }
}"#,
    )
    .expect("write surface index");

    let success_response = fixture
        .client
        .get(fixture.endpoint("/api/spec/surface-index"))
        .query(&[("repoPath", repo_root.path().to_string_lossy().to_string())])
        .send()
        .await
        .expect("get spec surface index");
    assert_eq!(success_response.status(), StatusCode::OK);

    let success_json: Value = success_response
        .json()
        .await
        .expect("decode spec surface index");
    assert_eq!(success_json["warnings"], json!([]));
    assert_eq!(
        success_json["pages"][0]["route"],
        json!("/workspace/:workspaceId/spec")
    );
    assert_eq!(success_json["apis"][0]["domain"], json!("spec"));
    assert_eq!(
        success_json["contractApis"][0]["path"],
        json!("/api/spec/issues")
    );
    assert_eq!(
        success_json["rustApis"][0]["sourceFiles"][0],
        json!("crates/routa-server/src/api/spec.rs")
    );
    assert_eq!(
        success_json["metadata"]["capabilityGroups"][0]["id"],
        json!("governance-settings")
    );

    std::fs::remove_file(specs_dir.join("feature-tree.index.json")).expect("remove surface index");
    std::fs::write(
        repo_root.path().join("api-contract.yaml"),
        r#"openapi: 3.1.0
paths:
  /api/spec/issues:
    get:
      summary: List local issue specs
"#,
    )
    .expect("write api contract");

    let missing_response = fixture
        .client
        .get(fixture.endpoint("/api/spec/surface-index"))
        .query(&[("repoPath", repo_root.path().to_string_lossy().to_string())])
        .send()
        .await
        .expect("get missing spec surface index");
    assert_eq!(missing_response.status(), StatusCode::OK);

    let missing_json: Value = missing_response
        .json()
        .await
        .expect("decode missing spec surface index");
    assert_eq!(missing_json["pages"], json!([]));
    assert_eq!(missing_json["apis"][0]["path"], json!("/api/spec/issues"));
    assert_eq!(
        missing_json["contractApis"][0]["summary"],
        json!("List local issue specs")
    );
    assert!(
        missing_json["warnings"][0]
            .as_str()
            .is_some_and(|warning| warning.contains("Feature surface index not found")),
        "expected missing surface index warning, got {missing_json:?}"
    );
}

#[tokio::test]
async fn api_feature_explorer_contract_for_workspace_repo() {
    let fixture = ApiFixture::new().await;
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .expect("workspace root")
        .to_path_buf();

    let response = fixture
        .client
        .get(fixture.endpoint("/api/feature-explorer"))
        .query(&[("repoPath", repo_root.to_string_lossy().to_string())])
        .send()
        .await
        .expect("get feature explorer payload");

    assert_eq!(response.status(), StatusCode::OK);

    let payload: Value = response
        .json()
        .await
        .expect("decode feature explorer payload");

    assert!(payload["features"].as_array().is_some());
    assert!(payload["capabilityGroups"].as_array().is_some());
}

#[tokio::test]
async fn api_feature_explorer_detail_includes_file_signals_for_workspace_repo() {
    let fixture = ApiFixture::new().await;
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .expect("workspace root")
        .to_path_buf();

    let response = fixture
        .client
        .get(fixture.endpoint("/api/feature-explorer/workspace-overview"))
        .query(&[("repoPath", repo_root.to_string_lossy().to_string())])
        .send()
        .await
        .expect("get feature explorer detail payload");

    assert_eq!(response.status(), StatusCode::OK);

    let payload: Value = response
        .json()
        .await
        .expect("decode feature explorer detail payload");

    let file_signals = payload["fileSignals"]
        .as_object()
        .expect("fileSignals object should exist");
    assert!(
        !file_signals.is_empty(),
        "expected non-empty fileSignals for workspace-overview detail, got {payload:?}"
    );
    assert!(
        file_signals.values().any(|signal| signal["sessions"]
            .as_array()
            .is_some_and(|sessions| !sessions.is_empty())),
        "expected fileSignals sessions to be populated, got {payload:?}"
    );
}

#[tokio::test]
async fn api_spec_surface_index_falls_back_from_invalid_repo_path_to_workspace_codebase() {
    let fixture = ApiFixture::new().await;
    let repo = GitRepoFixture::new();

    let create_codebase = fixture
        .client
        .post(fixture.endpoint("/api/workspaces/default/codebases"))
        .json(&json!({
            "repoPath": repo.repo_path.to_string_lossy().to_string(),
            "branch": "main",
            "label": "fixture",
            "isDefault": true
        }))
        .send()
        .await
        .expect("create codebase for default workspace");
    assert_eq!(create_codebase.status(), StatusCode::CREATED);

    let response = fixture
        .client
        .get(fixture.endpoint("/api/spec/surface-index"))
        .query(&[
            ("workspaceId", "default".to_string()),
            (
                "repoPath",
                repo.repo_path.join("missing").to_string_lossy().to_string(),
            ),
        ])
        .send()
        .await
        .expect("get spec surface index with invalid explicit repo path");

    assert_eq!(response.status(), StatusCode::OK);

    let payload: Value = response
        .json()
        .await
        .expect("decode fallback surface index response");

    assert_eq!(
        payload["repoRoot"],
        json!(repo.repo_path.to_string_lossy().to_string())
    );
    assert!(payload["warnings"].as_array().is_some());
}

#[tokio::test]
async fn api_spec_feature_tree_generate_contract() {
    let fixture = ApiFixture::new().await;
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .expect("workspace root")
        .to_path_buf();

    let response = fixture
        .client
        .post(fixture.endpoint("/api/spec/feature-tree/generate"))
        .json(&json!({
            "repoPath": repo_root.to_string_lossy().to_string(),
            "dryRun": true
        }))
        .send()
        .await
        .expect("generate feature tree");

    assert_eq!(response.status(), StatusCode::OK);

    let payload: Value = response
        .json()
        .await
        .expect("decode feature tree generate response");

    assert!(payload["generatedAt"].as_str().is_some());
    let frameworks = payload["frameworksDetected"]
        .as_array()
        .expect("frameworksDetected should be an array");
    assert!(
        frameworks.iter().any(|f| f.as_str() == Some("nextjs")),
        "frameworksDetected should include nextjs, got: {frameworks:?}"
    );
    assert_eq!(
        payload["wroteFiles"],
        json!([
            "docs/product-specs/FEATURE_TREE.md",
            "docs/product-specs/feature-tree.index.json"
        ])
    );
    assert!(payload["warnings"].as_array().is_some());
    assert!(payload["pagesCount"]
        .as_u64()
        .is_some_and(|count| count > 0));
    assert!(payload["apisCount"].as_u64().is_some_and(|count| count > 0));
}

#[tokio::test]
async fn api_spec_feature_tree_preflight_contract() {
    let fixture = ApiFixture::new().await;
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .expect("workspace root")
        .to_path_buf();

    let response = fixture
        .client
        .get(fixture.endpoint("/api/spec/feature-tree/preflight"))
        .query(&[("repoPath", repo_root.to_string_lossy().to_string())])
        .send()
        .await
        .expect("preflight feature tree");

    assert_eq!(response.status(), StatusCode::OK);

    let payload: Value = response
        .json()
        .await
        .expect("decode feature tree preflight response");

    assert_eq!(
        payload["repoRoot"],
        json!(repo_root.to_string_lossy().to_string())
    );
    assert_eq!(
        payload["selectedScanRoot"],
        json!(repo_root.to_string_lossy().to_string())
    );
    let frameworks = payload["frameworksDetected"]
        .as_array()
        .expect("frameworksDetected should be an array");
    assert!(
        frameworks.iter().any(|f| f.as_str() == Some("nextjs")),
        "frameworksDetected should include nextjs, got: {frameworks:?}"
    );
    assert!(payload["candidateRoots"].as_array().is_some());
    assert!(payload["warnings"].as_array().is_some());
}

#[tokio::test]
async fn api_spec_feature_tree_commit_contract() {
    let fixture = ApiFixture::new().await;
    let repo_root = tempfile::tempdir().expect("temp repo");

    write_file(
        repo_root.path(),
        "package.json",
        r#"{"name":"feature-tree-commit-fixture"}"#,
    );
    write_file(
        repo_root.path(),
        "pages/index.tsx",
        "export default function Home() { return null; }\n",
    );

    let response = fixture
        .client
        .post(fixture.endpoint("/api/spec/feature-tree/commit"))
        .json(&json!({
            "repoPath": repo_root.path().to_string_lossy().to_string(),
            "metadata": {
                "schemaVersion": 1,
                "capabilityGroups": [],
                "features": [
                    {
                        "id": "home",
                        "name": "Home",
                        "description": "Generated in rust contract test",
                        "route": "/"
                    }
                ]
            }
        }))
        .send()
        .await
        .expect("commit feature tree");

    assert_eq!(response.status(), StatusCode::OK);

    let payload: Value = response
        .json()
        .await
        .expect("decode feature tree commit response");

    assert!(payload["generatedAt"].as_str().is_some());
    assert_eq!(payload["pagesCount"], json!(1));
    assert!(payload["warnings"].as_array().is_some());

    let feature_tree_index_path = repo_root
        .path()
        .join("docs")
        .join("product-specs")
        .join("feature-tree.index.json");
    let feature_tree_markdown_path = repo_root
        .path()
        .join("docs")
        .join("product-specs")
        .join("FEATURE_TREE.md");
    assert!(feature_tree_index_path.exists());
    assert!(feature_tree_markdown_path.exists());

    let saved_index: Value = serde_json::from_str(
        &fs::read_to_string(&feature_tree_index_path).expect("read committed feature tree index"),
    )
    .expect("decode committed feature tree index");
    assert_eq!(saved_index["pages"][0]["route"], json!("/"));
    assert_eq!(
        saved_index["metadata"]["features"]
            .as_array()
            .map(|items| items.len()),
        Some(1)
    );
}
