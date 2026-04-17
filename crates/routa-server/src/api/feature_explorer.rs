use axum::{
    extract::{Path as AxumPath, Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use feature_trace::{
    FeatureSurfaceCatalog, FeatureTraceInput, FeatureTreeCatalog, SessionAnalysis, SessionAnalyzer,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap, HashSet};
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
    page_details: Vec<PageDetailResponse>,
    api_details: Vec<ApiDetailResponse>,
    file_stats: HashMap<String, FileStatResponse>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileStatResponse {
    changes: usize,
    sessions: usize,
    updated_at: String,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PageDetailResponse {
    name: String,
    route: String,
    description: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiDetailResponse {
    group: String,
    method: String,
    endpoint: String,
    description: String,
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
    FeatureTreeCatalog::from_repo_root(repo_root)
        .map_err(|e| format!("Failed to load feature tree sources: {e}"))
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

/// Per-file statistics: (change_count, session_count, latest_timestamp)
type FileStats = HashMap<String, (usize, usize, String)>;

#[derive(Debug, Default)]
struct FeatureStatAggregate {
    session_ids: BTreeSet<String>,
    changed_files: BTreeSet<String>,
    updated_at: String,
}

#[derive(Debug, Default)]
struct FileStatAggregate {
    change_count: usize,
    session_ids: BTreeSet<String>,
    updated_at: String,
}

fn collect_session_stats(
    repo_root: &Path,
    feature_tree: &FeatureTreeCatalog,
) -> (HashMap<String, (usize, usize, String)>, FileStats) {
    let mut stats: HashMap<String, FeatureStatAggregate> = HashMap::new();
    let mut file_stats: HashMap<String, FileStatAggregate> = HashMap::new();

    // Try to collect real transcript data
    let surface_catalog = FeatureSurfaceCatalog::from_repo_root(repo_root).unwrap_or_default();
    let analyzer = SessionAnalyzer::with_catalogs(&surface_catalog, feature_tree);
    let normalized_registry =
        trace_parser::AdapterRegistry::new().with_adapter(trace_parser::CodexSessionAdapter);

    match trace_parser::collect_broad_transcript_summaries(repo_root) {
        Ok(transcripts) => {
            for transcript in &transcripts {
                let input = build_feature_trace_input_from_transcript(
                    repo_root,
                    transcript,
                    &normalized_registry,
                );
                let changed_files = input.changed_files.clone();
                let analysis = analyzer.analyze_input(&input);

                let ts_str = {
                    let ms = transcript.last_seen_at_ms;
                    chrono::DateTime::from_timestamp_millis(ms)
                        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S").to_string())
                        .unwrap_or_default()
                };

                record_analysis(
                    &mut stats,
                    &mut file_stats,
                    &transcript.session_id,
                    &changed_files,
                    &analysis,
                    &ts_str,
                );
            }
        }
        Err(_) => {
            // No transcripts available — use file-based heuristic
        }
    }

    (
        stats
            .into_iter()
            .map(|(feature_id, aggregate)| {
                (
                    feature_id,
                    (
                        aggregate.session_ids.len(),
                        aggregate.changed_files.len(),
                        aggregate.updated_at,
                    ),
                )
            })
            .collect(),
        file_stats
            .into_iter()
            .map(|(path, aggregate)| {
                (
                    path,
                    (
                        aggregate.change_count,
                        aggregate.session_ids.len(),
                        aggregate.updated_at,
                    ),
                )
            })
            .collect(),
    )
}

fn build_feature_trace_input_from_transcript(
    repo_root: &Path,
    transcript: &trace_parser::TranscriptSessionBackfill,
    normalized_registry: &trace_parser::AdapterRegistry,
) -> FeatureTraceInput {
    if transcript.client == "codex" {
        if let Ok(session) = normalized_registry.parse_path(Path::new(&transcript.transcript_path))
        {
            if let Some(input) =
                build_feature_trace_input_from_normalized_session(repo_root, &session)
            {
                return input;
            }
        }
    }

    let changed_files = collect_changed_files_from_events(repo_root, &transcript.recovered_events);
    let tool_call_names = transcript
        .recovered_events
        .iter()
        .map(|event| match event {
            trace_parser::TranscriptRecoveredEvent::ToolUse { tool_name, .. } => tool_name.clone(),
        })
        .collect();

    FeatureTraceInput {
        session_id: transcript.session_id.clone(),
        changed_files,
        tool_call_names,
    }
}

fn build_feature_trace_input_from_normalized_session(
    repo_root: &Path,
    session: &trace_parser::NormalizedSession,
) -> Option<FeatureTraceInput> {
    let changed_files = session
        .file_events
        .iter()
        .filter_map(|event| normalize_repo_relative(repo_root, &event.path))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let tool_call_names = session
        .tool_calls
        .iter()
        .map(|tool_call| tool_call.tool_name.clone())
        .collect::<Vec<_>>();

    if changed_files.is_empty() && tool_call_names.is_empty() {
        return None;
    }

    Some(FeatureTraceInput {
        session_id: session.session_id.clone(),
        changed_files,
        tool_call_names,
    })
}

fn record_analysis(
    stats: &mut HashMap<String, FeatureStatAggregate>,
    file_stats: &mut HashMap<String, FileStatAggregate>,
    session_id: &str,
    changed_files: &[String],
    analysis: &SessionAnalysis,
    updated_at: &str,
) {
    let mut seen_feature_file_pairs = HashSet::new();
    for feature_link in &analysis.feature_links {
        let entry = stats.entry(feature_link.feature_id.clone()).or_default();
        entry.session_ids.insert(session_id.to_string());
        if seen_feature_file_pairs.insert((
            feature_link.feature_id.clone(),
            feature_link.via_path.clone(),
        )) {
            entry.changed_files.insert(feature_link.via_path.clone());
        }
        if !updated_at.is_empty()
            && (entry.updated_at.is_empty() || updated_at > entry.updated_at.as_str())
        {
            entry.updated_at = updated_at.to_string();
        }
    }

    for file_path in changed_files {
        let entry = file_stats.entry(file_path.clone()).or_default();
        entry.change_count += 1;
        entry.session_ids.insert(session_id.to_string());
        if !updated_at.is_empty()
            && (entry.updated_at.is_empty() || updated_at > entry.updated_at.as_str())
        {
            entry.updated_at = updated_at.to_string();
        }
    }
}

fn collect_changed_files_from_events(
    repo_root: &Path,
    recovered_events: &[trace_parser::TranscriptRecoveredEvent],
) -> Vec<String> {
    let mut changed_files = BTreeSet::new();
    for event in recovered_events {
        let trace_parser::TranscriptRecoveredEvent::ToolUse { tool_input, .. } = event;
        for path in extract_file_paths_for_repo(tool_input, repo_root) {
            changed_files.insert(path);
        }
    }
    changed_files.into_iter().collect()
}

fn extract_file_paths_for_repo(tool_input: &Value, repo_root: &Path) -> Vec<String> {
    let mut candidates = HashSet::new();
    collect_file_values(tool_input, &mut candidates);
    if let Some(command) = tool_input
        .get("command")
        .and_then(Value::as_str)
        .or_else(|| tool_input.get("cmd").and_then(Value::as_str))
    {
        for path in parse_patch_block(command) {
            candidates.insert(path);
        }
        for path in parse_command_paths(command) {
            candidates.insert(path);
        }
    }

    candidates
        .into_iter()
        .filter_map(|value| normalize_repo_relative(repo_root, &value))
        .collect()
}

fn collect_file_values(value: &Value, out: &mut HashSet<String>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let key_lower = key.to_ascii_lowercase();
                let is_path_key = matches!(
                    key_lower.as_str(),
                    "path"
                        | "paths"
                        | "file"
                        | "filepath"
                        | "file_path"
                        | "filename"
                        | "target"
                        | "source"
                        | "target_file"
                        | "source_file"
                        | "absolute_path"
                        | "relative_path"
                );
                if is_path_key {
                    match child {
                        Value::String(path) => {
                            out.insert(path.to_string());
                        }
                        Value::Array(values) => {
                            for item in values {
                                if let Some(path) = item.as_str() {
                                    out.insert(path.to_string());
                                }
                            }
                        }
                        _ => {}
                    }
                }
                collect_file_values(child, out);
            }
        }
        Value::Array(values) => {
            for item in values {
                collect_file_values(item, out);
            }
        }
        Value::String(text) => {
            for value in parse_patch_block(text) {
                out.insert(value);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}

fn parse_patch_block(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("*** Update File:") {
            out.push(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("*** Add File:") {
            out.push(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("*** Delete File:") {
            out.push(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("*** Move to:") {
            out.push(rest.trim().to_string());
        }
    }
    out
}

fn parse_command_paths(command: &str) -> Vec<String> {
    let tokens = shell_like_split(command);
    if tokens.is_empty() {
        return Vec::new();
    }

    let mut candidates = Vec::new();
    if let Some(separator_index) = tokens.iter().position(|token| token == "--") {
        candidates.extend(
            tokens[separator_index + 1..]
                .iter()
                .filter(|token| !token.starts_with('-'))
                .cloned(),
        );
    } else if tokens.first().is_some_and(|token| token == "git")
        && tokens
            .get(1)
            .is_some_and(|subcommand| matches!(subcommand.as_str(), "add" | "rm"))
    {
        candidates.extend(
            tokens[2..]
                .iter()
                .filter(|token| !token.starts_with('-'))
                .cloned(),
        );
    }

    candidates
}

fn shell_like_split(command: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote = None;

    for ch in command.chars() {
        match quote {
            Some(active_quote) if ch == active_quote => quote = None,
            Some(_) => current.push(ch),
            None if ch == '\'' || ch == '"' => quote = Some(ch),
            None if ch.is_whitespace() => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            None => current.push(ch),
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

fn normalize_repo_relative(repo_root: &Path, value: &str) -> Option<String> {
    let clean = value.trim().trim_matches('"').replace('\\', "/");
    if clean.is_empty() || clean == "/dev/null" {
        return None;
    }

    let path = if Path::new(&clean).is_absolute() {
        std::path::PathBuf::from(clean)
    } else {
        repo_root.join(clean)
    };

    path.strip_prefix(repo_root)
        .ok()
        .map(|v| v.to_string_lossy().replace('\\', "/"))
}

fn split_declared_api(declaration: &str) -> Option<(&str, &str)> {
    let (method, endpoint) = declaration.split_once(' ')?;
    Some((method.trim(), endpoint.trim()))
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
    .map_err(map_context_error)?;

    let feature_tree = load_feature_tree(&repo_root).map_err(map_error)?;
    let (session_stats, _file_stats) = collect_session_stats(&repo_root, &feature_tree);

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
    .map_err(map_context_error)?;

    let feature_tree = load_feature_tree(&repo_root).map_err(map_error)?;
    let (session_stats, file_stats) = collect_session_stats(&repo_root, &feature_tree);

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

    let page_details: Vec<PageDetailResponse> = feature
        .pages
        .iter()
        .map(|route| {
            if let Some(page) = feature_tree.frontend_page_for_route(route) {
                PageDetailResponse {
                    name: page.name.clone(),
                    route: page.route.clone(),
                    description: page.description.clone(),
                }
            } else {
                PageDetailResponse {
                    name: route.clone(),
                    route: route.clone(),
                    description: String::new(),
                }
            }
        })
        .collect();

    let api_details: Vec<ApiDetailResponse> = feature
        .apis
        .iter()
        .map(|declaration| {
            if let Some(api) = feature_tree.api_endpoint_for_declaration(declaration) {
                ApiDetailResponse {
                    group: api.domain.clone(),
                    method: api.method.clone(),
                    endpoint: api.endpoint.clone(),
                    description: api.description.clone(),
                }
            } else {
                let (method, endpoint) = split_declared_api(declaration)
                    .map(|(method, endpoint)| (method.to_string(), endpoint.to_string()))
                    .unwrap_or_else(|| ("GET".to_string(), declaration.clone()));
                ApiDetailResponse {
                    group: String::new(),
                    method,
                    endpoint,
                    description: String::new(),
                }
            }
        })
        .collect();

    let (session_count, changed_files, updated_at) = session_stats
        .get(&feature.id)
        .cloned()
        .unwrap_or((0, feature.source_files.len(), String::new()));

    // Build per-file stats for this feature's source files
    let feature_file_stats: HashMap<String, FileStatResponse> = all_files
        .iter()
        .filter_map(|f| {
            file_stats.get(f).map(|(changes, sessions, updated)| {
                (
                    f.clone(),
                    FileStatResponse {
                        changes: *changes,
                        sessions: *sessions,
                        updated_at: updated.clone(),
                    },
                )
            })
        })
        .collect();

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
        page_details,
        api_details,
        file_stats: feature_file_stats,
    };

    Ok(Json(serde_json::to_value(response).map_err(map_error)?))
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
    .map_err(map_context_error)?;

    let feature_tree = load_feature_tree(&repo_root).map_err(map_error)?;
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
    .map_err(map_context_error)?;

    let feature_tree = load_feature_tree(&repo_root).map_err(map_error)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use feature_trace::{ProductFeatureLink, SurfaceLinkConfidence};
    use serde_json::json;
    use std::collections::BTreeMap;
    use tempfile::tempdir;

    #[test]
    fn record_analysis_counts_only_matched_feature_sessions() {
        let mut stats = HashMap::new();
        let mut file_stats = HashMap::new();
        let analysis = SessionAnalysis {
            session_id: "sess-1".to_string(),
            changed_files: vec![
                "src/app/workspace/[workspaceId]/sessions/page.tsx".to_string(),
                "src/app/workspace/[workspaceId]/sessions/page.tsx".to_string(),
            ],
            tool_call_counts: BTreeMap::new(),
            surface_links: Vec::new(),
            feature_links: vec![ProductFeatureLink {
                feature_id: "session-recovery".to_string(),
                feature_name: "Session Recovery".to_string(),
                route: Some("/workspace/:workspaceId/sessions".to_string()),
                via_path: "src/app/workspace/[workspaceId]/sessions/page.tsx".to_string(),
                confidence: SurfaceLinkConfidence::High,
            }],
        };

        record_analysis(
            &mut stats,
            &mut file_stats,
            "sess-1",
            &["src/app/workspace/[workspaceId]/sessions/page.tsx".to_string()],
            &analysis,
            "2026-04-17T09:00:00",
        );

        let session_recovery = stats.get("session-recovery").expect("feature stat");
        assert_eq!(session_recovery.session_ids.len(), 1);
        assert_eq!(session_recovery.changed_files.len(), 1);
        assert_eq!(session_recovery.updated_at, "2026-04-17T09:00:00");
        assert!(stats.get("workspace-overview").is_none());

        let file_stat = file_stats
            .get("src/app/workspace/[workspaceId]/sessions/page.tsx")
            .expect("file stat");
        assert_eq!(file_stat.change_count, 1);
        assert_eq!(file_stat.session_ids.len(), 1);
    }

    #[test]
    fn extract_file_paths_for_repo_supports_relative_and_patch_paths() {
        let dir = tempdir().expect("tempdir");
        let repo_root = dir.path();
        let tool_input = json!({
            "path": "src/app/workspace/[workspaceId]/feature-explorer/page.tsx",
            "command": "*** Update File: src/app/workspace/[workspaceId]/sessions/page.tsx\n*** End Patch\n"
        });

        let paths = extract_file_paths_for_repo(&tool_input, repo_root);

        assert!(paths
            .contains(&"src/app/workspace/[workspaceId]/feature-explorer/page.tsx".to_string()));
        assert!(paths.contains(&"src/app/workspace/[workspaceId]/sessions/page.tsx".to_string()));
    }

    #[test]
    fn normalized_codex_sessions_contribute_git_status_file_events() {
        let dir = tempdir().expect("tempdir");
        let repo_root = dir.path().join("repo");
        std::fs::create_dir_all(repo_root.join("src/app")).expect("repo src dir");
        let transcript_path = dir.path().join("rollout-test.jsonl");
        std::fs::write(
            &transcript_path,
            format!(
                concat!(
                    "{{\"timestamp\":\"2026-04-17T01:51:41.963Z\",\"type\":\"session_meta\",\"payload\":{{\"id\":\"sess-1\",\"timestamp\":\"2026-04-17T01:50:56.919Z\",\"cwd\":\"{}\",\"source\":\"cli\",\"model_provider\":\"openai\"}}}}\n",
                    "{{\"timestamp\":\"2026-04-17T02:31:10.000Z\",\"type\":\"event_msg\",\"payload\":{{\"type\":\"exec_command_end\",\"turn_id\":\"turn-1\",\"command\":[\"/bin/zsh\",\"-lc\",\"git status --short\"],\"aggregated_output\":\" M src/app/page.tsx\\n\",\"exit_code\":0}}}}\n"
                ),
                repo_root.display()
            ),
        )
        .expect("write transcript");

        let registry =
            trace_parser::AdapterRegistry::new().with_adapter(trace_parser::CodexSessionAdapter);
        let transcript = trace_parser::TranscriptSessionBackfill {
            client: "codex".to_string(),
            session_id: "sess-1".to_string(),
            cwd: repo_root.to_string_lossy().to_string(),
            model: Some("openai".to_string()),
            transcript_path: transcript_path.to_string_lossy().to_string(),
            source: Some("cli".to_string()),
            last_seen_at_ms: 1_000,
            status: "active".to_string(),
            turn_id: Some("turn-1".to_string()),
            prompt: Some("inspect repo".to_string()),
            turn_started_at_ms: 1_000,
            recovered_events: Vec::new(),
        };

        let input = build_feature_trace_input_from_transcript(&repo_root, &transcript, &registry);

        assert_eq!(input.session_id, "sess-1");
        assert_eq!(input.changed_files, vec!["src/app/page.tsx".to_string()]);
        assert!(input.tool_call_names.contains(&"exec_command".to_string()));
    }
}
