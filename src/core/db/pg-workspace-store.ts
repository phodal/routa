/**
 * PgWorkspaceStore — Postgres-backed workspace store using Drizzle ORM.
 */

import { eq } from "drizzle-orm";
import type { Database } from "./index";
import { workspaces } from "./schema";
import type { Workspace, WorkspaceStatus } from "../models/workspace";

export interface WorkspaceStore {
  save(workspace: Workspace): Promise<void>;
  get(workspaceId: string): Promise<Workspace | undefined>;
  list(): Promise<Workspace[]>;
  listByStatus(status: WorkspaceStatus): Promise<Workspace[]>;
  updateTitle(workspaceId: string, title: string): Promise<void>;
  updateBranch(workspaceId: string, branch: string): Promise<void>;
  updateStatus(workspaceId: string, status: WorkspaceStatus): Promise<void>;
  delete(workspaceId: string): Promise<void>;
  /** Get or create the "default" workspace */
  ensureDefault(): Promise<Workspace>;
}

export class PgWorkspaceStore implements WorkspaceStore {
  constructor(private db: Database) {}

  async save(workspace: Workspace): Promise<void> {
    await this.db
      .insert(workspaces)
      .values({
        id: workspace.id,
        title: workspace.title,
        repoPath: workspace.repoPath,
        branch: workspace.branch,
        status: workspace.status,
        metadata: workspace.metadata,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      })
      .onConflictDoUpdate({
        target: workspaces.id,
        set: {
          title: workspace.title,
          repoPath: workspace.repoPath,
          branch: workspace.branch,
          status: workspace.status,
          metadata: workspace.metadata,
          updatedAt: new Date(),
        },
      });
  }

  async get(workspaceId: string): Promise<Workspace | undefined> {
    const rows = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async list(): Promise<Workspace[]> {
    const rows = await this.db.select().from(workspaces);
    return rows.map(this.toModel);
  }

  async listByStatus(status: WorkspaceStatus): Promise<Workspace[]> {
    const rows = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.status, status));
    return rows.map(this.toModel);
  }

  async updateTitle(workspaceId: string, title: string): Promise<void> {
    await this.db
      .update(workspaces)
      .set({ title, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));
  }

  async updateBranch(workspaceId: string, branch: string): Promise<void> {
    await this.db
      .update(workspaces)
      .set({ branch, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));
  }

  async updateStatus(workspaceId: string, status: WorkspaceStatus): Promise<void> {
    await this.db
      .update(workspaces)
      .set({ status, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));
  }

  async delete(workspaceId: string): Promise<void> {
    await this.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  }

  async ensureDefault(): Promise<Workspace> {
    const existing = await this.get("default");
    if (existing) return existing;

    const workspace: Workspace = {
      id: "default",
      title: "Default Workspace",
      status: "active",
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.save(workspace);
    return workspace;
  }

  private toModel(row: typeof workspaces.$inferSelect): Workspace {
    return {
      id: row.id,
      title: row.title,
      repoPath: row.repoPath ?? undefined,
      branch: row.branch ?? undefined,
      status: row.status as WorkspaceStatus,
      metadata: (row.metadata as Record<string, string>) ?? {},
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

/**
 * InMemoryWorkspaceStore — for use when no database is configured.
 */
export class InMemoryWorkspaceStore implements WorkspaceStore {
  private store = new Map<string, Workspace>();

  async save(workspace: Workspace): Promise<void> {
    this.store.set(workspace.id, { ...workspace });
  }

  async get(workspaceId: string): Promise<Workspace | undefined> {
    const ws = this.store.get(workspaceId);
    return ws ? { ...ws } : undefined;
  }

  async list(): Promise<Workspace[]> {
    return Array.from(this.store.values()).map((ws) => ({ ...ws }));
  }

  async listByStatus(status: WorkspaceStatus): Promise<Workspace[]> {
    return Array.from(this.store.values()).filter((ws) => ws.status === status);
  }

  async updateTitle(workspaceId: string, title: string): Promise<void> {
    const ws = this.store.get(workspaceId);
    if (ws) {
      ws.title = title;
      ws.updatedAt = new Date();
    }
  }

  async updateBranch(workspaceId: string, branch: string): Promise<void> {
    const ws = this.store.get(workspaceId);
    if (ws) {
      ws.branch = branch;
      ws.updatedAt = new Date();
    }
  }

  async updateStatus(workspaceId: string, status: WorkspaceStatus): Promise<void> {
    const ws = this.store.get(workspaceId);
    if (ws) {
      ws.status = status;
      ws.updatedAt = new Date();
    }
  }

  async delete(workspaceId: string): Promise<void> {
    this.store.delete(workspaceId);
  }

  async ensureDefault(): Promise<Workspace> {
    const existing = await this.get("default");
    if (existing) return existing;

    const workspace: Workspace = {
      id: "default",
      title: "Default Workspace",
      status: "active",
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.save(workspace);
    return workspace;
  }
}
