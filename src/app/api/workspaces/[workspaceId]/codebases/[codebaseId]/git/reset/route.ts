import { NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { isGitRepository } from "@/core/git";
import {
  checkoutExistingBranch,
  getCurrentBranchName,
  hasLocalBranch,
  resetBranch,
} from "@/core/git/git-operations";

export const dynamic = "force-dynamic";

/**
 * POST /api/workspaces/:workspaceId/codebases/:codebaseId/git/reset
 * Reset branch to a specific commit or branch
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; codebaseId: string }> },
) {
  const { workspaceId, codebaseId } = await params;
  const body = await request.json();
  const { to, mode, confirm } = body as { to?: string; mode?: "soft" | "hard"; confirm?: boolean };

  if (!to || !to.trim()) {
    return NextResponse.json(
      { success: false, error: "Target commit/branch 'to' is required" },
      { status: 400 },
    );
  }

  if (!mode || (mode !== "soft" && mode !== "hard")) {
    return NextResponse.json(
      { success: false, error: "Mode must be 'soft' or 'hard'" },
      { status: 400 },
    );
  }

  if (mode === "hard" && confirm !== true) {
    return NextResponse.json(
      { success: false, error: "Hard reset requires explicit confirmation" },
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
  
  if (!codebase || codebase.workspaceId !== workspaceId) {
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
    await resetBranch(codebase.repoPath, to, mode);

    const isTargetLocalBranch = await hasLocalBranch(codebase.repoPath, to);
    if (isTargetLocalBranch) {
      const currentBranch = await getCurrentBranchName(codebase.repoPath);
      if (currentBranch !== to) {
        await checkoutExistingBranch(codebase.repoPath, to);
      }
      await system.codebaseStore.update(codebaseId, { branch: to });
    }
    
    return NextResponse.json({
      success: true,
      ...(isTargetLocalBranch ? { branch: to } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to reset branch",
      },
      { status: 500 },
    );
  }
}
