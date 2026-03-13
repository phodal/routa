/**
 * KanbanTools — ACP-exposed tools for managing Kanban boards and cards.
 *
 * Provides operations for:
 * - Board management: create_board, list_boards, get_board
 * - Card operations: create_card, move_card, update_card, delete_card
 * - Column operations: create_column, delete_column
 * - Search/filter: search_cards, list_cards_by_column
 *
 * Cards are implemented using the Task model with boardId and columnId fields.
 */

import { v4 as uuidv4 } from "uuid";
import { KanbanBoardStore } from "../store/kanban-board-store";
import { TaskStore } from "../store/task-store";
import { ArtifactStore } from "../store/artifact-store";
import { createKanbanBoard, KanbanColumn, columnIdToTaskStatus } from "../models/kanban";
import { createTask, Task, TaskPriority } from "../models/task";
import { ArtifactType } from "../models/artifact";
import { ToolResult, successResult, errorResult } from "./tool-result";
import { EventBus } from "../events/event-bus";
import { emitColumnTransition } from "../kanban/column-transition";

export class KanbanTools {
  private eventBus?: EventBus;
  private artifactStore?: ArtifactStore;

  constructor(
    private kanbanBoardStore: KanbanBoardStore,
    private taskStore: TaskStore,
  ) {}

