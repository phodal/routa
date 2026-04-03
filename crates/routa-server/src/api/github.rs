//! GitHub Virtual Workspace API - /api/github
//!
//! Provides in-memory virtual file system for GitHub repos.
//! In the web (Next.js) backend these are backed by a full download+cache layer.
//! In the Rust desktop backend we provide the same REST surface but route calls
//! through git clone/local checkout (if available) or return helpful stubs.
//!
//! GET    /api/github              - List active imported GitHub workspaces
//! POST   /api/github/import       - Import a GitHub repo as a virtual workspace
//! GET    /api/github/tree         - Get file tree for an imported repo
//! GET    /api/github/file         - Read a file from an imported repo
//! GET    /api/github/search       - Search files in an imported repo

use axum::{
    extract::{Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;

use crate::api::tasks_github::{list_github_issues, resolve_github_repo_for_codebase};
use crate::error::ServerError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_workspaces))
        .route("/import", post(import_repo))
        .route("/issues", get(list_issues))
        .route("/tree", get(get_tree))
        .route("/file", get(get_file))
        .route("/search", get(search_files))
        .route("/pr-comment", post(post_pr_comment))
}

// ─── List workspaces ─────────────────────────────────────────────────────────

async fn list_workspaces() -> Json<serde_json::Value> {
    // Desktop mode: no in-memory cache yet — return empty list.
    Json(serde_json::json!({ "workspaces": [] }))
}

// ─── Import ──────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ImportRequest {
    owner: Option<String>,
    repo: Option<String>,
    #[serde(rename = "ref")]
    git_ref: Option<String>,
    url: Option<String>,
}

async fn import_repo(Json(body): Json<ImportRequest>) -> Json<serde_json::Value> {
    // Resolve owner/repo from either explicit fields or the `url` shorthand.
    let (owner, repo) = if let (Some(owner), Some(repo)) = (&body.owner, &body.repo) {
        (owner.clone(), repo.clone())
    } else if let Some(url) = &body.url {
        // Parse "https://github.com/owner/repo" or "owner/repo"
        let stripped = url
            .trim_start_matches("https://github.com/")
            .trim_start_matches("http://github.com/");
        let parts: Vec<&str> = stripped.splitn(2, '/').collect();
        if parts.len() == 2 {
            (parts[0].to_string(), parts[1].to_string())
        } else {
            return Json(serde_json::json!({
                "error": "Invalid GitHub URL. Expected: https://github.com/owner/repo or owner/repo",
                "code": "BAD_REQUEST"
            }));
        }
    } else {
        return Json(serde_json::json!({
            "error": "Missing 'owner' and 'repo' fields (or provide 'url')",
            "code": "BAD_REQUEST"
        }));
    };

    let git_ref = body.git_ref.as_deref().unwrap_or("HEAD");

    // In the desktop backend, GitHub import is not yet implemented.
    // Clients should use the local git clone API instead.
    Json(serde_json::json!({
        "error": "GitHub virtual workspace import is not available in desktop mode. Use POST /api/clone to work with local repositories.",
        "code": "NOT_IMPLEMENTED",
        "hint": {
            "owner": owner,
            "repo": repo,
            "ref": git_ref,
            "alternative": "/api/clone"
        }
    }))
}

// ─── Shared query params ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct RepoQuery {
    owner: Option<String>,
    repo: Option<String>,
    #[serde(rename = "ref")]
    git_ref: Option<String>,
}

fn not_imported(owner: &str, repo: &str) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "error": format!(
            "Workspace not imported. POST /api/github/import first for {}/{}",
            owner, repo
        ),
        "code": "NOT_FOUND"
    }))
}

// ─── Tree ────────────────────────────────────────────────────────────────────

async fn get_tree(Query(q): Query<RepoQuery>) -> Json<serde_json::Value> {
    let owner = q.owner.as_deref().unwrap_or("");
    let repo = q.repo.as_deref().unwrap_or("");
    if owner.is_empty() || repo.is_empty() {
        return Json(serde_json::json!({
            "error": "Missing 'owner' and 'repo' query parameters",
            "code": "BAD_REQUEST"
        }));
    }
    not_imported(owner, repo)
}

// ─── File ────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct FileQuery {
    owner: Option<String>,
    repo: Option<String>,
    path: Option<String>,
    #[serde(rename = "ref")]
    _git_ref: Option<String>,
}

