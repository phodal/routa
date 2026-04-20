/**
 * /api/workspaces/[workspaceId]/codebases - Codebases for a workspace.
 *
 * GET  /api/workspaces/:workspaceId/codebases → List codebases
 * POST /api/workspaces/:workspaceId/codebases → Add codebase
 */

import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { createCodebase } from "@/core/models/codebase";
import { normalizeLocalRepoPath, validateRepoInput, isBareGitRepository } from "@/core/git";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const system = getRoutaSystem();

  const codebases = await system.codebaseStore.listByWorkspace(workspaceId);

  return NextResponse.json({ codebases });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const body = await request.json();
  const repoPathInput = typeof body?.repoPath === "string" ? body.repoPath : "";
  const { branch, label } = body;

  if (!repoPathInput) {
    return NextResponse.json({ error: "repoPath is required" }, { status: 400 });
  }

  const repoPath = normalizeLocalRepoPath(repoPathInput);
  const validation = validateRepoInput(repoPath);
  if (!validation.valid || validation.isGitHub) {
    return NextResponse.json(
      { error: validation.error ?? "repoPath must point to a local git repository" },
      { status: 400 },
    );
  }

  // Check if this is a bare repository
  // Bare repos don't have a working directory and can't be used as normal codebases
  if (isBareGitRepository(repoPath)) {
    return NextResponse.json(
      {
        error: "Cannot add a bare git repository as a codebase",
        suggestion: "Bare repos don't have a working directory and can't be synced or checked out. Clone a regular working copy instead, or use this repo as a worktree source for task-specific branches."
      },
      { status: 400 }
    );
  }

  const system = getRoutaSystem();

  // Check for duplicate repoPath within this workspace
  const existing = await system.codebaseStore.findByRepoPath(workspaceId, repoPath);
  if (existing) {
    return NextResponse.json(
      { error: "Codebase with this repoPath already exists in the workspace" },
      { status: 409 }
    );
  }

  // If first codebase in workspace, set as default
  const count = await system.codebaseStore.countByWorkspace(workspaceId);
  const isDefault = count === 0;

  const codebase = createCodebase({
    id: crypto.randomUUID(),
    workspaceId,
    repoPath,
    branch,
    label,
    isDefault,
  });

  await system.codebaseStore.add(codebase);

  return NextResponse.json({ codebase }, { status: 201 });
}
