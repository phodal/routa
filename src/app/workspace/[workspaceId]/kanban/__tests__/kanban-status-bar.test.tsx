import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KanbanStatusBar } from "../kanban-status-bar";

describe("KanbanStatusBar", () => {
  it("renders a compact fitness runtime summary with blockers", () => {
    render(
      <KanbanStatusBar
        defaultCodebase={null}
        codebases={[]}
        fileChangesSummary={{ changedFiles: 0, totalAdditions: 0, totalDeletions: 0 }}
        board={null}
        fitnessStatus={{
          generatedAt: "2026-04-14T10:00:00.000Z",
          repoRoot: "/repo",
          activeRun: null,
          latestRun: {
            mode: "full",
            status: "failed",
            observedAt: "2026-04-14T09:59:00.000Z",
            observedAtMs: 1_760_000_000_000,
            finalScore: 84.8,
            hardGateBlocked: true,
            scoreBlocked: false,
            blockerCount: 2,
            hardGateFailureCount: 2,
            failingMetricCount: 1,
            durationMs: 1240,
            metricCount: 12,
            artifactPath: "/tmp/artifacts/full.json",
          },
        }}
      />,
    );

    const surface = screen.getByTestId("kanban-fitness-status");
    expect(surface.textContent).toContain("Fitness");
    expect(surface.textContent).toContain("FULL");
    expect(surface.textContent).toContain("blocked");
    expect(surface.textContent).toContain("85");
    expect(surface.textContent).toContain("2 blk");
  });

  it("prioritizes the active run when fitness is still running", () => {
    render(
      <KanbanStatusBar
        defaultCodebase={null}
        codebases={[]}
        fileChangesSummary={{ changedFiles: 0, totalAdditions: 0, totalDeletions: 0 }}
        board={null}
        fitnessStatus={{
          generatedAt: "2026-04-14T10:00:00.000Z",
          repoRoot: "/repo",
          activeRun: {
            mode: "fast",
            status: "running",
            observedAt: "2026-04-14T10:01:00.000Z",
            observedAtMs: 1_760_000_060_000,
            finalScore: null,
            hardGateBlocked: false,
            scoreBlocked: false,
            blockerCount: 0,
            hardGateFailureCount: 0,
            failingMetricCount: 0,
            durationMs: 0,
            metricCount: 4,
            artifactPath: null,
          },
          latestRun: {
            mode: "full",
            status: "passed",
            observedAt: "2026-04-14T09:59:00.000Z",
            observedAtMs: 1_760_000_000_000,
            finalScore: 96,
            hardGateBlocked: false,
            scoreBlocked: false,
            blockerCount: 0,
            hardGateFailureCount: 0,
            failingMetricCount: 0,
            durationMs: 1240,
            metricCount: 12,
            artifactPath: "/tmp/artifacts/full.json",
          },
        }}
      />,
    );

    const surface = screen.getByTestId("kanban-fitness-status");
    expect(surface.textContent).toContain("FAST");
    expect(surface.textContent).toContain("running");
    expect(surface.textContent).toContain("last FULL 96");
  });
});
