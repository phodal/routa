/**
 * Git operations for the enhanced file changes workflow
 * Provides functions for staging, unstaging, committing, and other Git operations
 */

import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { isGitRepository, shellQuote } from "./git-utils";

const exec = promisify(execCallback);

export interface GitIdentity {
  name: string;
  email: string;
  source: "local" | "global";
}

export function isSuspiciousGitIdentity(name: string, email: string): boolean {
  const normalizedName = name.trim();
  const normalizedEmail = email.trim();
  return [
    /test@example\.com/i,
    /@example\.com$/i,
    /^test$/i,
    /routa test/i,
    /placeholder/i,
  ].some((pattern) => pattern.test(normalizedName) || pattern.test(normalizedEmail));
}

async function readGitConfigValue(
  repoPath: string,
  args: string[],
): Promise<string> {
  try {
    const { stdout } = await exec(`git ${args.join(" ")}`, { cwd: repoPath });
    return stdout.trim();
  } catch {
    return "";
  }
}

export async function resolveGitIdentity(repoPath: string): Promise<GitIdentity | null> {
  const localName = await readGitConfigValue(repoPath, ["config", "--get", "user.name"]);
  const localEmail = await readGitConfigValue(repoPath, ["config", "--get", "user.email"]);
  if (localName && localEmail) {
    return { name: localName, email: localEmail, source: "local" };
  }

  const globalName = await readGitConfigValue(repoPath, ["config", "--global", "--get", "user.name"]);
  const globalEmail = await readGitConfigValue(repoPath, ["config", "--global", "--get", "user.email"]);
  if (globalName && globalEmail) {
    return { name: globalName, email: globalEmail, source: "global" };
  }

  return null;
}

export async function validateGitIdentity(repoPath: string): Promise<void> {
  const identity = await resolveGitIdentity(repoPath);

  if (!identity) {
    throw new Error(
      "Git user identity is not configured. Set repo-local or global git config before committing:\n"
      + "  git config --global user.name \"Your Name\"\n"
      + "  git config --global user.email \"your-real-email@domain.com\""
    );
  }

  if (isSuspiciousGitIdentity(identity.name, identity.email)) {
    throw new Error(
      `Git identity looks like a placeholder (${identity.name} <${identity.email}>). `
      + "Configure a real repo-local or global identity before committing."
    );
  }
}

/**
 * Execute a git command in the given repository
 */
