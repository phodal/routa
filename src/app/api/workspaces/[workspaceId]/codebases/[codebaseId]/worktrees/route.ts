/**
 * /api/workspaces/[workspaceId]/codebases/[codebaseId]/worktrees
 *
 * GET  — List worktrees for a codebase
 * POST — Create a new worktree
 */

import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { GitWorktreeService } from "@/core/git/git-worktree-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; codebaseId: string }> }
) {
  const { workspaceId, codebaseId } = await params;
  const system = getRoutaSystem();

  // Validate codebase belongs to the workspace
  const codebase = await system.codebaseStore.get(codebaseId);
  if (!codebase || codebase.workspaceId !== workspaceId) {
    return NextResponse.json({ error: "Codebase not found" }, { status: 404 });
  }

  const worktrees = await system.worktreeStore.listByCodebase(codebaseId);
  return NextResponse.json({ worktrees });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; codebaseId: string }> }
) {
  const { workspaceId, codebaseId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body === null || Array.isArray(body) || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { branch, baseBranch, label } = body as Record<string, unknown>;
  if (
    (branch !== undefined && typeof branch !== "string") ||
    (baseBranch !== undefined && typeof baseBranch !== "string") ||
    (label !== undefined && typeof label !== "string")
  ) {
    return NextResponse.json(
      { error: "branch, baseBranch, and label must be strings" },
      { status: 400 }
    );
  }

  const system = getRoutaSystem();

  // Validate codebase belongs to the workspace
  const codebase = await system.codebaseStore.get(codebaseId);
  if (!codebase || codebase.workspaceId !== workspaceId) {
    return NextResponse.json({ error: "Codebase not found" }, { status: 404 });
  }

  const service = new GitWorktreeService(system.worktreeStore, system.codebaseStore);

  try {
    const worktree = await service.createWorktree(codebaseId, {
      branch: branch as string | undefined,
      baseBranch: baseBranch as string | undefined,
      label: label as string | undefined,
    });
    return NextResponse.json({ worktree }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("already in use")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
