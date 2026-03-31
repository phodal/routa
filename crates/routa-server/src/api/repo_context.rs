use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::error::ServerError;
use crate::git;
use crate::state::AppState;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoContextQuery {
    pub workspace_id: Option<String>,
    pub codebase_id: Option<String>,
    pub repo_path: Option<String>,
}

pub fn normalize_context_value(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

pub fn normalize_local_repo_path(value: &str) -> PathBuf {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return PathBuf::new();
    }

    if trimmed == "~" {
        if let Some(home) = dirs::home_dir() {
            return home;
        }
    }

    if let Some(suffix) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        if let Some(home) = dirs::home_dir() {
            return home.join(suffix);
        }
    }

    let candidate = PathBuf::from(trimmed);
    if candidate.is_absolute() {
        candidate
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(candidate)
    }
}

pub fn validate_local_git_repo_path(candidate: &Path) -> Result<(), ServerError> {
    if !candidate.exists() || !candidate.is_dir() {
        return Err(ServerError::BadRequest(format!(
            "Path does not exist or is not a directory: {}",
            candidate.display()
        )));
    }

    if !git::is_git_repository(&candidate.to_string_lossy()) {
        return Err(ServerError::BadRequest(format!(
            "Directory exists but is not a git repository: {}",
            candidate.display()
        )));
    }

    Ok(())
}



pub async fn resolve_repo_root(
    state: &AppState,
    workspace_id: Option<&str>,
    codebase_id: Option<&str>,
    repo_path: Option<&str>,
    missing_context_message: &str,
) -> Result<PathBuf, ServerError> {
    let workspace_id = normalize_context_value(workspace_id);
    let codebase_id = normalize_context_value(codebase_id);
    let repo_path = normalize_context_value(repo_path);

    if let Some(repo_path) = repo_path {
        let candidate = PathBuf::from(repo_path);
        validate_repo_path(&candidate, "repoPath ")?;
        return Ok(candidate);
    }

    if let Some(codebase_id) = codebase_id {
        let Some(codebase) = state.codebase_store.get(&codebase_id).await? else {
            return Err(ServerError::BadRequest(format!(
                "Codebase 未找到: {codebase_id}"
            )));
        };

        let candidate = PathBuf::from(&codebase.repo_path);
        validate_repo_path(&candidate, "Codebase 的路径")?;
        return Ok(candidate);
    }

    let Some(workspace_id) = workspace_id else {
        return Err(ServerError::BadRequest(missing_context_message.to_string()));
    };

    let codebases = state
        .codebase_store
        .list_by_workspace(&workspace_id)
        .await?;
    if codebases.is_empty() {
        return Err(ServerError::BadRequest(format!(
            "Workspace 下没有配置 codebase: {workspace_id}"
        )));
    }

    let fallback = codebases
        .iter()
        .find(|codebase| codebase.is_default)
        .unwrap_or(&codebases[0]);
    let candidate = PathBuf::from(&fallback.repo_path);
    validate_repo_path(&candidate, "默认 codebase 的路径")?;
    Ok(candidate)
}

fn validate_repo_path(candidate: &Path, label: &str) -> Result<(), ServerError> {
    if !candidate.exists() || !candidate.is_dir() {
        return Err(ServerError::BadRequest(format!(
            "{label}不存在或不是目录: {}",
            candidate.display()
        )));
    }
    Ok(())
}

pub fn extract_frontmatter(raw: &str) -> Option<(String, String)> {
    let mut lines = raw.lines();
    if lines.next()? != "---" {
        return None;
    }

    let mut frontmatter_lines = Vec::new();
    let mut body_lines = Vec::new();
    let mut in_frontmatter = true;

    for line in lines {
        if in_frontmatter && line == "---" {
            in_frontmatter = false;
            continue;
        }

        if in_frontmatter {
            frontmatter_lines.push(line);
        } else {
            body_lines.push(line);
        }
    }

    if in_frontmatter || frontmatter_lines.is_empty() {
        return None;
    }

    Some((frontmatter_lines.join("\n"), body_lines.join("\n")))
}

pub fn json_error(error: &str, details: impl Into<String>) -> serde_json::Value {
    serde_json::json!({
        "error": error,
        "details": details.into(),
    })
}

pub fn read_to_string(path: &Path) -> Result<String, ServerError> {
    fs::read_to_string(path).map_err(|error| {
        ServerError::Internal(format!("Failed to read {}: {}", path.display(), error))
    })
}
