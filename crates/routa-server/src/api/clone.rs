//! Clone API - /api/clone
//!
//! POST /api/clone - Clone a GitHub repository
//! GET  /api/clone - List cloned repositories
//! PATCH /api/clone - Switch branch

use axum::{routing::get, Json, Router};
use serde::Deserialize;

use crate::error::ServerError;
use crate::git;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(list_repos).post(clone_repo).patch(switch_branch))
}

/// Parse git clone error output and return a user-friendly message
fn parse_git_clone_error(stderr: &str, exit_code: Option<i32>) -> String {
    let stderr_lower = stderr.to_lowercase();

    // Auth errors
    if stderr_lower.contains("authentication failed")
        || stderr_lower.contains("could not read username")
        || stderr_lower.contains("could not read password")
        || stderr_lower.contains("terminal prompts disabled")
    {
        return "Git credentials not configured. Set up a credential manager or use SSH."
            .to_string();
    }

    // SSH auth errors
    if stderr_lower.contains("permission denied (publickey)")
        || stderr_lower.contains("host key verification failed")
    {
        return "SSH key not configured. Set up SSH keys or switch to HTTPS.".to_string();
    }

    // Repository not found
    if stderr_lower.contains("repository") && stderr_lower.contains("not found") {
        return "Repository not found or you don't have access.".to_string();
    }

    // HTTP errors
    if stderr_lower.contains("the requested url returned error: 401")
        || stderr_lower.contains("the requested url returned error: 403")
    {
        return "Access denied. Check your credentials or repository permissions.".to_string();
    }

    if stderr_lower.contains("the requested url returned error: 404") {
        return "Repository not found. Check the URL and your access permissions.".to_string();
    }

    // Network errors
    if stderr_lower.contains("could not resolve host")
        || stderr_lower.contains("network is unreachable")
        || stderr_lower.contains("connection refused")
    {
        return "Network error. Check your internet connection.".to_string();
    }

    // SSL/TLS errors
    if stderr_lower.contains("ssl certificate problem") {
        return "SSL certificate error. Check your network or proxy settings.".to_string();
    }

    // If we have stderr content, extract the "fatal:" line
    if let Some(fatal_line) = stderr.lines().find(|l| l.starts_with("fatal:")) {
        return format!(
            "Clone failed: {}",
            fatal_line.trim_start_matches("fatal:").trim()
        );
    }

    // Fallback: include stderr content if available
    if !stderr.trim().is_empty() {
        let first_line = stderr.lines().next().unwrap_or("").trim();
        if !first_line.is_empty() {
            return format!("Clone failed: {first_line}");
        }
    }

    // Last resort: just show the exit code
    format!("Clone failed with exit code {}", exit_code.unwrap_or(-1))
}

#[derive(Debug, Deserialize)]
struct CloneRequest {
    url: Option<String>,
}

async fn clone_repo(
    Json(body): Json<CloneRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
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
        .map_err(|e| ServerError::Internal(format!("Failed to create base dir: {e}")))?;

    let target_dir = base_dir.join(&repo_name);
    let target_str = target_dir.to_string_lossy().to_string();

    if target_dir.exists() {
        // Already cloned — pull latest
        tokio::task::spawn_blocking({
            let target_str = target_str.clone();
            move || {
                let _ = git::git_command()
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

    let output = tokio::task::spawn_blocking({
        let clone_url = clone_url.clone();
        let target = target_dir_str.clone();
        move || {
            git::git_command()
                .args(["clone", "--depth", "1", &clone_url, &target])
                .output()
        }
    })
    .await
    .map_err(|e| ServerError::Internal(e.to_string()))?
    .map_err(|e| ServerError::Internal(format!("Clone failed: {e}")))?;

    // Check if clone succeeded
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let error_msg = parse_git_clone_error(&stderr, output.status.code());
        return Err(ServerError::Internal(error_msg));
    }

    // Fetch all branches
    let _ = tokio::task::spawn_blocking({
        let ts = target_str.clone();
        move || {
            let _ = git::git_command()
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

#[cfg(test)]
mod tests {
    use super::parse_git_clone_error;

    #[test]
    fn parse_git_clone_error_maps_auth_and_network_failures() {
        let auth = parse_git_clone_error("fatal: Authentication failed", Some(128));
        assert!(auth.contains("Git credentials not configured"));

        let ssh = parse_git_clone_error("Permission denied (publickey).", Some(128));
        assert!(ssh.contains("SSH key not configured"));

        let network = parse_git_clone_error("fatal: Could not resolve host: github.com", Some(128));
        assert!(network.contains("Network error"));
    }

    #[test]
    fn parse_git_clone_error_prefers_fatal_line_and_fallback() {
        let fatal = parse_git_clone_error(
            "warning: x\nfatal: repository 'https://x' not found\n",
            Some(128),
        );
        assert!(fatal.contains("Repository not found"));

        let generic = parse_git_clone_error("unexpected failure happened", Some(42));
        assert_eq!(generic, "Clone failed: unexpected failure happened");

        let code_only = parse_git_clone_error("", Some(7));
        assert_eq!(code_only, "Clone failed with exit code 7");
    }
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
            "Failed to checkout branch '{branch}'"
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
