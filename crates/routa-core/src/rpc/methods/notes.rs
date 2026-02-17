//! RPC methods for note management.
//!
//! Methods:
//! - `notes.list`   — list notes with optional filters
//! - `notes.get`    — get a single note
//! - `notes.create` — create or update a note
//! - `notes.delete` — delete a note

use serde::{Deserialize, Serialize};

use crate::models::note::{Note, NoteMetadata, NoteType};
use crate::rpc::error::RpcError;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// notes.list
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListParams {
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    #[serde(rename = "type")]
    pub note_type: Option<String>,
}

fn default_workspace_id() -> String {
    "default".into()
}

#[derive(Debug, Serialize)]
pub struct ListResult {
    pub notes: Vec<Note>,
}

pub async fn list(state: &AppState, params: ListParams) -> Result<ListResult, RpcError> {
    let notes = if let Some(type_str) = &params.note_type {
        let note_type = NoteType::from_str(type_str);
        state
            .note_store
            .list_by_type(&params.workspace_id, &note_type)
            .await?
    } else {
        state
            .note_store
            .list_by_workspace(&params.workspace_id)
            .await?
    };

    Ok(ListResult { notes })
}

// ---------------------------------------------------------------------------
// notes.get
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetParams {
    pub note_id: String,
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
}

pub async fn get(state: &AppState, params: GetParams) -> Result<Note, RpcError> {
    state
        .note_store
        .get(&params.note_id, &params.workspace_id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Note {} not found", params.note_id)))
}

// ---------------------------------------------------------------------------
// notes.create
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateParams {
    pub note_id: Option<String>,
    pub title: String,
    pub content: Option<String>,
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    #[serde(rename = "type")]
    pub note_type: Option<String>,
    pub metadata: Option<NoteMetadata>,
}

#[derive(Debug, Serialize)]
pub struct CreateResult {
    pub note: Note,
}

pub async fn create(state: &AppState, params: CreateParams) -> Result<CreateResult, RpcError> {
    let note_id = params
        .note_id
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let metadata = params.metadata.unwrap_or(NoteMetadata {
        note_type: params
            .note_type
            .as_deref()
            .map(NoteType::from_str)
            .unwrap_or(NoteType::General),
        ..Default::default()
    });

    let note = Note::new(
        note_id,
        params.title,
        params.content.unwrap_or_default(),
        params.workspace_id,
        Some(metadata),
    );

    state.note_store.save(&note).await?;
    Ok(CreateResult { note })
}

// ---------------------------------------------------------------------------
// notes.delete
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteParams {
    pub note_id: String,
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    pub deleted: bool,
    pub note_id: String,
}

pub async fn delete(state: &AppState, params: DeleteParams) -> Result<DeleteResult, RpcError> {
    state
        .note_store
        .delete(&params.note_id, &params.workspace_id)
        .await?;
    Ok(DeleteResult {
        deleted: true,
        note_id: params.note_id,
    })
}
