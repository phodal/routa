/**
 * /api/worktrees/[worktreeId]/validate
 *
 * POST — Validate worktree health on disk
 */

import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { GitWorktreeService } from "@/core/git/git-worktree-service";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ worktreeId: string }> }
) {
  const { worktreeId } = await params;
  const system = getRoutaSystem();
  const service = new GitWorktreeService(system.worktreeStore, system.codebaseStore);

  const result = await service.validateWorktree(worktreeId);
  return NextResponse.json(result);
}
