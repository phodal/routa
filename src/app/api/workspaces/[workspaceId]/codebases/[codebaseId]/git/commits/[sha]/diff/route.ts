import { NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { isGitRepository } from "@/core/git";
import { getCommitDiff } from "@/core/git/git-operations";

export const dynamic = "force-dynamic";

/**
 * GET /api/workspaces/:workspaceId/codebases/:codebaseId/git/commits/:sha/diff?path=...
 * Get diff for a specific commit (optionally for a specific file)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; codebaseId: string; sha: string }> },
) {
  const { workspaceId, codebaseId, sha } = await params;
  const url = new URL(request.url);
  const path = url.searchParams.get("path") || undefined;

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
    const diff = await getCommitDiff(codebase.repoPath, sha, path);
    
    return NextResponse.json({
      diff,
      sha,
      path,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to get commit diff",
      },
      { status: 500 },
    );
  }
}
