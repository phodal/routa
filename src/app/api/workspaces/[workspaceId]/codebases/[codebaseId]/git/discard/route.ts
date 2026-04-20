import { NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { isGitRepository } from "@/core/git";
import { discardChanges } from "@/core/git/git-operations";

export const dynamic = "force-dynamic";

/**
 * POST /api/workspaces/:workspaceId/codebases/:codebaseId/git/discard
 * Discard changes to files in working directory (destructive)
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; codebaseId: string }> },
) {
  const { workspaceId, codebaseId } = await params;
  const body = await request.json();
  const { files, confirm } = body as { files?: string[]; confirm?: boolean };

  if (!files || !Array.isArray(files) || files.length === 0) {
    return NextResponse.json(
      { success: false, error: "Missing or invalid 'files' array in request body" },
      { status: 400 },
    );
  }

  if (confirm !== true) {
    return NextResponse.json(
      { success: false, error: "Discard changes requires explicit confirmation" },
      { status: 400 },
    );
  }

  const system = getRoutaSystem();
  const workspace = await system.workspaceStore.get(workspaceId);
  
  if (!workspace) {
    return NextResponse.json(
      { success: false, error: "Workspace not found" },
      { status: 404 },
    );
  }

  const codebase = await system.codebaseStore.get(codebaseId);
  
  if (!codebase) {
    return NextResponse.json(
      { success: false, error: "Codebase not found" },
      { status: 404 },
    );
  }

  if (!isGitRepository(codebase.repoPath)) {
    return NextResponse.json(
      { success: false, error: "Not a valid git repository" },
      { status: 400 },
    );
  }

  try {
    await discardChanges(codebase.repoPath, files);
    
    return NextResponse.json({
      success: true,
      discarded: files,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to discard changes",
      },
      { status: 500 },
    );
  }
}
