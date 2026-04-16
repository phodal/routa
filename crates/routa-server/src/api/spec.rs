use std::path::PathBuf;

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value as JsonValue};

use crate::api::repo_context::{
    extract_frontmatter, resolve_repo_root, ResolveRepoRootOptions,
};
use crate::error::ServerError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/issues", get(list_spec_issues))
}

const SPEC_STATUSES: [&str; 4] = ["open", "investigating", "resolved", "wontfix"];

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpecIssuesQuery {
    workspace_id: Option<String>,
    codebase_id: Option<String>,
    repo_path: Option<String>,
}

fn yaml_scalar_to_string(value: &serde_yaml::Value) -> Option<String> {
    match value {
        serde_yaml::Value::Null => None,
        serde_yaml::Value::Bool(value) => Some(value.to_string()),
        serde_yaml::Value::Number(value) => Some(value.to_string()),
        serde_yaml::Value::String(value) => Some(value.trim().to_string()),
        serde_yaml::Value::Tagged(tagged) => yaml_scalar_to_string(&tagged.value),
        _ => None,
    }
}

fn yaml_string_field(frontmatter: &serde_yaml::Value, key: &str) -> String {
    frontmatter
        .get(key)
        .and_then(yaml_scalar_to_string)
        .unwrap_or_default()
}

fn yaml_string_field_or(frontmatter: &serde_yaml::Value, key: &str, default: &str) -> String {
    let value = yaml_string_field(frontmatter, key);
    if value.is_empty() {
        default.to_string()
    } else {
        value
    }
}

fn yaml_string_vec(frontmatter: &serde_yaml::Value, key: &str) -> Vec<String> {
    match frontmatter.get(key) {
        Some(serde_yaml::Value::Sequence(values)) => values
            .iter()
            .filter_map(yaml_scalar_to_string)
            .filter(|value| !value.is_empty())
            .collect(),
        Some(serde_yaml::Value::Tagged(tagged)) => match &tagged.value {
            serde_yaml::Value::Sequence(values) => values
                .iter()
                .filter_map(yaml_scalar_to_string)
                .filter(|value| !value.is_empty())
                .collect(),
            _ => Vec::new(),
        },
        _ => Vec::new(),
    }
}

fn yaml_optional_number(frontmatter: &serde_yaml::Value, key: &str) -> Option<JsonValue> {
    match frontmatter.get(key) {
        Some(serde_yaml::Value::Number(value)) => value.as_u64().map(|number| JsonValue::Number(number.into())),
        Some(serde_yaml::Value::String(value)) => value
            .trim()
            .parse::<u64>()
            .ok()
            .map(|number| JsonValue::Number(number.into())),
        Some(serde_yaml::Value::Tagged(tagged)) => match &tagged.value {
            serde_yaml::Value::Number(value) => value
                .as_u64()
                .map(|number| JsonValue::Number(number.into())),
            serde_yaml::Value::String(value) => value
                .trim()
                .parse::<u64>()
                .ok()
                .map(|number| JsonValue::Number(number.into())),
            _ => None,
        },
        _ => None,
    }
}

fn yaml_optional_string(frontmatter: &serde_yaml::Value, key: &str) -> Option<JsonValue> {
    let value = yaml_string_field(frontmatter, key);
    if value.is_empty() {
        None
    } else {
        Some(JsonValue::String(value))
    }
}

fn normalize_status(raw: &str) -> String {
    let normalized = raw.trim().to_ascii_lowercase();
    if normalized == "closed" {
        return "resolved".to_string();
    }

    if SPEC_STATUSES.contains(&normalized.as_str()) {
        normalized
    } else {
        "open".to_string()
    }
}

async fn list_spec_issues(
    State(state): State<AppState>,
    Query(query): Query<SpecIssuesQuery>,
) -> Result<Json<JsonValue>, ServerError> {
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

        let title_fallback = filename.trim_end_matches(".md").to_string();
        let title = yaml_string_field_or(&fm, "title", &title_fallback);
        let kind = yaml_string_field_or(&fm, "kind", "issue").to_ascii_lowercase();
        let severity = yaml_string_field_or(&fm, "severity", "medium").to_ascii_lowercase();
        let status = normalize_status(&yaml_string_field(&fm, "status"));

        issues.push(json!({
            "filename": filename,
            "title": title,
            "date": yaml_string_field(&fm, "date"),
            "kind": kind,
            "status": status,
            "severity": severity,
            "area": yaml_string_field(&fm, "area"),
            "tags": yaml_string_vec(&fm, "tags"),
            "reportedBy": yaml_string_field(&fm, "reported_by"),
            "relatedIssues": yaml_string_vec(&fm, "related_issues"),
            "githubIssue": yaml_optional_number(&fm, "github_issue"),
            "githubState": yaml_optional_string(&fm, "github_state"),
            "githubUrl": yaml_optional_string(&fm, "github_url"),
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

    #[test]
    fn normalizes_unquoted_dates_and_closed_status() {
        let fm: serde_yaml::Value = serde_yaml::from_str(
            r#"
date: 2026-03-02
status: closed
github_issue: "410"
"#,
        )
        .unwrap();

        assert_eq!(yaml_string_field(&fm, "date"), "2026-03-02");
        assert_eq!(normalize_status(&yaml_string_field(&fm, "status")), "resolved");
        assert_eq!(yaml_optional_number(&fm, "github_issue"), Some(JsonValue::Number(410.into())));
    }
}
