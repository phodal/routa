import { describe, expect, it } from "vitest";

import { extractJsonOutput, summarizeEntrixReport } from "../entrix-runner";

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
});
