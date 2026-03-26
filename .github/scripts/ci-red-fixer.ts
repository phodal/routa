#!/usr/bin/env npx tsx
/**
 * CI Red Fixer CLI
 *
 * Looks up the latest failed Defense workflow run on the target branch,
 * extracts failed job logs, asks Claude Code to repair the codebase,
 * and re-runs the failing gates locally before allowing a commit.
 *
 * Usage:
 *   npx tsx scripts/ci-red-fixer.ts
 *   npx tsx scripts/ci-red-fixer.ts --dry-run
 *   npx tsx scripts/ci-red-fixer.ts --run-id 123456789
 *   npx tsx scripts/ci-red-fixer.ts --branch main --report-file /tmp/report.json
 *
 * Environment:
 *   ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN      # Required unless --dry-run
 *   ANTHROPIC_BASE_URL                             # Optional, custom API endpoint
 *   ANTHROPIC_MODEL                                # Optional, default: claude-sonnet-4-20250514
 *   GH_TOKEN                                       # Required for gh CLI operations
 *   GITHUB_REPOSITORY                              # Optional, auto-detected if missing
 */

import { execFileSync } from "child_process";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import {
  buildRepairPrompt,
  collectValidationCommands,
  DEFAULT_TARGET_BRANCH,
  DEFENSE_WORKFLOW_FILE,
  findUnmappedJobs,
  normalizeJobSummary,
  normalizeRunSummary,
  pickFailedJobs,
  pickRepairCandidateRun,
  shouldAttemptRepair,
  trimLogExcerpt,
  type FailedJobContext,
  type WorkflowJobSummary,
  type WorkflowRunSummary,
} from "../src/core/github/ci-red-fixer";

interface WorkflowRunsResponse {
  workflow_runs: Array<{
    id: number;
    name: string;
    conclusion: string | null;
    head_branch: string;
    head_sha: string;
    html_url: string;
    event: string;
    display_title?: string;
  }>;
}

interface WorkflowRunResponse {
  id: number;
  name: string;
  conclusion: string | null;
  head_branch: string;
  head_sha: string;
  html_url: string;
  event: string;
  display_title?: string;
}

interface WorkflowJobsResponse {
  jobs: Array<{
    id: number;
    name: string;
    conclusion: string | null;
    html_url?: string;
  }>;
}

interface CliOptions {
  branch: string;
  dryRun: boolean;
  reportFile?: string;
  runId?: number;
  workflowFile: string;
}

interface RepairReport {
  targetRun: WorkflowRunSummary | null;
  failedJobs: Array<{
    id: number;
    name: string;
    conclusion: string | null;
    htmlUrl?: string;
    validationCommands: string[];
  }>;
  validationCommands: string[];
  changedFiles: string[];
  status:
    | "no-failure"
    | "repaired"
    | "dry-run"
    | "no-changes"
    | "unmapped-jobs"
    | "verification-failed";
}

interface ExecFileOptions {
  stdio?: "pipe" | "inherit";
}

function runExecFile(
  command: string,
  args: string[],
  options: ExecFileOptions = {}
): string {
  const output = execFileSync(command, args, {
    encoding: "utf-8",
    cwd: process.cwd(),
    stdio: options.stdio ?? "pipe",
    maxBuffer: 20 * 1024 * 1024,
  });

  return typeof output === "string" ? output : "";
}

function runGh(args: string[], options: ExecFileOptions = {}): string {
  return runExecFile("gh", args, options);
}

function runGit(args: string[], options: ExecFileOptions = {}): string {
  return runExecFile("git", args, options);
}

function parseValidationCommand(command: string): { executable: string; args: string[] } {
  switch (command) {
    case "npm run lint":
      return { executable: "npm", args: ["run", "lint"] };
    case "cargo clippy --workspace -- -D warnings":
      return { executable: "cargo", args: ["clippy", "--workspace", "--", "-D", "warnings"] };
    case "npm run test:run":
      return { executable: "npm", args: ["run", "test:run"] };
    case "cargo test --workspace":
      return { executable: "cargo", args: ["test", "--workspace"] };
    case "npm run api:schema:validate":
      return { executable: "npm", args: ["run", "api:schema:validate"] };
    case "npm run api:check":
      return { executable: "npm", args: ["run", "api:check"] };
    case "npm audit --audit-level=critical":
      return { executable: "npm", args: ["audit", "--audit-level=critical"] };
    case "semgrep --config=p/security-audit --config=p/owasp-top-ten --severity=ERROR --error .":
      return {
        executable: "semgrep",
        args: [
          "--config=p/security-audit",
          "--config=p/owasp-top-ten",
          "--severity=ERROR",
          "--error",
          ".",
        ],
      };
    case "trivy fs --severity HIGH,CRITICAL --exit-code 0 .":
      return {
        executable: "trivy",
        args: ["fs", "--severity", "HIGH,CRITICAL", "--exit-code", "0", "."],
      };
    case "hadolint Dockerfile":
      return { executable: "hadolint", args: ["Dockerfile"] };
    default:
      throw new Error(`Unsupported validation command: ${command}`);
  }
}

