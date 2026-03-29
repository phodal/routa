import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  MarkerType: { ArrowClosed: "arrow" },
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  ReactFlow: ({ children }: { children?: ReactNode }) => <div data-testid="react-flow">{children}</div>,
}));

import { HarnessExecutionPlanFlow, type PlanResponse } from "../harness-execution-plan-flow";

const plan: PlanResponse = {
  generatedAt: "2026-03-29T00:00:00.000Z",
  tier: "normal",
  scope: "local",
  repoRoot: "/home/runner/work/routa/routa",
  dimensionCount: 1,
  metricCount: 14,
  hardGateCount: 5,
  runnerCounts: { shell: 14, graph: 0, sarif: 0 },
  dimensions: [
    {
      name: "code_quality",
      weight: 24,
      thresholdPass: 90,
      thresholdWarn: 80,
      sourceFile: "code-quality.md",
      groups: [
        {
          key: "structural_guardrails",
          name: "结构护栏",
          description: "控制文件、函数和脚本入口的膨胀速度，优先约束 blast radius",
          weight: 30,
          metricCount: 3,
          hardGateCount: 1,
          runnerCounts: { shell: 3, graph: 0, sarif: 0 },
        },
        {
          key: "duplication_and_complexity",
          name: "重复与复杂度",
          description: "防止复制粘贴、结构性重复和复杂度失控",
          weight: 25,
          metricCount: 4,
          hardGateCount: 0,
          runnerCounts: { shell: 4, graph: 0, sarif: 0 },
        },
      ],
      metrics: [
        {
          name: "legacy_hotspot_budget_guard",
          command: "echo ok",
          description: "hotspot guard",
          tier: "fast",
          gate: "hard",
          hardGate: true,
          runner: "shell",
          executionScope: "local",
          group: "structural_guardrails",
        },
      ],
    },
  ],
};

describe("HarnessExecutionPlanFlow", () => {
  it("renders the grouped classification chart for the active dimension", () => {
    render(
      <HarnessExecutionPlanFlow
        loading={false}
        error={null}
        plan={plan}
        repoLabel="routa"
        selectedTier="normal"
        onTierChange={() => {}}
      />,
    );

    expect(screen.getByText("Classification chart")).not.toBeNull();
    expect(screen.getByText("code_quality breakdown")).not.toBeNull();
    expect(screen.getByText("结构护栏")).not.toBeNull();
    expect(screen.getByText("重复与复杂度")).not.toBeNull();
    expect(screen.getByText("3 metrics")).not.toBeNull();
    expect(screen.getByText("1 hard gates")).not.toBeNull();
  });
});
