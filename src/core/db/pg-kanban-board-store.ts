import { and, eq } from "drizzle-orm";
import type { Database } from "./index";
import { kanbanBoards } from "./schema";
import type { KanbanBoard } from "../models/kanban";
import type { KanbanBoardStore } from "../store/kanban-board-store";

export class PgKanbanBoardStore implements KanbanBoardStore {
  constructor(private db: Database) {}

  async save(board: KanbanBoard): Promise<void> {
    await this.db
      .insert(kanbanBoards)
      .values({
        id: board.id,
        workspaceId: board.workspaceId,
        name: board.name,
        isDefault: board.isDefault,
        githubToken: board.githubToken ?? null,
        columns: board.columns,
        createdAt: board.createdAt,
        updatedAt: board.updatedAt,
      })
      .onConflictDoUpdate({
        target: kanbanBoards.id,
        set: {
          name: board.name,
          isDefault: board.isDefault,
          githubToken: board.githubToken ?? null,
          columns: board.columns,
          updatedAt: new Date(),
        },
      });
  }

  async get(boardId: string): Promise<KanbanBoard | undefined> {
    const rows = await this.db.select().from(kanbanBoards).where(eq(kanbanBoards.id, boardId)).limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<KanbanBoard[]> {
    const rows = await this.db.select().from(kanbanBoards).where(eq(kanbanBoards.workspaceId, workspaceId));
    return rows.map((row) => this.toModel(row));
  }

  async getDefault(workspaceId: string): Promise<KanbanBoard | undefined> {
    const rows = await this.db
      .select()
      .from(kanbanBoards)
      .where(and(eq(kanbanBoards.workspaceId, workspaceId), eq(kanbanBoards.isDefault, true)))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async setDefault(workspaceId: string, boardId: string): Promise<void> {
    await this.db
      .update(kanbanBoards)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(kanbanBoards.workspaceId, workspaceId));

    await this.db
      .update(kanbanBoards)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(kanbanBoards.workspaceId, workspaceId), eq(kanbanBoards.id, boardId)));
  }

  async delete(boardId: string): Promise<void> {
    await this.db.delete(kanbanBoards).where(eq(kanbanBoards.id, boardId));
  }

  private toModel(row: typeof kanbanBoards.$inferSelect): KanbanBoard {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      isDefault: row.isDefault,
      githubToken: row.githubToken ?? undefined,
      columns: row.columns,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
