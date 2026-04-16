use std::path::PathBuf;

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::repo_context::{
    extract_frontmatter, resolve_repo_root, ResolveRepoRootOptions,
};
use crate::error::ServerError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/issues", get(list_spec_issues))
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpecIssuesQuery {
    workspace_id: Option<String>,
    codebase_id: Option<String>,
    repo_path: Option<String>,
}

async fn list_spec_issues(
    State(state): State<AppState>,
    Query(query): Query<SpecIssuesQuery>,
) -> Result<Json<Value>, ServerError> {
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "Missing context: provide workspaceId, codebaseId, or repoPath",
        ResolveRepoRootOptions {
            prefer_current_repo_for_default_workspace: true,
        },
    )
    .await?;

    let issues_dir = repo_root.join("docs").join("issues");
    if !issues_dir.is_dir() {
        return Ok(Json(json!({
            "issues": [],
            "repoRoot": repo_root.to_string_lossy(),
        })));
    }

    let mut entries: Vec<PathBuf> = std::fs::read_dir(&issues_dir)
        .map_err(|e| ServerError::Internal(format!("Failed to read issues dir: {e}")))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".md") && name != "_template.md" && entry.file_type().ok()?.is_file()
            {
                Some(entry.path())
            } else {
                None
            }
        })
        .collect();

    entries.sort_by(|a, b| {
        let a_name = a.file_name().unwrap_or_default().to_string_lossy();
        let b_name = b.file_name().unwrap_or_default().to_string_lossy();
        b_name.cmp(&a_name)
    });

    let mut issues = Vec::new();
    for entry_path in &entries {
        let raw = match std::fs::read_to_string(entry_path) {
            Ok(content) => content,
            Err(_) => continue,
        };

        let filename = entry_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let (frontmatter_str, body) = match extract_frontmatter(&raw) {
            Some(pair) => pair,
            None => continue,
        };

        let fm: serde_yaml::Value = match serde_yaml::from_str(&frontmatter_str) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let str_field = |key: &str| -> String {
            fm.get(key)
                .and_then(serde_yaml::Value::as_str)
                .unwrap_or("")
                .to_string()
        };

        let str_field_or = |key: &str, default: &str| -> String {
            let v = str_field(key);
            if v.is_empty() {
                default.to_string()
            } else {
                v
            }
        };

        let tags: Vec<String> = fm
            .get("tags")
            .and_then(serde_yaml::Value::as_sequence)
            .map(|seq| {
                seq.iter()
                    .filter_map(serde_yaml::Value::as_str)
                    .map(ToString::to_string)
                    .collect()
            })
            .unwrap_or_default();

        let related_issues: Vec<String> = fm
            .get("related_issues")
            .and_then(serde_yaml::Value::as_sequence)
            .map(|seq| {
                seq.iter()
                    .filter_map(serde_yaml::Value::as_str)
                    .map(ToString::to_string)
                    .collect()
            })
            .unwrap_or_default();

        let github_issue = fm
            .get("github_issue")
            .and_then(serde_yaml::Value::as_u64)
            .map(|v| Value::Number(v.into()));

        let github_state = fm
            .get("github_state")
            .and_then(serde_yaml::Value::as_str)
            .map(|s| Value::String(s.to_string()));

        let github_url = fm
            .get("github_url")
            .and_then(serde_yaml::Value::as_str)
            .map(|s| Value::String(s.to_string()));

        let title_fallback = filename.trim_end_matches(".md").to_string();

        issues.push(json!({
            "filename": filename,
            "title": str_field_or("title", &title_fallback),
            "date": str_field("date"),
            "kind": str_field_or("kind", "issue"),
            "status": str_field_or("status", "open"),
            "severity": str_field_or("severity", "medium"),
            "area": str_field("area"),
            "tags": tags,
            "reportedBy": str_field("reported_by"),
            "relatedIssues": related_issues,
            "githubIssue": github_issue,
            "githubState": github_state,
            "githubUrl": github_url,
            "body": body.trim(),
        }));
    }

    Ok(Json(json!({
        "issues": issues,
        "repoRoot": repo_root.to_string_lossy(),
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn parses_issue_frontmatter() {
        let temp = tempfile::tempdir().unwrap();
        let issues_dir = temp.path().join("docs").join("issues");
        fs::create_dir_all(&issues_dir).unwrap();
        fs::write(
            issues_dir.join("2026-01-01-test-issue.md"),
            r#"---
title: "Test Issue"
date: "2026-01-01"
kind: issue
status: open
severity: high
area: "frontend"
tags: ["bug", "ui"]
reported_by: "agent"
related_issues: []
---

# Test Issue

Some body content."#,
        )
        .unwrap();

        let raw = fs::read_to_string(issues_dir.join("2026-01-01-test-issue.md")).unwrap();
        let (fm_str, body) = extract_frontmatter(&raw).unwrap();
        let fm: serde_yaml::Value = serde_yaml::from_str(&fm_str).unwrap();

        assert_eq!(fm.get("title").unwrap().as_str().unwrap(), "Test Issue");
        assert_eq!(fm.get("status").unwrap().as_str().unwrap(), "open");
        assert_eq!(fm.get("severity").unwrap().as_str().unwrap(), "high");
        assert!(body.contains("Some body content."));
    }
}
