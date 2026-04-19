/**
 * Session DB Persister — persists ACP sessions to DB + local JSONL files.
 *
 * In local Node.js environments, sessions are also written to JSONL files
 * under ~/.routa/projects/{folder-slug}/sessions/ for file-level persistence.
 *
 * Kept in core/acp/ so relative require paths to ../db/* are stable
 * in both local-dev and Next.js compiled output.
 */

import { getDatabaseDriver, getPostgresDatabase } from "@/core/db/index";
import { PgAcpSessionStore } from "@/core/db/pg-acp-session-store";
import { SqliteAcpSessionStore } from "@/core/db/sqlite-stores";
import { findLocalSessionRecord, LocalSessionProvider } from "@/core/storage/local-session-provider";
import type { AcpSession } from "@/core/store/acp-session-store";
import type { SessionRecord, SessionJsonlEntry } from "@/core/storage/types";

function isServerless(): boolean {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/** Get a LocalSessionProvider for the given cwd (local environments only). */
function getLocalProvider(cwd: string): LocalSessionProvider | null {
  if (isServerless()) return null;
  return new LocalSessionProvider(cwd);
}

async function loadSqliteDatabaseModule() {
  return import("@/core/db/sqlite");
}

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
  specialistId?: string;
  executionMode?: "embedded" | "runner";
  ownerInstanceId?: string;
  leaseExpiresAt?: string;
}

