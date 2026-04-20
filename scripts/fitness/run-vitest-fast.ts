import { execFileSync, spawnSync } from "node:child_process";

const DEFAULT_BASE_REF_CANDIDATES = ["origin/main", "main", "origin/master", "master"] as const;
const RELEVANT_PREFIXES = ["src/", "scripts/", "tests/"] as const;
const RELEVANT_EXACT_FILES = new Set([
  "package.json",
  "vitest.config.ts",
  "vitest.setup.ts",
  "tsconfig.json",
  "tsconfig.node.json",
]);

export function pickBaseRef(upstreamRef: string | null, existingRefs: string[]): string | null {
  const normalizedUpstream = upstreamRef?.trim();
  if (normalizedUpstream) {
    return normalizedUpstream;
  }

  for (const candidate of DEFAULT_BASE_REF_CANDIDATES) {
    if (existingRefs.includes(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function isVitestRelevantChange(relPath: string): boolean {
  if (!relPath.trim()) {
    return false;
  }

  if (RELEVANT_EXACT_FILES.has(relPath)) {
    return true;
  }

  if (relPath.startsWith("tsconfig.") && relPath.endsWith(".json")) {
    return true;
  }

  return RELEVANT_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

export function normalizeSuccessSummary(output: string): string | null {
  if (/No test files found/i.test(output)) {
    return "Tests 0 passed";
  }

  const match = output.match(/Tests\s+(\d+)\s+passed/i);
  if (!match) {
    return null;
  }

  return `Tests ${match[1]} passed`;
}

function tryExecGit(repoRoot: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function resolveBaseRef(repoRoot: string): string | null {
  const upstreamRef = tryExecGit(repoRoot, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
  const existingRefs = DEFAULT_BASE_REF_CANDIDATES.filter((candidate) =>
    Boolean(tryExecGit(repoRoot, ["rev-parse", "--verify", candidate])),
  );
  return pickBaseRef(upstreamRef, existingRefs);
}

function listChangedFiles(repoRoot: string, baseRef: string): string[] {
  const stdout = tryExecGit(repoRoot, ["diff", "--name-only", "--diff-filter=ACMR", baseRef]);
  if (!stdout) {
    return [];
  }

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function run(): number {
  const repoRoot = process.cwd();
  const baseRef = resolveBaseRef(repoRoot);

  if (!baseRef) {
    console.log("No upstream/main ref found for incremental Vitest; falling back to full suite.");
    const fallback = spawnSync("npx", ["vitest", "run"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "inherit",
    });
    if (fallback.error) {
      throw fallback.error;
    }
    return fallback.status ?? 1;
  }

  const changedFiles = listChangedFiles(repoRoot, baseRef);
  const relevantChanges = changedFiles.filter(isVitestRelevantChange);

  if (relevantChanges.length === 0) {
    console.log(`No Vitest-relevant changes relative to ${baseRef}.`);
    console.log("Tests 0 passed");
    return 0;
  }

  console.log(
    `Running incremental Vitest against ${baseRef} for ${relevantChanges.length} relevant changed files.`,
  );

  const result = spawnSync("npx", ["vitest", "run", "--changed", baseRef, "--passWithNoTests"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    return result.status ?? 1;
  }

  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const summary = normalizeSuccessSummary(combined);
  if (summary && !combined.includes(summary)) {
    console.log(summary);
  }

  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(run());
}
