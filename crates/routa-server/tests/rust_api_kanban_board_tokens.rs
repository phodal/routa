use reqwest::StatusCode;
use routa_core::{store::KanbanStore, Database};
use serde_json::{json, Value};

#[path = "common/mod.rs"]
mod common;
use common::ApiFixture;

fn load_kanban_store(db_path: &std::path::Path) -> KanbanStore {
    let db = Database::open(
        db_path
            .to_str()
            .expect("fixture database path should be valid utf-8"),
    )
    .expect("fixture database should open");
    KanbanStore::new(db)
}

#[tokio::test]
async fn kanban_board_github_token_persists_but_never_leaks_from_api() {
    let fixture = ApiFixture::new().await;

    let boards_response = fixture
        .client
        .get(fixture.endpoint("/api/kanban/boards?workspaceId=default"))
        .send()
        .await
        .expect("list boards request should succeed");
    assert_eq!(boards_response.status(), StatusCode::OK);
    let boards_json: Value = boards_response.json().await.expect("decode boards");
    let board_id = boards_json["boards"][0]["id"]
        .as_str()
        .expect("default board id should exist");

    let patch_response = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/kanban/boards/{board_id}")))
        .json(&json!({ "githubToken": " github_pat_test " }))
        .send()
        .await
        .expect("patch board request should succeed");
    assert_eq!(patch_response.status(), StatusCode::OK);
    let patch_json: Value = patch_response.json().await.expect("decode patch response");
    assert_eq!(patch_json["board"].get("githubToken"), None);
    assert_eq!(patch_json["board"]["githubTokenConfigured"], json!(true));

    let store = load_kanban_store(&fixture.db_path);
    let stored_board = store
        .get(board_id)
        .await
        .expect("stored board lookup should succeed")
        .expect("stored board should exist");
    assert_eq!(
        stored_board.github_token.as_deref(),
        Some("github_pat_test")
    );

    let board_response = fixture
        .client
        .get(fixture.endpoint(&format!("/api/kanban/boards/{board_id}")))
        .send()
        .await
        .expect("get board request should succeed");
    assert_eq!(board_response.status(), StatusCode::OK);
    let board_json: Value = board_response.json().await.expect("decode board response");
    assert_eq!(board_json["board"].get("githubToken"), None);
    assert_eq!(board_json["board"]["githubTokenConfigured"], json!(true));

    let boards_response = fixture
        .client
        .get(fixture.endpoint("/api/kanban/boards?workspaceId=default"))
        .send()
        .await
        .expect("list boards after patch request should succeed");
    assert_eq!(boards_response.status(), StatusCode::OK);
    let boards_json: Value = boards_response
        .json()
        .await
        .expect("decode boards after patch");
    let listed_board = boards_json["boards"]
        .as_array()
        .expect("boards should be an array")
        .iter()
        .find(|board| board["id"].as_str() == Some(board_id))
        .expect("patched board should be listed");
    assert_eq!(listed_board.get("githubToken"), None);
    assert_eq!(listed_board["githubTokenConfigured"], json!(true));

    let clear_response = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/kanban/boards/{board_id}")))
        .json(&json!({ "clearGitHubToken": true }))
        .send()
        .await
        .expect("clear token request should succeed");
    assert_eq!(clear_response.status(), StatusCode::OK);
    let clear_json: Value = clear_response.json().await.expect("decode clear response");
    assert_eq!(clear_json["board"].get("githubToken"), None);
    assert_eq!(clear_json["board"]["githubTokenConfigured"], json!(false));

    let stored_board = store
        .get(board_id)
        .await
        .expect("stored board lookup after clear should succeed")
        .expect("stored board should still exist");
    assert_eq!(stored_board.github_token, None);
}

#[tokio::test]
async fn github_access_uses_board_token_when_board_has_saved_credentials() {
    let fixture = ApiFixture::new().await;

    let boards_response = fixture
        .client
        .get(fixture.endpoint("/api/kanban/boards?workspaceId=default"))
        .send()
        .await
        .expect("list boards request should succeed");
    assert_eq!(boards_response.status(), StatusCode::OK);
    let boards_json: Value = boards_response.json().await.expect("decode boards");
    let board_id = boards_json["boards"][0]["id"]
        .as_str()
        .expect("default board id should exist");

    let patch_response = fixture
        .client
        .patch(fixture.endpoint(&format!("/api/kanban/boards/{board_id}")))
        .json(&json!({ "githubToken": "github_pat_test" }))
        .send()
        .await
        .expect("patch board request should succeed");
    assert_eq!(patch_response.status(), StatusCode::OK);

    let access_response = fixture
        .client
        .get(fixture.endpoint(&format!("/api/github/access?boardId={board_id}")))
        .send()
        .await
        .expect("github access request should succeed");
    assert_eq!(access_response.status(), StatusCode::OK);

    let access_json: Value = access_response
        .json()
        .await
        .expect("decode access response");
    assert_eq!(access_json["available"], json!(true));
    assert_eq!(access_json["source"], json!("board"));
}
