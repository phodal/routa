/**
 * Specialist Store - Database-backed specialist configuration storage.
 *
 * Manages user-defined and bundled specialist configurations in the database.
 * Supports CRUD operations for specialists with role and model tier mappings.
 */

import { eq, and } from "drizzle-orm";
import type { PostgresDatabase } from "../db";
import { specialists } from "../db/schema";
import type { SpecialistConfig } from "../specialists/specialist-types";
import { AgentRole, ModelTier } from "../models/agent";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SpecialistCreateInput {
  id: string;
  name: string;
  description?: string;
  role: AgentRole;
  defaultModelTier: ModelTier;
  systemPrompt: string;
  roleReminder?: string;
  defaultProvider?: string;
  defaultAdapter?: string;
  model?: string;
  source?: "user" | "bundled" | "hardcoded";
  createdBy?: string;
}

export interface SpecialistUpdateInput {
  name?: string;
  description?: string;
  role?: AgentRole;
  defaultModelTier?: ModelTier;
  systemPrompt?: string;
  roleReminder?: string;
  defaultProvider?: string;
  defaultAdapter?: string;
  model?: string;
  enabled?: boolean;
}

export interface SpecialistFilter {
  source?: "user" | "bundled" | "hardcoded";
  role?: AgentRole;
  enabled?: boolean;
  createdBy?: string;
}

// ─── Store Interface ───────────────────────────────────────────────────────

export interface SpecialistStore {
  create(input: SpecialistCreateInput): Promise<SpecialistConfig>;
  get(id: string): Promise<SpecialistConfig | null>;
  list(filter?: SpecialistFilter): Promise<SpecialistConfig[]>;
  update(id: string, input: SpecialistUpdateInput): Promise<SpecialistConfig | null>;
  delete(id: string): Promise<boolean>;
  upsert(input: SpecialistCreateInput): Promise<SpecialistConfig>;
  ensureBundledSpecialists(): Promise<void>;
}

// ─── Postgres Implementation ───────────────────────────────────────────────

export class PostgresSpecialistStore implements SpecialistStore {
  constructor(private db: PostgresDatabase) {}

  async create(input: SpecialistCreateInput): Promise<SpecialistConfig> {
    const now = new Date();
    const record = {
      id: input.id,
      name: input.name,
      description: input.description ?? "",
      source: input.source ?? "user",
      role: input.role,
      defaultModelTier: input.defaultModelTier,
      systemPrompt: input.systemPrompt,
      roleReminder: input.roleReminder ?? "",
      defaultProvider: input.defaultProvider,
      defaultAdapter: input.defaultAdapter,
      model: input.model,
      enabled: true,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(specialists).values(record);

    return this.toSpecialistConfig(record);
  }

  async get(id: string): Promise<SpecialistConfig | null> {
    const results = await this.db
      .select()
      .from(specialists)
      .where(eq(specialists.id, id))
      .limit(1);

    if (results.length === 0) return null;
    return this.toSpecialistConfig(results[0]);
  }

  async list(filter?: SpecialistFilter): Promise<SpecialistConfig[]> {
    const conditions = [];

    if (filter?.source) {
      conditions.push(eq(specialists.source, filter.source));
    }
    if (filter?.role) {
      conditions.push(eq(specialists.role, filter.role));
    }
    if (filter?.enabled !== undefined) {
      conditions.push(eq(specialists.enabled, filter.enabled));
    }
    if (filter?.createdBy) {
      conditions.push(eq(specialists.createdBy, filter.createdBy));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const results = await this.db
      .select()
      .from(specialists)
      .where(whereClause ?? undefined);

    return results.map((r) => this.toSpecialistConfig(r));
  }

  async update(id: string, input: SpecialistUpdateInput): Promise<SpecialistConfig | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.role !== undefined) updateData.role = input.role;
    if (input.defaultModelTier !== undefined) updateData.defaultModelTier = input.defaultModelTier;
    if (input.systemPrompt !== undefined) updateData.systemPrompt = input.systemPrompt;
    if (input.roleReminder !== undefined) updateData.roleReminder = input.roleReminder;
    if (input.defaultProvider !== undefined) updateData.defaultProvider = input.defaultProvider;
    if (input.defaultAdapter !== undefined) updateData.defaultAdapter = input.defaultAdapter;
    if (input.model !== undefined) updateData.model = input.model;
    if (input.enabled !== undefined) updateData.enabled = input.enabled;

    await this.db
      .update(specialists)
      .set(updateData)
      .where(eq(specialists.id, id));

    return this.get(id);
  }

  async delete(id: string): Promise<boolean> {
    await this.db
      .delete(specialists)
      .where(eq(specialists.id, id));

    // Drizzle doesn't return affected rows count directly
    // We check if the record still exists
    const deleted = await this.get(id);
    return deleted === null;
  }

  async upsert(input: SpecialistCreateInput): Promise<SpecialistConfig> {
    const existing = await this.get(input.id);

    if (existing) {
      return (await this.update(input.id, input))!;
    }

    return this.create(input);
  }

  /**
   * Ensure all bundled specialists are in the database.
   * This is called on startup to sync hardcoded specialists with the DB.
   */
  async ensureBundledSpecialists(): Promise<void> {
    // This will be called by the specialist loader with bundled configs
    // The actual sync logic is in specialist-db-loader.ts
  }

  private toSpecialistConfig(record: Record<string, unknown>): SpecialistConfig {
    return {
      id: record.id as string,
      name: record.name as string,
      description: record.description as string,
      role: record.role as AgentRole,
      defaultModelTier: record.defaultModelTier as ModelTier,
      systemPrompt: record.systemPrompt as string,
      roleReminder: record.roleReminder as string,
      source: record.source as "user" | "bundled" | "hardcoded",
      defaultProvider: (record.defaultProvider as string) ?? undefined,
      defaultAdapter: (record.defaultAdapter as string) ?? undefined,
      model: (record.model as string) ?? undefined,
      enabled: record.enabled as boolean ?? true,
    };
  }
}
