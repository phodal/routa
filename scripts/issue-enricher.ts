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
 *
 * Environment:
 *   ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN   # Required
 *   ANTHROPIC_BASE_URL                          # Optional, custom API endpoint
 *   ANTHROPIC_MODEL                             # Optional, default: claude-sonnet-4-20250514
 *   GH_TOKEN                                    # Required for gh CLI operations
 */

import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// ─── Configuration ─────────────────────────────────────────────────────────

const SKILL_PATH = ".claude/skills/issue-enricher/SKILL.md";

interface IssueData {
  number: number;
  title: string;
  body: string;
  labels: string[];
  author: string;
}

// ─── Fetch Issue Data ──────────────────────────────────────────────────────

function fetchIssue(issueNumber: number): IssueData | null {
  try {
    const output = execSync(
      `gh issue view ${issueNumber} --json number,title,body,labels,author`,
      { encoding: "utf-8", cwd: process.cwd() }
    );
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

// ─── Run Claude Analysis ───────────────────────────────────────────────────

async function analyzeIssue(issue: IssueData, dryRun: boolean): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;

  if (!apiKey && !dryRun) {
    console.error("❌ No ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN set");
    process.exit(1);
  }

  console.log(`\n🤖 Analyzing issue #${issue.number}: ${issue.title}\n`);

  // Load skill content
  const skillContent = existsSync(SKILL_PATH) ? readFileSync(SKILL_PATH, "utf-8") : "";

  const prompt = `Analyze GitHub issue #${issue.number} and provide a detailed analysis.

## Issue Title
${issue.title}

## Issue Body
${issue.body}

## Current Labels
${issue.labels.length > 0 ? issue.labels.join(", ") : "(none)"}

## Instructions
1. Analyze the codebase to understand the context and find relevant files
2. Research potential solution approaches (2-3 approaches with trade-offs)
3. ${dryRun ? "Output what you would comment (do NOT actually run gh commands)" : `Add a comment to the issue using: gh issue comment ${issue.number} --body "..."`}
4. The comment should include:
   - Problem analysis
   - Relevant files in the codebase
   - 2-3 proposed approaches with trade-offs
   - Recommended approach
   - Effort estimate (Small/Medium/Large)
5. ${dryRun ? "Suggest appropriate labels" : `Add appropriate labels using: gh issue edit ${issue.number} --add-label "enhancement" (or other relevant labels)`}

Do NOT create a new issue - only analyze and comment on issue #${issue.number}.`;

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

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  // Parse --issue argument
  const issueIndex = args.indexOf("--issue");
  if (issueIndex === -1 || !args[issueIndex + 1]) {
    console.error("Usage: npx tsx scripts/issue-enricher.ts --issue <number> [--dry-run]");
    process.exit(1);
  }
  const issueNumber = parseInt(args[issueIndex + 1], 10);

  console.log("═".repeat(80));
  console.log("🔍 Issue Enricher");
  console.log("═".repeat(80));

  const issue = fetchIssue(issueNumber);
  if (!issue) {
    process.exit(1);
  }

  console.log(`   Issue: #${issue.number}`);
  console.log(`   Title: ${issue.title}`);
  console.log(`   Author: ${issue.author}`);
  console.log(`   Labels: ${issue.labels.length > 0 ? issue.labels.join(", ") : "(none)"}`);

  await analyzeIssue(issue, dryRun);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

