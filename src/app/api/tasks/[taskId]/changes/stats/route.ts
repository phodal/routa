import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { getRepoFileDiff, isGitRepository } from "@/core/git";
import type { GitFileChange } from "@/core/git/git-utils";

export const dynamic = "force-dynamic";

/**
 * GET /api/tasks/[taskId]/changes/stats?paths=file1,file2,file3
 * 
 * Lazy-loading endpoint for detailed file statistics.
 * Returns additions/deletions counts for specific files only.
 * 
 * This allows the UI to:
 * 1. Quickly load the file list without stats
 * 2. Request stats only for visible files (e.g., as user scrolls)
 * 3. Avoid computing stats for 2000+ files when only 10 are visible
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const searchParams = request.nextUrl.searchParams;
  
  // Get comma-separated list of file paths to fetch stats for
  const pathsParam = searchParams.get("paths");
  if (!pathsParam) {
    return NextResponse.json(
      { error: "Missing 'paths' query parameter" },
      { status: 400 },
    );
  }
  
  const requestedPaths = pathsParam.split(",").map((p) => p.trim()).filter(Boolean);
  if (requestedPaths.length === 0) {
    return NextResponse.json(
      { error: "No valid paths provided" },
      { status: 400 },
    );
  }
  
  // Limit batch size to prevent abuse
  if (requestedPaths.length > 100) {
    return NextResponse.json(
      { error: "Too many paths requested. Maximum 100 per request." },
      { status: 400 },
    );
  }
  
  const system = getRoutaSystem();
  const task = await system.taskStore.get(taskId);
  
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  
  const worktree = task.worktreeId
    ? await system.worktreeStore.get(task.worktreeId)
    : null;
  const codebaseId = worktree?.codebaseId ?? task.codebaseIds?.[0] ?? "";
  const codebase = codebaseId ? await system.codebaseStore.get(codebaseId) : null;
  const repoPath = worktree?.worktreePath ?? codebase?.repoPath ?? "";
  
  if (!repoPath || !isGitRepository(repoPath)) {
    return NextResponse.json(
      { error: "Repository is missing or not a git repository" },
      { status: 400 },
    );
  }
  
  // Get status parameter for each file (optional, can be inferred from current changes)
  const statusesParam = searchParams.get("statuses") || "";
  const statuses = statusesParam.split(",").map((s) => s.trim()).filter(Boolean);
  
  // Fetch stats for each requested file
  const fileStats: Array<{
    path: string;
    additions: number;
    deletions: number;
    error?: string;
  }> = [];
  
  for (let i = 0; i < requestedPaths.length; i++) {
    const filePath = requestedPaths[i];
    const status = (statuses[i] || "modified") as GitFileChange["status"];
    
    try {
      const diff = getRepoFileDiff(repoPath, {
        path: filePath,
        status,
      });
      
      fileStats.push({
        path: filePath,
        additions: diff.additions ?? 0,
        deletions: diff.deletions ?? 0,
      });
    } catch (error) {
      fileStats.push({
        path: filePath,
        additions: 0,
        deletions: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  
  return NextResponse.json(
    {
      stats: fileStats,
      requested: requestedPaths.length,
      successful: fileStats.filter((s) => !s.error).length,
    },
    {
      headers: { "Cache-Control": "public, max-age=10" }, // Cache for 10 seconds
    },
  );
}
