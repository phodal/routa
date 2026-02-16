//! Clone API - /api/clone
//!
//! POST /api/clone - Clone a GitHub repository
//! GET  /api/clone - List cloned repositories
//! PATCH /api/clone - Switch branch

use axum::{routing::get, Json, Router};
use serde::Deserialize;

use crate::server::error::ServerError;
use crate::server::git;
use crate::server::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(list_repos).post(clone_repo).patch(switch_branch))
}

#[derive(Debug, Deserialize)]
struct CloneRequest {
    url: Option<String>,
}

async fn clone_repo(Json(body): Json<CloneRequest>) -> Result<Json<serde_json::Value>, ServerError> {
    let url = body
        .url
        .as_deref()
        .ok_or_else(|| ServerError::BadRequest("Missing 'url' field".into()))?;

    let parsed = git::parse_github_url(url).ok_or_else(|| {
        ServerError::BadRequest(
            "Invalid GitHub URL. Expected: https://github.com/owner/repo or owner/repo".into(),
        )
    })?;

    let repo_name = git::repo_to_dir_name(&parsed.owner, &parsed.repo);
    let base_dir = git::get_clone_base_dir();
    std::fs::create_dir_all(&base_dir)
        .map_err(|e| ServerError::Internal(format!("Failed to create base dir: {}", e)))?;

    let target_dir = base_dir.join(&repo_name);
    let target_str = target_dir.to_string_lossy().to_string();

    if target_dir.exists() {
        // Already cloned — pull latest
        tokio::task::spawn_blocking({
            let target_str = target_str.clone();
            move || {
                let _ = std::process::Command::new("git")
                    .args(["pull", "--ff-only"])
                    .current_dir(&target_str)
                    .output();
            }
        })
        .await
        .ok();

        let info = tokio::task::spawn_blocking({
            let ts = target_str.clone();
            move || git::get_branch_info(&ts)
        })
        .await
        .map_err(|e| ServerError::Internal(e.to_string()))?;

        return Ok(Json(serde_json::json!({
            "success": true,
            "path": target_str,
            "name": format!("{}/{}", parsed.owner, parsed.repo),
            "branch": info.current,
            "branches": info.branches,
            "existed": true,
        })));
    }

    // Clone the repository
    let clone_url = format!("https://github.com/{}/{}.git", parsed.owner, parsed.repo);
    let target_dir_str = target_dir.to_string_lossy().to_string();

    tokio::task::spawn_blocking({
        let clone_url = clone_url.clone();
        let target = target_dir_str.clone();
        move || {
            std::process::Command::new("git")
                .args(["clone", "--depth", "1", &clone_url, &target])
                .output()
        }
    })
    .await
    .map_err(|e| ServerError::Internal(e.to_string()))?
    .map_err(|e| ServerError::Internal(format!("Clone failed: {}", e)))?;

    // Fetch all branches
    let _ = tokio::task::spawn_blocking({
        let ts = target_str.clone();
        move || {
            let _ = std::process::Command::new("git")
                .args(["fetch", "--all"])
                .current_dir(&ts)
                .output();
        }
    })
    .await;

    let info = tokio::task::spawn_blocking({
        let ts = target_str.clone();
        move || git::get_branch_info(&ts)
    })
    .await
    .map_err(|e| ServerError::Internal(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "path": target_str,
        "name": format!("{}/{}", parsed.owner, parsed.repo),
        "branch": info.current,
        "branches": info.branches,
        "existed": false,
    })))
}

async fn list_repos() -> Result<Json<serde_json::Value>, ServerError> {
    let repos = tokio::task::spawn_blocking(git::list_cloned_repos)
        .await
        .map_err(|e| ServerError::Internal(e.to_string()))?;
    Ok(Json(serde_json::json!({ "repos": repos })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SwitchBranchRequest {
    repo_path: Option<String>,
    branch: Option<String>,
}

async fn switch_branch(
    Json(body): Json<SwitchBranchRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let repo_path = body
        .repo_path
        .ok_or_else(|| ServerError::BadRequest("Missing 'repoPath'".into()))?;
    let branch = body
        .branch
        .ok_or_else(|| ServerError::BadRequest("Missing 'branch'".into()))?;

    if !std::path::Path::new(&repo_path).exists() {
        return Err(ServerError::NotFound("Repository not found".into()));
    }

    let success = tokio::task::spawn_blocking({
        let rp = repo_path.clone();
        let br = branch.clone();
        move || git::checkout_branch(&rp, &br)
    })
    .await
    .map_err(|e| ServerError::Internal(e.to_string()))?;

    if !success {
        return Err(ServerError::Internal(format!(
            "Failed to checkout branch '{}'",
            branch
        )));
    }

    let info = tokio::task::spawn_blocking({
        let rp = repo_path;
        move || git::get_branch_info(&rp)
    })
    .await
    .map_err(|e| ServerError::Internal(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "branch": info.current,
        "branches": info.branches,
    })))
}
