use std::fs;

use reqwest::StatusCode;
use routa_core::storage::get_project_storage_dir;
use serde_json::{json, Value};

#[path = "common/mod.rs"]
mod common;
use common::ApiFixture;

fn json_has_error(resp: &Value, expected: &str) -> bool {
    resp.get("error")
        .and_then(Value::as_str)
        .is_some_and(|message| message.contains(expected))
}

fn cleanup_canvas_file(path: &str) {
    let _ = fs::remove_file(path);
    if let Some(parent) = std::path::Path::new(path).parent() {
        let _ = fs::remove_dir(parent);
    }
}

#[tokio::test]
async fn api_canvas_roundtrip_creates_backing_task_and_renders_payload() {
    let fixture = ApiFixture::new().await;

    let create_canvas = fixture
        .client
        .post(fixture.endpoint("/api/canvas"))
        .json(&json!({
            "title": "Rust Canvas",
            "workspaceId": "default",
            "source": "export default function(){return null;}"
        }))
        .send()
        .await
        .expect("create canvas");
    assert_eq!(create_canvas.status(), StatusCode::CREATED);
    let created: Value = create_canvas.json().await.expect("decode created canvas");

    let canvas_id = created["id"].as_str().expect("canvas id");
    let task_id = created["taskId"].as_str().expect("task id");
    assert_eq!(created["renderMode"], json!("dynamic"));
    assert_eq!(created["title"], json!("Rust Canvas"));

    let get_canvas = fixture
        .client
        .get(fixture.endpoint(&format!("/api/canvas/{canvas_id}")))
        .send()
        .await
        .expect("get canvas");
    assert_eq!(get_canvas.status(), StatusCode::OK);
    let canvas_json: Value = get_canvas.json().await.expect("decode canvas");
    assert_eq!(canvas_json["title"], json!("Rust Canvas"));
    assert_eq!(
        canvas_json["source"],
        json!("export default function(){return null;}")
    );
    assert_eq!(canvas_json["workspaceId"], json!("default"));

    let list_canvas = fixture
        .client
        .get(fixture.endpoint("/api/canvas?workspaceId=default"))
        .send()
        .await
        .expect("list canvas");
    assert_eq!(list_canvas.status(), StatusCode::OK);
    let list_json: Value = list_canvas.json().await.expect("decode canvas list");
    let items = list_json["canvasArtifacts"]
        .as_array()
        .expect("canvas artifact array");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], json!(canvas_id));

    let get_task = fixture
        .client
        .get(fixture.endpoint(&format!("/api/tasks/{task_id}")))
        .send()
        .await
        .expect("get backing task");
    assert_eq!(get_task.status(), StatusCode::OK);
    let task_json: Value = get_task.json().await.expect("decode task");
    assert_eq!(
        task_json["task"]["title"],
        json!("Canvas artifact: Rust Canvas")
    );
    assert_eq!(task_json["task"]["status"], json!("COMPLETED"));
    assert_eq!(task_json["task"]["labels"], json!(["canvas"]));
}

#[tokio::test]
async fn api_canvas_rejects_unknown_task_id() {
    let fixture = ApiFixture::new().await;

    let response = fixture
        .client
        .post(fixture.endpoint("/api/canvas"))
        .json(&json!({
            "title": "Bad task",
            "workspaceId": "default",
            "taskId": "missing-task",
            "source": "export default function(){return null;}"
        }))
        .send()
        .await
        .expect("create canvas with missing task");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: Value = response.json().await.expect("decode error");
    assert!(json_has_error(&body, "Task not found: missing-task"));
}

#[tokio::test]
async fn api_canvas_specialist_validates_required_fields() {
    let fixture = ApiFixture::new().await;

    let response = fixture
        .client
        .post(fixture.endpoint("/api/canvas/specialist"))
        .json(&json!({
            "workspaceId": "default",
            "prompt": "Create a canvas."
        }))
        .send()
        .await
        .expect("create canvas from specialist without specialist id");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: Value = response.json().await.expect("decode error");
    assert!(json_has_error(&body, "specialistId is required"));
}

#[tokio::test]
async fn api_canvas_specialist_rejects_unknown_specialist() {
    let fixture = ApiFixture::new().await;

    let response = fixture
        .client
        .post(fixture.endpoint("/api/canvas/specialist"))
        .json(&json!({
            "workspaceId": "default",
            "specialistId": "missing-specialist",
            "prompt": "Create a canvas."
        }))
        .send()
        .await
        .expect("create canvas from unknown specialist");
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let body: Value = response.json().await.expect("decode error");
    assert!(json_has_error(
        &body,
        "Specialist not found: missing-specialist"
    ));
}

