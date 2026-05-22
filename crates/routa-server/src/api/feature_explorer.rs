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

const MAX_FILE_SIGNAL_SESSIONS: usize = 6;
const MAX_FILE_SIGNAL_TOOLS: usize = 8;
const MAX_FILE_SIGNAL_PROMPTS: usize = 6;
const MAX_FILE_SIGNAL_CHANGED_FILES: usize = 12;
const MAX_FILE_SIGNAL_FAILED_TOOLS: usize = 6;
const MAX_FILE_SIGNAL_REPEATED_COMMANDS: usize = 6;

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
    file_signals: HashMap<String, FileSignalResponse>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileStatResponse {
    changes: usize,
    sessions: usize,
    updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileSignalResponse {
    sessions: Vec<FileSessionSignalResponse>,
    tool_history: Vec<String>,
    prompt_history: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileSessionSignalResponse {
    provider: String,
    session_id: String,
    updated_at: String,
    prompt_snippet: String,
    prompt_history: Vec<String>,
    tool_names: Vec<String>,
    changed_files: Vec<String>,
    resume_command: Option<String>,
    diagnostics: Option<FileSessionDiagnosticsResponse>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileSessionDiagnosticsResponse {
    tool_call_count: usize,
    failed_tool_call_count: usize,
    tool_calls_by_name: HashMap<String, usize>,
    read_files: Vec<String>,
    written_files: Vec<String>,
    repeated_read_files: Vec<String>,
    repeated_commands: Vec<String>,
    failed_tools: Vec<FileSessionToolFailureResponse>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileSessionToolFailureResponse {
    tool_name: String,
    command: Option<String>,
    message: String,
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
type FileSignals = HashMap<String, FileSignalResponse>;

/// Per-feature statistics: (session_count, changed_file_count, latest_timestamp)
type FeatureStats = HashMap<String, (usize, usize, String)>;

struct AnalysisRecordTargets<'a> {
    stats: &'a mut HashMap<String, FeatureStatAggregate>,
    file_stats: &'a mut HashMap<String, FileStatAggregate>,
    file_signals: &'a mut FileSignals,
}

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

#[derive(Clone, Debug)]
struct SessionSignalContext {
    provider: String,
    prompt_history: Vec<String>,
    tool_history: Vec<String>,
    resume_command: Option<String>,
    diagnostics: Option<FileSessionDiagnosticsResponse>,
}

fn collect_session_stats(
    repo_root: &Path,
    feature_tree: &FeatureTreeCatalog,
) -> (FeatureStats, FileStats, FileSignals, Vec<SessionAnalysis>) {
    let mut stats: HashMap<String, FeatureStatAggregate> = HashMap::new();
    let mut file_stats: HashMap<String, FileStatAggregate> = HashMap::new();
    let mut file_signals: FileSignals = HashMap::new();
    let mut analyses = Vec::new();

    // Try to collect real transcript data
    let surface_catalog = FeatureSurfaceCatalog::from_repo_root(repo_root).unwrap_or_default();
    let analyzer = SessionAnalyzer::with_catalogs(&surface_catalog, feature_tree);
    let normalized_registry =
        trace_parser::AdapterRegistry::new().with_adapter(trace_parser::CodexSessionAdapter);

    match trace_parser::collect_broad_transcript_summaries(repo_root) {
        Ok(transcripts) => {
            for transcript in &transcripts {
                let raw_events = load_raw_transcript_events(Path::new(&transcript.transcript_path));
                let raw_changed_files = collect_changed_files_from_raw_events(
                    &raw_events,
                    repo_root,
                    Path::new(&transcript.cwd),
                );
                let normalized_session =
                    if transcript.client == "codex" || transcript.client == "claude" {
                        normalized_registry
                            .parse_path(Path::new(&transcript.transcript_path))
                            .ok()
                    } else {
                        None
                    };
                let input = normalized_session
                    .as_ref()
                    .and_then(|session| {
                        build_feature_trace_input_from_normalized_session(
                            repo_root,
                            session,
                            &raw_changed_files,
                            &raw_events,
                        )
                    })
                    .unwrap_or_else(|| {
                        build_feature_trace_input_from_transcript(
                            repo_root,
                            transcript,
                            &normalized_registry,
                            &raw_changed_files,
                            &raw_events,
                        )
                    });
                let changed_files = input.changed_files.clone();
                let analysis = analyzer.analyze_input(&input);
                analyses.push(analysis.clone());

                let ts_str = {
                    let ms = transcript.last_seen_at_ms;
                    chrono::DateTime::from_timestamp_millis(ms)
                        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S").to_string())
                        .unwrap_or_default()
                };
                let signal_context = build_session_signal_context(
                    repo_root,
                    transcript,
                    normalized_session.as_ref(),
                    &raw_events,
                    &changed_files,
                );

                record_analysis(
                    &mut AnalysisRecordTargets {
                        stats: &mut stats,
                        file_stats: &mut file_stats,
                        file_signals: &mut file_signals,
                    },
                    &transcript.session_id,
                    &signal_context,
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
        file_signals,
        analyses,
    )
}

fn collect_feature_analysis_paths(feature_id: &str, analyses: &[SessionAnalysis]) -> Vec<String> {
    analyses
        .iter()
        .flat_map(|analysis| {
            analysis
                .feature_links
                .iter()
                .filter(move |feature_link| feature_link.feature_id == feature_id)
                .map(|feature_link| feature_link.via_path.clone())
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn build_feature_trace_input_from_transcript(
    repo_root: &Path,
    transcript: &trace_parser::TranscriptSessionBackfill,
    normalized_registry: &trace_parser::AdapterRegistry,
    raw_changed_files: &[String],
    raw_events: &[Value],
) -> FeatureTraceInput {
    if transcript.client == "codex" {
        if let Ok(session) = normalized_registry.parse_path(Path::new(&transcript.transcript_path))
        {
            if let Some(input) = build_feature_trace_input_from_normalized_session(
                repo_root,
                &session,
                raw_changed_files,
                raw_events,
            ) {
                return input;
            }
        }
    }

    let changed_files = if raw_changed_files.is_empty() {
        collect_changed_files_from_events(repo_root, &transcript.recovered_events)
    } else {
        raw_changed_files.to_vec()
    };
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
        prompt_previews: transcript.prompt.iter().cloned().collect(),
        file_operations: Vec::new(),
    }
}

fn build_feature_trace_input_from_normalized_session(
    repo_root: &Path,
    session: &trace_parser::NormalizedSession,
    raw_changed_files: &[String],
    raw_events: &[Value],
) -> Option<FeatureTraceInput> {
    let changed_files = if raw_changed_files.is_empty() {
        session
            .file_events
            .iter()
            .filter_map(|event| normalize_repo_relative(repo_root, &event.path))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>()
    } else {
        raw_changed_files.to_vec()
    };
    let tool_call_names = {
        let raw_tool_history = collect_tool_history_from_raw_events(raw_events);
        if raw_tool_history.is_empty() {
            session
                .tool_calls
                .iter()
                .map(|tool_call| tool_call.tool_name.clone())
                .collect::<Vec<_>>()
        } else {
            raw_tool_history
        }
    };
    let prompt_previews = {
        let raw_prompt_history = collect_prompt_history_from_raw_events(raw_events);
        if raw_prompt_history.is_empty() {
            session
                .prompts
                .iter()
                .filter(|prompt| prompt.role == trace_parser::PromptRole::User)
                .map(|prompt| normalize_user_prompt(&prompt.text))
                .filter(|prompt| !prompt.is_empty())
                .collect::<Vec<_>>()
        } else {
            raw_prompt_history
        }
    };
    let file_operations = session
        .file_events
        .iter()
        .map(|event| match event.operation {
            trace_parser::FileOperationKind::Added => "added",
            trace_parser::FileOperationKind::Modified => "modified",
            trace_parser::FileOperationKind::Deleted => "deleted",
            trace_parser::FileOperationKind::Renamed => "renamed",
            trace_parser::FileOperationKind::Unknown => "unknown",
        })
        .map(str::to_string)
        .collect::<Vec<_>>();

    if changed_files.is_empty() && tool_call_names.is_empty() {
        return None;
    }

    Some(FeatureTraceInput {
        session_id: session.session_id.clone(),
        changed_files,
        tool_call_names,
        prompt_previews,
        file_operations,
    })
}

fn record_analysis(
    targets: &mut AnalysisRecordTargets<'_>,
    session_id: &str,
    signal_context: &SessionSignalContext,
    changed_files: &[String],
    analysis: &SessionAnalysis,
    updated_at: &str,
) {
    let mut seen_feature_file_pairs = HashSet::new();
    for feature_link in &analysis.feature_links {
        let entry = targets
            .stats
            .entry(feature_link.feature_id.clone())
            .or_default();
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

    let tool_names = signal_context.tool_history.clone();
    let prompt_history = signal_context.prompt_history.clone();
    let prompt_snippet = prompt_history.first().cloned().unwrap_or_default();
    let changed_files_limited = changed_files
        .iter()
        .take(MAX_FILE_SIGNAL_CHANGED_FILES)
        .cloned()
        .collect::<Vec<_>>();
    let signal_file_paths = changed_files
        .iter()
        .cloned()
        .chain(
            analysis
                .feature_links
                .iter()
                .map(|feature_link| feature_link.via_path.clone()),
        )
        .collect::<BTreeSet<_>>();

    for file_path in signal_file_paths {
        let entry = targets.file_stats.entry(file_path.clone()).or_default();
        entry.change_count += 1;
        entry.session_ids.insert(session_id.to_string());
        if !updated_at.is_empty()
            && (entry.updated_at.is_empty() || updated_at > entry.updated_at.as_str())
        {
            entry.updated_at = updated_at.to_string();
        }

        let signal_entry = targets
            .file_signals
            .entry(file_path.clone())
            .or_insert_with(|| FileSignalResponse {
                sessions: Vec::new(),
                tool_history: Vec::new(),
                prompt_history: Vec::new(),
            });

        if !signal_entry.sessions.iter().any(|session| {
            session.provider == signal_context.provider && session.session_id == session_id
        }) {
            signal_entry.sessions.push(FileSessionSignalResponse {
                provider: signal_context.provider.clone(),
                session_id: session_id.to_string(),
                updated_at: updated_at.to_string(),
                prompt_snippet: prompt_snippet.clone(),
                prompt_history: prompt_history.clone(),
                tool_names: tool_names.clone(),
                changed_files: changed_files_limited.clone(),
                resume_command: signal_context.resume_command.clone(),
                diagnostics: signal_context.diagnostics.clone(),
            });
            signal_entry
                .sessions
                .sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
            signal_entry.sessions.truncate(MAX_FILE_SIGNAL_SESSIONS);
        }

        for tool_name in &tool_names {
            if signal_entry.tool_history.len() >= MAX_FILE_SIGNAL_TOOLS {
                break;
            }
            if !signal_entry.tool_history.contains(tool_name) {
                signal_entry.tool_history.push(tool_name.clone());
            }
        }

        for prompt_item in &prompt_history {
            if signal_entry.prompt_history.len() >= MAX_FILE_SIGNAL_PROMPTS {
                break;
            }
            if !signal_entry.prompt_history.contains(prompt_item) {
                signal_entry.prompt_history.push(prompt_item.clone());
            }
        }
    }
}

fn build_session_signal_context(
    repo_root: &Path,
    transcript: &trace_parser::TranscriptSessionBackfill,
    normalized_session: Option<&trace_parser::NormalizedSession>,
    raw_events: &[Value],
    changed_files: &[String],
) -> SessionSignalContext {
    let prompt_history = {
        let raw_prompt_history = collect_prompt_history_from_raw_events(raw_events);
        if raw_prompt_history.is_empty() {
            normalized_session
                .map(collect_prompt_history_from_normalized_session)
                .filter(|history| !history.is_empty())
                .unwrap_or_else(|| {
                    transcript
                        .prompt
                        .as_deref()
                        .map(normalize_user_prompt)
                        .filter(|value| !value.is_empty())
                        .map(|value| vec![value])
                        .unwrap_or_default()
                })
        } else {
            raw_prompt_history
        }
    };
    let tool_history = {
        let raw_tool_history = collect_tool_history_from_raw_events(raw_events);
        if raw_tool_history.is_empty() {
            normalized_session
                .map(collect_tool_history_from_normalized_session)
                .filter(|history| !history.is_empty())
                .unwrap_or_else(|| {
                    transcript
                        .recovered_events
                        .iter()
                        .map(|event| match event {
                            trace_parser::TranscriptRecoveredEvent::ToolUse {
                                tool_name, ..
                            } => tool_name.clone(),
                        })
                        .collect::<BTreeSet<_>>()
                        .into_iter()
                        .take(MAX_FILE_SIGNAL_TOOLS)
                        .collect()
                })
        } else {
            raw_tool_history
        }
    };

    SessionSignalContext {
        provider: transcript.client.clone(),
        prompt_history,
        tool_history,
        resume_command: build_resume_command(&transcript.client, &transcript.session_id),
        diagnostics: (!raw_events.is_empty()).then(|| {
            derive_transcript_session_diagnostics(
                raw_events,
                repo_root,
                Path::new(&transcript.cwd),
                changed_files,
            )
        }),
    }
}

fn load_raw_transcript_events(transcript_path: &Path) -> Vec<Value> {
    let Ok(content) = std::fs::read_to_string(transcript_path) else {
        return Vec::new();
    };

    let mut events = Vec::new();
    for line in content.lines().filter(|line| !line.trim().is_empty()) {
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(payload) = entry.get("payload") else {
            continue;
        };
        match entry.get("type").and_then(Value::as_str) {
            Some("event_msg") | Some("response_item") => events.push(payload.clone()),
            _ => {}
        }
    }

    events
}

fn collect_prompt_history_from_raw_events(events: &[Value]) -> Vec<String> {
    let mut prompts = Vec::new();
    for event in events {
        let Some(prompt) = user_prompt_from_feature_event(event) else {
            continue;
        };
        let text = normalize_user_prompt(&prompt);
        if text.is_empty()
            || prompts.iter().any(|existing: &String| {
                existing == &text || existing.starts_with(&text) || text.starts_with(existing)
            })
        {
            continue;
        }
        if prompts.len() >= MAX_FILE_SIGNAL_PROMPTS {
            break;
        }
        prompts.push(text);
    }
    prompts
}

fn collect_prompt_history_from_normalized_session(
    session: &trace_parser::NormalizedSession,
) -> Vec<String> {
    let mut prompts = Vec::new();
    for prompt in session
        .prompts
        .iter()
        .filter(|prompt| prompt.role == trace_parser::PromptRole::User)
    {
        let text = normalize_user_prompt(&prompt.text);
        if text.is_empty()
            || prompts.iter().any(|existing: &String| {
                existing == &text || existing.starts_with(&text) || text.starts_with(existing)
            })
        {
            continue;
        }
        if prompts.len() >= MAX_FILE_SIGNAL_PROMPTS {
            break;
        }
        prompts.push(text);
    }
    prompts
}

fn collect_tool_history_from_raw_events(events: &[Value]) -> Vec<String> {
    let mut tools = Vec::new();
    for event in events {
        let Some(tool_name) = tool_name_from_feature_event(event) else {
            continue;
        };
        if tools.iter().any(|existing| existing == &tool_name) {
            continue;
        }
        if tools.len() >= MAX_FILE_SIGNAL_TOOLS {
            break;
        }
        tools.push(tool_name);
    }
    tools
}

fn collect_tool_history_from_normalized_session(
    session: &trace_parser::NormalizedSession,
) -> Vec<String> {
    let mut tools = Vec::new();
    for tool_call in &session.tool_calls {
        if tools
            .iter()
            .any(|existing| existing == &tool_call.tool_name)
        {
            continue;
        }
        if tools.len() >= MAX_FILE_SIGNAL_TOOLS {
            break;
        }
        tools.push(tool_call.tool_name.clone());
    }
    tools
}

fn build_resume_command(provider: &str, session_id: &str) -> Option<String> {
    match provider {
        "codex" if !session_id.is_empty() => Some(format!("codex resume {session_id}")),
        _ => None,
    }
}

fn normalize_command_signature(command: &str) -> String {
    command.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_signal_prompt_text(text: &str) -> String {
    normalize_command_signature(text)
}

fn normalize_user_prompt(text: &str) -> String {
    let mut normalized = text.trim().to_string();
    if normalized.starts_with("<cwd>") || normalized.starts_with("<turn_aborted>") {
        return String::new();
    }
    if let Some(end_index) = normalized.rfind("</INSTRUCTIONS>") {
        normalized = normalized[end_index + "</INSTRUCTIONS>".len()..]
            .trim()
            .to_string();
    }

    for (start_marker, end_marker) in [
        ("<environment_context>", "</environment_context>"),
        ("<image", "</image>"),
    ] {
        while let Some(start) = normalized.find(start_marker) {
            let end = if let Some(end_rel) = normalized[start..].find(end_marker) {
                start + end_rel + end_marker.len()
            } else {
                normalized.len()
            };
            normalized.replace_range(start..end, " ");
        }
    }

    for marker in [
        "<image",
        "</image>",
        "<environment_context>",
        "</environment_context>",
    ] {
        normalized = normalized.replace(marker, " ");
    }

    while let Some(start) = normalized.find('<') {
        let Some(end_rel) = normalized[start..].find('>') else {
            break;
        };
        let end = start + end_rel;
        normalized.replace_range(start..=end, " ");
    }

    truncate_diagnostic_text(&normalize_signal_prompt_text(&normalized), 180)
}

fn truncate_diagnostic_text(text: &str, max_length: usize) -> String {
    let normalized = normalize_command_signature(text);
    if normalized.len() <= max_length {
        return normalized;
    }
    let truncated = normalized
        .char_indices()
        .take_while(|(index, _)| *index < max_length.saturating_sub(3))
        .map(|(_, ch)| ch)
        .collect::<String>();
    format!("{truncated}...")
}

fn unwrap_shell_command(command: &str) -> String {
    let tokens = shell_like_split(command);
    if tokens.len() < 3 {
        return command.to_string();
    }

    let executable = tokens
        .first()
        .map(|token| token.rsplit('/').next().unwrap_or(token.as_str()))
        .unwrap_or_default();
    let shell_like = executable == "sh" || executable == "bash" || executable == "zsh";
    if !shell_like {
        return command.to_string();
    }

    if let Some(c_flag_index) = tokens
        .iter()
        .position(|token| token == "-c" || token == "-lc")
    {
        if tokens.get(c_flag_index + 1).is_some() {
            return tokens[c_flag_index + 1..].join(" ");
        }
    }

    command.to_string()
}

fn extract_read_candidates_from_command(command: &str) -> Vec<String> {
    let inner_command = unwrap_shell_command(command);
    let tokens = shell_like_split(&inner_command);
    if tokens.is_empty() {
        return Vec::new();
    }

    let executable = tokens
        .first()
        .map(|token| token.rsplit('/').next().unwrap_or(token.as_str()))
        .unwrap_or_default();
    let read_commands = ["bat", "cat", "head", "less", "more", "nl", "sed", "tail"];
    if !read_commands.contains(&executable) {
        return Vec::new();
    }

    tokens[1..]
        .iter()
        .filter(|token| {
            token.as_str() != "--"
                && !token.starts_with('-')
                && token.as_str() != "&&"
                && token.as_str() != "|"
                && looks_like_file_path_token(token)
        })
        .cloned()
        .collect()
}

fn looks_like_file_path_token(token: &str) -> bool {
    if token.is_empty() {
        return false;
    }
    if matches!(token, "&&" | "|" | ";") {
        return false;
    }
    if token.ends_with('p')
        && token.contains(',')
        && token
            .chars()
            .all(|ch| ch.is_ascii_digit() || ch == ',' || ch == 'p')
    {
        return false;
    }

    token.contains('/')
        || token.contains('.')
        || token.contains('[')
        || matches!(
            token,
            "Cargo.toml" | "Cargo.lock" | "package.json" | "README.md" | "AGENTS.md"
        )
}

fn path_looks_file_like(candidate: &str) -> bool {
    let base = Path::new(candidate)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(candidate);
    base.contains('.')
        || matches!(
            base,
            "Dockerfile" | "Makefile" | "Cargo.toml" | "Cargo.lock"
        )
}

fn normalize_repo_relative_with_cwd(
    repo_root: &Path,
    session_cwd: &Path,
    value: &str,
) -> Option<String> {
    let clean = value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim_matches('`')
        .trim_end_matches([',', ';', ':'])
        .replace('\\', "/");
    if clean.is_empty() || clean == "/dev/null" {
        return None;
    }
    if !looks_like_file_path_token(&clean) {
        return None;
    }
    if clean.chars().any(char::is_whitespace) {
        return None;
    }

    let candidate_path = Path::new(&clean);
    if candidate_path.is_absolute() {
        if candidate_path.is_dir() {
            return None;
        }
        let relative = candidate_path
            .strip_prefix(repo_root)
            .ok()
            .map(|path| path.to_string_lossy().replace('\\', "/"))?;
        if !candidate_path.is_file() && !path_looks_file_like(&relative) {
            return None;
        }
        return Some(relative);
    }

    let session_resolved = session_cwd.join(&clean);
    if let Ok(relative) = session_resolved.strip_prefix(repo_root) {
        if session_resolved.is_dir() {
            return None;
        }
        let relative = relative.to_string_lossy().replace('\\', "/");
        if !session_resolved.is_file() && !path_looks_file_like(&relative) {
            return None;
        }
        return Some(relative);
    }

    let repo_resolved = repo_root.join(&clean);
    if repo_resolved.is_dir() {
        return None;
    }
    let relative = repo_resolved
        .strip_prefix(repo_root)
        .ok()
        .map(|path| path.to_string_lossy().replace('\\', "/"))?;
    if !repo_resolved.is_file() && !path_looks_file_like(&relative) {
        return None;
    }
    Some(relative)
}

fn tool_name_from_feature_event(event: &Value) -> Option<String> {
    if let Some(name) = event.get("name").and_then(Value::as_str) {
        return Some(name.to_string());
    }
    if let Some(tool_name) = event.get("tool_name").and_then(Value::as_str) {
        return Some(tool_name.to_string());
    }
    match event.get("type").and_then(Value::as_str) {
        Some("exec_command_begin") | Some("exec_command_end") => Some("exec_command".to_string()),
        _ => command_from_feature_event(event).map(|_| "exec_command".to_string()),
    }
}

fn extract_user_prompt_from_response_item(event: &Value) -> Option<String> {
    if event.get("type").and_then(Value::as_str) != Some("message")
        || event.get("role").and_then(Value::as_str) != Some("user")
    {
        return None;
    }

    let mut parts = Vec::new();
    for item in event
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let is_input_text = item.get("type").and_then(Value::as_str) == Some("input_text");
        let text = item.get("text").and_then(Value::as_str).map(str::trim);
        if is_input_text && text.is_some_and(|text| !text.is_empty()) {
            parts.push(text.unwrap().to_string());
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

fn user_prompt_from_feature_event(event: &Value) -> Option<String> {
    if event.get("type").and_then(Value::as_str) == Some("user_message") {
        return event
            .get("message")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
    }

    extract_user_prompt_from_response_item(event)
}

fn command_from_feature_event(event: &Value) -> Option<String> {
    if event.get("type").and_then(Value::as_str) == Some("function_call") {
        if let Some(arguments) = event.get("arguments").and_then(Value::as_str) {
            if event.get("name").and_then(Value::as_str) == Some("exec_command") {
                if let Ok(parsed) = serde_json::from_str::<Value>(arguments) {
                    if let Some(cmd) = parsed
                        .get("command")
                        .and_then(Value::as_str)
                        .or_else(|| parsed.get("cmd").and_then(Value::as_str))
                    {
                        return Some(cmd.to_string());
                    }
                }
            }
            return Some(arguments.trim().to_string());
        }
    }

    if let Some(command) = event
        .get("command")
        .and_then(Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|command| !command.is_empty())
    {
        return Some(command);
    }

    event
        .get("cmd")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or_else(|| {
            event.get("tool_input").and_then(|tool_input| {
                tool_input
                    .get("command")
                    .and_then(Value::as_str)
                    .or_else(|| tool_input.get("cmd").and_then(Value::as_str))
                    .map(ToOwned::to_owned)
            })
        })
}

fn command_output_from_feature_event(event: &Value) -> Option<String> {
    for value in [
        event.get("aggregated_output"),
        event.get("output"),
        event.get("stdout"),
        event.get("stderr"),
        event.get("result"),
    ] {
        if let Some(text) = value.and_then(Value::as_str).map(str::trim) {
            if !text.is_empty() {
                return Some(text.to_string());
            }
        }
    }

    event.get("tool_output").and_then(|tool_output| {
        [
            tool_output.get("aggregated_output"),
            tool_output.get("output"),
            tool_output.get("stdout"),
            tool_output.get("stderr"),
            tool_output.get("result"),
        ]
        .into_iter()
        .find_map(|value| value.and_then(Value::as_str).map(str::trim))
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
    })
}

fn extract_read_files_from_event(
    event: &Value,
    repo_root: &Path,
    session_cwd: &Path,
) -> Vec<String> {
    let mut candidates = HashSet::new();
    let tool_name = tool_name_from_feature_event(event)
        .unwrap_or_default()
        .to_ascii_lowercase();
    let direct_read_tool = tool_name.contains("read")
        || tool_name == "open"
        || tool_name == "view"
        || tool_name == "fs/read_text_file";

    if direct_read_tool {
        collect_file_values(event, &mut candidates);
    }

    if let Some(command) = command_from_feature_event(event) {
        for token in extract_read_candidates_from_command(&command) {
            candidates.insert(token);
        }
    }

    let mut read_files = Vec::new();
    for candidate in candidates {
        if let Some(normalized) =
            normalize_repo_relative_with_cwd(repo_root, session_cwd, &candidate)
        {
            if !read_files.contains(&normalized) {
                read_files.push(normalized);
            }
        }
    }
    read_files
}

fn extract_changed_files_from_command_output(command: &str, output: &str) -> Vec<String> {
    let mut changed = HashSet::new();
    let lines = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();

    if command.contains("git status --short") {
        for line in &lines {
            let path_candidate = line
                .split_whitespace()
                .last()
                .map(str::trim)
                .or(Some(*line))
                .unwrap_or_default();
            let path_candidate = path_candidate
                .split(" -> ")
                .last()
                .map(str::trim)
                .unwrap_or(path_candidate);
            if !path_candidate.is_empty() {
                changed.insert(path_candidate.to_string());
            }
        }
    }

    if command.contains("git diff --name-only") {
        for line in &lines {
            changed.insert((*line).to_string());
        }
    }

    if command.contains("git diff") || command.contains("git show") {
        for line in &lines {
            if let Some(rest) = line.strip_prefix("diff --git a/") {
                let path_candidate = rest.split(" b/").nth(1).map(str::trim).unwrap_or_default();
                if !path_candidate.is_empty() {
                    changed.insert(path_candidate.to_string());
                }
            }
        }
    }

    changed.into_iter().collect()
}

fn is_tool_like_feature_event(event: &Value) -> bool {
    match event.get("type").and_then(Value::as_str) {
        Some("function_call") | Some("exec_command_begin") | Some("exec_command_end") => true,
        _ => {
            event.get("tool_input").is_some()
                || event.get("command").is_some()
                || event.get("cmd").is_some()
                || event.get("tool_name").is_some()
                || event.get("name").is_some()
        }
    }
}

fn is_explicit_write_tool_name(tool_name: &str) -> bool {
    let tool_name = tool_name.trim().to_ascii_lowercase();
    matches!(
        tool_name.as_str(),
        "apply_patch"
            | "create_file"
            | "update_file"
            | "delete_file"
            | "write"
            | "write_file"
            | "write_stdin"
            | "replace"
            | "rename"
            | "move"
            | "copy"
            | "edit"
            | "modify"
            | "fs/write_file"
            | "fs/write_text_file"
            | "fs/edit_file"
    ) || tool_name.contains("write")
        || tool_name.contains("edit")
        || tool_name.contains("modify")
        || tool_name.contains("rename")
        || tool_name.contains("move")
        || tool_name.contains("copy")
}

fn collect_changed_files_from_raw_events(
    raw_events: &[Value],
    repo_root: &Path,
    session_cwd: &Path,
) -> Vec<String> {
    let mut changed_files = BTreeSet::new();
    for event in raw_events {
        if !is_tool_like_feature_event(event) {
            continue;
        }
        let mut candidates = HashSet::new();
        let tool_name = tool_name_from_feature_event(event).unwrap_or_default();
        if is_explicit_write_tool_name(&tool_name) {
            if let Some(tool_input) = event.get("tool_input") {
                collect_file_values(tool_input, &mut candidates);
            }

            if event.get("type").and_then(Value::as_str) == Some("function_call") {
                if let Some(arguments) = event.get("arguments").and_then(Value::as_str) {
                    if let Ok(parsed) = serde_json::from_str::<Value>(arguments) {
                        collect_file_values(&parsed, &mut candidates);
                    } else {
                        for path in parse_patch_block(arguments) {
                            candidates.insert(path);
                        }
                    }
                }
            }
        }
        if let Some(command) = command_from_feature_event(event) {
            for path in parse_patch_block(&command) {
                candidates.insert(path);
            }
            for path in parse_command_paths(&command) {
                candidates.insert(path);
            }
            if let Some(output) = command_output_from_feature_event(event) {
                for path in extract_changed_files_from_command_output(&command, &output) {
                    candidates.insert(path);
                }
            }
        }

        for candidate in candidates {
            if let Some(normalized) =
                normalize_repo_relative_with_cwd(repo_root, session_cwd, &candidate)
            {
                changed_files.insert(normalized);
            }
        }
    }
    changed_files.into_iter().collect()
}

fn detect_failed_tool_call(event: &Value) -> Option<FileSessionToolFailureResponse> {
    let exit_code = event
        .get("exit_code")
        .and_then(Value::as_i64)
        .or_else(|| event.get("exitCode").and_then(Value::as_i64));
    let status = event
        .get("status")
        .and_then(Value::as_str)
        .map(|status| status.trim().to_ascii_lowercase())
        .unwrap_or_default();
    let failed = exit_code.is_some_and(|code| code != 0) || status == "failed" || status == "error";
    if !failed {
        return None;
    }

    let command_output = command_output_from_feature_event(event);
    let message = event
        .get("stderr")
        .and_then(Value::as_str)
        .or_else(|| event.get("error").and_then(Value::as_str))
        .or_else(|| event.get("message").and_then(Value::as_str))
        .or(command_output.as_deref())
        .filter(|text| !text.trim().is_empty())
        .map(|text| truncate_diagnostic_text(text, 220))
        .unwrap_or_else(|| {
            exit_code
                .map(|code| format!("Exit code {code}"))
                .unwrap_or_else(|| "Tool call failed".to_string())
        });

    Some(FileSessionToolFailureResponse {
        tool_name: tool_name_from_feature_event(event).unwrap_or_else(|| "tool".to_string()),
        command: command_from_feature_event(event)
            .map(|command| truncate_diagnostic_text(&command, 220)),
        message,
    })
}

fn derive_transcript_session_diagnostics(
    raw_events: &[Value],
    repo_root: &Path,
    session_cwd: &Path,
    written_files: &[String],
) -> FileSessionDiagnosticsResponse {
    let mut tool_calls_by_name: HashMap<String, usize> = HashMap::new();
    let mut read_counts: HashMap<String, usize> = HashMap::new();
    let mut repeated_command_counts: HashMap<String, usize> = HashMap::new();
    let mut failed_tools = Vec::new();
    let mut pending_exec_requests: HashMap<String, usize> = HashMap::new();
    let mut failed_tool_call_count = 0usize;

    let increment_tool_call = |tool_calls_by_name: &mut HashMap<String, usize>, tool_name: &str| {
        *tool_calls_by_name.entry(tool_name.to_string()).or_insert(0) += 1;
    };

    let increment_command = |repeated_command_counts: &mut HashMap<String, usize>,
                             signature: &str| {
        if signature.is_empty() {
            return;
        }
        *repeated_command_counts
            .entry(signature.to_string())
            .or_insert(0) += 1;
    };

    for event in raw_events {
        let tool_name = tool_name_from_feature_event(event).unwrap_or_default();
        let command = command_from_feature_event(event).unwrap_or_default();
        let command_signature = if command.is_empty() {
            String::new()
        } else {
            normalize_command_signature(&unwrap_shell_command(&command))
        };

        for read_file in extract_read_files_from_event(event, repo_root, session_cwd) {
            *read_counts.entry(read_file).or_insert(0) += 1;
        }

        match event.get("type").and_then(Value::as_str) {
            Some("function_call") => {
                if !tool_name.is_empty() {
                    increment_tool_call(&mut tool_calls_by_name, &tool_name);
                }
                if tool_name == "exec_command" && !command_signature.is_empty() {
                    *pending_exec_requests
                        .entry(command_signature.clone())
                        .or_insert(0) += 1;
                }
                increment_command(&mut repeated_command_counts, &command_signature);
            }
            Some("exec_command_begin") | Some("exec_command_end") => {
                let pending = pending_exec_requests
                    .get(&command_signature)
                    .copied()
                    .unwrap_or_default();
                if pending > 0 {
                    pending_exec_requests.insert(command_signature.clone(), pending - 1);
                } else {
                    increment_tool_call(&mut tool_calls_by_name, "exec_command");
                    increment_command(&mut repeated_command_counts, &command_signature);
                }
            }
            _ => {
                if !tool_name.is_empty() {
                    increment_tool_call(&mut tool_calls_by_name, &tool_name);
                    increment_command(&mut repeated_command_counts, &command_signature);
                }
            }
        }

        if let Some(failure) = detect_failed_tool_call(event) {
            failed_tool_call_count += 1;
            if failed_tools.len() < MAX_FILE_SIGNAL_FAILED_TOOLS {
                failed_tools.push(failure);
            }
        }
    }

    let mut read_files = read_counts.keys().cloned().collect::<Vec<_>>();
    read_files.sort();

    let mut repeated_read_files = read_counts
        .iter()
        .filter(|(_, count)| **count > 1)
        .map(|(file_path, count)| (file_path.clone(), *count))
        .collect::<Vec<_>>();
    repeated_read_files
        .sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    let repeated_read_files = repeated_read_files
        .into_iter()
        .map(|(file_path, count)| format!("{file_path} x{count}"))
        .collect::<Vec<_>>();

    let mut repeated_commands = repeated_command_counts
        .iter()
        .filter(|(_, count)| **count > 1)
        .map(|(command, count)| (command.clone(), *count))
        .collect::<Vec<_>>();
    repeated_commands
        .sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    let repeated_commands = repeated_commands
        .into_iter()
        .take(MAX_FILE_SIGNAL_REPEATED_COMMANDS)
        .map(|(command, count)| format!("{} x{count}", truncate_diagnostic_text(&command, 120)))
        .collect::<Vec<_>>();

    let tool_call_count = tool_calls_by_name.values().sum();
    let mut written_files = written_files.to_vec();
    written_files.sort();
    written_files.dedup();

    FileSessionDiagnosticsResponse {
        tool_call_count,
        failed_tool_call_count,
        tool_calls_by_name,
        read_files,
        written_files,
        repeated_read_files,
        repeated_commands,
        failed_tools,
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
    let (session_stats, _file_stats, _file_signals, _analyses) =
        collect_session_stats(&repo_root, &feature_tree);

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
    let (session_stats, file_stats, file_signals, analyses) =
        collect_session_stats(&repo_root, &feature_tree);

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
    for analysis_path in collect_feature_analysis_paths(&feature.id, &analyses) {
        if !all_files.contains(&analysis_path) {
            all_files.push(analysis_path);
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
    let feature_file_signals: HashMap<String, FileSignalResponse> = all_files
        .iter()
        .filter_map(|f| {
            file_signals
                .get(f)
                .map(|signal| (f.clone(), signal.clone()))
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
        file_signals: feature_file_signals,
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
    let (_session_stats, _file_stats, _file_signals, analyses) =
        collect_session_stats(&repo_root, &feature_tree);
    let mut all_files: Vec<String> = feature.source_files.clone();
    for source_file in &feature.source_files {
        for link in surface_catalog.best_links_for_path(source_file) {
            if !all_files.contains(&link.source_path) {
                all_files.push(link.source_path.clone());
            }
        }
    }
    for analysis_path in collect_feature_analysis_paths(&feature.id, &analyses) {
        if !all_files.contains(&analysis_path) {
            all_files.push(analysis_path);
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
        let mut file_signals = HashMap::new();
        let signal_context = SessionSignalContext {
            provider: "codex".to_string(),
            prompt_history: vec!["inspect session recovery".to_string()],
            tool_history: Vec::new(),
            resume_command: Some("codex resume sess-1".to_string()),
            diagnostics: None,
        };
        let analysis = SessionAnalysis {
            session_id: "sess-1".to_string(),
            changed_files: vec![
                "src/app/workspace/[workspaceId]/sessions/page.tsx".to_string(),
                "src/app/workspace/[workspaceId]/sessions/page.tsx".to_string(),
            ],
            tool_call_counts: BTreeMap::new(),
            prompt_previews: Vec::new(),
            file_operation_counts: BTreeMap::new(),
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
            &mut AnalysisRecordTargets {
                stats: &mut stats,
                file_stats: &mut file_stats,
                file_signals: &mut file_signals,
            },
            "sess-1",
            &signal_context,
            &["src/app/workspace/[workspaceId]/sessions/page.tsx".to_string()],
            &analysis,
            "2026-04-17T09:00:00",
        );

        let session_recovery = stats.get("session-recovery").expect("feature stat");
        assert_eq!(session_recovery.session_ids.len(), 1);
        assert_eq!(session_recovery.changed_files.len(), 1);
        assert_eq!(session_recovery.updated_at, "2026-04-17T09:00:00");
        assert!(!stats.contains_key("workspace-overview"));

        let file_stat = file_stats
            .get("src/app/workspace/[workspaceId]/sessions/page.tsx")
            .expect("file stat");
        assert_eq!(file_stat.change_count, 1);
        assert_eq!(file_stat.session_ids.len(), 1);

        let signal = file_signals
            .get("src/app/workspace/[workspaceId]/sessions/page.tsx")
            .expect("file signal");
        assert_eq!(signal.sessions.len(), 1);
        assert_eq!(signal.sessions[0].provider, "codex");
        assert_eq!(signal.sessions[0].session_id, "sess-1");
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

        let input =
            build_feature_trace_input_from_transcript(&repo_root, &transcript, &registry, &[], &[]);

        assert_eq!(input.session_id, "sess-1");
        assert_eq!(input.changed_files, vec!["src/app/page.tsx".to_string()]);
        assert!(input.tool_call_names.contains(&"exec_command".to_string()));
    }

    #[test]
    fn raw_changed_files_ignore_paths_mentioned_only_in_read_output() {
        let dir = tempdir().expect("tempdir");
        let repo_root = dir.path().join("repo");
        let session_cwd = repo_root.clone();
        std::fs::create_dir_all(repo_root.join("src/app")).expect("repo src dir");
        std::fs::create_dir_all(repo_root.join("crates/routa-server/src/api"))
            .expect("repo rust dir");
        std::fs::write(
            repo_root.join("src/app/page.tsx"),
            "export default function Page() {}",
        )
        .expect("write page");
        std::fs::write(
            repo_root.join("crates/routa-server/src/api/feature_explorer.rs"),
            "fn placeholder() {}",
        )
        .expect("write rust file");

        let raw_events = vec![
            json!({
                "type": "exec_command_end",
                "name": "exec_command",
                "command": ["/bin/zsh", "-lc", "sed -n '1,10p' src/app/page.tsx"],
                "aggregated_output": "related Rust implementation: crates/routa-server/src/api/feature_explorer.rs",
                "status": "completed",
                "exit_code": 0
            }),
            json!({
                "type": "function_call",
                "name": "apply_patch",
                "arguments": "*** Begin Patch\n*** Update File: src/app/page.tsx\n@@\n-foo\n+bar\n*** End Patch\n"
            }),
        ];

        let changed_files =
            collect_changed_files_from_raw_events(&raw_events, &repo_root, &session_cwd);

        assert_eq!(changed_files, vec!["src/app/page.tsx".to_string()]);
    }

    #[test]
    fn record_analysis_keeps_most_recent_file_signal_sessions() {
        let mut stats = HashMap::new();
        let mut file_stats = HashMap::new();
        let mut file_signals = HashMap::new();
        let changed_files = ["src/app/page.tsx".to_string()];

        for day in 1..=7 {
            let signal_context = SessionSignalContext {
                provider: "codex".to_string(),
                prompt_history: vec![format!("prompt-{day}")],
                tool_history: vec!["exec_command".to_string()],
                resume_command: Some(format!("codex resume sess-{day}")),
                diagnostics: None,
            };
            let analysis = SessionAnalysis {
                session_id: format!("sess-{day}"),
                changed_files: changed_files.to_vec(),
                tool_call_counts: BTreeMap::new(),
                prompt_previews: Vec::new(),
                file_operation_counts: BTreeMap::new(),
                surface_links: Vec::new(),
                feature_links: vec![ProductFeatureLink {
                    feature_id: "feature-a".to_string(),
                    feature_name: "Feature A".to_string(),
                    route: Some("/feature-a".to_string()),
                    via_path: "src/app/page.tsx".to_string(),
                    confidence: SurfaceLinkConfidence::High,
                }],
            };

            record_analysis(
                &mut AnalysisRecordTargets {
                    stats: &mut stats,
                    file_stats: &mut file_stats,
                    file_signals: &mut file_signals,
                },
                &format!("sess-{day}"),
                &signal_context,
                &changed_files,
                &analysis,
                &format!("2026-04-0{day}T09:00:00"),
            );
        }

        let sessions = &file_signals
            .get("src/app/page.tsx")
            .expect("file signal")
            .sessions;

        assert_eq!(sessions.len(), MAX_FILE_SIGNAL_SESSIONS);
        assert_eq!(sessions[0].session_id, "sess-7");
        assert_eq!(sessions[MAX_FILE_SIGNAL_SESSIONS - 1].session_id, "sess-2");
        assert!(sessions
            .iter()
            .all(|session| session.session_id != "sess-1"));
    }

    #[test]
    fn record_analysis_uses_feature_via_path_for_file_signals_when_changed_files_do_not_match() {
        let mut stats = HashMap::new();
        let mut file_stats = HashMap::new();
        let mut file_signals = HashMap::new();
        let signal_context = SessionSignalContext {
            provider: "codex".to_string(),
            prompt_history: vec!["inspect workspace overview".to_string()],
            tool_history: vec!["exec_command".to_string()],
            resume_command: Some("codex resume sess-overview".to_string()),
            diagnostics: None,
        };
        let analysis = SessionAnalysis {
            session_id: "sess-overview".to_string(),
            changed_files: vec!["src/app/workspace/[workspaceId]/overview/page.tsx".to_string()],
            tool_call_counts: BTreeMap::new(),
            prompt_previews: Vec::new(),
            file_operation_counts: BTreeMap::new(),
            surface_links: Vec::new(),
            feature_links: vec![ProductFeatureLink {
                feature_id: "workspace-overview".to_string(),
                feature_name: "Workspace Overview".to_string(),
                route: Some("/workspace/:workspaceId/overview".to_string()),
                via_path: "src/app/workspace/[workspaceId]/overview/page.tsx".to_string(),
                confidence: SurfaceLinkConfidence::High,
            }],
        };

        record_analysis(
            &mut AnalysisRecordTargets {
                stats: &mut stats,
                file_stats: &mut file_stats,
                file_signals: &mut file_signals,
            },
            "sess-overview",
            &signal_context,
            &["src/client/diagnostics.ts".to_string()],
            &analysis,
            "2026-04-21T15:00:00",
        );

        let overview_stat = file_stats
            .get("src/app/workspace/[workspaceId]/overview/page.tsx")
            .expect("overview file stat");
        assert_eq!(overview_stat.change_count, 1);
        assert_eq!(overview_stat.session_ids.len(), 1);

        let overview_signal = file_signals
            .get("src/app/workspace/[workspaceId]/overview/page.tsx")
            .expect("overview file signal");
        assert_eq!(overview_signal.sessions.len(), 1);
        assert_eq!(overview_signal.sessions[0].session_id, "sess-overview");
        assert_eq!(
            overview_signal.sessions[0].changed_files,
            vec!["src/client/diagnostics.ts".to_string()]
        );
    }

    #[test]
    fn collect_feature_analysis_paths_returns_unique_paths_for_feature() {
        let analyses = vec![
            SessionAnalysis {
                session_id: "sess-1".to_string(),
                changed_files: Vec::new(),
                tool_call_counts: BTreeMap::new(),
                prompt_previews: Vec::new(),
                file_operation_counts: BTreeMap::new(),
                surface_links: Vec::new(),
                feature_links: vec![
                    ProductFeatureLink {
                        feature_id: "workspace-overview".to_string(),
                        feature_name: "Workspace Overview".to_string(),
                        route: Some("/workspace/:workspaceId/overview".to_string()),
                        via_path: "src/app/workspace/[workspaceId]/overview/page.tsx".to_string(),
                        confidence: SurfaceLinkConfidence::High,
                    },
                    ProductFeatureLink {
                        feature_id: "workspace-overview".to_string(),
                        feature_name: "Workspace Overview".to_string(),
                        route: Some("/workspace/:workspaceId".to_string()),
                        via_path: "src/app/workspace/[workspaceId]/page.tsx".to_string(),
                        confidence: SurfaceLinkConfidence::High,
                    },
                ],
            },
            SessionAnalysis {
                session_id: "sess-2".to_string(),
                changed_files: Vec::new(),
                tool_call_counts: BTreeMap::new(),
                prompt_previews: Vec::new(),
                file_operation_counts: BTreeMap::new(),
                surface_links: Vec::new(),
                feature_links: vec![ProductFeatureLink {
                    feature_id: "workspace-overview".to_string(),
                    feature_name: "Workspace Overview".to_string(),
                    route: Some("/workspace/:workspaceId".to_string()),
                    via_path: "src/app/workspace/[workspaceId]/page.tsx".to_string(),
                    confidence: SurfaceLinkConfidence::High,
                }],
            },
        ];

        assert_eq!(
            collect_feature_analysis_paths("workspace-overview", &analyses),
            vec![
                "src/app/workspace/[workspaceId]/overview/page.tsx".to_string(),
                "src/app/workspace/[workspaceId]/page.tsx".to_string(),
            ]
        );
    }
}
