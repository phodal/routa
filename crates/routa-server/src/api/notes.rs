use axum::{
    extract::{Query, State},
    response::sse::{Event, KeepAlive, Sse},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use std::convert::Infallible;
use tokio_stream::StreamExt as _;

use crate::error::ServerError;
use crate::models::note::{Note, NoteMetadata, NoteType};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_notes).post(create_or_update_note).delete(delete_note_query))
        .route("/events", get(note_events_sse))
        .route("/{workspace_id}/{note_id}", get(get_note).delete(delete_note_path))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListNotesQuery {
    workspace_id: Option<String>,
    #[serde(rename = "type")]
    note_type: Option<String>,
    note_id: Option<String>,
}

async fn list_notes(
    State(state): State<AppState>,
    Query(query): Query<ListNotesQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspace_id = query.workspace_id.as_deref().unwrap_or("default");

    if let Some(note_id) = &query.note_id {
        let note = state.note_store.get(note_id, workspace_id).await?;
        return Ok(Json(serde_json::json!({ "note": note })));
    }

    let notes = if let Some(type_str) = &query.note_type {
        let note_type = NoteType::from_str(type_str);
        state
            .note_store
            .list_by_type(workspace_id, &note_type)
            .await?
    } else {
        state.note_store.list_by_workspace(workspace_id).await?
    };

    Ok(Json(serde_json::json!({ "notes": notes })))
}

async fn get_note(
    State(state): State<AppState>,
    axum::extract::Path((workspace_id, note_id)): axum::extract::Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let note = state
        .note_store
        .get(&note_id, &workspace_id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Note {} not found", note_id)))?;
    Ok(Json(serde_json::json!({ "note": note })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateNoteRequest {
    note_id: Option<String>,
    title: String,
    content: Option<String>,
    workspace_id: Option<String>,
    #[serde(rename = "type")]
    note_type: Option<String>,
    metadata: Option<NoteMetadata>,
    #[allow(dead_code)]
    source: Option<String>,
}

async fn create_or_update_note(
    State(state): State<AppState>,
    Json(body): Json<CreateNoteRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspace_id = body.workspace_id.unwrap_or_else(|| "default".to_string());
    let note_id = body
        .note_id
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let metadata = body.metadata.unwrap_or(NoteMetadata {
        note_type: body
            .note_type
            .as_deref()
            .map(NoteType::from_str)
            .unwrap_or(NoteType::General),
        ..Default::default()
    });

    let note = Note::new(
        note_id,
        body.title,
        body.content.unwrap_or_default(),
        workspace_id,
        Some(metadata),
    );

    state.note_store.save(&note).await?;
    Ok(Json(serde_json::json!({ "note": note })))
}

/// DELETE /api/notes?noteId=xxx&workspaceId=xxx  (Next.js compatible)
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteNoteQuery {
    note_id: String,
    workspace_id: Option<String>,
}

async fn delete_note_query(
    State(state): State<AppState>,
    Query(query): Query<DeleteNoteQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspace_id = query.workspace_id.as_deref().unwrap_or("default");
    state
        .note_store
        .delete(&query.note_id, workspace_id)
        .await?;
    Ok(Json(serde_json::json!({ "deleted": true, "noteId": query.note_id })))
}

/// DELETE /api/notes/{workspace_id}/{note_id}  (REST-style)
async fn delete_note_path(
    State(state): State<AppState>,
    axum::extract::Path((workspace_id, note_id)): axum::extract::Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ServerError> {
    state.note_store.delete(&note_id, &workspace_id).await?;
    Ok(Json(serde_json::json!({ "deleted": true, "noteId": note_id })))
}

/// GET /api/notes/events?workspaceId=xxx — SSE stream for note change events.
///
/// Currently sends a heartbeat every 15 seconds.
/// TODO: Integrate with a real event bus (broadcast channel) when notes are modified.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoteEventsQuery {
    #[allow(dead_code)]
    workspace_id: Option<String>,
}

async fn note_events_sse(
    Query(_query): Query<NoteEventsQuery>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let stream = tokio_stream::wrappers::IntervalStream::new(tokio::time::interval(
        std::time::Duration::from_secs(15),
    ))
    .map(|_| Ok(Event::default().comment("heartbeat")));

    Sse::new(stream).keep_alive(KeepAlive::default())
}
