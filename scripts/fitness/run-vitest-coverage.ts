#!/usr/bin/env node

import { spawnSync } from "node:child_process";

import { fromRoot } from "../lib/paths";
import { quietNodeEnv, sanitizedNodeEnv } from "../lib/node-env";
import { type SourceSummary, parseTypescriptSummary } from "./write-coverage-summary";

export const DEFAULT_TS_LINE_COVERAGE_THRESHOLD = 80;

function formatPercent(value: number | null): string {
  return value === null ? "missing" : `${value.toFixed(1)}%`;
}

export function resolveTsCoverageThreshold(
  raw = process.env.ROUTA_TS_COVERAGE_MIN_PERCENT,
): number {
  const value = Number(raw);
  if (Number.isFinite(value) && value >= 0 && value <= 100) {
    return value;
  }
  return DEFAULT_TS_LINE_COVERAGE_THRESHOLD;
}

export function formatTypescriptCoverageSummary(
  summary: SourceSummary,
  threshold: number,
): string {
  return [
    `TS coverage lines ${formatPercent(summary.line_percent)}`,
    `branches ${formatPercent(summary.branch_percent)}`,
    `functions ${formatPercent(summary.function_percent)}`,
    `statements ${formatPercent(summary.statement_percent)}`,
    `threshold ${threshold.toFixed(1)}%`,
  ].join(" | ");
}

export function validateTypescriptCoverage(
  summary: SourceSummary,
  threshold: number,
): { ok: boolean; message: string } {
  if (summary.status !== "sampled" || summary.line_percent === null) {
    return {
      ok: false,
      message: `TS coverage summary is missing line coverage data (required ${threshold.toFixed(1)}%).`,
    };
  }

  if (summary.line_percent < threshold) {
    return {
      ok: false,
      message: `TS line coverage ${summary.line_percent.toFixed(1)}% is below required ${threshold.toFixed(1)}%.`,
    };
  }

  return {
    ok: true,
    message: `TS line coverage ${summary.line_percent.toFixed(1)}% meets required ${threshold.toFixed(1)}%.`,
  };
}

function run(): number {
  const vitestResult = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [
      "vitest",
      "run",
      "--coverage",
      "--coverage.provider=v8",
      "--coverage.reporter=json-summary",
    ],
    {
      cwd: fromRoot(),
      env: quietNodeEnv(),
      stdio: "inherit",
    },
  );

  if (vitestResult.status !== 0) {
    return vitestResult.status ?? 1;
  }

  const aggregateResult = spawnSync(
    process.execPath,
    ["--import", "tsx", fromRoot("scripts", "fitness", "write-coverage-summary.ts")],
    {
      cwd: fromRoot(),
      env: sanitizedNodeEnv(),
      stdio: "inherit",
    },
  );

  if (aggregateResult.status !== 0) {
    return aggregateResult.status ?? 1;
  }

  const threshold = resolveTsCoverageThreshold();
  const summary = parseTypescriptSummary(fromRoot("coverage", "coverage-summary.json"));
  console.log(formatTypescriptCoverageSummary(summary, threshold));

  const validation = validateTypescriptCoverage(summary, threshold);
  if (!validation.ok) {
    console.error(validation.message);
    return 1;
  }

  console.log(validation.message);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(run());
}
