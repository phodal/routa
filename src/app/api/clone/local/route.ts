import { NextRequest, NextResponse } from "next/server";
import * as path from "path";

import {
  getBranchInfo,
  getRepoStatus,
  normalizeLocalRepoPath,
  validateRepoInput,
} from "@/core/git";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawPath = typeof body?.path === "string" ? body.path : "";

    if (!rawPath.trim()) {
      return NextResponse.json({ error: "Missing 'path' field" }, { status: 400 });
    }

    const repoPath = normalizeLocalRepoPath(rawPath);
    const validation = validateRepoInput(repoPath);
    if (!validation.valid || validation.isGitHub) {
      return NextResponse.json(
        { error: validation.error ?? "Invalid local repository path" },
        { status: 400 },
      );
    }

    const branchInfo = getBranchInfo(repoPath);

    return NextResponse.json({
      success: true,
      name: path.basename(repoPath),
      path: repoPath,
      branch: branchInfo.current,
      branches: branchInfo.branches,
      status: getRepoStatus(repoPath),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load local repository" },
      { status: 500 },
    );
  }
}
