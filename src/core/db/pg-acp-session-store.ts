/**
 * PgAcpSessionStore — Postgres-backed ACP session store using Drizzle ORM.
 */

import { and, asc, desc, eq, gt } from "drizzle-orm";
import type { Database } from "./index";
import { acpSessions, sessionMessages } from "./schema";
import type { AcpSessionStore, AcpSession, AcpSessionNotification } from "../store/acp-session-store";
import {
  compactSessionHistoryForPersistence,
  compactSessionNotificationForPersistence,
} from "../acp/session-notification-retention";

export class PgAcpSessionStore implements AcpSessionStore {
  constructor(private db: Database) {}

  async save(session: AcpSession): Promise<void> {
    const messageHistory = compactSessionHistoryForPersistence(session.messageHistory);

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
        messageHistory,
        parentSessionId: session.parentSessionId,
        specialistId: session.specialistId,
        executionMode: session.executionMode,
        ownerInstanceId: session.ownerInstanceId,
        leaseExpiresAt: session.leaseExpiresAt ? new Date(session.leaseExpiresAt) : undefined,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
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
          messageHistory,
          parentSessionId: session.parentSessionId,
          specialistId: session.specialistId,
          executionMode: session.executionMode,
          ownerInstanceId: session.ownerInstanceId,
          leaseExpiresAt: session.leaseExpiresAt ? new Date(session.leaseExpiresAt) : undefined,
          updatedAt: new Date(),
        },
      });
  }

  async get(sessionId: string): Promise<AcpSession | undefined> {
    const rows = await this.db
      .select()
      .from(acpSessions)
      .where(eq(acpSessions.id, sessionId))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async list(): Promise<AcpSession[]> {
    const rows = await this.db
      .select()
      .from(acpSessions)
      .orderBy(desc(acpSessions.createdAt));
    return rows.map(this.toModel);
  }

  async delete(sessionId: string): Promise<void> {
    await this.db.delete(acpSessions).where(eq(acpSessions.id, sessionId));
  }

  async rename(sessionId: string, name: string): Promise<void> {
    await this.db
      .update(acpSessions)
      .set({ name, updatedAt: new Date() })
      .where(eq(acpSessions.id, sessionId));
  }

  async appendHistory(sessionId: string, notification: AcpSessionNotification): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) return;
    const persistedNotification = compactSessionNotificationForPersistence(notification);
    const history = [...session.messageHistory, persistedNotification];
    const nextIndex = await this.getNextMessageIndex(sessionId);
    const eventType = String(
      (notification.update as Record<string, unknown> | undefined)?.sessionUpdate ?? "notification",
    );
    const eventId = typeof notification.eventId === "string"
      ? notification.eventId
      : `${sessionId}-${nextIndex}`;

    await this.db.insert(sessionMessages).values({
      id: eventId,
      sessionId,
      messageIndex: nextIndex,
      eventType,
      payload: persistedNotification as typeof sessionMessages.$inferInsert.payload,
    });

    await this.db
      .update(acpSessions)
      .set({ messageHistory: history, updatedAt: new Date() })
      .where(eq(acpSessions.id, sessionId));
  }

  async getHistory(
    sessionId: string,
    options?: { afterEventId?: string },
  ): Promise<AcpSessionNotification[]> {
    const anchorEventId = options?.afterEventId;
    if (anchorEventId) {
      const anchorRows = await this.db
        .select({ messageIndex: sessionMessages.messageIndex })
        .from(sessionMessages)
        .where(eq(sessionMessages.id, anchorEventId))
        .limit(1);

      if (anchorRows.length > 0) {
        const rows = await this.db
          .select()
          .from(sessionMessages)
          .where(and(
            eq(sessionMessages.sessionId, sessionId),
            gt(sessionMessages.messageIndex, anchorRows[0].messageIndex),
          ))
          .orderBy(asc(sessionMessages.messageIndex));

        return rows.map((row) => row.payload as AcpSessionNotification);
      }
    }

    const rows = await this.db
      .select()
      .from(sessionMessages)
      .where(eq(sessionMessages.sessionId, sessionId))
      .orderBy(asc(sessionMessages.messageIndex));

    if (rows.length > 0) {
      return rows.map((row) => row.payload as AcpSessionNotification);
    }

    const session = await this.get(sessionId);
    return session?.messageHistory ?? [];
  }

  async markFirstPromptSent(sessionId: string): Promise<void> {
    await this.db
      .update(acpSessions)
      .set({ firstPromptSent: true, updatedAt: new Date() })
      .where(eq(acpSessions.id, sessionId));
  }

  async updateMode(sessionId: string, modeId: string): Promise<void> {
    await this.db
      .update(acpSessions)
      .set({ modeId, updatedAt: new Date() })
      .where(eq(acpSessions.id, sessionId));
  }

  private toModel(row: typeof acpSessions.$inferSelect): AcpSession {
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
      messageHistory: row.messageHistory ?? [],
      parentSessionId: row.parentSessionId ?? undefined,
      specialistId: row.specialistId ?? undefined,
      executionMode: row.executionMode === "embedded" || row.executionMode === "runner"
        ? row.executionMode
        : undefined,
      ownerInstanceId: row.ownerInstanceId ?? undefined,
      leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async getNextMessageIndex(sessionId: string): Promise<number> {
    const rows = await this.db
      .select({ messageIndex: sessionMessages.messageIndex })
      .from(sessionMessages)
      .where(eq(sessionMessages.sessionId, sessionId))
      .orderBy(desc(sessionMessages.messageIndex))
      .limit(1);

    return rows.length > 0 ? rows[0].messageIndex + 1 : 0;
  }
}
