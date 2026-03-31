//! Local repository API - /api/clone/local
//!
//! POST /api/clone/local - Validate and load an existing local git repository

use axum::{routing::post, Json, Router};
use serde::Deserialize;

use crate::api::repo_context::{normalize_local_repo_path, validate_local_git_repo_path};
use crate::error::ServerError;
use crate::git;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/", post(load_local_repo))
}

#[derive(Debug, Deserialize)]
struct LocalRepoRequest {
    path: Option<String>,
}

async fn load_local_repo(
    Json(body): Json<LocalRepoRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let raw_path = body
        .path
        .ok_or_else(|| ServerError::BadRequest("Missing 'path' field".into()))?;

    let repo_path = normalize_local_repo_path(&raw_path);
    validate_local_git_repo_path(&repo_path)?;

    let repo_path_string = repo_path.to_string_lossy().to_string();
    let (branch_info, status) = tokio::task::spawn_blocking({
        let repo_path_string = repo_path_string.clone();
        move || {
            (
                git::get_branch_info(&repo_path_string),
                git::get_repo_status(&repo_path_string),
            )
        }
    })
    .await
    .map_err(|error| ServerError::Internal(error.to_string()))?;

    let name = repo_path
        .file_name()
        .and_then(|segment| segment.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| repo_path_string.clone());

    Ok(Json(serde_json::json!({
        "success": true,
        "name": name,
        "path": repo_path_string,
        "branch": branch_info.current,
        "branches": branch_info.branches,
        "status": status,
    })))
}
