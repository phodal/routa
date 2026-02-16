/**
 * PgAgentStore — Postgres-backed agent store using Drizzle ORM.
 */

import { eq, and } from "drizzle-orm";
import type { Database } from "./index";
import { agents } from "./schema";
import type { Agent, AgentRole, AgentStatus } from "../models/agent";
import type { AgentStore } from "../store/agent-store";

export class PgAgentStore implements AgentStore {
  constructor(private db: Database) {}

  async save(agent: Agent): Promise<void> {
    await this.db
      .insert(agents)
      .values({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        modelTier: agent.modelTier,
        workspaceId: agent.workspaceId,
        parentId: agent.parentId,
        status: agent.status,
        metadata: agent.metadata,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
      })
      .onConflictDoUpdate({
        target: agents.id,
        set: {
          name: agent.name,
          role: agent.role,
          modelTier: agent.modelTier,
          status: agent.status,
          parentId: agent.parentId,
          metadata: agent.metadata,
          updatedAt: new Date(),
        },
      });
  }

  async get(agentId: string): Promise<Agent | undefined> {
    const rows = await this.db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<Agent[]> {
    const rows = await this.db
      .select()
      .from(agents)
      .where(eq(agents.workspaceId, workspaceId));
    return rows.map(this.toModel);
  }

  async listByParent(parentId: string): Promise<Agent[]> {
    const rows = await this.db
      .select()
      .from(agents)
      .where(eq(agents.parentId, parentId));
    return rows.map(this.toModel);
  }

  async listByRole(workspaceId: string, role: AgentRole): Promise<Agent[]> {
    const rows = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.workspaceId, workspaceId), eq(agents.role, role)));
    return rows.map(this.toModel);
  }

  async listByStatus(workspaceId: string, status: AgentStatus): Promise<Agent[]> {
    const rows = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.workspaceId, workspaceId), eq(agents.status, status)));
    return rows.map(this.toModel);
  }

  async delete(agentId: string): Promise<void> {
    await this.db.delete(agents).where(eq(agents.id, agentId));
  }

  async updateStatus(agentId: string, status: AgentStatus): Promise<void> {
    await this.db
      .update(agents)
      .set({ status, updatedAt: new Date() })
      .where(eq(agents.id, agentId));
  }

  private toModel(row: typeof agents.$inferSelect): Agent {
    return {
      id: row.id,
      name: row.name,
      role: row.role as AgentRole,
      modelTier: row.modelTier as import("../models/agent").ModelTier,
      workspaceId: row.workspaceId,
      parentId: row.parentId ?? undefined,
      status: row.status as AgentStatus,
      metadata: (row.metadata as Record<string, string>) ?? {},
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
