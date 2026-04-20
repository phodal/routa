import { spawn } from "node:child_process";

import { isAiAgent } from "./ai.js";
import { type ReviewPhaseResult as ImportedReviewPhaseResult, runReviewTriggerPhase } from "./review.js";
import { runSubmoduleRefsCheckWithSummary } from "./check-submodule-refs.js";
import {
  MetricExecution,
  formatDuration,
  printFailureSummary,
  runMetric,
  summarizeFailures,
} from "./fitness.js";
import { type HookMetric, loadHookMetrics } from "./metrics.js";
import { runCommand, tailOutput } from "./process.js";
import { promptYesNo } from "./prompt.js";
import { createHumanMetricReporter } from "./renderer.js";
import { runMetrics } from "./scheduler.js";
import {
  resolveRuntimeProfileConfig,
  type HookProfileName,
  type RuntimePhase,
} from "./config.js";

export type HookRuntimeOutputMode = "human" | "jsonl";

export type HookRuntimeProfile = {
  name: HookProfileName;
  phases: readonly RuntimePhase[];
  fallbackMetrics: readonly string[];
};

export type ReviewPhaseResult = ImportedReviewPhaseResult;

export function splitMetricsByExecutionMode(metrics: HookMetric[]): {
  parallelMetrics: HookMetric[];
  serialMetrics: HookMetric[];
} {
  const parallelMetrics: HookMetric[] = [];
  const serialMetrics: HookMetric[] = [];

  for (const metric of metrics) {
    if (metric.serial) {
      serialMetrics.push(metric);
    } else {
      parallelMetrics.push(metric);
    }
  }

  return { parallelMetrics, serialMetrics };
}

export type HookRuntimeOptions = {
  autoFix: boolean;
  dryRun: boolean;
  failFast: boolean;
  jobs: number;
  metricNames: string[];
  outputMode: HookRuntimeOutputMode;
  profile: HookProfileName;
  tailLines: number;
  verboseMetrics?: boolean;
};

export type HookPhaseResult = {
  phase: RuntimePhase;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  details?: string;
};

export type HookMetricProvider = {
  loadMetrics: (metricNames: string[]) => Promise<HookMetric[]>;
};

export type ReviewProvider = {
  runReview: (outputMode: HookRuntimeOutputMode) => Promise<ReviewPhaseResult>;
};

export type FailureRouteContext = {
  isAiAgent: boolean;
  hasClaude: boolean;
};

export type FailureRouteResolverContext = {
  outputMode: HookRuntimeOutputMode;
  autoFix: boolean;
};

export type FailureRoute = {
  name: "agent" | "missing-claude" | "auto-fix" | "interactive";
  execute: (results: MetricExecution[], options: HookRuntimeOptions) => Promise<never>;
};

export type FailureRouteResolver = (
  _options: HookRuntimeOptions,
  context: FailureRouteContext,
  resolverContext: FailureRouteResolverContext,
) => FailureRoute;

export type RuntimeServices = {
  metricProvider: HookMetricProvider;
  reviewProvider: ReviewProvider;
  failureRouteResolver: FailureRouteResolver;
};

export type RuntimePhaseAdapters = {
  runSubmodulePhase(
    dryRun: boolean,
    outputMode: HookRuntimeOutputMode,
    step: number,
    totalSteps: number,
  ): Promise<HookPhaseResult>;
  runFitnessPhase(
    options: HookRuntimeOptions,
    step: number,
    totalSteps: number,
  ): Promise<MetricExecution[]>;
  runReviewPhase(
    dryRun: boolean,
    outputMode: HookRuntimeOutputMode,
    step: number,
    totalSteps: number,
  ): Promise<ReviewPhaseResult | null>;
};

export type RuntimeExecutionOverrides = {
  phaseAdapters?: Partial<RuntimePhaseAdapters>;
  services?: Partial<RuntimeServices>;
};

const ANSI_RESET = "\u001B[0m";
const ANSI_GREEN = "\u001B[32m";
const ANSI_RED = "\u001B[31m";
const ANSI_YELLOW = "\u001B[33m";
const ANSI_BLUE = "\u001B[34m";
const ANSI_DIM = "\u001B[2m";

