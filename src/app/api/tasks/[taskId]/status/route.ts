/**
 * /api/tasks/[taskId]/status - Update task status.
 *
 * POST /api/tasks/:taskId/status { status: "IN_PROGRESS" }
 */

import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { TaskStatus } from "@/core/models/task";
import { taskStatusToColumnId } from "@/core/models/kanban";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const body = await request.json();
  const { status } = body;

  if (!status) {
    return NextResponse.json({ error: "status is required" }, { status: 400 });
  }

  const taskStatus = status.toUpperCase() as TaskStatus;
  if (!Object.values(TaskStatus).includes(taskStatus)) {
    return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
  }

  const system = getRoutaSystem();
  const task = await system.taskStore.get(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  task.status = taskStatus;
  task.columnId = taskStatusToColumnId(taskStatus);
  task.updatedAt = new Date();
  await system.taskStore.save(task);

  return NextResponse.json({ updated: true });
}

