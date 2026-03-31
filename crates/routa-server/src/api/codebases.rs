use axum::{
    extract::State,
    routing::{get, patch, post},
    Json, Router,
};
use serde::Deserialize;

use crate::api::repo_context::{normalize_local_repo_path, validate_local_git_repo_path};
use crate::error::ServerError;
use crate::models::codebase::Codebase;
use crate::state::AppState;

fn repo_label_from_path(repo_path: &str) -> String {
    std::path::Path::new(repo_path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| repo_path.to_string())
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/workspaces/{workspace_id}/codebases",
            get(list_codebases).post(add_codebase),
        )
        .route(
            "/workspaces/{workspace_id}/codebases/changes",
            get(list_codebase_changes),
        )
        .route(
            "/codebases/{id}",
            patch(update_codebase).delete(delete_codebase),
        )
        .route("/codebases/{id}/default", post(set_default_codebase))
}

async fn list_codebases(
    State(state): State<AppState>,
    axum::extract::Path(workspace_id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let codebases = state
        .codebase_store
        .list_by_workspace(&workspace_id)
        .await?;
    Ok(Json(serde_json::json!({ "codebases": codebases })))
}

async fn list_codebase_changes(
    State(state): State<AppState>,
    axum::extract::Path(workspace_id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let codebases = state
        .codebase_store
        .list_by_workspace(&workspace_id)
        .await?;

    let repos = codebases
        .into_iter()
        .map(|codebase| {
            let label = codebase
                .label
                .clone()
                .unwrap_or_else(|| repo_label_from_path(&codebase.repo_path));

            if codebase.repo_path.is_empty() {
                return serde_json::json!({
                    "codebaseId": codebase.id,
                    "repoPath": codebase.repo_path,
                    "label": label,
                    "branch": codebase.branch.unwrap_or_else(|| "unknown".to_string()),
                    "status": { "clean": true, "ahead": 0, "behind": 0, "modified": 0, "untracked": 0 },
                    "files": [],
                    "error": "Missing repository path",
                });
            }

            if !crate::git::is_git_repository(&codebase.repo_path) {
                return serde_json::json!({
                    "codebaseId": codebase.id,
                    "repoPath": codebase.repo_path,
                    "label": label,
                    "branch": codebase.branch.unwrap_or_else(|| "unknown".to_string()),
                    "status": { "clean": true, "ahead": 0, "behind": 0, "modified": 0, "untracked": 0 },
                    "files": [],
                    "error": "Repository is missing or not a git repository",
                });
            }

            let changes = crate::git::get_repo_changes(&codebase.repo_path);
            serde_json::json!({
                "codebaseId": codebase.id,
                "repoPath": codebase.repo_path,
                "label": label,
                "branch": changes.branch,
                "status": changes.status,
                "files": changes.files,
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(serde_json::json!({
        "workspaceId": workspace_id,
        "repos": repos,
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddCodebaseRequest {
    repo_path: String,
    branch: Option<String>,
    label: Option<String>,
    #[serde(default)]
    is_default: bool,
}

async fn add_codebase(
    State(state): State<AppState>,
    axum::extract::Path(workspace_id): axum::extract::Path<String>,
    Json(body): Json<AddCodebaseRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let repo_path = normalize_local_repo_path(&body.repo_path);
    validate_local_git_repo_path(&repo_path)?;
    let repo_path = repo_path.to_string_lossy().to_string();

    // Check for duplicate repo_path within the workspace
    if let Some(_existing) = state
        .codebase_store
        .find_by_repo_path(&workspace_id, &repo_path)
        .await?
    {
        return Err(ServerError::Conflict(format!(
            "Codebase with repo_path '{}' already exists in workspace {}",
            repo_path, workspace_id
        )));
    }

    let codebase = Codebase::new(
        uuid::Uuid::new_v4().to_string(),
        workspace_id,
        repo_path,
        body.branch,
        body.label,
        body.is_default,
    );

    state.codebase_store.save(&codebase).await?;
    Ok(Json(serde_json::json!({ "codebase": codebase })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCodebaseRequest {
    branch: Option<String>,
    label: Option<String>,
    repo_path: Option<String>,
}

async fn update_codebase(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<UpdateCodebaseRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let existing = state
        .codebase_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Codebase {} not found", id)))?;

    let repo_path = if let Some(repo_path) = body.repo_path.as_deref() {
        let normalized = normalize_local_repo_path(repo_path);
        validate_local_git_repo_path(&normalized)?;
        let normalized = normalized.to_string_lossy().to_string();

        if let Some(duplicate) = state
            .codebase_store
            .find_by_repo_path(&existing.workspace_id, &normalized)
            .await?
        {
            if duplicate.id != id {
                return Err(ServerError::Conflict(format!(
                    "Codebase with repo_path '{}' already exists in workspace {}",
                    normalized, existing.workspace_id
                )));
            }
        }

        Some(normalized)
    } else {
        None
    };

    state
        .codebase_store
        .update(
            &id,
            body.branch.as_deref(),
            body.label.as_deref(),
            repo_path.as_deref(),
        )
        .await?;

    let codebase = state
        .codebase_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Codebase {} not found", id)))?;

    Ok(Json(serde_json::json!({ "codebase": codebase })))
}

async fn delete_codebase(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    // Clean up worktrees on disk before deleting the codebase
    if let Ok(Some(codebase)) = state.codebase_store.get(&id).await {
        let repo_path = &codebase.repo_path;

        // Acquire repo lock to prevent races with concurrent worktree operations
        let lock = {
            let mut locks = crate::api::worktrees::get_repo_locks().lock().await;
            locks
                .entry(repo_path.to_string())
                .or_insert_with(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
                .clone()
        };
        let _guard = lock.lock().await;

        let worktrees = state
            .worktree_store
            .list_by_codebase(&id)
            .await
            .map_err(|e| ServerError::Internal(format!("Failed to list worktrees: {}", e)))?;
        for wt in &worktrees {
            if let Err(e) = crate::git::worktree_remove(repo_path, &wt.worktree_path, true) {
                tracing::warn!(
                    "[Codebase DELETE] Failed to remove worktree {}: {}",
                    wt.id,
                    e
                );
            }
        }
        if !worktrees.is_empty() {
            let _ = crate::git::worktree_prune(repo_path);
        }
    }

    state.codebase_store.delete(&id).await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

async fn set_default_codebase(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let codebase = state
        .codebase_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Codebase {} not found", id)))?;

    state
        .codebase_store
        .set_default(&codebase.workspace_id, &id)
        .await?;

    let updated = state
        .codebase_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Codebase {} not found", id)))?;

    Ok(Json(serde_json::json!({ "codebase": updated })))
}
