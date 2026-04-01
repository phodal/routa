use chrono::Utc;
use rusqlite::OptionalExtension;

use crate::db::Database;
use crate::error::ServerError;
use crate::models::codebase::{Codebase, CodebaseSourceType};

pub struct CodebaseStore {
    db: Database,
}

impl CodebaseStore {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    pub async fn save(&self, codebase: &Codebase) -> Result<(), ServerError> {
        let cb = codebase.clone();
        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "INSERT INTO codebases (id, workspace_id, repo_path, branch, label, is_default, source_type, source_url, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    rusqlite::params![
                        cb.id,
                        cb.workspace_id,
                        cb.repo_path,
                        cb.branch,
                        cb.label,
                        cb.is_default as i32,
                        cb.source_type.as_ref().map(CodebaseSourceType::as_str),
                        cb.source_url,
                        cb.created_at.timestamp_millis(),
                        cb.updated_at.timestamp_millis(),
                    ],
                )?;
                Ok(())
            })
            .await
    }

    pub async fn get(&self, id: &str) -> Result<Option<Codebase>, ServerError> {
        let id = id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, workspace_id, repo_path, branch, label, is_default, source_type, source_url, created_at, updated_at
                     FROM codebases WHERE id = ?1",
                )?;
                stmt.query_row(rusqlite::params![id], |row| Ok(row_to_codebase(row)))
                    .optional()
            })
            .await
    }

    pub async fn list_by_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<Codebase>, ServerError> {
        let workspace_id = workspace_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, workspace_id, repo_path, branch, label, is_default, source_type, source_url, created_at, updated_at
                     FROM codebases WHERE workspace_id = ?1 ORDER BY created_at DESC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![workspace_id], |row| Ok(row_to_codebase(row)))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    pub async fn update(
        &self,
        id: &str,
        branch: Option<&str>,
        label: Option<&str>,
        repo_path: Option<&str>,
        source_type: Option<&str>,
        source_url: Option<&str>,
    ) -> Result<(), ServerError> {
        let id = id.to_string();
        let branch = branch.map(|s| s.to_string());
        let label = label.map(|s| s.to_string());
        let repo_path = repo_path.map(|s| s.to_string());
        let source_type = source_type.map(|s| s.to_string());
        let source_url = source_url.map(|s| s.to_string());
        let now = Utc::now().timestamp_millis();
        self.db
            .with_conn_async(move |conn| {
                // Build dynamic update query based on which fields are provided
                let mut updates = Vec::new();
                let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

                if let Some(ref b) = branch {
                    updates.push("branch = ?");
                    params.push(Box::new(b.clone()));
                }
                if let Some(ref l) = label {
                    updates.push("label = ?");
                    params.push(Box::new(l.clone()));
                }
                if let Some(ref r) = repo_path {
                    updates.push("repo_path = ?");
                    params.push(Box::new(r.clone()));
                }
                if let Some(ref s) = source_type {
                    updates.push("source_type = ?");
                    params.push(Box::new(s.clone()));
                }
                if let Some(ref s) = source_url {
                    updates.push("source_url = ?");
                    params.push(Box::new(s.clone()));
                }
                updates.push("updated_at = ?");
                params.push(Box::new(now));

                if updates.len() == 1 {
                    // Only updated_at, nothing to update
                    return Ok(());
                }

                let sql = format!("UPDATE codebases SET {} WHERE id = ?", updates.join(", "));
                params.push(Box::new(id.clone()));

                let params_refs: Vec<&dyn rusqlite::ToSql> =
                    params.iter().map(|p| p.as_ref()).collect();
                conn.execute(&sql, params_refs.as_slice())?;
                Ok(())
            })
            .await
    }

    pub async fn delete(&self, id: &str) -> Result<(), ServerError> {
        let id = id.to_string();
        self.db
            .with_conn_async(move |conn| {
                conn.execute("DELETE FROM codebases WHERE id = ?1", rusqlite::params![id])?;
                Ok(())
            })
            .await
    }

    pub async fn get_default(&self, workspace_id: &str) -> Result<Option<Codebase>, ServerError> {
        let workspace_id = workspace_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, workspace_id, repo_path, branch, label, is_default, source_type, source_url, created_at, updated_at
                     FROM codebases WHERE workspace_id = ?1 AND is_default = 1",
                )?;
                stmt.query_row(rusqlite::params![workspace_id], |row| Ok(row_to_codebase(row)))
                    .optional()
            })
            .await
    }

    pub async fn set_default(
        &self,
        workspace_id: &str,
        codebase_id: &str,
    ) -> Result<(), ServerError> {
        let workspace_id = workspace_id.to_string();
        let codebase_id = codebase_id.to_string();
        let now = Utc::now().timestamp_millis();
        self.db
            .with_conn_async(move |conn| {
                // Clear old default
                conn.execute(
                    "UPDATE codebases SET is_default = 0, updated_at = ?1 WHERE workspace_id = ?2 AND is_default = 1",
                    rusqlite::params![now, workspace_id],
                )?;
                // Set new default
                conn.execute(
                    "UPDATE codebases SET is_default = 1, updated_at = ?1 WHERE id = ?2 AND workspace_id = ?3",
                    rusqlite::params![now, codebase_id, workspace_id],
                )?;
                Ok(())
            })
            .await
    }

    pub async fn find_by_repo_path(
        &self,
        workspace_id: &str,
        repo_path: &str,
    ) -> Result<Option<Codebase>, ServerError> {
        let workspace_id = workspace_id.to_string();
        let repo_path = repo_path.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, workspace_id, repo_path, branch, label, is_default, source_type, source_url, created_at, updated_at
                     FROM codebases WHERE workspace_id = ?1 AND repo_path = ?2",
                )?;
                stmt.query_row(rusqlite::params![workspace_id, repo_path], |row| Ok(row_to_codebase(row)))
                    .optional()
            })
            .await
    }
}

