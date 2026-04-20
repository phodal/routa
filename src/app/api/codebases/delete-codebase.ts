import { NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { GitWorktreeService } from "@/core/git/git-worktree-service";

export async function deleteCodebaseById(codebaseId: string, workspaceId?: string) {
  const system = getRoutaSystem();
  const existingCodebase = await system.codebaseStore.get(codebaseId);

  if (!existingCodebase || (workspaceId && existingCodebase.workspaceId !== workspaceId)) {
    return NextResponse.json({ error: "Codebase not found" }, { status: 404 });
  }

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