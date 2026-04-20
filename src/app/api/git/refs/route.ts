/**
 * Next.js API route: GET /api/git/refs
 *
 * Query params:
 *  - repoPath (required)
 *
 * Returns GitRefsResult JSON.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  isGitRepository,
  getCurrentBranch,
} from "@/core/git";
import { gitExec as runGit } from "@/core/utils/safe-exec";
import type { GitRef, GitRefsResult } from "@/app/workspace/[workspaceId]/kanban/git-log/types";

export const dynamic = "force-dynamic";

function gitExec(args: string[], cwd: string): string {
  return runGit(args, { cwd }).trimEnd();
}

export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("repoPath");
  if (!repoPath) {
    return NextResponse.json({ error: "repoPath is required" }, { status: 400 });
  }

  if (!isGitRepository(repoPath)) {
    return NextResponse.json({ error: "Not a git repository" }, { status: 400 });
  }

  try {
    const currentBranch = getCurrentBranch(repoPath);
    const local: GitRef[] = [];
    const remote: GitRef[] = [];
    const tags: GitRef[] = [];
    let head: GitRef | null = null;

    // Local branches
    try {
      const output = gitExec(
        ["for-each-ref", "--format=%(refname:short)%09%(objectname)", "refs/heads/"],
        repoPath,
      );
      for (const line of output.split("\n").filter(Boolean)) {
        const [name, sha] = line.split("\t");
        if (name && sha) {
          const isCurrent = name === currentBranch;
          const ref: GitRef = { name, kind: "local", commitSha: sha, isCurrent };
          local.push(ref);
          if (isCurrent) {
            head = { name, kind: "head", commitSha: sha, isCurrent: true };
          }
        }
      }
    } catch { /* empty repository */ }

    // Remote branches
    try {
      const output = gitExec(
        ["for-each-ref", "--format=%(refname:short)%09%(objectname)", "refs/remotes/"],
        repoPath,
      );
      for (const line of output.split("\n").filter(Boolean)) {
        const [fullName, sha] = line.split("\t");
        if (!fullName || !sha || fullName.endsWith("/HEAD") || !fullName.includes("/")) continue;
        const slashIdx = fullName.indexOf("/");
        const remoteName = slashIdx >= 0 ? fullName.slice(0, slashIdx) : "origin";
        const name = slashIdx >= 0 ? fullName.slice(slashIdx + 1) : fullName;
        remote.push({ name, kind: "remote", remote: remoteName, commitSha: sha });
      }
    } catch { /* no remotes */ }

    // Tags
    try {
      const output = gitExec(
        ["for-each-ref", "--format=%(refname:short)%09%(*objectname)%09%(objectname)", "refs/tags/"],
        repoPath,
      );
      for (const line of output.split("\n").filter(Boolean)) {
        const parts = line.split("\t");
        const name = parts[0];
        const sha = (parts[1] || parts[2]) ?? "";
        if (name && sha) {
          tags.push({ name, kind: "tag", commitSha: sha });
        }
      }
    } catch { /* no tags */ }

    const result: GitRefsResult = { head, local, remote, tags };
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
