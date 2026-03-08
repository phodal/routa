/**
 * SQLite Database Connection — for the local Node.js backend.
 *
 * Uses better-sqlite3 via drizzle-orm for local database storage.
 * The database file defaults to the project-local `routa.db`.
 *
 * Connection is lazy-initialized and cached for the lifetime of the process.
 */

import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import BetterSqlite3 from "better-sqlite3";
import * as schema from "./sqlite-schema";

export type SqliteDatabase = BetterSQLite3Database<typeof schema>;

const GLOBAL_KEY = "__routa_sqlite_db__";

/**
 * Get or create a SQLite database instance.
 *
 * @param dbPath - Path to the SQLite database file.
 *                 Defaults to ROUTA_DB_PATH env var, or "routa.db" in the
 *                 current directory.
 */
export function getSqliteDatabase(dbPath?: string): SqliteDatabase {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    const resolvedPath = dbPath ?? process.env.ROUTA_DB_PATH ?? "routa.db";
    console.log(`[SQLite] Opening database at: ${resolvedPath}`);
    const sqlite = new BetterSqlite3(resolvedPath);

    // Enable WAL mode for better concurrent read performance
    sqlite.pragma("journal_mode = WAL");
    // Enable foreign keys
    sqlite.pragma("foreign_keys = ON");

    const db = drizzle(sqlite, { schema });

    // Run migrations / create tables on first use
    initializeSqliteTables(db);

    g[GLOBAL_KEY] = db;
  }
  return g[GLOBAL_KEY] as SqliteDatabase;
}

/**
 * Create all tables if they don't exist.
 * Uses raw SQL for CREATE TABLE IF NOT EXISTS.
 */
function initializeSqliteTables(db: SqliteDatabase): void {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      repo_path TEXT,
      branch TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      model_tier TEXT NOT NULL DEFAULT 'SMART',
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      parent_id TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      scope TEXT,
      acceptance_criteria TEXT,
      verification_commands TEXT,
      assigned_to TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      board_id TEXT,
      column_id TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      priority TEXT,
      labels TEXT DEFAULT '[]',
      assignee TEXT,
      assigned_provider TEXT,
      assigned_role TEXT,
      assigned_specialist_id TEXT,
      assigned_specialist_name TEXT,
      trigger_session_id TEXT,
      github_id TEXT,
      github_number INTEGER,
      github_url TEXT,
      github_repo TEXT,
      github_state TEXT,
      github_synced_at INTEGER,
      last_sync_error TEXT,
      dependencies TEXT DEFAULT '[]',
      parallel_group TEXT,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      session_id TEXT,
      completion_summary TEXT,
      verification_verdict TEXT,
      verification_report TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);
  try { db.run(sql`ALTER TABLE tasks ADD COLUMN board_id TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE tasks ADD COLUMN column_id TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE tasks ADD COLUMN position INTEGER NOT NULL DEFAULT 0`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE tasks ADD COLUMN priority TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE tasks ADD COLUMN labels TEXT DEFAULT '[]'`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE tasks ADD COLUMN assignee TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE tasks ADD COLUMN assigned_provider TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE tasks ADD COLUMN assigned_role TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE tasks ADD COLUMN assigned_specialist_id TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE tasks ADD COLUMN assigned_specialist_name TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE tasks ADD COLUMN trigger_session_id TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE tasks ADD COLUMN github_id TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE tasks ADD COLUMN github_number INTEGER`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE tasks ADD COLUMN github_url TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE tasks ADD COLUMN github_repo TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE tasks ADD COLUMN github_state TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE tasks ADD COLUMN github_synced_at INTEGER`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE tasks ADD COLUMN last_sync_error TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE tasks ADD COLUMN session_id TEXT`); } catch { /* column already exists */ }

  db.run(sql`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      session_id TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'general',
      task_status TEXT,
      assigned_agent_ids TEXT,
      parent_note_id TEXT,
      linked_task_id TEXT,
      custom_metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      PRIMARY KEY (workspace_id, id)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      tool_name TEXT,
      tool_args TEXT,
      turn INTEGER
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS event_subscriptions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      event_types TEXT NOT NULL,
      exclude_self INTEGER NOT NULL DEFAULT 1,
      one_shot INTEGER NOT NULL DEFAULT 0,
      wait_group_id TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS pending_events (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      source_agent_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      data TEXT DEFAULT '{}',
      timestamp INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS acp_sessions (
      id TEXT PRIMARY KEY,
      name TEXT,
      cwd TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      routa_agent_id TEXT,
      provider TEXT,
      role TEXT,
      mode_id TEXT,
      first_prompt_sent INTEGER DEFAULT 0,
      message_history TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  // Add branch column to existing acp_sessions tables
  try { db.run(sql`ALTER TABLE acp_sessions ADD COLUMN branch TEXT`); } catch { /* column already exists */ }
  // Add parent_session_id column to existing acp_sessions tables
  try { db.run(sql`ALTER TABLE acp_sessions ADD COLUMN parent_session_id TEXT`); } catch { /* column already exists */ }

  db.run(sql`
    CREATE TABLE IF NOT EXISTS codebases (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      repo_path TEXT NOT NULL,
      branch TEXT,
      label TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      source_type TEXT,
      source_url TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  // Add source_type/source_url to existing codebases tables that predate this migration
  try { db.run(sql`ALTER TABLE codebases ADD COLUMN source_type TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE codebases ADD COLUMN source_url TEXT`); } catch { /* column already exists */ }

  db.run(sql`
    CREATE TABLE IF NOT EXISTS kanban_boards (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      columns TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      catalog_type TEXT NOT NULL DEFAULT 'skillssh',
      files TEXT NOT NULL DEFAULT '[]',
      license TEXT,
      metadata TEXT DEFAULT '{}',
      installs INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS workspace_skills (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      installed_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      PRIMARY KEY (workspace_id, skill_id)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS background_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'PENDING',
      triggered_by TEXT NOT NULL DEFAULT 'user',
      trigger_source TEXT NOT NULL DEFAULT 'manual',
      priority TEXT NOT NULL DEFAULT 'NORMAL',
      result_session_id TEXT,
      error_message TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 1,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      last_activity INTEGER,
      current_activity TEXT,
      tool_call_count INTEGER DEFAULT 0,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      workflow_run_id TEXT,
      workflow_step_name TEXT,
      depends_on_task_ids TEXT,
      task_output TEXT
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS github_webhook_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repo TEXT NOT NULL,
      github_token TEXT NOT NULL,
      webhook_secret TEXT NOT NULL DEFAULT '',
      event_types TEXT NOT NULL DEFAULT '[]',
      label_filter TEXT DEFAULT '[]',
      trigger_agent_id TEXT NOT NULL,
      workflow_id TEXT,
      workspace_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      prompt_template TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cron_expr TEXT NOT NULL,
      task_prompt TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at INTEGER,
      next_run_at INTEGER,
      last_task_id TEXT,
      prompt_template TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS webhook_trigger_logs (
      id TEXT PRIMARY KEY,
      config_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_action TEXT,
      payload TEXT DEFAULT '{}',
      background_task_id TEXT,
      signature_valid INTEGER NOT NULL DEFAULT 0,
      outcome TEXT NOT NULL DEFAULT 'triggered',
      error_message TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  console.log("[SQLite] Tables initialized");
}

/**
 * Check if SQLite is configured as the database.
 * Always true when the local Node.js backend selects SQLite.
 */
export function isSqliteConfigured(): boolean {
  return true;
}
