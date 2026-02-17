use chrono::Utc;
use rusqlite::OptionalExtension;
use std::collections::HashMap;

use crate::db::Database;
use crate::error::ServerError;
use crate::models::note::{Note, NoteMetadata, NoteType, SPEC_NOTE_ID};
use crate::models::task::TaskStatus;

pub struct NoteStore {
    db: Database,
}

impl NoteStore {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    pub async fn save(&self, note: &Note) -> Result<(), ServerError> {
        let n = note.clone();
        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "INSERT INTO notes (id, workspace_id, title, content, type, task_status,
                     assigned_agent_ids, parent_note_id, linked_task_id, custom_metadata, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                     ON CONFLICT(workspace_id, id) DO UPDATE SET
                       title = excluded.title,
                       content = excluded.content,
                       type = excluded.type,
                       task_status = excluded.task_status,
                       assigned_agent_ids = excluded.assigned_agent_ids,
                       parent_note_id = excluded.parent_note_id,
                       linked_task_id = excluded.linked_task_id,
                       custom_metadata = excluded.custom_metadata,
                       updated_at = excluded.updated_at",
                    rusqlite::params![
                        n.id,
                        n.workspace_id,
                        n.title,
                        n.content,
                        n.metadata.note_type.as_str(),
                        n.metadata.task_status.as_ref().map(|s| s.as_str()),
                        n.metadata.assigned_agent_ids.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
                        n.metadata.parent_note_id,
                        n.metadata.linked_task_id,
                        n.metadata.custom.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
                        n.created_at.timestamp_millis(),
                        n.updated_at.timestamp_millis(),
                    ],
                )?;
                Ok(())
            })
            .await
    }

    pub async fn get(&self, note_id: &str, workspace_id: &str) -> Result<Option<Note>, ServerError> {
        let nid = note_id.to_string();
        let ws_id = workspace_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, workspace_id, title, content, type, task_status,
                     assigned_agent_ids, parent_note_id, linked_task_id, custom_metadata, created_at, updated_at
                     FROM notes WHERE id = ?1 AND workspace_id = ?2",
                )?;
                stmt.query_row(rusqlite::params![nid, ws_id], |row| Ok(row_to_note(row)))
                    .optional()
            })
            .await
    }

    pub async fn list_by_workspace(&self, workspace_id: &str) -> Result<Vec<Note>, ServerError> {
        let ws_id = workspace_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, workspace_id, title, content, type, task_status,
                     assigned_agent_ids, parent_note_id, linked_task_id, custom_metadata, created_at, updated_at
                     FROM notes WHERE workspace_id = ?1 ORDER BY created_at DESC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![ws_id], |row| Ok(row_to_note(row)))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    pub async fn list_by_type(
        &self,
        workspace_id: &str,
        note_type: &NoteType,
    ) -> Result<Vec<Note>, ServerError> {
        let ws_id = workspace_id.to_string();
        let type_str = note_type.as_str().to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, workspace_id, title, content, type, task_status,
                     assigned_agent_ids, parent_note_id, linked_task_id, custom_metadata, created_at, updated_at
                     FROM notes WHERE workspace_id = ?1 AND type = ?2 ORDER BY created_at DESC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![ws_id, type_str], |row| Ok(row_to_note(row)))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    pub async fn delete(&self, note_id: &str, workspace_id: &str) -> Result<(), ServerError> {
        let nid = note_id.to_string();
        let ws_id = workspace_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "DELETE FROM notes WHERE id = ?1 AND workspace_id = ?2",
                    rusqlite::params![nid, ws_id],
                )?;
                Ok(())
            })
            .await
    }

    pub async fn ensure_spec(&self, workspace_id: &str) -> Result<Note, ServerError> {
        if let Some(note) = self.get(SPEC_NOTE_ID, workspace_id).await? {
            return Ok(note);
        }
        let note = Note::new_spec(workspace_id.to_string());
        self.save(&note).await?;
        Ok(note)
    }
}

use rusqlite::Row;

fn row_to_note(row: &Row<'_>) -> Note {
    let created_ms: i64 = row.get(10).unwrap_or(0);
    let updated_ms: i64 = row.get(11).unwrap_or(0);

    let assigned_agent_ids: Option<Vec<String>> = row
        .get::<_, Option<String>>(6)
        .unwrap_or(None)
        .and_then(|s| serde_json::from_str(&s).ok());
    let custom: Option<HashMap<String, String>> = row
        .get::<_, Option<String>>(9)
        .unwrap_or(None)
        .and_then(|s| serde_json::from_str(&s).ok());

    Note {
        id: row.get(0).unwrap_or_default(),
        workspace_id: row.get(1).unwrap_or_default(),
        title: row.get(2).unwrap_or_default(),
        content: row.get(3).unwrap_or_default(),
        metadata: NoteMetadata {
            note_type: NoteType::from_str(&row.get::<_, String>(4).unwrap_or_default()),
            task_status: row
                .get::<_, Option<String>>(5)
                .unwrap_or(None)
                .and_then(|s| TaskStatus::from_str(&s)),
            assigned_agent_ids,
            parent_note_id: row.get(7).unwrap_or(None),
            linked_task_id: row.get(8).unwrap_or(None),
            custom,
        },
        created_at: chrono::DateTime::from_timestamp_millis(created_ms)
            .unwrap_or_else(|| Utc::now()),
        updated_at: chrono::DateTime::from_timestamp_millis(updated_ms)
            .unwrap_or_else(|| Utc::now()),
    }
}
