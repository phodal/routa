import { NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { isGitRepository } from "@/core/git";
import { getCommitList } from "@/core/git/git-operations";

export const dynamic = "force-dynamic";

/**
 * GET /api/workspaces/:workspaceId/codebases/:codebaseId/git/commits
 * Get commit history from current branch
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; codebaseId: string }> },
) {
  const { workspaceId, codebaseId } = await params;
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get("limit") || "20", 10);
  const since = url.searchParams.get("since") || undefined;

  const system = getRoutaSystem();
  const workspace = await system.workspaceStore.get(workspaceId);
  
  if (!workspace) {
    return NextResponse.json(
      { error: "Workspace not found" },
      { status: 404 },
    );
  }

  const codebase = await system.codebaseStore.get(codebaseId);
  
  if (!codebase) {
    return NextResponse.json(
      { error: "Codebase not found" },
      { status: 404 },
    );
  }

  if (!isGitRepository(codebase.repoPath)) {
    return NextResponse.json(
      { error: "Not a valid git repository" },
      { status: 400 },
    );
  }

  try {
    const commits = await getCommitList(codebase.repoPath, { limit, since });
    
    return NextResponse.json({
      commits,
      count: commits.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to get commit list",
      },
      { status: 500 },
    );
  }
}
