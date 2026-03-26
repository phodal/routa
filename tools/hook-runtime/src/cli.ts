#!/usr/bin/env node

import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { isAiAgent } from "./ai.js";
import {
  DEFAULT_PARALLEL_JOBS,
  DEFAULT_PRE_PUSH_METRICS,
  DEFAULT_TAIL_LINES,
  parsePositiveInt,
} from "./config.js";
import {
  MetricExecution,
  printFailureSummary,
  runMetric,
  summarizeFailures,
} from "./fitness.js";
import { loadHookMetrics } from "./metrics.js";
import { runCommand, tailOutput } from "./process.js";
import {
  runSubmoduleRefsCheckWithSummary,
} from "./check-submodule-refs.js";
import { promptYesNo } from "./prompt.js";
import { createHumanMetricReporter } from "./renderer.js";
import { type ReviewPhaseResult, runReviewTriggerPhase } from "./review.js";
import { runMetrics } from "./scheduler.js";

type CliOptions = {
  autoFix: boolean;
  dryRun: boolean;
  failFast: boolean;
  jobs: number;
  outputMode: "human" | "jsonl";
  tailLines: number;
};

type HookPhaseResult = {
  phase: "submodule" | "fitness" | "review";
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  details?: string;
};

function parseOutputMode(raw: string | undefined): "human" | "jsonl" {
  if (raw === "jsonl") {
    return "jsonl";
  }
  return "human";
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    autoFix: false,
    dryRun: false,
    failFast: true,
    jobs: parsePositiveInt(process.env.ROUTA_HOOK_RUNTIME_JOBS, DEFAULT_PARALLEL_JOBS),
    outputMode: parseOutputMode(process.env.ROUTA_HOOK_RUNTIME_OUTPUT_MODE),
    tailLines: parsePositiveInt(process.env.ROUTA_HOOK_RUNTIME_TAIL_LINES, DEFAULT_TAIL_LINES),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fix") {
      options.autoFix = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--no-fail-fast") {
      options.failFast = false;
      continue;
    }
    if (arg === "--jsonl") {
      options.outputMode = "jsonl";
      continue;
    }
    if (arg === "--jobs" && i + 1 < argv.length) {
      options.jobs = parsePositiveInt(argv[i + 1], options.jobs);
      i += 1;
      continue;
    }
    if (arg.startsWith("--jobs=")) {
      options.jobs = parsePositiveInt(arg.slice("--jobs=".length), options.jobs);
      continue;
    }
    if (arg === "--output" && i + 1 < argv.length) {
      options.outputMode = parseOutputMode(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      options.outputMode = parseOutputMode(arg.slice("--output=".length));
      continue;
    }
    if (arg === "--tail-lines" && i + 1 < argv.length) {
      options.tailLines = parsePositiveInt(argv[i + 1], options.tailLines);
      i += 1;
      continue;
    }
    if (arg.startsWith("--tail-lines=")) {
      options.tailLines = parsePositiveInt(arg.slice("--tail-lines=".length), options.tailLines);
      continue;
    }
  }

  return options;
}

function emitEvent(outputMode: "human" | "jsonl", event: Record<string, unknown>): void {
  if (outputMode !== "jsonl") {
    return;
  }

  const payload = { ts: new Date().toISOString(), ...event };
  console.log(JSON.stringify(payload));
}

function logPhaseHeader(phase: string, step: number, outputMode: "human" | "jsonl", total = 3): void {
  if (outputMode === "human") {
    console.log(`[phase ${step}/${total}] ${phase}`);
  }
}

function buildFixPrompt(results: MetricExecution[]): string {
  const sections = results
    .filter((result) => !result.passed)
    .map((result) => {
      const body = tailOutput(result.output, 8_000).trim();
      return `## ${result.metric.name}\n\`\`\`\n${body}\n\`\`\``;
    })
    .join("\n\n");

  return [
    "Pre-push fitness checks failed. Please fix the following issues:",
    "",
    sections,
    "",
    "After fixing all issues, rerun the pre-push hook and verify it passes.",
  ].join("\n");
}

