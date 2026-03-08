import { parseGitHubUrl } from "../git/git-utils";

export interface GitHubIssuePayload {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
  state?: "open" | "closed";
}

export interface GitHubIssueRef {
  id: string;
  number: number;
  url: string;
  state: string;
  repo: string;
}

function getGitHubToken(): string | undefined {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
}

function getHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "routa-js-kanban",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export function parseGitHubRepo(sourceUrl?: string): string | undefined {
  if (!sourceUrl) return undefined;
  const parsed = parseGitHubUrl(sourceUrl);
  return parsed ? `${parsed.owner}/${parsed.repo}` : undefined;
}

export async function createGitHubIssue(repo: string, payload: GitHubIssuePayload): Promise<GitHubIssueRef> {
  const token = getGitHubToken();
  if (!token) {
    throw new Error("GITHUB_TOKEN is not configured.");
  }

  const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: getHeaders(token),
    body: JSON.stringify({
      title: payload.title,
      body: payload.body,
      labels: payload.labels,
      assignees: payload.assignees,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub issue create failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as { id: number; number: number; html_url: string; state: string };
  return {
    id: String(data.id),
    number: data.number,
    url: data.html_url,
    state: data.state,
    repo,
  };
}

export async function updateGitHubIssue(repo: string, issueNumber: number, payload: GitHubIssuePayload): Promise<void> {
  const token = getGitHubToken();
  if (!token) {
    throw new Error("GITHUB_TOKEN is not configured.");
  }

  const response = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    headers: getHeaders(token),
    body: JSON.stringify({
      title: payload.title,
      body: payload.body,
      labels: payload.labels,
      assignees: payload.assignees,
      state: payload.state,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub issue update failed: ${response.status} ${await response.text()}`);
  }
}