use axum::{
    extract::{Path as AxumPath, Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use feature_trace::{
    FeatureSurfaceCatalog, FeatureTraceInput, FeatureTreeCatalog,
    SessionAnalyzer,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;

use crate::api::repo_context::{resolve_repo_root, RepoContextQuery, ResolveRepoRootOptions};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(get_feature_list))
        .route("/{featureId}", get(get_feature_detail))
        .route("/{featureId}/files", get(get_feature_files))
        .route("/{featureId}/apis", get(get_feature_apis))
}

#[derive(Debug, Serialize)]
struct CapabilityGroupResponse {
    id: String,
    name: String,
    description: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FeatureSummaryResponse {
    id: String,
    name: String,
    group: String,
    summary: String,
    status: String,
    session_count: usize,
    changed_files: usize,
    updated_at: String,
    source_file_count: usize,
    page_count: usize,
    api_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FeatureDetailResponse {
    id: String,
    name: String,
    group: String,
    summary: String,
    status: String,
    pages: Vec<String>,
    apis: Vec<String>,
    source_files: Vec<String>,
    related_features: Vec<String>,
    domain_objects: Vec<String>,
    session_count: usize,
    changed_files: usize,
    updated_at: String,
    file_tree: Vec<FileTreeNode>,
    surface_links: Vec<SurfaceLinkResponse>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileTreeNode {
    id: String,
    name: String,
    path: String,
    kind: String,
    children: Vec<FileTreeNode>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SurfaceLinkResponse {
    kind: String,
    route: String,
    source_path: String,
}

fn map_error(error: impl std::fmt::Display) -> (StatusCode, Json<Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": "Feature explorer error", "details": error.to_string() })),
    )
}

fn map_context_error(error: impl std::fmt::Display) -> (StatusCode, Json<Value>) {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "error": "Context error", "details": error.to_string() })),
    )
}

fn load_feature_tree(repo_root: &Path) -> Result<FeatureTreeCatalog, String> {
    let feature_tree_path = repo_root.join("docs/product-specs/FEATURE_TREE.md");
    if !feature_tree_path.exists() {
        return Err("FEATURE_TREE.md not found".to_string());
    }
    FeatureTreeCatalog::from_feature_tree_markdown(&feature_tree_path)
        .map_err(|e| format!("Failed to parse FEATURE_TREE.md: {e}"))
}

fn build_file_tree(source_files: &[String]) -> Vec<FileTreeNode> {
    let mut root_children: Vec<FileTreeNode> = Vec::new();

    for file_path in source_files {
        let parts: Vec<&str> = file_path.split('/').collect();
        insert_into_tree(&mut root_children, &parts, file_path);
    }

    root_children
}

fn insert_into_tree(children: &mut Vec<FileTreeNode>, parts: &[&str], full_path: &str) {
    if parts.is_empty() {
        return;
    }

    let name = parts[0];
    let is_leaf = parts.len() == 1;

    let existing = children.iter_mut().find(|c| c.name == name);
    if let Some(node) = existing {
        if !is_leaf {
            insert_into_tree(&mut node.children, &parts[1..], full_path);
        }
    } else {
        // Build correct partial path by finding current depth
        let depth = full_path.split('/').count() - parts.len();
        let path_parts: Vec<&str> = full_path.split('/').take(depth + 1).collect();
        let node_path = path_parts.join("/");

        let mut node = FileTreeNode {
            id: node_path.replace('/', "-").replace(['[', ']'], ""),
            name: name.to_string(),
            path: node_path,
            kind: if is_leaf { "file" } else { "folder" }.to_string(),
            children: Vec::new(),
        };

        if !is_leaf {
            insert_into_tree(&mut node.children, &parts[1..], full_path);
        }

        children.push(node);
    }
}

