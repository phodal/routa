use chrono::Utc;
use rusqlite::OptionalExtension;

use crate::db::Database;
use crate::error::ServerError;
use crate::models::kanban::{default_kanban_board, KanbanBoard};

#[derive(Clone)]
pub struct KanbanStore {
    db: Database,
}

impl KanbanStore {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    pub async fn list_by_workspace(&self, workspace_id: &str) -> Result<Vec<KanbanBoard>, ServerError> {
        let ws = workspace_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, workspace_id, name, is_default, columns_json, created_at, updated_at \
                     FROM kanban_boards WHERE workspace_id = ?1 ORDER BY is_default DESC, created_at ASC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![ws], |row| Ok(row_to_board(row)))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    pub async fn create(&self, board: &KanbanBoard) -> Result<(), ServerError> {
        let stored = board.clone();
        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "INSERT INTO kanban_boards (id, workspace_id, name, is_default, columns_json, created_at, updated_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    rusqlite::params![
                        stored.id,
                        stored.workspace_id,
                        stored.name,
                        stored.is_default as i64,
                        serde_json::to_string(&stored.columns).unwrap_or_else(|_| "[]".to_string()),
                        stored.created_at.timestamp_millis(),
                        stored.updated_at.timestamp_millis(),
                    ],
                )?;
                Ok(())
            })
            .await
    }

    pub async fn set_default_for_workspace(&self, workspace_id: &str, board_id: &str) -> Result<(), ServerError> {
        let ws = workspace_id.to_string();
        let board_id = board_id.to_string();
        let now = Utc::now().timestamp_millis();
        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "UPDATE kanban_boards SET is_default = CASE WHEN id = ?1 THEN 1 ELSE 0 END, updated_at = ?2 WHERE workspace_id = ?3",
                    rusqlite::params![board_id, now, ws],
                )?;
                Ok(())
            })
            .await
    }

    pub async fn ensure_default_board(&self, workspace_id: &str) -> Result<KanbanBoard, ServerError> {
        let boards = self.list_by_workspace(workspace_id).await?;
        if let Some(board) = boards.into_iter().find(|board| board.is_default) {
            return Ok(board);
        }

        let board = default_kanban_board(workspace_id.to_string());
        self.create(&board).await?;
        Ok(board)
    }

    pub async fn get(&self, id: &str) -> Result<Option<KanbanBoard>, ServerError> {
        let board_id = id.to_string();
        self.db
            .with_conn_async(move |conn| {
                conn.query_row(
                    "SELECT id, workspace_id, name, is_default, columns_json, created_at, updated_at \
                     FROM kanban_boards WHERE id = ?1",
                    rusqlite::params![board_id],
                    |row| Ok(row_to_board(row)),
                )
                .optional()
            })
            .await
    }
}

fn row_to_board(row: &rusqlite::Row<'_>) -> KanbanBoard {
    let created_ms: i64 = row.get(5).unwrap_or(0);
    let updated_ms: i64 = row.get(6).unwrap_or(0);

    KanbanBoard {
        id: row.get(0).unwrap_or_default(),
        workspace_id: row.get(1).unwrap_or_default(),
        name: row.get(2).unwrap_or_default(),
        is_default: row.get::<_, i64>(3).unwrap_or(0) != 0,
        columns: row
            .get::<_, String>(4)
            .ok()
            .and_then(|value| serde_json::from_str(&value).ok())
            .unwrap_or_default(),
        created_at: chrono::DateTime::from_timestamp_millis(created_ms).unwrap_or_else(Utc::now),
        updated_at: chrono::DateTime::from_timestamp_millis(updated_ms).unwrap_or_else(Utc::now),
    }
}