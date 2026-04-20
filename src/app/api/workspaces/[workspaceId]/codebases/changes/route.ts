import { NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { getRepoChanges, isBareGitRepository, isGitRepository } from "@/core/git";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params;
  const system = getRoutaSystem();
  const codebases = await system.codebaseStore.listByWorkspace(workspaceId);

  const repos = codebases.map((codebase) => {
    const label = codebase.label ?? codebase.repoPath.split("/").pop() ?? codebase.repoPath;

    try {
      if (!codebase.repoPath) {
        throw new Error("Missing repository path");
      }
      if (!isGitRepository(codebase.repoPath)) {
        throw new Error("Repository is missing or not a git repository");
      }
      if (isBareGitRepository(codebase.repoPath)) {
        throw new Error("This codebase points to a bare git repository (no working directory). Bare repos can't show changes. Use a worktree or regular clone instead.");
      }

      const changes = getRepoChanges(codebase.repoPath);
      return {
        codebaseId: codebase.id,
        repoPath: codebase.repoPath,
        label,
        branch: changes.branch,
        status: changes.status,
        files: changes.files,
      };
    } catch (error) {
      return {
        codebaseId: codebase.id,
        repoPath: codebase.repoPath,
        label,
        branch: codebase.branch ?? "unknown",
        status: {
          clean: true,
          ahead: 0,
          behind: 0,
          modified: 0,
          untracked: 0,
        },
        files: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  return NextResponse.json({ workspaceId, repos });
}