use rusqlite::Row;

fn row_to_codebase(row: &Row<'_>) -> Codebase {
    let is_default_int: i32 = row.get(5).unwrap_or(0);
    let source_type = row
        .get::<_, Option<String>>(6)
        .unwrap_or(None)
        .and_then(|value| CodebaseSourceType::from_str(&value));
    let source_url = row.get(7).unwrap_or(None);
    let created_ms: i64 = row.get(8).unwrap_or(0);
    let updated_ms: i64 = row.get(9).unwrap_or(0);

    Codebase {
        id: row.get(0).unwrap_or_default(),
        workspace_id: row.get(1).unwrap_or_default(),
        repo_path: row.get(2).unwrap_or_default(),
        branch: row.get(3).unwrap_or(None),
        label: row.get(4).unwrap_or(None),
        is_default: is_default_int != 0,
        source_type,
        source_url,
        created_at: chrono::DateTime::from_timestamp_millis(created_ms).unwrap_or_else(Utc::now),
        updated_at: chrono::DateTime::from_timestamp_millis(updated_ms).unwrap_or_else(Utc::now),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::models::workspace::Workspace;
    use crate::store::WorkspaceStore;

    async fn setup() -> CodebaseStore {
        let db = Database::open_in_memory().expect("in-memory db should open");
        let workspace_store = WorkspaceStore::new(db.clone());
        workspace_store
            .save(&Workspace::new(
                "ws-codebase".to_string(),
                "Codebase Workspace".to_string(),
                None,
            ))
            .await
            .expect("workspace should be created");
        CodebaseStore::new(db)
    }

    fn make_codebase(
        id: &str,
        repo_path: &str,
        branch: Option<&str>,
        label: Option<&str>,
        is_default: bool,
        source_type: Option<CodebaseSourceType>,
        source_url: Option<&str>,
    ) -> Codebase {
        Codebase::new(
            id.to_string(),
            "ws-codebase".to_string(),
            repo_path.to_string(),
            branch.map(str::to_string),
            label.map(str::to_string),
            is_default,
            source_type,
            source_url.map(str::to_string),
        )
    }

    #[tokio::test]
    async fn save_get_and_find_by_repo_path_roundtrip() {
        let store = setup().await;
        let cb = make_codebase(
            "cb-1",
            "/tmp/repo-1",
            Some("main"),
            Some("Primary"),
            false,
            Some(CodebaseSourceType::Github),
            Some("https://github.com/example/repo-1"),
        );
        store.save(&cb).await.expect("save should succeed");

        let loaded = store
            .get("cb-1")
            .await
            .expect("get should succeed")
            .expect("codebase should exist");
        assert_eq!(loaded.repo_path, "/tmp/repo-1");
        assert_eq!(loaded.branch.as_deref(), Some("main"));
        assert_eq!(loaded.label.as_deref(), Some("Primary"));
        assert_eq!(loaded.source_type, Some(CodebaseSourceType::Github));
        assert_eq!(
            loaded.source_url.as_deref(),
            Some("https://github.com/example/repo-1")
        );

        let found = store
            .find_by_repo_path("ws-codebase", "/tmp/repo-1")
            .await
            .expect("find_by_repo_path should succeed")
            .expect("codebase should be found");
        assert_eq!(found.id, "cb-1");
    }

    #[tokio::test]
    async fn update_changes_selected_fields() {
        let store = setup().await;
        let cb = make_codebase(
            "cb-2",
            "/tmp/repo-2",
            Some("main"),
            None,
            false,
            Some(CodebaseSourceType::Local),
            None,
        );
        store.save(&cb).await.expect("save should succeed");

        store
            .update(
                "cb-2",
                Some("develop"),
                Some("Renamed"),
                Some("/tmp/repo-2b"),
                Some("github"),
                Some("https://github.com/example/repo-2"),
            )
            .await
            .expect("update should succeed");

        let loaded = store
            .get("cb-2")
            .await
            .expect("get should succeed")
            .expect("codebase should exist");
        assert_eq!(loaded.branch.as_deref(), Some("develop"));
        assert_eq!(loaded.label.as_deref(), Some("Renamed"));
        assert_eq!(loaded.repo_path, "/tmp/repo-2b");
        assert_eq!(loaded.source_type, Some(CodebaseSourceType::Github));
        assert_eq!(
            loaded.source_url.as_deref(),
            Some("https://github.com/example/repo-2")
        );
    }

    #[tokio::test]
    async fn set_default_switches_default_codebase() {
        let store = setup().await;
        let first = make_codebase("cb-3", "/tmp/repo-3", None, None, true, None, None);
        let second = make_codebase("cb-4", "/tmp/repo-4", None, None, false, None, None);
        store.save(&first).await.expect("save first should succeed");
        store
            .save(&second)
            .await
            .expect("save second should succeed");

        store
            .set_default("ws-codebase", "cb-4")
            .await
            .expect("set_default should succeed");

        let default = store
            .get_default("ws-codebase")
            .await
            .expect("get_default should succeed")
            .expect("default should exist");
        assert_eq!(default.id, "cb-4");

        let first_after = store
            .get("cb-3")
            .await
            .expect("get first should succeed")
            .expect("first should exist");
        assert!(!first_after.is_default);
    }

    #[tokio::test]
    async fn list_by_workspace_and_delete_work() {
        let store = setup().await;
        let cb = make_codebase("cb-5", "/tmp/repo-5", None, None, false, None, None);
        store.save(&cb).await.expect("save should succeed");

        let list = store
            .list_by_workspace("ws-codebase")
            .await
            .expect("list_by_workspace should succeed");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "cb-5");

        store.delete("cb-5").await.expect("delete should succeed");
        assert!(store
            .get("cb-5")
            .await
            .expect("get should succeed")
            .is_none());
    }
}