async function gitExec(command: string, repoPath: string): Promise<string> {
  if (!isGitRepository(repoPath)) {
    throw new Error(`Not a git repository: ${repoPath}`);
  }

  try {
    const { stdout, stderr } = await exec(command, { cwd: repoPath });
    if (stderr && !stderr.includes("warning")) {
      console.warn(`Git warning in ${repoPath}:`, stderr);
    }
    return stdout.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Git operation failed: ${message}`, { cause: error });
  }
}

/**
 * Stage files in the Git index
 * @param repoPath - Path to the git repository
 * @param files - Array of file paths relative to repo root
 */
export async function stageFiles(repoPath: string, files: string[]): Promise<void> {
  if (files.length === 0) return;

  // Quote file paths to handle spaces and special characters
  const quotedFiles = files.map((f) => `"${f}"`).join(" ");
  await gitExec(`git add ${quotedFiles}`, repoPath);
}

/**
 * Unstage files from the Git index (keep working directory changes)
 * @param repoPath - Path to the git repository
 * @param files - Array of file paths relative to repo root
 */
export async function unstageFiles(repoPath: string, files: string[]): Promise<void> {
  if (files.length === 0) return;

  const quotedFiles = files.map((f) => `"${f}"`).join(" ");
  await gitExec(`git restore --staged ${quotedFiles}`, repoPath);
}

/**
 * Discard changes to files in working directory
 * WARNING: This is destructive and cannot be undone
 * @param repoPath - Path to the git repository
 * @param files - Array of file paths relative to repo root
 */
export async function discardChanges(repoPath: string, files: string[]): Promise<void> {
  if (files.length === 0) return;

  const quotedFiles = files.map((f) => `"${f}"`).join(" ");
  // First restore from index, then clean untracked files
  try {
    await gitExec(`git restore ${quotedFiles}`, repoPath);
  } catch {
    // If file is untracked, git restore will fail, try to remove it
    await gitExec(`git clean -f ${quotedFiles}`, repoPath);
  }
}

/**
 * Create a commit with the given message
 * @param repoPath - Path to the git repository
 * @param message - Commit message
 * @param files - Optional: specific files to commit (stages them first)
 * @returns The SHA of the created commit
 */
export async function createCommit(
  repoPath: string,
  message: string,
  files?: string[],
): Promise<string> {
  if (!message.trim()) {
    throw new Error("Commit message cannot be empty");
  }

  await validateGitIdentity(repoPath);

  // If specific files provided, stage them first
  if (files && files.length > 0) {
    await stageFiles(repoPath, files);
  }

  // Check if there are staged changes
  const stagedChanges = await gitExec("git diff --cached --name-only", repoPath);
  if (!stagedChanges) {
    throw new Error("No staged changes to commit");
  }

  // Create the commit
  const escapedMessage = message.replace(/"/g, '\\"');
  await gitExec(`git commit -m "${escapedMessage}"`, repoPath);

  // Get the commit SHA
  const sha = await gitExec("git rev-parse HEAD", repoPath);
  return sha;
}

/**
 * Pull commits from remote
 * @param repoPath - Path to the git repository
 * @param remote - Remote name (default: 'origin')
 * @param branch - Branch name (default: current branch)
 */
export async function pullCommits(
  repoPath: string,
  remote = "origin",
  branch?: string,
): Promise<void> {
  const quotedRemote = shellQuote(remote);
  const pullCommand = branch
    ? `git pull ${quotedRemote} ${shellQuote(branch)}`
    : `git pull ${quotedRemote}`;
  await gitExec(pullCommand, repoPath);
}

/**
 * Rebase current branch onto target branch
 * @param repoPath - Path to the git repository
 * @param onto - Target branch to rebase onto
 */
export async function rebaseBranch(repoPath: string, onto: string): Promise<void> {
  await gitExec(`git rebase ${shellQuote(onto)}`, repoPath);
}

/**
 * Safe rebase that detects conflicts and auto-aborts, leaving the repo clean.
 * Returns conflict file list on failure for caller to report.
 */
export async function rebaseBranchSafe(
  repoPath: string,
  onto: string,
): Promise<{ success: boolean; conflictFiles?: string[] }> {
  try {
    await gitExec(`git rebase ${shellQuote(onto)}`, repoPath);
    return { success: true };
  } catch {
    let conflictFiles: string[] | undefined;
    try {
      const { stdout } = await gitExec("git diff --name-only --diff-filter=U", repoPath);
      conflictFiles = stdout.trim().split("\n").filter(Boolean);
    } catch {
      // Could not read conflict files
    }
    await gitExec("git rebase --abort", repoPath).catch(() => {});
    return { success: false, conflictFiles };
  }
}

/**
 * Reset branch to a specific commit or branch
 * @param repoPath - Path to the git repository
 * @param to - Target commit SHA or branch name
 * @param mode - 'soft' keeps changes staged, 'hard' discards all changes
 */
export async function resetBranch(
  repoPath: string,
  to: string,
  mode: "soft" | "hard",
): Promise<void> {
  const resetMode = mode === "hard" ? "--hard" : "--soft";
  await gitExec(`git reset ${resetMode} ${shellQuote(to)}`, repoPath);
}

/**
 * Returns true when the provided name resolves to a local branch.
 */
export async function hasLocalBranch(repoPath: string, branch: string): Promise<boolean> {
  try {
    await gitExec(`git rev-parse --verify ${shellQuote(`refs/heads/${branch}`)}`, repoPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the currently checked out branch name, or null when detached HEAD.
 */
export async function getCurrentBranchName(repoPath: string): Promise<string | null> {
  const branch = await gitExec("git branch --show-current", repoPath);
  return branch.trim() || null;
}

/**
 * Checkout an existing local branch.
 */
export async function checkoutExistingBranch(repoPath: string, branch: string): Promise<void> {
  await gitExec(`git checkout ${shellQuote(branch)}`, repoPath);
}

export interface CommitInfo {
  sha: string;
  shortSha: string;
  message: string;
  summary: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  additions: number;
  deletions: number;
  parents: string[];
}

/**
 * Get commit history from current branch
 * @param repoPath - Path to the git repository
 * @param options - Options for commit list
 * @returns Array of commit information
 */
export async function getCommitList(
  repoPath: string,
  options: { limit?: number; since?: string } = {},
): Promise<CommitInfo[]> {
  const { limit = 20, since } = options;

  // Use explicit record/field separators so multiline commit bodies do not break parsing.
  const format = "%x1e%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1f%P%x1d";
  let command = `git log --format="${format}" --numstat -n ${limit}`;

  if (since) {
    command += ` --since="${since}"`;
  }

  const output = await gitExec(command, repoPath);
  if (!output) return [];

  const commits: CommitInfo[] = [];
  const records = output
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean);

  for (const record of records) {
    const separatorIndex = record.indexOf("\x1d");
    if (separatorIndex < 0) {
      continue;
    }

    const header = record.slice(0, separatorIndex);
    const statsSection = record.slice(separatorIndex + 1);
    const parts = header.split("\x1f");
    if (parts.length < 8) {
      continue;
    }

    const [sha, shortSha, authorName, authorEmail, authoredAt, subject, body, parentsStr] = parts;
    const parents = parentsStr
      ? parentsStr.split(/\s+/).map((value) => value.trim()).filter(Boolean)
      : [];

    let additions = 0;
    let deletions = 0;
    for (const statLine of statsSection.split("\n").map((line) => line.trim()).filter(Boolean)) {
      const [add, del] = statLine.split("\t");
      additions += add === "-" ? 0 : parseInt(add, 10) || 0;
      deletions += del === "-" ? 0 : parseInt(del, 10) || 0;
    }

    commits.push({
      sha,
      shortSha,
      message: body ? `${subject}\n\n${body.trim()}` : subject,
      summary: subject,
      authorName,
      authorEmail,
      authoredAt,
      additions,
      deletions,
      parents,
    });
  }

  return commits;
}

/**
 * Get diff for a specific file
 * @param repoPath - Path to the git repository
 * @param filePath - Path to the file relative to repo root
 * @param staged - Whether to get staged diff or working directory diff
 * @returns The diff as a string
 */
export async function getFileDiff(
  repoPath: string,
  filePath: string,
  staged = false,
): Promise<string> {
  const command = staged
    ? `git diff --cached "${filePath}"`
    : `git diff "${filePath}"`;

  const diff = await gitExec(command, repoPath);
  return diff;
}

/**
 * Get diff for a specific commit
 * @param repoPath - Path to the git repository
 * @param commitSha - Commit SHA
 * @param filePath - Optional: specific file path
 * @returns The diff as a string
 */
export async function getCommitDiff(
  repoPath: string,
  commitSha: string,
  filePath?: string,
): Promise<string> {
  const command = filePath
    ? `git show ${commitSha} -- "${filePath}"`
    : `git show ${commitSha}`;

  const diff = await gitExec(command, repoPath);
  return diff;
}
