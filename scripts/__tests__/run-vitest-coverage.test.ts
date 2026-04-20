import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  formatTypescriptCoverageSummary,
  resolveTsCoverageThreshold,
  validateTypescriptCoverage,
} from "../fitness/run-vitest-coverage";
import { parseTypescriptSummary } from "../fitness/write-coverage-summary";

const tempDirs: string[] = [];

function writeCoverageSummary(payload: unknown): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "routa-ts-coverage-"));
  tempDirs.push(tempDir);
  const filePath = path.join(tempDir, "coverage-summary.json");
  fs.writeFileSync(filePath, JSON.stringify(payload), "utf8");
  return filePath;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("run-vitest-coverage helpers", () => {
  it("parses Vitest json-summary totals into percentages", () => {
    const filePath = writeCoverageSummary({
      total: {
        lines: { pct: 82.5 },
        branches: { pct: 70.1 },
        functions: { pct: 88.2 },
        statements: { pct: 83.9 },
      },
    });

    const summary = parseTypescriptSummary(filePath);

    expect(summary.status).toBe("sampled");
    expect(Number.isInteger(summary.generated_at_ms)).toBe(true);
    expect(summary.line_percent).toBe(82.5);
    expect(summary.branch_percent).toBe(70.1);
    expect(summary.function_percent).toBe(88.2);
    expect(summary.statement_percent).toBe(83.9);
  });

  it("fails validation when line coverage is below threshold", () => {
    const result = validateTypescriptCoverage({
      status: "sampled",
      generated_at_ms: null,
      artifact_path: "coverage/coverage-summary.json",
      line_percent: 79.9,
      branch_percent: 70,
      function_percent: 88,
      statement_percent: 81,
      region_percent: null,
    }, 80);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("79.9%");
    expect(result.message).toContain("80.0%");
  });

  it("formats missing metrics clearly", () => {
    const summaryLine = formatTypescriptCoverageSummary({
      status: "missing",
      generated_at_ms: null,
      artifact_path: null,
      line_percent: null,
      branch_percent: null,
      function_percent: null,
      statement_percent: null,
      region_percent: null,
    }, 80);

    expect(summaryLine).toContain("lines missing");
    expect(summaryLine).toContain("threshold 80.0%");
  });

  it("uses the default threshold when the environment override is invalid", () => {
    expect(resolveTsCoverageThreshold("nope")).toBe(80);
    expect(resolveTsCoverageThreshold("101")).toBe(80);
    expect(resolveTsCoverageThreshold("-1")).toBe(80);
    expect(resolveTsCoverageThreshold("85")).toBe(85);
  });
});
