import type { KanbanBoard } from "../models/kanban";

export interface KanbanBoardStore {
  save(board: KanbanBoard): Promise<void>;
  get(boardId: string): Promise<KanbanBoard | undefined>;
  listByWorkspace(workspaceId: string): Promise<KanbanBoard[]>;
  getDefault(workspaceId: string): Promise<KanbanBoard | undefined>;
  delete(boardId: string): Promise<void>;
}

export class InMemoryKanbanBoardStore implements KanbanBoardStore {
  private boards = new Map<string, KanbanBoard>();

  async save(board: KanbanBoard): Promise<void> {
    this.boards.set(board.id, { ...board, columns: [...board.columns] });
  }

  async get(boardId: string): Promise<KanbanBoard | undefined> {
    const board = this.boards.get(boardId);
    return board ? { ...board, columns: [...board.columns] } : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<KanbanBoard[]> {
    return Array.from(this.boards.values())
      .filter((board) => board.workspaceId === workspaceId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((board) => ({ ...board, columns: [...board.columns] }));
  }

  async getDefault(workspaceId: string): Promise<KanbanBoard | undefined> {
    const board = Array.from(this.boards.values()).find(
      (item) => item.workspaceId === workspaceId && item.isDefault,
    );
    return board ? { ...board, columns: [...board.columns] } : undefined;
  }

  async delete(boardId: string): Promise<void> {
    this.boards.delete(boardId);
  }
}