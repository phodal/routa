import { NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { getRepoCommitDiff, isGitRepository } from "@/core/git";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const url = new URL(request.url);
  const sha = url.searchParams.get("sha")?.trim();
  const context = url.searchParams.get("context") === "full" ? "full" : "preview";
  const system = getRoutaSystem();
  const task = await system.taskStore.get(taskId);

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (!sha) {
    return NextResponse.json({ error: "Missing commit sha" }, { status: 400 });
  }

  const worktree = task.worktreeId
    ? await system.worktreeStore.get(task.worktreeId)
    : null;
  const codebaseId = worktree?.codebaseId ?? task.codebaseIds?.[0] ?? "";
  const codebase = codebaseId ? await system.codebaseStore.get(codebaseId) : null;
  const repoPath = worktree?.worktreePath ?? codebase?.repoPath ?? task.deliverySnapshot?.repoPath ?? "";

  if (!repoPath || !isGitRepository(repoPath)) {
    return NextResponse.json({ error: "Repository is missing or not a git repository" }, { status: 400 });
  }

  const diff = getRepoCommitDiff(repoPath, sha, { context });
  return NextResponse.json({ diff }, { headers: { "Cache-Control": "no-store" } });
}
