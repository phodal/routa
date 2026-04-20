//! Skill catalog API — browse and install from multiple catalog sources.
//!
//! Supports:
//!   1. skills.sh (default) — search-based catalog
//!   2. github — directory-based catalog from GitHub repos
//!
//! GET  /api/skills/catalog?type=skillssh&q=react&limit=30
//! GET  /api/skills/catalog?type=github&repo=openai/skills&path=skills/.curated
//! POST /api/skills/catalog  { type: "skillssh"|"github", ... }

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;

use crate::error::ServerError;
use crate::state::AppState;

const SKILLS_SH_API: &str = "https://skills.sh";
const DEFAULT_GITHUB_REPO: &str = "openai/skills";
const DEFAULT_GITHUB_PATH: &str = "skills/.curated";
const DEFAULT_REF: &str = "main";

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(list_catalog).post(install_from_catalog))
}

// ── List / Search ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct CatalogQuery {
    #[serde(rename = "type")]
    catalog_type: Option<String>,
    q: Option<String>,
    limit: Option<u32>,
    repo: Option<String>,
    path: Option<String>,
    #[serde(rename = "ref")]
    git_ref: Option<String>,
}

#[derive(Debug, Serialize)]
struct SkillsShSkill {
    name: String,
    slug: String,
    source: String,
    installs: u64,
    installed: bool,
}

#[derive(Debug, Serialize)]
struct GithubCatalogSkill {
    name: String,
    installed: bool,
}

async fn list_catalog(
    Query(query): Query<CatalogQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let catalog_type = query.catalog_type.as_deref().unwrap_or("skillssh");

    match catalog_type {
        "skillssh" => handle_skillssh_search(&query).await,
        "github" => handle_github_list(&query).await,
        _ => Err(ServerError::BadRequest(format!(
            "Unknown catalog type: {catalog_type}. Use \"skillssh\" or \"github\"."
        ))),
    }
}

