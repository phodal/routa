/**
 * VCS Provider Interface
 *
 * Unified abstraction layer for version control system providers.
 * Supports GitHub and GitLab with a common interface.
 */

// ─── Common Types ─────────────────────────────────────────────────────────────

export type VCSPlatform = "github" | "gitlab";

export interface VCSRepository {
  full_name: string;        // "owner/repo"
  html_url: string;         // URL to the repository
  clone_url: string;        // Git clone URL
  default_branch: string;   // Default branch name
  private: boolean;         // Whether the repository is private
}

export interface VCSPullRequest {
  number: number;           // PR/MR number
  title: string;            // PR/MR title
  body?: string;            // PR/MR description
  html_url: string;         // URL to the PR/MR
  state: string;            // "open", "closed", "merged"
  draft?: boolean;          // Whether it's a draft
  merged?: boolean;         // Whether it's merged
  head: {
    ref: string;            // Source branch
    sha: string;            // Source commit SHA
  };
  base: {
    ref: string;            // Target branch
  };
  user?: {
    login: string;          // Author username
  };
  created_at?: string;      // Creation timestamp
  updated_at?: string;      // Update timestamp
}

export interface VCSBranch {
  name: string;             // Branch name
  commit: {
    sha: string;            // Commit SHA
  };
  protected: boolean;       // Whether branch is protected
}

export interface VCSComment {
  id: number;               // Comment ID
  body: string;             // Comment content
  html_url: string;         // URL to the comment
  user?: {
    login: string;          // Author username
  };
  created_at?: string;      // Creation timestamp
  commit_id?: string;       // Associated commit SHA
  path?: string;            // File path (for review comments)
  line?: number;            // Line number (for review comments)
}

export interface VCSFileChange {
  filename: string;         // File path
  status: string;           // "added", "modified", "removed", "renamed"
  additions: number;        // Lines added
  deletions: number;        // Lines removed
  changes: number;          // Total lines changed
  patch?: string;           // Diff patch
}

export interface VCSWebhookPayload {
  action?: string;          // Event action (e.g., "opened", "closed")
  pull_request?: VCSPullRequest;
  issue?: {
    number: number;
    title: string;
    body?: string;
    html_url: string;
    labels?: Array<{ name: string }>;
    user?: { login: string };
  };
  repository?: VCSRepository;
  sender?: { login: string };
  comment?: VCSComment;
  review?: {
    id: number;
    state: string;          // "approved", "changes_requested", "commented"
    body?: string;
    html_url: string;
    user?: { login: string };
    commit_id?: string;
  };
  ref?: string;             // Branch/tag reference (for create/delete events)
  ref_type?: "branch" | "tag";  // Reference type
  [key: string]: unknown;   // Additional platform-specific fields
}

// ─── Provider Interface ───────────────────────────────────────────────────────

export interface IVCSProvider {
  /** Platform identifier */
  readonly platform: VCSPlatform;

  /** Get repository information */
  getRepo(opts: { repo: string; token?: string }): Promise<VCSRepository>;

  /** List branches in a repository */
  listBranches(opts: { repo: string; token?: string }): Promise<VCSBranch[]>;

  /** Get pull/merge request details */
  getPR(opts: { repo: string; prNumber: number; token?: string }): Promise<VCSPullRequest>;

  /** Get files changed in a pull/merge request */
  getPRFiles(opts: { repo: string; prNumber: number; token?: string }): Promise<VCSFileChange[]>;

  /** Create a pull/merge request */
  createPR(opts: {
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
    token?: string;
    draft?: boolean;
  }): Promise<VCSPullRequest>;

  /** Post a comment on a pull/merge request */
  postPRComment(opts: {
    repo: string;
    prNumber: number;
    body: string;
    token?: string;
  }): Promise<VCSComment>;

  /** Post a review on a pull/merge request */
  postPRReview(opts: {
    repo: string;
    prNumber: number;
    body: string;
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
    token?: string;
    commitId?: string;
  }): Promise<VCSComment>;

  /** Register a webhook for the repository */
  registerWebhook(opts: {
    repo: string;
    webhookUrl: string;
    secret: string;
    events: string[];
    token?: string;
  }): Promise<{ id: number; url: string }>;

  /** Delete a webhook */
  deleteWebhook(opts: {
    repo: string;
    hookId: number;
    token?: string;
  }): Promise<void>;

  /** List webhooks for a repository */
  listWebhooks(opts: {
    repo: string;
    token?: string;
  }): Promise<Array<{ id: number; events: string[]; active: boolean; config: { url: string } }>>;
}

// ─── Provider Factory ─────────────────────────────────────────────────────────

let cachedProvider: IVCSProvider | null = null;

/**
 * Get the VCS provider based on environment configuration.
 * Caches the provider instance for reuse.
 */
export function getVCSProvider(): IVCSProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  const platform = (process.env.PLATFORM ?? "github").toLowerCase() as VCSPlatform;

  if (platform === "gitlab") {
    const { GitLabProvider } = require("./gitlab-provider");
    cachedProvider = new GitLabProvider();
  } else {
    const { GitHubProvider } = require("./github-provider");
    cachedProvider = new GitHubProvider();
  }

  return cachedProvider;
}

/**
 * Reset the cached provider instance.
 * Call this when platform configuration changes.
 */
export function resetVCSProvider(): void {
  cachedProvider = null;
}

/**
 * Get the current platform from environment.
 */
export function getPlatform(): VCSPlatform {
  return (process.env.PLATFORM ?? "github").toLowerCase() as VCSPlatform;
}

/**
 * Check if the current platform is GitLab.
 */
export function isGitLab(): boolean {
  return getPlatform() === "gitlab";
}

/**
 * Check if the current platform is GitHub.
 */
export function isGitHub(): boolean {
  return getPlatform() === "github";
}
