import { NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { isGitRepository } from "@/core/git";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export const dynamic = "force-dynamic";

/**
 * POST /api/workspaces/:workspaceId/codebases/:codebaseId/git/export
 * Export staged changes as a patch file
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; codebaseId: string }> },
) {
  const { workspaceId, codebaseId } = await params;
  const body = await request.json();
  const { files, format = "patch" } = body as { files?: string[]; format?: "patch" | "diff" };

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
    let patchContent = "";
    
    if (format === "patch") {
      // Use git format-patch for staged changes
      const { stdout } = await execAsync(
        "git diff --cached --no-color --no-ext-diff",
        { cwd: codebase.repoPath }
      );
      patchContent = stdout;
    } else {
      // Use git diff for all changes or specific files
      let command = "git diff --no-color --no-ext-diff";
      if (files && files.length > 0) {
        const fileArgs = files.map(f => `"${f}"`).join(" ");
        command += ` -- ${fileArgs}`;
      }
      const { stdout } = await execAsync(command, { cwd: codebase.repoPath });
      patchContent = stdout;
    }
    
    if (!patchContent.trim()) {
      return NextResponse.json(
        { success: false, error: "No changes to export" },
        { status: 400 },
      );
    }

    // Generate filename with timestamp
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, -5);
    const filename = `changes-${timestamp}.patch`;
    
    return NextResponse.json({
      success: true,
      patch: patchContent,
      filename,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to export changes",
      },
      { status: 500 },
    );
  }
}
