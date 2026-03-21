/**
 * PgAcpSessionStore — Postgres-backed ACP session store using Drizzle ORM.
 */

import { eq, desc } from "drizzle-orm";
import type { Database } from "./index";
import { acpSessions } from "./schema";
import type { AcpSessionStore, AcpSession, AcpSessionNotification } from "../store/acp-session-store";

export class PgAcpSessionStore implements AcpSessionStore {
  constructor(private db: Database) {}

  async save(session: AcpSession): Promise<void> {
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
        messageHistory: session.messageHistory,
        parentSessionId: session.parentSessionId,
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
          messageHistory: session.messageHistory,
          parentSessionId: session.parentSessionId,
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
    const history = [...session.messageHistory, notification];
    await this.db
      .update(acpSessions)
      .set({ messageHistory: history, updatedAt: new Date() })
      .where(eq(acpSessions.id, sessionId));
  }

  async getHistory(sessionId: string): Promise<AcpSessionNotification[]> {
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
      executionMode: row.executionMode ?? undefined,
      ownerInstanceId: row.ownerInstanceId ?? undefined,
      leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
