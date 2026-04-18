use std::path::{Path, PathBuf};

use axum::{
    Json, Router,
    extract::{Query, State},
    routing::get,
};
use feature_trace::api_endpoints_from_openapi_contract;
use serde::Deserialize;
use serde_json::{Value as JsonValue, json};
use std::collections::BTreeMap;

use crate::api::repo_context::{ResolveRepoRootOptions, extract_frontmatter, resolve_repo_root};
use crate::error::ServerError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/issues", get(list_spec_issues))
        .route("/surface-index", get(get_surface_index))
}

const SPEC_STATUSES: [&str; 4] = ["open", "investigating", "resolved", "wontfix"];

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpecIssuesQuery {
    workspace_id: Option<String>,
    codebase_id: Option<String>,
    repo_path: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeatureSurfaceIndexFile {
    generated_at: Option<String>,
    #[serde(default)]
    pages: Vec<FeatureSurfacePage>,
    #[serde(default)]
    apis: Vec<FeatureSurfaceApi>,
    #[serde(default)]
    contract_apis: Vec<FeatureSurfaceApi>,
    #[serde(default)]
    nextjs_apis: Vec<FeatureSurfaceImplementationApi>,
    #[serde(default)]
    rust_apis: Vec<FeatureSurfaceImplementationApi>,
    metadata: Option<JsonValue>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeatureSurfacePage {
    route: String,
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    source_file: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeatureSurfaceApi {
    domain: String,
    method: String,
    path: String,
    #[serde(default)]
    operation_id: String,
    #[serde(default)]
    summary: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeatureSurfaceImplementationApi {
    domain: String,
    method: String,
    path: String,
    #[serde(default)]
    source_files: Vec<String>,
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
        Some(serde_yaml::Value::Number(value)) => value
            .as_u64()
            .map(|number| JsonValue::Number(number.into())),
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

fn empty_surface_index_response(repo_root: &Path, warnings: Vec<String>) -> JsonValue {
    json!({
        "generatedAt": "",
        "pages": [],
        "apis": [],
        "contractApis": [],
        "nextjsApis": [],
        "rustApis": [],
        "metadata": JsonValue::Null,
        "repoRoot": repo_root.to_string_lossy(),
        "warnings": warnings,
    })
}

fn normalize_surface_pages(pages: Vec<FeatureSurfacePage>) -> Vec<JsonValue> {
    pages
        .into_iter()
        .filter(|page| !page.route.trim().is_empty() && !page.title.trim().is_empty())
        .map(|page| {
            json!({
                "route": page.route.trim(),
                "title": page.title.trim(),
                "description": page.description.trim(),
                "sourceFile": page.source_file.trim(),
            })
        })
        .collect()
}

fn merge_surface_api_lists<const N: usize>(
    lists: [Vec<FeatureSurfaceApi>; N],
) -> Vec<FeatureSurfaceApi> {
    let mut merged: BTreeMap<(String, String), FeatureSurfaceApi> = BTreeMap::new();

    for list in lists {
        for api in list {
            let method = api.method.trim().to_ascii_uppercase();
            let path = api.path.trim().to_string();
            if method.is_empty() || path.is_empty() {
                continue;
            }

            let key = (method.clone(), path.clone());
            if let Some(existing) = merged.get_mut(&key) {
                if existing.domain.trim().is_empty() && !api.domain.trim().is_empty() {
                    existing.domain = api.domain.trim().to_string();
                }
                if existing.operation_id.trim().is_empty() && !api.operation_id.trim().is_empty() {
                    existing.operation_id = api.operation_id.trim().to_string();
                }
                if existing.summary.trim().is_empty() && !api.summary.trim().is_empty() {
                    existing.summary = api.summary.trim().to_string();
                }
                continue;
            }

            merged.insert(
                key,
                FeatureSurfaceApi {
                    domain: api.domain.trim().to_string(),
                    method,
                    path,
                    operation_id: api.operation_id.trim().to_string(),
                    summary: api.summary.trim().to_string(),
                },
            );
        }
    }

    merged.into_values().collect()
}

fn normalize_surface_apis(apis: Vec<FeatureSurfaceApi>) -> Vec<JsonValue> {
    merge_surface_api_lists([apis])
        .into_iter()
        .filter(|api| !api.domain.trim().is_empty())
        .map(|api| {
            json!({
                "domain": api.domain.trim(),
                "method": api.method.trim(),
                "path": api.path.trim(),
                "operationId": api.operation_id.trim(),
                "summary": api.summary.trim(),
            })
        })
        .collect()
}

fn normalize_surface_implementation_apis(
    apis: Vec<FeatureSurfaceImplementationApi>,
) -> Vec<JsonValue> {
    apis.into_iter()
        .filter(|api| {
            !api.domain.trim().is_empty()
                && !api.method.trim().is_empty()
                && !api.path.trim().is_empty()
        })
        .map(|api| {
            json!({
                "domain": api.domain.trim(),
                "method": api.method.trim().to_ascii_uppercase(),
                "path": api.path.trim(),
                "sourceFiles": api.source_files,
            })
        })
        .collect()
}

fn to_surface_api_from_contract(
    apis: Vec<feature_trace::ApiEndpointDetail>,
) -> Vec<FeatureSurfaceApi> {
    apis.into_iter()
        .map(|api| FeatureSurfaceApi {
            domain: api.domain,
            method: api.method,
            path: api.endpoint,
            operation_id: String::new(),
            summary: api.description,
        })
        .collect()
}

fn normalize_surface_index(
    index: FeatureSurfaceIndexFile,
    openapi_contract_apis: Vec<FeatureSurfaceApi>,
    repo_root: &Path,
    warnings: Vec<String>,
) -> JsonValue {
    let pages = index.pages;
    let fallback_contract_apis = if index.contract_apis.is_empty() {
        index.apis.clone()
    } else {
        index.contract_apis.clone()
    };
    let resolved_apis = if index.apis.is_empty() {
        merge_surface_api_lists([
            openapi_contract_apis.clone(),
            fallback_contract_apis.clone(),
        ])
    } else {
        merge_surface_api_lists([openapi_contract_apis.clone(), index.apis])
    };
    let resolved_contract_apis =
        merge_surface_api_lists([openapi_contract_apis, fallback_contract_apis]);

    json!({
        "generatedAt": index.generated_at.unwrap_or_default(),
        "pages": normalize_surface_pages(pages),
        "apis": normalize_surface_apis(resolved_apis),
        "contractApis": normalize_surface_apis(resolved_contract_apis),
        "nextjsApis": normalize_surface_implementation_apis(index.nextjs_apis),
        "rustApis": normalize_surface_implementation_apis(index.rust_apis),
        "metadata": index.metadata.unwrap_or(JsonValue::Null),
        "repoRoot": repo_root.to_string_lossy(),
        "warnings": warnings,
    })
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

async fn get_surface_index(
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

    let index_path = repo_root
        .join("docs")
        .join("product-specs")
        .join("feature-tree.index.json");
    let api_contract_path = repo_root.join("api-contract.yaml");
    let relative_index_path = index_path
        .strip_prefix(&repo_root)
        .unwrap_or(&index_path)
        .to_string_lossy()
        .to_string();
    let relative_api_contract_path = api_contract_path
        .strip_prefix(&repo_root)
        .unwrap_or(&api_contract_path)
        .to_string_lossy()
        .to_string();

    let mut warnings = Vec::new();
    let parsed_index = match std::fs::read_to_string(&index_path) {
        Ok(raw) => match serde_json::from_str::<FeatureSurfaceIndexFile>(&raw) {
            Ok(index) => Some(index),
            Err(_) => {
                warnings.push(format!(
                    "Feature surface index is not valid JSON at {relative_index_path}"
                ));
                None
            }
        },
        Err(_) => {
            warnings.push(format!(
                "Feature surface index not found at {relative_index_path}"
            ));
            None
        }
    };

    let openapi_contract_apis = if api_contract_path.exists() {
        match api_endpoints_from_openapi_contract(&api_contract_path) {
            Ok(apis) => {
                if apis.is_empty() {
                    warnings.push(format!(
                        "OpenAPI contract produced no endpoints at {relative_api_contract_path}"
                    ));
                }
                Some(to_surface_api_from_contract(apis))
            }
            Err(error) => {
                warnings.push(format!(
                    "Failed to parse OpenAPI contract at {relative_api_contract_path}: {error}"
                ));
                None
            }
        }
    } else {
        None
    };

    match (parsed_index, openapi_contract_apis) {
        (Some(index), openapi_contract_apis) => Ok(Json(normalize_surface_index(
            index,
            openapi_contract_apis.unwrap_or_default(),
            &repo_root,
            warnings,
        ))),
        (None, Some(openapi_contract_apis)) => Ok(Json(normalize_surface_index(
            FeatureSurfaceIndexFile::default(),
            openapi_contract_apis,
            &repo_root,
            warnings,
        ))),
        (None, None) => Ok(Json(empty_surface_index_response(&repo_root, warnings))),
    }
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
        assert_eq!(
            normalize_status(&yaml_string_field(&fm, "status")),
            "resolved"
        );
        assert_eq!(
            yaml_optional_number(&fm, "github_issue"),
            Some(JsonValue::Number(410.into()))
        );
    }
}