async fn get_file(Query(q): Query<FileQuery>) -> Json<serde_json::Value> {
    let owner = q.owner.as_deref().unwrap_or("");
    let repo = q.repo.as_deref().unwrap_or("");
    if owner.is_empty() || repo.is_empty() || q.path.is_none() {
        return Json(serde_json::json!({
            "error": "Missing 'owner', 'repo', or 'path' query parameters",
            "code": "BAD_REQUEST"
        }));
    }
    not_imported(owner, repo)
}

// ─── Search ──────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct SearchQuery {
    owner: Option<String>,
    repo: Option<String>,
    q: Option<String>,
    #[serde(rename = "ref")]
    _git_ref: Option<String>,
    limit: Option<usize>,
}

async fn search_files(Query(q): Query<SearchQuery>) -> Json<serde_json::Value> {
    let owner = q.owner.as_deref().unwrap_or("");
    let repo = q.repo.as_deref().unwrap_or("");
    if owner.is_empty() || repo.is_empty() {
        return Json(serde_json::json!({
            "error": "Missing 'owner' and 'repo' query parameters",
            "code": "BAD_REQUEST"
        }));
    }
    // Return empty results rather than a hard error so callers can degrade gracefully.
    Json(serde_json::json!({
        "files": [],
        "total": 0,
        "query": q.q.as_deref().unwrap_or(""),
        "note": "GitHub virtual workspaces are not available in desktop mode."
    }))
}

// ─── Issues ──────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueQuery {
    workspace_id: Option<String>,
    codebase_id: Option<String>,
    state: Option<String>,
}

async fn list_issues(
    State(state): State<AppState>,
    Query(q): Query<IssueQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspace_id = q
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("workspaceId is required".to_string()))?;
    let state_filter = match q.state.as_deref().unwrap_or("open") {
        "open" | "closed" | "all" => q.state.as_deref().unwrap_or("open"),
        _ => {
            return Err(ServerError::BadRequest(
                "state must be one of: open, closed, all".to_string(),
            ))
        }
    };

    let workspace_codebases = state.codebase_store.list_by_workspace(workspace_id).await?;
    if workspace_codebases.is_empty() {
        return Err(ServerError::NotFound(
            "No codebases linked to this workspace".to_string(),
        ));
    }

    let codebase = match q.codebase_id.as_deref() {
        Some(codebase_id) => workspace_codebases
            .iter()
            .find(|item| item.id == codebase_id)
            .cloned(),
        None => workspace_codebases
            .iter()
            .find(|item| item.is_default)
            .cloned()
            .or_else(|| workspace_codebases.first().cloned()),
    }
    .ok_or_else(|| ServerError::NotFound("Codebase not found in this workspace".to_string()))?;

    let repo = resolve_github_repo_for_codebase(
        codebase.source_url.as_deref(),
        Some(codebase.repo_path.as_str()),
    )
    .ok_or_else(|| {
        ServerError::BadRequest(
            "Selected codebase is not linked to a GitHub repository.".to_string(),
        )
    })?;

    let issues = list_github_issues(&repo, Some(state_filter), Some(50))
        .await
        .map_err(ServerError::Internal)?;

    Ok(Json(serde_json::json!({
        "repo": repo,
        "codebase": {
            "id": codebase.id,
            "label": codebase.label.clone().unwrap_or_else(|| {
                std::path::Path::new(&codebase.repo_path)
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or(&codebase.repo_path)
                    .to_string()
            }),
        },
        "issues": issues,
    })))
}

// ─── PR Comment ───────────────────────────────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
struct PrCommentRequest {
    owner: Option<String>,
    repo: Option<String>,
    #[serde(rename = "prNumber")]
    pr_number: Option<u64>,
    body: Option<String>,
}

/// POST /api/github/pr-comment — Post a comment on a GitHub pull request
async fn post_pr_comment(Json(body): Json<PrCommentRequest>) -> Json<serde_json::Value> {
    let owner = body.owner.as_deref().unwrap_or("");
    let repo = body.repo.as_deref().unwrap_or("");
    let pr_number = body.pr_number.unwrap_or(0);

    if owner.is_empty() || repo.is_empty() || pr_number == 0 || body.body.is_none() {
        return Json(serde_json::json!({
            "error": "Missing required fields: owner, repo, prNumber, body",
            "code": "BAD_REQUEST"
        }));
    }

    // Desktop mode: GitHub API calls require a token and HTTP access.
    Json(serde_json::json!({
        "error": "GitHub PR comments are not available in desktop mode. Configure GITHUB_TOKEN and use the web backend.",
        "code": "NOT_IMPLEMENTED",
        "hint": {
            "owner": owner,
            "repo": repo,
            "prNumber": pr_number,
        }
    }))
}
