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

export interface GitHubPRListItem {
  id: string;
  number: number;
  title: string;
  body?: string;
  url: string;
  state: "open" | "closed";
  labels: string[];
  assignees: string[];
  updatedAt?: string;
  draft: boolean;
  mergedAt?: string;
  headRef: string;
  baseRef: string;
}

export interface GitHubIssueComment {
  id: string;
  body: string;
  url: string;
  userLogin?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface GitHubIssueCommentRef {
  id: string;
  url: string;
}

export type GitHubAccessSource = "board" | "env" | "gh" | "none";

interface GitHubAccessOptions {
  boardToken?: string;
}

interface ResolvedGitHubAccess {
  available: boolean;
  source: GitHubAccessSource;
  token?: string;
}

function resolveGitHubAccess(options?: GitHubAccessOptions): ResolvedGitHubAccess {
  const boardToken = options?.boardToken?.trim();
  if (boardToken) {
    return {
      available: true,
      source: "board",
      token: boardToken,
    };
  }

  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (envToken) {
    return {
      available: true,
      source: "env",
      token: envToken,
    };
  }

  try {
    const token = getServerBridge()
      .process
      .execSync("gh auth token")
      .trim();
    if (token) {
      return {
        available: true,
        source: "gh",
        token,
      };
    }
  } catch {
    // Ignore gh CLI lookup failures; callers only need the availability status.
  }

  return {
    available: false,
    source: "none",
  };
}

function getGitHubToken(options?: GitHubAccessOptions): string | undefined {
  return resolveGitHubAccess(options).token;
}

export function getGitHubAccessStatus(options?: GitHubAccessOptions): {
  available: boolean;
  source: GitHubAccessSource;
} {
  const access = resolveGitHubAccess(options);
  return {
    available: access.available,
    source: access.source,
  };
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
  options?: { state?: "open" | "closed" | "all"; perPage?: number; token?: string },
): Promise<GitHubIssueListItem[]> {
  const token = options?.token?.trim() || getGitHubToken();
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

export async function listGitHubPulls(
  repo: string,
  options?: { state?: "open" | "closed" | "all"; perPage?: number; token?: string },
): Promise<GitHubPRListItem[]> {
  const token = options?.token?.trim() || getGitHubToken();
  const state = options?.state ?? "open";
  const perPage = Math.max(1, Math.min(options?.perPage ?? 50, 100));

  const searchParams = new URLSearchParams({
    state,
    sort: "updated",
    direction: "desc",
    per_page: String(perPage),
  });

  const response = await fetchGitHub(`https://api.github.com/repos/${repo}/pulls?${searchParams.toString()}`, {
    method: "GET",
    headers: getHeaders(token),
  });

  if (!response.ok) {
    throw new Error(`GitHub pull request list failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as Array<{
    id: number;
    number: number;
    title: string;
    body?: string | null;
    html_url: string;
    state: "open" | "closed";
    updated_at?: string;
    merged_at?: string | null;
    draft?: boolean;
    labels?: Array<{ name?: string | null }>;
    assignees?: Array<{ login?: string | null }>;
    head?: { ref?: string };
    base?: { ref?: string };
  }>;

  return data.map((item) => ({
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
    draft: item.draft ?? false,
    mergedAt: item.merged_at ?? undefined,
    headRef: item.head?.ref ?? "",
    baseRef: item.base?.ref ?? "",
  }));
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

export async function listGitHubIssueComments(
  repo: string,
  issueNumber: number,
  options?: { perPage?: number; token?: string },
): Promise<GitHubIssueComment[]> {
  const token = options?.token?.trim() || getGitHubToken();
  const perPage = Math.max(1, Math.min(options?.perPage ?? 100, 100));

  const response = await fetchGitHub(
    `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments?per_page=${perPage}`,
    {
      method: "GET",
      headers: getHeaders(token),
    },
  );

  if (!response.ok) {
    throw new Error(`GitHub issue comment list failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as Array<{
    id: number;
    body?: string | null;
    html_url: string;
    created_at?: string;
    updated_at?: string;
    user?: { login?: string | null } | null;
  }>;

  return data.map((item) => ({
    id: String(item.id),
    body: item.body ?? "",
    url: item.html_url,
    userLogin: item.user?.login ?? undefined,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }));
}

export async function createGitHubIssueComment(
  repo: string,
  issueNumber: number,
  body: string,
): Promise<GitHubIssueCommentRef> {
  const token = getGitHubToken();
  if (!token) {
    throw new Error("GITHUB_TOKEN is not configured.");
  }

  const response = await fetchGitHub(`https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: getHeaders(token),
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    throw new Error(`GitHub issue comment create failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as { id: number; html_url: string };
  return {
    id: String(data.id),
    url: data.html_url,
  };
}

export async function updateGitHubIssueComment(
  repo: string,
  commentId: string,
  body: string,
): Promise<GitHubIssueCommentRef> {
  const token = getGitHubToken();
  if (!token) {
    throw new Error("GITHUB_TOKEN is not configured.");
  }

  const response = await fetchGitHub(`https://api.github.com/repos/${repo}/issues/comments/${commentId}`, {
    method: "PATCH",
    headers: getHeaders(token),
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    throw new Error(`GitHub issue comment update failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as { id: number; html_url: string };
  return {
    id: String(data.id),
    url: data.html_url,
  };
}
