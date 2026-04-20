use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path as FilePath};

use crate::api::repo_context::{
    canonical_repo_path_for_response, resolve_repo_dir_or_error, validate_local_git_repo_path,
};
use crate::error::ServerError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/stage", post(stage_files))
        .route("/unstage", post(unstage_files))
        .route("/discard", post(discard_changes))
        .route("/commit", post(create_commit))
        .route("/commits", axum::routing::get(get_commits))
        .route("/commits/{sha}/diff", get(get_commit_diff))
        .route("/diff", get(get_file_diff))
        .route("/pull", post(pull_commits_handler))
        .route("/rebase", post(rebase_branch_handler))
        .route("/reset", post(reset_branch_handler))
        .route("/export", post(export_changes_handler))
}

pub fn read_router() -> Router<AppState> {
    Router::new()
        .route("/refs", get(get_refs))
        .route("/log", get(get_log_page))
        .route("/commit", get(get_commit_detail))
}

fn resolve_repo_path(repo_path: Option<&str>) -> Result<String, ServerError> {
    let repo_path = repo_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("repoPath is required".to_string()))?;

    let normalized = resolve_repo_dir_or_error(repo_path, "repoPath ")?;
    validate_local_git_repo_path(&normalized)?;

    Ok(normalized.to_string_lossy().to_string())
}

fn resolve_commit_sha(sha: Option<&str>) -> Result<String, ServerError> {
    let sha = sha
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("sha is required".to_string()))?;

    if sha.len() < 4 || !sha.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err(ServerError::BadRequest("sha is invalid".to_string()));
    }

    Ok(sha.to_string())
}

async fn resolve_codebase_repo_path(
    state: &AppState,
    workspace_id: &str,
    codebase_id: &str,
) -> Result<String, ServerError> {
    let _workspace = state
        .workspace_store
        .get(workspace_id)
        .await
        .map_err(|error| ServerError::Internal(error.to_string()))?
        .ok_or_else(|| ServerError::NotFound("Workspace not found".to_string()))?;

    let codebase = state
        .codebase_store
        .get(codebase_id)
        .await
        .map_err(|error| ServerError::Internal(error.to_string()))?
        .ok_or_else(|| ServerError::NotFound("Codebase not found".to_string()))?;

    if codebase.workspace_id != workspace_id {
        return Err(ServerError::NotFound("Codebase not found".to_string()));
    }

    let repo_path = canonical_repo_path_for_response(&codebase.repo_path);

    if !routa_core::git::is_git_repository(&repo_path) {
        return Err(ServerError::BadRequest(
            "Not a valid git repository".to_string(),
        ));
    }

    Ok(repo_path)
}

fn validate_git_file_path(path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("File path cannot be empty".to_string());
    }

    let candidate = FilePath::new(trimmed);
    if candidate.is_absolute() {
        return Err(format!("Absolute file paths are not allowed: {trimmed}"));
    }

    if candidate.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(format!(
            "File paths must stay within the repository root: {trimmed}"
        ));
    }

    Ok(())
}

fn validate_git_file_paths(files: &[String]) -> Result<(), String> {
    for file in files {
        validate_git_file_path(file)?;
    }

    Ok(())
}

