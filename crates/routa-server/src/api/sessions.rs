use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use regex::Regex;
use routa_core::trace::{TraceEventType, TraceQuery, TraceReader};
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path as FsPath, PathBuf};

use crate::application::sessions::{
    ListSessionsQuery as SessionListQuery, SessionApplicationService,
};
use crate::error::ServerError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_sessions))
        .route(
            "/{session_id}",
            get(get_session)
                .patch(rename_session)
                .delete(delete_session),
        )
        .route("/{session_id}/history", get(get_session_history))
        .route("/{session_id}/transcript", get(get_session_transcript))
        .route("/{session_id}/reposlide-result", get(get_reposlide_result))
        .route(
            "/{session_id}/reposlide-result/download",
            get(download_reposlide_result),
        )
        .route("/{session_id}/context", get(get_session_context))
        .route("/{session_id}/disconnect", post(disconnect_session))
        .route("/{session_id}/fork", post(fork_session))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionTranscriptPayload {
    session_id: String,
    history: Vec<Value>,
    messages: Vec<TranscriptMessage>,
    source: &'static str,
    history_message_count: usize,
    trace_message_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    latest_event_kind: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptMessage {
    id: String,
    role: &'static str,
    content: String,
    timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_raw_input: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_raw_output: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    raw_data: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepoSlideResultPayload {
    session_id: String,
    result: RepoSlideSessionResult,
    #[serde(skip_serializing_if = "Option::is_none")]
    latest_event_kind: Option<String>,
    source: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepoSlideSessionResult {
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    deck_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    download_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    latest_assistant_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListSessionsQuery {
    workspace_id: Option<String>,
    parent_session_id: Option<String>,
    surface: Option<String>,
    limit: Option<usize>,
}

const TEAM_LEAD_SPECIALIST_ID: &str = "team-agent-lead";

/// GET /api/sessions — List ACP sessions.
/// Compatible with the Next.js frontend's session-panel.tsx and chat-panel.tsx.
///
/// Merges in-memory sessions with persisted sessions from the database.
async fn list_sessions(
    State(state): State<AppState>,
    Query(query): Query<ListSessionsQuery>,
) -> Json<serde_json::Value> {
    let service = SessionApplicationService::new(state);
    let limit = query.limit;
    let surface = query.surface.clone();
    let parent_session_id = query.parent_session_id.clone();
    let use_team_surface =
        should_apply_team_surface(surface.as_deref(), query.parent_session_id.as_deref());
    let service_limit = service_limit_for_query(limit, query.parent_session_id.as_deref());
    let mut sessions = service
        .list_sessions(SessionListQuery {
            workspace_id: query.workspace_id,
            parent_session_id,
            limit: service_limit,
        })
        .await;

    if query.parent_session_id.is_none() {
        sessions.retain(session_is_non_empty);
    }

    if use_team_surface {
        sessions = list_team_runs(sessions);
    }

    if let Some(limit) = limit {
        sessions.truncate(limit);
    }

    Json(serde_json::json!({ "sessions": sessions }))
}

fn session_is_non_empty(session: &Value) -> bool {
    session
        .get("firstPromptSent")
        .and_then(Value::as_bool)
        .unwrap_or(true)
}

fn session_id(session: &Value) -> Option<&str> {
    session.get("sessionId").and_then(Value::as_str)
}

fn parent_session_id(session: &Value) -> Option<&str> {
    session.get("parentSessionId").and_then(Value::as_str)
}

fn session_role(session: &Value) -> Option<&str> {
    session.get("role").and_then(Value::as_str)
}

fn session_name(session: &Value) -> Option<&str> {
    session.get("name").and_then(Value::as_str)
}

fn session_specialist_id(session: &Value) -> Option<&str> {
    session.get("specialistId").and_then(Value::as_str)
}

fn normalize_session_name(name: Option<&str>) -> String {
    name.unwrap_or_default()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn should_apply_team_surface(surface: Option<&str>, parent_session_id: Option<&str>) -> bool {
    surface == Some("team") && parent_session_id.is_none()
}

fn service_limit_for_query(limit: Option<usize>, parent_session_id: Option<&str>) -> Option<usize> {
    if parent_session_id.is_some() {
        limit
    } else {
        None
    }
}

fn has_explicit_team_run_marker(session: &Value) -> bool {
    if session_specialist_id(session) == Some(TEAM_LEAD_SPECIALIST_ID) {
        return true;
    }

    if !session_role(session)
        .map(|role| role.eq_ignore_ascii_case("ROUTA"))
        .unwrap_or(false)
    {
        return false;
    }

    let normalized_name = normalize_session_name(session_name(session));
    if normalized_name.is_empty() {
        return false;
    }

    normalized_name.starts_with("team -")
        || normalized_name.starts_with("team run")
        || normalized_name.contains("team lead")
}

fn list_team_runs(sessions: Vec<Value>) -> Vec<Value> {
    let mut child_map: HashMap<String, Vec<String>> = HashMap::new();
    let ordered_sessions = sessions;

    for session in ordered_sessions.iter() {
        let Some(parent_id) = parent_session_id(session) else {
            continue;
        };
        let Some(child_id) = session_id(session) else {
            continue;
        };
        child_map
            .entry(parent_id.to_string())
            .or_default()
            .push(child_id.to_string());
    }

    let mut descendants_by_session_id: HashMap<String, usize> = HashMap::new();
    let mut root_sessions = Vec::new();

    for session in ordered_sessions.iter() {
        if parent_session_id(session).is_some() {
            continue;
        }

        let Some(current_session_id) = session_id(session) else {
            continue;
        };
        let direct_delegates = child_map
            .get(current_session_id)
            .map(|children| children.len())
            .unwrap_or(0);
        let descendants = count_descendants(
            current_session_id,
            &child_map,
            &mut descendants_by_session_id,
            &mut Vec::new(),
        );

        if has_explicit_team_run_marker(session)
            || session_role(session)
                .map(|role| role.eq_ignore_ascii_case("ROUTA"))
                .unwrap_or(false)
                && descendants > 0
        {
            let mut session_with_counts = session.clone();
            if let Some(object) = session_with_counts.as_object_mut() {
                object.insert("directDelegates".to_string(), Value::from(direct_delegates));
                object.insert("descendants".to_string(), Value::from(descendants));
            }
            root_sessions.push(session_with_counts);
        }
    }

    root_sessions
}

fn count_descendants(
    session_id: &str,
    child_map: &HashMap<String, Vec<String>>,
    descendants_by_session_id: &mut HashMap<String, usize>,
    visiting: &mut Vec<String>,
) -> usize {
    if let Some(cached) = descendants_by_session_id.get(session_id) {
        return *cached;
    }
    if visiting.iter().any(|current| current == session_id) {
        return 0;
    }

    visiting.push(session_id.to_string());
    let total = child_map
        .get(session_id)
        .map(|children| {
            children
                .iter()
                .map(|child_id| {
                    if visiting.iter().any(|current| current == child_id) {
                        0
                    } else {
                        1 + count_descendants(
                            child_id,
                            child_map,
                            descendants_by_session_id,
                            visiting,
                        )
                    }
                })
                .sum()
        })
        .unwrap_or(0);
    visiting.pop();
    descendants_by_session_id.insert(session_id.to_string(), total);
    total
}

/// GET /api/sessions/{session_id} — Get session metadata.
///
/// First tries to get session from in-memory AcpManager.
/// Falls back to database if session is not in memory (e.g. after server restart).
async fn get_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let service = SessionApplicationService::new(state);
    let session = service.get_session(&session_id).await?;

    Ok(Json(serde_json::json!({
        "session": session
    })))
}

#[derive(Debug, Deserialize)]
struct RenameSessionRequest {
    name: String,
}

/// PATCH /api/sessions/{session_id} — Rename a session.
async fn rename_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(body): Json<RenameSessionRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(ServerError::BadRequest("Invalid name".to_string()));
    }

    // Update in-memory (may be None if session is DB-only after restart)
    let in_memory_found = state
        .acp_manager
        .rename_session(&session_id, name)
        .await
        .is_some();

    // Always persist the rename to the database
    state.acp_session_store.rename(&session_id, name).await?;

    // If neither memory nor DB had the session, return 404
    if !in_memory_found {
        // Verify it exists in DB (rename is idempotent, so check row count via get)
        if state.acp_session_store.get(&session_id).await?.is_none() {
            return Err(ServerError::NotFound("Session not found".to_string()));
        }
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// DELETE /api/sessions/{session_id} — Delete a session.
async fn delete_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    // Try to kill in-memory process (may be None if DB-only after restart)
    let in_memory_found = state
        .acp_manager
        .delete_session(&session_id)
        .await
        .is_some();

    // Always delete from the database
    state.acp_session_store.delete(&session_id).await?;

    // If neither memory nor DB had the session, return 404
    if !in_memory_found {
        // We already deleted from DB; if 0 rows, it was already gone
        // Return 404 only when we have confirmation it doesn't exist
        // (delete is idempotent, so we just return ok even if not found)
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// POST /api/sessions/{session_id}/disconnect — Disconnect and kill an active session process.
///
/// Persists history to the database, then kills the in-memory process.
/// Unlike DELETE, this does not remove the session from the database.
async fn disconnect_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    // Check if session exists in memory
    let session = state.acp_manager.get_session(&session_id).await;
    if session.is_none() {
        return Err(ServerError::NotFound(format!(
            "Session {session_id} not found"
        )));
    }

    // Persist history before killing
    if let Some(history) = state.acp_manager.get_session_history(&session_id).await {
        if !history.is_empty() {
            let _ = state
                .acp_session_store
                .save_history(&session_id, &history)
                .await;
        }
    }

    // Kill the process
    state.acp_manager.kill_session(&session_id).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// POST /api/sessions/{session_id}/fork — Fork a session.
///
/// Creates a new session that inherits the parent's provider, workspace, and settings.
async fn fork_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    // Try in-memory first, then DB
    let (provider, workspace_id, cwd) =
        if let Some(mem) = state.acp_manager.get_session(&session_id).await {
            (
                mem.provider.clone(),
                mem.workspace_id.clone(),
                mem.cwd.clone(),
            )
        } else if let Ok(Some(row)) = state.acp_session_store.get(&session_id).await {
            (
                row.provider.clone(),
                row.workspace_id.clone(),
                row.cwd.clone(),
            )
        } else {
            return Err(ServerError::NotFound(format!(
                "Session {session_id} not found"
            )));
        };

    let new_id = uuid::Uuid::new_v4().to_string();

    state
        .acp_session_store
        .create(
            routa_core::store::acp_session_store::CreateAcpSessionParams {
                id: &new_id,
                cwd: &cwd,
                branch: None,
                workspace_id: &workspace_id,
                provider: provider.as_deref(),
                role: None,
                custom_command: None,
                custom_args: None,
                parent_session_id: Some(&session_id),
            },
        )
        .await
        .map_err(|e| ServerError::Internal(format!("Failed to create forked session: {e}")))?;

    Ok(Json(serde_json::json!({
        "sessionId": new_id,
        "parentSessionId": session_id,
        "provider": provider,
        "workspaceId": workspace_id,
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryQuery {
    consolidated: Option<bool>,
}

/// GET /api/sessions/{session_id}/history — Get session message history.
///
/// First tries to get history from in-memory AcpManager.
/// Falls back to database if in-memory is empty (e.g. after server restart).
async fn get_session_history(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let service = SessionApplicationService::new(state);
    let result = service
        .get_session_history(&session_id, query.consolidated.unwrap_or(false))
        .await?;

    Ok(Json(serde_json::json!({ "history": result })))
}

/// GET /api/sessions/{session_id}/transcript — Get preferred transcript payload.
///
/// Mirrors the Next.js transcript route shape used by chat panels.
async fn get_session_transcript(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let service = SessionApplicationService::new(state);
    let history = service.get_session_history(&session_id, true).await?;
    let cwd = std::env::current_dir()
        .map_err(|error| ServerError::Internal(format!("Failed to get cwd: {error}")))?;
    let traces = TraceReader::new(&cwd)
        .query(&TraceQuery {
            session_id: Some(session_id.clone()),
            ..TraceQuery::default()
        })
        .await
        .map_err(|error| ServerError::Internal(format!("Failed to query traces: {error}")))?;

    let payload = build_transcript_payload(&session_id, history, traces);
    Ok(Json(serde_json::to_value(payload).map_err(|error| {
        ServerError::Internal(format!("Failed to serialize transcript payload: {error}"))
    })?))
}

async fn get_reposlide_result(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let transcript = load_session_transcript(&state, &session_id).await?;
    let session_cwd = load_session_cwd(&state, &session_id).await?;
    let mut result = extract_reposlide_result(&transcript.messages);
    if resolve_reposlide_deck_file(FsPath::new(&session_cwd), result.deck_path.as_deref()).is_some()
    {
        result.download_url = Some(build_reposlide_download_url(&session_id));
    }

    Ok(Json(
        serde_json::to_value(RepoSlideResultPayload {
            session_id,
            result,
            latest_event_kind: transcript.latest_event_kind,
            source: transcript.source,
        })
        .map_err(|error| {
            ServerError::Internal(format!(
                "Failed to serialize RepoSlide result payload: {error}"
            ))
        })?,
    ))
}

async fn download_reposlide_result(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<(HeaderMap, Vec<u8>), ServerError> {
    let transcript = load_session_transcript(&state, &session_id).await?;
    let session_cwd = load_session_cwd(&state, &session_id).await?;
    let result = extract_reposlide_result(&transcript.messages);
    let artifact =
        resolve_reposlide_deck_file(FsPath::new(&session_cwd), result.deck_path.as_deref())
            .ok_or_else(|| {
                ServerError::NotFound("RepoSlide deck is not available for download".to_string())
            })?;
    let bytes = std::fs::read(&artifact.path).map_err(|error| {
        ServerError::NotFound(format!("Failed to read RepoSlide deck: {error}"))
    })?;

    let mut headers = HeaderMap::new();
    headers.insert("cache-control", "no-store".parse().unwrap());
    headers.insert(
        "content-type",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            .parse()
            .unwrap(),
    );
    headers.insert(
        "content-disposition",
        format!("attachment; filename=\"{}\"", artifact.file_name)
            .parse()
            .unwrap(),
    );

    Ok((headers, bytes))
}

/// GET /api/sessions/{session_id}/context — Get hierarchical context for a session.
///
/// Returns the session's parent, children, siblings, and recent workspace sessions.
/// Mirrors the Next.js `GET /api/sessions/[sessionId]/context` route.
async fn get_session_context(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let service = SessionApplicationService::new(state);
    let context = service.get_session_context(&session_id).await?;

    Ok(Json(serde_json::json!({
        "current": context.current,
        "parent": context.parent,
        "children": context.children,
        "siblings": context.siblings,
        "recentInWorkspace": context.recent_in_workspace,
    })))
}

fn build_transcript_payload(
    session_id: &str,
    history: Vec<Value>,
    traces: Vec<routa_core::trace::TraceRecord>,
) -> SessionTranscriptPayload {
    let history_messages = history_to_transcript_messages(&history);
    let trace_messages = traces_to_transcript_messages(&traces);
    let history_message_count = history_messages.len();
    let trace_message_count = trace_messages.len();
    let use_traces = trace_messages.len() > history_messages.len();
    let preferred_messages = if use_traces {
        trace_messages
    } else {
        history_messages
    };
    let latest_event_kind = history
        .last()
        .and_then(|entry| entry.get("update"))
        .and_then(|update| update.get("sessionUpdate"))
        .and_then(Value::as_str)
        .map(str::to_string);

    SessionTranscriptPayload {
        session_id: session_id.to_string(),
        history,
        history_message_count,
        trace_message_count,
        source: if preferred_messages.is_empty() {
            "empty"
        } else if use_traces {
            "traces"
        } else {
            "history"
        },
        latest_event_kind,
        messages: preferred_messages,
    }
}

async fn load_session_transcript(
    state: &AppState,
    session_id: &str,
) -> Result<SessionTranscriptPayload, ServerError> {
    let service = SessionApplicationService::new(state.clone());
    let history = service.get_session_history(session_id, true).await?;
    let cwd = std::env::current_dir()
        .map_err(|error| ServerError::Internal(format!("Failed to get cwd: {error}")))?;
    let traces = TraceReader::new(&cwd)
        .query(&TraceQuery {
            session_id: Some(session_id.to_string()),
            ..TraceQuery::default()
        })
        .await
        .map_err(|error| ServerError::Internal(format!("Failed to query traces: {error}")))?;

    Ok(build_transcript_payload(session_id, history, traces))
}

async fn load_session_cwd(state: &AppState, session_id: &str) -> Result<String, ServerError> {
    if let Some(session) = state.acp_manager.get_session(session_id).await {
        return Ok(session.cwd);
    }

    state
        .acp_session_store
        .get(session_id)
        .await?
        .map(|session| session.cwd)
        .ok_or_else(|| ServerError::NotFound("Session not found".to_string()))
}

fn extract_reposlide_result(messages: &[TranscriptMessage]) -> RepoSlideSessionResult {
    let latest_assistant = messages
        .iter()
        .rev()
        .find(|message| message.role == "assistant" && !message.content.trim().is_empty());

    let Some(latest_assistant) = latest_assistant else {
        return RepoSlideSessionResult {
            status: "running",
            deck_path: None,
            download_url: None,
            latest_assistant_message: None,
            summary: None,
            updated_at: None,
        };
    };

    let deck_path = extract_pptx_path(&latest_assistant.content);
    RepoSlideSessionResult {
        status: if deck_path.is_some() {
            "completed"
        } else {
            "running"
        },
        deck_path,
        download_url: None,
        latest_assistant_message: Some(latest_assistant.content.clone()),
        summary: Some(summarize_reposlide_content(&latest_assistant.content)),
        updated_at: Some(latest_assistant.timestamp.clone()),
    }
}

fn extract_pptx_path(content: &str) -> Option<String> {
    let pattern = Regex::new(r#"((?:/|[A-Za-z]:\\)[^\s"'`]+?\.pptx)\b"#).ok()?;
    pattern
        .captures(content)
        .and_then(|captures| captures.get(1))
        .map(|match_value| match_value.as_str().to_string())
}

fn summarize_reposlide_content(content: &str) -> String {
    content
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .take(12)
        .collect::<Vec<_>>()
        .join("\n")
}

fn build_reposlide_download_url(session_id: &str) -> String {
    format!(
        "/api/sessions/{}/reposlide-result/download",
        urlencoding::encode(session_id)
    )
}

#[derive(Debug)]
struct RepoSlideDeckFile {
    path: PathBuf,
    file_name: String,
}

fn resolve_reposlide_deck_file(
    session_cwd: &FsPath,
    deck_path: Option<&str>,
) -> Option<RepoSlideDeckFile> {
    let deck_path = deck_path?;
    let candidate = FsPath::new(deck_path);
    if !candidate.is_absolute() {
        return None;
    }
    if candidate
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("pptx"))
        != Some(true)
    {
        return None;
    }

    let absolute_path = std::fs::canonicalize(candidate).ok()?;
    let metadata = std::fs::metadata(&absolute_path).ok()?;
    if !metadata.is_file() {
        return None;
    }

    let allowed_roots = [
        std::fs::canonicalize(session_cwd).ok(),
        std::fs::canonicalize(std::env::temp_dir()).ok(),
    ];
    if !allowed_roots
        .iter()
        .flatten()
        .any(|root| is_within_root(&absolute_path, root))
    {
        return None;
    }

    Some(RepoSlideDeckFile {
        file_name: absolute_path.file_name()?.to_string_lossy().to_string(),
        path: absolute_path,
    })
}

fn is_within_root(target_path: &FsPath, root_path: &FsPath) -> bool {
    if target_path == root_path {
        return true;
    }

    target_path.starts_with(root_path)
}

fn history_to_transcript_messages(history: &[Value]) -> Vec<TranscriptMessage> {
    let mut messages = Vec::new();
    let mut last_kind: Option<&str> = None;
    let mut last_assistant_idx: Option<usize> = None;
    let mut last_thought_idx: Option<usize> = None;

    for (index, notification) in history.iter().enumerate() {
        let Some(update) = notification.get("update").and_then(Value::as_object) else {
            continue;
        };
        let Some(kind) = update.get("sessionUpdate").and_then(Value::as_str) else {
            continue;
        };
        let timestamp = update
            .get("timestamp")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(now_iso);
        let fallback_id = notification
            .get("eventId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("history-{kind}-{index}"));

        match kind {
            "user_message" => {
                last_assistant_idx = None;
                last_thought_idx = None;
                if let Some(text) = update
                    .get("content")
                    .and_then(Value::as_object)
                    .and_then(|content| content.get("text"))
                    .and_then(Value::as_str)
                {
                    messages.push(TranscriptMessage {
                        id: fallback_id,
                        role: "user",
                        content: text.to_string(),
                        timestamp,
                        tool_name: None,
                        tool_status: None,
                        tool_call_id: None,
                        tool_raw_input: None,
                        tool_raw_output: None,
                        raw_data: None,
                    });
                }
            }
            "agent_message" | "agent_message_chunk" => {
                if let Some(text) = update
                    .get("content")
                    .and_then(Value::as_object)
                    .and_then(|content| content.get("text"))
                    .and_then(Value::as_str)
                {
                    let normalized_text = if kind == "agent_message"
                        || (kind == "agent_message_chunk"
                            && last_kind != Some("agent_message_chunk"))
                    {
                        trim_leading_response_breaks(text)
                    } else {
                        text.to_string()
                    };
                    if kind == "agent_message_chunk" && last_kind == Some("agent_message_chunk") {
                        if let Some(existing_idx) = last_assistant_idx {
                            if let Some(existing) = messages.get_mut(existing_idx) {
                                existing.content.push_str(text);
                            }
                        } else {
                            messages.push(TranscriptMessage {
                                id: fallback_id,
                                role: "assistant",
                                content: normalized_text,
                                timestamp,
                                tool_name: None,
                                tool_status: None,
                                tool_call_id: None,
                                tool_raw_input: None,
                                tool_raw_output: None,
                                raw_data: None,
                            });
                            last_assistant_idx = Some(messages.len() - 1);
                        }
                    } else {
                        messages.push(TranscriptMessage {
                            id: fallback_id,
                            role: "assistant",
                            content: normalized_text,
                            timestamp,
                            tool_name: None,
                            tool_status: None,
                            tool_call_id: None,
                            tool_raw_input: None,
                            tool_raw_output: None,
                            raw_data: None,
                        });
                        last_assistant_idx = Some(messages.len() - 1);
                    }
                    last_thought_idx = None;
                }
            }
            "agent_thought" | "agent_thought_chunk" => {
                if let Some(text) = update
                    .get("content")
                    .and_then(Value::as_object)
                    .and_then(|content| content.get("text"))
                    .and_then(Value::as_str)
                {
                    let normalized_text = if kind == "agent_thought"
                        || (kind == "agent_thought_chunk"
                            && last_kind != Some("agent_thought_chunk"))
                    {
                        trim_leading_response_breaks(text)
                    } else {
                        text.to_string()
                    };
                    if kind == "agent_thought_chunk" && last_kind == Some("agent_thought_chunk") {
                        if let Some(existing_idx) = last_thought_idx {
                            if let Some(existing) = messages.get_mut(existing_idx) {
                                existing.content.push_str(text);
                            }
                        } else {
                            messages.push(TranscriptMessage {
                                id: fallback_id,
                                role: "thought",
                                content: normalized_text,
                                timestamp,
                                tool_name: None,
                                tool_status: None,
                                tool_call_id: None,
                                tool_raw_input: None,
                                tool_raw_output: None,
                                raw_data: None,
                            });
                            last_thought_idx = Some(messages.len() - 1);
                        }
                    } else {
                        messages.push(TranscriptMessage {
                            id: fallback_id,
                            role: "thought",
                            content: normalized_text,
                            timestamp,
                            tool_name: None,
                            tool_status: None,
                            tool_call_id: None,
                            tool_raw_input: None,
                            tool_raw_output: None,
                            raw_data: None,
                        });
                        last_thought_idx = Some(messages.len() - 1);
                    }
                    last_assistant_idx = None;
                }
            }
            "tool_call" | "tool_call_update" => {
                last_assistant_idx = None;
                last_thought_idx = None;
                let tool_name = update
                    .get("title")
                    .and_then(Value::as_str)
                    .or_else(|| update.get("toolName").and_then(Value::as_str))
                    .unwrap_or("Tool");
                let status = update
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("running");
                let raw_input = update.get("rawInput").cloned();
                let raw_output = update.get("rawOutput").cloned();
                let content = if let Some(raw_input) = raw_input.as_ref() {
                    format!(
                        "Input:\n{}",
                        serde_json::to_string_pretty(raw_input).unwrap_or_default()
                    )
                } else {
                    tool_name.to_string()
                };

                messages.push(TranscriptMessage {
                    id: update
                        .get("toolCallId")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or(fallback_id),
                    role: "tool",
                    content,
                    timestamp,
                    tool_name: Some(tool_name.to_string()),
                    tool_status: Some(status.to_string()),
                    tool_call_id: update
                        .get("toolCallId")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    tool_raw_input: raw_input,
                    tool_raw_output: raw_output,
                    raw_data: Some(Value::Object(update.clone())),
                });
            }
            "plan" => {
                last_assistant_idx = None;
                last_thought_idx = None;
                let content = update
                    .get("plan")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| {
                        update
                            .get("entries")
                            .and_then(Value::as_array)
                            .map(|entries| {
                                entries
                                    .iter()
                                    .filter_map(Value::as_object)
                                    .map(|entry| {
                                        let status = entry
                                            .get("status")
                                            .and_then(Value::as_str)
                                            .unwrap_or("pending");
                                        let body = entry
                                            .get("content")
                                            .and_then(Value::as_str)
                                            .unwrap_or_default();
                                        format!("[{status}] {body}")
                                    })
                                    .collect::<Vec<_>>()
                                    .join("\n")
                            })
                    })
                    .unwrap_or_default();

                if !content.is_empty() {
                    messages.push(TranscriptMessage {
                        id: fallback_id,
                        role: "plan",
                        content,
                        timestamp,
                        tool_name: None,
                        tool_status: None,
                        tool_call_id: None,
                        tool_raw_input: None,
                        tool_raw_output: None,
                        raw_data: Some(Value::Object(update.clone())),
                    });
                }
            }
            _ => {
                last_assistant_idx = None;
                last_thought_idx = None;
            }
        }

        last_kind = Some(kind);
    }

    messages
}

fn trim_leading_response_breaks(text: &str) -> String {
    text.trim_start_matches(['\r', '\n']).to_string()
}

fn traces_to_transcript_messages(
    traces: &[routa_core::trace::TraceRecord],
) -> Vec<TranscriptMessage> {
    let mut messages = Vec::new();
    let mut traces = traces.to_vec();
    traces.sort_by_key(|trace| trace.timestamp);

    for trace in traces {
        match trace.event_type {
            TraceEventType::UserMessage => {
                if let Some(content) = trace_conversation_text(&trace) {
                    messages.push(TranscriptMessage {
                        id: trace.id,
                        role: "user",
                        content,
                        timestamp: trace.timestamp.to_rfc3339(),
                        tool_name: None,
                        tool_status: None,
                        tool_call_id: None,
                        tool_raw_input: None,
                        tool_raw_output: None,
                        raw_data: None,
                    });
                }
            }
            TraceEventType::AgentMessage => {
                if let Some(content) = trace_conversation_text(&trace) {
                    messages.push(TranscriptMessage {
                        id: trace.id,
                        role: "assistant",
                        content,
                        timestamp: trace.timestamp.to_rfc3339(),
                        tool_name: None,
                        tool_status: None,
                        tool_call_id: None,
                        tool_raw_input: None,
                        tool_raw_output: None,
                        raw_data: None,
                    });
                }
            }
            TraceEventType::AgentThought => {
                if let Some(content) = trace_conversation_text(&trace) {
                    messages.push(TranscriptMessage {
                        id: trace.id,
                        role: "thought",
                        content,
                        timestamp: trace.timestamp.to_rfc3339(),
                        tool_name: None,
                        tool_status: None,
                        tool_call_id: None,
                        tool_raw_input: None,
                        tool_raw_output: None,
                        raw_data: None,
                    });
                }
            }
            TraceEventType::ToolCall | TraceEventType::ToolResult => {
                if let Some(tool) = trace.tool.as_ref() {
                    messages.push(TranscriptMessage {
                        id: tool
                            .tool_call_id
                            .clone()
                            .unwrap_or_else(|| trace.id.clone()),
                        role: "tool",
                        content: tool
                            .output
                            .as_ref()
                            .map(format_json_value)
                            .or_else(|| tool.input.as_ref().map(format_json_value))
                            .unwrap_or_else(|| tool.name.clone()),
                        timestamp: trace.timestamp.to_rfc3339(),
                        tool_name: Some(tool.name.clone()),
                        tool_status: tool.status.clone(),
                        tool_call_id: tool.tool_call_id.clone(),
                        tool_raw_input: tool.input.clone(),
                        tool_raw_output: tool.output.clone(),
                        raw_data: None,
                    });
                }
            }
            TraceEventType::SessionStart | TraceEventType::SessionEnd => {}
        }
    }

    messages
}

fn trace_conversation_text(trace: &routa_core::trace::TraceRecord) -> Option<String> {
    trace
        .conversation
        .as_ref()
        .and_then(|conversation| conversation.full_content.clone())
        .or_else(|| {
            trace
                .conversation
                .as_ref()
                .and_then(|conversation| conversation.content_preview.clone())
        })
}

fn format_json_value(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        _ => serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string()),
    }
}

fn now_iso() -> String {
    DateTime::<Utc>::from(std::time::SystemTime::now()).to_rfc3339()
}

#[cfg(test)]
mod tests {
    use crate::application::sessions::consolidate_message_history;
    use routa_core::trace::{Contributor, TraceEventType, TraceRecord};
    use serde_json::{json, Value};

    use super::{
        build_transcript_payload, count_descendants, extract_reposlide_result,
        history_to_transcript_messages, list_team_runs, resolve_reposlide_deck_file,
        service_limit_for_query, session_is_non_empty, should_apply_team_surface,
        TranscriptMessage, TEAM_LEAD_SPECIALIST_ID,
    };

    #[test]
    fn consolidate_message_history_merges_chunks_for_same_session() {
        let notifications = vec![
            json!({"sessionId":"s1","update": {"sessionUpdate":"agent_message_chunk","content": {"text":"Hel"}}}),
            json!({"sessionId":"s1","update": {"sessionUpdate":"agent_message_chunk","content": {"text":"lo"}}}),
            json!({"sessionId":"s1","update": {"sessionUpdate":"agent_done","content": {"text":"!"}}}),
        ];

        let merged = consolidate_message_history(notifications);

        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0]["sessionId"].as_str(), Some("s1"));
        assert_eq!(
            merged[0]["update"]["sessionUpdate"].as_str(),
            Some("agent_message")
        );
        assert_eq!(
            merged[0]["update"]["content"]["text"].as_str(),
            Some("Hello")
        );
    }

    #[test]
    fn consolidate_message_history_handles_session_switches() {
        let notifications = vec![
            json!({"sessionId":"s1","update": {"sessionUpdate":"agent_message_chunk","content": {"text":"A"}}}),
            json!({"sessionId":"s2","update": {"sessionUpdate":"agent_message_chunk","content": {"text":"B"}}}),
            json!({"sessionId":"s1","update": {"sessionUpdate":"agent_message_chunk","content": {"text":"C"}}}),
        ];

        let merged = consolidate_message_history(notifications);

        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0]["update"]["content"]["text"].as_str(), Some("A"));
        assert_eq!(merged[1]["update"]["content"]["text"].as_str(), Some("B"));
        assert_eq!(merged[2]["update"]["content"]["text"].as_str(), Some("C"));
    }

    #[test]
    fn transcript_payload_prefers_history_messages_when_richer() {
        let history = vec![
            json!({"sessionId":"s1","update":{"sessionUpdate":"user_message","content":{"text":"Build it"}}}),
            json!({"sessionId":"s1","update":{"sessionUpdate":"agent_message","content":{"text":"Working on it"}}}),
            json!({"sessionId":"s1","update":{"sessionUpdate":"tool_call_update","title":"Read File","status":"completed","toolCallId":"tool-1","rawInput":{"path":"src/lib.rs"}}}),
        ];
        let traces = vec![TraceRecord::new(
            "s1",
            TraceEventType::AgentMessage,
            Contributor::new("opencode", None),
        )];

        let payload = build_transcript_payload("s1", history.clone(), traces);

        assert_eq!(payload.session_id, "s1");
        assert_eq!(payload.source, "history");
        assert_eq!(payload.history, history);
        assert_eq!(payload.history_message_count, 3);
        assert_eq!(payload.trace_message_count, 0);
        assert_eq!(payload.messages.len(), 3);
        assert_eq!(payload.messages[0].role, "user");
        assert_eq!(payload.messages[1].role, "assistant");
        assert_eq!(payload.messages[2].role, "tool");
        assert_eq!(
            payload.latest_event_kind.as_deref(),
            Some("tool_call_update")
        );
    }

    #[test]
    fn history_transcript_merges_contiguous_thought_chunks() {
        let messages = history_to_transcript_messages(&[
            json!({"sessionId":"s1","update":{"sessionUpdate":"agent_thought_chunk","content":{"text":"The"}}}),
            json!({"sessionId":"s1","update":{"sessionUpdate":"agent_thought_chunk","content":{"text":" user"}}}),
            json!({"sessionId":"s1","update":{"sessionUpdate":"agent_thought_chunk","content":{"text":" said hi"}}}),
        ]);

        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].role, "thought");
        assert_eq!(messages[0].content, "The user said hi");
    }

    #[test]
    fn history_transcript_breaks_thought_group_on_non_chunk_update() {
        let messages = history_to_transcript_messages(&[
            json!({"sessionId":"s1","update":{"sessionUpdate":"agent_thought_chunk","content":{"text":"The"}}}),
            json!({"sessionId":"s1","update":{"sessionUpdate":"usage_update","used":1,"size":2}}),
            json!({"sessionId":"s1","update":{"sessionUpdate":"agent_thought_chunk","content":{"text":" user"}}}),
        ]);

        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].content, "The");
        assert_eq!(messages[1].content, " user");
    }

    #[test]
    fn history_transcript_merges_contiguous_agent_message_chunks() {
        let messages = history_to_transcript_messages(&[
            json!({"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"text":"hello"}}}),
            json!({"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"text":" world"}}}),
        ]);

        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].role, "assistant");
        assert_eq!(messages[0].content, "hello world");
    }

    #[test]
    fn history_transcript_trims_leading_breaks_for_new_assistant_message() {
        let messages = history_to_transcript_messages(&[
            json!({"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"text":"\n\nHi!"}}}),
            json!({"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"text":" How can I help?"}}}),
        ]);

        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].role, "assistant");
        assert_eq!(messages[0].content, "Hi! How can I help?");
    }

    #[test]
    fn history_transcript_trims_leading_breaks_for_new_thought_message() {
        let messages = history_to_transcript_messages(&[
            json!({"sessionId":"s1","update":{"sessionUpdate":"agent_thought_chunk","content":{"text":"\nThe"}}}),
            json!({"sessionId":"s1","update":{"sessionUpdate":"agent_thought_chunk","content":{"text":" user"}}}),
        ]);

        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].role, "thought");
        assert_eq!(messages[0].content, "The user");
    }

    #[test]
    fn extract_reposlide_result_detects_completed_deck() {
        let messages = vec![TranscriptMessage {
            id: "m1".to_string(),
            role: "assistant",
            content: "Saved PPTX to /tmp/reposlide/demo-deck.pptx\nSlide outline:\n- Intro"
                .to_string(),
            timestamp: "2026-04-01T03:00:00Z".to_string(),
            tool_name: None,
            tool_status: None,
            tool_call_id: None,
            tool_raw_input: None,
            tool_raw_output: None,
            raw_data: None,
        }];

        let result = extract_reposlide_result(&messages);
        assert_eq!(result.status, "completed");
        assert_eq!(
            result.deck_path.as_deref(),
            Some("/tmp/reposlide/demo-deck.pptx")
        );
        assert!(result.download_url.is_none());
        assert!(result.summary.unwrap_or_default().contains("Slide outline"));
    }

    #[test]
    fn extract_reposlide_result_defaults_to_running_without_assistant_output() {
        let result = extract_reposlide_result(&[]);
        assert_eq!(result.status, "running");
        assert!(result.deck_path.is_none());
    }

    #[test]
    fn resolve_reposlide_deck_file_allows_temp_pptx_artifacts() {
        let session_dir = tempfile::tempdir().unwrap();
        let output_dir = tempfile::tempdir().unwrap();
        let deck_path = output_dir.path().join("demo-deck.pptx");
        std::fs::write(&deck_path, b"demo").unwrap();

        let artifact = resolve_reposlide_deck_file(session_dir.path(), deck_path.to_str());

        assert_eq!(
            artifact.as_ref().map(|value| value.file_name.as_str()),
            Some("demo-deck.pptx")
        );
    }

    #[test]
    fn resolve_reposlide_deck_file_rejects_paths_outside_session_and_temp_roots() {
        let session_dir = tempfile::tempdir().unwrap();
        let repo_root = std::env::current_dir().unwrap();
        let external_dir = tempfile::Builder::new()
            .prefix("reposlide-external-")
            .tempdir_in(&repo_root)
            .unwrap();
        let deck_path = external_dir.path().join("demo-deck.pptx");
        std::fs::write(&deck_path, b"demo").unwrap();

        let artifact = resolve_reposlide_deck_file(session_dir.path(), deck_path.to_str());

        assert!(artifact.is_none());
    }

    #[test]
    fn list_team_runs_matches_next_backend_contract() {
        let sessions = vec![
            json!({
                "sessionId": "anonymous-team-run",
                "workspaceId": "default",
                "role": "ROUTA",
                "createdAt": "2026-04-18T00:00:00Z",
                "firstPromptSent": true,
            }),
            json!({
                "sessionId": "anonymous-team-child",
                "workspaceId": "default",
                "role": "DEVELOPER",
                "parentSessionId": "anonymous-team-run",
                "createdAt": "2026-04-18T00:01:00Z",
                "firstPromptSent": true,
            }),
            json!({
                "sessionId": "named-team-run",
                "workspaceId": "default",
                "name": "Team - Investigate regression",
                "role": "ROUTA",
                "createdAt": "2026-04-18T00:02:00Z",
                "firstPromptSent": true,
            }),
            json!({
                "sessionId": "named-non-routa-run",
                "workspaceId": "default",
                "name": "Team - not actually routa",
                "role": "DEVELOPER",
                "createdAt": "2026-04-18T00:03:00Z",
                "firstPromptSent": true,
            }),
            json!({
                "sessionId": "team-specialist-run",
                "workspaceId": "default",
                "role": "ROUTA",
                "specialistId": TEAM_LEAD_SPECIALIST_ID,
                "createdAt": "2026-04-18T00:04:00Z",
                "firstPromptSent": true,
            }),
        ];

        let runs = list_team_runs(sessions);
        let ids: Vec<_> = runs
            .iter()
            .filter_map(|session| session["sessionId"].as_str())
            .collect();

        assert_eq!(
            ids,
            vec![
                "anonymous-team-run",
                "named-team-run",
                "team-specialist-run",
            ]
        );
        assert_eq!(runs[0]["directDelegates"], Value::from(1));
        assert_eq!(runs[0]["descendants"], Value::from(1));
        assert_eq!(runs[1]["directDelegates"], Value::from(0));
        assert_eq!(runs[1]["descendants"], Value::from(0));
    }

    #[test]
    fn count_descendants_handles_cycles_and_empty_sessions() {
        let mut descendants_by_session_id = std::collections::HashMap::new();
        let child_map = std::collections::HashMap::from([
            ("cycle-root".to_string(), vec!["cycle-child".to_string()]),
            ("cycle-child".to_string(), vec!["cycle-root".to_string()]),
        ]);

        let descendants = count_descendants(
            "cycle-root",
            &child_map,
            &mut descendants_by_session_id,
            &mut Vec::new(),
        );

        assert_eq!(descendants, 1);
    }

    #[test]
    fn team_surface_is_skipped_for_child_queries() {
        assert!(should_apply_team_surface(Some("team"), None));
        assert!(!should_apply_team_surface(Some("team"), Some("parent-1")));
        assert!(!should_apply_team_surface(None, None));
    }

    #[test]
    fn top_level_queries_apply_limit_after_filtering() {
        assert_eq!(service_limit_for_query(Some(5), None), None);
        assert_eq!(service_limit_for_query(Some(5), Some("parent-1")), Some(5));
        assert_eq!(service_limit_for_query(None, None), None);
    }

    #[test]
    fn session_is_non_empty_filters_placeholder_sessions() {
        let sessions = vec![
            json!({
                "sessionId": "visible-session",
                "workspaceId": "default",
                "role": "ROUTA",
                "createdAt": "2026-04-18T00:00:00Z",
                "firstPromptSent": true,
            }),
            json!({
                "sessionId": "empty-session",
                "workspaceId": "default",
                "role": "ROUTA",
                "createdAt": "2026-04-18T00:01:00Z",
                "firstPromptSent": false,
            }),
        ];

        let non_empty: Vec<_> = sessions.into_iter().filter(session_is_non_empty).collect();

        assert_eq!(non_empty.len(), 1);
        assert_eq!(non_empty[0]["sessionId"].as_str(), Some("visible-session"));
    }
}
