/**
 * SQLite Database Connection — for desktop platforms (Tauri / Electron).
 *
 * Uses better-sqlite3 via drizzle-orm for local database storage.
 * The database file is stored in the application data directory.
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
 *                 Defaults to "routa.db" in the current directory.
 */
export function getSqliteDatabase(dbPath?: string): SqliteDatabase {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    const resolvedPath = dbPath ?? "routa.db";
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
      dependencies TEXT DEFAULT '[]',
      parallel_group TEXT,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      completion_summary TEXT,
      verification_verdict TEXT,
      verification_report TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
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

  console.log("[SQLite] Tables initialized");
}

/**
 * Check if SQLite is configured as the database.
 * Always true for desktop platforms.
 */
export function isSqliteConfigured(): boolean {
  return true;
}
