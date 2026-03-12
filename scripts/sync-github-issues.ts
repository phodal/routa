#!/usr/bin/env npx tsx

import { execSync } from "child_process";
import {
  defaultIssueCachePath,
  syncGitHubIssues,
} from "../src/core/github/github-issue-intel";

function getArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function detectCurrentRepo(): string {
  return execSync("gh repo view --json nameWithOwner --jq .nameWithOwner", {
    encoding: "utf-8",
    cwd: process.cwd(),
  }).trim();
}

function main(): void {
  const repo = getArg("--repo") ?? detectCurrentRepo();
  const limit = Number(getArg("--limit") ?? "200");
  const output = getArg("--output") ?? defaultIssueCachePath(repo);

  console.log(`📥 Syncing issues for ${repo} ...`);
  const issues = syncGitHubIssues(repo, output, limit);
  console.log(`✅ Synced ${issues.length} issues -> ${output}`);
}

main();