function shouldUseColor(stream?: NodeJS.WriteStream): boolean {
  if (!stream?.isTTY) {
    return false;
  }

  if (process.env.NO_COLOR === "1") {
    return false;
  }

  if (process.env.FORCE_COLOR === "0") {
    return false;
  }

  return true;
}

function colorize(stream: NodeJS.WriteStream | undefined, color: string, text: string): string {
  if (!shouldUseColor(stream)) {
    return text;
  }

  return `${color}${text}${ANSI_RESET}`;
}

function statusColor(stream: NodeJS.WriteStream | undefined, value: number): string {
  if (value > 0) {
    return colorize(stream, ANSI_RED, `${value}`);
  }

  return colorize(stream, ANSI_DIM, `${value}`);
}

export function resolveRuntimeProfile(profileName: HookProfileName): HookRuntimeProfile {
  const profile = resolveRuntimeProfileConfig(profileName);
  return {
    name: profile.name,
    phases: [...profile.phases],
    fallbackMetrics: [...profile.fallbackMetrics],
  } satisfies HookRuntimeProfile;
}

export async function runRuntime(
  options: HookRuntimeOptions,
  profileName: HookProfileName,
  overrides: RuntimeExecutionOverrides = {},
): Promise<void> {
  await runHookRuntime(options, resolveRuntimeProfile(profileName), overrides);
}

export function formatReviewPhaseLabel(result: ReviewPhaseResult): string {
  if (result.status === "unavailable") {
    return result.bypassed ? "unavailable (bypassed)" : "unavailable";
  }

  if (result.status === "blocked") {
    return "blocked";
  }

  if (result.status === "error") {
    return "error";
  }

  return "passed";
}

function emitEvent(outputMode: HookRuntimeOutputMode, event: Record<string, unknown>): void {
  if (outputMode !== "jsonl") {
    return;
  }

  const payload = { ts: new Date().toISOString(), ...event };
  console.log(JSON.stringify(payload));
}

function logPhaseHeader(phase: string, step: number, outputMode: HookRuntimeOutputMode, total: number): void {
  if (outputMode === "human") {
    console.log(colorize(process.stdout, ANSI_BLUE, `[phase ${step}/${total}] ${phase}`));
  }
}

function buildFixPrompt(profileName: string, results: MetricExecution[]): string {
  const sections = results
    .filter((result) => !result.passed)
    .map((result) => {
      const body = tailOutput(result.output, 8_000).trim();
      return `## ${result.metric.name}\n\`\`\`\n${body}\n\`\`\``;
    })
    .join("\n\n");

  return [
    `${profileName} fitness checks failed. Please fix the following issues:`,
    "",
    sections,
    "",
    `After fixing all issues, rerun the ${profileName} flow and verify it passes.`,
  ].join("\n");
}

