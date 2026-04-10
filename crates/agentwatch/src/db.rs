use crate::models::{AttributionConfidence, FileEventRecord, FileStateRow, SessionRecord};
use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;

pub struct Db {
    conn: Connection,
}

impl Db {
    pub fn open(path: &std::path::Path) -> Result<Self> {
        let parent = path.parent().unwrap_or(std::path::Path::new("."));
        std::fs::create_dir_all(parent).context("create db directory")?;
        let conn = Connection::open(path).context("open sqlite db")?;
        let db = Db { conn };
        db.migrate()?;
        db.conn
            .pragma_update(None, "journal_mode", "WAL")
            .context("set journal mode")?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        let schema = r#"
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            repo_root TEXT NOT NULL,
            client TEXT NOT NULL,
            cwd TEXT NOT NULL,
            model TEXT,
            started_at_ms INTEGER NOT NULL,
            last_seen_at_ms INTEGER NOT NULL,
            ended_at_ms INTEGER,
            status TEXT NOT NULL,
            tmux_session TEXT,
            tmux_window TEXT,
            tmux_pane TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS turns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            repo_root TEXT NOT NULL,
            turn_id TEXT,
            client TEXT NOT NULL,
            event_name TEXT NOT NULL,
            tool_name TEXT,
            tool_command TEXT,
            observed_at_ms INTEGER NOT NULL,
            payload_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS file_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            repo_root TEXT NOT NULL,
            rel_path TEXT NOT NULL,
            event_kind TEXT NOT NULL,
            observed_at_ms INTEGER NOT NULL,
            session_id TEXT,
            turn_id TEXT,
            confidence TEXT NOT NULL,
            source TEXT NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS git_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            repo_root TEXT NOT NULL,
            event_name TEXT NOT NULL,
            head_commit TEXT,
            branch TEXT,
            observed_at_ms INTEGER NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS file_state (
            repo_root TEXT NOT NULL,
            rel_path TEXT NOT NULL,
            is_dirty INTEGER NOT NULL,
            state_code TEXT NOT NULL DEFAULT '??',
            mtime_ms INTEGER,
            size_bytes INTEGER,
            last_seen_ms INTEGER NOT NULL,
            session_id TEXT,
            turn_id TEXT,
            confidence TEXT,
            source TEXT,
            PRIMARY KEY (repo_root, rel_path)
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_repo_status ON sessions (repo_root, status, last_seen_at_ms);
        CREATE INDEX IF NOT EXISTS idx_turns_session ON turns (session_id, observed_at_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_file_events_repo ON file_events (repo_root, rel_path, observed_at_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_file_state_dirty ON file_state (repo_root, is_dirty);
        CREATE INDEX IF NOT EXISTS idx_git_events_repo ON git_events (repo_root, observed_at_ms DESC);
        "#;
        self.conn
            .execute_batch(schema)
            .context("apply sqlite schema")?;
        Ok(())
    }

    pub fn upsert_session(&self, record: &SessionRecord) -> Result<()> {
        let existing: Option<String> = self
            .conn
            .query_row(
                "SELECT status FROM sessions WHERE session_id = ?1",
                params![record.session_id],
                |row| row.get(0),
            )
            .optional()
            .context("query session")?;

        if existing.is_none() {
            self.conn
                .execute(
                    "INSERT INTO sessions (
                        session_id, repo_root, client, cwd, model, started_at_ms,
                        last_seen_at_ms, ended_at_ms, status, tmux_session, tmux_window,
                        tmux_pane, metadata_json
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                    params![
                        record.session_id,
                        record.repo_root,
                        record.client,
                        record.cwd,
                        record.model,
                        record.started_at_ms,
                        record.last_seen_at_ms,
                        record.ended_at_ms,
                        record.status,
                        record.tmux_session,
                        record.tmux_window,
                        record.tmux_pane,
                        record.metadata_json
                    ],
                )
                .context("insert session")?;
        } else {
            self.conn
                .execute(
                    "UPDATE sessions
                     SET cwd = ?2, model = ?3, last_seen_at_ms = ?4, status = ?5,
                         tmux_session = ?6, tmux_window = ?7, tmux_pane = ?8,
                         metadata_json = COALESCE(NULLIF(?9, '{}'), metadata_json)
                     WHERE session_id = ?1",
                    params![
                        record.session_id,
                        record.cwd,
                        record.model,
                        record.last_seen_at_ms,
                        record.status,
                        record.tmux_session,
                        record.tmux_window,
                        record.tmux_pane,
                        record.metadata_json
                    ],
                )
                .context("update session")?;
        }

        Ok(())
    }

    pub fn record_turn(
        &self,
        session_id: &str,
        repo_root: &str,
        turn_id: Option<&str>,
        client: &str,
        event_name: &str,
        tool_name: Option<&str>,
        tool_command: Option<&str>,
        observed_at_ms: i64,
        payload_json: &str,
    ) -> Result<()> {
        self.conn
            .execute(
                "INSERT INTO turns (
                    session_id, repo_root, turn_id, client, event_name, tool_name,
                    tool_command, observed_at_ms, payload_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    session_id,
                    repo_root,
                    turn_id,
                    client,
                    event_name,
                    tool_name,
                    tool_command,
                    observed_at_ms,
                    payload_json
                ],
            )
            .context("insert turn")?;
        Ok(())
    }

    pub fn insert_file_event(&self, record: &FileEventRecord) -> Result<i64> {
        self.conn
            .execute(
                "INSERT INTO file_events (
                    repo_root, rel_path, event_kind, observed_at_ms, session_id,
                    turn_id, confidence, source, metadata_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    record.repo_root,
                    record.rel_path,
                    record.event_kind,
                    record.observed_at_ms,
                    record.session_id,
                    record.turn_id,
                    record.confidence.as_str(),
                    record.source,
                    record.metadata_json
                ],
            )
            .context("insert file event")?;

        Ok(self.conn.last_insert_rowid())
    }

    pub fn update_file_event_attribution(
        &self,
        event_id: i64,
        session_id: Option<&str>,
        turn_id: Option<&str>,
        confidence: AttributionConfidence,
        source: &str,
    ) -> Result<()> {
        self.conn
            .execute(
                "UPDATE file_events
                 SET session_id = ?2,
                     turn_id = ?3,
                     confidence = ?4,
                     source = ?5
                 WHERE id = ?1",
                params![event_id, session_id, turn_id, confidence.as_str(), source],
            )
            .context("update file attribution")?;
        Ok(())
    }

    pub fn update_file_state(
        &self,
        repo_root: &str,
        rel_path: &str,
        is_dirty: bool,
        state_code: &str,
        mtime_ms: Option<i64>,
        size_bytes: Option<i64>,
        observed_at_ms: i64,
        session_id: Option<&str>,
        turn_id: Option<&str>,
        confidence: Option<AttributionConfidence>,
        source: Option<&str>,
    ) -> Result<()> {
        self.conn
            .execute(
                "INSERT INTO file_state (
                    repo_root, rel_path, is_dirty, state_code, mtime_ms, size_bytes,
                    last_seen_ms, session_id, turn_id, confidence, source
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                ON CONFLICT(repo_root, rel_path) DO UPDATE SET
                    is_dirty = excluded.is_dirty,
                    state_code = excluded.state_code,
                    mtime_ms = excluded.mtime_ms,
                    size_bytes = excluded.size_bytes,
                    last_seen_ms = excluded.last_seen_ms,
                    session_id = excluded.session_id,
                    turn_id = excluded.turn_id,
                    confidence = excluded.confidence,
                    source = excluded.source",
                params![
                    repo_root,
                    rel_path,
                    if is_dirty { 1 } else { 0 },
                    state_code,
                    mtime_ms,
                    size_bytes,
                    observed_at_ms,
                    session_id,
                    turn_id,
                    confidence.map(|it| it.as_str()),
                    source,
                ],
            )
            .context("upsert file state")?;
        Ok(())
    }

    pub fn set_file_clean_missing(
        &self,
        repo_root: &str,
        current_dirty: &[String],
        observed_at_ms: i64,
    ) -> Result<()> {
        let mut sql = String::from(
            "UPDATE file_state
             SET is_dirty = 0, last_seen_ms = ?1
             WHERE repo_root = ?2 AND is_dirty = 1",
        );
        let mut params: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(current_dirty.len() + 2);
        if !current_dirty.is_empty() {
            sql.push_str(" AND rel_path NOT IN (");
            for idx in 0..current_dirty.len() {
                if idx > 0 {
                    sql.push(',');
                }
                let param_index = idx + 3;
                sql.push('?');
                sql.push_str(&param_index.to_string());
            }
            sql.push(')');
            for p in current_dirty {
                params.push(p);
            }
        }
        params.insert(0, &observed_at_ms);
        params.insert(1, &repo_root);

        let mut stmt = self
            .conn
            .prepare(&sql)
            .context("prepare clean-up statement")?;
        let _ = stmt
            .execute(rusqlite::params_from_iter(params))
            .context("mark missing files clean")?;
        Ok(())
    }

    pub fn active_sessions(&self, repo_root: &str) -> Result<Vec<(String, String, i64, String)>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT session_id, cwd, last_seen_at_ms, client
                 FROM sessions
                 WHERE repo_root = ?1 AND status = 'active'
                 ORDER BY last_seen_at_ms DESC",
            )
            .context("prepare active sessions query")?;
        let rows = stmt
            .query_map(params![repo_root], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .context("query active sessions")?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row.context("iterate sessions")?);
        }
        Ok(out)
    }

    pub fn pick_active_session(
        &self,
        repo_root: &str,
        now_ms: i64,
        window_ms: i64,
    ) -> Result<Option<String>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT session_id
                 FROM sessions
                 WHERE repo_root = ?1
                   AND status = 'active'
                   AND last_seen_at_ms >= ?2
                 ORDER BY last_seen_at_ms DESC
                 LIMIT 1",
            )
            .context("prepare inferred session query")?;
        let threshold = now_ms - window_ms.max(0);
        stmt.query_row(params![repo_root, threshold], |row| row.get::<_, String>(0))
            .optional()
            .context("pick active session")
    }

    pub fn list_active_sessions(
        &self,
        repo_root: &str,
    ) -> Result<
        Vec<(
            String,
            String,
            String,
            i64,
            i64,
            String,
            String,
            Option<i64>,
        )>,
    > {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT session_id, cwd, COALESCE(model, ''), started_at_ms, last_seen_at_ms, client, status, ended_at_ms
                 FROM sessions
                 WHERE repo_root = ?1
                 ORDER BY last_seen_at_ms DESC",
            )
            .context("prepare list sessions")?;

        let rows = stmt
            .query_map(params![repo_root], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                ))
            })
            .context("query sessions")?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row.context("load session row")?);
        }
        Ok(out)
    }

    pub fn file_state_all_dirty(&self, repo_root: &str) -> Result<Vec<FileStateRow>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT
                    rel_path, is_dirty, state_code, mtime_ms, size_bytes,
                    last_seen_ms, session_id, turn_id, confidence, source
                 FROM file_state
                 WHERE repo_root = ?1 AND is_dirty = 1
                 ORDER BY rel_path ASC",
            )
            .context("prepare dirty files query")?;

        let rows = stmt
            .query_map(params![repo_root], |row| {
                Ok(FileStateRow {
                    rel_path: row.get(0)?,
                    is_dirty: row.get::<_, i64>(1)? != 0,
                    state_code: row.get::<_, String>(2)?,
                    mtime_ms: row.get(3)?,
                    size_bytes: row.get(4)?,
                    last_seen_ms: row.get(5)?,
                    session_id: row.get(6)?,
                    turn_id: row.get(7)?,
                    confidence: row.get::<_, Option<String>>(8)?,
                    source: row.get(9)?,
                })
            })
            .context("query dirty file state")?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row.context("read dirty file row")?);
        }
        Ok(out)
    }

    pub fn get_file_event_with_latest(
        &self,
        repo_root: &str,
        rel_path: &str,
    ) -> Result<Option<FileEventRecord>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, repo_root, rel_path, event_kind, observed_at_ms,
                        session_id, turn_id, confidence, source, metadata_json
                 FROM file_events
                 WHERE repo_root = ?1 AND rel_path = ?2
                 ORDER BY observed_at_ms DESC
                 LIMIT 1",
            )
            .context("prepare latest file event query")?;

        stmt.query_row(params![repo_root, rel_path], |row| {
            let conf: String = row.get(7)?;
            Ok(FileEventRecord {
                id: Some(row.get(0)?),
                repo_root: row.get(1)?,
                rel_path: row.get(2)?,
                event_kind: row.get(3)?,
                observed_at_ms: row.get(4)?,
                session_id: row.get(5)?,
                turn_id: row.get(6)?,
                confidence: AttributionConfidence::from_str(&conf),
                source: row.get(8)?,
                metadata_json: row.get(9)?,
            })
        })
        .optional()
        .context("load latest file event")
    }

    pub fn get_file_state(
        &self,
        repo_root: &str,
        rel_path: &str,
    ) -> Result<Option<(Option<i64>, Option<i64>, bool)>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT mtime_ms, size_bytes, is_dirty
                 FROM file_state
                 WHERE repo_root = ?1 AND rel_path = ?2",
            )
            .context("prepare file state query")?;
        stmt.query_row(params![repo_root, rel_path], |row| {
            Ok((
                row.get::<_, Option<i64>>(0)?,
                row.get::<_, Option<i64>>(1)?,
                row.get::<_, i64>(2)? != 0,
            ))
        })
        .optional()
        .context("read file state")
    }

    pub fn file_state_by_repo_paths(&self, repo_root: &str) -> Result<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT rel_path FROM file_state
                 WHERE repo_root = ?1 AND is_dirty = 1",
            )
            .context("prepare dirty paths query")?;
        let rows = stmt
            .query_map(params![repo_root], |row| row.get::<_, String>(0))
            .context("query dirty paths")?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.context("read dirty path")?);
        }
        Ok(out)
    }

    pub fn insert_git_event(
        &self,
        repo_root: &str,
        event_name: &str,
        head_commit: Option<&str>,
        branch: Option<&str>,
        observed_at_ms: i64,
        metadata_json: &str,
    ) -> Result<()> {
        self.conn
            .execute(
                "INSERT INTO git_events (
                    repo_root, event_name, head_commit, branch, observed_at_ms, metadata_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    repo_root,
                    event_name,
                    head_commit,
                    branch,
                    observed_at_ms,
                    metadata_json
                ],
            )
            .context("insert git event")?;
        Ok(())
    }

    pub fn count_dirty_by_session(&self, repo_root: &str) -> Result<Vec<(String, usize)>> {
        let state_rows = self.file_state_all_dirty(repo_root)?;
        let mut count_by_session: std::collections::BTreeMap<String, usize> =
            std::collections::BTreeMap::new();

        for row in state_rows {
            let session_key = row
                .session_id
                .clone()
                .unwrap_or_else(|| "unknown".to_string());
            let key = format!(
                "{}:{}",
                session_key,
                row.confidence
                    .clone()
                    .unwrap_or_else(|| AttributionConfidence::Unknown.as_str().to_string())
            );
            let entry = count_by_session.entry(key).or_insert(0);
            *entry += 1;
        }

        let mut out = Vec::new();
        for (k, v) in count_by_session {
            out.push((k, v));
        }
        Ok(out)
    }

    pub fn latest_file_events_for_paths(
        &self,
        repo_root: &str,
        paths: &[String],
    ) -> Result<Vec<FileEventRecord>> {
        let mut result = Vec::new();
        for rel_path in paths {
            if let Some(event) = self.get_file_event_with_latest(repo_root, rel_path)? {
                result.push(event);
            }
        }
        Ok(result)
    }

    pub fn file_events_since(
        &self,
        repo_root: &str,
        since_ms: i64,
    ) -> Result<Vec<FileEventRecord>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, repo_root, rel_path, event_kind, observed_at_ms, session_id, turn_id, confidence, source, metadata_json
                 FROM file_events
                 WHERE repo_root = ?1 AND observed_at_ms >= ?2
                 ORDER BY observed_at_ms DESC",
            )
            .context("prepare events since query")?;

        let rows = stmt
            .query_map(params![repo_root, since_ms], |row| {
                Ok(FileEventRecord {
                    id: Some(row.get(0)?),
                    repo_root: row.get(1)?,
                    rel_path: row.get(2)?,
                    event_kind: row.get(3)?,
                    observed_at_ms: row.get(4)?,
                    session_id: row.get::<_, Option<String>>(5)?,
                    turn_id: row.get::<_, Option<String>>(6)?,
                    confidence: AttributionConfidence::from_str(&row.get::<_, String>(7)?),
                    source: row.get(8)?,
                    metadata_json: row.get(9)?,
                })
            })
            .context("query recent file events")?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row.context("read file event row")?);
        }
        Ok(out)
    }

    pub fn mark_inferred_sessions(
        &self,
        repo_root: &str,
        at_ms: i64,
        window_ms: i64,
        session_id: &str,
    ) -> Result<usize> {
        let mut stmt = self
            .conn
            .prepare(
                "UPDATE file_events
                 SET session_id = ?1,
                     confidence = 'inferred',
                     source = COALESCE(source, 'observe')
                 WHERE repo_root = ?2
                   AND confidence = 'unknown'
                   AND observed_at_ms >= ?3",
            )
            .context("prepare mark inferred sessions")?;
        let updated = stmt
            .execute(params![session_id, repo_root, at_ms - window_ms])
            .context("mark inferred updates")?;
        Ok(updated as usize)
    }

    pub fn clear_inconsistent_state(&self, repo_root: &str) -> Result<()> {
        self.conn
            .execute(
                "DELETE FROM file_events
                 WHERE repo_root = ?1
                   AND observed_at_ms < (
                       SELECT MAX(observed_at_ms) FROM git_events
                       WHERE repo_root = ?1
                       AND event_name IN ('post-commit', 'post-merge', 'post-checkout')
                   )",
                params![repo_root],
            )
            .context("cleanup stale events")?;
        Ok(())
    }

    pub fn git_context(&self, repo_root: &str) -> Result<serde_json::Value> {
        let head = self
            .conn
            .query_row(
                "SELECT head_commit FROM git_events WHERE repo_root = ?1 ORDER BY observed_at_ms DESC LIMIT 1",
                params![repo_root],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .context("query latest head")?;
        Ok(json!({ "latest_head": head }))
    }
}
