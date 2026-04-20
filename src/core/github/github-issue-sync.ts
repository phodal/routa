import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { basename, join, relative } from "path";

export interface GitHubIssueSyncRecord {
  number: number;
  title: string;
  body: string;
  labels: string[];
  author: string;
  state: string;
  url: string;
  createdAt: string;
  updatedAt?: string;
}

export interface SyncGitHubIssueOptions {
  dryRun?: boolean;
}

export interface SyncGitHubIssueResult {
  issueNumber: number;
  absolutePath: string;
  relativePath: string;
  created: boolean;
  updated: boolean;
  renamedFrom?: string;
}

const DEFAULT_AREA = "github";
const DEFAULT_SEVERITY = "medium";
const STATUS_BY_STATE: Record<string, string> = {
  open: "open",
  closed: "resolved",
};

export function slugifyGitHubIssueTitle(title: string, maxLength = 72): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  if (!slug) {
    return "untitled";
  }

  return slug.slice(0, maxLength).replace(/-$/g, "") || "untitled";
}

export function getGitHubIssueCreatedDate(createdAt: string): string {
  return createdAt.slice(0, 10);
}

export function inferLocalIssueArea(labels: string[]): string {
  const areaLabel = labels.find((label) => label.startsWith("area:"));
  return areaLabel ? areaLabel.slice("area:".length) : DEFAULT_AREA;
}

export function inferLocalIssueSeverity(labels: string[]): string {
  if (labels.includes("bug")) {
    return "high";
  }
  if (labels.includes("enhancement") || labels.includes("feature")) {
    return "medium";
  }
  return DEFAULT_SEVERITY;
}

export function inferLocalIssueStatus(state: string): string {
  return STATUS_BY_STATE[state.toLowerCase()] ?? "investigating";
}

function quoteYamlString(value: string): string {
  return JSON.stringify(value);
}

function renderYamlArray(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function readTextFileIfExists(filePath: string): string | null {
  return existsSync(filePath) ? readFileSync(filePath, "utf-8") : null;
}

function normalizeTag(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildTags(issue: GitHubIssueSyncRecord): string[] {
  const tags = [
    "github",
    "github-sync",
    `gh-${issue.number}`,
    ...issue.labels.map(normalizeTag),
  ].filter(Boolean);

  return Array.from(new Set(tags));
}

export function getSyncedGitHubIssueFilename(issue: GitHubIssueSyncRecord): string {
  const date = getGitHubIssueCreatedDate(issue.createdAt);
  const slug = slugifyGitHubIssueTitle(issue.title);
  return `${date}-gh-${issue.number}-${slug}.md`;
}

export function findExistingSyncedGitHubIssueFile(
  issuesDir: string,
  issueNumber: number,
): string | null {
  if (!existsSync(issuesDir)) {
    return null;
  }

  const issuePattern = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-gh-${issueNumber}-.*\\.md$`);
  const match = readdirSync(issuesDir).find((entry) => issuePattern.test(entry));
  return match ? join(issuesDir, match) : null;
}

export function buildSyncedGitHubIssueDocument(issue: GitHubIssueSyncRecord): string {
  const title = `[GitHub #${issue.number}] ${issue.title}`;
  const status = inferLocalIssueStatus(issue.state);
  const severity = inferLocalIssueSeverity(issue.labels);
  const area = inferLocalIssueArea(issue.labels);
  const tags = buildTags(issue);
  const body = issue.body.trim() || "(empty)";
  const labels = issue.labels.length > 0 ? issue.labels.map((label) => `- \`${label}\``).join("\n") : "- (none)";
  const updatedAt = issue.updatedAt ?? issue.createdAt;

  return `---
title: ${quoteYamlString(title)}
date: ${quoteYamlString(getGitHubIssueCreatedDate(issue.createdAt))}
kind: github_mirror
status: ${status}
severity: ${severity}
area: ${quoteYamlString(area)}
tags: ${renderYamlArray(tags)}
reported_by: ${quoteYamlString(issue.author || "unknown")}
related_issues: ${renderYamlArray([issue.url])}
github_issue: ${issue.number}
github_state: ${quoteYamlString(issue.state)}
github_url: ${quoteYamlString(issue.url)}
---

# ${title}

## Sync Metadata

- Source: GitHub issue sync
- GitHub Issue: #${issue.number}
- URL: ${issue.url}
- State: ${issue.state}
- Author: ${issue.author || "unknown"}
- Created At: ${issue.createdAt}
- Updated At: ${updatedAt}

## Labels

${labels}

## Original GitHub Body

${body}
`;
}

export function syncGitHubIssueToDirectory(
  issuesDir: string,
  issue: GitHubIssueSyncRecord,
  options: SyncGitHubIssueOptions = {},
): SyncGitHubIssueResult {
  const filename = getSyncedGitHubIssueFilename(issue);
  const desiredPath = join(issuesDir, filename);
  const existingPath = findExistingSyncedGitHubIssueFile(issuesDir, issue.number);
  const renamedFrom = existingPath && existingPath !== desiredPath ? basename(existingPath) : undefined;
  const content = buildSyncedGitHubIssueDocument(issue);
  const previousContent = existingPath
    ? readTextFileIfExists(existingPath)
    : readTextFileIfExists(desiredPath);

  if (!options.dryRun) {
    mkdirSync(issuesDir, { recursive: true });
    if (existingPath && existingPath !== desiredPath) {
      renameSync(existingPath, desiredPath);
    }
    writeFileSync(desiredPath, content, "utf-8");
  }

  return {
    issueNumber: issue.number,
    absolutePath: desiredPath,
    relativePath: relative(process.cwd(), desiredPath),
    created: !existingPath,
    updated: previousContent !== content || !!renamedFrom,
    renamedFrom,
  };
}

export function syncGitHubIssuesToDirectory(
  issuesDir: string,
  issues: GitHubIssueSyncRecord[],
  options: SyncGitHubIssueOptions = {},
): SyncGitHubIssueResult[] {
  return issues.map((issue) => syncGitHubIssueToDirectory(issuesDir, issue, options));
}