fn collect_session_stats(
    repo_root: &Path,
    feature_tree: &FeatureTreeCatalog,
) -> HashMap<String, (usize, usize, String)> {
    let mut stats: HashMap<String, (usize, usize, String)> = HashMap::new();

    // Try to collect real transcript data
    let surface_catalog = FeatureSurfaceCatalog::from_repo_root(repo_root).unwrap_or_default();
    let analyzer = SessionAnalyzer::with_catalogs(&surface_catalog, feature_tree);

    match trace_parser::collect_recent_transcript_summaries(repo_root) {
        Ok(transcripts) => {
            for transcript in &transcripts {
                // Build changed files from recovered events
                let mut changed_files: Vec<String> = Vec::new();
                let mut tool_names: Vec<String> = Vec::new();

                for event in &transcript.recovered_events {
                    match event {
                        trace_parser::TranscriptRecoveredEvent::ToolUse {
                            tool_name,
                            tool_input,
                            ..
                        } => {
                            tool_names.push(tool_name.clone());
                            // Extract file paths from tool inputs
                            if let Some(path) = tool_input.get("file_path").and_then(|v| v.as_str())
                            {
                                if let Some(rel) = path.strip_prefix(&format!(
                                    "{}/",
                                    repo_root.to_string_lossy()
                                )) {
                                    changed_files.push(rel.to_string());
                                }
                            }
                            if let Some(path) = tool_input.get("path").and_then(|v| v.as_str()) {
                                if let Some(rel) = path.strip_prefix(&format!(
                                    "{}/",
                                    repo_root.to_string_lossy()
                                )) {
                                    changed_files.push(rel.to_string());
                                }
                            }
                        }
                    }
                }

                let input = FeatureTraceInput {
                    session_id: transcript.session_id.clone(),
                    changed_files: changed_files.clone(),
                    tool_call_names: tool_names,
                };

                let analysis = analyzer.analyze_input(&input);

                for feature_link in &analysis.feature_links {
                    let entry = stats
                        .entry(feature_link.feature_id.clone())
                        .or_insert((0, 0, String::new()));
                    entry.0 += 1; // session count
                    entry.1 += changed_files.len(); // changed file count
                    // Track latest timestamp
                    let ts = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string();
                    if entry.2.is_empty() || ts > entry.2 {
                        entry.2 = ts;
                    }
                }
            }
        }
        Err(_) => {
            // No transcripts available — use file-based heuristic
        }
    }

    // For features without session data, provide defaults based on source_files
    for feature in &feature_tree.features {
        stats
            .entry(feature.id.clone())
            .or_insert((0, feature.source_files.len(), String::new()));
    }

    stats
}

async fn get_feature_list(
    State(state): State<AppState>,
    Query(query): Query<RepoContextQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "workspaceId, codebaseId, or repoPath required",
        ResolveRepoRootOptions::default(),
    )
    .await
    .map_err(|e| map_context_error(e))?;

    let feature_tree = load_feature_tree(&repo_root).map_err(|e| map_error(e))?;
    let session_stats = collect_session_stats(&repo_root, &feature_tree);

    let capability_groups: Vec<CapabilityGroupResponse> = feature_tree
        .capability_groups
        .iter()
        .map(|g| CapabilityGroupResponse {
            id: g.id.clone(),
            name: g.name.clone(),
            description: g.description.clone(),
        })
        .collect();

    let features: Vec<FeatureSummaryResponse> = feature_tree
        .features
        .iter()
        .map(|f| {
            let (session_count, changed_files, updated_at) = session_stats
                .get(&f.id)
                .cloned()
                .unwrap_or((0, f.source_files.len(), String::new()));
            FeatureSummaryResponse {
                id: f.id.clone(),
                name: f.name.clone(),
                group: f.group.clone(),
                summary: f.summary.clone(),
                status: f.status.clone(),
                session_count,
                changed_files,
                updated_at: if updated_at.is_empty() {
                    "-".to_string()
                } else {
                    updated_at
                },
                source_file_count: f.source_files.len(),
                page_count: f.pages.len(),
                api_count: f.apis.len(),
            }
        })
        .collect();

    Ok(Json(json!({
        "capabilityGroups": capability_groups,
        "features": features,
    })))
}

