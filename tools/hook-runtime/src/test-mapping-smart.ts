import { execFileSync } from "node:child_process";
import { resolveEntrixExec } from "./process.js";

const SOURCE_PATHS = ["src", "apps", "crates"];
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|rs|java)$/;
const TEST_PATH_PATTERNS = [
  /(^|\/)__tests__\//,
  /(^|\/)tests?\//,
  /\.test\./,
  /\.spec\./,
  /\.snap$/,
  /\.snapshot$/,
];

function runGit(args: string[]): string {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function canResolveGitRef(ref: string): boolean {
  try {
    runGit(["rev-parse", "--verify", ref]);
    return true;
  } catch {
    return false;
  }
}

function collectChangedFiles(baseRef: string): string[] {
  const output = runGit([
    "diff",
    "--name-only",
    "--diff-filter=ACMR",
    baseRef,
    "--",
    ...SOURCE_PATHS,
  ]);

  return output
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((path) => SOURCE_EXTENSIONS.test(path))
    .filter((path) => !TEST_PATH_PATTERNS.some((pattern) => pattern.test(path)));
}

function resolveScopeBase(): string {
  const profile = process.env.ROUTA_HOOK_RUNTIME_PROFILE?.trim();
  const configuredBase = process.env.ROUTA_FITNESS_CHANGED_BASE?.trim();

  if (profile === "pre-push" && canResolveGitRef("HEAD^")) {
    return "HEAD^";
  }

  if (configuredBase && canResolveGitRef(configuredBase)) {
    return configuredBase;
  }

  if (canResolveGitRef("HEAD^")) {
    return "HEAD^";
  }

  return "HEAD";
}

function printEmptyResult(): void {
  process.stdout.write(
    `${JSON.stringify({
      mappings: [],
      skipped_test_files: [],
      status_counts: {},
      resolver_counts: {},
      graph: {
        available: false,
        status: "skipped",
        reason: "no changed source files in scoped diff",
      },
    }, null, 2)}\n`,
  );
}

function main(): void {
  const scopeBase = resolveScopeBase();
  const files = collectChangedFiles(scopeBase);

  if (files.length === 0) {
    printEmptyResult();
    return;
  }

  const args = [
    "graph",
    "test-mapping",
    "--base",
    scopeBase,
    "--no-graph",
    "--fail-on-missing",
    "--json",
    ...files,
  ];

  const entrix = resolveEntrixExec(process.cwd());
  const output = execFileSync(entrix.command, [...entrix.args, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  process.stdout.write(output);
}

main();
