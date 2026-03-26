#!/usr/bin/env npx tsx
/**
 * Copilot Complete Handler
 *
 * When GitHub Copilot marks an issue as Complete:
 * 1. Find the associated draft PR linked to the issue
 * 2. Convert it from draft to ready for review
 * 3. Add an @augment review comment on the PR
 *
 * Usage:
 *   npx tsx scripts/copilot-complete-handler.ts --issue 123
 *   npx tsx scripts/copilot-complete-handler.ts --issue 123 --dry-run
 *
 * Environment:
 *   GH_TOKEN   # Required for gh CLI operations
 *   GITHUB_REPOSITORY  # Optional, defaults to current repo from git remote
 */

import { ghExec } from "@/core/utils/safe-exec";

// ─── Types ─────────────────────────────────────────────────────────────────

interface PullRequest {
  number: number;
  title: string;
  isDraft: boolean;
  headRefName: string;
  url: string;
  body: string;
}

// ─── Find Linked PRs ──────────────────────────────────────────────────────

function findLinkedPRs(issueNumber: number, repo: string): PullRequest[] {
  console.log(`\n🔍 Searching for PRs linked to issue #${issueNumber}...`);

  const linkedPRs: PullRequest[] = [];

  // Method 1: Search via issue timeline for cross-referenced PRs
  try {
    const timelineOutput = ghExec([
      "api",
      `repos/${repo}/issues/${issueNumber}/timeline`,
      "--paginate",
      "--jq",
      '.[] | select(.event == "cross-referenced") | select(.source.issue.pull_request != null) | {number: .source.issue.number, title: .source.issue.title, url: .source.issue.pull_request.html_url}'
    ], { cwd: process.cwd() });

    if (timelineOutput.trim()) {
      const refs = timelineOutput
        .trim()
        .split("\n")
        .map((line) => {
          try {
            return JSON.parse(line) as { number: number; title: string; url: string };
          } catch {
            return null;
          }
        })
        .filter(Boolean) as Array<{ number: number; title: string; url: string }>;

      for (const ref of refs) {
        // Get PR details to check if it's a draft
        try {
          const prDetails = ghExec([
            "pr",
            "view",
            ref.number.toString(),
            "--repo",
            repo,
            "--json",
            "number,title,isDraft,headRefName,url,body"
          ], { cwd: process.cwd() });
          const pr = JSON.parse(prDetails) as PullRequest;
          if (!linkedPRs.find((p) => p.number === pr.number)) {
            linkedPRs.push(pr);
          }
        } catch {
          // PR might be closed/merged, skip
        }
      }
    }
  } catch (error) {
    console.warn(
      "   ⚠️ Could not fetch issue timeline:",
      error instanceof Error ? error.message : error
    );
  }

  // Method 2: Search open PRs that reference the issue in their body
  if (linkedPRs.length === 0) {
    try {
      const searchOutput = ghExec([
        "pr",
        "list",
        "--repo",
        repo,
        "--state",
        "open",
        "--json",
        "number,title,isDraft,headRefName,url,body"
      ], { cwd: process.cwd() });
      const allPRs = JSON.parse(searchOutput) as PullRequest[];
      const issuePattern = new RegExp(
        `(closes|fixes|resolves|close|fix|resolve)\\s*#${issueNumber}\\b`,
        "i"
      );

      for (const pr of allPRs) {
        if (issuePattern.test(pr.body || "")) {
          if (!linkedPRs.find((p) => p.number === pr.number)) {
            linkedPRs.push(pr);
          }
        }
      }
    } catch (error) {
      console.warn(
        "   ⚠️ Could not search PRs:",
        error instanceof Error ? error.message : error
      );
    }
  }

  if (linkedPRs.length === 0) {
    console.log(`   ℹ️  No linked PRs found for issue #${issueNumber}`);
  } else {
    console.log(`   Found ${linkedPRs.length} linked PR(s):`);
    for (const pr of linkedPRs) {
      console.log(`   - #${pr.number}: ${pr.title} (draft: ${pr.isDraft})`);
    }
  }

  return linkedPRs;
}

// ─── Convert Draft to Ready ────────────────────────────────────────────────

function convertDraftToReady(prNumber: number, repo: string, dryRun: boolean): boolean {
  console.log(`\n🚀 Converting PR #${prNumber} from draft to ready for review...`);

  if (dryRun) {
    console.log(`   [DRY RUN] Would run: gh pr ready ${prNumber} --repo ${repo}`);
    return true;
  }

  try {
    ghExec(["pr", "ready", prNumber.toString(), "--repo", repo], { cwd: process.cwd() });
    console.log(`   ✅ PR #${prNumber} is now ready for review`);
    return true;
  } catch (error) {
    console.error(
      `❌ Failed to convert PR #${prNumber} to ready:`,
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

// ─── Add Augment Review Comment ────────────────────────────────────────────

function addAugmentReviewComment(prNumber: number, repo: string, dryRun: boolean): boolean {
  console.log(`\n💬 Adding @augment review comment on PR #${prNumber}...`);

  const comment = `@augment review`;

  if (dryRun) {
    console.log(`   [DRY RUN] Would comment on PR #${prNumber}: "${comment}"`);
    return true;
  }

  try {
    ghExec(["pr", "comment", prNumber.toString(), "--repo", repo, "--body", comment], { cwd: process.cwd() });
    console.log(`   ✅ @augment review comment added to PR #${prNumber}`);
    return true;
  } catch (error) {
    console.error(
      `❌ Failed to add augment review comment:`,
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  const issueIndex = args.indexOf("--issue");
  if (issueIndex === -1 || !args[issueIndex + 1]) {
    console.error(
      "Usage: npx tsx scripts/copilot-complete-handler.ts --issue <number> [--dry-run]"
    );
    process.exit(1);
  }
  const issueNumber = parseInt(args[issueIndex + 1], 10);

  // Determine repo (from env or git remote)
  const repo =
    process.env.GITHUB_REPOSITORY ||
    ghExec(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { cwd: process.cwd() }).trim();

  console.log("═".repeat(80));
  console.log("🤖 Copilot Complete Handler");
  console.log("═".repeat(80));
  console.log(`   Issue: #${issueNumber}`);
  console.log(`   Repo:  ${repo}`);
  if (dryRun) console.log("   Mode:  DRY RUN");

  const linkedPRs = findLinkedPRs(issueNumber, repo);

  if (linkedPRs.length === 0) {
    console.log("\n⚠️  No linked PRs found. Nothing to do.");
    process.exit(0);
  }

  let converted = 0;
  let commented = 0;

  for (const pr of linkedPRs) {
    if (pr.isDraft) {
      const ok = convertDraftToReady(pr.number, repo, dryRun);
      if (ok) converted++;
    } else {
      console.log(`\n   ℹ️  PR #${pr.number} is already ready for review — skipping conversion`);
    }

    const ok = addAugmentReviewComment(pr.number, repo, dryRun);
    if (ok) commented++;
  }

  console.log("\n" + "═".repeat(80));
  console.log(`✅ Done — converted ${converted} draft(s), commented on ${commented} PR(s)`);
}

try {
  main();
} catch (error) {
  console.error("Fatal error:", error);
  process.exit(1);
}
