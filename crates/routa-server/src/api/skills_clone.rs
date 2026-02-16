//! Skill Clone API - /api/skills/clone
//!
//! POST /api/skills/clone - Clone a skill repo and import skills
//! GET  /api/skills/clone?repoPath=... - Discover skills from a path

use axum::{extract::Query, routing::get, Json, Router};
use serde::Deserialize;
use std::path::Path;

use crate::error::ServerError;
use crate::git;
use crate::state::AppState;

const LOCAL_SKILLS_DIR: &str = ".agents/skills";

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(discover_skills).post(clone_skills))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloneSkillsRequest {
    url: Option<String>,
    #[allow(dead_code)]
    skills_dir: Option<String>,
}

async fn clone_skills(
    Json(body): Json<CloneSkillsRequest>,
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
        .map_err(|e| ServerError::Internal(format!("Failed to create base dir: {}", e)))?;
    let target_dir = base_dir.join(&repo_name);
    let target_str = target_dir.to_string_lossy().to_string();

    // Clone or pull
    let target_path = target_dir.clone();
    tokio::task::spawn_blocking(move || {
        if target_path.exists() {
            let _ = std::process::Command::new("git")
                .args(["pull", "--ff-only"])
                .current_dir(&target_path)
                .output();
        } else {
            let clone_url = format!(
                "https://github.com/{}/{}.git",
                parsed.owner, parsed.repo
            );
            let _ = std::process::Command::new("git")
                .args([
                    "clone",
                    "--depth",
                    "1",
                    &clone_url,
                    &target_path.to_string_lossy(),
                ])
                .output();
        }
    })
    .await
    .map_err(|e| ServerError::Internal(e.to_string()))?;

    // Discover skills
    let discovered = git::discover_skills_from_path(&target_dir);

    if discovered.is_empty() {
        return Err(ServerError::NotFound(format!(
            "No skills found in {}. Checked: skills/, .agents/skills/, .opencode/skills/, .claude/skills/",
            url
        )));
    }

    // Copy to local .agents/skills/
    let cwd = std::env::current_dir().unwrap_or_default();
    let local_skills_base = cwd.join(LOCAL_SKILLS_DIR);
    std::fs::create_dir_all(&local_skills_base)
        .map_err(|e| ServerError::Internal(format!("Failed to create skills dir: {}", e)))?;

    let mut imported = Vec::new();

    for skill in &discovered {
        let source_dir = Path::new(&skill.source)
            .parent()
            .unwrap_or(Path::new("."));
        let skill_target = local_skills_base.join(&skill.name);
        if let Err(e) = git::copy_dir_recursive(source_dir, &skill_target) {
            tracing::warn!("Failed to copy skill '{}': {}", skill.name, e);
            continue;
        }
        imported.push(skill.name.clone());
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "imported": imported,
        "count": imported.len(),
        "repoPath": target_str,
        "source": url,
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscoverQuery {
    repo_path: Option<String>,
}

async fn discover_skills(
    Query(query): Query<DiscoverQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let repo_path = query
        .repo_path
        .ok_or_else(|| ServerError::BadRequest("Missing 'repoPath' query parameter".into()))?;

    let rp = Path::new(&repo_path);
    if !rp.exists() {
        return Err(ServerError::NotFound(format!("Path not found: {}", repo_path)));
    }

    let discovered = git::discover_skills_from_path(rp);

    Ok(Json(serde_json::json!({
        "skills": discovered.iter().map(|s| serde_json::json!({
            "name": s.name,
            "description": s.description,
            "license": s.license,
            "compatibility": s.compatibility,
            "source": s.source,
        })).collect::<Vec<_>>(),
    })))
}
