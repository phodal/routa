#!/usr/bin/env npx tsx
/**
 * Issue Enricher CLI
 *
 * Analyzes GitHub issues using Claude Code and adds detailed analysis comments.
 * Designed for GitHub Actions triggered on issue creation.
 *
 * Usage:
 *   npx tsx .github/scripts/issue-enricher.ts --issue 123
 *   npx tsx .github/scripts/issue-enricher.ts --issue 123 --dry-run
 *   npx tsx .github/scripts/issue-enricher.ts --issue 123 --assign-copilot
 *   npx tsx .github/scripts/issue-enricher.ts --issue 123 --reopen
 *
 * Environment:
 *   ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN   # Required
 *   ANTHROPIC_BASE_URL                          # Optional, custom API endpoint
 *   ANTHROPIC_MODEL                             # Optional, default: claude-sonnet-4-20250514
 *   GH_TOKEN                                    # Required for gh CLI operations
 */

import { ghExec } from "@/core/utils/safe-exec";
import {
  findExistingSyncedGitHubIssueFile,
  syncGitHubIssuesToDirectory,
} from "@/core/github/github-issue-sync";
import { fetchGitHubIssueViaGh, fetchGitHubIssuesViaGh, resolveGitHubRepo } from "@/core/github/github-issue-gh";
import { readFileSync, existsSync } from "fs";
import { join, relative } from "path";
import { buildIssueAnalysisPrompt } from "./issue-enricher-prompt";

// ─── Configuration ─────────────────────────────────────────────────────────

const SKILL_PATH = ".claude/skills/issue-enricher/SKILL.md";
const SYNCED_ISSUES_DIR = join(process.cwd(), "docs/issues");
const MAX_AUTO_TRIGGER_BODY_LENGTH = 200;
interface IssueData {
  number: number;
  title: string;
  body: string;
  labels: string[];
  author: string;
}

interface SyncContext {
  syncedCount: number;
  currentIssueFile?: string;
}

// ─── Label Taxonomy ────────────────────────────────────────────────────────

const LABEL_TAXONOMY = {
  type: [
    { name: "bug", color: "d73a4a", description: "Something isn't working" },
    { name: "enhancement", color: "a2eeef", description: "New feature or request" },
    { name: "documentation", color: "0075ca", description: "Improvements or additions to documentation" },
    { name: "question", color: "d876e3", description: "Further information is requested" },
    { name: "feature", color: "7057ff", description: "New feature request" },
  ],
  area: [
    { name: "area:frontend", color: "fbca04", description: "Related to the frontend/UI" },
    { name: "area:backend", color: "e4e669", description: "Related to the backend server" },
    { name: "area:api", color: "bfd4f2", description: "Related to the API layer" },
    { name: "area:database", color: "c5def5", description: "Related to database/storage" },
    { name: "area:devops", color: "fef2c0", description: "Related to CI/CD, deployment, or infrastructure" },
  ],
  complexity: [
    { name: "complexity:small", color: "0e8a16", description: "Small scope, straightforward change" },
    { name: "complexity:medium", color: "e4a907", description: "Moderate scope, requires some design work" },
    { name: "complexity:large", color: "b60205", description: "Large scope, significant effort required" },
  ],
};

// ─── Ensure Labels Exist ────────────────────────────────────────────────────

function ensureLabelsExist(): void {
  const allLabels = [
    ...LABEL_TAXONOMY.type,
    ...LABEL_TAXONOMY.area,
    ...LABEL_TAXONOMY.complexity,
  ];

  for (const label of allLabels) {
    try {
      // --force updates the label if it already exists, or creates it if not
      ghExec([
        "label",
        "create",
        label.name,
        "--color",
        label.color,
        "--description",
        label.description,
        "--force"
      ], { cwd: process.cwd() });
    } catch {
      // Non-fatal: log but continue if a label operation fails (e.g., auth or network issue)
    }
  }
}

// ─── Fetch Issue Data ──────────────────────────────────────────────────────