async function runClaudeFix(prompt: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", prompt], {
      stdio: "inherit",
      cwd: process.cwd(),
      env: process.env,
    });

    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function handleFitnessFailure(
  results: MetricExecution[],
  options: CliOptions,
): Promise<never> {
  if (options.outputMode === "human") {
    printFailureSummary(results);
  }
  emitEvent(options.outputMode, {
    event: "fitness.failed",
    phase: "fitness",
    status: "failed",
    failures: summarizeFailures(results),
  });

  if (isAiAgent()) {
    throw new Error("Running in AI agent environment. Please fix the errors shown above.");
  }

  const claudeCheck = await runCommand("command -v claude", { stream: false });
  if (claudeCheck.exitCode !== 0) {
    throw new Error("Claude CLI not found. Please fix errors manually.");
  }

  let shouldFix = options.autoFix;
  if (!shouldFix) {
    shouldFix = await promptYesNo("Would you like Claude to fix these issues? [y/N]");
  }

  if (!shouldFix) {
    throw new Error("Aborted. Please fix errors manually.");
  }

  if (options.outputMode === "human") {
    console.log("Starting Claude to fix issues...");
    console.log("");
  }

  const exitCode = await runClaudeFix(buildFixPrompt(results));
  if (exitCode !== 0) {
    throw new Error("Claude fix attempt failed.");
  }

  throw new Error("Claude has attempted to fix the issues. Please review the changes and run 'git push' again.");
}

async function runSubmodulePhase(dryRun: boolean, outputMode: "human" | "jsonl"): Promise<HookPhaseResult> {
  const startedAt = Date.now();
  logPhaseHeader("submodule refs", 1, outputMode);
  emitEvent(outputMode, {
    event: "phase.start",
    phase: "submodule",
    index: 1,
  });

  if (dryRun) {
    emitEvent(outputMode, {
      event: "phase.skip",
      phase: "submodule",
      durationMs: Date.now() - startedAt,
      reason: "dry_run",
      command: "tools/hook-runtime/src/check-submodule-refs.ts",
    });
    if (outputMode === "human") {
      console.log("[dry-run] tools/hook-runtime/src/check-submodule-refs.ts");
      console.log("");
    }
    return { phase: "submodule", status: "skipped", durationMs: Date.now() - startedAt };
  }

  const summary = await runSubmoduleRefsCheckWithSummary();
  const passed = !summary.failures.length;
  const durationMs = Date.now() - startedAt;

  const status = passed ? 0 : 1;

  emitEvent(outputMode, {
    event: "phase.complete",
    phase: "submodule",
    status: status === 0 ? "passed" : "failed",
    durationMs,
    command: "tools/hook-runtime/src/check-submodule-refs.ts",
    exitCode: status,
    checked: summary.checked,
    skipped: summary.skipped,
  });

  if (!passed) {
    const failureDetails = summary.failures.join(", ");
    const message = `Submodule ref check failed: ${summary.failures.length} unreachable refs.`;
    if (outputMode === "human" && failureDetails) {
      console.error(`[submodule] ${failureDetails}`);
    }
    throw new Error(message);
  }

  return { phase: "submodule", status: "passed", durationMs };
}

