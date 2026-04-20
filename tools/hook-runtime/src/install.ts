#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const EXPECTED_HOOKS_PATH = ".husky/_";
const require = createRequire(import.meta.url);
const HUSKY_BIN_PATH = path.join(path.dirname(require.resolve("husky")), "bin.js");
const REQUIRED_PROJECT_HOOK_FILES = [
  "pre-commit",
  "pre-push",
  "post-commit",
  "prepare-commit-msg",
  "commit-msg",
] as const;
const REQUIRED_RUNTIME_HOOK_FILES = ["h", ...REQUIRED_PROJECT_HOOK_FILES] as const;

export type HookInstallStatus = "synced" | "repaired" | "skipped";
export type HookInstallSkipReason = "not-in-git-worktree" | "husky-disabled";

export type HookInstallResult = {
  currentHooksPath: string | null;
  expectedHooksPath: string;
  repoRoot: string | null;
  runtimeBootstrapped: boolean;
  skipReason?: HookInstallSkipReason;
  status: HookInstallStatus;
};

type CommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

function runCommand(command: string, args: string[], cwd: string): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    exitCode: result.status ?? 1,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

function runGit(args: string[], cwd: string): CommandResult {
  return runCommand("git", args, cwd);
}

function isHuskyDisabled(): boolean {
  return process.env.HUSKY === "0";
}

export function resolveGitRepoRoot(cwd = process.cwd()): string | null {
  const result = runGit(["rev-parse", "--show-toplevel"], cwd);
  if (result.exitCode !== 0) {
    return null;
  }

  const repoRoot = result.stdout.trim();
  return repoRoot.length > 0 ? repoRoot : null;
}

export function readLocalHooksPath(repoRoot: string): string | null {
  const result = runGit(["config", "--local", "--get", "core.hooksPath"], repoRoot);
  if (result.exitCode !== 0) {
    return null;
  }

  const hooksPath = result.stdout.trim();
  return hooksPath.length > 0 ? hooksPath : null;
}

function assertManagedHookEntrypoints(repoRoot: string): void {
  const missingFiles = REQUIRED_PROJECT_HOOK_FILES.filter((file) => {
    return !fs.existsSync(path.join(repoRoot, ".husky", file));
  });

  if (missingFiles.length > 0) {
    throw new Error(
      `Missing managed Husky hook entrypoints under .husky: ${missingFiles.join(", ")}`,
    );
  }
}

function getMissingHookRuntimeFiles(repoRoot: string): string[] {
  return REQUIRED_RUNTIME_HOOK_FILES.filter((file) => {
    return !fs.existsSync(path.join(repoRoot, EXPECTED_HOOKS_PATH, file));
  });
}

function bootstrapHuskyRuntime(repoRoot: string): boolean {
  const missingFiles = getMissingHookRuntimeFiles(repoRoot);
  if (missingFiles.length === 0) {
    return false;
  }

  if (isHuskyDisabled()) {
    return false;
  }

  const result = runCommand(process.execPath, [HUSKY_BIN_PATH], repoRoot);
  if (result.exitCode !== 0) {
    const details = result.stderr.trim() || result.stdout.trim() || "unknown husky install failure";
    throw new Error(`Unable to bootstrap Husky runtime under ${EXPECTED_HOOKS_PATH}: ${details}`);
  }

  const remainingFiles = getMissingHookRuntimeFiles(repoRoot);
  if (remainingFiles.length > 0) {
    throw new Error(
      `Husky runtime is incomplete under ${EXPECTED_HOOKS_PATH} after bootstrap: ${remainingFiles.join(", ")}`,
    );
  }

  return true;
}

export function assertHookRuntime(repoRoot: string): void {
  const missingFiles = getMissingHookRuntimeFiles(repoRoot);
  if (missingFiles.length > 0) {
    throw new Error(
      `Husky runtime is incomplete under ${EXPECTED_HOOKS_PATH}: ${missingFiles.join(", ")}`,
    );
  }
}

export function ensureLocalGitHooks(cwd = process.cwd()): HookInstallResult {
  const repoRoot = resolveGitRepoRoot(cwd);
  if (!repoRoot) {
    return {
      currentHooksPath: null,
      expectedHooksPath: EXPECTED_HOOKS_PATH,
      repoRoot: null,
      runtimeBootstrapped: false,
      skipReason: "not-in-git-worktree",
      status: "skipped",
    };
  }

  if (isHuskyDisabled()) {
    return {
      currentHooksPath: readLocalHooksPath(repoRoot),
      expectedHooksPath: EXPECTED_HOOKS_PATH,
      repoRoot,
      runtimeBootstrapped: false,
      skipReason: "husky-disabled",
      status: "skipped",
    };
  }

  assertManagedHookEntrypoints(repoRoot);

  const currentHooksPath = readLocalHooksPath(repoRoot);
  const runtimeBootstrapped = bootstrapHuskyRuntime(repoRoot);
  const syncedHooksPath = readLocalHooksPath(repoRoot);

  assertHookRuntime(repoRoot);

  if (syncedHooksPath === EXPECTED_HOOKS_PATH) {
    return {
      currentHooksPath,
      expectedHooksPath: EXPECTED_HOOKS_PATH,
      repoRoot,
      runtimeBootstrapped,
      status: currentHooksPath === EXPECTED_HOOKS_PATH ? "synced" : "repaired",
    };
  }

  const result = runGit(["config", "--local", "core.hooksPath", EXPECTED_HOOKS_PATH], repoRoot);
  if (result.exitCode !== 0) {
    const details = result.stderr.trim() || result.stdout.trim() || "unknown git config failure";
    throw new Error(`Unable to sync core.hooksPath to ${EXPECTED_HOOKS_PATH}: ${details}`);
  }

  return {
    currentHooksPath,
    expectedHooksPath: EXPECTED_HOOKS_PATH,
    repoRoot,
    runtimeBootstrapped,
    status: "repaired",
  };
}

function formatMessage(result: HookInstallResult): string {
  if (result.status === "skipped") {
    if (result.skipReason === "husky-disabled") {
      return "[hooks:sync] skipped: HUSKY=0 disables Husky runtime installation.";
    }

    return "[hooks:sync] skipped: not inside a git worktree.";
  }

  if (result.status === "synced" && result.runtimeBootstrapped) {
    return `[hooks:sync] bootstrapped Husky runtime under ${result.expectedHooksPath}; core.hooksPath already matches ${result.expectedHooksPath}.`;
  }

  if (result.status === "synced") {
    return `[hooks:sync] core.hooksPath already matches ${result.expectedHooksPath}.`;
  }

  const from = result.currentHooksPath ?? "<unset>";
  if (result.runtimeBootstrapped) {
    return `[hooks:sync] bootstrapped Husky runtime and repaired core.hooksPath: ${from} -> ${result.expectedHooksPath}.`;
  }

  return `[hooks:sync] repaired core.hooksPath: ${from} -> ${result.expectedHooksPath}.`;
}

function main(): void {
  const result = ensureLocalGitHooks();
  console.log(formatMessage(result));
}

const moduleBasename = path.basename(process.argv[1] ?? "");
if (moduleBasename === "install.ts") {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[hooks:sync] ${message}`);
    process.exitCode = 1;
  }
}
