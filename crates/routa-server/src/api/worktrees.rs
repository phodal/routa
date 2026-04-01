use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::error::ServerError;
use crate::git;
use crate::models::worktree::Worktree;
use crate::state::AppState;

/// Per-repository mutex for serializing git worktree operations.
type RepoLocks = Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>;

lazy_static::lazy_static! {
    static ref REPO_LOCKS: RepoLocks = Arc::new(Mutex::new(HashMap::new()));
}

/// Get the global repo locks map (for reuse in codebase deletion).
pub fn get_repo_locks() -> &'static RepoLocks {
    &REPO_LOCKS
}

async fn get_repo_lock(repo_path: &str) -> Arc<Mutex<()>> {
    let mut locks = REPO_LOCKS.lock().await;
    locks
        .entry(repo_path.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/workspaces/{workspace_id}/codebases/{codebase_id}/worktrees",
            get(list_worktrees).post(create_worktree),
        )
        .route("/worktrees/{id}", get(get_worktree).delete(delete_worktree))
        .route("/worktrees/{id}/validate", post(validate_worktree))
}

// ─── List Worktrees ─────────────────────────────────────────────────────

async fn list_worktrees(
    State(state): State<AppState>,
    Path((workspace_id, codebase_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ServerError> {
    // Validate codebase belongs to the workspace
    let codebase = state
        .codebase_store
        .get(&codebase_id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Codebase {} not found", codebase_id)))?;
    if codebase.workspace_id != workspace_id {
        return Err(ServerError::NotFound(format!(
            "Codebase {} not found",
            codebase_id
        )));
    }

    let worktrees = state.worktree_store.list_by_codebase(&codebase_id).await?;
    Ok(Json(serde_json::json!({ "worktrees": worktrees })))
}

// ─── Create Worktree ────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateWorktreeRequest {
    branch: Option<String>,
    base_branch: Option<String>,
    label: Option<String>,
}

async fn create_worktree(
    State(state): State<AppState>,
    Path((workspace_id, codebase_id)): Path<(String, String)>,
    Json(body): Json<CreateWorktreeRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let codebase = state
        .codebase_store
        .get(&codebase_id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Codebase {} not found", codebase_id)))?;

    // Validate codebase belongs to the workspace
    if codebase.workspace_id != workspace_id {
        return Err(ServerError::NotFound(format!(
            "Codebase {} not found",
            codebase_id
        )));
    }

    let repo_path = &codebase.repo_path;
    let base_branch = body.base_branch.unwrap_or_else(|| {
        codebase
            .branch
            .clone()
            .unwrap_or_else(|| "main".to_string())
    });

    let uuid_str = uuid::Uuid::new_v4().to_string();
    let short_id = &uuid_str[..8];
    let branch = body.branch.unwrap_or_else(|| {
        let suffix = body
            .label
            .as_ref()
            .map(|l| git::branch_to_safe_dir_name(l))
            .unwrap_or_else(|| short_id.to_string());
        format!("wt/{}", suffix)
    });

    // Acquire repo lock BEFORE branch check + DB insert to prevent races
    let lock = get_repo_lock(repo_path).await;
    let _guard = lock.lock().await;

    // Check if branch already used by another worktree (inside lock)
    if let Some(existing) = state
        .worktree_store
        .find_by_branch(&codebase_id, &branch)
        .await?
    {
        return Err(ServerError::Conflict(format!(
            "Branch '{}' is already in use by worktree {}",
            branch, existing.id
        )));
    }

    // Compute worktree path
    let worktree_path = git::get_worktree_base_dir()
        .join(&codebase.workspace_id)
        .join(&codebase_id)
        .join(git::branch_to_safe_dir_name(&branch));

    // Ensure parent directory exists
    if let Some(parent) = worktree_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            ServerError::Internal(format!("Failed to create worktree parent dir: {}", e))
        })?;
    }

    let worktree_path_str = worktree_path.to_string_lossy().to_string();

    // Create DB record
    let worktree = Worktree::new(
        uuid::Uuid::new_v4().to_string(),
        codebase_id.clone(),
        codebase.workspace_id.clone(),
        worktree_path_str.clone(),
        branch.clone(),
        base_branch.clone(),
        body.label,
    );
    state.worktree_store.save(&worktree).await?;

    // Prune stale references
    let _ = git::worktree_prune(repo_path);

    // Check if branch already exists
    let branch_already_exists = git::branch_exists(repo_path, &branch);

    let result = if branch_already_exists {
        git::worktree_add(repo_path, &worktree_path_str, &branch, &base_branch, false)
    } else {
        git::worktree_add(repo_path, &worktree_path_str, &branch, &base_branch, true)
    };

    match result {
        Ok(()) => {
            state
                .worktree_store
                .update_status(&worktree.id, "active", None)
                .await?;
            let updated = state
                .worktree_store
                .get(&worktree.id)
                .await?
                .unwrap_or(worktree);
            Ok(Json(serde_json::json!({ "worktree": updated })))
        }
        Err(err) => {
            state
                .worktree_store
                .update_status(&worktree.id, "error", Some(&err))
                .await?;
            Err(ServerError::Internal(format!(
                "Failed to create worktree: {}",
                err
            )))
        }
    }
}

// ─── Get Worktree ───────────────────────────────────────────────────────

async fn get_worktree(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let worktree = state
        .worktree_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Worktree {} not found", id)))?;
    Ok(Json(serde_json::json!({ "worktree": worktree })))
}

// ─── Delete Worktree ────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DeleteWorktreeQuery {
    delete_branch: Option<bool>,
}

async fn delete_worktree(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<DeleteWorktreeQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let worktree = state
        .worktree_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Worktree {} not found", id)))?;

    let codebase = state.codebase_store.get(&worktree.codebase_id).await?;

    if let Some(codebase) = codebase {
        let repo_path = &codebase.repo_path;
        let lock = get_repo_lock(repo_path).await;
        let _guard = lock.lock().await;

        state
            .worktree_store
            .update_status(&id, "removing", None)
            .await?;

        // Remove worktree from disk
        let _ = git::worktree_remove(repo_path, &worktree.worktree_path, true);
        let _ = git::worktree_prune(repo_path);

        // Optionally delete the branch
        if query.delete_branch.unwrap_or(false) {
            let _ = std::process::Command::new("git")
                .args(["branch", "-D", &worktree.branch])
                .current_dir(repo_path)
                .output();
        }
    }

    state.worktree_store.delete(&id).await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

// ─── Validate Worktree ──────────────────────────────────────────────────

async fn validate_worktree(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let worktree = state
        .worktree_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Worktree {} not found", id)))?;

    let path = std::path::Path::new(&worktree.worktree_path);
    if !path.exists() {
        state
            .worktree_store
            .update_status(&id, "error", Some("Worktree directory missing"))
            .await?;
        return Ok(Json(
            serde_json::json!({ "healthy": false, "error": "Worktree directory missing" }),
        ));
    }

    let git_file = path.join(".git");
    if !git_file.exists() {
        state
            .worktree_store
            .update_status(
                &id,
                "error",
                Some("Not a valid worktree (.git file missing)"),
            )
            .await?;
        return Ok(Json(
            serde_json::json!({ "healthy": false, "error": "Not a valid worktree (.git file missing)" }),
        ));
    }

    // Restore to active if was in error state
    if worktree.status == "error" {
        state
            .worktree_store
            .update_status(&id, "active", None)
            .await?;
    }

    Ok(Json(serde_json::json!({ "healthy": true })))
}
