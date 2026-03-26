#!/usr/bin/env npx tsx
/**
 * Issue Enricher CLI
 *
 * Analyzes GitHub issues using Claude Code and adds detailed analysis comments.
 * Designed for GitHub Actions triggered on issue creation.
 *
 * Usage:
 *   npx tsx scripts/issue-enricher.ts --issue 123
 *   npx tsx scripts/issue-enricher.ts --issue 123 --dry-run
 *   npx tsx scripts/issue-enricher.ts --issue 123 --assign-copilot
 *   npx tsx scripts/issue-enricher.ts --issue 123 --reopen
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
import { fetchGitHubIssuesViaGh } from "@/core/github/github-issue-gh";
import { readFileSync, existsSync } from "fs";
import { join, relative } from "path";

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

  try {
    console.log(`\n📚 Syncing GitHub issues into local docs/issues/${syncLimit ? ` (limit: ${syncLimit})` : " (full sync)"}...`);
    const issues = fetchGitHubIssuesViaGh({ state: "all", limit: syncLimit });
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

async function analyzeIssue(issue: IssueData, dryRun: boolean, syncContext: SyncContext): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;

  if (!apiKey && !dryRun) {
    console.error("❌ No ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN set");
    process.exit(1);
  }

  console.log(`\n🤖 Analyzing issue #${issue.number}: ${issue.title}\n`);

  // Load skill content
  const skillContent = existsSync(SKILL_PATH) ? readFileSync(SKILL_PATH, "utf-8") : "";

  const hasBody = issue.body.trim().length > 0;

  // Build label taxonomy strings for prompt
  const typeLabels = LABEL_TAXONOMY.type.map((l) => `\`${l.name}\``).join(", ");
  const areaLabels = LABEL_TAXONOMY.area.map((l) => `\`${l.name}\``).join(", ");
  const complexityLabels = LABEL_TAXONOMY.complexity.map((l) => `\`${l.name}\``).join(", ");
  const localIssueContext = syncContext.currentIssueFile
    ? `- Current issue mirror: \`${syncContext.currentIssueFile}\`\n- Synced GitHub issue mirrors available under \`docs/issues/\` (${syncContext.syncedCount} files in this run)`
    : `- Synced GitHub issue mirrors available under \`docs/issues/\` (${syncContext.syncedCount} files in this run)`;

  const prompt = `Analyze GitHub issue #${issue.number} and provide a detailed analysis.

## Issue Title
${issue.title}

## Issue Body
${hasBody ? issue.body : "(empty - user did not write a body)"}

## Current Labels
${issue.labels.length > 0 ? issue.labels.join(", ") : "(none)"}

## Local Issue Context
GitHub issues have already been synced into the local \`docs/issues/\` directory before this analysis. Treat those files as your local issue knowledge base.

${localIssueContext}

Start by reading the mirrored issue file if it exists, then search \`docs/issues/\` for related historical issues, overlapping requirements, duplicate proposals, or prior implementation notes.

## CRITICAL: External Repository References
If the issue title or body contains a GitHub repository URL (e.g. https://github.com/user/repo):
- You MUST actually clone the repository using \`git clone <url> /tmp/<repo-name> --depth 1\` via Bash.
- Do NOT just try to fetch the URL via a web reader or guess the repo contents.
- After cloning, explore the repo structure: read its README, key source files, package.json, etc.
- Analyze the cloned repo's architecture, patterns, and features in detail.
- Compare with the current codebase and identify what can be learned or integrated.
- Clean up after: \`rm -rf /tmp/<repo-name>\`

This is essential — if the user says "clone" or references an external repo, the whole point of the issue is to inspect that repo's actual code. Skipping the clone defeats the purpose.

## Instructions
1. Analyze the codebase to understand the context and find relevant files
2. If external repos are referenced, clone and explore them first (see above)
3. Research potential solution approaches (2-3 approaches with trade-offs)
4. If the issue title is vague or can be improved, ${dryRun ? "output a better title suggestion" : `update it with a clear, action-oriented title that describes what needs to be done: gh issue edit ${issue.number} --title "ACTION: clear description"`}
5. ${!hasBody
    ? (dryRun
        ? "Output the body content you would set (the user wrote no body, so update it directly)"
        : `Since the issue body is empty, update it directly with a detailed description: gh issue edit ${issue.number} --body "CONTENT"`)
    : (dryRun
        ? "Output what you would comment (do NOT actually run gh commands)"
        : `Add a comment to the issue using: gh issue comment ${issue.number} --body "CONTENT"`
      )
  }
6. The ${!hasBody ? "body" : "comment"} should include:
   - Problem analysis
   - Relevant files in the codebase (and external repo if cloned)
   - Related issues or prior context from \`docs/issues/\` and GitHub history
   - 2-3 proposed approaches with trade-offs
   - Recommended approach
   - Effort estimate (Small/Medium/Large)
7. Automatically apply labels based on your analysis using these categories:
   - **Type** (pick ONE): ${typeLabels}
   - **Area** (pick ONE or MORE that apply): ${areaLabels}
   - **Complexity** (pick ONE): ${complexityLabels}
   ${dryRun
     ? "Output the labels you would apply and why, but do NOT run any gh commands."
     : `Apply the labels with: gh issue edit ${issue.number} --add-label "bug,area:frontend,complexity:small" (replace with the labels you chose)
   Use only labels from the taxonomy above. Do NOT invent new label names.`}

Do NOT create a new issue - only analyze and update issue #${issue.number}.`;

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
    console.error("Usage: npx tsx scripts/issue-enricher.ts --issue <number> [--dry-run] [--reopen] [--assign-copilot] [--skip-sync]");
    process.exit(1);
  }
  const issueNumber = parseInt(args[issueIndex + 1], 10);

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

  await analyzeIssue(issue, dryRun, syncContext);

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
