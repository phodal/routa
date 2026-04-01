use chrono::Utc;
use rusqlite::OptionalExtension;

use crate::db::Database;
use crate::error::ServerError;
use crate::models::worktree::Worktree;

pub struct WorktreeStore {
    db: Database,
}

impl WorktreeStore {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    pub async fn save(&self, worktree: &Worktree) -> Result<(), ServerError> {
        let wt = worktree.clone();
        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "INSERT INTO worktrees (id, codebase_id, workspace_id, worktree_path, branch, base_branch, status, session_id, label, error_message, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    rusqlite::params![
                        wt.id,
                        wt.codebase_id,
                        wt.workspace_id,
                        wt.worktree_path,
                        wt.branch,
                        wt.base_branch,
                        wt.status,
                        wt.session_id,
                        wt.label,
                        wt.error_message,
                        wt.created_at.timestamp_millis(),
                        wt.updated_at.timestamp_millis(),
                    ],
                )?;
                Ok(())
            })
            .await
    }

    pub async fn get(&self, id: &str) -> Result<Option<Worktree>, ServerError> {
        let id = id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, codebase_id, workspace_id, worktree_path, branch, base_branch, status, session_id, label, error_message, created_at, updated_at
                     FROM worktrees WHERE id = ?1",
                )?;
                stmt.query_row(rusqlite::params![id], row_to_worktree)
                    .optional()
            })
            .await
    }

    pub async fn list_by_codebase(&self, codebase_id: &str) -> Result<Vec<Worktree>, ServerError> {
        let codebase_id = codebase_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, codebase_id, workspace_id, worktree_path, branch, base_branch, status, session_id, label, error_message, created_at, updated_at
                     FROM worktrees WHERE codebase_id = ?1 ORDER BY created_at DESC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![codebase_id], row_to_worktree)?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    pub async fn list_by_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<Worktree>, ServerError> {
        let workspace_id = workspace_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, codebase_id, workspace_id, worktree_path, branch, base_branch, status, session_id, label, error_message, created_at, updated_at
                     FROM worktrees WHERE workspace_id = ?1 ORDER BY created_at DESC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![workspace_id], row_to_worktree)?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    pub async fn update_status(
        &self,
        id: &str,
        status: &str,
        error_message: Option<&str>,
    ) -> Result<(), ServerError> {
        let id = id.to_string();
        let status = status.to_string();
        let error_message = error_message.map(|s| s.to_string());
        let now = Utc::now().timestamp_millis();
        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "UPDATE worktrees SET status = ?1, error_message = ?2, updated_at = ?3 WHERE id = ?4",
                    rusqlite::params![status, error_message, now, id],
                )?;
                Ok(())
            })
            .await
    }

    pub async fn assign_session(
        &self,
        id: &str,
        session_id: Option<&str>,
    ) -> Result<(), ServerError> {
        let id = id.to_string();
        let session_id = session_id.map(|s| s.to_string());
        let now = Utc::now().timestamp_millis();
        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "UPDATE worktrees SET session_id = ?1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![session_id, now, id],
                )?;
                Ok(())
            })
            .await
    }

    pub async fn delete(&self, id: &str) -> Result<(), ServerError> {
        let id = id.to_string();
        self.db
            .with_conn_async(move |conn| {
                conn.execute("DELETE FROM worktrees WHERE id = ?1", rusqlite::params![id])?;
                Ok(())
            })
            .await
    }

    pub async fn find_by_branch(
        &self,
        codebase_id: &str,
        branch: &str,
    ) -> Result<Option<Worktree>, ServerError> {
        let codebase_id = codebase_id.to_string();
        let branch = branch.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, codebase_id, workspace_id, worktree_path, branch, base_branch, status, session_id, label, error_message, created_at, updated_at
                     FROM worktrees WHERE codebase_id = ?1 AND branch = ?2",
                )?;
                stmt.query_row(rusqlite::params![codebase_id, branch], row_to_worktree)
                    .optional()
            })
            .await
    }
}

use rusqlite::Row;

fn row_to_worktree(row: &Row<'_>) -> rusqlite::Result<Worktree> {
    let created_ms: i64 = row.get(10)?;
    let updated_ms: i64 = row.get(11)?;

    Ok(Worktree {
        id: row.get(0)?,
        codebase_id: row.get(1)?,
        workspace_id: row.get(2)?,
        worktree_path: row.get(3)?,
        branch: row.get(4)?,
        base_branch: row.get(5)?,
        status: row.get(6)?,
        session_id: row.get(7)?,
        label: row.get(8)?,
        error_message: row.get(9)?,
        created_at: chrono::DateTime::from_timestamp_millis(created_ms).unwrap_or_else(Utc::now),
        updated_at: chrono::DateTime::from_timestamp_millis(updated_ms).unwrap_or_else(Utc::now),
    })
}
