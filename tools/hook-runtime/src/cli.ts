#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_PARALLEL_JOBS,
  DEFAULT_TAIL_LINES,
  isHookProfileName,
  PROFILE_DEFAULT,
  parseMetricNames,
  parsePositiveInt,
  type HookProfileName,
  type RuntimePhase,
} from "./config.js";
import {
  resolveRuntimeProfile,
  runRuntime,
  type HookRuntimeOptions,
} from "./runtime.js";

export { formatReviewPhaseLabel } from "./runtime.js";

type CliOptions = HookRuntimeOptions & {
  profilePhases: readonly RuntimePhase[];
  allowReviewUnavailable: boolean;
  reviewProvider?: string;
};

function parseOutputMode(raw: string | undefined): "human" | "jsonl" {
  if (raw === "jsonl") {
    return "jsonl";
  }
  return "human";
}

function normalizeProfile(raw: string | undefined): HookProfileName {
  if (!raw) {
    return PROFILE_DEFAULT;
  }

  const normalized = raw.trim().toLowerCase();
  return isHookProfileName(normalized) ? normalized : PROFILE_DEFAULT;
}

function parseProfileFromArgv(argv: string[]): HookProfileName | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--profile" && i + 1 < argv.length) {
      return normalizeProfile(argv[i + 1]);
    }
    if (arg.startsWith("--profile=")) {
      return normalizeProfile(arg.slice("--profile=".length));
    }
  }
  return undefined;
}

function normalizeRuntimeArgv(argv: string[]): string[] {
  if (argv[0] === "run") {
    return argv.slice(1);
  }
  return argv;
}

