import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { analyzeFlowForTasks } from "@/core/kanban/flow-ledger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const boardId = request.nextUrl.searchParams.get("boardId") ?? undefined;
  const windowStart = request.nextUrl.searchParams.get("windowStart") ?? undefined;
  const windowEnd = request.nextUrl.searchParams.get("windowEnd") ?? undefined;

  const system = getRoutaSystem();
  const allTasks = await system.taskStore.listByWorkspace(workspaceId);

  const tasks = boardId ? allTasks.filter((t) => t.boardId === boardId) : allTasks;

  // Only analyze tasks that have lane session data
  const tasksWithFlow = tasks.filter(
    (t) => (t.laneSessions?.length ?? 0) > 0 || (t.laneHandoffs?.length ?? 0) > 0,
  );

  const report = analyzeFlowForTasks(tasksWithFlow, {
    workspaceId,
    boardId,
    windowStart,
    windowEnd,
  });

  return NextResponse.json(report);
}
