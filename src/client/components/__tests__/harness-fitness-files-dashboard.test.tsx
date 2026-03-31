import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FitnessSpecSummary } from "@/client/hooks/use-harness-settings-data";

const { responsiveContainerSpy } = vi.hoisted(() => ({
  responsiveContainerSpy: vi.fn(),
}));

vi.mock("recharts", () => ({
  PolarAngleAxis: () => <div data-testid="polar-angle-axis" />,
  PolarGrid: () => <div data-testid="polar-grid" />,
  PolarRadiusAxis: () => <div data-testid="polar-radius-axis" />,
  Radar: () => <div data-testid="radar" />,
  RadarChart: ({ children }: { children: ReactNode }) => (
    <div data-testid="radar-chart">{children}</div>
  ),
  ResponsiveContainer: ({
    children,
    minWidth,
  }: {
    children: ReactNode;
    minWidth?: number;
  }) => {
    responsiveContainerSpy({ minWidth });
    return (
      <div data-testid="responsive-container" data-min-width={String(minWidth)}>
        {children}
      </div>
    );
  },
  Tooltip: () => <div data-testid="tooltip" />,
}));

import { HarnessFitnessFilesDashboard } from "../harness-fitness-files-dashboard";

const specFiles: FitnessSpecSummary[] = [
  {
    name: "README.md",
    relativePath: "docs/fitness/README.md",
    kind: "rulebook",
    language: "markdown",
    metricCount: 0,
    metrics: [],
    source: "# README",
  },
  {
    name: "code-quality.md",
    relativePath: "docs/fitness/code-quality.md",
    kind: "dimension",
    language: "markdown",
    dimension: "code_quality",
    weight: 24,
    thresholdPass: 90,
    thresholdWarn: 80,
    metricCount: 3,
    metrics: [
      {
        name: "eslint_pass",
        command: "npm run lint",
        description: "",
        tier: "fast",
        hardGate: true,
        gate: "hard",
        runner: "shell",
        scope: [],
        runWhenChanged: [],
      },
    ],
    source: "# Code quality",
    frontmatterSource: "---",
  },
];

describe("HarnessFitnessFilesDashboard", () => {
  it("renders the radar inside a width-safe responsive container", () => {
    const { container } = render(
      <HarnessFitnessFilesDashboard
        specFiles={specFiles}
        selectedSpec={specFiles[0] ?? null}
        loading={false}
      />,
    );

    expect(screen.getByTestId("responsive-container").getAttribute("data-min-width")).toBe("0");
    expect(responsiveContainerSpy).toHaveBeenCalledWith(expect.objectContaining({ minWidth: 0 }));
    expect(container.querySelector(".min-w-0")).not.toBeNull();
  });
});
