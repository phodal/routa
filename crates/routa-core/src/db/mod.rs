//! SQLite database layer for the Routa desktop backend.
//!
//! Uses rusqlite with WAL mode for concurrent read performance.
//! All database operations are executed via `tokio::task::spawn_blocking`
//! to avoid blocking the async runtime.

use rusqlite::Connection;
use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::error::ServerError;

/// Thread-safe handle to the SQLite database.
#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    /// Open (or create) a SQLite database at the given path.
    pub fn open(db_path: &str) -> Result<Self, ServerError> {
        let path = Path::new(db_path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }

        let conn = Connection::open(db_path)
            .map_err(|e| ServerError::Database(format!("Failed to open database: {}", e)))?;

        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(|e| ServerError::Database(format!("Failed to set pragmas: {}", e)))?;

        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };

        db.initialize_tables()?;

        tracing::info!("SQLite database opened at: {}", db_path);
        Ok(db)
    }

    /// Open an in-memory database (for testing).
    pub fn open_in_memory() -> Result<Self, ServerError> {
        let conn = Connection::open_in_memory()
            .map_err(|e| ServerError::Database(format!("Failed to open in-memory db: {}", e)))?;

        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .map_err(|e| ServerError::Database(format!("Failed to set pragmas: {}", e)))?;

        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };

        db.initialize_tables()?;
        Ok(db)
    }

    /// Execute a closure with access to the database connection.
    /// Automatically handles locking and error conversion.
    pub fn with_conn<F, T>(&self, f: F) -> Result<T, ServerError>
    where
        F: FnOnce(&Connection) -> Result<T, rusqlite::Error>,
    {
        let conn = self
            .conn
            .lock()
            .map_err(|e| ServerError::Database(format!("Lock poisoned: {}", e)))?;
        f(&conn).map_err(|e| ServerError::Database(e.to_string()))
    }

    /// Execute a closure with access to the database connection (async-friendly).
    pub async fn with_conn_async<F, T>(&self, f: F) -> Result<T, ServerError>
    where
        F: FnOnce(&Connection) -> Result<T, rusqlite::Error> + Send + 'static,
        T: Send + 'static,
    {
        let db = self.clone();
        tokio::task::spawn_blocking(move || db.with_conn(f))
            .await
            .map_err(|e| ServerError::Database(format!("Task join error: {}", e)))?
    }

    /// Create all tables if they don't exist.
    fn initialize_tables(&self) -> Result<(), ServerError> {
        self.with_conn(|conn| {
            conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS workspaces (
                    id              TEXT PRIMARY KEY,
                    title           TEXT NOT NULL,
                    status          TEXT NOT NULL DEFAULT 'active',
                    metadata        TEXT NOT NULL DEFAULT '{}',
                    created_at      INTEGER NOT NULL,
                    updated_at      INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS codebases (
                    id              TEXT PRIMARY KEY,
                    workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    repo_path       TEXT NOT NULL,
                    branch          TEXT,
                    label           TEXT,
                    is_default      INTEGER NOT NULL DEFAULT 0,
                    created_at      INTEGER NOT NULL,
                    updated_at      INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_codebases_workspace ON codebases(workspace_id);

                CREATE TABLE IF NOT EXISTS acp_sessions (
                    id              TEXT PRIMARY KEY,
                    name            TEXT,
                    cwd             TEXT NOT NULL,
                    workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    routa_agent_id  TEXT,
                    provider        TEXT,
                    role            TEXT,
                    mode_id         TEXT,
                    first_prompt_sent INTEGER DEFAULT 0,
                    message_history TEXT NOT NULL DEFAULT '[]',
                    created_at      INTEGER NOT NULL,
                    updated_at      INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_acp_sessions_workspace ON acp_sessions(workspace_id);

                CREATE TABLE IF NOT EXISTS skills (
                    id              TEXT PRIMARY KEY,
                    name            TEXT NOT NULL,
                    description     TEXT NOT NULL DEFAULT '',
                    source          TEXT NOT NULL,
                    catalog_type    TEXT NOT NULL DEFAULT 'skillssh',
                    files           TEXT NOT NULL DEFAULT '[]',
                    license         TEXT,
                    metadata        TEXT NOT NULL DEFAULT '{}',
                    installs        INTEGER NOT NULL DEFAULT 0,
                    created_at      INTEGER NOT NULL,
                    updated_at      INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS workspace_skills (
                    workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    skill_id        TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
                    installed_at    INTEGER NOT NULL,
                    PRIMARY KEY (workspace_id, skill_id)
                );

                CREATE TABLE IF NOT EXISTS agents (
                    id              TEXT PRIMARY KEY,
                    name            TEXT NOT NULL,
                    role            TEXT NOT NULL,
                    model_tier      TEXT NOT NULL DEFAULT 'SMART',
                    workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    parent_id       TEXT,
                    status          TEXT NOT NULL DEFAULT 'PENDING',
                    metadata        TEXT NOT NULL DEFAULT '{}',
                    created_at      INTEGER NOT NULL,
                    updated_at      INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS tasks (
                    id                      TEXT PRIMARY KEY,
                    title                   TEXT NOT NULL,
                    objective               TEXT NOT NULL,
                    scope                   TEXT,
                    acceptance_criteria     TEXT,
                    verification_commands   TEXT,
                    assigned_to             TEXT,
                    status                  TEXT NOT NULL DEFAULT 'PENDING',
                    dependencies            TEXT NOT NULL DEFAULT '[]',
                    parallel_group          TEXT,
                    workspace_id            TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    session_id              TEXT,
                    completion_summary      TEXT,
                    verification_verdict    TEXT,
                    verification_report     TEXT,
                    version                 INTEGER NOT NULL DEFAULT 1,
                    created_at              INTEGER NOT NULL,
                    updated_at              INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS notes (
                    id                  TEXT NOT NULL,
                    workspace_id        TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    session_id          TEXT,
                    title               TEXT NOT NULL,
                    content             TEXT NOT NULL DEFAULT '',
                    type                TEXT NOT NULL DEFAULT 'general',
                    task_status         TEXT,
                    assigned_agent_ids  TEXT,
                    parent_note_id      TEXT,
                    linked_task_id      TEXT,
                    custom_metadata     TEXT,
                    created_at          INTEGER NOT NULL,
                    updated_at          INTEGER NOT NULL,
                    PRIMARY KEY (workspace_id, id)
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id          TEXT PRIMARY KEY,
                    agent_id    TEXT NOT NULL,
                    role        TEXT NOT NULL,
                    content     TEXT NOT NULL,
                    timestamp   INTEGER NOT NULL,
                    tool_name   TEXT,
                    tool_args   TEXT,
                    turn        INTEGER
                );

                CREATE TABLE IF NOT EXISTS event_subscriptions (
                    id              TEXT PRIMARY KEY,
                    agent_id        TEXT NOT NULL,
                    agent_name      TEXT NOT NULL,
                    event_types     TEXT NOT NULL,
                    exclude_self    INTEGER NOT NULL DEFAULT 1,
                    one_shot        INTEGER NOT NULL DEFAULT 0,
                    wait_group_id   TEXT,
                    priority        INTEGER NOT NULL DEFAULT 0,
                    created_at      INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS pending_events (
                    id              TEXT PRIMARY KEY,
                    agent_id        TEXT NOT NULL,
                    event_type      TEXT NOT NULL,
                    source_agent_id TEXT NOT NULL,
                    workspace_id    TEXT NOT NULL,
                    data            TEXT NOT NULL DEFAULT '{}',
                    timestamp       INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id);
                CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);
                CREATE INDEX IF NOT EXISTS idx_notes_workspace ON notes(workspace_id);
                CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id);

                CREATE TABLE IF NOT EXISTS schedules (
                    id              TEXT PRIMARY KEY,
                    name            TEXT NOT NULL,
                    cron_expr       TEXT NOT NULL,
                    task_prompt     TEXT NOT NULL,
                    agent_id        TEXT NOT NULL,
                    workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    enabled         INTEGER NOT NULL DEFAULT 1,
                    last_run_at     INTEGER,
                    next_run_at     INTEGER,
                    last_task_id    TEXT,
                    prompt_template TEXT,
                    created_at      INTEGER NOT NULL,
                    updated_at      INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_schedules_workspace ON schedules(workspace_id);
                CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules(next_run_at) WHERE enabled = 1;

                CREATE TABLE IF NOT EXISTS worktrees (
                    id              TEXT PRIMARY KEY,
                    codebase_id     TEXT NOT NULL REFERENCES codebases(id) ON DELETE CASCADE,
                    workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    worktree_path   TEXT NOT NULL,
                    branch          TEXT NOT NULL,
                    base_branch     TEXT NOT NULL,
                    status          TEXT NOT NULL DEFAULT 'creating',
                    session_id      TEXT,
                    label           TEXT,
                    error_message   TEXT,
                    created_at      INTEGER NOT NULL,
                    updated_at      INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_worktrees_workspace ON worktrees(workspace_id);
                CREATE INDEX IF NOT EXISTS idx_worktrees_codebase ON worktrees(codebase_id);
                CREATE UNIQUE INDEX IF NOT EXISTS uq_worktrees_codebase_branch
                    ON worktrees(codebase_id, branch);
                CREATE UNIQUE INDEX IF NOT EXISTS uq_worktrees_path
                    ON worktrees(worktree_path);
                "
            )
        })?;
        self.run_migrations()
    }

    /// Apply incremental migrations for schema changes on existing databases.
    fn run_migrations(&self) -> Result<(), ServerError> {
        self.with_conn(|conn| {
            // Add session_id to tasks if it doesn't exist yet (ignore error if already present)
            let _ = conn.execute("ALTER TABLE tasks ADD COLUMN session_id TEXT", []);
            // Add session_id to notes if it doesn't exist yet (ignore error if already present)
            let _ = conn.execute("ALTER TABLE notes ADD COLUMN session_id TEXT", []);
            // Add parent_session_id to acp_sessions for CRAFTER child session tracking
            let _ = conn.execute("ALTER TABLE acp_sessions ADD COLUMN parent_session_id TEXT", []);
            // Create indexes for session_id columns
            conn.execute_batch(
                "CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
                 CREATE INDEX IF NOT EXISTS idx_notes_session ON notes(session_id);
                 CREATE INDEX IF NOT EXISTS idx_acp_sessions_parent ON acp_sessions(parent_session_id);"
            )
        })
    }
}
