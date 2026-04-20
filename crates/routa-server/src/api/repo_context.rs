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

pub fn validate_repo_path(candidate: &Path, label: &str) -> Result<(), ServerError> {
    if !candidate.exists() || !candidate.is_dir() {
        return Err(ServerError::BadRequest(format!(
            "{label}不存在或不是目录: {}",
            candidate.display()
        )));
    }

    Ok(())
}

pub fn resolve_existing_repo_dir(value: &str) -> Option<PathBuf> {
    let candidate = normalize_local_repo_path(value);
    if candidate.exists() && candidate.is_dir() {
        Some(candidate)
    } else {
        None
    }
}

pub fn resolve_repo_dir_or_error(value: &str, label: &str) -> Result<PathBuf, ServerError> {
    let candidate = normalize_local_repo_path(value);
    validate_repo_path(&candidate, label)?;
    Ok(candidate)
}

pub fn canonical_repo_path_for_response(value: &str) -> String {
    resolve_existing_repo_dir(value)
        .unwrap_or_else(|| normalize_local_repo_path(value))
        .to_string_lossy()
        .to_string()
}

pub fn validate_local_git_repo_path(candidate: &Path) -> Result<(), ServerError> {
    validate_repo_path(candidate, "Path ")?;

    if !git::is_git_repository(&candidate.to_string_lossy()) {
        return Err(ServerError::BadRequest(format!(
            "Directory exists but is not a git repository: {}",
            candidate.display()
        )));
    }

    if git::is_bare_git_repository(&candidate.to_string_lossy()) {
        return Err(ServerError::BadRequest(
            "Cannot add a bare git repository as a codebase".to_string(),
        ));
    }

    Ok(())
}

#[derive(Debug, Default, Clone, Copy)]
pub struct ResolveRepoRootOptions {
    pub prefer_current_repo_for_default_workspace: bool,
}

pub fn is_routa_repo_root(candidate: &Path) -> bool {
    candidate
        .join("docs/fitness/harness-fluency.model.yaml")
        .exists()
        && candidate.join("crates/routa-cli").is_dir()
}

fn current_routa_repo_root_from(candidate: &Path) -> Option<PathBuf> {
    if is_routa_repo_root(candidate) {
        Some(candidate.to_path_buf())
    } else {
        None
    }
}

pub fn get_current_routa_repo_root() -> Option<PathBuf> {
    let candidate = std::env::current_dir().ok()?;
    current_routa_repo_root_from(&candidate)
}

pub async fn resolve_repo_root(
    state: &AppState,
    workspace_id: Option<&str>,
    codebase_id: Option<&str>,
    repo_path: Option<&str>,
    missing_context_message: &str,
    options: ResolveRepoRootOptions,
) -> Result<PathBuf, ServerError> {
    let workspace_id = normalize_context_value(workspace_id);
    let codebase_id = normalize_context_value(codebase_id);
    let repo_path = normalize_context_value(repo_path);
    let mut direct_repo_error = None;

    if let Some(repo_path) = repo_path {
        match resolve_repo_dir_or_error(&repo_path, "repoPath ") {
            Ok(candidate) => return Ok(candidate),
            Err(error) => direct_repo_error = Some(error),
        }
    }

    if let Some(codebase_id) = codebase_id {
        let Some(codebase) = state.codebase_store.get(&codebase_id).await? else {
            return Err(ServerError::BadRequest(format!(
                "Codebase 未找到: {codebase_id}"
            )));
        };

        let candidate = resolve_repo_dir_or_error(&codebase.repo_path, "Codebase 的路径")?;
        return Ok(candidate);
    }

    let Some(workspace_id) = workspace_id else {
        return Err(direct_repo_error
            .unwrap_or_else(|| ServerError::BadRequest(missing_context_message.to_string())));
    };

    if options.prefer_current_repo_for_default_workspace && workspace_id == "default" {
        if let Some(current_repo_root) = get_current_routa_repo_root() {
            return Ok(current_repo_root);
        }
    }

    let codebases = state
        .codebase_store
        .list_by_workspace(&workspace_id)
        .await?;
    if codebases.is_empty() {
        return Err(ServerError::BadRequest(format!(
            "Workspace 下没有配置 codebase: {workspace_id}"
        )));
    }

    let preferred_codebase_ids = codebases
        .iter()
        .filter(|codebase| codebase.is_default)
        .map(|codebase| codebase.id.clone())
        .chain(
            codebases
                .iter()
                .filter(|codebase| !codebase.is_default)
                .map(|codebase| codebase.id.clone()),
        )
        .collect::<Vec<_>>();

    for codebase_id in preferred_codebase_ids {
        let Some(codebase) = codebases
            .iter()
            .find(|candidate| candidate.id == codebase_id)
        else {
            continue;
        };
        if let Some(candidate) = resolve_existing_repo_dir(&codebase.repo_path) {
            return Ok(candidate);
        }
    }

    let fallback = codebases
        .iter()
        .find(|codebase| codebase.is_default)
        .unwrap_or(&codebases[0]);
    Err(direct_repo_error.unwrap_or_else(|| {
        ServerError::BadRequest(format!(
            "默认 codebase 的路径不存在或不是目录: {}",
            normalize_local_repo_path(&fallback.repo_path).display()
        ))
    }))
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

#[cfg(test)]
mod tests {
    use super::{current_routa_repo_root_from, is_routa_repo_root};

    #[test]
    fn detects_routa_repo_root_from_markers() {
        let temp = tempfile::tempdir().expect("tempdir should exist");
        std::fs::create_dir_all(temp.path().join("docs/fitness"))
            .expect("fitness dir should exist");
        std::fs::create_dir_all(temp.path().join("crates/routa-cli"))
            .expect("routa-cli dir should exist");
        std::fs::write(
            temp.path().join("docs/fitness/harness-fluency.model.yaml"),
            "version: 1\n",
        )
        .expect("marker file should exist");

        assert!(is_routa_repo_root(temp.path()));
        assert_eq!(
            current_routa_repo_root_from(temp.path()),
            Some(temp.path().to_path_buf())
        );
    }

    #[test]
    fn ignores_non_routa_repo_roots() {
        let temp = tempfile::tempdir().expect("tempdir should exist");

        assert!(!is_routa_repo_root(temp.path()));
        assert_eq!(current_routa_repo_root_from(temp.path()), None);
    }
}
