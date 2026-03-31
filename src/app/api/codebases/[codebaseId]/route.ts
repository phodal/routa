/**
 * /api/codebases/[codebaseId] - Single codebase operations.
 *
 * PATCH  /api/codebases/:id → Update branch/label
 * DELETE /api/codebases/:id → Remove codebase
 */

import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { GitWorktreeService } from "@/core/git/git-worktree-service";
import { normalizeLocalRepoPath, validateRepoInput } from "@/core/git";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ codebaseId: string }> }
) {
  const { codebaseId } = await params;
  const body = await request.json();
  const { branch, label } = body;
  const repoPathInput = typeof body?.repoPath === "string" ? body.repoPath : undefined;

  const system = getRoutaSystem();
  const existingCodebase = await system.codebaseStore.get(codebaseId);
  if (!existingCodebase) {
    return NextResponse.json({ error: "Codebase not found" }, { status: 404 });
  }

  let repoPath = repoPathInput;
  if (repoPathInput !== undefined) {
    repoPath = normalizeLocalRepoPath(repoPathInput);
    const validation = validateRepoInput(repoPath);
    if (!validation.valid || validation.isGitHub) {
      return NextResponse.json(
        { error: validation.error ?? "repoPath must point to a local git repository" },
        { status: 400 },
      );
    }

    const duplicate = await system.codebaseStore.findByRepoPath(existingCodebase.workspaceId, repoPath);
    if (duplicate && duplicate.id !== codebaseId) {
      return NextResponse.json(
        { error: "Codebase with this repoPath already exists in the workspace" },
        { status: 409 },
      );
    }
  }

  await system.codebaseStore.update(codebaseId, { branch, label, repoPath });
  const codebase = await system.codebaseStore.get(codebaseId);

  return NextResponse.json({ codebase });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ codebaseId: string }> }
) {
  const { codebaseId } = await params;
  const system = getRoutaSystem();

  // Clean up worktrees on disk before deleting the codebase
  try {
    const service = new GitWorktreeService(system.worktreeStore, system.codebaseStore);
    await service.removeAllForCodebase(codebaseId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Codebase DELETE] Worktree cleanup failed for ${codebaseId}:`, message);
    return NextResponse.json(
      { error: `Worktree cleanup failed: ${message}` },
      { status: 500 }
    );
  }

  await system.codebaseStore.remove(codebaseId);

  return NextResponse.json({ deleted: true });
}
