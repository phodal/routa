import { cloneKanbanColumns, type KanbanBoard } from "../models/kanban";

export interface KanbanBoardStore {
  save(board: KanbanBoard): Promise<void>;
  get(boardId: string): Promise<KanbanBoard | undefined>;
  listByWorkspace(workspaceId: string): Promise<KanbanBoard[]>;
  getDefault(workspaceId: string): Promise<KanbanBoard | undefined>;
  setDefault(workspaceId: string, boardId: string): Promise<void>;
  delete(boardId: string): Promise<void>;
}

export class InMemoryKanbanBoardStore implements KanbanBoardStore {
  private boards = new Map<string, KanbanBoard>();

  async save(board: KanbanBoard): Promise<void> {
    this.boards.set(board.id, {
      ...board,
      githubToken: board.githubToken,
      columns: cloneKanbanColumns(board.columns),
    });
  }

  async get(boardId: string): Promise<KanbanBoard | undefined> {
    const board = this.boards.get(boardId);
    return board
      ? {
          ...board,
          githubToken: board.githubToken,
          columns: cloneKanbanColumns(board.columns),
        }
      : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<KanbanBoard[]> {
    return Array.from(this.boards.values())
      .filter((board) => board.workspaceId === workspaceId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((board) => ({
        ...board,
        githubToken: board.githubToken,
        columns: cloneKanbanColumns(board.columns),
      }));
  }

  async getDefault(workspaceId: string): Promise<KanbanBoard | undefined> {
    const board = Array.from(this.boards.values()).find(
      (item) => item.workspaceId === workspaceId && item.isDefault,
    );
    return board
      ? {
          ...board,
          githubToken: board.githubToken,
          columns: cloneKanbanColumns(board.columns),
        }
      : undefined;
  }

  async setDefault(workspaceId: string, boardId: string): Promise<void> {
    for (const [id, board] of this.boards.entries()) {
      if (board.workspaceId !== workspaceId) continue;
      this.boards.set(id, {
        ...board,
        isDefault: id === boardId,
        updatedAt: new Date(),
        githubToken: board.githubToken,
        columns: cloneKanbanColumns(board.columns),
      });
    }
  }

  async delete(boardId: string): Promise<void> {
    this.boards.delete(boardId);
  }
}
