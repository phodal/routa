use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use routa_core::trace::{TraceEventType, TraceQuery, TraceReader};
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;

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
        .route("/{session_id}/context", get(get_session_context))
        .route("/{session_id}/disconnect", post(disconnect_session))
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListSessionsQuery {
    workspace_id: Option<String>,
    parent_session_id: Option<String>,
    limit: Option<usize>,
}

/// GET /api/sessions — List ACP sessions.
/// Compatible with the Next.js frontend's session-panel.tsx and chat-panel.tsx.
///
/// Merges in-memory sessions with persisted sessions from the database.
async fn list_sessions(
    State(state): State<AppState>,
    Query(query): Query<ListSessionsQuery>,
) -> Json<serde_json::Value> {
    let service = SessionApplicationService::new(state);
    let sessions = service
        .list_sessions(SessionListQuery {
            workspace_id: query.workspace_id,
            parent_session_id: query.parent_session_id,
            limit: query.limit,
        })
        .await;

    Json(serde_json::json!({ "sessions": sessions }))
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
            "Session {} not found",
            session_id
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
        .map_err(|error| ServerError::Internal(format!("Failed to get cwd: {}", error)))?;
    let traces = TraceReader::new(&cwd)
        .query(&TraceQuery {
            session_id: Some(session_id.clone()),
            ..TraceQuery::default()
        })
        .await
        .map_err(|error| ServerError::Internal(format!("Failed to query traces: {}", error)))?;

    let payload = build_transcript_payload(&session_id, history, traces);
    Ok(Json(serde_json::to_value(payload).map_err(|error| {
        ServerError::Internal(format!("Failed to serialize transcript payload: {}", error))
    })?))
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
            .unwrap_or_else(|| format!("history-{}-{}", kind, index));

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
                    let normalized_text = if kind == "agent_message_chunk"
                        && last_kind != Some("agent_message_chunk")
                    {
                        trim_leading_response_breaks(text)
                    } else if kind == "agent_message" {
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
                    let normalized_text = if kind == "agent_thought_chunk"
                        && last_kind != Some("agent_thought_chunk")
                    {
                        trim_leading_response_breaks(text)
                    } else if kind == "agent_thought" {
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
                    format!("Input:\n{}", serde_json::to_string_pretty(raw_input).unwrap_or_default())
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
                                        format!("[{}] {}", status, body)
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
    trace.conversation
        .as_ref()
        .and_then(|conversation| conversation.full_content.clone())
        .or_else(|| {
            trace.conversation
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
    use serde_json::json;

    use super::{build_transcript_payload, history_to_transcript_messages};

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
        assert_eq!(payload.latest_event_kind.as_deref(), Some("tool_call_update"));
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
}
