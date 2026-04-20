/**
 * Next.js API route: GET /api/git/log
 *
 * Query params:
 *  - repoPath (required)
 *  - branches  (comma-separated, optional)
 *  - search    (optional)
 *  - limit     (default 40)
 *  - skip      (default 0)
 *
 * Returns GitLogPage JSON.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  isGitRepository,
  getCurrentBranch,
} from "@/core/git";
import { gitExec as runGit } from "@/core/utils/safe-exec";
import type { GitCommit, GitRef, GitLogPage } from "@/app/workspace/[workspaceId]/kanban/git-log/types";

export const dynamic = "force-dynamic";

const SEARCH_SCAN_LIMIT = 2000;

function gitExec(args: string[], cwd: string): string {
  return runGit(args, { cwd }).trimEnd();
}

function parseRefs(repoPath: string): GitRef[] {
  const refs: GitRef[] = [];
  const currentBranch = getCurrentBranch(repoPath);

  // Local branches
  try {
    const output = gitExec(
      ["for-each-ref", "--format=%(refname:short)%09%(objectname)", "refs/heads/"],
      repoPath,
    );
    for (const line of output.split("\n").filter(Boolean)) {
      const [name, sha] = line.split("\t");
      if (name && sha) {
        refs.push({
          name,
          kind: "local",
          commitSha: sha,
          isCurrent: name === currentBranch,
        });
      }
    }
  } catch { /* empty repo */ }

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
      const remote = slashIdx >= 0 ? fullName.slice(0, slashIdx) : "origin";
      const name = slashIdx >= 0 ? fullName.slice(slashIdx + 1) : fullName;
      refs.push({ name, kind: "remote", remote, commitSha: sha });
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
      // For annotated tags, *objectname is the dereferenced commit; for lightweight tags it's empty
      const sha = (parts[1] || parts[2]) ?? "";
      if (name && sha) {
        refs.push({ name, kind: "tag", commitSha: sha });
      }
    }
  } catch { /* no tags */ }

  return refs;
}

function buildRefMap(refs: GitRef[]): Map<string, GitRef[]> {
  const map = new Map<string, GitRef[]>();
  for (const r of refs) {
    const list = map.get(r.commitSha) ?? [];
    list.push(r);
    map.set(r.commitSha, list);
  }
  return map;
}

function buildLogCommand(
  branchesParam: string | null,
  maxCount: number | null,
): string[] {
  const parts = [
    "--no-pager",
    "log",
    "--date-order",
    "--format=%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%aI%x1f%P%x00",
  ];

  if (maxCount != null) {
    parts.push(`--max-count=${maxCount}`);
  }

  if (branchesParam) {
    const branches = branchesParam.split(",").map((b) => b.trim()).filter(Boolean);
    parts.push(...branches);
  } else {
    parts.push("--all");
  }

  return parts;
}

function matchesSearch(commit: GitCommit, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;

  return [
    commit.sha,
    commit.shortSha,
    commit.summary,
    commit.authorName,
    commit.authorEmail,
  ].some((value) => value.toLowerCase().includes(query));
}

export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("repoPath");
  if (!repoPath) {
    return NextResponse.json({ error: "repoPath is required" }, { status: 400 });
  }

  if (!isGitRepository(repoPath)) {
    return NextResponse.json({ error: "Not a git repository" }, { status: 400 });
  }

  const branchesParam = request.nextUrl.searchParams.get("branches");
  const search = request.nextUrl.searchParams.get("search") ?? "";
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 40, 200);
  const skip = Math.max(Number(request.nextUrl.searchParams.get("skip")) || 0, 0);

  try {
    const refs = parseRefs(repoPath);
    const refMap = buildRefMap(refs);

    const shouldScanForSearch = search.trim().length > 0;
    const rawOutput = (() => {
      try {
        return gitExec(
          buildLogCommand(
            branchesParam,
            shouldScanForSearch ? SEARCH_SCAN_LIMIT : skip + limit + 1,
          ),
          repoPath,
        );
      } catch {
        return "";
      }
    })();

    const parsedCommits = rawOutput
      .split("\u0000")
      .map((record) => record.trim())
      .filter(Boolean)
      .flatMap((record): GitCommit[] => {
        const [sha, shortSha, summary, authorName, authorEmail, authoredAt, parentStr = ""] = record.split("\u001f");

        if (!sha || !shortSha || !summary || !authorName || !authoredAt) {
          return [];
        }

        const parents = parentStr.split(" ").filter(Boolean);

        return [{
          sha,
          shortSha,
          message: summary,
          summary,
          authorName,
          authorEmail: authorEmail ?? "",
          authoredAt,
          parents,
          refs: refMap.get(sha) ?? [],
          lane: parents.length > 1 ? 1 : 0,
          graphEdges: parents.length > 1
            ? [{ fromLane: 1, toLane: 0, isMerge: true }, { fromLane: 1, toLane: 1 }]
            : [{ fromLane: 0, toLane: 0 }],
        }];
      });

    const filteredCommits = shouldScanForSearch
      ? parsedCommits.filter((commit) => matchesSearch(commit, search))
      : parsedCommits;

    const pageCommits = filteredCommits.slice(skip, skip + limit);
    const hasMore = skip + limit < filteredCommits.length;

    let total = filteredCommits.length;
    if (!shouldScanForSearch) {
      try {
        const countCmd = branchesParam
          ? ["rev-list", "--count", ...branchesParam.split(",").map((branch) => branch.trim()).filter(Boolean)]
          : ["rev-list", "--count", "--all"];
        const countStr = gitExec(countCmd, repoPath);
        total = Number.parseInt(countStr, 10) || total;
      } catch {
        total = filteredCommits.length;
      }
    }

    const page: GitLogPage = { commits: pageCommits, total, hasMore };
    return NextResponse.json(page);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
