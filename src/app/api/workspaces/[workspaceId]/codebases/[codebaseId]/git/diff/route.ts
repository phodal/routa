import { NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { isGitRepository } from "@/core/git";
import { getFileDiff } from "@/core/git/git-operations";

export const dynamic = "force-dynamic";

/**
 * GET /api/workspaces/:workspaceId/codebases/:codebaseId/git/diff?path=...&staged=true
 * Get diff for a specific file
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; codebaseId: string }> },
) {
  const { workspaceId, codebaseId } = await params;
  const url = new URL(request.url);
  const path = url.searchParams.get("path");
  const staged = url.searchParams.get("staged") === "true";

  if (!path) {
    return NextResponse.json(
      { error: "Missing 'path' query parameter" },
      { status: 400 },
    );
  }

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
    const diff = await getFileDiff(codebase.repoPath, path, staged);
    
    return NextResponse.json({
      diff,
      path,
      staged,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to get diff",
      },
      { status: 500 },
    );
  }
}
