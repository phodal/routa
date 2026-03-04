/**
 * Session DB Persister — persists ACP sessions to SQLite or Postgres.
 *
 * Kept in core/acp/ so relative require paths to ../db/* are stable
 * in both local-dev and Next.js compiled output.
 */

import { getDatabaseDriver, getPostgresDatabase } from "@/core/db/index";
import { PgAcpSessionStore } from "@/core/db/pg-acp-session-store";
import { SqliteAcpSessionStore } from "@/core/db/sqlite-stores";

export interface SessionPersistData {
  id: string;
  name?: string;
  cwd: string;
  /** Git branch the session is scoped to (optional) */
  branch?: string;
  workspaceId: string;
  routaAgentId: string;
  provider: string;
  role: string;
  modeId?: string;
  model?: string;
  /** Parent session ID for child (CRAFTER/GATE) sessions */
  parentSessionId?: string;
}

export async function persistSessionToDb(data: SessionPersistData): Promise<void> {
  const driver = getDatabaseDriver();
  if (driver === "memory") return;

  const now = new Date();
  const sessionRecord = {
    id: data.id,
    name: data.name,
    cwd: data.cwd,
    branch: data.branch,
    workspaceId: data.workspaceId,
    routaAgentId: data.routaAgentId,
    provider: data.provider,
    role: data.role,
    modeId: data.modeId,
    firstPromptSent: false,
    messageHistory: [] as never[],
    parentSessionId: data.parentSessionId,
    createdAt: now,
    updatedAt: now,
  };

  try {
    if (driver === "postgres") {
      const db = getPostgresDatabase();
      const pgStore = new PgAcpSessionStore(db);
      await pgStore.save(sessionRecord);
    } else {
      // sqlite — use eval("require") to avoid bundling in serverless/edge
      // eslint-disable-next-line no-eval
      const dynamicRequire = eval("require") as NodeRequire;
      const { getSqliteDatabase } = dynamicRequire("../db/sqlite");
      const db = getSqliteDatabase();
      const sqliteStore = new SqliteAcpSessionStore(db);
      await sqliteStore.save(sessionRecord);
    }
    console.log(`[SessionDB] Persisted session to ${driver}: ${data.id}`);
  } catch (err) {
    console.error(`[SessionDB] Failed to persist session to ${driver}:`, err);
  }
}

export async function deleteSessionFromDb(sessionId: string): Promise<void> {
  const driver = getDatabaseDriver();
  if (driver === "memory") return;

  try {
    if (driver === "postgres") {
      const db = getPostgresDatabase();
      await new PgAcpSessionStore(db).delete(sessionId);
    } else {
      // eslint-disable-next-line no-eval
      const dynamicRequire = eval("require") as NodeRequire;
      const { getSqliteDatabase } = dynamicRequire("../db/sqlite");
      const db = getSqliteDatabase();
      await new SqliteAcpSessionStore(db).delete(sessionId);
    }
  } catch (err) {
    console.error(`[SessionDB] Failed to delete session from ${driver}:`, err);
  }
}

export async function renameSessionInDb(sessionId: string, name: string): Promise<void> {
  const driver = getDatabaseDriver();
  if (driver === "memory") return;

  try {
    if (driver === "postgres") {
      const db = getPostgresDatabase();
      await new PgAcpSessionStore(db).rename(sessionId, name);
    } else {
      // eslint-disable-next-line no-eval
      const dynamicRequire = eval("require") as NodeRequire;
      const { getSqliteDatabase } = dynamicRequire("../db/sqlite");
      const db = getSqliteDatabase();
      await new SqliteAcpSessionStore(db).rename(sessionId, name);
    }
  } catch (err) {
    console.error(`[SessionDB] Failed to rename session in ${driver}:`, err);
  }
}

export async function hydrateSessionsFromDb(): Promise<Array<{
  id: string;
  name?: string;
  cwd: string;
  branch?: string;
  workspaceId: string;
  routaAgentId?: string;
  provider?: string;
  role?: string;
  modeId?: string;
  model?: string;
  parentSessionId?: string;
  createdAt: Date | null;
}>> {
  const driver = getDatabaseDriver();
  if (driver === "memory") return [];

  try {
    if (driver === "postgres") {
      const db = getPostgresDatabase();
      return await new PgAcpSessionStore(db).list();
    } else {
      // eslint-disable-next-line no-eval
      const dynamicRequire = eval("require") as NodeRequire;
      const { getSqliteDatabase } = dynamicRequire("../db/sqlite");
      const db = getSqliteDatabase();
      return await new SqliteAcpSessionStore(db).list();
    }
  } catch (err) {
    console.error(`[SessionDB] Failed to load sessions from ${driver}:`, err);
    return [];
  }
}

export async function saveHistoryToDb(
  sessionId: string,
  history: import("@/core/acp/http-session-store").SessionUpdateNotification[]
): Promise<void> {
  const driver = getDatabaseDriver();
  if (driver === "memory") return;

  try {
    if (driver === "postgres") {
      const db = getPostgresDatabase();
      const pgStore = new PgAcpSessionStore(db);
      const session = await pgStore.get(sessionId);
      if (!session) return;
      await pgStore.save({ ...session, messageHistory: history, updatedAt: new Date() });
    } else {
      // eslint-disable-next-line no-eval
      const dynamicRequire = eval("require") as NodeRequire;
      const { getSqliteDatabase } = dynamicRequire("../db/sqlite");
      const db = getSqliteDatabase();
      const sqliteStore = new SqliteAcpSessionStore(db);
      const session = await sqliteStore.get(sessionId);
      if (!session) return;
      await sqliteStore.save({ ...session, messageHistory: history, updatedAt: new Date() });
    }
  } catch (err) {
    console.error(`[SessionDB] Failed to save history to ${driver}:`, err);
  }
}

export async function loadHistoryFromDb(
  sessionId: string
): Promise<import("@/core/acp/http-session-store").SessionUpdateNotification[]> {
  const driver = getDatabaseDriver();
  if (driver === "memory") return [];

  try {
    if (driver === "postgres") {
      const db = getPostgresDatabase();
      return (await new PgAcpSessionStore(db).getHistory(sessionId)) as import("@/core/acp/http-session-store").SessionUpdateNotification[];
    } else {
      // eslint-disable-next-line no-eval
      const dynamicRequire = eval("require") as NodeRequire;
      const { getSqliteDatabase } = dynamicRequire("../db/sqlite");
      const db = getSqliteDatabase();
      return (await new SqliteAcpSessionStore(db).getHistory(sessionId)) as import("@/core/acp/http-session-store").SessionUpdateNotification[];
    }
  } catch (err) {
    console.error(`[SessionDB] Failed to load history from ${driver}:`, err);
    return [];
  }
}
