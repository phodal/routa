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

const SPEC_STATUSES = ["open", "investigating", "resolved", "wontfix"] as const;

type SpecStatus = typeof SPEC_STATUSES[number];

type SpecIssue = {
  filename: string;
  title: string;
  date: string;
  kind: string;
  status: SpecStatus;
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

function normalizeScalar(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeScalar(item)).filter(Boolean);
}

function toNullableString(value: unknown): string | null {
  const normalized = normalizeScalar(value);
  return normalized.length > 0 ? normalized : null;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/u.test(value.trim())) {
    return Number(value);
  }

  return null;
}

function normalizeStatus(value: unknown): SpecStatus {
  const normalized = normalizeScalar(value).toLowerCase();
  if (normalized === "closed") return "resolved";
  return SPEC_STATUSES.includes(normalized as SpecStatus) ? normalized as SpecStatus : "open";
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
      if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
        continue;
      }

      const { data, content } = matter(raw);
      const title = normalizeScalar(data.title) || entry.name.replace(/\.md$/, "");
      const kind = normalizeScalar(data.kind).toLowerCase() || "issue";
      const severity = normalizeScalar(data.severity).toLowerCase() || "medium";

      issues.push({
        filename: entry.name,
        title,
        date: normalizeScalar(data.date),
        kind,
        status: normalizeStatus(data.status),
        severity,
        area: normalizeScalar(data.area),
        tags: toStringArray(data.tags),
        reportedBy: normalizeScalar(data.reported_by),
        relatedIssues: toStringArray(data.related_issues),
        githubIssue: toNullableNumber(data.github_issue),
        githubState: toNullableString(data.github_state),
        githubUrl: toNullableString(data.github_url),
        body: content.trim(),
      });
    } catch {
      // skip malformed files
    }
  }

  return NextResponse.json({ issues, repoRoot });
}
