/**
 * /api/worktrees/[worktreeId]
 *
 * GET    — Get a single worktree
 * DELETE — Remove a worktree
 */

import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { GitWorktreeService } from "@/core/git/git-worktree-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ worktreeId: string }> }
) {
  const { worktreeId } = await params;
  const system = getRoutaSystem();

  const worktree = await system.worktreeStore.get(worktreeId);
  if (!worktree) {
    return NextResponse.json({ error: "Worktree not found" }, { status: 404 });
  }

  return NextResponse.json({ worktree });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ worktreeId: string }> }
) {
  const { worktreeId } = await params;
  const deleteBranch = request.nextUrl.searchParams.get("deleteBranch") === "true";

  const system = getRoutaSystem();
  const service = new GitWorktreeService(system.worktreeStore, system.codebaseStore);

  try {
    await service.removeWorktree(worktreeId, { deleteBranch });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
