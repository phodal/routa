/**
 * GitHub Issue Client
 *
 * REST API v3 client for reading and writing GitHub issues.
 * Supports creating, updating, listing, and syncing issues with the local store.
 */

import type { GitHubIssuePayload, KanbanStatus } from "../models/issue";

// ─── Config ──────────────────────────────────────────────────────────────────

export interface GitHubIssueClientConfig {
  owner: string;
  repo: string;
  token: string;
}

// ─── API response helpers ─────────────────────────────────────────────────────

const BASE = "https://api.github.com";

function headers(token: string): Record<string, string> {
  return {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

async function ghFetch<T>(
  url: string,
  token: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { ...headers(token), ...(options.headers ?? {}) },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GitHubIssueError(
      `GitHub API error ${res.status}: ${body}`,
      res.status
    );
  }

  return res.json() as Promise<T>;
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class GitHubIssueError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "GitHubIssueError";
  }
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class GitHubIssueClient {
  constructor(private config: GitHubIssueClientConfig) {}

  /** Fetch a single issue by number. */
  async getIssue(number: number): Promise<GitHubIssuePayload> {
    const url = `${BASE}/repos/${this.config.owner}/${this.config.repo}/issues/${number}`;
    return ghFetch<GitHubIssuePayload>(url, this.config.token);
  }

  /** List open issues with cursor-based pagination support. */
  async listIssues(options: {
    state?: "open" | "closed" | "all";
    labels?: string;
    page?: number;
    perPage?: number;
  } = {}): Promise<GitHubIssuePayload[]> {
    const params = new URLSearchParams({
      state: options.state ?? "open",
      per_page: String(options.perPage ?? 30),
      page: String(options.page ?? 1),
    });
    if (options.labels) params.set("labels", options.labels);

    const url = `${BASE}/repos/${this.config.owner}/${this.config.repo}/issues?${params}`;
    return ghFetch<GitHubIssuePayload[]>(url, this.config.token);
  }

  /** Create a new GitHub issue. */
  async createIssue(input: {
    title: string;
    body?: string;
    labels?: string[];
    assignees?: string[];
  }): Promise<GitHubIssuePayload> {
    const url = `${BASE}/repos/${this.config.owner}/${this.config.repo}/issues`;
    return ghFetch<GitHubIssuePayload>(url, this.config.token, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /** Update an existing GitHub issue. */
  async updateIssue(
    number: number,
    input: {
      title?: string;
      body?: string;
      state?: "open" | "closed";
      labels?: string[];
      assignees?: string[];
    }
  ): Promise<GitHubIssuePayload> {
    const url = `${BASE}/repos/${this.config.owner}/${this.config.repo}/issues/${number}`;
    return ghFetch<GitHubIssuePayload>(url, this.config.token, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Map a GitHub issue state to a Kanban status. */
export function githubStateToKanbanStatus(state: "open" | "closed"): KanbanStatus {
  return state === "closed" ? "done" : "todo";
}