function writeReport(reportFile: string | undefined, report: RepairReport): void {
  if (!reportFile) {
    return;
  }

  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
}

function parseArgs(args: string[]): CliOptions {
  const dryRun = args.includes("--dry-run");

  const branchIndex = args.indexOf("--branch");
  const workflowIndex = args.indexOf("--workflow-file");
  const runIdIndex = args.indexOf("--run-id");
  const reportFileIndex = args.indexOf("--report-file");

  const branch = branchIndex >= 0 ? args[branchIndex + 1] : DEFAULT_TARGET_BRANCH;
  const workflowFile = workflowIndex >= 0 ? args[workflowIndex + 1] : DEFENSE_WORKFLOW_FILE;
  const reportFile = reportFileIndex >= 0 ? args[reportFileIndex + 1] : undefined;

  if (!branch) {
    console.error("❌ --branch requires a value");
    process.exit(1);
  }

  if (!workflowFile) {
    console.error("❌ --workflow-file requires a value");
    process.exit(1);
  }

  let runId: number | undefined;
  if (runIdIndex >= 0) {
    const value = args[runIdIndex + 1];
    if (!value) {
      console.error("❌ --run-id requires a value");
      process.exit(1);
    }

    runId = Number.parseInt(value, 10);
    if (Number.isNaN(runId)) {
      console.error(`❌ Invalid --run-id value: ${value}`);
      process.exit(1);
    }
  }

  if (reportFile && existsSync(reportFile)) {
    writeFileSync(reportFile, "", "utf-8");
  }

  return {
    branch,
    dryRun,
    reportFile,
    runId,
    workflowFile,
  };
}

function resolveRepo(): string {
  return (
    process.env.GITHUB_REPOSITORY ||
    runGh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim()
  );
}

function fetchTargetRun(
  repo: string,
  workflowFile: string,
  branch: string,
  runId?: number
): WorkflowRunSummary | null {
  if (runId) {
    const run = JSON.parse(runGh(["api", `repos/${repo}/actions/runs/${runId}`])) as WorkflowRunResponse;
    return normalizeRunSummary(run);
  }

  const response = JSON.parse(
    runGh([
      "api",
      `repos/${repo}/actions/workflows/${workflowFile}/runs?branch=${encodeURIComponent(branch)}&status=completed&per_page=5`,
    ])
  ) as WorkflowRunsResponse;

  const runs = response.workflow_runs.map(normalizeRunSummary);
  return pickRepairCandidateRun(runs);
}

function fetchFailedJobs(repo: string, runId: number): WorkflowJobSummary[] {
  const response = JSON.parse(runGh(["api", `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`])) as WorkflowJobsResponse;

  return pickFailedJobs(response.jobs.map(normalizeJobSummary));
}

