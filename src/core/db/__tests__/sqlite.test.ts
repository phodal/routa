import fs from "fs";
import os from "os";
import path from "path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeSqliteDatabase, ensureSqliteDefaultWorkspace, getSqliteDatabase } from "../sqlite";

describe("ensureSqliteDefaultWorkspace", () => {
  let sqlite: BetterSqlite3.Database;

  beforeEach(() => {
    sqlite = new BetterSqlite3(":memory:");
    sqlite.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        metadata TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("creates the default workspace for an empty sqlite database", () => {
    ensureSqliteDefaultWorkspace(sqlite);

    const row = sqlite.prepare(`
      SELECT id, title, status, metadata
      FROM workspaces
      WHERE id = 'default'
    `).get() as { id: string; title: string; status: string; metadata: string } | undefined;

    expect(row).toMatchObject({
      id: "default",
      title: "Default Workspace",
      status: "active",
    });
    expect(JSON.parse(row?.metadata ?? "{}")).toHaveProperty("worktreeRoot");
  });

  it("does not overwrite an existing default workspace row", () => {
    sqlite.prepare(`
      INSERT INTO workspaces (id, title, status, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("default", "Existing Default", "active", "{\"keep\":true}", 1, 1);

    ensureSqliteDefaultWorkspace(sqlite);

    const row = sqlite.prepare(`
      SELECT title, metadata
      FROM workspaces
      WHERE id = 'default'
    `).get() as { title: string; metadata: string };

    expect(row.title).toBe("Existing Default");
    expect(JSON.parse(row.metadata)).toEqual({ keep: true });
  });

  it("initializes the worktrees table for local sqlite databases", () => {
    const dbPath = path.join(os.tmpdir(), `routa-sqlite-init-${Date.now()}.db`);
    closeSqliteDatabase();

    try {
      getSqliteDatabase(dbPath);
      const raw = new BetterSqlite3(dbPath, { readonly: true });
      const row = raw.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'worktrees'
      `).get() as { name: string } | undefined;
      raw.close();

      expect(row).toEqual({ name: "worktrees" });
    } finally {
      closeSqliteDatabase();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  it("recreates the worktrees table when it is missing on reopen", () => {
    const dbPath = path.join(os.tmpdir(), `routa-sqlite-repair-${Date.now()}.db`);
    closeSqliteDatabase();

    try {
      getSqliteDatabase(dbPath);
      closeSqliteDatabase();

      const writable = new BetterSqlite3(dbPath);
      writable.exec("DROP TABLE worktrees");
      writable.close();

      getSqliteDatabase(dbPath);

      const readonly = new BetterSqlite3(dbPath, { readonly: true });
      const row = readonly.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'worktrees'
      `).get() as { name: string } | undefined;
      readonly.close();

      expect(row).toEqual({ name: "worktrees" });
    } finally {
      closeSqliteDatabase();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });
});
