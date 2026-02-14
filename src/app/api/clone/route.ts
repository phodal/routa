/**
 * Clone API Route - /api/clone
 *
 * POST /api/clone - Clone a GitHub repository to local directory
 *   Body: { url: string }
 *   Returns: { success: true, path: string, name: string, branch: string, branches: string[] }
 *
 * GET /api/clone - List cloned repositories with branch & status info
 *   Returns: { repos: ClonedRepoInfo[] }
 *
 * PATCH /api/clone - Switch branch on a cloned repo
 *   Body: { repoPath: string, branch: string }
 *   Returns: { success: true, branch: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import * as fs from "fs";
import {
  parseGitHubUrl,
  getCloneBaseDir,
  repoToDirName,
  listClonedRepos,
  getBranchInfo,
  checkoutBranch,
} from "@/core/git";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body as { url?: string };

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "Missing 'url' field" },
        { status: 400 }
      );
    }

    // Parse GitHub URL
    const parsed = parseGitHubUrl(url);
    if (!parsed) {
      return NextResponse.json(
        { error: "Invalid GitHub URL. Expected: https://github.com/owner/repo or owner/repo" },
        { status: 400 }
      );
    }

    const { owner, repo } = parsed;
    const repoName = repoToDirName(owner, repo);

    // Ensure base directory exists
    const baseDir = getCloneBaseDir();
    fs.mkdirSync(baseDir, { recursive: true });

    const targetDir = `${baseDir}/${repoName}`;

    if (fs.existsSync(targetDir)) {
      // Already cloned - pull latest
      try {
        execSync("git pull --ff-only", {
          cwd: targetDir,
          stdio: "pipe",
          timeout: 30000,
        });
      } catch {
        // Pull failed, that's ok - use existing
      }

      const branchInfo = getBranchInfo(targetDir);
      return NextResponse.json({
        success: true,
        path: targetDir,
        name: `${owner}/${repo}`,
        branch: branchInfo.current,
        branches: branchInfo.branches,
        existed: true,
      });
    }

    // Clone the repository
    const cloneUrl = `https://github.com/${owner}/${repo}.git`;
    execSync(`git clone --depth 1 "${cloneUrl}" "${targetDir}"`, {
      stdio: "pipe",
      timeout: 120000, // 2 minutes timeout
    });

    // Unshallow to get branches
    try {
      execSync("git fetch --all", {
        cwd: targetDir,
        stdio: "pipe",
        timeout: 60000,
      });
    } catch {
      // Fetch failed, that's ok for shallow clone
    }

    const branchInfo = getBranchInfo(targetDir);
    return NextResponse.json({
      success: true,
      path: targetDir,
      name: `${owner}/${repo}`,
      branch: branchInfo.current,
      branches: branchInfo.branches,
      existed: false,
    });
  } catch (err) {
    console.error("[clone] Failed:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to clone repository",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/clone - List cloned repositories with full info
 */
export async function GET() {
  try {
    const repos = listClonedRepos();
    return NextResponse.json({ repos });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list repos" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/clone - Switch branch on a cloned repo
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { repoPath, branch } = body as { repoPath?: string; branch?: string };

    if (!repoPath || !branch) {
      return NextResponse.json(
        { error: "Missing 'repoPath' or 'branch' field" },
        { status: 400 }
      );
    }

    if (!fs.existsSync(repoPath)) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 }
      );
    }

    const success = checkoutBranch(repoPath, branch);
    if (!success) {
      return NextResponse.json(
        { error: `Failed to checkout branch '${branch}'` },
        { status: 500 }
      );
    }

    const branchInfo = getBranchInfo(repoPath);
    return NextResponse.json({
      success: true,
      branch: branchInfo.current,
      branches: branchInfo.branches,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to switch branch" },
      { status: 500 }
    );
  }
}
