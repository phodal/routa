#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { fromRoot } from "../lib/paths";

export type SourceSummary = {
  status: "sampled" | "missing";
  generated_at_ms: number | null;
  artifact_path: string | null;
  line_percent: number | null;
  branch_percent: number | null;
  function_percent: number | null;
  statement_percent: number | null;
  region_percent: number | null;
};

export type CoverageSummaryRecord = {
  schema_version: number;
  generated_at_ms: number;
  sources: {
    typescript: SourceSummary;
    rust: SourceSummary;
  };
};

export function readJson(filePath: string): unknown | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function fileMtimeMs(filePath: string): number | null {
  try {
    return Math.trunc(fs.statSync(filePath).mtimeMs);
  } catch {
    return null;
  }
}

export function asPercent(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, value));
  }
  return null;
}

export function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function pickPercent(candidate: Record<string, unknown> | null): number | null {
  if (!candidate) {
    return null;
  }
  return asPercent(candidate.percent) ?? asPercent(candidate.pct);
}

export function parseTypescriptSummary(filePath: string): SourceSummary {
  const payload = asObject(readJson(filePath));
  const total = asObject(payload?.total);
  const lines = pickPercent(asObject(total?.lines));
  const branches = pickPercent(asObject(total?.branches));
  const functions = pickPercent(asObject(total?.functions));
  const statements = pickPercent(asObject(total?.statements));
  const sampled = [lines, branches, functions, statements].some((value) => value !== null);
  return {
    status: sampled ? "sampled" : "missing",
    generated_at_ms: sampled ? fileMtimeMs(filePath) : null,
    artifact_path: sampled ? path.relative(fromRoot(), filePath) : null,
    line_percent: lines,
    branch_percent: branches,
    function_percent: functions,
    statement_percent: statements,
    region_percent: null,
  };
}

export function extractRustSummaryCandidate(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const nested of value) {
      const found = extractRustSummaryCandidate(nested);
      if (found) {
        return found;
      }
    }
    return null;
  }

  const object = asObject(value);
  if (!object) {
    return null;
  }

  for (const key of ["totals", "summary"]) {
    const nestedSummary = asObject(object[key]);
    if (nestedSummary) {
      const hasCoverageKeys = ["lines", "functions", "regions"].some((coverageKey) => {
        const entry = asObject(nestedSummary[coverageKey]);
        return pickPercent(entry) !== null;
      });
      if (hasCoverageKeys) {
        return nestedSummary;
      }
    }
  }

  const hasCoverageKeys = ["lines", "functions", "regions"].some((key) => {
    const entry = asObject(object[key]);
    return pickPercent(entry) !== null;
  });
  if (hasCoverageKeys) {
    return object;
  }

  for (const nested of Object.values(object)) {
    const found = extractRustSummaryCandidate(nested);
    if (found) {
      return found;
    }
  }
  return null;
}

export function parseRustSummary(filePath: string): SourceSummary {
  const payload = readJson(filePath);
  const totals = extractRustSummaryCandidate(payload);
  const lines = pickPercent(asObject(totals?.lines));
  const functions = pickPercent(asObject(totals?.functions));
  const regions = pickPercent(asObject(totals?.regions));
  const sampled = [lines, functions, regions].some((value) => value !== null);
  return {
    status: sampled ? "sampled" : "missing",
    generated_at_ms: sampled ? fileMtimeMs(filePath) : null,
    artifact_path: sampled ? path.relative(fromRoot(), filePath) : null,
    line_percent: lines,
    branch_percent: null,
    function_percent: functions,
    statement_percent: null,
    region_percent: regions,
  };
}

export function missingSummary(): SourceSummary {
  return {
    status: "missing",
    generated_at_ms: null,
    artifact_path: null,
    line_percent: null,
    branch_percent: null,
    function_percent: null,
    statement_percent: null,
    region_percent: null,
  };
}

export function buildCoverageSummaryRecord(): CoverageSummaryRecord {
  const targetDir = fromRoot("target", "coverage");
  fs.mkdirSync(targetDir, { recursive: true });

  const tsSummaryPath = fromRoot("coverage", "coverage-summary.json");
  const rustSummaryPath = fromRoot("target", "coverage", "routa-core.summary.json");

  return {
    schema_version: 1,
    generated_at_ms: Date.now(),
    sources: {
      typescript: fs.existsSync(tsSummaryPath)
        ? parseTypescriptSummary(tsSummaryPath)
        : missingSummary(),
      rust: fs.existsSync(rustSummaryPath)
        ? parseRustSummary(rustSummaryPath)
        : missingSummary(),
    },
  };
}

export function writeCoverageSummary(): string {
  const record = buildCoverageSummaryRecord();
  const outputPath = fromRoot("target", "coverage", "fitness-summary.json");
  fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return outputPath;
}

function main(): void {
  const outputPath = writeCoverageSummary();
  console.log(`Coverage summary written to ${path.relative(fromRoot(), outputPath)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
