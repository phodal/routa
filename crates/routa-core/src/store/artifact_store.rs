use chrono::{TimeZone, Utc};
use rusqlite::OptionalExtension;

use crate::db::Database;
use crate::error::ServerError;
use crate::models::artifact::{Artifact, ArtifactStatus, ArtifactType};

#[derive(Clone)]
pub struct ArtifactStore {
    db: Database,
}

impl ArtifactStore {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    pub async fn save(&self, artifact: &Artifact) -> Result<(), ServerError> {
        let record = artifact.clone();
        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "INSERT INTO artifacts (
                        id, type, task_id, workspace_id, provided_by_agent_id, requested_by_agent_id,
                        request_id, content, context, status, expires_at, metadata, created_at, updated_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                    ON CONFLICT(id) DO UPDATE SET
                        type = excluded.type,
                        task_id = excluded.task_id,
                        workspace_id = excluded.workspace_id,
                        provided_by_agent_id = excluded.provided_by_agent_id,
                        requested_by_agent_id = excluded.requested_by_agent_id,
                        request_id = excluded.request_id,
                        content = excluded.content,
                        context = excluded.context,
                        status = excluded.status,
                        expires_at = excluded.expires_at,
                        metadata = excluded.metadata,
                        updated_at = excluded.updated_at",
                    rusqlite::params![
                        record.id,
                        record.artifact_type.as_str(),
                        record.task_id,
                        record.workspace_id,
                        record.provided_by_agent_id,
                        record.requested_by_agent_id,
                        record.request_id,
                        record.content,
                        record.context,
                        record.status.as_str(),
                        record.expires_at.map(|value| value.timestamp_millis()),
                        record.metadata.map(|value| serde_json::to_string(&value).unwrap_or_default()),
                        record.created_at.timestamp_millis(),
                        record.updated_at.timestamp_millis(),
                    ],
                )?;
                Ok(())
            })
            .await
    }

    pub async fn get(&self, artifact_id: &str) -> Result<Option<Artifact>, ServerError> {
        let id = artifact_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, type, task_id, workspace_id, provided_by_agent_id, requested_by_agent_id,
                     request_id, content, context, status, expires_at, metadata, created_at, updated_at
                     FROM artifacts WHERE id = ?1",
                )?;
                stmt.query_row(rusqlite::params![id], |row| Ok(row_to_artifact(row)))
                    .optional()
            })
            .await
    }

    pub async fn list_by_task(&self, task_id: &str) -> Result<Vec<Artifact>, ServerError> {
        let task_id = task_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, type, task_id, workspace_id, provided_by_agent_id, requested_by_agent_id,
                     request_id, content, context, status, expires_at, metadata, created_at, updated_at
                     FROM artifacts WHERE task_id = ?1 ORDER BY created_at DESC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![task_id], |row| Ok(row_to_artifact(row)))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    pub async fn list_by_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<Artifact>, ServerError> {
        let workspace_id = workspace_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, type, task_id, workspace_id, provided_by_agent_id, requested_by_agent_id,
                     request_id, content, context, status, expires_at, metadata, created_at, updated_at
                     FROM artifacts WHERE workspace_id = ?1 ORDER BY created_at DESC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![workspace_id], |row| Ok(row_to_artifact(row)))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    pub async fn list_by_task_and_type(
        &self,
        task_id: &str,
        artifact_type: &ArtifactType,
    ) -> Result<Vec<Artifact>, ServerError> {
        let task_id = task_id.to_string();
        let artifact_type = artifact_type.as_str().to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, type, task_id, workspace_id, provided_by_agent_id, requested_by_agent_id,
                     request_id, content, context, status, expires_at, metadata, created_at, updated_at
                     FROM artifacts WHERE task_id = ?1 AND type = ?2 ORDER BY created_at DESC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![task_id, artifact_type], |row| {
                        Ok(row_to_artifact(row))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    /// Batch load artifacts for multiple tasks
    /// Returns a HashMap<task_id, Vec<Artifact>>
    pub async fn list_by_tasks(
        &self,
        task_ids: &[String],
    ) -> Result<std::collections::HashMap<String, Vec<Artifact>>, ServerError> {
        if task_ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }

        let task_ids = task_ids.to_vec();
        self.db
            .with_conn_async(move |conn| {
                // Build placeholders for IN clause
                let placeholders = task_ids
                    .iter()
                    .enumerate()
                    .map(|(i, _)| format!("?{}", i + 1))
                    .collect::<Vec<_>>()
                    .join(", ");

                let query = format!(
                    "SELECT id, type, task_id, workspace_id, provided_by_agent_id, requested_by_agent_id,
                     request_id, content, context, status, expires_at, metadata, created_at, updated_at
                     FROM artifacts WHERE task_id IN ({placeholders}) ORDER BY task_id, created_at DESC"
                );

                let mut stmt = conn.prepare(&query)?;
                let params: Vec<&dyn rusqlite::ToSql> = task_ids
                    .iter()
                    .map(|id| id as &dyn rusqlite::ToSql)
                    .collect();

                let rows = stmt
                    .query_map(params.as_slice(), |row| Ok(row_to_artifact(row)))?
                    .collect::<Result<Vec<_>, _>>()?;

                // Group by task_id
                let mut result: std::collections::HashMap<String, Vec<Artifact>> =
                    std::collections::HashMap::new();
                for artifact in rows {
                    result
                        .entry(artifact.task_id.clone())
                        .or_default()
                        .push(artifact);
                }

                Ok(result)
            })
            .await
    }

    pub async fn delete(&self, artifact_id: &str) -> Result<(), ServerError> {
        let artifact_id = artifact_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "DELETE FROM artifacts WHERE id = ?1",
                    rusqlite::params![artifact_id],
                )?;
                Ok(())
            })
            .await
    }
}

fn row_to_artifact(row: &rusqlite::Row<'_>) -> Artifact {
    let artifact_type = row
        .get::<_, String>(1)
        .unwrap_or_else(|_| "logs".to_string());
    let status = row
        .get::<_, String>(9)
        .unwrap_or_else(|_| "provided".to_string());
    let expires_at = row
        .get::<_, Option<i64>>(10)
        .ok()
        .flatten()
        .and_then(|value| Utc.timestamp_millis_opt(value).single());
    let metadata = row
        .get::<_, Option<String>>(11)
        .ok()
        .flatten()
        .and_then(|value| serde_json::from_str(&value).ok());

    Artifact {
        id: row.get(0).unwrap_or_default(),
        artifact_type: ArtifactType::from_str(&artifact_type).unwrap_or(ArtifactType::Logs),
        task_id: row.get(2).unwrap_or_default(),
        workspace_id: row.get(3).unwrap_or_default(),
        provided_by_agent_id: row.get(4).ok(),
        requested_by_agent_id: row.get(5).ok(),
        request_id: row.get(6).ok(),
        content: row.get(7).ok(),
        context: row.get(8).ok(),
        status: ArtifactStatus::from_str(&status).unwrap_or(ArtifactStatus::Provided),
        expires_at,
        metadata,
        created_at: row
            .get::<_, i64>(12)
            .ok()
            .and_then(|value| Utc.timestamp_millis_opt(value).single())
            .unwrap_or_else(Utc::now),
        updated_at: row
            .get::<_, i64>(13)
            .ok()
            .and_then(|value| Utc.timestamp_millis_opt(value).single())
            .unwrap_or_else(Utc::now),
    }
}
