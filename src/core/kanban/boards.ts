import { v4 as uuidv4 } from "uuid";
import { createKanbanBoard } from "../models/kanban";
import type { RoutaSystem } from "../routa-system";

export async function ensureDefaultBoard(system: RoutaSystem, workspaceId: string): Promise<ReturnType<typeof createKanbanBoard>> {
  const existing = await system.kanbanBoardStore.getDefault(workspaceId);
  if (existing) return existing;

  const workspace = await system.workspaceStore.get(workspaceId);
  const board = createKanbanBoard({
    id: uuidv4(),
    workspaceId,
    name: workspace?.title ? `${workspace.title} Board` : "Workspace Board",
    isDefault: true,
  });
  await system.kanbanBoardStore.save(board);
  return board;
}