function fetchIssue(issueNumber: number): IssueData | null {
  try {
    const output = ghExec([
      "issue",
      "view",
      issueNumber.toString(),
      "--json",
      "number,title,body,labels,author"
    ], { cwd: process.cwd() });
    const data = JSON.parse(output);
    return {
      number: data.number,
      title: data.title,
      body: data.body || "",
      labels: data.labels?.map((l: { name: string }) => l.name) || [],
      author: data.author?.login || "unknown",
    };
  } catch (error) {
    console.error("❌ Failed to fetch issue:", error instanceof Error ? error.message : error);
    return null;
  }
}

function syncLocalIssueContext(issueNumber: number, dryRun: boolean): SyncContext {
  const syncLimit = process.env.ISSUE_SYNC_LIMIT ? parseInt(process.env.ISSUE_SYNC_LIMIT, 10) : undefined;
  const syncScope = process.env.ISSUE_SYNC_SCOPE === "all" ? "all" : "current";

  try {
    const issues = syncScope === "all"
      ? fetchGitHubIssuesViaGh({ state: "all", limit: syncLimit })
      : [fetchGitHubIssueViaGh(issueNumber)];
    const scopeLabel = syncScope === "all"
      ? (syncLimit ? `all issues (limit: ${syncLimit})` : "full issue set")
      : `current issue #${issueNumber}`;

    console.log(`\n📚 Syncing ${scopeLabel} into local docs/issues/...`);
    const results = syncGitHubIssuesToDirectory(SYNCED_ISSUES_DIR, issues, { dryRun });
    const currentIssueResult = results.find((result) => result.issueNumber === issueNumber);
    const existingCurrentFile = findExistingSyncedGitHubIssueFile(SYNCED_ISSUES_DIR, issueNumber);
    const currentIssueFile = currentIssueResult?.relativePath
      ?? (existingCurrentFile ? relative(process.cwd(), existingCurrentFile) : undefined);

    console.log(`   Synced ${results.length} GitHub issues into docs/issues/${dryRun ? " (dry-run preview)" : ""}`);
    if (currentIssueFile) {
      console.log(`   Current issue mirror: ${currentIssueFile}`);
    }

    return {
      syncedCount: results.length,
      currentIssueFile,
    };
  } catch (error) {
    console.log(`   ⚠️ Local issue sync skipped: ${error instanceof Error ? error.message : error}`);
    const existingCurrentFile = findExistingSyncedGitHubIssueFile(SYNCED_ISSUES_DIR, issueNumber);
    return {
      syncedCount: 0,
      currentIssueFile: existingCurrentFile ? relative(process.cwd(), existingCurrentFile) : undefined,
    };
  }
}

// ─── Run Claude Analysis ───────────────────────────────────────────────────

