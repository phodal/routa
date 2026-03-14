import { ghExec } from "@/core/utils/safe-exec";

import type { GitHubIssueSyncRecord } from "./github-issue-sync";

interface GitHubIssueApiLabel {
  name?: string | null;
}

interface GitHubIssueApiUser {
  login?: string | null;
}

interface GitHubIssueApiPayload {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  html_url: string;
  created_at: string;
  updated_at?: string;
  user?: GitHubIssueApiUser | null;
  labels?: GitHubIssueApiLabel[] | null;
  pull_request?: object;
}

export interface FetchGitHubIssuesViaGhOptions {
  repo?: string;
  state?: "open" | "closed" | "all";
  limit?: number;
}

function normalizeIssue(payload: GitHubIssueApiPayload): GitHubIssueSyncRecord {
  return {
    number: payload.number,
    title: payload.title,
    body: payload.body ?? "",
    state: payload.state,
    url: payload.html_url,
    createdAt: payload.created_at,
    updatedAt: payload.updated_at,
    author: payload.user?.login ?? "unknown",
    labels: payload.labels?.map((label) => label.name).filter((label): label is string => Boolean(label)) ?? [],
  };
}

export function resolveGitHubRepo(repo?: string): string {
  if (repo) {
    return repo;
  }

  if (process.env.GITHUB_REPOSITORY) {
    return process.env.GITHUB_REPOSITORY;
  }

  return ghExec(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], {
    cwd: process.cwd(),
  }).trim();
}

export function fetchGitHubIssueViaGh(issueNumber: number, repo?: string): GitHubIssueSyncRecord {
  const resolvedRepo = resolveGitHubRepo(repo);
  const output = ghExec([
    "api",
    `repos/${resolvedRepo}/issues/${issueNumber}`,
  ], { cwd: process.cwd() });

  return normalizeIssue(JSON.parse(output) as GitHubIssueApiPayload);
}

export function fetchGitHubIssuesViaGh(options: FetchGitHubIssuesViaGhOptions = {}): GitHubIssueSyncRecord[] {
  const resolvedRepo = resolveGitHubRepo(options.repo);
  const state = options.state ?? "all";
  const limit = options.limit;
  const issues: GitHubIssueSyncRecord[] = [];

  for (let page = 1; ; page += 1) {
  const output = ghExec([
    "api",
    "--method",
    "GET",
    `repos/${resolvedRepo}/issues`,
    "-f",
    `state=${state}`,
      "-f",
      "per_page=100",
      "-f",
      `page=${page}`,
    ], { cwd: process.cwd() });

    const pageItems = (JSON.parse(output) as GitHubIssueApiPayload[])
      .filter((item) => !item.pull_request)
      .map(normalizeIssue);

    if (pageItems.length === 0) {
      break;
    }

    issues.push(...pageItems);
    if (limit !== undefined && issues.length >= limit) {
      return issues.slice(0, limit);
    }
  }

  return issues;
}
