import * as yaml from "js-yaml";
import { NextRequest, NextResponse } from "next/server";

import { getKanbanEventBroadcaster } from "@/core/kanban/kanban-event-broadcaster";
import { createKanbanBoard, type KanbanColumn } from "@/core/models/kanban";
import { createWorkspace } from "@/core/models/workspace";
import { getRoutaSystem } from "@/core/routa-system";

export const dynamic = "force-dynamic";

interface ImportedKanbanConfig {
  version: number;
  name?: string;
  workspaceId?: string;
  boards: ImportedKanbanBoard[];
}

interface ImportedKanbanBoard {
  id: string;
  name: string;
  isDefault?: boolean;
  columns: ImportedKanbanColumn[];
}

interface ImportedKanbanColumn {
  id: string;
  name: string;
  color?: string;
  stage: KanbanColumn["stage"];
  automation?: KanbanColumn["automation"];
  visible?: boolean;
  width?: "compact" | "standard" | "wide";
}

function parseKanbanConfig(yamlContent: string): ImportedKanbanConfig {
  const parsed = yaml.load(yamlContent) as ImportedKanbanConfig | undefined;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid YAML document");
  }
  if (parsed.version !== 1) {
    throw new Error("Unsupported kanban config version");
  }
  if (!Array.isArray(parsed.boards) || parsed.boards.length === 0) {
    throw new Error("Kanban config must include at least one board");
  }
  return parsed;
}

function normalizeColumns(columns: ImportedKanbanColumn[]): KanbanColumn[] {
  return columns.map((column, index) => ({
    id: column.id,
    name: column.name,
    color: column.color,
    position: index,
    stage: column.stage,
    automation: column.automation,
    visible: column.visible,
    width: column.width,
  }));
}

async function applyBoard(
  workspaceId: string,
  existingBoardIds: Set<string>,
  board: ImportedKanbanBoard,
) {
  const system = getRoutaSystem();
  const columns = normalizeColumns(board.columns);

  if (existingBoardIds.has(board.id)) {
    const existingBoard = await system.kanbanBoardStore.get(board.id);
    if (!existingBoard) {
      throw new Error(`Board ${board.id} no longer exists`);
    }
    await system.kanbanBoardStore.save({
      ...existingBoard,
      name: board.name,
      isDefault: board.isDefault ?? existingBoard.isDefault,
      columns,
      updatedAt: new Date(),
    });
    if (board.isDefault) {
      await system.kanbanBoardStore.setDefault(workspaceId, board.id);
    }
    getKanbanEventBroadcaster().notify({
      workspaceId,
      entity: "board",
      action: "updated",
      resourceId: board.id,
      source: "user",
    });
    return "updated";
  }

  const createdBoard = createKanbanBoard({
    id: board.id,
    workspaceId,
    name: board.name,
    isDefault: board.isDefault,
    columns,
  });
  await system.kanbanBoardStore.save(createdBoard);
  if (createdBoard.isDefault) {
    await system.kanbanBoardStore.setDefault(workspaceId, createdBoard.id);
  }
  getKanbanEventBroadcaster().notify({
    workspaceId,
    entity: "board",
    action: "created",
    resourceId: createdBoard.id,
    source: "user",
  });
  return "created";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const yamlContent = typeof body?.yamlContent === "string" ? body.yamlContent : "";
    const workspaceOverride = typeof body?.workspaceId === "string" ? body.workspaceId.trim() : "";

    if (!yamlContent.trim()) {
      return NextResponse.json({ error: "yamlContent is required" }, { status: 400 });
    }

    const config = parseKanbanConfig(yamlContent);
    const workspaceId = workspaceOverride || config.workspaceId?.trim() || "default";
    const system = getRoutaSystem();
    const existingWorkspace = await system.workspaceStore.get(workspaceId);
    if (!existingWorkspace) {
      await system.workspaceStore.save(createWorkspace({
        id: workspaceId,
        title: config.name?.trim() || workspaceId,
      }));
    }
    const existingBoards = await system.kanbanBoardStore.listByWorkspace(workspaceId);
    const existingBoardIds = new Set(existingBoards.map((board) => board.id));

    const applied = [];
    for (const board of config.boards) {
      const action = await applyBoard(workspaceId, existingBoardIds, board);
      existingBoardIds.add(board.id);
      applied.push({
        boardId: board.id,
        boardName: board.name,
        action,
        columns: board.columns.length,
      });
    }

    return NextResponse.json({
      workspaceId,
      applied,
      importedBoards: applied.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to import kanban YAML" },
      { status: 400 },
    );
  }
}
