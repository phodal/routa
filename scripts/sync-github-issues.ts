#!/usr/bin/env npx tsx

import { join } from "path";

import { fetchGitHubIssueViaGh, fetchGitHubIssuesViaGh } from "@/core/github/github-issue-gh";
import { syncGitHubIssuesToDirectory } from "@/core/github/github-issue-sync";

interface CliOptions {
  issueNumber?: number;
  state: "open" | "closed" | "all";
  limit?: number;
  dryRun: boolean;
  repo?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const issueIndex = argv.indexOf("--issue");
  const stateIndex = argv.indexOf("--state");
  const limitIndex = argv.indexOf("--limit");
  const repoIndex = argv.indexOf("--repo");

  return {
    issueNumber: issueIndex >= 0 ? parseInt(argv[issueIndex + 1], 10) : undefined,
    state: stateIndex >= 0 ? (argv[stateIndex + 1] as CliOptions["state"]) : "all",
    limit: limitIndex >= 0 ? parseInt(argv[limitIndex + 1], 10) : undefined,
    dryRun: argv.includes("--dry-run"),
    repo: repoIndex >= 0 ? argv[repoIndex + 1] : undefined,
  };
}

function ensureValidOptions(options: CliOptions): void {
  if (options.issueNumber !== undefined && Number.isNaN(options.issueNumber)) {
    throw new Error("Invalid --issue value");
  }

  if (!["open", "closed", "all"].includes(options.state)) {
    throw new Error("Invalid --state value. Use open, closed, or all.");
  }

  if (options.limit !== undefined && (Number.isNaN(options.limit) || options.limit <= 0)) {
    throw new Error("Invalid --limit value");
  }
}

function printSummary(results: ReturnType<typeof syncGitHubIssuesToDirectory>, dryRun: boolean): void {
  const created = results.filter((result) => result.created).length;
  const updated = results.filter((result) => result.updated).length;

  console.log("");
  console.log(dryRun ? "🔎 Sync preview complete" : "✅ GitHub issue sync complete");
  console.log(`   Files processed: ${results.length}`);
  console.log(`   New files: ${created}`);
  console.log(`   Updated files: ${updated}`);

  for (const result of results.slice(0, 10)) {
    const action = result.created ? "create" : result.updated ? "update" : "keep";
    const renameText = result.renamedFrom ? ` (renamed from ${result.renamedFrom})` : "";
    console.log(`   - #${result.issueNumber}: ${action} ${result.relativePath}${renameText}`);
  }

  if (results.length > 10) {
    console.log(`   ... ${results.length - 10} more files`);
  }
}

function printUsage(): void {
  console.log("Usage: npx tsx scripts/sync-github-issues.ts [--issue <number>] [--state <open|closed|all>] [--limit <n>] [--repo <owner/repo>] [--dry-run]");
  console.log("Omit --limit to sync the full issue set.");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  ensureValidOptions(options);

  const issuesDir = join(process.cwd(), "docs/issues");
  const issues = options.issueNumber !== undefined
    ? [fetchGitHubIssueViaGh(options.issueNumber, options.repo)]
    : fetchGitHubIssuesViaGh({
        repo: options.repo,
        state: options.state,
        limit: options.limit,
      });

  const results = syncGitHubIssuesToDirectory(issuesDir, issues, { dryRun: options.dryRun });
  printSummary(results, options.dryRun);
}

main().catch((error) => {
  printUsage();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
