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
 * PATCH /api/clone/branches - Checkout a branch
 *   Body: { repoPath: string, branch: string }
 *   Returns: { success, branch, branches }
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
  pullBranch,
  getBranchInfo,
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
  const { repoPath, branch, pull: doPull } = body as {
    repoPath?: string;
    branch?: string;
    pull?: boolean;
  };

  if (!repoPath || !branch) {
    return NextResponse.json(
      { error: "Missing repoPath or branch" },
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
