import { promises as fsp } from "fs";
import matter from "gray-matter";
import * as path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  type FitnessContext,
  isFitnessContextError,
  normalizeFitnessContextValue,
  resolveFitnessRepoRoot,
} from "@/core/fitness/repo-root";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SpecIssue = {
  filename: string;
  title: string;
  date: string;
  kind: string;
  status: string;
  severity: string;
  area: string;
  tags: string[];
  reportedBy: string;
  relatedIssues: string[];
  githubIssue: number | null;
  githubState: string | null;
  githubUrl: string | null;
  body: string;
};

function parseContext(searchParams: URLSearchParams): FitnessContext {
  return {
    workspaceId: normalizeFitnessContextValue(searchParams.get("workspaceId")),
    codebaseId: normalizeFitnessContextValue(searchParams.get("codebaseId")),
    repoPath: normalizeFitnessContextValue(searchParams.get("repoPath")),
  };
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

export async function GET(request: NextRequest) {
  const context = parseContext(request.nextUrl.searchParams);

  let repoRoot: string;
  try {
    repoRoot = await resolveFitnessRepoRoot(context, {
      preferCurrentRepoForDefaultWorkspace: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isFitnessContextError(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const issuesDir = path.join(repoRoot, "docs", "issues");
  try {
    await fsp.access(issuesDir);
  } catch {
    return NextResponse.json({ issues: [], repoRoot });
  }

  const entries = await fsp.readdir(issuesDir, { withFileTypes: true });
  const mdFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "_template.md")
    .sort((a, b) => b.name.localeCompare(a.name));

  const issues: SpecIssue[] = [];

  for (const entry of mdFiles) {
    const fullPath = path.join(issuesDir, entry.name);
    try {
      const raw = await fsp.readFile(fullPath, "utf-8");
      const { data, content } = matter(raw);

      issues.push({
        filename: entry.name,
        title: typeof data.title === "string" ? data.title : entry.name.replace(/\.md$/, ""),
        date: typeof data.date === "string" ? data.date : "",
        kind: typeof data.kind === "string" ? data.kind : "issue",
        status: typeof data.status === "string" ? data.status : "open",
        severity: typeof data.severity === "string" ? data.severity : "medium",
        area: typeof data.area === "string" ? data.area : "",
        tags: toStringArray(data.tags),
        reportedBy: typeof data.reported_by === "string" ? data.reported_by : "",
        relatedIssues: toStringArray(data.related_issues),
        githubIssue: typeof data.github_issue === "number" ? data.github_issue : null,
        githubState: typeof data.github_state === "string" ? data.github_state : null,
        githubUrl: typeof data.github_url === "string" ? data.github_url : null,
        body: content.trim(),
      });
    } catch {
      // skip malformed files
    }
  }

  return NextResponse.json({ issues, repoRoot });
}
