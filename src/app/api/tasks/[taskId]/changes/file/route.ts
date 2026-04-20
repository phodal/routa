import { NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { getRepoFileDiff, isGitRepository } from "@/core/git";
import type { GitFileChange } from "@/core/git";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const url = new URL(request.url);
  const path = url.searchParams.get("path")?.trim();
  const status = url.searchParams.get("status")?.trim() as GitFileChange["status"] | null;
  const previousPath = url.searchParams.get("previousPath")?.trim() || undefined;
  const system = getRoutaSystem();
  const task = await system.taskStore.get(taskId);

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (!path || !status) {
    return NextResponse.json({ error: "Missing file path or status" }, { status: 400 });
  }

  const worktree = task.worktreeId
    ? await system.worktreeStore.get(task.worktreeId)
    : null;
  const codebaseId = worktree?.codebaseId ?? task.codebaseIds?.[0] ?? "";
  const codebase = codebaseId ? await system.codebaseStore.get(codebaseId) : null;
  const repoPath = worktree?.worktreePath ?? codebase?.repoPath ?? "";

  if (!repoPath || !isGitRepository(repoPath)) {
    return NextResponse.json({ error: "Repository is missing or not a git repository" }, { status: 400 });
  }

  const diff = getRepoFileDiff(repoPath, {
    path,
    previousPath,
    status,
  });

  return NextResponse.json({ diff }, { headers: { "Cache-Control": "no-store" } });
}
