use crate::feature_trace::SessionTraceMaterial;
use crate::shared::models::{
    AttributionConfidence, FileEventRecord, FileStateRow, SessionRecord, TaskView,
};
use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;
use serde_json::Value;

pub type SessionListRow = (
    String,
    String,
    String,
    i64,
    i64,
    String,
    String,
    Option<i64>,
);

type FileStateMeta = (Option<i64>, Option<i64>, bool);

fn task_recovered_from_metadata(metadata_json: &str) -> bool {
    serde_json::from_str::<Value>(metadata_json)
        .ok()
        .and_then(|value| {
            value
                .get("recovered_from_transcript")
                .and_then(Value::as_bool)
        })
        .unwrap_or(false)
}

pub struct Db {
    conn: Connection,
}

#[allow(dead_code)]
impl Db {
    fn task_view_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskView> {
        let metadata_json: String = row.get(10)?;
        Ok(TaskView {
            task_id: row.get(0)?,
            session_id: row.get(1)?,
            turn_id: row.get(2)?,
            title: row.get(3)?,
            objective: row.get(4)?,
            prompt_preview: row.get(5)?,
            transcript_path: row.get(6)?,
            recovered_from_transcript: task_recovered_from_metadata(&metadata_json),
            status: row.get(7)?,
            created_at_ms: row.get(8)?,
            updated_at_ms: row.get(9)?,
        })
    }

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
            task_id TEXT,
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
            task_id TEXT,
            confidence TEXT,
            source TEXT,
            PRIMARY KEY (repo_root, rel_path)
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_repo_status ON sessions (repo_root, status, last_seen_at_ms);
        CREATE INDEX IF NOT EXISTS idx_turns_session ON turns (session_id, observed_at_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_file_events_repo ON file_events (repo_root, rel_path, observed_at_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_file_state_dirty ON file_state (repo_root, is_dirty);
        CREATE INDEX IF NOT EXISTS idx_git_events_repo ON git_events (repo_root, observed_at_ms DESC);

        CREATE TABLE IF NOT EXISTS eval_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            repo_root TEXT NOT NULL,
            run_id TEXT,
            mode TEXT NOT NULL,
            overall_score REAL NOT NULL,
            hard_gate_blocked INTEGER NOT NULL DEFAULT 0,
            score_blocked INTEGER NOT NULL DEFAULT 0,
            evaluated_at_ms INTEGER NOT NULL,
            duration_ms REAL NOT NULL DEFAULT 0,
            payload_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE INDEX IF NOT EXISTS idx_eval_snapshots_repo ON eval_snapshots (repo_root, evaluated_at_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_eval_snapshots_run ON eval_snapshots (run_id, evaluated_at_ms DESC);

        CREATE TABLE IF NOT EXISTS tasks (
            task_id TEXT PRIMARY KEY,
            repo_root TEXT NOT NULL,
            session_id TEXT NOT NULL,
            turn_id TEXT,
            title TEXT NOT NULL,
            objective TEXT NOT NULL,
            prompt_preview TEXT,
            transcript_path TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_repo_updated ON tasks (repo_root, updated_at_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_tasks_session_updated ON tasks (repo_root, session_id, updated_at_ms DESC);

        CREATE TABLE IF NOT EXISTS session_task_links (
            repo_root TEXT NOT NULL,
            session_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            linked_at_ms INTEGER NOT NULL,
            PRIMARY KEY (repo_root, session_id, task_id)
        );

        CREATE INDEX IF NOT EXISTS idx_session_task_links_active
            ON session_task_links (repo_root, session_id, is_active, linked_at_ms DESC);

        CREATE TABLE IF NOT EXISTS turn_task_links (
            repo_root TEXT NOT NULL,
            session_id TEXT NOT NULL,
            turn_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            linked_at_ms INTEGER NOT NULL,
            PRIMARY KEY (repo_root, session_id, turn_id)
        );

        CREATE INDEX IF NOT EXISTS idx_turn_task_links_task
            ON turn_task_links (repo_root, task_id, linked_at_ms DESC);
        "#;
        self.conn
            .execute_batch(schema)
            .context("apply sqlite schema")?;
        self.ensure_column("file_events", "task_id", "TEXT")?;
        self.ensure_column("file_state", "task_id", "TEXT")?;
        Ok(())
    }

    fn ensure_column(&self, table: &str, column: &str, definition: &str) -> Result<()> {
        let pragma = format!("PRAGMA table_info({table})");
        let mut stmt = self
            .conn
            .prepare(&pragma)
            .with_context(|| format!("prepare table info for {table}"))?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .with_context(|| format!("read table info for {table}"))?;
        for row in rows {
            if row.with_context(|| format!("inspect columns for {table}"))? == column {
                return Ok(());
            }
        }
        let sql = format!("ALTER TABLE {table} ADD COLUMN {column} {definition}");
        self.conn
            .execute(&sql, [])
            .with_context(|| format!("add column {table}.{column}"))?;
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

    #[allow(clippy::too_many_arguments)]
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
                    turn_id, task_id, confidence, source, metadata_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    record.repo_root,
                    record.rel_path,
                    record.event_kind,
                    record.observed_at_ms,
                    record.session_id,
                    record.turn_id,
                    record.task_id,
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

    #[allow(clippy::too_many_arguments)]
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
                    last_seen_ms, session_id, turn_id, task_id, confidence, source
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                ON CONFLICT(repo_root, rel_path) DO UPDATE SET
                    is_dirty = excluded.is_dirty,
                    state_code = excluded.state_code,
                    mtime_ms = excluded.mtime_ms,
                    size_bytes = excluded.size_bytes,
                    last_seen_ms = excluded.last_seen_ms,
                    session_id = excluded.session_id,
                    turn_id = excluded.turn_id,
                    task_id = excluded.task_id,
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
                    self.resolve_task_id(repo_root, session_id, turn_id)?,
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

    pub fn list_active_sessions(&self, repo_root: &str) -> Result<Vec<SessionListRow>> {
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

    pub fn session_last_seen_at_ms(&self, session_id: &str) -> Result<Option<i64>> {
        self.conn
            .query_row(
                "SELECT last_seen_at_ms FROM sessions WHERE session_id = ?1",
                params![session_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .context("query session last_seen_at_ms")
    }

    pub fn session_trace_material(
        &self,
        repo_root: &str,
        session_id: &str,
    ) -> Result<SessionTraceMaterial> {
        let mut changed_stmt = self
            .conn
            .prepare(
                "SELECT DISTINCT rel_path
                 FROM file_events
                 WHERE repo_root = ?1 AND session_id = ?2
                 ORDER BY rel_path ASC",
            )
            .context("prepare session changed files query")?;
        let changed_rows = changed_stmt
            .query_map(params![repo_root, session_id], |row| {
                row.get::<_, String>(0)
            })
            .context("query session changed files")?;
        let mut changed_files = Vec::new();
        for row in changed_rows {
            changed_files.push(row.context("read session changed file")?);
        }

        let mut tool_stmt = self
            .conn
            .prepare(
                "SELECT tool_name
                 FROM turns
                 WHERE repo_root = ?1
                   AND session_id = ?2
                   AND tool_name IS NOT NULL
                   AND TRIM(tool_name) != ''
                 ORDER BY observed_at_ms ASC",
            )
            .context("prepare session tool calls query")?;
        let tool_rows = tool_stmt
            .query_map(params![repo_root, session_id], |row| {
                row.get::<_, String>(0)
            })
            .context("query session tool calls")?;
        let mut tool_call_names = Vec::new();
        for row in tool_rows {
            tool_call_names.push(row.context("read session tool name")?);
        }

        Ok(SessionTraceMaterial::new(
            session_id.to_string(),
            changed_files,
            tool_call_names,
        ))
    }

    pub fn file_state_all_dirty(&self, repo_root: &str) -> Result<Vec<FileStateRow>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT
                    rel_path, is_dirty, state_code, mtime_ms, size_bytes,
                    last_seen_ms, session_id, turn_id, task_id, confidence, source
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
                    task_id: row.get(8)?,
                    confidence: row.get::<_, Option<String>>(9)?,
                    source: row.get(10)?,
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
                        session_id, turn_id, task_id, confidence, source, metadata_json
                 FROM file_events
                 WHERE repo_root = ?1 AND rel_path = ?2
                 ORDER BY observed_at_ms DESC
                 LIMIT 1",
            )
            .context("prepare latest file event query")?;

        stmt.query_row(params![repo_root, rel_path], |row| {
            let conf: String = row.get(8)?;
            Ok(FileEventRecord {
                id: Some(row.get(0)?),
                repo_root: row.get(1)?,
                rel_path: row.get(2)?,
                event_kind: row.get(3)?,
                observed_at_ms: row.get(4)?,
                session_id: row.get(5)?,
                turn_id: row.get(6)?,
                task_id: row.get(7)?,
                confidence: AttributionConfidence::from_str(&conf),
                source: row.get(9)?,
                metadata_json: row.get(10)?,
            })
        })
        .optional()
        .context("load latest file event")
    }

    pub fn get_file_state(&self, repo_root: &str, rel_path: &str) -> Result<Option<FileStateMeta>> {
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
                "SELECT id, repo_root, rel_path, event_kind, observed_at_ms, session_id, turn_id, task_id, confidence, source, metadata_json
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
                    task_id: row.get::<_, Option<String>>(7)?,
                    confidence: AttributionConfidence::from_str(&row.get::<_, String>(8)?),
                    source: row.get(9)?,
                    metadata_json: row.get(10)?,
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
        Ok(updated)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn upsert_task_from_prompt(
        &self,
        repo_root: &str,
        session_id: &str,
        turn_id: Option<&str>,
        transcript_path: Option<&str>,
        task_id: &str,
        title: &str,
        objective: &str,
        prompt_preview: Option<&str>,
        recovered_from_transcript: bool,
        observed_at_ms: i64,
    ) -> Result<TaskView> {
        self.conn
            .execute(
                "UPDATE session_task_links
                 SET is_active = 0
                 WHERE repo_root = ?1 AND session_id = ?2 AND task_id != ?3",
                params![repo_root, session_id, task_id],
            )
            .context("deactivate prior session tasks")?;
        self.conn
            .execute(
                "UPDATE tasks
                 SET status = 'superseded', updated_at_ms = ?4
                 WHERE repo_root = ?1 AND session_id = ?2 AND task_id != ?3 AND status = 'active'",
                params![repo_root, session_id, task_id, observed_at_ms],
            )
            .context("mark prior tasks superseded")?;
        self.conn
            .execute(
                "INSERT INTO tasks (
                    task_id, repo_root, session_id, turn_id, title, objective, prompt_preview,
                    transcript_path, status, created_at_ms, updated_at_ms, metadata_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active', ?9, ?10, ?11)
                ON CONFLICT(task_id) DO UPDATE SET
                    session_id = excluded.session_id,
                    turn_id = excluded.turn_id,
                    title = excluded.title,
                    objective = excluded.objective,
                    prompt_preview = excluded.prompt_preview,
                    transcript_path = COALESCE(excluded.transcript_path, tasks.transcript_path),
                    status = 'active',
                    updated_at_ms = excluded.updated_at_ms,
                    metadata_json = excluded.metadata_json",
                params![
                    task_id,
                    repo_root,
                    session_id,
                    turn_id,
                    title,
                    objective,
                    prompt_preview,
                    transcript_path,
                    observed_at_ms,
                    observed_at_ms,
                    json!({
                        "source": if recovered_from_transcript {
                            "transcript_recovery"
                        } else {
                            "UserPromptSubmit"
                        },
                        "recovered_from_transcript": recovered_from_transcript,
                    })
                    .to_string(),
                ],
            )
            .context("upsert task")?;
        self.conn
            .execute(
                "INSERT INTO session_task_links (repo_root, session_id, task_id, is_active, linked_at_ms)
                 VALUES (?1, ?2, ?3, 1, ?4)
                 ON CONFLICT(repo_root, session_id, task_id) DO UPDATE SET
                    is_active = 1,
                    linked_at_ms = excluded.linked_at_ms",
                params![repo_root, session_id, task_id, observed_at_ms],
            )
            .context("upsert session task link")?;
        if let Some(turn_id) = turn_id.filter(|turn| !turn.trim().is_empty()) {
            self.conn
                .execute(
                    "INSERT INTO turn_task_links (repo_root, session_id, turn_id, task_id, linked_at_ms)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(repo_root, session_id, turn_id) DO UPDATE SET
                        task_id = excluded.task_id,
                        linked_at_ms = excluded.linked_at_ms",
                    params![repo_root, session_id, turn_id, task_id, observed_at_ms],
                )
                .context("upsert turn task link")?;
        }
        self.get_task(repo_root, task_id)?
            .context("load task after prompt upsert")
    }

    pub fn list_tasks(&self, repo_root: &str) -> Result<Vec<TaskView>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT task_id, session_id, turn_id, title, objective, prompt_preview, transcript_path,
                        status, created_at_ms, updated_at_ms, metadata_json
                 FROM tasks
                 WHERE repo_root = ?1
                 ORDER BY updated_at_ms DESC",
            )
            .context("prepare task list query")?;
        let rows = stmt
            .query_map(params![repo_root], Self::task_view_from_row)
            .context("query tasks")?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.context("read task row")?);
        }
        Ok(out)
    }

    pub fn get_task(&self, repo_root: &str, task_id: &str) -> Result<Option<TaskView>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT task_id, session_id, turn_id, title, objective, prompt_preview, transcript_path,
                        status, created_at_ms, updated_at_ms, metadata_json
                 FROM tasks
                 WHERE repo_root = ?1 AND task_id = ?2",
            )
            .context("prepare task query")?;
        stmt.query_row(params![repo_root, task_id], Self::task_view_from_row)
            .optional()
            .context("read task")
    }

    pub fn active_task_for_session(
        &self,
        repo_root: &str,
        session_id: &str,
    ) -> Result<Option<TaskView>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT t.task_id, t.session_id, t.turn_id, t.title, t.objective, t.prompt_preview,
                        t.transcript_path, t.status, t.created_at_ms, t.updated_at_ms, t.metadata_json
                 FROM tasks t
                 JOIN session_task_links l
                   ON l.repo_root = t.repo_root
                  AND l.task_id = t.task_id
                 WHERE l.repo_root = ?1
                   AND l.session_id = ?2
                   AND l.is_active = 1
                 ORDER BY l.linked_at_ms DESC
                 LIMIT 1",
            )
            .context("prepare active task query")?;
        stmt.query_row(params![repo_root, session_id], Self::task_view_from_row)
            .optional()
            .context("load active task for session")
    }

    pub fn task_for_turn(
        &self,
        repo_root: &str,
        session_id: &str,
        turn_id: &str,
    ) -> Result<Option<TaskView>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT t.task_id, t.session_id, t.turn_id, t.title, t.objective, t.prompt_preview,
                        t.transcript_path, t.status, t.created_at_ms, t.updated_at_ms, t.metadata_json
                 FROM tasks t
                 JOIN turn_task_links l
                   ON l.repo_root = t.repo_root
                  AND l.task_id = t.task_id
                 WHERE l.repo_root = ?1
                   AND l.session_id = ?2
                   AND l.turn_id = ?3
                 LIMIT 1",
            )
            .context("prepare turn task query")?;
        stmt.query_row(
            params![repo_root, session_id, turn_id],
            Self::task_view_from_row,
        )
        .optional()
        .context("load task for turn")
    }

    pub fn resolve_task_id(
        &self,
        repo_root: &str,
        session_id: Option<&str>,
        turn_id: Option<&str>,
    ) -> Result<Option<String>> {
        let Some(session_id) = session_id.filter(|value| !value.trim().is_empty()) else {
            return Ok(None);
        };
        if let Some(turn_id) = turn_id.filter(|value| !value.trim().is_empty()) {
            if let Some(task) = self.task_for_turn(repo_root, session_id, turn_id)? {
                return Ok(Some(task.task_id));
            }
        }
        Ok(self
            .active_task_for_session(repo_root, session_id)?
            .map(|task| task.task_id))
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

    /// Persist an EvalSnapshot for later querying and trend display.
    pub fn insert_eval_snapshot(
        &self,
        repo_root: &str,
        snapshot: &crate::evaluate::eval::EvalSnapshot,
    ) -> Result<()> {
        let payload = serde_json::to_string(snapshot).unwrap_or_default();
        self.conn.execute(
            "INSERT INTO eval_snapshots (repo_root, run_id, mode, overall_score, hard_gate_blocked, score_blocked, evaluated_at_ms, duration_ms, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                repo_root,
                snapshot.run_id.as_ref().map(|id| id.0.as_str()),
                snapshot.mode.as_str(),
                snapshot.overall_score as f64,
                snapshot.hard_gate_blocked as i32,
                snapshot.score_blocked as i32,
                snapshot.evaluated_at_ms,
                snapshot.duration_ms,
                payload,
            ],
        ).context("insert eval snapshot")?;
        Ok(())
    }

    /// Load the most recent eval snapshots for a repo.
    pub fn list_eval_snapshots(
        &self,
        repo_root: &str,
        limit: usize,
    ) -> Result<Vec<crate::evaluate::eval::EvalSnapshot>> {
        let mut stmt = self.conn.prepare(
            "SELECT payload_json FROM eval_snapshots WHERE repo_root = ?1 ORDER BY evaluated_at_ms DESC LIMIT ?2",
        ).context("prepare eval query")?;
        let rows = stmt
            .query_map(params![repo_root, limit as i64], |row| {
                row.get::<_, String>(0)
            })
            .context("query eval snapshots")?;
        let mut out = Vec::new();
        for row in rows {
            let json_str = row.context("read eval row")?;
            if let Ok(snap) = serde_json::from_str(&json_str) {
                out.push(snap);
            }
        }
        Ok(out)
    }

    /// Load eval snapshots for a specific run.
    pub fn list_eval_snapshots_for_run(
        &self,
        run_id: &str,
        limit: usize,
    ) -> Result<Vec<crate::evaluate::eval::EvalSnapshot>> {
        let mut stmt = self.conn.prepare(
            "SELECT payload_json FROM eval_snapshots WHERE run_id = ?1 ORDER BY evaluated_at_ms DESC LIMIT ?2",
        ).context("prepare eval run query")?;
        let rows = stmt
            .query_map(params![run_id, limit as i64], |row| row.get::<_, String>(0))
            .context("query eval snapshots for run")?;
        let mut out = Vec::new();
        for row in rows {
            let json_str = row.context("read eval row")?;
            if let Ok(snap) = serde_json::from_str(&json_str) {
                out.push(snap);
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::evaluate::eval::{EvalMode, EvalSnapshot};
    use crate::shared::ids::RunId;
    use tempfile::TempDir;

    fn temp_db() -> (TempDir, Db) {
        let dir = TempDir::new().unwrap();
        let db = Db::open(&dir.path().join("test.db")).unwrap();
        (dir, db)
    }

    #[test]
    fn eval_snapshot_roundtrip() {
        let (_dir, db) = temp_db();
        let snap = EvalSnapshot {
            run_id: Some(RunId("run-1".into())),
            mode: EvalMode::Fast,
            overall_score: 87.5,
            hard_gate_blocked: false,
            score_blocked: false,
            dimensions: vec![],
            evidence: vec![],
            recommendations: vec![],
            evaluated_at_ms: 1000,
            duration_ms: 42.0,
        };
        db.insert_eval_snapshot("/repo", &snap).unwrap();
        let loaded = db.list_eval_snapshots("/repo", 10).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].overall_score, 87.5);
        assert_eq!(loaded[0].run_id.as_ref().unwrap().0, "run-1");
    }

    #[test]
    fn eval_snapshots_by_run() {
        let (_dir, db) = temp_db();
        for i in 0..3 {
            let snap = EvalSnapshot {
                run_id: Some(RunId("run-x".into())),
                mode: EvalMode::Fast,
                overall_score: 80.0 + i as f32,
                hard_gate_blocked: false,
                score_blocked: false,
                dimensions: vec![],
                evidence: vec![],
                recommendations: vec![],
                evaluated_at_ms: 1000 + i,
                duration_ms: 10.0,
            };
            db.insert_eval_snapshot("/repo", &snap).unwrap();
        }
        let loaded = db.list_eval_snapshots_for_run("run-x", 10).unwrap();
        assert_eq!(loaded.len(), 3);
        // Most recent first
        assert!(loaded[0].overall_score > loaded[2].overall_score);
    }
}