async function analyzeIssue(
  issue: IssueData,
  dryRun: boolean,
  syncContext: SyncContext,
  repo: string,
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;

  if (!apiKey && !dryRun) {
    console.error("❌ No ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN set");
    process.exit(1);
  }

  console.log(`\n🤖 Analyzing issue #${issue.number}: ${issue.title}\n`);

  // Load skill content
  const skillContent = existsSync(SKILL_PATH) ? readFileSync(SKILL_PATH, "utf-8") : "";

  const prompt = buildIssueAnalysisPrompt({
    dryRun,
    issue,
    labelTaxonomy: LABEL_TAXONOMY,
    repo,
    syncContext,
  });

  if (dryRun) {
    console.log("   [DRY RUN] Would analyze with prompt:\n");
    console.log(prompt);
    return;
  }

  try {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const cliPath = join(process.cwd(), "node_modules/@anthropic-ai/claude-agent-sdk/cli.js");

    console.log("   Starting Claude Code agent...\n");
    console.log("─".repeat(80));

    const stream = query({
      prompt,
      options: {
        cwd: process.cwd(),
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
        maxTurns: 30,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        pathToClaudeCodeExecutable: cliPath,
        settingSources: ["project"],
        allowedTools: ["Read", "Bash", "Glob", "Grep"],
        systemPrompt: skillContent
          ? { type: "preset", preset: "claude_code", append: skillContent }
          : undefined,
      },
    });

    for await (const msg of stream) {
      if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "text") {
            process.stdout.write(block.text);
          }
        }
      } else if (msg.type === "result") {
        if (msg.subtype === "success" && msg.result) {
          console.log("\n\n" + msg.result);
        }
      }
    }

    console.log("\n" + "─".repeat(80));
    console.log("\n✅ Analysis complete\n");
  } catch (error) {
    console.error("❌ Analysis failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// ─── Reopen Issue ──────────────────────────────────────────────────────────

function reopenIssue(issueNumber: number): boolean {
  try {
    console.log(`\n🔄 Reopening issue #${issueNumber}...`);
    ghExec(["issue", "reopen", issueNumber.toString()], { cwd: process.cwd() });
    console.log(`   ✅ Issue #${issueNumber} reopened`);
    return true;
  } catch (error) {
    console.error("❌ Failed to reopen issue:", error instanceof Error ? error.message : error);
    return false;
  }
}

// ─── Assign Copilot ────────────────────────────────────────────────────────

function assignCopilot(issueNumber: number): boolean {
  try {
    console.log(`\n🤖 Assigning Copilot to issue #${issueNumber}...`);
    ghExec(["issue", "edit", issueNumber.toString(), "--add-assignee", "copilot"], { cwd: process.cwd() });
    console.log(`   ✅ Copilot assigned to issue #${issueNumber}`);
    return true;
  } catch (error) {
    console.error("❌ Failed to assign Copilot:", error instanceof Error ? error.message : error);
    return false;
  }
}

// ─── Configuration ─────────────────────────────────────────────────────────

const ALLOWED_AUTHORS = ["phodal"];

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const isAutoTrigger = args.includes("--auto-trigger");
  const shouldReopen = args.includes("--reopen");
  const shouldAssignCopilot = args.includes("--assign-copilot");
  const shouldSkipSync = args.includes("--skip-sync");

  // Parse --issue argument
  const issueIndex = args.indexOf("--issue");
  if (issueIndex === -1 || !args[issueIndex + 1]) {
    console.error("Usage: npx tsx .github/scripts/issue-enricher.ts --issue <number> [--dry-run] [--reopen] [--assign-copilot] [--skip-sync]");
    process.exit(1);
  }
  const issueNumber = parseInt(args[issueIndex + 1], 10);
  const repo = resolveGitHubRepo();

  console.log("═".repeat(80));
  console.log("🔍 Issue Enricher");
  console.log("═".repeat(80));

  // Reopen issue if requested
  if (shouldReopen) {
    reopenIssue(issueNumber);
  }

  const issue = fetchIssue(issueNumber);
  if (!issue) {
    process.exit(1);
  }

  console.log(`   Issue: #${issue.number}`);
  console.log(`   Title: ${issue.title}`);
  console.log(`   Author: ${issue.author}`);
  console.log(`   Labels: ${issue.labels.length > 0 ? issue.labels.join(", ") : "(none)"}`);

  if (isAutoTrigger && issue.body.length > MAX_AUTO_TRIGGER_BODY_LENGTH) {
    console.log(
      `\n   ⏭️ Skipping automatic enrichment: issue body length (${issue.body.length}) exceeds ${MAX_AUTO_TRIGGER_BODY_LENGTH} characters`
    );
    return;
  }

  // Ensure standard labels exist before Claude tries to apply them
  if (!dryRun) {
    console.log("\n🏷️  Ensuring label taxonomy exists...");
    ensureLabelsExist();
  }

  const syncContext = shouldSkipSync
    ? {
        syncedCount: 0,
        currentIssueFile: (() => {
          const existingFile = findExistingSyncedGitHubIssueFile(SYNCED_ISSUES_DIR, issueNumber);
          return existingFile ? relative(process.cwd(), existingFile) : undefined;
        })(),
      }
    : syncLocalIssueContext(issueNumber, dryRun);

  // Check if author is allowed for Copilot assignment
  const isAllowedAuthor = ALLOWED_AUTHORS.includes(issue.author);
  if (shouldAssignCopilot && !isAllowedAuthor) {
    console.log(`\n   ⚠️ Skipping Copilot assignment: author "${issue.author}" is not in allowed list`);
  }

  await analyzeIssue(issue, dryRun, syncContext, repo);

  // Assign Copilot if requested and author is allowed (after analysis)
  if (shouldAssignCopilot && isAllowedAuthor && !dryRun) {
    assignCopilot(issueNumber);
  } else if (shouldAssignCopilot && isAllowedAuthor && dryRun) {
    console.log(`\n   [DRY RUN] Would assign Copilot to issue #${issueNumber}`);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
