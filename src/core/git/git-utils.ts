/**
 * Git Utilities
 *
 * Shared utility functions for git operations in routa-js.
 * Provides helpers for repo validation, branch listing, and GitHub URL parsing.
 *
 * Uses the platform bridge for process execution and file system access,
 * enabling support across Web (Node.js), Tauri, and Electron environments.
 *
 * NOTE: The sync functions (isGitRepository, getCurrentBranch, etc.) use
 * bridge.process.execSync() which is only available on Web/Electron.
 * For Tauri, use bridge.git.* (async) instead.
 */

import * as path from "path";

import { getServerBridge } from "@/core/platform";

// ─── GitHub URL Parsing ──────────────────────────────────────────────────

const GITHUB_URL_PATTERNS = [
  /^https?:\/\/github\.com\/([^/]+)\/([^/\s#?.]+)/i,
  /^git@github\.com:([^/]+)\/([^/\s#?.]+)/i,
  /^github\.com\/([^/]+)\/([^/\s#?.]+)/i,
];

const SIMPLE_OWNER_REPO = /^([a-zA-Z0-9\-_]+)\/([a-zA-Z0-9\-_.]+)$/;

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
}

/**
 * Check if a string looks like a GitHub URL or owner/repo format.
 */
export function isGitHubUrl(url: string): boolean {
  const trimmed = url.trim();
  if (GITHUB_URL_PATTERNS.some((p) => p.test(trimmed))) return true;
  if (SIMPLE_OWNER_REPO.test(trimmed) && !trimmed.includes("\\") && !trimmed.includes(":")) return true;
  return false;
}

/**
 * Parse a GitHub URL into owner and repo.
 */
export function parseGitHubUrl(url: string): ParsedGitHubUrl | null {
  const trimmed = url.trim();

  for (const pattern of GITHUB_URL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
    }
  }

  const simpleMatch = trimmed.match(SIMPLE_OWNER_REPO);
  if (simpleMatch && !trimmed.includes("\\") && !trimmed.includes(":")) {
    return { owner: simpleMatch[1], repo: simpleMatch[2] };
  }

  return null;
}

// ─── Bridge Helper ──────────────────────────────────────────────────────

/**
 * Execute a git command synchronously via the platform bridge.
 * Falls back to bridge.process.execSync for Web/Electron.
 */
function gitExecSync(command: string, cwd: string): string {
  const bridge = getServerBridge();
  return bridge.process.execSync(command, { cwd }).trim();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function hasGitRef(repoPath: string, ref: string): boolean {
  try {
    gitExecSync(`git rev-parse --verify ${shellQuote(ref)}`, repoPath);
    return true;
  } catch {
    return false;
  }
}

function resolveBaseRef(repoPath: string, baseBranch?: string | null): string | undefined {
  const normalizedBaseBranch = baseBranch?.trim();
  const candidates = Array.from(new Set([
    normalizedBaseBranch ? `origin/${normalizedBaseBranch}` : null,
    normalizedBaseBranch ?? null,
    "origin/main",
    "main",
    "origin/master",
    "master",
  ].filter((candidate): candidate is string => Boolean(candidate))));

  return candidates.find((candidate) => hasGitRef(repoPath, candidate));
}

// ─── Git Repository Inspection ──────────────────────────────────────────

export interface RepoBranchInfo {
  current: string;
  branches: string[];
}

export type FileChangeStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "typechange"
  | "conflicted";

export interface GitFileChange {
  path: string;
  status: FileChangeStatus;
  previousPath?: string;
}

export interface RepoChanges {
  branch: string;
  status: RepoStatus;
  files: GitFileChange[];
}

export interface RepoDeliveryStatus {
  branch: string;
  baseBranch?: string;
  baseRef?: string;
  status: RepoStatus;
  commitsSinceBase: number;
  hasCommitsSinceBase: boolean;
  hasUncommittedChanges: boolean;
  remoteUrl: string | null;
  isGitHubRepo: boolean;
  canCreatePullRequest: boolean;
}

/**
 * Check if a directory is a git repository.
 */
export function isGitRepository(dir: string): boolean {
  try {
    gitExecSync("git rev-parse --git-dir", dir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current branch name.
 */
export function getCurrentBranch(repoPath: string): string | null {
  try {
    const branch = gitExecSync("git rev-parse --abbrev-ref HEAD", repoPath);
    return branch || null;
  } catch {
    return null;
  }
}

/**
 * List local branches.
 */
export function listBranches(repoPath: string): string[] {
  try {
    const output = gitExecSync("git branch --format='%(refname:short)'", repoPath);
    return output
      .split("\n")
      .map((b) => b.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Get branch info for a repo: current branch + all local branches.
 */
export function getBranchInfo(repoPath: string): RepoBranchInfo {
  return {
    current: getCurrentBranch(repoPath) ?? "unknown",
    branches: listBranches(repoPath),
  };
}

/**
 * Checkout a branch. Creates it if it doesn't exist locally.
 */
export function checkoutBranch(repoPath: string, branch: string): boolean {
  try {
    gitExecSync(`git checkout "${branch}"`, repoPath);
    return true;
  } catch {
    try {
      gitExecSync(`git checkout -b "${branch}"`, repoPath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Get short repo status summary.
 */
export interface RepoStatus {
  clean: boolean;
  ahead: number;
  behind: number;
  modified: number;
  untracked: number;
}

export function getRepoStatus(repoPath: string): RepoStatus {
  const status: RepoStatus = {
    clean: true,
    ahead: 0,
    behind: 0,
    modified: 0,
    untracked: 0,
  };

  try {
    const output = gitExecSync("git status --porcelain -uall", repoPath);
    const lines = output.split("\n").filter(Boolean);
    status.modified = lines.filter((l) => !l.startsWith("??")).length;
    status.untracked = lines.filter((l) => l.startsWith("??")).length;
    status.clean = lines.length === 0;
  } catch {
    // ignore
  }

  try {
    const aheadBehind = gitExecSync("git rev-list --left-right --count HEAD...@{upstream}", repoPath);
    const [ahead, behind] = aheadBehind.split(/\s+/).map(Number);
    status.ahead = ahead || 0;
    status.behind = behind || 0;
  } catch {
    // no upstream
  }

  return status;
}

function mapPorcelainStatus(code: string): FileChangeStatus {
  if (code === "??") return "untracked";
  const [indexStatus = " ", worktreeStatus = " "] = code.split("");

  if (indexStatus === "U" || worktreeStatus === "U" || code === "AA" || code === "DD") {
    return "conflicted";
  }
  if (indexStatus === "R" || worktreeStatus === "R") return "renamed";
  if (indexStatus === "C" || worktreeStatus === "C") return "copied";
  if (indexStatus === "A" || worktreeStatus === "A") return "added";
  if (indexStatus === "D" || worktreeStatus === "D") return "deleted";
  if (indexStatus === "T" || worktreeStatus === "T") return "typechange";
  return "modified";
}

export function parseGitStatusPorcelain(output: string): GitFileChange[] {
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap((line): GitFileChange[] => {
      if (line.length < 3) return [];

      const code = line.slice(0, 2);
      if (code === "!!") return [];

      const rawPath = line.slice(3).trim();
      const status = mapPorcelainStatus(code);

      if ((status === "renamed" || status === "copied") && rawPath.includes(" -> ")) {
        const [previousPath, nextPath] = rawPath.split(" -> ");
        if (previousPath && nextPath) {
          return [{ path: nextPath, previousPath, status }];
        }
      }

      return [{ path: rawPath, status }];
    });
}

export function getRepoChanges(repoPath: string): RepoChanges {
  const branch = getCurrentBranch(repoPath) ?? "unknown";
  const status = getRepoStatus(repoPath);

  try {
    const output = gitExecSync("git status --porcelain -uall", repoPath);
    return {
      branch,
      status,
      files: parseGitStatusPorcelain(output),
    };
  } catch {
    return {
      branch,
      status,
      files: [],
    };
  }
}

export function getRepoDeliveryStatus(
  repoPath: string,
  options?: {
    baseBranch?: string | null;
    sourceType?: "local" | "github";
    sourceUrl?: string | null;
  },
): RepoDeliveryStatus {
  const branch = getCurrentBranch(repoPath) ?? "unknown";
  const status = getRepoStatus(repoPath);
  const remoteUrl = getRemoteUrl(repoPath);
  const baseRef = resolveBaseRef(repoPath, options?.baseBranch);
  const normalizedBaseBranch = options?.baseBranch?.trim() || baseRef?.replace(/^origin\//, "");
  let commitsSinceBase = status.ahead;

  if (baseRef) {
    try {
      commitsSinceBase = Number.parseInt(
        gitExecSync(`git rev-list --count ${shellQuote(baseRef)}..HEAD`, repoPath),
        10,
      ) || 0;
    } catch {
      commitsSinceBase = status.ahead;
    }
  }

  const hasUncommittedChanges = !status.clean || status.modified > 0 || status.untracked > 0;
  const isGitHubRepo = options?.sourceType === "github"
    || Boolean(options?.sourceUrl && isGitHubUrl(options.sourceUrl))
    || Boolean(remoteUrl && isGitHubUrl(remoteUrl));
  const hasCommitsSinceBase = commitsSinceBase > 0;
  const canCreatePullRequest = isGitHubRepo
    && hasCommitsSinceBase
    && !hasUncommittedChanges
    && Boolean(branch)
    && Boolean(normalizedBaseBranch)
    && branch !== normalizedBaseBranch;

  return {
    branch,
    baseBranch: normalizedBaseBranch,
    baseRef,
    status,
    commitsSinceBase,
    hasCommitsSinceBase,
    hasUncommittedChanges,
    remoteUrl,
    isGitHubRepo,
    canCreatePullRequest,
  };
}

// ─── Repo Directory Helpers ─────────────────────────────────────────────

const CLONE_BASE_DIR = ".routa/repos";

/**
 * Get the base directory for cloned repos.
 * On serverless environments (Vercel), uses /tmp since the deployment is read-only.
 */
export function getCloneBaseDir(): string {
  const pathMod = require("path");
  const os = require("os");

  // Check if we're in a serverless environment (Vercel sets VERCEL env var)
  const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;

  if (isServerless) {
    // On serverless, use /tmp which is the only writable location
    // Note: This is ephemeral and won't persist across invocations
    return pathMod.join(os.tmpdir(), CLONE_BASE_DIR);
  }

  // On local/traditional servers, use the current directory
  const bridge = getServerBridge();
  return pathMod.join(bridge.env.currentDir(), CLONE_BASE_DIR);
}

/**
 * Convert owner/repo to directory name.
 */
export function repoToDirName(owner: string, repo: string): string {
  return `${owner}--${repo}`;
}

/**
 * Convert directory name back to owner/repo.
 */
export function dirNameToRepo(dirName: string): string {
  const parts = dirName.split("--");
  return parts.length === 2 ? `${parts[0]}/${parts[1]}` : dirName;
}

export interface ClonedRepoInfo {
  name: string;
  path: string;
  dirName: string;
  branch: string;
  branches: string[];
  status: RepoStatus;
}

/**
 * List all cloned repos with their branch/status info.
 */
export function listClonedRepos(): ClonedRepoInfo[] {
  const pathMod = require("path");
  const bridge = getServerBridge();
  const baseDir = getCloneBaseDir();
  if (!bridge.fs.existsSync(baseDir)) return [];

  const entries = bridge.fs.readDirSync(baseDir);
  return entries
    .filter((e) => e.isDirectory)
    .map((e) => {
      const fullPath = pathMod.join(baseDir, e.name);
      const branchInfo = getBranchInfo(fullPath);
      const repoStatus = getRepoStatus(fullPath);
      return {
        name: dirNameToRepo(e.name),
        path: fullPath,
        dirName: e.name,
        branch: branchInfo.current,
        branches: branchInfo.branches,
        status: repoStatus,
      };
    });
}

// ─── Remote Branches ────────────────────────────────────────────────────

/**
 * List remote branches (requires fetch first).
 */
export function listRemoteBranches(repoPath: string): string[] {
  try {
    const output = gitExecSync("git branch -r --format='%(refname:short)'", repoPath);
    return output
      .split("\n")
      .map((b) => b.trim().replace(/^'|'$/g, ""))
      .filter(Boolean)
      .filter((b) => !b.includes("HEAD"))
      .map((b) => b.replace(/^origin\//, ""));
  } catch {
    return [];
  }
}

/**
 * Fetch remote branches from origin.
 */
export function fetchRemote(repoPath: string): boolean {
  try {
    gitExecSync("git fetch --all --prune", repoPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get branch status: commits ahead/behind upstream.
 */
export interface BranchStatus {
  ahead: number;
  behind: number;
  hasUncommittedChanges: boolean;
}

export function getBranchStatus(
  repoPath: string,
  branch: string
): BranchStatus {
  const result: BranchStatus = {
    ahead: 0,
    behind: 0,
    hasUncommittedChanges: false,
  };

  try {
    const aheadBehind = gitExecSync(
      `git rev-list --left-right --count ${branch}...origin/${branch}`,
      repoPath
    );
    const [ahead, behind] = aheadBehind.split(/\s+/).map(Number);
    result.ahead = ahead || 0;
    result.behind = behind || 0;
  } catch {
    // no upstream or branch doesn't exist on remote
  }

  try {
    const status = gitExecSync("git status --porcelain -uall", repoPath);
    result.hasUncommittedChanges = status.trim().length > 0;
  } catch {
    // ignore
  }

  return result;
}

/**
 * Pull latest changes for the current branch.
 */
export function pullBranch(repoPath: string): { success: boolean; error?: string } {
  try {
    gitExecSync("git pull --ff-only", repoPath);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Pull failed",
    };
  }
}

/**
 * Reset tracked and untracked local changes to match HEAD.
 */
export function resetLocalChanges(repoPath: string): { success: boolean; error?: string } {
  try {
    gitExecSync("git reset --hard HEAD", repoPath);
    gitExecSync("git clean -fd", repoPath);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Reset failed",
    };
  }
}

/**
 * Get the remote URL for the repo.
 */
export function getRemoteUrl(repoPath: string): string | null {
  try {
    return gitExecSync("git remote get-url origin", repoPath) || null;
  } catch {
    return null;
  }
}

// ─── Branch Validation (consistent with intent-source) ──────────────────

export interface BranchValidationResult {
  valid: boolean;
  error?: string;
  suggestion?: string;
}

/**
 * Validate a branch name.
 */
export function validateBranchName(branch: string): BranchValidationResult {
  if (!branch || branch.trim().length === 0) {
    return { valid: false, error: "Branch name is required" };
  }

  const trimmed = branch.trim();

  // Invalid characters
  const invalidChars = /[\s~^:?*[\]\\]/;
  if (invalidChars.test(trimmed)) {
    return {
      valid: false,
      error: "Branch name contains invalid characters",
      suggestion: "Use only letters, numbers, hyphens, underscores, and forward slashes",
    };
  }

  // Reserved names
  if (["HEAD", ".", ".."].includes(trimmed)) {
    return { valid: false, error: "Branch name is reserved" };
  }

  // Consecutive dots or slashes
  if (trimmed.includes("..") || trimmed.includes("//")) {
    return { valid: false, error: "Branch name cannot contain consecutive dots or slashes" };
  }

  // Starts or ends with slash
  if (trimmed.startsWith("/") || trimmed.endsWith("/")) {
    return { valid: false, error: "Branch name cannot start or end with a slash" };
  }

  // Ends with .lock
  if (trimmed.endsWith(".lock")) {
    return { valid: false, error: "Branch name cannot end with .lock" };
  }

  return { valid: true };
}

/**
 * Sanitize a branch name to make it valid.
 */
export function sanitizeBranchName(branch: string): string {
  return branch
    .trim()
    .replace(/[\s~^:?*[\]\\]/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/|\/$/g, "")
    .replace(/\.lock$/, "")
    .replace(/-{2,}/g, "-")
    .toLowerCase();
}

// ─── Workspace Validation ───────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  error?: string;
  suggestion?: string;
  warning?: string;
  isGitHub?: boolean;
  parsed?: ParsedGitHubUrl;
}

/**
 * Expand `~` and resolve relative local repo paths against the current cwd.
 */
export function normalizeLocalRepoPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  const bridge = getServerBridge();
  const homeDir = bridge.env.homeDir();

  if (trimmed === "~") {
    return homeDir;
  }

  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    const suffix = trimmed.slice(2);
    return path.join(homeDir, suffix);
  }

  if (path.isAbsolute(trimmed)) {
    return path.normalize(trimmed);
  }

  return path.resolve(bridge.env.currentDir(), trimmed);
}

/**
 * Validate a repository path or GitHub URL.
 */
export function validateRepoInput(input: string): ValidationResult {
  if (!input || input.trim().length === 0) {
    return {
      valid: false,
      error: "Repository path or URL is required",
      suggestion: "Enter a GitHub URL (e.g. https://github.com/owner/repo) or owner/repo",
    };
  }

  const trimmed = input.trim();

  // Check if it's a GitHub URL
  if (isGitHubUrl(trimmed)) {
    const parsed = parseGitHubUrl(trimmed);
    if (!parsed) {
      return {
        valid: false,
        error: "Invalid GitHub URL format",
        suggestion: "Use format: https://github.com/owner/repo or owner/repo",
      };
    }
    return {
      valid: true,
      isGitHub: true,
      parsed,
    };
  }

  // Local path
  const normalizedPath = normalizeLocalRepoPath(trimmed);
  const bridge = getServerBridge();
  if (bridge.fs.existsSync(normalizedPath)) {
    if (isGitRepository(normalizedPath)) {
      return { valid: true };
    }
    return {
      valid: false,
      error: "Directory exists but is not a git repository",
      suggestion: "Initialize a git repository first or choose a different directory",
    };
  }

  return {
    valid: false,
    error: "Path not found and not a recognized GitHub URL",
    suggestion: "Enter a GitHub URL or an existing local path",
  };
}
