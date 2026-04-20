import { describe, expect, it } from "vitest";

import {
  extractJsonOutput,
  formatEntrixAutoresearchOutput,
  formatEntrixMetricLines,
  summarizeEntrixReport,
} from "../entrix-runner";

describe("entrix-runner helpers", () => {
  it("extracts the trailing JSON object from command output", () => {
    const json = extractJsonOutput([
      "running metrics...",
      "{",
      '  "final_score": 92.5,',
      '  "hard_gate_blocked": false,',
      '  "score_blocked": false,',
      '  "dimensions": []',
      "}",
    ].join("\n"));

    expect(JSON.parse(json)).toMatchObject({
      final_score: 92.5,
      hard_gate_blocked: false,
    });
  });

  it("summarizes failing dimensions and metrics from an entrix report", () => {
    const summary = summarizeEntrixReport({
      final_score: 87.5,
      hard_gate_blocked: true,
      score_blocked: false,
      dimensions: [
        {
          name: "code_quality",
          score: 87.5,
          passed: 7,
          total: 8,
          hard_gate_failures: ["ts_typecheck_pass"],
          results: [
            {
              name: "eslint_pass",
              state: "pass",
              passed: true,
              hard_gate: true,
              tier: "fast",
            },
            {
              name: "ts_typecheck_pass",
              state: "fail",
              passed: false,
              hard_gate: true,
              tier: "fast",
              duration_ms: 9420.9,
              output: "Type error: something broke",
            },
          ],
        },
      ],
    });

    expect(summary).toMatchObject({
      finalScore: 87.5,
      hardGateBlocked: true,
      dimensionCount: 1,
      metricCount: 8,
      failingMetricCount: 1,
      passRate: 0.875,
    });
    expect(summary.dimensions[0]).toMatchObject({
      name: "code_quality",
      hardGateFailures: ["ts_typecheck_pass"],
    });
    expect(summary.dimensions[0]?.failingMetrics[0]).toMatchObject({
      name: "ts_typecheck_pass",
      state: "fail",
      hardGate: true,
    });
  });

  it("formats EntrixRunResponse as METRIC lines for autoresearch", () => {
    const response = {
      generatedAt: "2026-04-20T00:00:00Z",
      repoRoot: "/tmp/test",
      tier: "fast" as const,
      scope: "local" as const,
      command: "entrix",
      args: ["run", "--tier", "fast", "--json"],
      durationMs: 12345,
      exitCode: 0,
      report: {
        finalScore: 95.0,
        hardGateBlocked: false,
        scoreBlocked: false,
        dimensions: [],
      },
      summary: {
        finalScore: 95.0,
        hardGateBlocked: false,
        scoreBlocked: false,
        dimensionCount: 2,
        metricCount: 10,
        failingMetricCount: 1,
        dimensions: [],
        slowestMetricMs: 5200,
        checksCount: 10,
        failedChecks: 1,
        passRate: 0.9,
        durationMs: 12345,
      },
    };

    const output = formatEntrixMetricLines(response);
    const lines = output.split("\n");

    expect(lines).toContain("METRIC fitness_ms=12345");
    expect(lines).toContain("METRIC checks_count=10");
    expect(lines).toContain("METRIC failed_checks=1");
    expect(lines).toContain("METRIC top_slowest_ms=5200");
    expect(lines).toContain("METRIC pass_rate=0.9");
    expect(lines).toContain("METRIC hard_gate_hits=0");
    expect(lines).toContain("METRIC final_score=95");
  });

  it("adds checks_failed gate line when hard gate blocks the run", () => {
    const response = {
      generatedAt: "2026-04-20T00:00:00Z",
      repoRoot: "/tmp/test",
      tier: "fast" as const,
      scope: "local" as const,
      command: "entrix",
      args: ["run", "--tier", "fast", "--json"],
      durationMs: 9000,
      exitCode: 1,
      report: {
        finalScore: 72.5,
        hardGateBlocked: true,
        scoreBlocked: false,
        dimensions: [],
      },
      summary: {
        finalScore: 72.5,
        hardGateBlocked: true,
        scoreBlocked: false,
        dimensionCount: 1,
        metricCount: 3,
        failingMetricCount: 1,
        dimensions: [],
        slowestMetricMs: 4100,
        checksCount: 3,
        failedChecks: 1,
        passRate: 0.6667,
        durationMs: 9000,
      },
    };

    const output = formatEntrixAutoresearchOutput(response);

    expect(output).toContain("METRIC fitness_ms=9000");
    expect(output).toContain("METRIC hard_gate_hits=1");
    expect(output).toContain("checks_failed=1");
  });
});
