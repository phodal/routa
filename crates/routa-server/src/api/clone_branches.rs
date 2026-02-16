//! Branch Management API - /api/clone/branches
//!
//! GET   /api/clone/branches?repoPath=... - Get branch info
//! POST  /api/clone/branches - Fetch remote branches then return all
//! PATCH /api/clone/branches - Checkout a branch

use axum::{extract::Query, routing::get, Json, Router};
use serde::Deserialize;

use crate::error::ServerError;
use crate::git;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(get_branches).post(fetch_branches).patch(checkout))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BranchQuery {
    repo_path: Option<String>,
}

async fn get_branches(
    Query(query): Query<BranchQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let repo_path = query
        .repo_path
        .ok_or_else(|| ServerError::BadRequest("Missing repoPath".into()))?;

    if !std::path::Path::new(&repo_path).exists() {
        return Err(ServerError::BadRequest("Missing or invalid repoPath".into()));
    }

    let (current, local, remote, status) = tokio::task::spawn_blocking({
        let rp = repo_path.clone();
        move || {
            let current = git::get_current_branch(&rp).unwrap_or_else(|| "unknown".into());
            let local = git::list_local_branches(&rp);
            let remote = git::list_remote_branches(&rp);
            let status = git::get_branch_status(&rp, &current);
            (current, local, remote, status)
        }
    })
    .await
    .map_err(|e| ServerError::Internal(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "current": current,
        "local": local,
        "remote": remote,
        "status": status,
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchBranchesBody {
    repo_path: Option<String>,
}

async fn fetch_branches(
    Json(body): Json<FetchBranchesBody>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let repo_path = body
        .repo_path
        .ok_or_else(|| ServerError::BadRequest("Missing repoPath".into()))?;

    if !std::path::Path::new(&repo_path).exists() {
        return Err(ServerError::BadRequest("Missing or invalid repoPath".into()));
    }

    let (current, local, remote, status) = tokio::task::spawn_blocking({
        let rp = repo_path.clone();
        move || {
            git::fetch_remote(&rp);
            let current = git::get_current_branch(&rp).unwrap_or_else(|| "unknown".into());
            let local = git::list_local_branches(&rp);
            let remote = git::list_remote_branches(&rp);
            let status = git::get_branch_status(&rp, &current);
            (current, local, remote, status)
        }
    })
    .await
    .map_err(|e| ServerError::Internal(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "current": current,
        "local": local,
        "remote": remote,
        "status": status,
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckoutBody {
    repo_path: Option<String>,
    branch: Option<String>,
    pull: Option<bool>,
}

async fn checkout(Json(body): Json<CheckoutBody>) -> Result<Json<serde_json::Value>, ServerError> {
    let repo_path = body
        .repo_path
        .ok_or_else(|| ServerError::BadRequest("Missing repoPath".into()))?;
    let branch = body
        .branch
        .ok_or_else(|| ServerError::BadRequest("Missing branch".into()))?;

    if !std::path::Path::new(&repo_path).exists() {
        return Err(ServerError::NotFound("Repository not found".into()));
    }

    let do_pull = body.pull.unwrap_or(false);

    let (success, info, status) = tokio::task::spawn_blocking({
        let rp = repo_path.clone();
        let br = branch.clone();
        move || {
            let ok = git::checkout_branch(&rp, &br);
            if ok && do_pull {
                let _ = git::pull_branch(&rp);
            }
            let info = git::get_branch_info(&rp);
            let status = git::get_branch_status(&rp, &info.current);
            (ok, info, status)
        }
    })
    .await
    .map_err(|e| ServerError::Internal(e.to_string()))?;

    if !success {
        return Err(ServerError::Internal(format!(
            "Failed to checkout branch '{}'",
            branch
        )));
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "branch": info.current,
        "branches": info.branches,
        "status": status,
    })))
}