function runClaudeFix(prompt: string): Promise<number> {
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

function hasClaudeBinary(): Promise<boolean> {
  return runCommand("command -v claude", { stream: false }).then((cmd) => cmd.exitCode === 0);
}

export function resolveFailureRoute(
  _options: HookRuntimeOptions,
  routeContext: FailureRouteContext,
  resolverContext: FailureRouteResolverContext,
): FailureRoute {
  if (routeContext.isAiAgent) {
    return {
      name: "agent",
      execute: async () => {
        throw new Error("Running in AI agent environment. Please fix the errors shown above.");
      },
    };
  }

  if (!routeContext.hasClaude) {
    return {
      name: "missing-claude",
      execute: async () => {
        throw new Error("Claude CLI not found. Please fix errors manually.");
      },
    };
  }

  if (resolverContext.autoFix) {
    return {
      name: "auto-fix",
      execute: async (results, failureOptions) => {
        if (failureOptions.outputMode === "human") {
          console.log("Starting Claude to fix issues...");
          console.log("");
        }

        const exitCode = await runClaudeFix(buildFixPrompt(failureOptions.profile, results));
        if (exitCode !== 0) {
          throw new Error("Claude fix attempt failed.");
        }

        throw new Error(
          `Claude has attempted to fix the issues. Please review the changes and rerun ${failureOptions.profile}.`,
        );
      },
    };
  }

  return {
    name: "interactive",
    execute: async (results, failureOptions) => {
      const shouldFix = await promptYesNo("Would you like Claude to fix these issues? [y/N]");
      if (!shouldFix) {
        throw new Error("Aborted. Please fix errors manually.");
      }

      if (failureOptions.outputMode === "human") {
        console.log("Starting Claude to fix issues...");
        console.log("");
      }

      const exitCode = await runClaudeFix(buildFixPrompt(failureOptions.profile, results));
      if (exitCode !== 0) {
        throw new Error("Claude fix attempt failed.");
      }

      throw new Error(
        `Claude has attempted to fix the issues. Please review the changes and rerun ${failureOptions.profile}.`,
      );
    },
  };
}

async function handleFitnessFailure(
  results: MetricExecution[],
  options: HookRuntimeOptions,
  failureRouteResolver: FailureRouteResolver,
): Promise<never> {
  if (options.outputMode === "human") {
    const failures = summarizeFailures(results);
    if (failures.length > 0) {
      console.log(
        colorize(process.stdout, ANSI_RED, `[fitness] FAIL ${failures.length} metric(s): ${failures.map((failure) => failure.name).join(", ")}`),
      );
      console.log("");
    }
    printFailureSummary(results);
  }

  emitEvent(options.outputMode, {
    event: "fitness.failed",
    phase: "fitness",
    status: "failed",
    failures: summarizeFailures(results),
  });

  const hasClaude = await hasClaudeBinary();
  const route = failureRouteResolver(
    options,
    {
      isAiAgent: isAiAgent(),
      hasClaude,
    },
    {
      outputMode: options.outputMode,
      autoFix: options.autoFix,
    },
  );
  await route.execute(results, options);
  throw new Error(`unreachable failure route ${route.name}`);
}

async function runSubmodulePhase(
  dryRun: boolean,
  outputMode: HookRuntimeOutputMode,
  step: number,
  totalSteps: number,
): Promise<HookPhaseResult> {
  const startedAt = Date.now();
  logPhaseHeader("submodule refs", step, outputMode, totalSteps);
  emitEvent(outputMode, {
    event: "phase.start",
    phase: "submodule",
    index: step,
    total: totalSteps,
  });

  if (dryRun) {
    emitEvent(outputMode, {
      event: "phase.skip",
      phase: "submodule",
      status: "skipped",
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

async function runFitnessPhase(
  options: HookRuntimeOptions,
  step: number,
  totalSteps: number,
  metricProvider: HookMetricProvider,
  failureRouteResolver: FailureRouteResolver,
): Promise<MetricExecution[]> {
  logPhaseHeader("local fitness", step, options.outputMode, totalSteps);
  emitEvent(options.outputMode, {
    event: "phase.start",
    phase: "fitness",
    index: step,
    total: totalSteps,
    jobs: options.jobs,
  });

  if (options.dryRun) {
    const metrics = await metricProvider.loadMetrics(options.metricNames);
    if (options.outputMode === "human") {
      console.log(`[fitness] Metrics (${options.jobs} workers): ${options.metricNames.join(", ")}`);
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
      metrics: options.metricNames,
    });
    return [];
  }

  const metrics = await metricProvider.loadMetrics(options.metricNames);
  const { parallelMetrics, serialMetrics } = splitMetricsByExecutionMode(metrics);
  const metricOrder = new Map(metrics.map((metric, index) => [metric, index + 1]));
  const fitnessChangedBase = await resolveFitnessChangedBase();
  const reporter =
    options.outputMode === "human"
      ? createHumanMetricReporter(metrics, {
          concurrency: options.jobs,
          stream: process.stdout,
          tailLines: options.tailLines,
        }, options.verboseMetrics)
      : null;
  const startedAt = Date.now();
  let reporterClosed = false;

  reporter?.start();

  try {
    const runMetricBatch = async (
      batchMetrics: HookMetric[],
      concurrency: number,
    ) => runMetrics(
      batchMetrics,
      async (metric) =>
        runMetric(metric, {
          env: {
            NODE_ENV: process.env.NODE_ENV ?? "test",
            ROUTA_HOOK_RUNTIME_PROFILE: options.profile,
            ROUTA_FITNESS_CHANGED_BASE: fitnessChangedBase,
          },
          onOutput: (event) => reporter?.onMetricOutput(metric.name, event),
        }),
      {
        concurrency,
        failFast: options.failFast,
        onMetricStart: (metric) => {
          const displayIndex = metricOrder.get(metric) ?? 0;
          reporter?.onMetricStart(metric, displayIndex, metrics.length);
          emitEvent(options.outputMode, {
            event: "metric.start",
            phase: "fitness",
            name: metric.name,
            index: displayIndex,
            total: metrics.length,
            sourceFile: metric.sourceFile,
            command: metric.command,
          });
        },
        onMetricComplete: (result) => {
          const displayIndex = metricOrder.get(result.metric) ?? 0;
          reporter?.onMetricComplete(result, displayIndex, metrics.length);
          emitEvent(options.outputMode, {
            event: "metric.complete",
            phase: "fitness",
            name: result.metric.name,
            index: displayIndex,
            total: metrics.length,
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

    const parallelBatch = await runMetricBatch(parallelMetrics, options.jobs);
    const shouldRunSerialBatch = !options.failFast || parallelBatch.results.every((result) => result.passed);
    const serialBatch = shouldRunSerialBatch
      ? await runMetricBatch(serialMetrics, 1)
      : {
          results: [] as MetricExecution[],
          skippedMetrics: serialMetrics,
        };
    const batch = {
      results: [...parallelBatch.results, ...serialBatch.results],
      skippedMetrics: [...parallelBatch.skippedMetrics, ...serialBatch.skippedMetrics],
    };
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
        const skippedCount = statusColor(process.stdout, batch.skippedMetrics.length);
        const skippedList = batch.skippedMetrics.map((metric) => metric.name).join(", ");
        console.log(
          colorize(
            process.stdout,
            ANSI_YELLOW,
            `[fitness] ⚠ SKIP ${skippedCount} queued metrics unstarted: ${skippedList}`,
          ),
        );
      }
    }

    const durationMs = Date.now() - startedAt;
    const passed = batch.results.filter((result) => result.passed).length;
    const failed = batch.results.length - passed;
    const skipped = batch.skippedMetrics.length;
    if (options.outputMode === "human") {
      const summary = `[fitness] summary: ${colorize(process.stdout, ANSI_GREEN, `${passed} passed`)}, `
        + `${colorize(process.stdout, failed > 0 ? ANSI_RED : ANSI_GREEN, `${failed} failed`)}, `
        + `${colorize(process.stdout, skipped > 0 ? ANSI_YELLOW : ANSI_DIM, `${skipped} skipped`)} | ${formatDuration(
          durationMs,
        )}`;
      console.log(
        summary,
      );
      console.log("");
    }

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
      await handleFitnessFailure(batch.results, options, failureRouteResolver);
    }

    return batch.results;
  } finally {
    if (!reporterClosed) {
      reporter?.close();
    }
  }
}

async function resolveFitnessChangedBase(): Promise<string> {
  const explicitBase = process.env.ROUTA_FITNESS_CHANGED_BASE?.trim();
  if (explicitBase) {
    return explicitBase;
  }

  const upstream = await runCommand("git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'", {
    stream: false,
  });
  if (upstream.exitCode === 0) {
    const base = upstream.output.trim();
    if (base) {
      return base;
    }
  }

  for (const candidate of ["origin/main", "main", "origin/master", "master", "HEAD~1"]) {
    const probe = await runCommand(`git rev-parse --verify '${candidate}'`, {
      stream: false,
    });
    if (probe.exitCode === 0) {
      return candidate;
    }
  }

  return "HEAD";
}

async function runReviewPhase(
  dryRun: boolean,
  outputMode: HookRuntimeOutputMode,
  step: number,
  totalSteps: number,
  reviewProvider: ReviewProvider,
): Promise<ReviewPhaseResult | null> {
  emitEvent(outputMode, {
    event: "phase.start",
    phase: "review",
    index: step,
    total: totalSteps,
  });

  if (dryRun) {
    if (outputMode === "human") {
      console.log(`[phase ${step}/${totalSteps}] review checks skipped in dry-run.`);
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
  const result = await reviewProvider.runReview(outputMode);
  if (outputMode === "human") {
    console.log(`[phase ${step}/${totalSteps}] review checks ${formatReviewPhaseLabel(result)}`);
  }
  emitEvent(outputMode, {
    event: "phase.complete",
    phase: "review",
    status: result.allowed ? "passed" : "failed",
    allowed: result.allowed,
    durationMs: Date.now() - startedAt,
    base: result.base,
    bypassed: result.bypassed,
    matched: result.triggers.length,
    changedFiles: result.changedFiles,
    committedFiles: result.committedFiles,
    workingTreeFiles: result.workingTreeFiles,
    untrackedFiles: result.untrackedFiles,
    diffFileCount: result.diffFileCount,
    message: result.message,
    reviewStatus: result.status,
  });

  return result;
}

const DEFAULT_RUNTIME_SERVICES: RuntimeServices = {
  metricProvider: { loadMetrics: loadHookMetrics },
  reviewProvider: { runReview: runReviewTriggerPhase },
  failureRouteResolver: resolveFailureRoute,
};

function makeRuntimeAdapters(
  services: RuntimeServices,
): RuntimePhaseAdapters {
  return {
    runSubmodulePhase,
    runFitnessPhase: (runtimeOptions, step, totalSteps) =>
      runFitnessPhase(runtimeOptions, step, totalSteps, services.metricProvider, services.failureRouteResolver),
    runReviewPhase: (dryRun, outputMode, step, totalSteps) =>
      runReviewPhase(dryRun, outputMode, step, totalSteps, services.reviewProvider),
  };
}

export async function runHookRuntime(
  options: HookRuntimeOptions,
  runtimeProfile: HookRuntimeProfile,
  overrides: RuntimeExecutionOverrides = {},
): Promise<void> {
  const phaseAdapters = {
    ...makeRuntimeAdapters({
      ...DEFAULT_RUNTIME_SERVICES,
      ...overrides.services,
    }),
    ...overrides.phaseAdapters,
  };

  emitEvent(options.outputMode, {
    event: "hook.start",
    profile: options.profile,
    mode: options.outputMode,
    dryRun: options.dryRun,
    autoFix: options.autoFix,
    failFast: options.failFast,
    jobs: options.jobs,
    metrics: options.metricNames,
    profilePhases: runtimeProfile.phases,
    tailLines: options.tailLines,
  });

  let reviewResult: ReviewPhaseResult | null = null;
  const startedAt = Date.now();
  for (let index = 0; index < runtimeProfile.phases.length; index += 1) {
    const step = index + 1;
    const totalSteps = runtimeProfile.phases.length;
    const phase = runtimeProfile.phases[index];

    if (phase === "submodule") {
      await phaseAdapters.runSubmodulePhase(options.dryRun, options.outputMode, step, totalSteps);
      continue;
    }

    if (phase === "fitness" || phase === "fitness-fast") {
      await phaseAdapters.runFitnessPhase(options, step, totalSteps);
      continue;
    }

    reviewResult = await phaseAdapters.runReviewPhase(options.dryRun, options.outputMode, step, totalSteps);
  }

  if (!options.dryRun && reviewResult && !reviewResult.allowed) {
    throw new Error(reviewResult.message);
  }

  emitEvent(options.outputMode, {
    event: "hook.complete",
    status: "passed",
    durationMs: Date.now() - startedAt,
  });

  if (options.outputMode === "human") {
    console.log(colorize(process.stdout, ANSI_GREEN, "All checks passed! Ready to continue."));
  }
}
