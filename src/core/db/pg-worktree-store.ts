/**
 * PgWorktreeStore — Postgres-backed worktree store using Drizzle ORM.
 */

import { eq, and } from "drizzle-orm";
import type { Database } from "./index";
import { worktrees } from "./schema";
import type { Worktree, WorktreeStatus } from "../models/worktree";

export interface WorktreeStore {
  add(worktree: Worktree): Promise<void>;
  get(worktreeId: string): Promise<Worktree | undefined>;
  listByCodebase(codebaseId: string): Promise<Worktree[]>;
  listByWorkspace(workspaceId: string): Promise<Worktree[]>;
  updateStatus(worktreeId: string, status: WorktreeStatus, errorMessage?: string): Promise<void>;
  assignSession(worktreeId: string, sessionId: string | null): Promise<void>;
  remove(worktreeId: string): Promise<void>;
  findByBranch(codebaseId: string, branch: string): Promise<Worktree | undefined>;
}

/**
 * InMemoryWorktreeStore — for use when no database is configured.
 */
export class InMemoryWorktreeStore implements WorktreeStore {
  private store = new Map<string, Worktree>();

  async add(worktree: Worktree): Promise<void> {
    this.store.set(worktree.id, { ...worktree });
  }

  async get(worktreeId: string): Promise<Worktree | undefined> {
    const wt = this.store.get(worktreeId);
    return wt ? { ...wt } : undefined;
  }

  async listByCodebase(codebaseId: string): Promise<Worktree[]> {
    return Array.from(this.store.values()).filter((wt) => wt.codebaseId === codebaseId);
  }

  async listByWorkspace(workspaceId: string): Promise<Worktree[]> {
    return Array.from(this.store.values()).filter((wt) => wt.workspaceId === workspaceId);
  }

  async updateStatus(worktreeId: string, status: WorktreeStatus, errorMessage?: string): Promise<void> {
    const wt = this.store.get(worktreeId);
    if (wt) {
      this.store.set(worktreeId, {
        ...wt,
        status,
        errorMessage,
        updatedAt: new Date(),
      });
    }
  }

  async assignSession(worktreeId: string, sessionId: string | null): Promise<void> {
    const wt = this.store.get(worktreeId);
    if (wt) {
      this.store.set(worktreeId, {
        ...wt,
        sessionId: sessionId ?? undefined,
        updatedAt: new Date(),
      });
    }
  }

  async remove(worktreeId: string): Promise<void> {
    this.store.delete(worktreeId);
  }

  async findByBranch(codebaseId: string, branch: string): Promise<Worktree | undefined> {
    return Array.from(this.store.values()).find(
      (wt) => wt.codebaseId === codebaseId && wt.branch === branch
    );
  }
}

export class PgWorktreeStore implements WorktreeStore {
  constructor(private db: Database) {}

  async add(worktree: Worktree): Promise<void> {
    await this.db.insert(worktrees).values({
      id: worktree.id,
      codebaseId: worktree.codebaseId,
      workspaceId: worktree.workspaceId,
      worktreePath: worktree.worktreePath,
      branch: worktree.branch,
      baseBranch: worktree.baseBranch,
      status: worktree.status,
      sessionId: worktree.sessionId ?? null,
      label: worktree.label ?? null,
      errorMessage: worktree.errorMessage ?? null,
      createdAt: worktree.createdAt,
      updatedAt: worktree.updatedAt,
    });
  }

  async get(worktreeId: string): Promise<Worktree | undefined> {
    const rows = await this.db
      .select()
      .from(worktrees)
      .where(eq(worktrees.id, worktreeId))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async listByCodebase(codebaseId: string): Promise<Worktree[]> {
    const rows = await this.db
      .select()
      .from(worktrees)
      .where(eq(worktrees.codebaseId, codebaseId));
    return rows.map(this.toModel);
  }

  async listByWorkspace(workspaceId: string): Promise<Worktree[]> {
    const rows = await this.db
      .select()
      .from(worktrees)
      .where(eq(worktrees.workspaceId, workspaceId));
    return rows.map(this.toModel);
  }

  async updateStatus(worktreeId: string, status: WorktreeStatus, errorMessage?: string): Promise<void> {
    await this.db
      .update(worktrees)
      .set({ status, errorMessage: errorMessage ?? null, updatedAt: new Date() })
      .where(eq(worktrees.id, worktreeId));
  }

  async assignSession(worktreeId: string, sessionId: string | null): Promise<void> {
    await this.db
      .update(worktrees)
      .set({ sessionId, updatedAt: new Date() })
      .where(eq(worktrees.id, worktreeId));
  }

  async remove(worktreeId: string): Promise<void> {
    await this.db.delete(worktrees).where(eq(worktrees.id, worktreeId));
  }

  async findByBranch(codebaseId: string, branch: string): Promise<Worktree | undefined> {
    const rows = await this.db
      .select()
      .from(worktrees)
      .where(and(eq(worktrees.codebaseId, codebaseId), eq(worktrees.branch, branch)))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  private toModel(row: typeof worktrees.$inferSelect): Worktree {
    return {
      id: row.id,
      codebaseId: row.codebaseId,
      workspaceId: row.workspaceId,
      worktreePath: row.worktreePath,
      branch: row.branch,
      baseBranch: row.baseBranch,
      status: row.status as WorktreeStatus,
      sessionId: row.sessionId ?? undefined,
      label: row.label ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
