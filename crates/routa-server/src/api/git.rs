use axum::{
    extract::{Path, Query, State},
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::error::ServerError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/stage", post(stage_files))
        .route("/unstage", post(unstage_files))
        .route("/commit", post(create_commit))
        .route("/commits", axum::routing::get(get_commits))
}

#[derive(Debug, Deserialize)]
struct StageFilesRequest {
    files: Vec<String>,
}

#[derive(Debug, Serialize)]
struct StageFilesResponse {
    success: bool,
    staged: Option<Vec<String>>,
    error: Option<String>,
}

async fn stage_files(
    State(state): State<AppState>,
    Path((workspace_id, codebase_id)): Path<(String, String)>,
    Json(req): Json<StageFilesRequest>,
) -> Result<Json<StageFilesResponse>, ServerError> {
    // Verify workspace exists
    let _workspace = state
        .workspace_store
        .get(&workspace_id)
        .await
        .map_err(|e| ServerError::InternalError(e.to_string()))?
        .ok_or_else(|| ServerError::NotFound("Workspace not found".to_string()))?;

    // Get codebase
    let codebase = state
        .codebase_store
        .get(&codebase_id)
        .await
        .map_err(|e| ServerError::InternalError(e.to_string()))?
        .ok_or_else(|| ServerError::NotFound("Codebase not found".to_string()))?;

    // Verify it's a git repository
    if !routa_core::git::is_git_repository(&codebase.repo_path) {
        return Ok(Json(StageFilesResponse {
            success: false,
            staged: None,
            error: Some("Not a valid git repository".to_string()),
        }));
    }

    // Stage the files
    match routa_core::git::stage_files(&codebase.repo_path, &req.files) {
        Ok(()) => Ok(Json(StageFilesResponse {
            success: true,
            staged: Some(req.files),
            error: None,
        })),
        Err(e) => Ok(Json(StageFilesResponse {
            success: false,
            staged: None,
            error: Some(e),
        })),
    }
}

async fn unstage_files(
    State(state): State<AppState>,
    Path((workspace_id, codebase_id)): Path<(String, String)>,
    Json(req): Json<StageFilesRequest>,
) -> Result<Json<StageFilesResponse>, ServerError> {
    let _workspace = state
        .workspace_store
        .get(&workspace_id)
        .await
        .map_err(|e| ServerError::InternalError(e.to_string()))?
        .ok_or_else(|| ServerError::NotFound("Workspace not found".to_string()))?;

    let codebase = state
        .codebase_store
        .get(&codebase_id)
        .await
        .map_err(|e| ServerError::InternalError(e.to_string()))?
        .ok_or_else(|| ServerError::NotFound("Codebase not found".to_string()))?;

    if !routa_core::git::is_git_repository(&codebase.repo_path) {
        return Ok(Json(StageFilesResponse {
            success: false,
            staged: None,
            error: Some("Not a valid git repository".to_string()),
        }));
    }

    match routa_core::git::unstage_files(&codebase.repo_path, &req.files) {
        Ok(()) => Ok(Json(StageFilesResponse {
            success: true,
            staged: Some(req.files),
            error: None,
        })),
        Err(e) => Ok(Json(StageFilesResponse {
            success: false,
            staged: None,
            error: Some(e),
        })),
    }
}

#[derive(Debug, Deserialize)]
struct CreateCommitRequest {
    message: String,
    files: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
struct CreateCommitResponse {
    success: bool,
    sha: Option<String>,
    message: Option<String>,
    error: Option<String>,
}

async fn create_commit(
    State(state): State<AppState>,
    Path((workspace_id, codebase_id)): Path<(String, String)>,
    Json(req): Json<CreateCommitRequest>,
) -> Result<Json<CreateCommitResponse>, ServerError> {
    let _workspace = state
        .workspace_store
        .get(&workspace_id)
        .await
        .map_err(|e| ServerError::InternalError(e.to_string()))?
        .ok_or_else(|| ServerError::NotFound("Workspace not found".to_string()))?;

    let codebase = state
        .codebase_store
        .get(&codebase_id)
        .await
        .map_err(|e| ServerError::InternalError(e.to_string()))?
        .ok_or_else(|| ServerError::NotFound("Codebase not found".to_string()))?;

    if !routa_core::git::is_git_repository(&codebase.repo_path) {
        return Ok(Json(CreateCommitResponse {
            success: false,
            sha: None,
            message: None,
            error: Some("Not a valid git repository".to_string()),
        }));
    }

    let files_ref = req.files.as_deref();
    match routa_core::git::create_commit(&codebase.repo_path, &req.message, files_ref) {
        Ok(sha) => Ok(Json(CreateCommitResponse {
            success: true,
            sha: Some(sha),
            message: Some(req.message),
            error: None,
        })),
        Err(e) => Ok(Json(CreateCommitResponse {
            success: false,
            sha: None,
            message: None,
            error: Some(e),
        })),
    }
}

#[derive(Debug, Deserialize)]
struct GetCommitsQuery {
    limit: Option<usize>,
    since: Option<String>,
}

#[derive(Debug, Serialize)]
struct GetCommitsResponse {
    commits: Vec<routa_core::git::CommitInfo>,
    count: usize,
}

async fn get_commits(
    State(state): State<AppState>,
    Path((workspace_id, codebase_id)): Path<(String, String)>,
    Query(query): Query<GetCommitsQuery>,
) -> Result<Json<GetCommitsResponse>, ServerError> {
    let _workspace = state
        .workspace_store
        .get(&workspace_id)
        .await
        .map_err(|e| ServerError::InternalError(e.to_string()))?
        .ok_or_else(|| ServerError::NotFound("Workspace not found".to_string()))?;

    let codebase = state
        .codebase_store
        .get(&codebase_id)
        .await
        .map_err(|e| ServerError::InternalError(e.to_string()))?
        .ok_or_else(|| ServerError::NotFound("Codebase not found".to_string()))?;

    if !routa_core::git::is_git_repository(&codebase.repo_path) {
        return Err(ServerError::BadRequest(
            "Not a valid git repository".to_string(),
        ));
    }

    let commits = routa_core::git::get_commit_list(
        &codebase.repo_path,
        query.limit,
        query.since.as_deref(),
    )
    .map_err(|e| ServerError::InternalError(e))?;

    let count = commits.len();

    Ok(Json(GetCommitsResponse { commits, count }))
}
