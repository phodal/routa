/**
 * PgConversationStore — Postgres-backed conversation store using Drizzle ORM.
 */

import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import type { Database } from "./index";
import { messages } from "./schema";
import type { Message, MessageRole } from "../models/message";
import type { ConversationStore } from "../store/conversation-store";

export class PgConversationStore implements ConversationStore {
  constructor(private db: Database) {}

  async append(message: Message): Promise<void> {
    await this.db.insert(messages).values({
      id: message.id,
      agentId: message.agentId,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      toolName: message.toolName,
      toolArgs: message.toolArgs,
      turn: message.turn,
    });
  }

  async getConversation(agentId: string): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.agentId, agentId))
      .orderBy(messages.timestamp);
    return rows.map(this.toModel);
  }

  async getLastN(agentId: string, n: number): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.agentId, agentId))
      .orderBy(desc(messages.timestamp))
      .limit(n);
    // Reverse to get chronological order
    return rows.reverse().map(this.toModel);
  }

  async getByTurnRange(
    agentId: string,
    startTurn: number,
    endTurn: number
  ): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.agentId, agentId),
          gte(messages.turn, startTurn),
          lte(messages.turn, endTurn)
        )
      )
      .orderBy(messages.timestamp);
    return rows.map(this.toModel);
  }

  async getMessageCount(agentId: string): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(eq(messages.agentId, agentId));
    return result[0]?.count ?? 0;
  }

  async deleteConversation(agentId: string): Promise<void> {
    await this.db.delete(messages).where(eq(messages.agentId, agentId));
  }

  private toModel(row: typeof messages.$inferSelect): Message {
    return {
      id: row.id,
      agentId: row.agentId,
      role: row.role as MessageRole,
      content: row.content,
      timestamp: row.timestamp,
      toolName: row.toolName ?? undefined,
      toolArgs: row.toolArgs ?? undefined,
      turn: row.turn ?? undefined,
    };
  }
}
