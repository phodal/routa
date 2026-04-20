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
import * as path from "path";
import {
  parseGitHubUrl,
  getCloneBaseDir,
  repoToDirName,
  listClonedRepos,
  getBranchInfo,
  checkoutBranch,
  isBareGitRepository,
} from "@/core/git";
import { importGitHubRepo } from "@/core/github";

function getGitHubToken(): string | undefined {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
}

function copyDirectoryRecursively(sourceDir: string, targetDir: string) {
  fs.mkdirSync(targetDir, { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
}

async function importGitHubZipFallback(params: {
  owner: string;
  repo: string;
  targetDir: string;
}) {
  const workspace = await importGitHubRepo({
    owner: params.owner,
    repo: params.repo,
    token: getGitHubToken(),
  });

  // importGitHubRepo stores extraction in a shared tmp cache. For /api/clone,
  // copy to the conventional clone directory so the rest of the app can keep
  // using repoPath semantics unchanged.
  copyDirectoryRecursively(workspace.extractedPath, params.targetDir);

  return {
    current: workspace.ref,
    branches: [workspace.ref],
  };
}

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

    let branchInfo: { current: string; branches: string[] };
    let importedVia = "git";

    // Clone the repository. If git is unavailable (serverless) or clone fails,
    // gracefully fall back to GitHub zipball import.
    const cloneUrl = `https://github.com/${owner}/${repo}.git`;
    try {
      execSync(`git clone --depth 1 "${cloneUrl}" "${targetDir}"`, {
        stdio: "pipe",
        timeout: 120000,
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

      branchInfo = getBranchInfo(targetDir);
    } catch (gitErr) {
      importedVia = "zipball";
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }

      // Ensure per-request temp isolation for extraction-copy workflow
      fs.mkdirSync(path.dirname(targetDir), { recursive: true });

      try {
        branchInfo = await importGitHubZipFallback({ owner, repo, targetDir });
      } catch {
        throw gitErr;
      }
    }

    return NextResponse.json({
      success: true,
      path: targetDir,
      name: `${owner}/${repo}`,
      branch: branchInfo.current,
      branches: branchInfo.branches,
      importedVia,
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
    if (isBareGitRepository(repoPath)) {
      return NextResponse.json(
        {
          error: "This repository is a bare git repository (no working directory)",
          suggestion: "Bare repos can't be checked out or synced. Use them as worktree sources instead, or clone a regular working copy."
        },
        { status: 400 }
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