async function runFitnessPhase(options: CliOptions): Promise<MetricExecution[]> {
  logPhaseHeader("local fitness", 2, options.outputMode);
  emitEvent(options.outputMode, {
    event: "phase.start",
    phase: "fitness",
    index: 2,
    jobs: options.jobs,
  });

  if (options.dryRun) {
    const metrics = await loadHookMetrics([...DEFAULT_PRE_PUSH_METRICS]);
    if (options.outputMode === "human") {
      console.log(
        `[fitness] Metrics (${options.jobs} workers): ${DEFAULT_PRE_PUSH_METRICS.join(", ")}`,
      );
      for (const metric of metrics) {
        console.log(`[dry-run] ${metric.name} -> ${metric.command}`);
      }
      console.log("");
    }
    if (options.outputMode === "human") {
      console.log("");
    }
    emitEvent(options.outputMode, {
      event: "phase.skip",
      phase: "fitness",
      status: "skipped",
      durationMs: 0,
      reason: "dry_run",
      jobs: options.jobs,
      metrics: DEFAULT_PRE_PUSH_METRICS,
    });
    return [];
  }

  const metrics = await loadHookMetrics([...DEFAULT_PRE_PUSH_METRICS]);
  const reporter =
    options.outputMode === "human"
      ? createHumanMetricReporter(metrics, {
          concurrency: options.jobs,
          stream: process.stdout,
          tailLines: options.tailLines,
        })
      : null;
  const startedAt = Date.now();
  let reporterClosed = false;

  reporter?.start();

  try {
    const batch = await runMetrics(
      metrics,
      async (metric) =>
        runMetric(metric, {
          onOutput: (event) => reporter?.onMetricOutput(metric.name, event),
        }),
      {
        concurrency: options.jobs,
        failFast: options.failFast,
        onMetricStart: (metric, index, total) => {
          reporter?.onMetricStart(metric, index, total);
          emitEvent(options.outputMode, {
            event: "metric.start",
            phase: "fitness",
            name: metric.name,
            index,
            total,
            sourceFile: metric.sourceFile,
            command: metric.command,
          });
        },
        onMetricComplete: (result, index, total) => {
          reporter?.onMetricComplete(result, index, total);
          emitEvent(options.outputMode, {
            event: "metric.complete",
            phase: "fitness",
            name: result.metric.name,
            index,
            total,
            passed: result.passed,
            durationMs: result.durationMs,
            exitCode: result.exitCode,
            sourceFile: result.metric.sourceFile,
            command: result.metric.command,
            outputTail: tailOutput(result.output, 6_000),
          });
        },
      },
    );
    reporter?.close();
    reporterClosed = true;

    if (batch.skippedMetrics.length > 0) {
      emitEvent(options.outputMode, {
        event: "metric.skip",
        phase: "fitness",
        reason: "fail_fast",
        metrics: batch.skippedMetrics.map((metric) => metric.name),
      });
      if (options.outputMode === "human") {
        console.log(
          `[fitness] fail-fast left ${batch.skippedMetrics.length} queued metrics unstarted: ${batch.skippedMetrics
            .map((metric) => metric.name)
            .join(", ")}`,
        );
        console.log("");
      }
    }

    const durationMs = Date.now() - startedAt;
    emitEvent(options.outputMode, {
      event: "phase.complete",
      phase: "fitness",
      status: batch.results.every((result) => result.passed) ? "passed" : "failed",
      durationMs,
      totalMetrics: metrics.length,
      runMetrics: batch.results.length,
      skippedMetrics: batch.skippedMetrics.map((metric) => metric.name),
      metricFailures: summarizeFailures(batch.results),
    });

    if (batch.results.some((result) => !result.passed)) {
      await handleFitnessFailure(batch.results, options);
    }

    return batch.results;
  } finally {
    if (!reporterClosed) {
      reporter?.close();
    }
  }
}

async function runReviewPhase(dryRun: boolean, outputMode: "human" | "jsonl"): Promise<ReviewPhaseResult | null> {
  emitEvent(outputMode, {
    event: "phase.start",
    phase: "review",
    index: 3,
  });

  if (dryRun) {
    if (outputMode === "human") {
      console.log("[phase 3/3] review checks skipped in dry-run.");
      console.log("");
    }
    emitEvent(outputMode, {
      event: "phase.skip",
      phase: "review",
      status: "skipped",
      durationMs: 0,
      reason: "dry_run",
    });
    return null;
  }

  const startedAt = Date.now();
  const result = await runReviewTriggerPhase(outputMode);
  if (outputMode === "human") {
    console.log(`[phase 3/3] review checks ${result.allowed ? "passed" : "blocked"}`);
  }
  emitEvent(outputMode, {
    event: "phase.complete",
    phase: "review",
    status: result.allowed ? "passed" : "failed",
    durationMs: Date.now() - startedAt,
    base: result.base,
    bypassed: result.bypassed,
    matched: result.triggers.length,
    changedFiles: result.changedFiles,
    diffFileCount: result.diffFileCount,
    message: result.message,
    statusCode: result.status,
  });

  return result;
}

export async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  emitEvent(options.outputMode, {
    event: "hook.start",
    mode: options.outputMode,
    dryRun: options.dryRun,
    autoFix: options.autoFix,
    failFast: options.failFast,
    jobs: options.jobs,
    tailLines: options.tailLines,
  });

  await runSubmodulePhase(options.dryRun, options.outputMode);
  await runFitnessPhase(options);

  if (!options.dryRun) {
    const review = await runReviewPhase(false, options.outputMode);
    if (review && !review.allowed) {
      throw new Error(review.message);
    }
  }

  emitEvent(options.outputMode, {
    event: "hook.complete",
    status: "passed",
    durationMs: Date.now() - startedAt,
  });

  if (options.outputMode === "human") {
    console.log("All checks passed! Ready to push.");
  }
}

export function handleCliError(error: unknown, argv: string[] = process.argv.slice(2)): void {
  const { outputMode } = parseArgs(argv);
  const message = error instanceof Error ? error.message : String(error);
  emitEvent(outputMode, {
    event: "hook.error",
    status: "failed",
    message,
  });

  if (outputMode === "human") {
    console.error(message);
  }

  process.exitCode = 1;
}

const modulePath = path.resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (invokedPath === modulePath) {
  void main().catch((error) => {
    handleCliError(error);
  });
}
