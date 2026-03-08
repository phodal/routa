import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getRoutaSystem } from "@/core/routa-system";
import { createKanbanBoard } from "@/core/models/kanban";
import { ensureDefaultBoard } from "@/core/kanban/boards";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "default";
  const system = getRoutaSystem();
  await ensureDefaultBoard(system, workspaceId);
  const boards = await system.kanbanBoardStore.listByWorkspace(workspaceId);
  return NextResponse.json({ boards });
}

export async function POST(request: NextRequest) {
  let body: { workspaceId?: string; name?: string; columns?: ReturnType<typeof createKanbanBoard>["columns"]; isDefault?: boolean };
  try {
    body = await request.json() as { workspaceId?: string; name?: string; columns?: ReturnType<typeof createKanbanBoard>["columns"]; isDefault?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const workspaceId = body.workspaceId?.trim();
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const system = getRoutaSystem();
  const board = createKanbanBoard({
    id: uuidv4(),
    workspaceId,
    name: body.name.trim(),
    isDefault: body.isDefault ?? false,
    columns: body.columns,
  });
  await system.kanbanBoardStore.save(board);
  if (board.isDefault) {
    await system.kanbanBoardStore.setDefault(workspaceId, board.id);
  }
  return NextResponse.json({ board }, { status: 201 });
}