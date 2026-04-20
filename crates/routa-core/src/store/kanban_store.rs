use chrono::Utc;
use rusqlite::OptionalExtension;

use crate::db::Database;
use crate::error::ServerError;
use crate::models::kanban::{
    apply_new_board_story_readiness_defaults, apply_recommended_automation_to_columns,
    default_kanban_board, normalize_default_kanban_column_positions, KanbanBoard,
};

#[derive(Clone)]
pub struct KanbanStore {
    db: Database,
}

impl KanbanStore {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    pub async fn list_all(&self) -> Result<Vec<KanbanBoard>, ServerError> {
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, workspace_id, name, is_default, github_token, columns, created_at, updated_at \
                     FROM kanban_boards ORDER BY created_at ASC",
                )?;
                let rows = stmt
                    .query_map([], |row| Ok(row_to_board(row)))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    pub async fn list_by_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<KanbanBoard>, ServerError> {
        let ws = workspace_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, workspace_id, name, is_default, github_token, columns, created_at, updated_at \
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
                    "INSERT INTO kanban_boards (id, workspace_id, name, is_default, github_token, columns, created_at, updated_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    rusqlite::params![
                        stored.id,
                        stored.workspace_id,
                        stored.name,
                        stored.is_default as i64,
                        stored.github_token,
                        serde_json::to_string(&stored.columns).unwrap_or_else(|_| "[]".to_string()),
                        stored.created_at.timestamp_millis(),
                        stored.updated_at.timestamp_millis(),
                    ],
                )?;
                Ok(())
            })
            .await
    }

    pub async fn set_default_for_workspace(
        &self,
        workspace_id: &str,
        board_id: &str,
    ) -> Result<(), ServerError> {
        let ws = workspace_id.to_string();
        let board_id = board_id.to_string();
        let workspace_label = ws.clone();
        let board_label = board_id.clone();
        let now = Utc::now().timestamp_millis();
        self.db
            .with_conn_async(move |conn| {
                let exists = conn
                    .query_row(
                        "SELECT 1 FROM kanban_boards WHERE workspace_id = ?1 AND id = ?2 LIMIT 1",
                        rusqlite::params![ws, board_id],
                        |_| Ok(()),
                    )
                    .optional()?;

                if exists.is_none() {
                    return Err(rusqlite::Error::QueryReturnedNoRows);
                }

                conn.execute(
                    "UPDATE kanban_boards SET is_default = 0, updated_at = ?1 WHERE workspace_id = ?2 AND is_default != 0",
                    rusqlite::params![now, ws],
                )?;
                conn.execute(
                    "UPDATE kanban_boards SET is_default = 1, updated_at = ?1 WHERE workspace_id = ?2 AND id = ?3",
                    rusqlite::params![now, ws, board_id],
                )?;
                Ok(())
            })
            .await
            .map_err(|error| match error {
                ServerError::Database(message) if message.contains("Query returned no rows") => {
                    ServerError::NotFound(format!("Board {board_label} not found in workspace {workspace_label}"))
                }
                other => other,
            })
    }

    pub async fn ensure_default_board(
        &self,
        workspace_id: &str,
    ) -> Result<KanbanBoard, ServerError> {
        let boards = self.list_by_workspace(workspace_id).await?;
        if let Some(board) = boards.into_iter().find(|board| board.is_default) {
            let columns = normalize_default_kanban_column_positions(
                apply_recommended_automation_to_columns(board.columns.clone()),
            );
            if columns != board.columns {
                let mut updated_board = board;
                updated_board.columns = columns;
                updated_board.updated_at = Utc::now();
                self.update(&updated_board).await?;
                return Ok(updated_board);
            }

            return Ok(board);
        }

        let mut board = default_kanban_board(workspace_id.to_string());
        board.columns =
            normalize_default_kanban_column_positions(apply_new_board_story_readiness_defaults(
                apply_recommended_automation_to_columns(board.columns),
            ));
        match self.create(&board).await {
            Ok(()) => Ok(board),
            Err(error) => {
                let boards = self.list_by_workspace(workspace_id).await?;
                if let Some(existing) = boards.into_iter().find(|item| item.is_default) {
                    Ok(existing)
                } else {
                    Err(error)
                }
            }
        }
    }

    pub async fn get(&self, id: &str) -> Result<Option<KanbanBoard>, ServerError> {
        let board_id = id.to_string();
        self.db
            .with_conn_async(move |conn| {
                conn.query_row(
                    "SELECT id, workspace_id, name, is_default, github_token, columns, created_at, updated_at \
                     FROM kanban_boards WHERE id = ?1",
                    rusqlite::params![board_id],
                    |row| Ok(row_to_board(row)),
                )
                .optional()
            })
            .await
    }

    /// Batch load boards by IDs
    /// Returns a HashMap<board_id, KanbanBoard>
    pub async fn get_many(
        &self,
        board_ids: &[String],
    ) -> Result<std::collections::HashMap<String, KanbanBoard>, ServerError> {
        if board_ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }

        // Remove duplicates
        let unique_ids: Vec<String> = board_ids
            .iter()
            .cloned()
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();

        self.db
            .with_conn_async(move |conn| {
                // Build placeholders for IN clause
                let placeholders = unique_ids
                    .iter()
                    .enumerate()
                    .map(|(i, _)| format!("?{}", i + 1))
                    .collect::<Vec<_>>()
                    .join(", ");

                let query = format!(
                    "SELECT id, workspace_id, name, is_default, github_token, columns, created_at, updated_at \
                     FROM kanban_boards WHERE id IN ({placeholders})"
                );

                let mut stmt = conn.prepare(&query)?;
                let params: Vec<&dyn rusqlite::ToSql> = unique_ids
                    .iter()
                    .map(|id| id as &dyn rusqlite::ToSql)
                    .collect();

                let rows = stmt
                    .query_map(params.as_slice(), |row| Ok(row_to_board(row)))?
                    .collect::<Result<Vec<_>, _>>()?;

                // Convert to HashMap
                let mut result: std::collections::HashMap<String, KanbanBoard> =
                    std::collections::HashMap::new();
                for board in rows {
                    result.insert(board.id.clone(), board);
                }

                Ok(result)
            })
            .await
    }

    pub async fn update(&self, board: &KanbanBoard) -> Result<(), ServerError> {
        let stored = board.clone();
        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "UPDATE kanban_boards SET name = ?1, is_default = ?2, github_token = ?3, columns = ?4, updated_at = ?5 \
                     WHERE id = ?6",
                    rusqlite::params![
                        stored.name,
                        stored.is_default as i64,
                        stored.github_token,
                        serde_json::to_string(&stored.columns).unwrap_or_default(),
                        stored.updated_at.timestamp_millis(),
                        stored.id,
                    ],
                )?;
                Ok(())
            })
            .await
    }
}

fn row_to_board(row: &rusqlite::Row<'_>) -> KanbanBoard {
    let created_ms: i64 = row.get(6).unwrap_or(0);
    let updated_ms: i64 = row.get(7).unwrap_or(0);

    KanbanBoard {
        id: row.get(0).unwrap_or_default(),
        workspace_id: row.get(1).unwrap_or_default(),
        name: row.get(2).unwrap_or_default(),
        is_default: row.get::<_, i64>(3).unwrap_or(0) != 0,
        github_token: row
            .get::<_, Option<String>>(4)
            .unwrap_or(None)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        columns: row
            .get::<_, String>(5)
            .ok()
            .and_then(|value| serde_json::from_str(&value).ok())
            .unwrap_or_default(),
        created_at: chrono::DateTime::from_timestamp_millis(created_ms).unwrap_or_else(Utc::now),
        updated_at: chrono::DateTime::from_timestamp_millis(updated_ms).unwrap_or_else(Utc::now),
    }
}