  /** Set the event bus for emitting column transition events */
  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus;
  }

  /** Set the artifact store for checking required artifacts */
  setArtifactStore(artifactStore: ArtifactStore): void {
    this.artifactStore = artifactStore;
  }

  // ─── Board Operations ───────────────────────────────────────────────────

  async createBoard(params: {
    workspaceId: string;
    name: string;
    columns?: string[];
  }): Promise<ToolResult> {
    const columns: KanbanColumn[] | undefined = params.columns?.map((name, index) => ({
      id: name.toLowerCase().replace(/\s+/g, "-"),
      name,
      position: index,
      stage: "backlog" as const,
    }));

    const board = createKanbanBoard({
      id: uuidv4(),
      workspaceId: params.workspaceId,
      name: params.name,
      columns,
    });

    await this.kanbanBoardStore.save(board);

    return successResult({
      boardId: board.id,
      name: board.name,
      columns: board.columns.map((c) => ({ id: c.id, name: c.name })),
    });
  }

  async listBoards(workspaceId: string): Promise<ToolResult> {
    const boards = await this.kanbanBoardStore.listByWorkspace(workspaceId);
    return successResult(
      boards.map((b) => ({
        id: b.id,
        name: b.name,
        isDefault: b.isDefault,
        columnCount: b.columns.length,
      })),
    );
  }

  async getBoard(boardId: string): Promise<ToolResult> {
    const board = await this.kanbanBoardStore.get(boardId);
    if (!board) {
      return errorResult(`Board not found: ${boardId}`);
    }

    const tasks = await this.taskStore.listByWorkspace(board.workspaceId);
    const boardTasks = tasks.filter((t) => t.boardId === boardId);

    return successResult({
      id: board.id,
      name: board.name,
      isDefault: board.isDefault,
      columns: board.columns.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        position: c.position,
        cards: boardTasks
          .filter((t) => (t.columnId ?? "backlog") === c.id)
          .sort((a, b) => a.position - b.position)
          .map((t) => this.taskToCard(t)),
      })),
    });
  }

  // ─── Card Operations ────────────────────────────────────────────────────

  async createCard(params: {
    boardId: string;
    columnId: string;
    title: string;
    description?: string;
    priority?: "low" | "medium" | "high" | "urgent";
    labels?: string[];
    workspaceId: string;
  }): Promise<ToolResult> {
    const board = await this.kanbanBoardStore.get(params.boardId);
    if (!board) {
      return errorResult(`Board not found: ${params.boardId}`);
    }

    const column = board.columns.find((c) => c.id === params.columnId);
    if (!column) {
      return errorResult(`Column not found: ${params.columnId}`);
    }

    const tasks = await this.taskStore.listByWorkspace(params.workspaceId);
    const columnTasks = tasks.filter(
      (t) => t.boardId === params.boardId && (t.columnId ?? "backlog") === params.columnId,
    );
    const position = columnTasks.length;

    const task = createTask({
      id: uuidv4(),
      title: params.title,
      objective: params.description ?? "",
      workspaceId: params.workspaceId,
      boardId: params.boardId,
      columnId: params.columnId,
      position,
      status: columnIdToTaskStatus(params.columnId),
      priority: params.priority as TaskPriority | undefined,
      labels: params.labels,
    });

    await this.taskStore.save(task);
    this.emitCreatedCardTransition(board, column, task);

    return successResult(this.taskToCard(task));
  }

  async moveCard(params: {
    cardId: string;
    targetColumnId: string;
    position?: number;
  }): Promise<ToolResult> {
    const task = await this.taskStore.get(params.cardId);
    if (!task) {
      return errorResult(`Card not found: ${params.cardId}`);
    }

    if (!task.boardId) {
      return errorResult(`Card ${params.cardId} is not associated with a board`);
    }

    const board = await this.kanbanBoardStore.get(task.boardId);
    if (!board) {
      return errorResult(`Board not found: ${task.boardId}`);
    }

    const targetColumn = board.columns.find((c) => c.id === params.targetColumnId);
    if (!targetColumn) {
      return errorResult(`Column not found: ${params.targetColumnId}`);
    }

    const fromColumnId = task.columnId ?? "backlog";
    const fromColumn = board.columns.find((c) => c.id === fromColumnId);

    // Check required artifacts before allowing transition
    const requiredArtifacts = targetColumn.automation?.requiredArtifacts;
    if (requiredArtifacts && requiredArtifacts.length > 0 && this.artifactStore) {
      const missingArtifacts: string[] = [];
      for (const artifactType of requiredArtifacts) {
        const artifacts = await this.artifactStore.listByTaskAndType(
          task.id,
          artifactType as ArtifactType
        );
        if (artifacts.length === 0) {
          missingArtifacts.push(artifactType);
        }
      }
      if (missingArtifacts.length > 0) {
        return errorResult(
          `Cannot move card to "${targetColumn.name}": missing required artifacts: ${missingArtifacts.join(", ")}. ` +
          `Please provide these artifacts before moving the card.`
        );
      }
    }

    task.columnId = params.targetColumnId;
    task.status = columnIdToTaskStatus(params.targetColumnId);
    task.position = params.position ?? task.position;
    task.updatedAt = new Date();

    await this.taskStore.save(task);

    // Emit column transition event if column actually changed
    if (this.eventBus && fromColumnId !== params.targetColumnId) {
      emitColumnTransition(this.eventBus, {
        cardId: task.id,
        cardTitle: task.title,
        boardId: task.boardId,
        workspaceId: task.workspaceId,
        fromColumnId,
        toColumnId: params.targetColumnId,
        fromColumnName: fromColumn?.name,
        toColumnName: targetColumn.name,
      });
    }

    return successResult(this.taskToCard(task));
  }

  async updateCard(params: {
    cardId: string;
    title?: string;
    description?: string;
    priority?: "low" | "medium" | "high" | "urgent";
    labels?: string[];
  }): Promise<ToolResult> {
    const task = await this.taskStore.get(params.cardId);
    if (!task) {
      return errorResult(`Card not found: ${params.cardId}`);
    }

    if (params.title !== undefined) task.title = params.title;
    if (params.description !== undefined) task.objective = params.description;
    if (params.priority !== undefined) task.priority = params.priority as TaskPriority;
    if (params.labels !== undefined) task.labels = params.labels;
    task.updatedAt = new Date();

    await this.taskStore.save(task);

    return successResult(this.taskToCard(task));
  }

  async deleteCard(cardId: string): Promise<ToolResult> {
    const task = await this.taskStore.get(cardId);
    if (!task) {
      return errorResult(`Card not found: ${cardId}`);
    }

    await this.taskStore.delete(cardId);

    return successResult({ deleted: true, cardId });
  }

  // ─── Column Operations ──────────────────────────────────────────────────

  async createColumn(params: {
    boardId: string;
    name: string;
    color?: string;
  }): Promise<ToolResult> {
    const board = await this.kanbanBoardStore.get(params.boardId);
    if (!board) {
      return errorResult(`Board not found: ${params.boardId}`);
    }

    const columnId = params.name.toLowerCase().replace(/\s+/g, "-");
    if (board.columns.some((c) => c.id === columnId)) {
      return errorResult(`Column already exists: ${columnId}`);
    }

    const newColumn: KanbanColumn = {
      id: columnId,
      name: params.name,
      color: params.color,
      position: board.columns.length,
      stage: "backlog",
    };

    board.columns.push(newColumn);
    board.updatedAt = new Date();

    await this.kanbanBoardStore.save(board);

    return successResult({
      columnId: newColumn.id,
      name: newColumn.name,
      position: newColumn.position,
    });
  }

  async deleteColumn(params: {
    columnId: string;
    boardId: string;
    deleteCards?: boolean;
  }): Promise<ToolResult> {
    const board = await this.kanbanBoardStore.get(params.boardId);
    if (!board) {
      return errorResult(`Board not found: ${params.boardId}`);
    }

    const columnIndex = board.columns.findIndex((c) => c.id === params.columnId);
    if (columnIndex === -1) {
      return errorResult(`Column not found: ${params.columnId}`);
    }

    const tasks = await this.taskStore.listByWorkspace(board.workspaceId);
    const columnTasks = tasks.filter(
      (t) => t.boardId === params.boardId && (t.columnId ?? "backlog") === params.columnId,
    );

    if (params.deleteCards) {
      for (const task of columnTasks) {
        await this.taskStore.delete(task.id);
      }
    } else if (columnTasks.length > 0) {
      // Move cards to backlog
      for (const task of columnTasks) {
        task.columnId = "backlog";
        task.updatedAt = new Date();
        await this.taskStore.save(task);
      }
    }

    board.columns.splice(columnIndex, 1);
    // Reorder remaining columns
    board.columns.forEach((c, i) => {
      c.position = i;
    });
    board.updatedAt = new Date();

    await this.kanbanBoardStore.save(board);

    return successResult({
      deleted: true,
      columnId: params.columnId,
      cardsDeleted: params.deleteCards ? columnTasks.length : 0,
      cardsMoved: params.deleteCards ? 0 : columnTasks.length,
    });
  }

  // ─── Search/Filter Operations ───────────────────────────────────────────

  async searchCards(params: {
    query: string;
    boardId?: string;
    workspaceId: string;
  }): Promise<ToolResult> {
    const tasks = await this.taskStore.listByWorkspace(params.workspaceId);
    const queryLower = params.query.toLowerCase();

    const matchingTasks = tasks.filter((t) => {
      if (params.boardId && t.boardId !== params.boardId) return false;
      if (!t.boardId) return false; // Only include tasks that are on a board

      const titleMatch = t.title.toLowerCase().includes(queryLower);
      const labelMatch = t.labels.some((l) => l.toLowerCase().includes(queryLower));
      const assigneeMatch = t.assignee?.toLowerCase().includes(queryLower);

      return titleMatch || labelMatch || assigneeMatch;
    });

    return successResult(matchingTasks.map((t) => this.taskToCard(t)));
  }

  async listCardsByColumn(columnId: string, boardId: string): Promise<ToolResult> {
    const board = await this.kanbanBoardStore.get(boardId);
    if (!board) {
      return errorResult(`Board not found: ${boardId}`);
    }

    const column = board.columns.find((c) => c.id === columnId);
    if (!column) {
      return errorResult(`Column not found: ${columnId}`);
    }

    const tasks = await this.taskStore.listByWorkspace(board.workspaceId);
    const columnTasks = tasks
      .filter((t) => t.boardId === boardId && (t.columnId ?? "backlog") === columnId)
      .sort((a, b) => a.position - b.position);

    return successResult({
      columnId,
      columnName: column.name,
      cards: columnTasks.map((t) => this.taskToCard(t)),
    });
  }

  // Helper to convert Task to Card format
  /**
   * Decompose a natural language input into multiple Kanban cards.
   * Returns the created tasks as card objects.
   */
  async decomposeTasks(params: {
    boardId: string;
    workspaceId: string;
    tasks: { title: string; description?: string; priority?: "low" | "medium" | "high" | "urgent"; labels?: string[] }[];
    columnId?: string;
  }): Promise<ToolResult> {
    const board = await this.kanbanBoardStore.get(params.boardId);
    if (!board) {
      return errorResult(`Board not found: ${params.boardId}`);
    }

    const targetColumnId = params.columnId ?? "backlog";
    const column = board.columns.find((c) => c.id === targetColumnId);
    if (!column) {
      return errorResult(`Column not found: ${targetColumnId}`);
    }

    const existingTasks = await this.taskStore.listByWorkspace(params.workspaceId);
    const columnTasks = existingTasks.filter(
      (t) => t.boardId === params.boardId && (t.columnId ?? "backlog") === targetColumnId,
    );
    let position = columnTasks.length;

    const createdCards = [];
    for (const item of params.tasks) {
      const task = createTask({
        id: uuidv4(),
        title: item.title,
        objective: item.description ?? "",
        workspaceId: params.workspaceId,
        boardId: params.boardId,
        columnId: targetColumnId,
        position: position++,
        status: columnIdToTaskStatus(targetColumnId),
        priority: item.priority as TaskPriority | undefined,
        labels: item.labels,
      });
      await this.taskStore.save(task);
      this.emitCreatedCardTransition(board, column, task);
      createdCards.push(this.taskToCard(task));
    }

    return successResult({ count: createdCards.length, cards: createdCards });
  }

  private taskToCard(task: Task) {
    return {
      id: task.id,
      title: task.title,
      description: task.objective,
      status: task.status,
      columnId: task.columnId ?? "backlog",
      position: task.position,
      priority: task.priority,
      labels: task.labels,
      assignee: task.assignee,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  private emitCreatedCardTransition(board: { id: string; workspaceId: string }, column: KanbanColumn, task: Task) {
    if (!this.eventBus || !column.automation?.enabled) {
      return;
    }

    emitColumnTransition(this.eventBus, {
      cardId: task.id,
      cardTitle: task.title,
      boardId: board.id,
      workspaceId: board.workspaceId,
      fromColumnId: "__created__",
      toColumnId: column.id,
      fromColumnName: "Created",
      toColumnName: column.name,
    });
  }
}
