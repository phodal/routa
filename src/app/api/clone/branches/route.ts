/**
 * Branch Management API Route - /api/clone/branches
 *
 * GET /api/clone/branches?repoPath=...
 *   Returns: { current, local, remote, status }
 *
 * POST /api/clone/branches - Fetch remote branches then return all
 *   Body: { repoPath: string }
 *   Returns: { current, local, remote, status }
 *
 * PATCH /api/clone/branches - Checkout a branch or reset local changes
 *   Body: { repoPath: string, branch: string }
 *   Returns: { success, branch, branches }
 *
 * DELETE /api/clone/branches - Delete a local branch
 *   Body: { repoPath: string, branch: string }
 *   Returns: { success, deletedBranch, current, branches }
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import {
  getCurrentBranch,
  listBranches,
  listRemoteBranches,
  fetchRemote,
  getBranchStatus,
  checkoutBranch,
  deleteBranch,
  pullBranch,
  getBranchInfo,
  getRepoStatus,
  resetLocalChanges,
  isBareGitRepository,
} from "@/core/git";

export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("repoPath");
  if (!repoPath || !fs.existsSync(repoPath)) {
    return NextResponse.json(
      { error: "Missing or invalid repoPath" },
      { status: 400 }
    );
  }

  const current = getCurrentBranch(repoPath) ?? "unknown";
  const local = listBranches(repoPath);
  const remote = listRemoteBranches(repoPath);
  const status = getBranchStatus(repoPath, current);

  return NextResponse.json({ current, local, remote, status });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { repoPath } = body as { repoPath?: string };

  if (!repoPath || !fs.existsSync(repoPath)) {
    return NextResponse.json(
      { error: "Missing or invalid repoPath" },
      { status: 400 }
    );
  }

  // Fetch remote, then return all branches
  fetchRemote(repoPath);

  const current = getCurrentBranch(repoPath) ?? "unknown";
  const local = listBranches(repoPath);
  const remote = listRemoteBranches(repoPath);
  const status = getBranchStatus(repoPath, current);

  return NextResponse.json({ current, local, remote, status });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { repoPath, branch, pull: doPull, action } = body as {
    repoPath?: string;
    branch?: string;
    pull?: boolean;
    action?: "checkout" | "reset";
  };

  if (!repoPath) {
    return NextResponse.json(
      { error: "Missing repoPath" },
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

  if (action === "reset") {
    const result = resetLocalChanges(repoPath);
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to reset local changes" },
        { status: 500 }
      );
    }

    const branchInfo = getBranchInfo(repoPath);
    const status = getBranchStatus(repoPath, branchInfo.current);
    const repoStatus = getRepoStatus(repoPath);

    return NextResponse.json({
      success: true,
      action: "reset",
      branch: branchInfo.current,
      branches: branchInfo.branches,
      status,
      repoStatus,
    });
  }

  if (!branch) {
    return NextResponse.json(
      { error: "Missing branch" },
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

  // Optionally pull after checkout
  if (doPull) {
    pullBranch(repoPath);
  }

  const branchInfo = getBranchInfo(repoPath);
  const status = getBranchStatus(repoPath, branchInfo.current);

  return NextResponse.json({
    success: true,
    branch: branchInfo.current,
    branches: branchInfo.branches,
    status,
  });
}

export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { repoPath, branch } = body as {
    repoPath?: string;
    branch?: string;
  };

  if (!repoPath) {
    return NextResponse.json(
      { error: "Missing repoPath" },
      { status: 400 }
    );
  }
  if (!fs.existsSync(repoPath)) {
    return NextResponse.json(
      { error: "Repository not found" },
      { status: 404 }
    );
  }
  if (!branch) {
    return NextResponse.json(
      { error: "Missing branch" },
      { status: 400 }
    );
  }
  if (isBareGitRepository(repoPath)) {
    return NextResponse.json(
      {
        error: "This repository is a bare git repository (no working directory)",
        suggestion: "Bare repos can't be used for branch operations. Use a worktree or regular working copy instead."
      },
      { status: 400 }
    );
  }

  const result = deleteBranch(repoPath, branch);
  if (!result.success) {
    const status = result.error?.includes("current branch")
      ? 409
      : result.error?.includes("not found")
        ? 404
        : 500;
    return NextResponse.json(
      { error: result.error ?? `Failed to delete branch '${branch}'` },
      { status }
    );
  }

  const branchInfo = getBranchInfo(repoPath);

  return NextResponse.json({
    success: true,
    deletedBranch: branch,
    current: branchInfo.current,
    branches: branchInfo.branches,
  });
}
