//! Store for ACP session persistence.
//!
//! Handles loading and saving session history to the SQLite database.

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use crate::db::Database;
use crate::error::ServerError;

/// A session update notification stored in the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUpdateNotification {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update: Option<serde_json::Value>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// ACP session record from the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpSessionRow {
    pub id: String,
    pub name: Option<String>,
    pub cwd: String,
    pub branch: Option<String>,
    pub workspace_id: String,
    pub routa_agent_id: Option<String>,
    pub provider: Option<String>,
    pub role: Option<String>,
    pub mode_id: Option<String>,
    pub custom_command: Option<String>,
    pub custom_args: Vec<String>,
    pub first_prompt_sent: bool,
    pub message_history: Vec<serde_json::Value>,
    pub created_at: i64,
    pub updated_at: i64,
    pub parent_session_id: Option<String>,
}

pub struct AcpSessionStore {
    db: Database,
}

pub struct CreateAcpSessionParams<'a> {
    pub id: &'a str,
    pub cwd: &'a str,
    pub branch: Option<&'a str>,
    pub workspace_id: &'a str,
    pub provider: Option<&'a str>,
    pub role: Option<&'a str>,
    pub custom_command: Option<&'a str>,
    pub custom_args: Option<&'a [String]>,
    pub parent_session_id: Option<&'a str>,
}

impl AcpSessionStore {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    /// Load a session by ID.
    pub async fn get(&self, session_id: &str) -> Result<Option<AcpSessionRow>, ServerError> {
        let id = session_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, name, cwd, branch, workspace_id, routa_agent_id, provider, role, mode_id,
                            custom_command, custom_args, first_prompt_sent, message_history,
                            created_at, updated_at, parent_session_id
                     FROM acp_sessions WHERE id = ?1",
                )?;

                let row = stmt
                    .query_row([&id], |row| {
                        let custom_args_json: String = row.get(10)?;
                        let custom_args: Vec<String> =
                            serde_json::from_str(&custom_args_json).unwrap_or_default();
                        let history_json: String = row.get(12)?;
                        let history: Vec<serde_json::Value> =
                            serde_json::from_str(&history_json).unwrap_or_default();

                        Ok(AcpSessionRow {
                            id: row.get(0)?,
                            name: row.get(1)?,
                            cwd: row.get(2)?,
                            branch: row.get(3)?,
                            workspace_id: row.get(4)?,
                            routa_agent_id: row.get(5)?,
                            provider: row.get(6)?,
                            role: row.get(7)?,
                            mode_id: row.get(8)?,
                            custom_command: row.get(9)?,
                            custom_args,
                            first_prompt_sent: row.get::<_, i32>(11)? != 0,
                            message_history: history,
                            created_at: row.get(13)?,
                            updated_at: row.get(14)?,
                            parent_session_id: row.get(15)?,
                        })
                    })
                    .optional()?;

