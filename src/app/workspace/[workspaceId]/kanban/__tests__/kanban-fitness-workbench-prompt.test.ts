import { describe, expect, it } from "vitest";

import { buildKanbanFitnessWorkbenchUserPrompt } from "../kanban-fitness-workbench-prompt";

describe("buildKanbanFitnessWorkbenchUserPrompt", () => {
  it("injects entrix runtime data and the generated canvas sdk manifest", () => {
    const prompt = buildKanbanFitnessWorkbenchUserPrompt({
      workspaceId: "default",
      repoPath: "/tmp/demo",
      repoLabel: "demo/repo",
      branch: "main",
      entrixRun: {
        generatedAt: "2026-04-17T00:00:00.000Z",
        repoRoot: "/tmp/demo",
        tier: "fast",
        scope: "local",
        command: "entrix",
        args: ["run", "--tier", "fast", "--scope", "local", "--json"],
        durationMs: 1200,
        exitCode: 2,
        report: {
          finalScore: 87.5,
          hardGateBlocked: true,
          scoreBlocked: false,
          dimensions: [
            {
              name: "code_quality",
              score: 87.5,
              passed: 7,
              total: 8,
              hardGateFailures: ["ts_typecheck_pass"],
              results: [
                {
                  name: "eslint_pass",
                  state: "pass",
                  passed: true,
                  hardGate: true,
                  tier: "fast",
                  durationMs: 300,
                  outputSnippet: null,
                },
                {
                  name: "ts_typecheck_pass",
                  state: "fail",
                  passed: false,
                  hardGate: true,
                  tier: "fast",
                  durationMs: 800,
                  outputSnippet: "Type error",
                },
              ],
            },
          ],
        },
        summary: {
          finalScore: 87.5,
          hardGateBlocked: true,
          scoreBlocked: false,
          dimensionCount: 2,
          metricCount: 10,
          failingMetricCount: 1,
          dimensions: [
            {
              name: "code_quality",
              score: 87.5,
              passed: 7,
              total: 8,
              hardGateFailures: ["ts_typecheck_pass"],
              failingMetrics: [
                {
                  name: "ts_typecheck_pass",
                  state: "fail",
                  passed: false,
                  hardGate: true,
                  tier: "fast",
                  durationMs: 800,
                  outputSnippet: "Type error",
                },
              ],
            },
          ],
        },
      },
      specFiles: [
        {
          name: "quality.md",
          relativePath: "quality.md",
          kind: "dimension",
          language: "markdown",
          dimension: "code_quality",
          weight: 18,
          thresholdPass: 90,
          thresholdWarn: 80,
          metricCount: 1,
          metrics: [
            {
              name: "eslint_pass",
              command: "npm run lint",
              description: "lint",
              tier: "fast",
              hardGate: true,
              gate: "hard",
              runner: "shell",
              scope: ["local"],
              runWhenChanged: ["src/**"],
            },
          ],
          source: "---\ndimension: code_quality\n---\n",
          frontmatterSource: "---\ndimension: code_quality\n---",
        },
      ],
      plan: {
        generatedAt: "2026-04-17T00:00:00.000Z",
        tier: "normal",
        scope: "local",
        repoRoot: "/tmp/demo",
        dimensionCount: 1,
        metricCount: 1,
        hardGateCount: 1,
        runnerCounts: { shell: 1, graph: 0, sarif: 0 },
        dimensions: [
          {
            name: "code_quality",
            weight: 18,
            thresholdPass: 90,
            thresholdWarn: 80,
            sourceFile: "quality.md",
            metrics: [
              {
                name: "eslint_pass",
                command: "npm run lint",
                description: "lint",
                tier: "fast",
                gate: "hard",
                hardGate: true,
                runner: "shell",
                executionScope: "local",
              },
            ],
          },
        ],
      },
    });

    expect(prompt).toContain('"entrixRun"');
    expect(prompt).toContain('"report"');
    expect(prompt).toContain('"finalScore": 87.5');
    expect(prompt).toContain("Use `entrixRun.report` as the primary source of truth");
    expect(prompt).toContain('"fitnessSpecs"');
    expect(prompt).toContain("Canvas SDK access:");
    expect(prompt).toContain("read_canvas_sdk_resource");
    expect(prompt).toContain("resource://routa/canvas-sdk/manifest");
    expect(prompt).toContain("resource://routa/canvas-sdk/defs/primitives");
    expect(prompt).toContain("Import only from `@canvas-sdk` or `react`.");
    expect(prompt).not.toContain("Compact API surface:");
  });
});
