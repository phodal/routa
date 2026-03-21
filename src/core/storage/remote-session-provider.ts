/**
 * RemoteSessionProvider — Postgres-backed session storage.
 *
 * Uses the session_messages table for per-message storage (split from
 * the JSONB messageHistory column). Supports paginated history queries.
 */

import { eq, desc, and, asc, type SQL } from "drizzle-orm";
import type { Database } from "../db/index";
import { acpSessions, sessionMessages } from "../db/schema";
import type {
  SessionStorageProvider,
  SessionRecord,
  SessionJsonlEntry,
} from "./types";

export class RemoteSessionProvider implements SessionStorageProvider {
  constructor(private db: Database) {}

  async save(session: SessionRecord): Promise<void> {
    await this.db
      .insert(acpSessions)
      .values({
        id: session.id,
        name: session.name,
        cwd: session.cwd,
        branch: session.branch,
        workspaceId: session.workspaceId,
        routaAgentId: session.routaAgentId,
        provider: session.provider,
        role: session.role,
        modeId: session.modeId,
        model: session.model,
        firstPromptSent: session.firstPromptSent ?? false,
        messageHistory: [],
        parentSessionId: session.parentSessionId,
        executionMode: session.executionMode,
        ownerInstanceId: session.ownerInstanceId,
        leaseExpiresAt: session.leaseExpiresAt ? new Date(session.leaseExpiresAt) : undefined,
        createdAt: new Date(session.createdAt),
        updatedAt: new Date(session.updatedAt),
      })
      .onConflictDoUpdate({
        target: acpSessions.id,
        set: {
          name: session.name,
          branch: session.branch,
          workspaceId: session.workspaceId,
          routaAgentId: session.routaAgentId,
          provider: session.provider,
          role: session.role,
          modeId: session.modeId,
          model: session.model,
          firstPromptSent: session.firstPromptSent ?? false,
          parentSessionId: session.parentSessionId,
          executionMode: session.executionMode,
          ownerInstanceId: session.ownerInstanceId,
          leaseExpiresAt: session.leaseExpiresAt ? new Date(session.leaseExpiresAt) : undefined,
          updatedAt: new Date(),
        },
      });
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    const rows = await this.db
      .select()
      .from(acpSessions)
      .where(eq(acpSessions.id, sessionId))
      .limit(1);

    return rows[0] ? this.toSessionRecord(rows[0]) : undefined;
  }

  async list(workspaceId?: string, limit?: number): Promise<SessionRecord[]> {
    const conditions: SQL[] = [];
    if (workspaceId) {
      conditions.push(eq(acpSessions.workspaceId, workspaceId));
    }

    const rows = await this.db
      .select()
      .from(acpSessions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(acpSessions.createdAt))
      .limit(limit ?? 100);

    return rows.map(this.toSessionRecord);
  }

  async delete(sessionId: string): Promise<void> {
    // session_messages cascade-deletes via FK
    await this.db
      .delete(acpSessions)
      .where(eq(acpSessions.id, sessionId));
  }

  /**
   * Get message history for a session with pagination support.
   * Reads from session_messages table, falls back to JSONB column for
   * sessions that haven't been migrated yet.
   */
  async getHistory(
    sessionId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<unknown[]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    // Try session_messages table first
    const msgs = await this.db
      .select()
      .from(sessionMessages)
      .where(eq(sessionMessages.sessionId, sessionId))
      .orderBy(asc(sessionMessages.messageIndex))
      .limit(limit)
      .offset(offset);

    if (msgs.length > 0) {
      return msgs.map((m) => m.payload);
    }

    // Fall back to legacy JSONB column for un-migrated sessions
    const rows = await this.db
      .select()
      .from(acpSessions)
      .where(eq(acpSessions.id, sessionId))
      .limit(1);

    const history = rows[0]?.messageHistory ?? [];
    // Apply pagination to legacy data too
    return history.slice(offset, offset + limit);
  }

  /**
   * Append a message to session history.
   * Writes to session_messages table (new path) and keeps JSONB in sync
   * for backward compatibility during migration period.
   */
  async appendMessage(
    sessionId: string,
    entry: SessionJsonlEntry
  ): Promise<void> {
    // Get current max index
    const existing = await this.db
      .select({ messageIndex: sessionMessages.messageIndex })
      .from(sessionMessages)
      .where(eq(sessionMessages.sessionId, sessionId))
      .orderBy(desc(sessionMessages.messageIndex))
      .limit(1);

    const nextIndex = existing.length > 0 ? existing[0].messageIndex + 1 : 0;
    const eventType = "type" in entry ? String(entry.type) : "unknown";

    await this.db.insert(sessionMessages).values({
      id: `${sessionId}-${nextIndex}`,
      sessionId,
      messageIndex: nextIndex,
      eventType,
      payload: entry as unknown as Record<string, unknown>,
    });

    // Also update JSONB column for backward compat (will be removed after full migration)
    const rows = await this.db
      .select()
      .from(acpSessions)
      .where(eq(acpSessions.id, sessionId))
      .limit(1);

    if (rows[0]) {
      const history = [...(rows[0].messageHistory ?? []), entry as unknown];
      await this.db
        .update(acpSessions)
        .set({
          messageHistory: history as typeof acpSessions.$inferSelect.messageHistory,
          updatedAt: new Date(),
        })
        .where(eq(acpSessions.id, sessionId));
    }
  }

  private toSessionRecord(
    row: typeof acpSessions.$inferSelect
  ): SessionRecord {
    return {
      id: row.id,
      name: row.name ?? undefined,
      cwd: row.cwd,
      branch: row.branch ?? undefined,
      workspaceId: row.workspaceId,
      routaAgentId: row.routaAgentId ?? undefined,
      provider: row.provider ?? undefined,
      role: row.role ?? undefined,
      modeId: row.modeId ?? undefined,
      model: row.model ?? undefined,
      firstPromptSent: row.firstPromptSent ?? false,
      parentSessionId: row.parentSessionId ?? undefined,
      executionMode: row.executionMode ?? undefined,
      ownerInstanceId: row.ownerInstanceId ?? undefined,
      leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? undefined,
      createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
      updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
    };
  }
}
