import { getServerBridge } from "@/core/platform";
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

export interface GitHubIssueListItem {
  id: string;
  number: number;
  title: string;
  body?: string;
  url: string;
  state: "open" | "closed";
  labels: string[];
  assignees: string[];
  updatedAt?: string;
}

function getGitHubToken(): string | undefined {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
}

function getHeaders(token?: string) {
  return {
    ...(token ? { Authorization: `token ${token}` } : {}),
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "routa-js-kanban",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function fetchGitHub(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("GitHub request timed out", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseGitHubRepo(sourceUrl?: string): string | undefined {
  if (!sourceUrl) return undefined;
  const parsed = parseGitHubUrl(sourceUrl);
  return parsed ? `${parsed.owner}/${parsed.repo}` : undefined;
}

function resolveGitHubRepoFromRemote(repoPath?: string): string | undefined {
  if (!repoPath) return undefined;

  try {
    const remote = getServerBridge()
      .process
      .execSync("git config --get remote.origin.url", { cwd: repoPath })
      .trim();
    const parsed = parseGitHubUrl(remote);
    return parsed ? `${parsed.owner}/${parsed.repo}` : undefined;
  } catch {
    return undefined;
  }
}

export function resolveGitHubRepo(sourceUrl?: string, repoPath?: string): string | undefined {
  return parseGitHubRepo(sourceUrl) ?? resolveGitHubRepoFromRemote(repoPath);
}

export function buildTaskGitHubIssueBody(objective: string, testCases?: string[]): string {
  const sections: string[] = [];
  const normalizedObjective = objective.trim();
  const normalizedTestCases = (testCases ?? [])
    .map((value) => value.trim())
    .filter(Boolean);

  if (normalizedObjective) {
    sections.push(normalizedObjective);
  }

  if (normalizedTestCases.length > 0) {
    sections.push([
      "## Test Cases",
      ...normalizedTestCases.map((value) => `- ${value}`),
    ].join("\n"));
  }

  return sections.join("\n\n");
}

export async function listGitHubIssues(
  repo: string,
  options?: { state?: "open" | "closed" | "all"; perPage?: number },
): Promise<GitHubIssueListItem[]> {
  const token = getGitHubToken();
  const state = options?.state ?? "open";
  const perPage = Math.max(1, Math.min(options?.perPage ?? 50, 100));

  const searchParams = new URLSearchParams({
    state,
    sort: "updated",
    direction: "desc",
    per_page: String(perPage),
  });

  const response = await fetchGitHub(`https://api.github.com/repos/${repo}/issues?${searchParams.toString()}`, {
    method: "GET",
    headers: getHeaders(token),
  });

  if (!response.ok) {
    throw new Error(`GitHub issue list failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as Array<{
    id: number;
    number: number;
    title: string;
    body?: string | null;
    html_url: string;
    state: "open" | "closed";
    updated_at?: string;
    labels?: Array<{ name?: string | null }>;
    assignees?: Array<{ login?: string | null }>;
    pull_request?: unknown;
  }>;

  return data
    .filter((item) => !item.pull_request)
    .map((item) => ({
      id: String(item.id),
      number: item.number,
      title: item.title,
      body: item.body ?? undefined,
      url: item.html_url,
      state: item.state,
      labels: (item.labels ?? [])
        .map((label) => label.name?.trim())
        .filter((label): label is string => Boolean(label)),
      assignees: (item.assignees ?? [])
        .map((assignee) => assignee.login?.trim())
        .filter((assignee): assignee is string => Boolean(assignee)),
      updatedAt: item.updated_at,
    }));
}

export async function createGitHubIssue(repo: string, payload: GitHubIssuePayload): Promise<GitHubIssueRef> {
  const token = getGitHubToken();
  if (!token) {
    throw new Error("GITHUB_TOKEN is not configured.");
  }

  const response = await fetchGitHub(`https://api.github.com/repos/${repo}/issues`, {
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

  const response = await fetchGitHub(`https://api.github.com/repos/${repo}/issues/${issueNumber}`, {
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