                Ok(row)
            })
            .await
    }

    /// Load session history from the database.
    pub async fn get_history(
        &self,
        session_id: &str,
    ) -> Result<Vec<serde_json::Value>, ServerError> {
        let id = session_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt =
                    conn.prepare("SELECT message_history FROM acp_sessions WHERE id = ?1")?;

                let history_json: Option<String> =
                    stmt.query_row([&id], |row| row.get(0)).optional()?;

                match history_json {
                    Some(json) => {
                        let history: Vec<serde_json::Value> =
                            serde_json::from_str(&json).unwrap_or_default();
                        Ok(history)
                    }
                    None => Ok(vec![]),
                }
            })
            .await
    }

    /// List sessions, optionally filtered by workspace.
    pub async fn list(
        &self,
        workspace_id: Option<&str>,
        limit: Option<usize>,
    ) -> Result<Vec<AcpSessionRow>, ServerError> {
        let workspace_filter = workspace_id.map(|s| s.to_string());
        let limit = limit.unwrap_or(100);
        self.db
            .with_conn_async(move |conn| {
                let (sql, params): (&str, Vec<Box<dyn rusqlite::ToSql>>) = match &workspace_filter {
                    Some(ws) => (
                        "SELECT id, name, cwd, branch, workspace_id, routa_agent_id, provider, role, mode_id,
                                custom_command, custom_args, first_prompt_sent, message_history,
                                created_at, updated_at, parent_session_id
                         FROM acp_sessions WHERE workspace_id = ?1 ORDER BY updated_at DESC LIMIT ?2",
                        vec![Box::new(ws.clone()) as Box<dyn rusqlite::ToSql>, Box::new(limit as i64)],
                    ),
                    None => (
                        "SELECT id, name, cwd, branch, workspace_id, routa_agent_id, provider, role, mode_id,
                                custom_command, custom_args, first_prompt_sent, message_history,
                                created_at, updated_at, parent_session_id
                         FROM acp_sessions ORDER BY updated_at DESC LIMIT ?1",
                        vec![Box::new(limit as i64) as Box<dyn rusqlite::ToSql>],
                    ),
                };

                let mut stmt = conn.prepare(sql)?;
                let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
                let rows = stmt.query_map(param_refs.as_slice(), |row| {
                    let custom_args_json: String = row.get(10)?;
                    let custom_args: Vec<String> =
                        serde_json::from_str(&custom_args_json).unwrap_or_default();
                    let history_json: String = row.get(12)?;
                    let history: Vec<serde_json::Value> =
                        serde_json::from_str(&history_json).unwrap_or_default();

                    Ok(AcpSessionRow {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        cwd: row.get(2)?,
                        branch: row.get(3)?,
                        workspace_id: row.get(4)?,
                        routa_agent_id: row.get(5)?,
                        provider: row.get(6)?,
                        role: row.get(7)?,
                        mode_id: row.get(8)?,
                        custom_command: row.get(9)?,
                        custom_args,
                        first_prompt_sent: row.get::<_, i32>(11)? != 0,
                        message_history: history,
                        created_at: row.get(13)?,
                        updated_at: row.get(14)?,
                        parent_session_id: row.get(15)?,
                    })
                })?;

                let mut sessions = Vec::new();
                for row in rows {
                    sessions.push(row?);
                }
                Ok(sessions)
            })
            .await
    }

    /// Append a notification to session history.
    pub async fn append_history(
        &self,
        session_id: &str,
        notification: serde_json::Value,
    ) -> Result<(), ServerError> {
        let id = session_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                // Get current history
                let mut stmt =
                    conn.prepare("SELECT message_history FROM acp_sessions WHERE id = ?1")?;
                let history_json: Option<String> =
                    stmt.query_row([&id], |row| row.get(0)).optional()?;

                let mut history: Vec<serde_json::Value> = match history_json {
                    Some(json) => serde_json::from_str(&json).unwrap_or_default(),
                    None => return Ok(()), // Session doesn't exist in DB yet
                };

                // Append notification
                history.push(notification);

                // Update database
                let new_history_json = serde_json::to_string(&history).unwrap_or_default();
                let now = chrono::Utc::now().timestamp_millis();
                conn.execute(
                    "UPDATE acp_sessions SET message_history = ?1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![new_history_json, now, id],
                )?;

                Ok(())
            })
            .await
    }

    /// Persist a newly created session to the database.
    ///
    /// Called immediately after `AcpManager::create_session` so the session
    /// survives server restarts and is visible in the session list.
    pub async fn create(&self, params: CreateAcpSessionParams<'_>) -> Result<(), ServerError> {
        let CreateAcpSessionParams {
            id,
            cwd,
            branch,
            workspace_id,
            provider,
            role,
            custom_command,
            custom_args,
            parent_session_id,
        } = params;
        let id = id.to_string();
        let cwd = cwd.to_string();
        let branch = branch.map(str::to_string);
        let workspace_id = workspace_id.to_string();
        let provider = provider.map(str::to_string);
        let role = role.map(str::to_string);
        let custom_command = custom_command.map(str::to_string);
        let custom_args_json =
            serde_json::to_string(&custom_args.unwrap_or(&[])).unwrap_or_else(|_| "[]".to_string());
        let parent_session_id = parent_session_id.map(str::to_string);

        self.db
            .with_conn_async(move |conn| {
                let now = chrono::Utc::now().timestamp_millis();
                conn.execute(
                    "INSERT OR IGNORE INTO acp_sessions
                        (id, cwd, branch, workspace_id, provider, role, custom_command, custom_args, parent_session_id,
                         first_prompt_sent, message_history, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, '[]', ?10, ?10)",
                    rusqlite::params![
                        id,
                        cwd,
                        branch,
                        workspace_id,
                        provider,
                        role,
                        custom_command,
                        custom_args_json,
                        parent_session_id,
                        now
                    ],
                )?;
                Ok(())
            })
            .await
    }

    /// Rename a session in the database.
    pub async fn rename(&self, session_id: &str, name: &str) -> Result<(), ServerError> {
        let id = session_id.to_string();
        let name = name.to_string();
        self.db
            .with_conn_async(move |conn| {
                let now = chrono::Utc::now().timestamp_millis();
                conn.execute(
                    "UPDATE acp_sessions SET name = ?1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![name, now, id],
                )?;
                Ok(())
            })
            .await
    }

    /// Persist or update the ROUTA agent mapping for a session.
    pub async fn set_routa_agent_id(
        &self,
        session_id: &str,
        routa_agent_id: Option<&str>,
    ) -> Result<(), ServerError> {
        let id = session_id.to_string();
        let routa_agent_id = routa_agent_id.map(|value| value.to_string());
        self.db
            .with_conn_async(move |conn| {
                let now = chrono::Utc::now().timestamp_millis();
                conn.execute(
                    "UPDATE acp_sessions SET routa_agent_id = ?1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![routa_agent_id, now, id],
                )?;
                Ok(())
            })
            .await
    }

    /// Delete a session (and its history) from the database.
    pub async fn delete(&self, session_id: &str) -> Result<(), ServerError> {
        let id = session_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "DELETE FROM acp_sessions WHERE id = ?1",
                    rusqlite::params![id],
                )?;
                Ok(())
            })
            .await
    }

    /// Mark a session's `first_prompt_sent` flag as true.
    ///
    /// Called after the user sends the first real prompt so the session is
    /// no longer treated as "empty" in context views.
    pub async fn set_first_prompt_sent(&self, session_id: &str) -> Result<(), ServerError> {
        let id = session_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let now = chrono::Utc::now().timestamp_millis();
                conn.execute(
                    "UPDATE acp_sessions SET first_prompt_sent = 1, updated_at = ?1 WHERE id = ?2",
                    rusqlite::params![now, id],
                )?;
                Ok(())
            })
            .await
    }

    /// Overwrite the full message history for a session.
    ///
    /// Called after a prompt turn completes to flush the in-memory history
    /// accumulated by `AcpManager::push_to_history` into the database.
    pub async fn save_history(
        &self,
        session_id: &str,
        history: &[serde_json::Value],
    ) -> Result<(), ServerError> {
        let id = session_id.to_string();
        let history_json = serde_json::to_string(history).unwrap_or_else(|_| "[]".to_string());
        self.db
            .with_conn_async(move |conn| {
                let now = chrono::Utc::now().timestamp_millis();
                conn.execute(
                    "UPDATE acp_sessions SET message_history = ?1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![history_json, now, id],
                )?;
                Ok(())
            })
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::store::WorkspaceStore;

    async fn setup() -> (AcpSessionStore, String) {
        let db = Database::open_in_memory().expect("in-memory DB failed");
        let workspace_store = WorkspaceStore::new(db.clone());
        workspace_store
            .ensure_default()
            .await
            .expect("ensure_default failed");

        let store = AcpSessionStore::new(db);
        let session_id = "test-session-1".to_string();
        (store, session_id)
    }

    #[tokio::test]
    async fn test_create_and_list_session() {
        let (store, session_id) = setup().await;

        store
            .create(CreateAcpSessionParams {
                id: &session_id,
                cwd: "/tmp",
                branch: Some("main"),
                workspace_id: "default",
                provider: Some("claude"),
                role: Some("CRAFTER"),
                custom_command: None,
                custom_args: None,
                parent_session_id: None,
            })
            .await
            .expect("create failed");

        let sessions = store.list(None, None).await.expect("list failed");
        assert_eq!(sessions.len(), 1);
        let s = &sessions[0];
        assert_eq!(s.id, session_id);
        assert_eq!(s.cwd, "/tmp");
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.workspace_id, "default");
        assert_eq!(s.provider.as_deref(), Some("claude"));
        assert_eq!(s.role.as_deref(), Some("CRAFTER"));
        assert!(!s.first_prompt_sent);
        assert!(s.name.is_none());
    }

    #[tokio::test]
    async fn test_rename_session() {
        let (store, session_id) = setup().await;
        store
            .create(CreateAcpSessionParams {
                id: &session_id,
                cwd: "/tmp",
                branch: None,
                workspace_id: "default",
                provider: Some("opencode"),
                role: Some("CRAFTER"),
                custom_command: None,
                custom_args: None,
                parent_session_id: None,
            })
            .await
            .expect("create failed");

        store
            .rename(&session_id, "My Renamed Session")
            .await
            .expect("rename failed");

        let s = store
            .get(&session_id)
            .await
            .expect("get failed")
            .expect("should exist");
        assert_eq!(s.name.as_deref(), Some("My Renamed Session"));
    }

    #[tokio::test]
    async fn test_delete_session() {
        let (store, session_id) = setup().await;
        store
            .create(CreateAcpSessionParams {
                id: &session_id,
                cwd: "/tmp",
                branch: None,
                workspace_id: "default",
                provider: Some("opencode"),
                role: Some("CRAFTER"),
                custom_command: None,
                custom_args: None,
                parent_session_id: None,
            })
            .await
            .expect("create failed");

        store.delete(&session_id).await.expect("delete failed");

        let s = store.get(&session_id).await.expect("get failed");
        assert!(s.is_none(), "session should be deleted");

        let sessions = store.list(None, None).await.expect("list failed");
        assert_eq!(sessions.len(), 0);
    }

    #[tokio::test]
    async fn test_set_first_prompt_sent() {
        let (store, session_id) = setup().await;
        store
            .create(CreateAcpSessionParams {
                id: &session_id,
                cwd: "/tmp",
                branch: None,
                workspace_id: "default",
                provider: Some("opencode"),
                role: Some("CRAFTER"),
                custom_command: None,
                custom_args: None,
                parent_session_id: None,
            })
            .await
            .expect("create failed");

        let s = store
            .get(&session_id)
            .await
            .expect("get failed")
            .expect("exists");
        assert!(!s.first_prompt_sent);

        store
            .set_first_prompt_sent(&session_id)
            .await
            .expect("set_first_prompt_sent failed");

        let s = store
            .get(&session_id)
            .await
            .expect("get failed")
            .expect("exists");
        assert!(s.first_prompt_sent, "first_prompt_sent should be true");
    }

    #[tokio::test]
    async fn test_save_history() {
        let (store, session_id) = setup().await;
        store
            .create(CreateAcpSessionParams {
                id: &session_id,
                cwd: "/tmp",
                branch: None,
                workspace_id: "default",
                provider: Some("claude"),
                role: Some("CRAFTER"),
                custom_command: None,
                custom_args: None,
                parent_session_id: None,
            })
            .await
            .expect("create failed");

        let history = vec![
            serde_json::json!({"sessionId": session_id, "update": {"sessionUpdate": "agent_thought_chunk", "content": {"type": "text", "text": "Thinking..."}}}),
            serde_json::json!({"sessionId": session_id, "update": {"sessionUpdate": "turn_complete"}}),
        ];

        store
            .save_history(&session_id, &history)
            .await
            .expect("save_history failed");

        let retrieved = store
            .get_history(&session_id)
            .await
            .expect("get_history failed");
        assert_eq!(retrieved.len(), 2);
        assert_eq!(
            retrieved[1]["update"]["sessionUpdate"].as_str(),
            Some("turn_complete")
        );
    }

    #[tokio::test]
    async fn test_parent_session_id() {
        let (store, session_id) = setup().await;
        let parent_id = "parent-session-99";

        store
            .create(CreateAcpSessionParams {
                id: &session_id,
                cwd: "/tmp",
                branch: None,
                workspace_id: "default",
                provider: Some("claude"),
                role: Some("CRAFTER"),
                custom_command: None,
                custom_args: None,
                parent_session_id: Some(parent_id),
            })
            .await
            .expect("create failed");

        let s = store
            .get(&session_id)
            .await
            .expect("get failed")
            .expect("exists");
        assert_eq!(s.parent_session_id.as_deref(), Some(parent_id));
    }

    #[tokio::test]
    async fn test_set_routa_agent_id() {
        let (store, session_id) = setup().await;

        store
            .create(CreateAcpSessionParams {
                id: &session_id,
                cwd: "/tmp",
                branch: None,
                workspace_id: "default",
                provider: Some("claude"),
                role: Some("ROUTA"),
                custom_command: None,
                custom_args: None,
                parent_session_id: None,
            })
            .await
            .expect("create failed");

        store
            .set_routa_agent_id(&session_id, Some("agent-routa-1"))
            .await
            .expect("set_routa_agent_id failed");

        let session = store
            .get(&session_id)
            .await
            .expect("get failed")
            .expect("exists");
        assert_eq!(session.routa_agent_id.as_deref(), Some("agent-routa-1"));
    }

    #[tokio::test]
    async fn test_create_round_trips_custom_provider_launch() {
        let (store, session_id) = setup().await;
        let custom_args = vec!["run".to_string(), "--stdio".to_string()];

        store
            .create(CreateAcpSessionParams {
                id: &session_id,
                cwd: "/tmp",
                branch: Some("main"),
                workspace_id: "default",
                provider: Some("custom-inline"),
                role: Some("CRAFTER"),
                custom_command: Some("uvx"),
                custom_args: Some(custom_args.as_slice()),
                parent_session_id: None,
            })
            .await
            .expect("create failed");

        let session = store
            .get(&session_id)
            .await
            .expect("get failed")
            .expect("exists");

        assert_eq!(session.custom_command.as_deref(), Some("uvx"));
        assert_eq!(session.custom_args, custom_args);
    }
}