fn git_command_output(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = crate::git::git_command()
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn build_export_filename() -> String {
    format!("changes-{}.patch", Utc::now().format("%Y-%m-%dT%H-%M-%S"))
}

fn server_error_message(error: ServerError) -> String {
    match error {
        ServerError::Database(message)
        | ServerError::NotFound(message)
        | ServerError::BadRequest(message)
        | ServerError::Conflict(message)
        | ServerError::Internal(message)
        | ServerError::NotImplemented(message) => message,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitRefsQuery {
    repo_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitLogPageQuery {
    repo_path: Option<String>,
    branches: Option<String>,
    search: Option<String>,
    limit: Option<usize>,
    skip: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitCommitDetailQuery {
    repo_path: Option<String>,
    sha: Option<String>,
}

async fn get_refs(
    Query(query): Query<GitRefsQuery>,
) -> Result<Json<routa_core::git::GitRefsResult>, ServerError> {
    let repo_path = resolve_repo_path(query.repo_path.as_deref())?;
    let refs = tokio::task::spawn_blocking(move || routa_core::git::list_git_refs(&repo_path))
        .await
        .map_err(|error| ServerError::Internal(error.to_string()))?
        .map_err(ServerError::Internal)?;

    Ok(Json(refs))
}

async fn get_log_page(
    Query(query): Query<GitLogPageQuery>,
) -> Result<Json<routa_core::git::GitLogPage>, ServerError> {
    let repo_path = resolve_repo_path(query.repo_path.as_deref())?;
    let branches = query
        .branches
        .as_deref()
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .filter(|value| !value.is_empty());
    let search = query
        .search
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let limit = query.limit;
    let skip = query.skip;

    let page = tokio::task::spawn_blocking(move || {
        routa_core::git::get_git_log_page(
            &repo_path,
            branches.as_deref(),
            search.as_deref(),
            limit,
            skip,
        )
    })
    .await
    .map_err(|error| ServerError::Internal(error.to_string()))?
    .map_err(ServerError::Internal)?;

    Ok(Json(page))
}

async fn get_commit_detail(
    Query(query): Query<GitCommitDetailQuery>,
) -> Result<Json<routa_core::git::GitCommitDetail>, ServerError> {
    let repo_path = resolve_repo_path(query.repo_path.as_deref())?;
    let sha = resolve_commit_sha(query.sha.as_deref())?;
    let detail = tokio::task::spawn_blocking(move || {
        routa_core::git::get_git_commit_detail(&repo_path, &sha)
    })
    .await
    .map_err(|error| ServerError::Internal(error.to_string()))?
    .map_err(ServerError::Internal)?;

    Ok(Json(detail))
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscardChangesRequest {
    files: Vec<String>,
    confirm: Option<bool>,
}

#[derive(Debug, Serialize)]
struct DiscardChangesResponse {
    success: bool,
    discarded: Option<Vec<String>>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetFileDiffQuery {
    path: Option<String>,
    staged: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GetFileDiffResponse {
    diff: String,
    path: String,
    staged: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetCommitDiffQuery {
    path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GetCommitDiffResponse {
    diff: String,
    sha: String,
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PullCommitsRequest {
    remote: Option<String>,
    branch: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RebaseBranchRequest {
    onto: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResetBranchRequest {
    to: Option<String>,
    mode: Option<String>,
    confirm: Option<bool>,
}

#[derive(Debug, Serialize)]
struct GitOperationResponse {
    success: bool,
    error: Option<String>,
    branch: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportChangesRequest {
    files: Option<Vec<String>>,
    format: Option<String>,
}

#[derive(Debug, Serialize)]
struct ExportChangesResponse {
    success: bool,
    patch: Option<String>,
    filename: Option<String>,
    error: Option<String>,
}

async fn stage_files(
    State(state): State<AppState>,
    Path((workspace_id, codebase_id)): Path<(String, String)>,
    Json(req): Json<StageFilesRequest>,
) -> Result<Json<StageFilesResponse>, ServerError> {
    let repo_path = match resolve_codebase_repo_path(&state, &workspace_id, &codebase_id).await {
        Ok(repo_path) => repo_path,
        Err(error) => {
            return Ok(Json(StageFilesResponse {
                success: false,
                staged: None,
                error: Some(server_error_message(error)),
            }))
        }
    };
    let files = req.files;
    let staged_files = files.clone();

    match tokio::task::spawn_blocking(move || routa_core::git::stage_files(&repo_path, &files))
        .await
        .map_err(|error| ServerError::Internal(error.to_string()))?
    {
        Ok(()) => Ok(Json(StageFilesResponse {
            success: true,
            staged: Some(staged_files),
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
    let repo_path = match resolve_codebase_repo_path(&state, &workspace_id, &codebase_id).await {
        Ok(repo_path) => repo_path,
        Err(error) => {
            return Ok(Json(StageFilesResponse {
                success: false,
                staged: None,
                error: Some(server_error_message(error)),
            }))
        }
    };
    let files = req.files;
    let staged_files = files.clone();

    match tokio::task::spawn_blocking(move || routa_core::git::unstage_files(&repo_path, &files))
        .await
        .map_err(|error| ServerError::Internal(error.to_string()))?
    {
        Ok(()) => Ok(Json(StageFilesResponse {
            success: true,
            staged: Some(staged_files),
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
    let repo_path = match resolve_codebase_repo_path(&state, &workspace_id, &codebase_id).await {
        Ok(repo_path) => repo_path,
        Err(error) => {
            return Ok(Json(CreateCommitResponse {
                success: false,
                sha: None,
                message: None,
                error: Some(server_error_message(error)),
            }))
        }
    };
    let message = req.message;
    let files = req.files;
    let response_message = message.clone();

    match tokio::task::spawn_blocking(move || {
        routa_core::git::create_commit(&repo_path, &message, files.as_deref())
    })
    .await
    .map_err(|error| ServerError::Internal(error.to_string()))?
    {
        Ok(sha) => Ok(Json(CreateCommitResponse {
            success: true,
            sha: Some(sha),
            message: Some(response_message),
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

async fn discard_changes(
    State(state): State<AppState>,
    Path((workspace_id, codebase_id)): Path<(String, String)>,
    Json(req): Json<DiscardChangesRequest>,
) -> Result<(StatusCode, Json<DiscardChangesResponse>), ServerError> {
    if req.files.is_empty() {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(DiscardChangesResponse {
                success: false,
                discarded: None,
                error: Some("Missing or invalid 'files' array in request body".to_string()),
            }),
        ));
    }

    if req.confirm != Some(true) {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(DiscardChangesResponse {
                success: false,
                discarded: None,
                error: Some("Discard changes requires explicit confirmation".to_string()),
            }),
        ));
    }

    let repo_path = match resolve_codebase_repo_path(&state, &workspace_id, &codebase_id).await {
        Ok(repo_path) => repo_path,
        Err(error) => {
            let status = match error {
                ServerError::NotFound(_) => StatusCode::NOT_FOUND,
                ServerError::BadRequest(_) => StatusCode::BAD_REQUEST,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            return Ok((
                status,
                Json(DiscardChangesResponse {
                    success: false,
                    discarded: None,
                    error: Some(server_error_message(error)),
                }),
            ));
        }
    };
    let files = req.files;
    let discarded_files = files.clone();

    let result =
        tokio::task::spawn_blocking(move || routa_core::git::discard_changes(&repo_path, &files))
            .await
            .map_err(|error| ServerError::Internal(error.to_string()))?;

    match result {
        Ok(()) => Ok((
            StatusCode::OK,
            Json(DiscardChangesResponse {
                success: true,
                discarded: Some(discarded_files),
                error: None,
            }),
        )),
        Err(error) => Ok((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(DiscardChangesResponse {
                success: false,
                discarded: None,
                error: Some(error),
            }),
        )),
    }
}

async fn get_file_diff(
    State(state): State<AppState>,
    Path((workspace_id, codebase_id)): Path<(String, String)>,
    Query(query): Query<GetFileDiffQuery>,
) -> Result<Json<GetFileDiffResponse>, ServerError> {
    let path = query
        .path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("Missing 'path' query parameter".to_string()))?
        .to_string();
    validate_git_file_path(&path).map_err(ServerError::BadRequest)?;
    let staged = query.staged.unwrap_or(false);
    let repo_path = resolve_codebase_repo_path(&state, &workspace_id, &codebase_id).await?;
    let response_path = path.clone();

    let diff = tokio::task::spawn_blocking(move || {
        if staged {
            git_command_output(&repo_path, &["diff", "--cached", "--", path.as_str()])
        } else {
            git_command_output(&repo_path, &["diff", "--", path.as_str()])
        }
    })
    .await
    .map_err(|error| ServerError::Internal(error.to_string()))?
    .map_err(ServerError::Internal)?;

    Ok(Json(GetFileDiffResponse {
        diff,
        path: response_path,
        staged,
    }))
}

async fn get_commit_diff(
    State(state): State<AppState>,
    Path((workspace_id, codebase_id, sha)): Path<(String, String, String)>,
    Query(query): Query<GetCommitDiffQuery>,
) -> Result<Json<GetCommitDiffResponse>, ServerError> {
    let sha = resolve_commit_sha(Some(&sha))?;
    let path = query
        .path
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(path_value) = path.as_deref() {
        validate_git_file_path(path_value).map_err(ServerError::BadRequest)?;
    }
    let repo_path = resolve_codebase_repo_path(&state, &workspace_id, &codebase_id).await?;
    let response_sha = sha.clone();
    let response_path = path.clone();

    let diff = tokio::task::spawn_blocking(move || {
        if let Some(path_value) = path.as_deref() {
            git_command_output(&repo_path, &["show", sha.as_str(), "--", path_value])
        } else {
            git_command_output(&repo_path, &["show", sha.as_str()])
        }
    })
    .await
    .map_err(|error| ServerError::Internal(error.to_string()))?
    .map_err(ServerError::Internal)?;

    Ok(Json(GetCommitDiffResponse {
        diff,
        sha: response_sha,
        path: response_path,
    }))
}

async fn pull_commits_handler(
    State(state): State<AppState>,
    Path((workspace_id, codebase_id)): Path<(String, String)>,
    Json(req): Json<PullCommitsRequest>,
) -> Result<(StatusCode, Json<GitOperationResponse>), ServerError> {
    let repo_path = match resolve_codebase_repo_path(&state, &workspace_id, &codebase_id).await {
        Ok(repo_path) => repo_path,
        Err(error) => {
            let status = match error {
                ServerError::NotFound(_) => StatusCode::NOT_FOUND,
                ServerError::BadRequest(_) => StatusCode::BAD_REQUEST,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            return Ok((
                status,
                Json(GitOperationResponse {
                    success: false,
                    error: Some(server_error_message(error)),
                    branch: None,
                }),
            ));
        }
    };
    let remote = req.remote;
    let branch = req.branch;

    let result = tokio::task::spawn_blocking(move || {
        routa_core::git::pull_commits(&repo_path, remote.as_deref(), branch.as_deref())
    })
    .await
    .map_err(|error| ServerError::Internal(error.to_string()))?;

    match result {
        Ok(()) => Ok((
            StatusCode::OK,
            Json(GitOperationResponse {
                success: true,
                error: None,
                branch: None,
            }),
        )),
        Err(error) => Ok((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(GitOperationResponse {
                success: false,
                error: Some(error),
                branch: None,
            }),
        )),
    }
}

async fn rebase_branch_handler(
    State(state): State<AppState>,
    Path((workspace_id, codebase_id)): Path<(String, String)>,
    Json(req): Json<RebaseBranchRequest>,
) -> Result<(StatusCode, Json<GitOperationResponse>), ServerError> {
    let onto = req
        .onto
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("Target branch 'onto' is required".to_string()))?
        .to_string();
    let repo_path = resolve_codebase_repo_path(&state, &workspace_id, &codebase_id).await?;

    let result =
        tokio::task::spawn_blocking(move || routa_core::git::rebase_branch(&repo_path, &onto))
            .await
            .map_err(|error| ServerError::Internal(error.to_string()))?;

    match result {
        Ok(()) => Ok((
            StatusCode::OK,
            Json(GitOperationResponse {
                success: true,
                error: None,
                branch: None,
            }),
        )),
        Err(error) => Ok((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(GitOperationResponse {
                success: false,
                error: Some(error),
                branch: None,
            }),
        )),
    }
}

async fn reset_branch_handler(
    State(state): State<AppState>,
    Path((workspace_id, codebase_id)): Path<(String, String)>,
    Json(req): Json<ResetBranchRequest>,
) -> Result<(StatusCode, Json<GitOperationResponse>), ServerError> {
    let to = req
        .to
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ServerError::BadRequest("Target commit/branch 'to' is required".to_string())
        })?
        .to_string();
    let mode = req
        .mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("Mode must be 'soft' or 'hard'".to_string()))?
        .to_string();
    if mode != "soft" && mode != "hard" {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(GitOperationResponse {
                success: false,
                error: Some("Mode must be 'soft' or 'hard'".to_string()),
                branch: None,
            }),
        ));
    }
    if mode == "hard" && req.confirm != Some(true) {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(GitOperationResponse {
                success: false,
                error: Some("Hard reset requires explicit confirmation".to_string()),
                branch: None,
            }),
        ));
    }
    let repo_path = resolve_codebase_repo_path(&state, &workspace_id, &codebase_id).await?;
    let confirm = req.confirm.unwrap_or(false);
    let repo_path_for_git = repo_path.clone();
    let to_for_git = to.clone();
    let mode_for_git = mode.clone();

    let result = tokio::task::spawn_blocking(move || {
        routa_core::git::reset_branch(&repo_path_for_git, &to_for_git, &mode_for_git, confirm)?;

        let is_target_local_branch =
            routa_core::git::has_local_branch(&repo_path_for_git, &to_for_git);
        if is_target_local_branch {
            let current_branch = routa_core::git::get_current_branch(&repo_path_for_git);
            if current_branch.as_deref() != Some(to_for_git.as_str()) {
                routa_core::git::checkout_existing_branch(&repo_path_for_git, &to_for_git)?;
            }
        }

        Ok::<bool, String>(is_target_local_branch)
    })
    .await
    .map_err(|error| ServerError::Internal(error.to_string()))?;

    match result {
        Ok(is_target_local_branch) => {
            if is_target_local_branch {
                state
                    .codebase_store
                    .update(&codebase_id, Some(&to), None, None, None, None)
                    .await
                    .map_err(|error| ServerError::Internal(error.to_string()))?;
            }

            Ok((
                StatusCode::OK,
                Json(GitOperationResponse {
                    success: true,
                    error: None,
                    branch: if is_target_local_branch {
                        Some(to)
                    } else {
                        None
                    },
                }),
            ))
        }
        Err(error) => Ok((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(GitOperationResponse {
                success: false,
                error: Some(error),
                branch: None,
            }),
        )),
    }
}

async fn export_changes_handler(
    State(state): State<AppState>,
    Path((workspace_id, codebase_id)): Path<(String, String)>,
    Json(req): Json<ExportChangesRequest>,
) -> Result<(StatusCode, Json<ExportChangesResponse>), ServerError> {
    let repo_path = match resolve_codebase_repo_path(&state, &workspace_id, &codebase_id).await {
        Ok(repo_path) => repo_path,
        Err(error) => {
            let status = match error {
                ServerError::NotFound(_) => StatusCode::NOT_FOUND,
                ServerError::BadRequest(_) => StatusCode::BAD_REQUEST,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            return Ok((
                status,
                Json(ExportChangesResponse {
                    success: false,
                    patch: None,
                    filename: None,
                    error: Some(server_error_message(error)),
                }),
            ));
        }
    };
    let files = req.files.unwrap_or_default();
    validate_git_file_paths(&files).map_err(ServerError::BadRequest)?;
    let format = req.format.unwrap_or_else(|| "patch".to_string());
    if format != "patch" && format != "diff" {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(ExportChangesResponse {
                success: false,
                patch: None,
                filename: None,
                error: Some("format must be 'patch' or 'diff'".to_string()),
            }),
        ));
    }

    let result = tokio::task::spawn_blocking(move || {
        if format == "patch" {
            git_command_output(
                &repo_path,
                &["diff", "--cached", "--no-color", "--no-ext-diff"],
            )
        } else if files.is_empty() {
            git_command_output(&repo_path, &["diff", "--no-color", "--no-ext-diff"])
        } else {
            let mut args = vec!["diff", "--no-color", "--no-ext-diff", "--"];
            args.extend(files.iter().map(|value| value.as_str()));
            git_command_output(&repo_path, &args)
        }
    })
    .await
    .map_err(|error| ServerError::Internal(error.to_string()))?;

    match result {
        Ok(patch) => {
            if patch.trim().is_empty() {
                Ok((
                    StatusCode::BAD_REQUEST,
                    Json(ExportChangesResponse {
                        success: false,
                        patch: None,
                        filename: None,
                        error: Some("No changes to export".to_string()),
                    }),
                ))
            } else {
                Ok((
                    StatusCode::OK,
                    Json(ExportChangesResponse {
                        success: true,
                        patch: Some(patch),
                        filename: Some(build_export_filename()),
                        error: None,
                    }),
                ))
            }
        }
        Err(error) => Ok((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ExportChangesResponse {
                success: false,
                patch: None,
                filename: None,
                error: Some(error),
            }),
        )),
    }
}

async fn get_commits(
    State(state): State<AppState>,
    Path((workspace_id, codebase_id)): Path<(String, String)>,
    Query(query): Query<GetCommitsQuery>,
) -> Result<Json<GetCommitsResponse>, ServerError> {
    let repo_path = resolve_codebase_repo_path(&state, &workspace_id, &codebase_id).await?;
    let limit = query.limit;
    let since = query.since;

    let commits = tokio::task::spawn_blocking(move || {
        routa_core::git::get_commit_list(&repo_path, limit, since.as_deref())
    })
    .await
    .map_err(|error| ServerError::Internal(error.to_string()))?
    .map_err(ServerError::Internal)?;

    let count = commits.len();

    Ok(Json(GetCommitsResponse { commits, count }))
}
