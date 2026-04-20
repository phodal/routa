/**
 * Next.js API route: GET /api/git/commit
 *
 * Query params:
 *  - repoPath (required)
 *  - sha      (required)
 *
 * Returns GitCommitDetail JSON.
 */

import { NextRequest, NextResponse } from "next/server";
import { isGitRepository } from "@/core/git";
import { shellQuote } from "@/core/git/git-utils";
import { getServerBridge } from "@/core/platform";
import type {
  GitCommitDetail,
  CommitFileChange,
  FileChangeKind,
} from "@/app/workspace/[workspaceId]/kanban/git-log/types";

export const dynamic = "force-dynamic";

function gitExec(command: string, cwd: string): string {
  const bridge = getServerBridge();
  return bridge.process.execSync(command, { cwd }).trimEnd();
}

// Validate SHA format to prevent injection
function isValidSha(sha: string): boolean {
  return /^[0-9a-f]{4,40}$/i.test(sha);
}

function mapStatus(statusChar: string): FileChangeKind {
  switch (statusChar) {
    case "A": return "added";
    case "D": return "deleted";
    case "R": return "renamed";
    case "C": return "copied";
    default: return "modified";
  }
}

export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("repoPath");
  const sha = request.nextUrl.searchParams.get("sha");

  if (!repoPath || !sha) {
    return NextResponse.json({ error: "repoPath and sha are required" }, { status: 400 });
  }

  if (!isValidSha(sha)) {
    return NextResponse.json({ error: "Invalid SHA format" }, { status: 400 });
  }

  if (!isGitRepository(repoPath)) {
    return NextResponse.json({ error: "Not a git repository" }, { status: 400 });
  }

  try {
    // Get commit metadata
    const commitOutput = gitExec(
      `git --no-pager show --format=%H%x1f%h%x1f%s%x1f%B%x1e%an%x1f%ae%x1f%aI%x1f%P --no-patch ${shellQuote(sha)}`,
      repoPath,
    );

    const mainParts = commitOutput.split("\u001e");
    const firstHalf = (mainParts[0] ?? "").split("\u001f");
    const secondHalf = (mainParts[1] ?? "").split("\u001f");

    const commitSha = firstHalf[0] ?? sha;
    const shortSha = firstHalf[1] ?? sha.slice(0, 7);
    const summary = firstHalf[2] ?? "";
    const message = firstHalf[3] ?? summary;
    const authorName = secondHalf[0] ?? "";
    const authorEmail = secondHalf[1] ?? "";
    const authoredAt = secondHalf[2] ?? "";
    const parents = (secondHalf[3] ?? "").split(" ").filter(Boolean);

    // Get changed files with numstat
    const nameStatusOutput = (() => {
      try {
        return gitExec(
          `git --no-pager show --format= --name-status --find-renames --find-copies ${shellQuote(sha)}`,
          repoPath,
        );
      } catch {
        return "";
      }
    })();

    const numstatOutput = (() => {
      try {
        return gitExec(
          `git --no-pager show --format= --numstat --find-renames --find-copies ${shellQuote(sha)}`,
          repoPath,
        );
      } catch {
        return "";
      }
    })();

    const nameStatusLines = nameStatusOutput.split("\n").filter(Boolean);
    const numstatLines = numstatOutput.split("\n").filter(Boolean);

    const files: CommitFileChange[] = [];

    for (let i = 0; i < nameStatusLines.length; i++) {
      const nsLine = nameStatusLines[i];
      const nsParts = nsLine.split("\t");
      const statusChar = (nsParts[0] ?? "M").charAt(0);
      const status = mapStatus(statusChar);

      let filePath: string;
      let previousPath: string | undefined;

      if (statusChar === "R" || statusChar === "C") {
        previousPath = nsParts[1];
        filePath = nsParts[2] ?? nsParts[1] ?? "";
      } else {
        filePath = nsParts[1] ?? "";
      }

      // Parse numstat for additions/deletions
      let additions = 0;
      let deletions = 0;
      if (i < numstatLines.length) {
        const numParts = numstatLines[i].split("\t");
        additions = numParts[0] === "-" ? 0 : Number.parseInt(numParts[0] ?? "0", 10);
        deletions = numParts[1] === "-" ? 0 : Number.parseInt(numParts[1] ?? "0", 10);
      }

      if (filePath) {
        files.push({ path: filePath, previousPath, status, additions, deletions });
      }
    }

    const detail: GitCommitDetail = {
      commit: {
        sha: commitSha,
        shortSha,
        message,
        summary,
        authorName,
        authorEmail,
        authoredAt,
        parents,
        refs: [],
        lane: parents.length > 1 ? 1 : 0,
      },
      files,
    };

    return NextResponse.json(detail);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