#[tokio::test]
async fn api_canvas_specialist_materialize_persists_canvas_source() {
    let fixture = ApiFixture::new().await;
    let repo_root = tempfile::tempdir().expect("temp repo");
    let repo_path = repo_root.path().join("demo-repo");
    fs::create_dir_all(&repo_path).expect("create demo repo");

    let response = fixture
        .client
        .post(fixture.endpoint("/api/canvas/specialist/materialize"))
        .json(&json!({
            "workspaceId": "default",
            "repoPath": repo_path,
            "repoLabel": "demo-repo",
            "source": "export default function Canvas(){ return <div>Saved</div>; }"
        }))
        .send()
        .await
        .expect("materialize canvas source");
    assert_eq!(response.status(), StatusCode::CREATED);

    let body: Value = response.json().await.expect("decode materialize response");
    let expected_path = get_project_storage_dir(repo_path.to_string_lossy().as_ref())
        .join("canvases")
        .join("demo-repo-fitness-overview.canvas.tsx");

    assert_eq!(body["workspaceId"], json!("default"));
    assert_eq!(
        body["fileName"],
        json!("demo-repo-fitness-overview.canvas.tsx")
    );
    assert_eq!(
        body["filePath"],
        json!(expected_path.to_string_lossy().to_string())
    );
    assert_eq!(
        fs::read_to_string(expected_path.as_path()).expect("read persisted canvas"),
        "export default function Canvas(){ return <div>Saved</div>; }\n"
    );

    cleanup_canvas_file(expected_path.to_string_lossy().as_ref());
}

#[tokio::test]
async fn api_canvas_specialist_materialize_maps_managed_clone_to_project_root() {
    let fixture = ApiFixture::new().await;
    let repo_root = tempfile::tempdir().expect("temp repo");
    let clone_repo_path = repo_root
        .path()
        .join(".routa")
        .join("repos")
        .join("phodal--routa");

    let response = fixture
        .client
        .post(fixture.endpoint("/api/canvas/specialist/materialize"))
        .json(&json!({
            "workspaceId": "default",
            "repoPath": clone_repo_path,
            "repoLabel": "phodal/routa",
            "source": "export default function Canvas(){ return <div>Clone</div>; }"
        }))
        .send()
        .await
        .expect("materialize managed clone canvas");
    assert_eq!(response.status(), StatusCode::CREATED);

    let body: Value = response
        .json()
        .await
        .expect("decode managed clone materialize response");
    let expected_path = get_project_storage_dir(repo_root.path().to_string_lossy().as_ref())
        .join("canvases")
        .join("phodal-routa-fitness-overview.canvas.tsx");

    assert_eq!(
        body["filePath"],
        json!(expected_path.to_string_lossy().to_string())
    );
    assert_eq!(
        fs::read_to_string(expected_path.as_path()).expect("read managed clone canvas"),
        "export default function Canvas(){ return <div>Clone</div>; }\n"
    );

    cleanup_canvas_file(expected_path.to_string_lossy().as_ref());
}

#[tokio::test]
async fn api_canvas_delete_removes_artifact() {
    let fixture = ApiFixture::new().await;

    let create_canvas = fixture
        .client
        .post(fixture.endpoint("/api/canvas"))
        .json(&json!({
            "title": "Delete me",
            "workspaceId": "default",
            "source": "export default function(){return null;}"
        }))
        .send()
        .await
        .expect("create canvas");
    assert_eq!(create_canvas.status(), StatusCode::CREATED);
    let created: Value = create_canvas.json().await.expect("decode canvas");
    let canvas_id = created["id"].as_str().expect("canvas id");

    let delete_canvas = fixture
        .client
        .delete(fixture.endpoint(&format!("/api/canvas/{canvas_id}")))
        .send()
        .await
        .expect("delete canvas");
    assert_eq!(delete_canvas.status(), StatusCode::OK);
    let deleted: Value = delete_canvas.json().await.expect("decode delete");
    assert_eq!(deleted["deleted"], json!(true));

    let get_deleted = fixture
        .client
        .get(fixture.endpoint(&format!("/api/canvas/{canvas_id}")))
        .send()
        .await
        .expect("get deleted canvas");
    assert_eq!(get_deleted.status(), StatusCode::NOT_FOUND);
}
