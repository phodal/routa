use chrono::Utc;
use rusqlite::OptionalExtension;
use std::collections::HashMap;

use crate::db::Database;
use crate::error::ServerError;
use crate::models::workspace::{Workspace, WorkspaceStatus, DEFAULT_WORKSPACE_ID};

pub struct WorkspaceStore {
    db: Database,
}

impl WorkspaceStore {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    pub async fn save(&self, workspace: &Workspace) -> Result<(), ServerError> {
        let ws = workspace.clone();
        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "INSERT INTO workspaces (id, title, repo_path, branch, status, metadata, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                     ON CONFLICT(id) DO UPDATE SET
                       title = excluded.title,
                       repo_path = excluded.repo_path,
                       branch = excluded.branch,
                       status = excluded.status,
                       metadata = excluded.metadata,
                       updated_at = excluded.updated_at",
                    rusqlite::params![
                        ws.id,
                        ws.title,
                        ws.repo_path,
                        ws.branch,
                        ws.status.as_str(),
                        serde_json::to_string(&ws.metadata).unwrap_or_default(),
                        ws.created_at.timestamp_millis(),
                        ws.updated_at.timestamp_millis(),
                    ],
                )?;
                Ok(())
            })
            .await
    }

    pub async fn get(&self, id: &str) -> Result<Option<Workspace>, ServerError> {
        let id = id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, title, repo_path, branch, status, metadata, created_at, updated_at
                     FROM workspaces WHERE id = ?1",
                )?;
                stmt.query_row(rusqlite::params![id], |row| {
                        Ok(row_to_workspace(row))
                    })
                    .optional()
            })
            .await
    }

    pub async fn list(&self) -> Result<Vec<Workspace>, ServerError> {
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, title, repo_path, branch, status, metadata, created_at, updated_at
                     FROM workspaces ORDER BY created_at DESC",
                )?;
                let rows = stmt
                    .query_map([], |row| Ok(row_to_workspace(row)))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    pub async fn list_by_status(&self, status: WorkspaceStatus) -> Result<Vec<Workspace>, ServerError> {
        let status_str = status.as_str().to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, title, repo_path, branch, status, metadata, created_at, updated_at
                     FROM workspaces WHERE status = ?1 ORDER BY created_at DESC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![status_str], |row| Ok(row_to_workspace(row)))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    pub async fn delete(&self, id: &str) -> Result<(), ServerError> {
        let id = id.to_string();
        self.db
            .with_conn_async(move |conn| {
                conn.execute("DELETE FROM workspaces WHERE id = ?1", rusqlite::params![id])?;
                Ok(())
            })
            .await
    }

    pub async fn ensure_default(&self) -> Result<Workspace, ServerError> {
        if let Some(ws) = self.get(DEFAULT_WORKSPACE_ID).await? {
            return Ok(ws);
        }
        let ws = Workspace::new(
            DEFAULT_WORKSPACE_ID.to_string(),
            "Default Workspace".to_string(),
            None,
            None,
            None,
        );
        self.save(&ws).await?;
        Ok(ws)
    }
}

use rusqlite::Row;

fn row_to_workspace(row: &Row<'_>) -> Workspace {
    let metadata_str: String = row.get(5).unwrap_or_default();
    let metadata: HashMap<String, String> =
        serde_json::from_str(&metadata_str).unwrap_or_default();
    let created_ms: i64 = row.get(6).unwrap_or(0);
    let updated_ms: i64 = row.get(7).unwrap_or(0);

    Workspace {
        id: row.get(0).unwrap_or_default(),
        title: row.get(1).unwrap_or_default(),
        repo_path: row.get(2).unwrap_or(None),
        branch: row.get(3).unwrap_or(None),
        status: WorkspaceStatus::from_str(&row.get::<_, String>(4).unwrap_or_default()),
        metadata,
        created_at: chrono::DateTime::from_timestamp_millis(created_ms)
            .unwrap_or_else(|| Utc::now()),
        updated_at: chrono::DateTime::from_timestamp_millis(updated_ms)
            .unwrap_or_else(|| Utc::now()),
    }
}
