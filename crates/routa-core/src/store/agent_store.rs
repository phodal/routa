use chrono::Utc;
use rusqlite::OptionalExtension;
use std::collections::HashMap;

use crate::db::Database;
use crate::error::ServerError;
use crate::models::agent::{Agent, AgentRole, AgentStatus, ModelTier};

pub struct AgentStore {
    db: Database,
}

impl AgentStore {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    pub async fn save(&self, agent: &Agent) -> Result<(), ServerError> {
        let a = agent.clone();
        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "INSERT INTO agents (id, name, role, model_tier, workspace_id, parent_id, status, metadata, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                     ON CONFLICT(id) DO UPDATE SET
                       name = excluded.name,
                       role = excluded.role,
                       model_tier = excluded.model_tier,
                       workspace_id = excluded.workspace_id,
                       parent_id = excluded.parent_id,
                       status = excluded.status,
                       metadata = excluded.metadata,
                       updated_at = excluded.updated_at",
                    rusqlite::params![
                        a.id,
                        a.name,
                        a.role.as_str(),
                        a.model_tier.as_str(),
                        a.workspace_id,
                        a.parent_id,
                        a.status.as_str(),
                        serde_json::to_string(&a.metadata).unwrap_or_default(),
                        a.created_at.timestamp_millis(),
                        a.updated_at.timestamp_millis(),
                    ],
                )?;
                Ok(())
            })
            .await
    }

    pub async fn get(&self, agent_id: &str) -> Result<Option<Agent>, ServerError> {
        let id = agent_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, name, role, model_tier, workspace_id, parent_id, status, metadata, created_at, updated_at
                     FROM agents WHERE id = ?1",
                )?;
                stmt.query_row(rusqlite::params![id], |row| Ok(row_to_agent(row)))
                    .optional()
            })
            .await
    }

    pub async fn list_by_workspace(&self, workspace_id: &str) -> Result<Vec<Agent>, ServerError> {
        let ws_id = workspace_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, name, role, model_tier, workspace_id, parent_id, status, metadata, created_at, updated_at
                     FROM agents WHERE workspace_id = ?1 ORDER BY created_at DESC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![ws_id], |row| Ok(row_to_agent(row)))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    pub async fn list_by_parent(&self, parent_id: &str) -> Result<Vec<Agent>, ServerError> {
        let pid = parent_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, name, role, model_tier, workspace_id, parent_id, status, metadata, created_at, updated_at
                     FROM agents WHERE parent_id = ?1 ORDER BY created_at DESC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![pid], |row| Ok(row_to_agent(row)))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    pub async fn list_by_role(
        &self,
        workspace_id: &str,
        role: &AgentRole,
    ) -> Result<Vec<Agent>, ServerError> {
        let ws_id = workspace_id.to_string();
        let role_str = role.as_str().to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, name, role, model_tier, workspace_id, parent_id, status, metadata, created_at, updated_at
                     FROM agents WHERE workspace_id = ?1 AND role = ?2 ORDER BY created_at DESC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![ws_id, role_str], |row| Ok(row_to_agent(row)))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    pub async fn list_by_status(
        &self,
        workspace_id: &str,
        status: &AgentStatus,
    ) -> Result<Vec<Agent>, ServerError> {
        let ws_id = workspace_id.to_string();
        let status_str = status.as_str().to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, name, role, model_tier, workspace_id, parent_id, status, metadata, created_at, updated_at
                     FROM agents WHERE workspace_id = ?1 AND status = ?2 ORDER BY created_at DESC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![ws_id, status_str], |row| Ok(row_to_agent(row)))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    pub async fn delete(&self, agent_id: &str) -> Result<(), ServerError> {
        let id = agent_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                conn.execute("DELETE FROM agents WHERE id = ?1", rusqlite::params![id])?;
                Ok(())
            })
            .await
    }

    pub async fn update_status(
        &self,
        agent_id: &str,
        status: &AgentStatus,
    ) -> Result<(), ServerError> {
        let id = agent_id.to_string();
        let status_str = status.as_str().to_string();
        let now = Utc::now().timestamp_millis();
        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "UPDATE agents SET status = ?1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![status_str, now, id],
                )?;
                Ok(())
            })
            .await
    }
}

use rusqlite::Row;

fn row_to_agent(row: &Row<'_>) -> Agent {
    let metadata_str: String = row.get(7).unwrap_or_default();
    let metadata: HashMap<String, String> =
        serde_json::from_str(&metadata_str).unwrap_or_default();
    let created_ms: i64 = row.get(8).unwrap_or(0);
    let updated_ms: i64 = row.get(9).unwrap_or(0);

    Agent {
        id: row.get(0).unwrap_or_default(),
        name: row.get(1).unwrap_or_default(),
        role: AgentRole::from_str(&row.get::<_, String>(2).unwrap_or_default())
            .unwrap_or(AgentRole::Developer),
        model_tier: ModelTier::from_str(&row.get::<_, String>(3).unwrap_or_default())
            .unwrap_or(ModelTier::Smart),
        workspace_id: row.get(4).unwrap_or_default(),
        parent_id: row.get(5).unwrap_or(None),
        status: AgentStatus::from_str(&row.get::<_, String>(6).unwrap_or_default())
            .unwrap_or(AgentStatus::Pending),
        metadata,
        created_at: chrono::DateTime::from_timestamp_millis(created_ms)
            .unwrap_or_else(|| Utc::now()),
        updated_at: chrono::DateTime::from_timestamp_millis(updated_ms)
            .unwrap_or_else(|| Utc::now()),
    }
}