async fn get_feature_detail(
    State(state): State<AppState>,
    AxumPath(feature_id): AxumPath<String>,
    Query(query): Query<RepoContextQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "workspaceId, codebaseId, or repoPath required",
        ResolveRepoRootOptions::default(),
    )
    .await
    .map_err(|e| map_context_error(e))?;

    let feature_tree = load_feature_tree(&repo_root).map_err(|e| map_error(e))?;
    let session_stats = collect_session_stats(&repo_root, &feature_tree);

    let feature = feature_tree
        .features
        .iter()
        .find(|f| f.id == feature_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Feature not found", "featureId": feature_id })),
            )
        })?;

    let surface_catalog = FeatureSurfaceCatalog::from_repo_root(&repo_root).unwrap_or_default();
    let mut surface_links = Vec::new();
    for source_file in &feature.source_files {
        for link in surface_catalog.best_links_for_path(source_file) {
            surface_links.push(SurfaceLinkResponse {
                kind: format!("{:?}", link.kind),
                route: link.route,
                source_path: link.source_path,
            });
        }
    }

    // Collect all related source files (from feature + discovered surfaces)
    let mut all_files: Vec<String> = feature.source_files.clone();
    for link in &surface_links {
        if !all_files.contains(&link.source_path) {
            all_files.push(link.source_path.clone());
        }
    }
    all_files.sort();

    let file_tree = build_file_tree(&all_files);

    let (session_count, changed_files, updated_at) = session_stats
        .get(&feature.id)
        .cloned()
        .unwrap_or((0, feature.source_files.len(), String::new()));

    let response = FeatureDetailResponse {
        id: feature.id.clone(),
        name: feature.name.clone(),
        group: feature.group.clone(),
        summary: feature.summary.clone(),
        status: feature.status.clone(),
        pages: feature.pages.clone(),
        apis: feature.apis.clone(),
        source_files: all_files,
        related_features: feature.related_features.clone(),
        domain_objects: feature.domain_objects.clone(),
        session_count,
        changed_files,
        updated_at: if updated_at.is_empty() {
            "-".to_string()
        } else {
            updated_at
        },
        file_tree,
        surface_links,
    };

    Ok(Json(serde_json::to_value(response).map_err(|e| map_error(e))?))
}

async fn get_feature_files(
    State(state): State<AppState>,
    AxumPath(feature_id): AxumPath<String>,
    Query(query): Query<RepoContextQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "workspaceId, codebaseId, or repoPath required",
        ResolveRepoRootOptions::default(),
    )
    .await
    .map_err(|e| map_context_error(e))?;

    let feature_tree = load_feature_tree(&repo_root).map_err(|e| map_error(e))?;
    let feature = feature_tree
        .features
        .iter()
        .find(|f| f.id == feature_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Feature not found", "featureId": feature_id })),
            )
        })?;

    let surface_catalog = FeatureSurfaceCatalog::from_repo_root(&repo_root).unwrap_or_default();
    let mut all_files: Vec<String> = feature.source_files.clone();
    for source_file in &feature.source_files {
        for link in surface_catalog.best_links_for_path(source_file) {
            if !all_files.contains(&link.source_path) {
                all_files.push(link.source_path.clone());
            }
        }
    }
    all_files.sort();

    let file_tree = build_file_tree(&all_files);

    Ok(Json(json!({
        "featureId": feature_id,
        "files": all_files,
        "fileTree": file_tree,
    })))
}

async fn get_feature_apis(
    State(state): State<AppState>,
    AxumPath(feature_id): AxumPath<String>,
    Query(query): Query<RepoContextQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "workspaceId, codebaseId, or repoPath required",
        ResolveRepoRootOptions::default(),
    )
    .await
    .map_err(|e| map_context_error(e))?;

    let feature_tree = load_feature_tree(&repo_root).map_err(|e| map_error(e))?;
    let feature = feature_tree
        .features
        .iter()
        .find(|f| f.id == feature_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Feature not found", "featureId": feature_id })),
            )
        })?;

    Ok(Json(json!({
        "featureId": feature_id,
        "apis": feature.apis,
        "pages": feature.pages,
    })))
}