export function parseArgs(argv: string[]): CliOptions {
  const runtimeArgv = normalizeRuntimeArgv(argv);
  const normalizedProfileFromArg = parseProfileFromArgv(runtimeArgv);
  const envProfile = normalizeProfile(process.env.ROUTA_HOOK_RUNTIME_PROFILE);
  const requestedProfile = normalizedProfileFromArg ?? envProfile ?? PROFILE_DEFAULT;
  const profileDefinition = resolveRuntimeProfile(requestedProfile);

  const options: CliOptions = {
    autoFix: false,
    dryRun: false,
    failFast: true,
    jobs: parsePositiveInt(process.env.ROUTA_HOOK_RUNTIME_JOBS, DEFAULT_PARALLEL_JOBS),
    metricNames: parseMetricNames(process.env.ROUTA_HOOK_RUNTIME_METRICS, profileDefinition.fallbackMetrics),
    outputMode: parseOutputMode(process.env.ROUTA_HOOK_RUNTIME_OUTPUT_MODE),
    profile: requestedProfile,
    profilePhases: profileDefinition.phases,
    allowReviewUnavailable: process.env.ROUTA_ALLOW_REVIEW_UNAVAILABLE === "1",
    reviewProvider: process.env.ROUTA_REVIEW_PROVIDER?.trim() || undefined,
    tailLines: parsePositiveInt(process.env.ROUTA_HOOK_RUNTIME_TAIL_LINES, DEFAULT_TAIL_LINES),
    verboseMetrics: process.env.ROUTA_HOOK_RUNTIME_VERBOSE_METRICS === "1",
  };
  let hasExplicitMetrics = Boolean(process.env.ROUTA_HOOK_RUNTIME_METRICS);

  for (let i = 0; i < runtimeArgv.length; i += 1) {
    const arg = runtimeArgv[i];
    if (arg === "--profile" && i + 1 < runtimeArgv.length) {
      options.profile = normalizeProfile(runtimeArgv[i + 1]);
      const selectedProfile = resolveRuntimeProfile(options.profile);
      options.profilePhases = selectedProfile.phases;

      if (!hasExplicitMetrics && !process.env.ROUTA_HOOK_RUNTIME_METRICS) {
        options.metricNames = parseMetricNames(undefined, selectedProfile.fallbackMetrics);
      }
      i += 1;
      continue;
    }
    if (arg.startsWith("--profile=")) {
      options.profile = normalizeProfile(arg.slice("--profile=".length));
      const selectedProfile = resolveRuntimeProfile(options.profile);
      options.profilePhases = selectedProfile.phases;

      if (!hasExplicitMetrics && !process.env.ROUTA_HOOK_RUNTIME_METRICS) {
        options.metricNames = parseMetricNames(undefined, selectedProfile.fallbackMetrics);
      }
      continue;
    }
    if (arg === "--fix") {
      options.autoFix = true;
      continue;
    }
    if (arg === "--provider" && i + 1 < runtimeArgv.length) {
      options.reviewProvider = runtimeArgv[i + 1]?.trim() || undefined;
      i += 1;
      continue;
    }
    if (arg.startsWith("--provider=")) {
      options.reviewProvider = arg.slice("--provider=".length).trim() || undefined;
      continue;
    }
    if (arg === "--allow-review-unavailable" || arg === "--allow-review-scope-mismatch") {
      options.allowReviewUnavailable = true;
      continue;
    }
    if (arg === "--disallow-review-unavailable") {
      options.allowReviewUnavailable = false;
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
    if (arg === "--metrics" && i + 1 < runtimeArgv.length) {
      options.metricNames = parseMetricNames(runtimeArgv[i + 1]);
      hasExplicitMetrics = true;
      i += 1;
      continue;
    }
    if (arg.startsWith("--metrics=")) {
      options.metricNames = parseMetricNames(arg.slice("--metrics=".length));
      hasExplicitMetrics = true;
      continue;
    }
    if (arg === "--jobs" && i + 1 < runtimeArgv.length) {
      options.jobs = parsePositiveInt(runtimeArgv[i + 1], options.jobs);
      i += 1;
      continue;
    }
    if (arg.startsWith("--jobs=")) {
      options.jobs = parsePositiveInt(arg.slice("--jobs=".length), options.jobs);
      continue;
    }
    if (arg === "--output" && i + 1 < runtimeArgv.length) {
      options.outputMode = parseOutputMode(runtimeArgv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      options.outputMode = parseOutputMode(arg.slice("--output=".length));
      continue;
    }
    if (arg === "--tail-lines" && i + 1 < runtimeArgv.length) {
      options.tailLines = parsePositiveInt(runtimeArgv[i + 1], options.tailLines);
      i += 1;
      continue;
    }
    if (arg.startsWith("--tail-lines=")) {
      options.tailLines = parsePositiveInt(arg.slice("--tail-lines=".length), options.tailLines);
      continue;
    }
    if (arg === "--verbose-metrics") {
      options.verboseMetrics = true;
      continue;
    }
    if (arg === "--concise-metrics") {
      options.verboseMetrics = false;
      continue;
    }
  }

  const finalProfile = resolveRuntimeProfile(options.profile);
  options.profilePhases = finalProfile.phases;

  if (!options.metricNames.length) {
    options.metricNames = parseMetricNames(
      process.env.ROUTA_HOOK_RUNTIME_METRICS,
      finalProfile.fallbackMetrics,
    );
  }

  return options;
}

export function handleCliError(error: unknown, argv: string[] = process.argv.slice(2)): void {
  const { outputMode } = parseArgs(argv);
  const message = error instanceof Error ? error.message : String(error);
  if (outputMode === "jsonl") {
    console.log(
      JSON.stringify({
        event: "hook.error",
        status: "failed",
        message,
        ts: new Date().toISOString(),
      }),
    );
  }

  if (outputMode === "human") {
    console.error(message);
  }
  process.exitCode = 1;
}

export async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.allowReviewUnavailable) {
    process.env.ROUTA_ALLOW_REVIEW_UNAVAILABLE = "1";
  }
  if (options.reviewProvider) {
    process.env.ROUTA_REVIEW_PROVIDER = options.reviewProvider;
  }
  await runRuntime(options, options.profile);
}

const modulePath = path.resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (invokedPath === modulePath) {
  void main().catch((error) => {
    handleCliError(error);
  });
}
