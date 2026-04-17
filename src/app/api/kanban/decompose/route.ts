import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { KanbanTools } from "@/core/tools/kanban-tools";

export const dynamic = "force-dynamic";

interface DecomposeBody {
  boardId: string;
  workspaceId: string;
  tasks: {
    title: string;
    description?: string;
    priority?: "low" | "medium" | "high" | "urgent";
    labels?: string[];
    scope?: string;
    acceptanceCriteria?: string[];
    verificationCommands?: string[];
    testCases?: string[];
  }[];
  columnId?: string;
}

export async function POST(request: NextRequest) {
  let body: DecomposeBody;
  try {
    body = await request.json() as DecomposeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.boardId || !body.workspaceId || !Array.isArray(body.tasks) || body.tasks.length === 0) {
    return NextResponse.json({ error: "boardId, workspaceId, and non-empty tasks array are required" }, { status: 400 });
  }

  const system = getRoutaSystem();
  const kanbanTools = new KanbanTools(system.kanbanBoardStore, system.taskStore);
  kanbanTools.setEventBus(system.eventBus);
  kanbanTools.setAutomationSystem(system);

  const result = await kanbanTools.decomposeTasks({
    boardId: body.boardId,
    workspaceId: body.workspaceId,
    tasks: body.tasks,
    columnId: body.columnId,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result.data);
}