async fn handle_skillssh_search(
    query: &CatalogQuery,
) -> Result<Json<serde_json::Value>, ServerError> {
    let search_query = query.q.as_deref().unwrap_or("");
    let limit = query.limit.unwrap_or(30);

    let api_base = std::env::var("SKILLS_API_URL").unwrap_or_else(|_| SKILLS_SH_API.to_string());
    let api_url = format!(
        "{}/api/search?q={}&limit={}",
        api_base,
        urlencoding::encode(search_query),
        limit
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&api_url)
        .header("User-Agent", "routa-skill-catalog")
        .send()
        .await
        .map_err(|e| ServerError::Internal(format!("skills.sh API failed: {e}")))?;

    if !response.status().is_success() {
        return Err(ServerError::Internal(format!(
            "skills.sh API error: HTTP {}",
            response.status()
        )));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| ServerError::Internal(format!("Failed to parse response: {e}")))?;

    let installed = installed_skill_names();

    let skills: Vec<SkillsShSkill> = data
        .get("skills")
        .and_then(|s| s.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| {
                    let name = s.get("name")?.as_str()?.to_string();
                    let slug = s.get("id")?.as_str()?.to_string();
                    let source = s
                        .get("source")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let installs = s.get("installs").and_then(|v| v.as_u64()).unwrap_or(0);
                    Some(SkillsShSkill {
                        installed: installed.contains(&name),
                        name,
                        slug,
                        source,
                        installs,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let count = data
        .get("count")
        .and_then(|c| c.as_u64())
        .unwrap_or(skills.len() as u64);

    Ok(Json(serde_json::json!({
        "type": "skillssh",
        "skills": skills,
        "query": search_query,
        "count": count,
    })))
}

async fn handle_github_list(query: &CatalogQuery) -> Result<Json<serde_json::Value>, ServerError> {
    let repo = query.repo.as_deref().unwrap_or(DEFAULT_GITHUB_REPO);
    let catalog_path = query.path.as_deref().unwrap_or(DEFAULT_GITHUB_PATH);
    let git_ref = query.git_ref.as_deref().unwrap_or(DEFAULT_REF);

    let api_url =
        format!("https://api.github.com/repos/{repo}/contents/{catalog_path}?ref={git_ref}");

    let client = reqwest::Client::new();
    let mut req = client
        .get(&api_url)
        .header("User-Agent", "routa-skill-catalog")
        .header("Accept", "application/vnd.github.v3+json");

    if let Some(token) = github_token() {
        req = req.header("Authorization", format!("token {token}"));
    }

    let response = req
        .send()
        .await
        .map_err(|e| ServerError::Internal(format!("GitHub API request failed: {e}")))?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(ServerError::NotFound(format!(
            "Catalog not found: https://github.com/{repo}/tree/{git_ref}/{catalog_path}"
        )));
    }

    if !response.status().is_success() {
        return Err(ServerError::Internal(format!(
            "GitHub API error: HTTP {}",
            response.status()
        )));
    }

    let entries: Vec<serde_json::Value> = response
        .json()
        .await
        .map_err(|e| ServerError::Internal(format!("Failed to parse GitHub response: {e}")))?;

    let installed = installed_skill_names();

    let skills: Vec<GithubCatalogSkill> = entries
        .iter()
        .filter(|e| e.get("type").and_then(|t| t.as_str()) == Some("dir"))
        .filter_map(|e| e.get("name").and_then(|n| n.as_str()).map(String::from))
        .map(|name| GithubCatalogSkill {
            installed: installed.contains(&name),
            name,
        })
        .collect();

    Ok(Json(serde_json::json!({
        "type": "github",
        "skills": skills,
        "repo": repo,
        "path": catalog_path,
        "ref": git_ref,
    })))
}

// ── Install ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallRequest {
    #[serde(rename = "type")]
    catalog_type: Option<String>,
    // For skills.sh: array of {name, source}
    skills: serde_json::Value,
    // For github catalog
    repo: Option<String>,
    path: Option<String>,
    #[serde(rename = "ref")]
    git_ref: Option<String>,
}

async fn install_from_catalog(
    State(_state): State<AppState>,
    Json(body): Json<InstallRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let catalog_type = body.catalog_type.as_deref().unwrap_or("skillssh");

    match catalog_type {
        "skillssh" => install_from_skillssh(&body).await,
        "github" => install_from_github(&body).await,
        _ => Err(ServerError::BadRequest(format!(
            "Unknown catalog type: {catalog_type}"
        ))),
    }
}

/// Install skills from skills.sh — each skill has its own source repo.
async fn install_from_skillssh(
    body: &InstallRequest,
) -> Result<Json<serde_json::Value>, ServerError> {
    let skills: Vec<SkillInstallItem> = serde_json::from_value(body.skills.clone())
        .map_err(|e| ServerError::BadRequest(format!("Invalid skills array: {e}")))?;

    if skills.is_empty() {
        return Err(ServerError::BadRequest("Empty skills array".into()));
    }

    let dest_base = dest_skills_dir();
    let mut installed = Vec::new();
    let mut errors = Vec::new();

    // Group by source repo
    let mut by_repo: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for skill in &skills {
        by_repo
            .entry(skill.source.clone())
            .or_default()
            .push(skill.name.clone());
    }

    for (repo_source, skill_names) in &by_repo {
        match download_and_install_skills(repo_source, skill_names, None, &dest_base).await {
            Ok((ok, err)) => {
                installed.extend(ok);
                errors.extend(err);
            }
            Err(e) => errors.push(format!("Failed for {repo_source}: {e}")),
        }
    }

    Ok(Json(serde_json::json!({
        "success": !installed.is_empty(),
        "installed": installed,
        "errors": errors,
        "dest": dest_base.to_string_lossy(),
    })))
}

/// Install skills from a GitHub repo directory catalog.
async fn install_from_github(
    body: &InstallRequest,
) -> Result<Json<serde_json::Value>, ServerError> {
    let skill_names: Vec<String> = serde_json::from_value(body.skills.clone())
        .map_err(|e| ServerError::BadRequest(format!("Invalid skills array: {e}")))?;

    if skill_names.is_empty() {
        return Err(ServerError::BadRequest("Empty skills array".into()));
    }

    let repo = body.repo.as_deref().unwrap_or(DEFAULT_GITHUB_REPO);
    let catalog_path = body.path.as_deref().unwrap_or(DEFAULT_GITHUB_PATH);
    let _git_ref = body.git_ref.as_deref().unwrap_or(DEFAULT_REF);

    let dest_base = dest_skills_dir();

    match download_and_install_skills(repo, &skill_names, Some(catalog_path), &dest_base).await {
        Ok((installed, errors)) => Ok(Json(serde_json::json!({
            "success": !installed.is_empty(),
            "installed": installed,
            "errors": errors,
            "dest": dest_base.to_string_lossy(),
        }))),
        Err(e) => Err(ServerError::Internal(e)),
    }
}

#[derive(Debug, Deserialize)]
struct SkillInstallItem {
    name: String,
    source: String,
}

/// Download a repo zip and install specific skills from it.
async fn download_and_install_skills(
    repo: &str,
    skill_names: &[String],
    catalog_path: Option<&str>,
    dest_base: &std::path::Path,
) -> Result<(Vec<String>, Vec<String>), String> {
    let parts: Vec<&str> = repo.split('/').collect();
    if parts.len() != 2 {
        return Err(format!("Invalid repo: {repo}"));
    }
    let (owner, repo_name) = (parts[0], parts[1]);

    let git_ref = "main";
    let zip_url = format!("https://codeload.github.com/{owner}/{repo_name}/zip/{git_ref}");

    let client = reqwest::Client::new();
    let mut req = client
        .get(&zip_url)
        .header("User-Agent", "routa-skill-install");

    if let Some(token) = github_token() {
        req = req.header("Authorization", format!("token {token}"));
    }

    let response = req
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let zip_bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Read failed: {e}"))?;

    let tmp_dir = tempfile::tempdir().map_err(|e| format!("Temp dir: {e}"))?;

    let cursor = std::io::Cursor::new(&zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("Zip: {e}"))?;
    archive
        .extract(tmp_dir.path())
        .map_err(|e| format!("Extract: {e}"))?;

    let top_dirs: Vec<_> = std::fs::read_dir(tmp_dir.path())
        .map_err(|e| format!("Read: {e}"))?
        .flatten()
        .filter(|e| e.path().is_dir())
        .collect();

    if top_dirs.len() != 1 {
        return Err("Unexpected archive layout".into());
    }

    let repo_root = top_dirs[0].path();
    std::fs::create_dir_all(dest_base).ok();

    let search_dirs = [
        "skills",
        ".agents/skills",
        ".opencode/skills",
        ".claude/skills",
        ".codex/skills",
    ];

    let mut installed = Vec::new();
    let mut errors = Vec::new();

    for skill_name in skill_names {
        let dest_dir = dest_base.join(skill_name);
        if dest_dir.exists() {
            errors.push(format!("Already installed: {skill_name}"));
            continue;
        }

        let mut found_src = None;

        // If catalog_path specified, check there first
        if let Some(cp) = catalog_path {
            let candidate = repo_root.join(cp).join(skill_name);
            if candidate.is_dir() && candidate.join("SKILL.md").is_file() {
                found_src = Some(candidate);
            }
        }

        // Search common locations
        if found_src.is_none() {
            for dir in &search_dirs {
                let candidate = repo_root.join(dir).join(skill_name);
                if candidate.is_dir() && candidate.join("SKILL.md").is_file() {
                    found_src = Some(candidate);
                    break;
                }
            }
        }

        match found_src {
            Some(src) => match routa_core::git::copy_dir_recursive(&src, &dest_dir) {
                Ok(_) => installed.push(skill_name.clone()),
                Err(e) => errors.push(format!("Copy {skill_name}: {e}")),
            },
            None => errors.push(format!("Not found: {skill_name}")),
        }
    }

    Ok((installed, errors))
}

fn dest_skills_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".codex/skills"))
        .unwrap_or_else(|| PathBuf::from(".codex/skills"))
}

// ── Helpers ─────────────────────────────────────────────────────────────

fn github_token() -> Option<String> {
    std::env::var("GITHUB_TOKEN")
        .ok()
        .or_else(|| std::env::var("GH_TOKEN").ok())
}

fn installed_skill_names() -> HashSet<String> {
    let mut names = HashSet::new();

    let dirs_to_check: Vec<PathBuf> = vec![
        dirs::home_dir()
            .map(|h| h.join(".codex/skills"))
            .unwrap_or_default(),
        dirs::home_dir()
            .map(|h| h.join(".agents/skills"))
            .unwrap_or_default(),
    ];

    for dir in dirs_to_check {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    if let Some(name) = entry.file_name().to_str() {
                        names.insert(name.to_string());
                    }
                }
            }
        }
    }

    names
}