export async function persistSessionToDb(data: SessionPersistData): Promise<void> {
  const driver = getDatabaseDriver();

  const now = new Date();
  const sessionRecord: AcpSession = {
    id: data.id,
    name: data.name,
    cwd: data.cwd,
    branch: data.branch,
    workspaceId: data.workspaceId,
    routaAgentId: data.routaAgentId,
    provider: data.provider,
    role: data.role,
    modeId: data.modeId,
    model: data.model,
    firstPromptSent: false,
    messageHistory: [] as never[],
    parentSessionId: data.parentSessionId,
    specialistId: data.specialistId,
    executionMode: data.executionMode,
    ownerInstanceId: data.ownerInstanceId,
    leaseExpiresAt: data.leaseExpiresAt,
    createdAt: now,
    updatedAt: now,
  };

  // 1. Persist to DB (Postgres or SQLite)
  if (driver !== "memory") {
    try {
      if (driver === "postgres") {
        const db = getPostgresDatabase();
        await new PgAcpSessionStore(db).save(sessionRecord);
      } else {
        const { getSqliteDatabase } = await loadSqliteDatabaseModule();
        const db = getSqliteDatabase();
        await new SqliteAcpSessionStore(db).save(sessionRecord);
      }
      console.log(`[SessionDB] Persisted session to ${driver}: ${data.id}`);
    } catch (err) {
      console.error(`[SessionDB] Failed to persist session to ${driver}:`, err);
    }
  }

  // 2. Also persist to local JSONL file (non-serverless only)
  const local = getLocalProvider(data.cwd);
  if (local) {
    try {
      const record: SessionRecord = {
        id: data.id,
        name: data.name,
        cwd: data.cwd,
        branch: data.branch,
        workspaceId: data.workspaceId,
        routaAgentId: data.routaAgentId,
        provider: data.provider,
        role: data.role,
        modeId: data.modeId,
        model: data.model,
        parentSessionId: data.parentSessionId,
        specialistId: data.specialistId,
        executionMode: data.executionMode,
        ownerInstanceId: data.ownerInstanceId,
        leaseExpiresAt: data.leaseExpiresAt,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      await local.save(record);
    } catch (err) {
      console.error(`[SessionDB] Failed to persist session to JSONL:`, err);
    }
  }
}

export async function deleteSessionFromDb(sessionId: string): Promise<void> {
  const driver = getDatabaseDriver();

  // Delete from DB
  if (driver !== "memory") {
    try {
      if (driver === "postgres") {
        const db = getPostgresDatabase();
        await new PgAcpSessionStore(db).delete(sessionId);
      } else {
        const { getSqliteDatabase } = await loadSqliteDatabaseModule();
        const db = getSqliteDatabase();
        await new SqliteAcpSessionStore(db).delete(sessionId);
      }
    } catch (err) {
      console.error(`[SessionDB] Failed to delete session from ${driver}:`, err);
    }
  }

  // Also delete local JSONL file — we need cwd to locate the file,
  // but we don't have it here. The JSONL file will be orphaned but harmless.
  // A future cleanup task can handle this.
}

export async function renameSessionInDb(sessionId: string, name: string): Promise<void> {
  const driver = getDatabaseDriver();

  if (driver !== "memory") {
    try {
      if (driver === "postgres") {
        const db = getPostgresDatabase();
        await new PgAcpSessionStore(db).rename(sessionId, name);
      } else {
        const { getSqliteDatabase } = await loadSqliteDatabaseModule();
        const db = getSqliteDatabase();
        await new SqliteAcpSessionStore(db).rename(sessionId, name);
      }
    } catch (err) {
      console.error(`[SessionDB] Failed to rename session in ${driver}:`, err);
    }
  }

  // Note: JSONL rename requires reading the session first to get cwd.
  // The metadata will be updated on next save() call.
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
  specialistId?: string;
  executionMode?: "embedded" | "runner";
  ownerInstanceId?: string;
  leaseExpiresAt?: string;
  createdAt: Date | null;
}>> {
  const driver = getDatabaseDriver();
  if (driver === "memory") return [];

  try {
    if (driver === "postgres") {
      const db = getPostgresDatabase();
      return await new PgAcpSessionStore(db).list();
    } else {
      const { getSqliteDatabase } = await loadSqliteDatabaseModule();
      const db = getSqliteDatabase();
      return await new SqliteAcpSessionStore(db).list();
    }
  } catch (err) {
    console.error(`[SessionDB] Failed to load sessions from ${driver}:`, err);
    return [];
  }
}

export async function loadSessionFromDb(sessionId: string): Promise<{
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
  specialistId?: string;
  executionMode?: "embedded" | "runner";
  ownerInstanceId?: string;
  leaseExpiresAt?: string;
  createdAt: Date | null;
} | null> {
  const driver = getDatabaseDriver();
  if (driver === "memory") return null;

  try {
    if (driver === "postgres") {
      const db = getPostgresDatabase();
      return await new PgAcpSessionStore(db).get(sessionId) ?? null;
    }

    const { getSqliteDatabase } = await loadSqliteDatabaseModule();
    const db = getSqliteDatabase();
    return await new SqliteAcpSessionStore(db).get(sessionId) ?? null;
  } catch (err) {
    console.error(`[SessionDB] Failed to load session ${sessionId} from ${driver}:`, err);
    return null;
  }
}

export async function loadSessionFromLocalStorage(sessionId: string): Promise<{
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
  specialistId?: string;
  executionMode?: "embedded" | "runner";
  ownerInstanceId?: string;
  leaseExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
} | null> {
  return (await findLocalSessionRecord(sessionId)) ?? null;
}

export async function updateSessionExecutionBindingInDb(
  sessionId: string,
  binding: {
    executionMode?: "embedded" | "runner";
    ownerInstanceId?: string;
    leaseExpiresAt?: string;
  }
): Promise<void> {
  const driver = getDatabaseDriver();
  if (driver === "memory") return;

  try {
    if (driver === "postgres") {
      const db = getPostgresDatabase();
      const store = new PgAcpSessionStore(db);
      const session = await store.get(sessionId);
      if (!session) return;
      await store.save({
        ...session,
        executionMode: binding.executionMode ?? session.executionMode,
        ownerInstanceId: binding.ownerInstanceId ?? session.ownerInstanceId,
        leaseExpiresAt: binding.leaseExpiresAt ?? session.leaseExpiresAt,
        updatedAt: new Date(),
      });
      return;
    }

    const { getSqliteDatabase } = await loadSqliteDatabaseModule();
    const db = getSqliteDatabase();
    const store = new SqliteAcpSessionStore(db);
    const session = await store.get(sessionId);
    if (!session) return;
    await store.save({
      ...session,
      executionMode: binding.executionMode ?? session.executionMode,
      ownerInstanceId: binding.ownerInstanceId ?? session.ownerInstanceId,
      leaseExpiresAt: binding.leaseExpiresAt ?? session.leaseExpiresAt,
      updatedAt: new Date(),
    });
  } catch (err) {
    console.error(`[SessionDB] Failed to update execution binding in ${driver}:`, err);
  }
}

export async function saveHistoryToDb(
  sessionId: string,
  history: import("@/core/acp/http-session-store").SessionUpdateNotification[]
): Promise<void> {
  const driver = getDatabaseDriver();
  const normalizedHistory = normalizeSessionHistory(history);
  const firstPromptSent = hasUserMessageInHistory(normalizedHistory);

  // 1. Save full history snapshot to DB
  if (driver !== "memory") {
    try {
      if (driver === "postgres") {
        const db = getPostgresDatabase();
        const pgStore = new PgAcpSessionStore(db);
        const session = await pgStore.get(sessionId);
        if (!session) return;
        await pgStore.save({
          ...session,
          firstPromptSent: session.firstPromptSent || firstPromptSent,
          messageHistory: normalizedHistory,
          updatedAt: new Date(),
        });
      } else {
        const { getSqliteDatabase } = await loadSqliteDatabaseModule();
        const db = getSqliteDatabase();
        const sqliteStore = new SqliteAcpSessionStore(db);
        const session = await sqliteStore.get(sessionId);
        if (!session) return;
        await sqliteStore.save({
          ...session,
          firstPromptSent: session.firstPromptSent || firstPromptSent,
          messageHistory: normalizedHistory,
          updatedAt: new Date(),
        });
      }
    } catch (err) {
      console.error(`[SessionDB] Failed to save history to ${driver}:`, err);
    }
  }

  // 2. Also append to local JSONL (non-serverless only)
  // We need the session's cwd to locate the JSONL file.
  // Try in-memory store first; fall back to SQLite session record so writes
  // still succeed after a server restart when the in-memory store is empty.
  if (!isServerless()) {
    try {
      let cwd: string | undefined;

      // Primary: in-memory store (fast, always available during active session)
      const { getHttpSessionStore } = await import("@/core/acp/http-session-store");
      const memStore = getHttpSessionStore();
      cwd = memStore.getSession(sessionId)?.cwd;

      // Fallback: SQLite session record (available after server restart)
      if (!cwd && driver === "sqlite") {
        try {
          const { getSqliteDatabase } = await loadSqliteDatabaseModule();
          const db = getSqliteDatabase();
          const sqliteSession = await new SqliteAcpSessionStore(db).get(sessionId);
          cwd = sqliteSession?.cwd;
        } catch {
          // ignore — cwd stays undefined
        }
      }

      if (cwd) {
        const local = new LocalSessionProvider(cwd);
        await local.replaceHistory(sessionId, toJsonlHistoryEntries(sessionId, normalizedHistory));
      }
    } catch {
      // Non-fatal — JSONL write is best-effort
    }
  }
}

export async function appendSessionNotificationEvent(
  sessionId: string,
  notification: import("@/core/acp/http-session-store").SessionUpdateNotification,
  cwdOverride?: string,
): Promise<void> {
  const driver = getDatabaseDriver();

  // Write JSONL first — getHistory falls back to JSONL when DB lags,
  // so ensuring JSONL is ahead reduces the "JSONL has more history" noise.
  if (!isServerless()) {
    try {
      let cwd = cwdOverride;

      if (!cwd) {
        const { getHttpSessionStore } = await import("@/core/acp/http-session-store");
        cwd = getHttpSessionStore().getSession(sessionId)?.cwd;
      }

      if (!cwd && driver === "sqlite") {
        try {
          const { getSqliteDatabase } = await loadSqliteDatabaseModule();
          const db = getSqliteDatabase();
          cwd = (await new SqliteAcpSessionStore(db).get(sessionId))?.cwd;
        } catch {
          // ignore — cwd stays undefined
        }
      }

      if (cwd) {
        const local = new LocalSessionProvider(cwd);
        await local.appendMessage(sessionId, toJsonlHistoryEntry(sessionId, notification));
      }
    } catch {
      // Non-fatal — local event log append is best-effort
    }
  }

  if (driver !== "memory") {
    try {
      if (driver === "postgres") {
        const db = getPostgresDatabase();
        await new PgAcpSessionStore(db).appendHistory(sessionId, notification);
      } else {
        const { getSqliteDatabase } = await loadSqliteDatabaseModule();
        const db = getSqliteDatabase();
        await new SqliteAcpSessionStore(db).appendHistory(sessionId, notification);
      }
    } catch {
      // Non-fatal — DB append is best-effort
    }
  }
}

export async function loadHistorySinceEventIdFromDb(
  sessionId: string,
  lastEventId: string,
  cwdOverride?: string,
): Promise<import("@/core/acp/http-session-store").SessionUpdateNotification[]> {
  const driver = getDatabaseDriver();

  try {
    if (driver === "postgres") {
      const db = getPostgresDatabase();
      const history = await new PgAcpSessionStore(db).getHistory(sessionId, { afterEventId: lastEventId });
      if (history.length > 0) return history as import("@/core/acp/http-session-store").SessionUpdateNotification[];
    } else if (driver === "sqlite") {
      const { getSqliteDatabase } = await loadSqliteDatabaseModule();
      const db = getSqliteDatabase();
      const history = await new SqliteAcpSessionStore(db).getHistory(sessionId, { afterEventId: lastEventId });
      if (history.length > 0) return history as import("@/core/acp/http-session-store").SessionUpdateNotification[];
    } else if (driver === "memory") {
      const { getHttpSessionStore } = await import("@/core/acp/http-session-store");
      return getHttpSessionStore().getHistorySinceEventId(sessionId, lastEventId);
    }
  } catch {
    // Fall through to mixed-source fallback below.
  }

  const history = await loadHistoryFromDb(sessionId, cwdOverride);
  const index = history.findIndex((entry) => entry.eventId === lastEventId);
  if (index >= 0) return history.slice(index + 1);

  const { getHttpSessionStore } = await import("@/core/acp/http-session-store");
  return getHttpSessionStore().getHistorySinceEventId(sessionId, lastEventId);
}

export async function loadHistoryFromDb(
  sessionId: string,
  cwdOverride?: string,
): Promise<import("@/core/acp/http-session-store").SessionUpdateNotification[]> {
  const driver = getDatabaseDriver();
  if (driver === "memory") return [];

  let dbHistory: import("@/core/acp/http-session-store").SessionUpdateNotification[] = [];
  let sessionCwd: string | undefined = cwdOverride;

  try {
    if (driver === "postgres") {
      const db = getPostgresDatabase();
      dbHistory = normalizeSessionHistory(
        (await new PgAcpSessionStore(db).getHistory(sessionId)) as import("@/core/acp/http-session-store").SessionUpdateNotification[]
      );
    } else {
      const { getSqliteDatabase } = await loadSqliteDatabaseModule();
      const db = getSqliteDatabase();
      const sqliteStore = new SqliteAcpSessionStore(db);
      dbHistory = normalizeSessionHistory(
        (await sqliteStore.getHistory(sessionId)) as import("@/core/acp/http-session-store").SessionUpdateNotification[]
      );
      // Also capture cwd from SQLite so we can try the JSONL fallback below
      if (!sessionCwd && !isServerless()) {
        const session = await sqliteStore.get(sessionId);
        sessionCwd = session?.cwd;
      }
    }
  } catch (err) {
    console.error(`[SessionDB] Failed to load history from ${driver}:`, err);
  }

  // For non-serverless (localhost / Tauri): also try the local JSONL file.
  // JSONL is an append-only log written alongside the DB, so it may contain
  // more recent entries when the process was interrupted before the buffer flushed.
  if (!isServerless() && sessionCwd) {
    try {
      const local = new LocalSessionProvider(sessionCwd);
      const rawEntries = await local.getHistory(sessionId);
      // Each entry is a SessionJsonlEntry wrapper: { uuid, type, message, sessionId, timestamp }
      const jsonlHistory = normalizeSessionHistory(rawEntries
        .map((e) => (e as Record<string, unknown>).message)
        .filter(Boolean) as import("@/core/acp/http-session-store").SessionUpdateNotification[]);

      if (jsonlHistory.length > dbHistory.length) {
        const diff = jsonlHistory.length - dbHistory.length;
        // Only log when the gap is significant — a diff of 1 is expected
        // during normal operation and would otherwise produce log noise on
        // every SSE reconnection / history reload.
        if (diff > 5) {
          console.warn(`[SessionDB] JSONL leads DB by ${diff} entries (${jsonlHistory.length} vs ${dbHistory.length}) for session ${sessionId}`);
        }
        return jsonlHistory;
      }
    } catch {
      // Non-fatal — fall through to DB history
    }
  }

  return dbHistory;
}

function toJsonlHistoryEntries(
  sessionId: string,
  history: import("@/core/acp/http-session-store").SessionUpdateNotification[]
): SessionJsonlEntry[] {
  return history.map((entry, index) => toJsonlHistoryEntry(sessionId, entry, index));
}

function toJsonlHistoryEntry(
  sessionId: string,
  entry: import("@/core/acp/http-session-store").SessionUpdateNotification,
  index = 0,
): SessionJsonlEntry {
  const raw = entry as Record<string, unknown>;
  return {
    uuid: raw.uuid as string ?? `${sessionId}-${index}`,
    type: raw.type as string ?? ((raw.update as Record<string, unknown> | undefined)?.sessionUpdate as string | undefined) ?? "notification",
    message: entry,
    sessionId,
    timestamp: new Date().toISOString(),
  };
}

export function normalizeSessionHistory<T>(history: T[]): T[] {
  if (history.length < 2) return history;

  const serialized = history.map((entry) => JSON.stringify(entry));

  for (let blockSize = 1; blockSize <= Math.floor(history.length / 2); blockSize++) {
    if (history.length % blockSize !== 0) continue;
    const repeats = history.length / blockSize;
    if (repeats < 2) continue;

    let allBlocksMatch = true;
    for (let i = blockSize; i < history.length; i++) {
      if (serialized[i] !== serialized[i % blockSize]) {
        allBlocksMatch = false;
        break;
      }
    }

    if (!allBlocksMatch) continue;

    const block = history.slice(0, blockSize);
    const hasConversationPayload = block.some((entry) => {
      const text = JSON.stringify(entry);
      return text.includes("user_message") || text.includes("agent_message") || text.includes("tool_call");
    });

    if (hasConversationPayload) {
      return block;
    }
  }

  return history;
}

export function hasUserMessageInHistory(
  history: import("@/core/acp/http-session-store").SessionUpdateNotification[],
): boolean {
  return history.some((entry) => {
    const update = (entry as { update?: { sessionUpdate?: string } }).update;
    return update?.sessionUpdate === "user_message";
  });
}
