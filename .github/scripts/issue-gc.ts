#!/usr/bin/env npx tsx
/**
 * Issue Garbage Collector CLI
 *
 * Runs the issue-garbage-collector skill using the Claude Code SDK.
 * Designed for GitHub Actions scheduled runs (weekly maintenance).
 *
 * Usage:
 *   npx tsx scripts/issue-gc.ts                    # Full garbage collection
 *   npx tsx scripts/issue-gc.ts --dry-run          # Scan only, no changes
 *   npx tsx scripts/issue-gc.ts --phase1-only      # Python scanner only
 *
 * Environment:
 *   ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN      # Required for Phase 2
 *   ANTHROPIC_MODEL                                # Optional, default: claude-sonnet-4-20250514
 */

import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// ─── Configuration ─────────────────────────────────────────────────────────

const SCANNER_SCRIPT = "scripts/issue-scanner.py";
const SKILL_PATH = ".claude/skills/issue-garbage-collector/SKILL.md";

interface ScanResult {
  issues: Array<{ file: string; status: string; age_days: number }>;
  errors: Array<{ file: string; error: string }>;
  suspects: Array<{ file_a: string; file_b?: string; type: string; reason: string }>;
  summary: { total: number; errors: number; suspects: number };
}

// ─── Phase 1: Python Scanner ───────────────────────────────────────────────

function runPhase1(): ScanResult | null {
  console.log("\n📋 Phase 1: Running Python issue scanner...\n");

  try {
    const output = execSync(`python3 ${SCANNER_SCRIPT} --json`, {
      encoding: "utf-8",
      cwd: process.cwd(),
    });
    const result: ScanResult = JSON.parse(output);

    console.log(`   Total issues: ${result.summary.total}`);
    console.log(`   Validation errors: ${result.summary.errors}`);
    console.log(`   Suspects for Phase 2: ${result.summary.suspects}`);

    return result;
  } catch (error) {
    console.error("❌ Phase 1 failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

// ─── Phase 2: Claude SDK Deep Analysis ─────────────────────────────────────

async function runPhase2(suspects: ScanResult["suspects"], dryRun: boolean): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;

  if (!apiKey) {
    console.log("\n⚠️  Phase 2 skipped: No ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN set");
    console.log("   Set the environment variable to enable AI-powered deep analysis.\n");
    return;
  }

  if (suspects.length === 0) {
    console.log("\n✅ Phase 2 skipped: No suspects to analyze\n");
    return;
  }

  console.log(`\n🤖 Phase 2: Running Claude SDK deep analysis on ${suspects.length} suspects...\n`);

  if (dryRun) {
    console.log("   [DRY RUN] Would analyze:");
    for (const s of suspects) {
      console.log(`   - ${s.type}: ${s.file_a}${s.file_b ? ` ↔ ${s.file_b}` : ""}`);
    }
    return;
  }

  // Load skill content
  const skillContent = existsSync(SKILL_PATH) ? readFileSync(SKILL_PATH, "utf-8") : "";

  // Build prompt for Claude
  const suspectList = suspects
    .map((s) => `- [${s.type}] ${s.file_a}${s.file_b ? ` ↔ ${s.file_b}` : ""}: ${s.reason}`)
    .join("\n");

  const prompt = `Run issue garbage collection on docs/issues/.

Phase 1 scanner found these suspects:
${suspectList}

Follow the SKILL.md instructions to:
1. For duplicates: Check if they should be merged
2. For open issues: Verify if they have been resolved
3. For stale issues: Triage (close, escalate, or archive)

Use the quick update commands when possible:
- python3 scripts/issue-scanner.py --resolve <file>
- python3 scripts/issue-scanner.py --close <file>

Auto-execute status updates. Only ask for confirmation on merges/deletes.`;

  // Use Claude Code SDK via dynamic import
  try {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const cliPath = join(process.cwd(), "node_modules/@anthropic-ai/claude-agent-sdk/cli.js");

    console.log("   Starting Claude Code agent...\n");

    const stream = query({
      prompt,
      options: {
        cwd: process.cwd(),
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
        maxTurns: 50,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        pathToClaudeCodeExecutable: cliPath,
        settingSources: ["project"],
        allowedTools: ["Skill", "Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        systemPrompt: skillContent
          ? { type: "preset", preset: "claude_code", append: skillContent }
          : undefined,
      },
    });

    for await (const msg of stream) {
      // Stream output to console
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

    console.log("\n\n✅ Phase 2 complete\n");
  } catch (error) {
    console.error("❌ Phase 2 failed:", error instanceof Error ? error.message : error);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const phase1Only = args.includes("--phase1-only");

  console.log("═".repeat(80));
  console.log("🗑️  Issue Garbage Collector");
  console.log("═".repeat(80));

  // Phase 1: Python scanner
  const result = runPhase1();
  if (!result) {
    process.exit(1);
  }

  // Print human-readable table
  execSync(`python3 ${SCANNER_SCRIPT}`, { stdio: "inherit", cwd: process.cwd() });

  if (phase1Only) {
    console.log("\n✅ Phase 1 complete (--phase1-only mode)\n");
    return;
  }

  // Phase 2: Claude SDK
  await runPhase2(result.suspects, dryRun);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

