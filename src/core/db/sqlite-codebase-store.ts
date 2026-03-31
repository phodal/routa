import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "./sqlite-schema";
import type { Codebase } from "../models/codebase";
import type { CodebaseStore } from "./pg-codebase-store";

type SqliteDb = BetterSQLite3Database<typeof sqliteSchema>;

export class SqliteCodebaseStore implements CodebaseStore {
  constructor(private db: SqliteDb) {}

  async add(codebase: Codebase): Promise<void> {
    await this.db.insert(sqliteSchema.codebases).values({
      id: codebase.id,
      workspaceId: codebase.workspaceId,
      repoPath: codebase.repoPath,
      branch: codebase.branch,
      label: codebase.label,
      isDefault: codebase.isDefault,
      sourceType: codebase.sourceType ?? null,
      sourceUrl: codebase.sourceUrl ?? null,
      createdAt: codebase.createdAt,
      updatedAt: codebase.updatedAt,
    });
  }

  async get(codebaseId: string): Promise<Codebase | undefined> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.codebases)
      .where(eq(sqliteSchema.codebases.id, codebaseId))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<Codebase[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.codebases)
      .where(eq(sqliteSchema.codebases.workspaceId, workspaceId));
    return rows.map(this.toModel);
  }

  async update(codebaseId: string, fields: { branch?: string; label?: string; repoPath?: string }): Promise<void> {
    await this.db
      .update(sqliteSchema.codebases)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(sqliteSchema.codebases.id, codebaseId));
  }

  async remove(codebaseId: string): Promise<void> {
    await this.db.delete(sqliteSchema.codebases).where(eq(sqliteSchema.codebases.id, codebaseId));
  }

  async getDefault(workspaceId: string): Promise<Codebase | undefined> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.codebases)
      .where(and(eq(sqliteSchema.codebases.workspaceId, workspaceId), eq(sqliteSchema.codebases.isDefault, true)))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async setDefault(workspaceId: string, codebaseId: string): Promise<void> {
    await this.db
      .update(sqliteSchema.codebases)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(sqliteSchema.codebases.workspaceId, workspaceId), eq(sqliteSchema.codebases.isDefault, true)));
    await this.db
      .update(sqliteSchema.codebases)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(sqliteSchema.codebases.id, codebaseId));
  }

  async countByWorkspace(workspaceId: string): Promise<number> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.codebases)
      .where(eq(sqliteSchema.codebases.workspaceId, workspaceId));
    return rows.length;
  }

  async findByRepoPath(workspaceId: string, repoPath: string): Promise<Codebase | undefined> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.codebases)
      .where(and(eq(sqliteSchema.codebases.workspaceId, workspaceId), eq(sqliteSchema.codebases.repoPath, repoPath)))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  private toModel(row: typeof sqliteSchema.codebases.$inferSelect): Codebase {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      repoPath: row.repoPath,
      branch: row.branch ?? undefined,
      label: row.label ?? undefined,
      isDefault: row.isDefault,
      sourceType: (row.sourceType as Codebase["sourceType"]) ?? undefined,
      sourceUrl: row.sourceUrl ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
