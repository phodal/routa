import { TaskStatus } from "./task";

export type KanbanColumnStage = "backlog" | "todo" | "dev" | "review" | "blocked" | "done";

export interface KanbanColumn {
  id: string;
  name: string;
  color?: string;
  position: number;
  stage: KanbanColumnStage;
}

export interface KanbanBoard {
  id: string;
  workspaceId: string;
  name: string;
  isDefault: boolean;
  columns: KanbanColumn[];
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_KANBAN_COLUMNS: KanbanColumn[] = [
  { id: "backlog", name: "Backlog", color: "slate", position: 0, stage: "backlog" },
  { id: "todo", name: "Todo", color: "sky", position: 1, stage: "todo" },
  { id: "dev", name: "Dev", color: "amber", position: 2, stage: "dev" },
  { id: "review", name: "Review", color: "violet", position: 3, stage: "review" },
  { id: "blocked", name: "Blocked", color: "rose", position: 4, stage: "blocked" },
  { id: "done", name: "Done", color: "emerald", position: 5, stage: "done" },
];

export function createKanbanBoard(params: {
  id: string;
  workspaceId: string;
  name: string;
  isDefault?: boolean;
  columns?: KanbanColumn[];
}): KanbanBoard {
  const now = new Date();
  return {
    id: params.id,
    workspaceId: params.workspaceId,
    name: params.name,
    isDefault: params.isDefault ?? false,
    columns: params.columns ?? DEFAULT_KANBAN_COLUMNS,
    createdAt: now,
    updatedAt: now,
  };
}

export function columnIdToTaskStatus(columnId?: string): TaskStatus {
  switch ((columnId ?? "backlog").toLowerCase()) {
    case "dev":
      return TaskStatus.IN_PROGRESS;
    case "review":
      return TaskStatus.REVIEW_REQUIRED;
    case "blocked":
      return TaskStatus.BLOCKED;
    case "done":
      return TaskStatus.COMPLETED;
    default:
      return TaskStatus.PENDING;
  }
}

export function taskStatusToColumnId(status: TaskStatus | string | undefined): string {
  switch ((status ?? TaskStatus.PENDING).toString().toUpperCase()) {
    case TaskStatus.IN_PROGRESS:
      return "dev";
    case TaskStatus.REVIEW_REQUIRED:
      return "review";
    case TaskStatus.BLOCKED:
      return "blocked";
    case TaskStatus.COMPLETED:
      return "done";
    default:
      return "backlog";
  }
}