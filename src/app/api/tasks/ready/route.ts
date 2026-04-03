/**
 * /api/tasks/ready - Get tasks that are ready to be executed.
 *
 * GET /api/tasks/ready?workspaceId=... → List ready tasks (dependencies completed)
 */

import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { Task } from "@/core/models/task";
import {
  buildTaskEvidenceSummary,
  buildTaskInvestValidation,
  buildTaskStoryReadiness,
} from "../task-evidence-summary";

export const dynamic = "force-dynamic";

function requireWorkspaceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const workspaceId = requireWorkspaceId(searchParams.get("workspaceId"));

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const system = getRoutaSystem();
  const tasks = await system.taskStore.findReadyTasks(workspaceId);

  return NextResponse.json({
    tasks: await Promise.all(tasks.map((task) => serializeTask(task, system))),
  });
}

async function serializeTask(task: Task, system: ReturnType<typeof getRoutaSystem>) {
  const evidenceSummary = await buildTaskEvidenceSummary(task, system);
  const storyReadiness = await buildTaskStoryReadiness(task, system);
  const investValidation = buildTaskInvestValidation(task);

  return {
    id: task.id,
    title: task.title,
    objective: task.objective,
    scope: task.scope,
    acceptanceCriteria: task.acceptanceCriteria,
    verificationCommands: task.verificationCommands,
    testCases: task.testCases,
    assignedTo: task.assignedTo,
    status: task.status,
    dependencies: task.dependencies,
    parallelGroup: task.parallelGroup,
    workspaceId: task.workspaceId,
    sessionId: task.sessionId,
    completionSummary: task.completionSummary,
    verificationVerdict: task.verificationVerdict,
    verificationReport: task.verificationReport,
    artifactSummary: evidenceSummary.artifact,
    evidenceSummary,
    storyReadiness,
    investValidation,
    createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : task.createdAt,
    updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : task.updatedAt,
  };
}