function fetchJobLogExcerpt(repo: string, runId: number, jobId: number): string {
  try {
    const log = runGh(["run", "view", runId.toString(), "--repo", repo, "--job", jobId.toString(), "--log"]);
    return trimLogExcerpt(log);
  } catch (error) {
    return `Unable to fetch logs for job ${jobId}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function runClaudeRepair(prompt: string, dryRun: boolean): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;

  if (!apiKey && !dryRun) {
    console.error("❌ No ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN set");
    process.exit(1);
  }

  if (dryRun) {
    console.log("\n[DRY RUN] Claude repair prompt:\n");
    console.log(prompt);
    return;
  }

  try {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const cliPath = join(process.cwd(), "node_modules/@anthropic-ai/claude-agent-sdk/cli.js");

    console.log("\n🤖 Starting Claude Code repair agent...\n");

    const stream = query({
      prompt,
      options: {
        cwd: process.cwd(),
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
        maxTurns: 80,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        pathToClaudeCodeExecutable: cliPath,
        settingSources: ["project"],
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      },
    });

    for await (const msg of stream) {
      if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "text") {
            process.stdout.write(block.text);
          }
        }
      } else if (msg.type === "result" && msg.subtype === "success" && msg.result) {
        console.log(`\n\n${msg.result}`);
      }
    }
  } catch (error) {
    console.error("❌ Claude repair failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function runVerification(commands: string[]): void {
  for (const command of commands) {
    console.log(`\n🧪 Verifying with: ${command}\n`);
    const parsed = parseValidationCommand(command);
    runExecFile(parsed.executable, parsed.args, { stdio: "inherit" });
  }
}

function listChangedFiles(): string[] {
  const output = runGit(["status", "--short"]);
  return output
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  console.log("═".repeat(80));
  console.log("🔧 CI Red Fixer");
  console.log("═".repeat(80));
  console.log(`   Workflow: ${options.workflowFile}`);
  console.log(`   Branch:   ${options.branch}`);
  if (options.runId) {
    console.log(`   Run ID:   ${options.runId}`);
  }
  if (options.dryRun) {
    console.log("   Mode:     DRY RUN");
  }

  const repo = resolveRepo();
  const targetRun = fetchTargetRun(repo, options.workflowFile, options.branch, options.runId);

  if (!targetRun || !shouldAttemptRepair(targetRun)) {
    console.log("\n✅ No failed Defense run needs repair.\n");
    writeReport(options.reportFile, {
      targetRun,
      failedJobs: [],
      validationCommands: [],
      changedFiles: [],
      status: "no-failure",
    });
    return;
  }

  console.log(`\n📋 Target run: ${targetRun.htmlUrl}`);
  console.log(`   Commit: ${targetRun.headSha}`);

  const failedJobs = fetchFailedJobs(repo, targetRun.id);
  if (failedJobs.length === 0) {
    console.error("❌ Target run failed, but no failed jobs were returned by the Actions API.");
    process.exit(1);
  }

  const unmappedJobs = findUnmappedJobs(failedJobs.map((job) => job.name));
  const validationCommands = collectValidationCommands(failedJobs.map((job) => job.name));

  const failedJobContexts: FailedJobContext[] = failedJobs.map((job) => ({
    job,
    validationCommands: collectValidationCommands([job.name]),
    logExcerpt: fetchJobLogExcerpt(repo, targetRun.id, job.id),
  }));

  writeReport(options.reportFile, {
    targetRun,
    failedJobs: failedJobContexts.map(({ job, validationCommands: jobCommands }) => ({
      id: job.id,
      name: job.name,
      conclusion: job.conclusion,
      htmlUrl: job.htmlUrl,
      validationCommands: jobCommands,
    })),
    validationCommands,
    changedFiles: [],
    status: options.dryRun ? "dry-run" : "repaired",
  });

  if (unmappedJobs.length > 0) {
    console.error(`\n❌ Unmapped failed jobs: ${unmappedJobs.join(", ")}`);
    console.error("   Refusing to auto-commit without explicit validation mapping.");
    writeReport(options.reportFile, {
      targetRun,
      failedJobs: failedJobContexts.map(({ job, validationCommands: jobCommands }) => ({
        id: job.id,
        name: job.name,
        conclusion: job.conclusion,
        htmlUrl: job.htmlUrl,
        validationCommands: jobCommands,
      })),
      validationCommands,
      changedFiles: [],
      status: "unmapped-jobs",
    });
    process.exit(1);
  }

  const prompt = buildRepairPrompt({
    repo,
    targetRun,
    failedJobs: failedJobContexts,
  });

  await runClaudeRepair(prompt, options.dryRun);

  if (options.dryRun) {
    return;
  }

  try {
    runVerification(validationCommands);
  } catch (error) {
    const changedFiles = listChangedFiles();
    writeReport(options.reportFile, {
      targetRun,
      failedJobs: failedJobContexts.map(({ job, validationCommands: jobCommands }) => ({
        id: job.id,
        name: job.name,
        conclusion: job.conclusion,
        htmlUrl: job.htmlUrl,
        validationCommands: jobCommands,
      })),
      validationCommands,
      changedFiles,
      status: "verification-failed",
    });
    console.error(
      "\n❌ Verification failed after attempted repair:",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }

  const changedFiles = listChangedFiles();
  const status = changedFiles.length > 0 ? "repaired" : "no-changes";

  if (changedFiles.length === 0) {
    console.log("\nℹ️  Repair completed but produced no repository changes.\n");
  } else {
    console.log("\n📝 Changed files:");
    for (const file of changedFiles) {
      console.log(`   ${file}`);
    }
    console.log("");
  }

  writeReport(options.reportFile, {
    targetRun,
    failedJobs: failedJobContexts.map(({ job, validationCommands: jobCommands }) => ({
      id: job.id,
      name: job.name,
      conclusion: job.conclusion,
      htmlUrl: job.htmlUrl,
      validationCommands: jobCommands,
    })),
    validationCommands,
    changedFiles,
    status,
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
