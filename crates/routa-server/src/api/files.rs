//! File Search API - /api/files/search
//!
//! GET /api/files/search?q=query&repoPath=/path/to/repo&limit=20
//!   Search files in a repository using fuzzy matching

use axum::{extract::Query, routing::get, Json, Router};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::error::ServerError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/search", get(search_files))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchQuery {
    q: Option<String>,
    repo_path: Option<String>,
    limit: Option<usize>,
}

#[derive(Debug, Serialize)]
struct FileMatch {
    path: String,
    #[serde(rename = "fullPath")]
    full_path: String,
    name: String,
    score: i32,
}

#[derive(Debug, Serialize)]
struct SearchResult {
    files: Vec<FileMatch>,
    total: usize,
    query: String,
    scanned: usize,
}

const IGNORE_PATTERNS: &[&str] = &[
    "node_modules", ".git", ".next", "dist", "build", ".cache",
    "coverage", ".turbo", "target", "__pycache__", ".venv", "venv",
];

fn fuzzy_match(query: &str, target: &str) -> i32 {
    let query_lower = query.to_lowercase();
    let target_lower = target.to_lowercase();

    if target_lower == query_lower { return 1000; }
    if target_lower.contains(&query_lower) {
        let file_name = Path::new(&target_lower)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if file_name.starts_with(&query_lower) { return 900; }
        if file_name.contains(&query_lower) { return 800; }
        return 700;
    }

    let mut score = 0i32;
    let mut query_idx = 0;
    let mut consecutive_bonus = 0i32;
    let query_chars: Vec<char> = query_lower.chars().collect();

    for c in target_lower.chars() {
        if query_idx < query_chars.len() && c == query_chars[query_idx] {
            score += 10 + consecutive_bonus;
            consecutive_bonus += 5;
            query_idx += 1;
        } else {
            consecutive_bonus = 0;
        }
    }

    if query_idx < query_chars.len() { return 0; }
    score += (100 - target.len() as i32).max(0);
    score
}

fn should_ignore(name: &str) -> bool {
    IGNORE_PATTERNS.iter().any(|p| name == *p)
}

fn walk_directory(dir: &Path, root: &Path, max_files: usize) -> Vec<String> {
    let mut files = Vec::new();
    walk_recursive(dir, root, &mut files, max_files);
    files
}

fn walk_recursive(dir: &Path, root: &Path, files: &mut Vec<String>, max_files: usize) {
    if files.len() >= max_files { return; }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if files.len() >= max_files { return; }
        let name = entry.file_name().to_string_lossy().to_string();
        if should_ignore(&name) { continue; }
        let path = entry.path();
        if path.is_dir() {
            walk_recursive(&path, root, files, max_files);
        } else if path.is_file() {
            if let Ok(rel) = path.strip_prefix(root) {
                files.push(rel.to_string_lossy().to_string());
            }
        }
    }
}

async fn search_files(Query(params): Query<SearchQuery>) -> Result<Json<SearchResult>, ServerError> {
    let query = params.q.unwrap_or_default();
    let repo_path = params.repo_path
        .ok_or_else(|| ServerError::BadRequest("Missing repoPath parameter".into()))?;
    let limit = params.limit.unwrap_or(20);

    let repo_dir = PathBuf::from(&repo_path);
    if !repo_dir.exists() {
        return Err(ServerError::NotFound("Repository path does not exist".into()));
    }

    let files = tokio::task::spawn_blocking({
        let repo_dir = repo_dir.clone();
        move || walk_directory(&repo_dir, &repo_dir, 10000)
    }).await.map_err(|e| ServerError::Internal(e.to_string()))?;

    let scanned = files.len();

    if query.trim().is_empty() {
        let default_files: Vec<FileMatch> = files.into_iter().take(limit).map(|file_path| {
            let full_path = repo_dir.join(&file_path).to_string_lossy().to_string();
            let name = Path::new(&file_path).file_name()
                .map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| file_path.clone());
            FileMatch { path: file_path, full_path, name, score: 0 }
        }).collect();
        return Ok(Json(SearchResult { files: default_files, total: scanned, query: String::new(), scanned }));
    }

    let mut scored: Vec<FileMatch> = files.into_iter().filter_map(|file_path| {
        let score = fuzzy_match(&query, &file_path);
        if score > 0 {
            let full_path = repo_dir.join(&file_path).to_string_lossy().to_string();
            let name = Path::new(&file_path).file_name()
                .map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| file_path.clone());
            Some(FileMatch { path: file_path, full_path, name, score })
        } else { None }
    }).collect();

    scored.sort_by(|a, b| b.score.cmp(&a.score));
    let total = scored.len();
    scored.truncate(limit);

    Ok(Json(SearchResult { files: scored, total, query, scanned }))
}

