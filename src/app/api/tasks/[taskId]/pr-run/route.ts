import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { enqueueKanbanTaskSession } from "@/core/kanban/workflow-orchestrator-singleton";
import { buildTaskDeliveryReadiness } from "@/core/kanban/task-delivery-readiness";
import { captureTaskDeliverySnapshot } from "@/core/kanban/task-delivery-snapshot";
import {
  getRemoteUrl,
  isBareGitRepository,
  isGitHubUrl,
  isGitRepository,
} from "@/core/git";

export const dynamic = "force-dynamic";

function isGitLabUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).hostname.toLowerCase().includes("gitlab");
  } catch {
    return value.toLowerCase().includes("gitlab");
  }
}

function detectPrPlatform(params: {
  sourceType?: string;
  sourceUrl?: string;
  remoteUrl?: string | null;
}): "github" | "gitlab" | null {
  const sourceUrl = params.sourceUrl ?? null;
  const remoteUrl = params.remoteUrl ?? null;
  if (params.sourceType === "github") {
    return "github";
  }
  if ((sourceUrl && isGitHubUrl(sourceUrl)) || (remoteUrl && isGitHubUrl(remoteUrl))) {
    return "github";
  }
  if (isGitLabUrl(sourceUrl) || isGitLabUrl(remoteUrl)) {
    return "gitlab";
  }
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const system = getRoutaSystem();
  const task = await system.taskStore.get(taskId);

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  if (!task.boardId) {
    return NextResponse.json({ error: "Task is missing board context." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({})) as {
    specialistLocale?: string;
  };

  const worktree = task.worktreeId
    ? await system.worktreeStore.get(task.worktreeId)
    : null;
  const codebaseId = worktree?.codebaseId ?? task.codebaseIds?.[0] ?? "";
  const codebase = codebaseId ? await system.codebaseStore.get(codebaseId) : null;
  const repoPath = worktree?.worktreePath ?? codebase?.repoPath ?? "";

  if (!repoPath) {
    return NextResponse.json({ error: "No repository or worktree linked to this task." }, { status: 400 });
  }
  if (!isGitRepository(repoPath)) {
    return NextResponse.json({ error: "Linked repository is missing or is not a git repository." }, { status: 400 });
  }
  if (!worktree && isBareGitRepository(repoPath)) {
    return NextResponse.json({
      error: "This task's codebase points to a bare git repository. Attach a worktree before starting a PR session.",
    }, { status: 400 });
  }

  const remoteUrl = getRemoteUrl(repoPath);
  const platform = detectPrPlatform({
    sourceType: codebase?.sourceType,
    sourceUrl: codebase?.sourceUrl,
    remoteUrl,
  });

  if (!platform) {
    return NextResponse.json({
      error: "PR session is only available for GitHub or GitLab repositories.",
    }, { status: 400 });
  }

  const locale = typeof body.specialistLocale === "string" && body.specialistLocale.trim().length > 0
    ? body.specialistLocale.trim()
    : "en";

  const deliveryReadiness = await buildTaskDeliveryReadiness(task, system);
  const deliverySnapshot = captureTaskDeliverySnapshot(task, deliveryReadiness, {
    source: "pr_run",
  });
  if (deliverySnapshot !== task.deliverySnapshot) {
    task.deliverySnapshot = deliverySnapshot;
    task.updatedAt = new Date();
    await system.taskStore.save(task);
  }

  const result = await enqueueKanbanTaskSession(system, {
    task,
    expectedColumnId: task.columnId,
    ignoreExistingTrigger: true,
    bypassQueue: true,
    step: {
      id: `manual-pr-${platform}`,
      role: "DEVELOPER",
      specialistId: "kanban-pr-publisher",
      specialistName: "PR Publisher",
      specialistLocale: locale,
    },
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  if (!result.sessionId) {
    return NextResponse.json({ error: "Failed to create PR session." }, { status: 500 });
  }

  return NextResponse.json({
    sessionId: result.sessionId,
    platform,
    remoteUrl,
  });
}
