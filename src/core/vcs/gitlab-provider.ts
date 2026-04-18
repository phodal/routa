/**
 * GitLab VCS Provider
 *
 * Adapter for GitLab REST API v4.
 * Supports both gitlab.com and self-hosted GitLab instances.
 */

import type {
  IVCSProvider,
  VCSPlatform,
  VCSRepository,
  VCSPullRequest,
  VCSBranch,
  VCSComment,
  VCSFileChange,
} from "./vcs-provider";

export class GitLabProvider implements IVCSProvider {
  readonly platform: VCSPlatform = "gitlab";

  /** Get GitLab API base URL from environment or use default */
  private getApiBaseUrl(): string {
    const customUrl = process.env.GITLAB_URL?.replace(/\/$/, ""); // Remove trailing slash
    return customUrl ? `${customUrl}/api/v4` : "https://gitlab.com/api/v4";
  }

  /** Get authorization header */
  private getAuthHeader(token?: string): string {
    const actualToken = token ?? process.env.GITLAB_TOKEN;
    if (!actualToken) {
      throw new Error("GitLab token is required. Set GITLAB_TOKEN environment variable.");
    }
    return `Bearer ${actualToken}`;
  }

  /** Parse repo string to project path (GitLab uses "owner%2Frepo" encoding) */
  private encodeProjectPath(repo: string): string {
    return repo.replace(/\//g, "%2F");
  }

  /** Make a GitLab API request */
  private async gitlabApi<T>(
    endpoint: string,
    options: {
      method?: string;
      token?: string;
      body?: unknown;
    } = {}
  ): Promise<T> {
    const { method = "GET", token, body } = options;
    const url = `${this.getApiBaseUrl()}${endpoint}`;

    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(token),
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitLab API error ${response.status}: ${errorBody}`);
    }

    return response.json() as Promise<T>;
  }

  async getRepo(opts: { repo: string; token?: string }): Promise<VCSRepository> {
    const encodedPath = this.encodeProjectPath(opts.repo);
    const data = await this.gitlabApi<{
      path_with_namespace: string;
      web_url: string;
      http_url_to_repo: string;
      default_branch: string | null;
      repository: { visibility: string };
    }>(`/projects/${encodedPath}`, { token: opts.token });

    return {
      full_name: data.path_with_namespace,
      html_url: data.web_url,
      clone_url: data.http_url_to_repo,
      default_branch: data.default_branch ?? "main",
      private: data.repository.visibility !== "public",
    };
  }

  async listBranches(opts: { repo: string; token?: string }): Promise<VCSBranch[]> {
    const encodedPath = this.encodeProjectPath(opts.repo);
    const data = await this.gitlabApi<Array<{
      name: string;
      commit: { id: string };
      protected: boolean;
    }>>(`/projects/${encodedPath}/repository/branches`, { token: opts.token });

    return data.map((branch) => ({
      name: branch.name,
      commit: { sha: branch.commit.id },
      protected: branch.protected,
    }));
  }

  async getPR(opts: { repo: string; prNumber: number; token?: string }): Promise<VCSPullRequest> {
    const encodedPath = this.encodeProjectPath(opts.repo);
    const data = await this.gitlabApi<{
      iid: number;
      title: string;
      description: string | undefined;
      web_url: string;
      state: string;
      draft: boolean;
      merged_at: string | null;
      source_branch: string;
      target_branch: string;
      source_project_id: number;
      author: { username: string };
      created_at: string;
      updated_at: string;
      sha: string;
      diff_refs: { head_sha: string };
    }>(`/projects/${encodedPath}/merge_requests/${opts.prNumber}`, { token: opts.token });

    return {
      number: data.iid,
      title: data.title,
      body: data.description,
      html_url: data.web_url,
      state: data.merged_at ? "merged" : data.state,
      draft: data.draft,
      merged: data.merged_at !== null,
      head: {
        ref: data.source_branch,
        sha: data.diff_refs?.head_sha ?? data.sha,
      },
      base: { ref: data.target_branch },
      user: { login: data.author.username },
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  async getPRFiles(opts: { repo: string; prNumber: number; token?: string }): Promise<VCSFileChange[]> {
    const encodedPath = this.encodeProjectPath(opts.repo);
    const data = await this.gitlabApi<Array<{
      new_path: string;
      old_path: string;
      new_file: boolean;
      renamed_file: boolean;
      deleted_file: boolean;
      diff: string;
    }>>(`/projects/${encodedPath}/merge_requests/${opts.prNumber}/changes`, { token: opts.token });

    return data.map((file) => {
      let status = "modified";
      if (file.new_file) status = "added";
      else if (file.deleted_file) status = "removed";
      else if (file.renamed_file) status = "renamed";

      return {
        filename: file.new_path,
        status,
        additions: 0, // GitLab doesn't provide this in the changes endpoint
        deletions: 0,
        changes: 0,
        patch: file.diff,
      };
    });
  }

  async createPR(opts: {
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
    token?: string;
    draft?: boolean;
  }): Promise<VCSPullRequest> {
    const encodedPath = this.encodeProjectPath(opts.repo);
    const data = await this.gitlabApi<{
      iid: number;
      title: string;
      description: string;
      web_url: string;
      state: string;
      draft: boolean;
      merged_at: string | null;
      source_branch: string;
      target_branch: string;
      author: { username: string };
      created_at: string;
      updated_at: string;
      diff_refs: { head_sha: string };
    }>(`/projects/${encodedPath}/merge_requests`, {
      method: "POST",
      token: opts.token,
      body: {
        source_branch: opts.head,
        target_branch: opts.base,
        title: opts.title,
        description: opts.body,
        draft: opts.draft ?? false,
      },
    });

    return {
      number: data.iid,
      title: data.title,
      body: data.description,
      html_url: data.web_url,
      state: data.merged_at ? "merged" : data.state,
      draft: data.draft,
      merged: data.merged_at !== null,
      head: {
        ref: data.source_branch,
        sha: data.diff_refs?.head_sha ?? "",
      },
      base: { ref: data.target_branch },
      user: { login: data.author.username },
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  async postPRComment(opts: {
    repo: string;
    prNumber: number;
    body: string;
    token?: string;
  }): Promise<VCSComment> {
    const encodedPath = this.encodeProjectPath(opts.repo);
    const data = await this.gitlabApi<{
      id: number;
      body: string;
      note: string;
      noteable_type: string;
      noteable_iid: number;
      project_id: number;
      created_at: string;
      author: { username: string };
    }>(`/projects/${encodedPath}/merge_requests/${opts.prNumber}/notes`, {
      method: "POST",
      token: opts.token,
      body: { body: opts.body },
    });

    // Build MR URL for the comment
    const mrUrl = `${this.getApiBaseUrl().replace("/api/v4", "")}/${encodedPath}/-/merge_requests/${opts.prNumber}#note_${data.id}`;

    return {
      id: data.id,
      body: data.body ?? data.note,
      html_url: mrUrl,
      user: { login: data.author.username },
      created_at: data.created_at,
    };
  }

  async postPRReview(opts: {
    repo: string;
    prNumber: number;
    body: string;
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
    token?: string;
    commitId?: string;
  }): Promise<VCSComment> {
    const encodedPath = this.encodeProjectPath(opts.repo);

    // GitLab has separate endpoints for approvals and comments
    if (opts.event === "APPROVE") {
      const data = await this.gitlabApi<{
        id: number;
        project_id: number;
        merge_request: { iid: number };
        created_at: string;
        author: { username: string };
      }>(`/projects/${encodedPath}/merge_requests/${opts.prNumber}/approve`, {
        method: "POST",
        token: opts.token,
        body: { sha: opts.commitId },
      });

      const mrUrl = `${this.getApiBaseUrl().replace("/api/v4", "")}/${encodedPath}/-/merge_requests/${opts.prNumber}`;

      return {
        id: data.id,
        body: opts.body || "Approved",
        html_url: mrUrl,
        user: { login: data.author.username },
        created_at: data.created_at,
        commit_id: opts.commitId,
      };
    } else {
      // For REQUEST_CHANGES and COMMENT, post as a regular note with emoji
      let commentBody = opts.body;
      if (opts.event === "REQUEST_CHANGES") {
        commentBody = `🚫 ${opts.body}`;
      }

      return this.postPRComment({
        repo: opts.repo,
        prNumber: opts.prNumber,
        body: commentBody,
        token: opts.token,
      });
    }
  }

  async registerWebhook(opts: {
    repo: string;
    webhookUrl: string;
    secret: string;
    events: string[];
    token?: string;
  }): Promise<{ id: number; url: string }> {
    const encodedPath = this.encodeProjectPath(opts.repo);

    // Map GitHub event types to GitLab event types
    const gitlabEvents = this.mapGitHubEventsToGitLab(opts.events);

    const data = await this.gitlabApi<{
      id: number;
      url: string;
    }>(`/projects/${encodedPath}/hooks`, {
      method: "POST",
      token: opts.token,
      body: {
        url: opts.webhookUrl,
        token: opts.secret,
        push_events: gitlabEvents.includes("push_events"),
        issues_events: gitlabEvents.includes("issues_events"),
        merge_requests_events: gitlabEvents.includes("merge_requests_events"),
        wiki_page_events: gitlabEvents.includes("wiki_page_events"),
        deployment_events: gitlabEvents.includes("deployment_events"),
        job_events: gitlabEvents.includes("job_events"),
        pipeline_events: gitlabEvents.includes("pipeline_events"),
        releases_events: gitlabEvents.includes("releases_events"),
        tag_push_events: gitlabEvents.includes("tag_push_events"),
        note_events: gitlabEvents.includes("note_events"),
        confidential_issues_events: gitlabEvents.includes("confidential_issues_events"),
        confidential_note_events: gitlabEvents.includes("confidential_note_events"),
      },
    });

    return { id: data.id, url: data.url };
  }

  async deleteWebhook(opts: {
    repo: string;
    hookId: number;
    token?: string;
  }): Promise<void> {
    const encodedPath = this.encodeProjectPath(opts.repo);
    await this.gitlabApi(`/projects/${encodedPath}/hooks/${opts.hookId}`, {
      method: "DELETE",
      token: opts.token,
    });
  }

  async listWebhooks(opts: {
    repo: string;
    token?: string;
  }): Promise<Array<{ id: number; events: string[]; active: boolean; config: { url: string } }>> {
    const encodedPath = this.encodeProjectPath(opts.repo);
    const data = await this.gitlabApi<Array<{
      id: number;
      url: string;
      push_events: boolean;
      issues_events: boolean;
      merge_requests_events: boolean;
      wiki_page_events: boolean;
      deployment_events: boolean;
      job_events: boolean;
      pipeline_events: boolean;
      releases_events: boolean;
      tag_push_events: boolean;
      note_events: boolean;
      confidential_issues_events: boolean;
      confidential_note_events: boolean;
      enabled: boolean;
    }>>(`/projects/${encodedPath}/hooks`, { token: opts.token });

    return data.map((hook) => ({
      id: hook.id,
      events: this.gitlabEventsToList(hook),
      active: hook.enabled,
      config: { url: hook.url },
    }));
  }

  /** Map GitHub event types to GitLab event types */
  private mapGitHubEventsToGitLab(events: string[]): string[] {
    const eventMap: Record<string, string> = {
      push: "push_events",
      tag_push: "tag_push_events",
      issues: "issues_events",
      issue_comment: "note_events",
      pull_request: "merge_requests_events",
      pull_request_review: "note_events",
      pull_request_review_comment: "note_events",
      workflow_run: "pipeline_events",
      check_run: "job_events",
      check_suite: "pipeline_events",
      release: "releases_events",
    };

    const gitlabEvents = new Set<string>();
    for (const event of events) {
      const mapped = eventMap[event];
      if (mapped) {
        gitlabEvents.add(mapped);
      }
    }

    return Array.from(gitlabEvents);
  }

  /** Convert GitLab webhook object to event list */
  private gitlabEventsToList(hook: {
    push_events: boolean;
    issues_events: boolean;
    merge_requests_events: boolean;
    wiki_page_events: boolean;
    deployment_events: boolean;
    job_events: boolean;
    pipeline_events: boolean;
    releases_events: boolean;
    tag_push_events: boolean;
    note_events: boolean;
    confidential_issues_events: boolean;
    confidential_note_events: boolean;
  }): string[] {
    const events: string[] = [];

    if (hook.push_events) events.push("push_events");
    if (hook.tag_push_events) events.push("tag_push_events");
    if (hook.issues_events) events.push("issues_events");
    if (hook.merge_requests_events) events.push("merge_requests_events");
    if (hook.wiki_page_events) events.push("wiki_page_events");
    if (hook.deployment_events) events.push("deployment_events");
    if (hook.job_events) events.push("job_events");
    if (hook.pipeline_events) events.push("pipeline_events");
    if (hook.releases_events) events.push("releases_events");
    if (hook.note_events) events.push("note_events");
    if (hook.confidential_issues_events) events.push("confidential_issues_events");
    if (hook.confidential_note_events) events.push("confidential_note_events");

    return events;
  }
}
