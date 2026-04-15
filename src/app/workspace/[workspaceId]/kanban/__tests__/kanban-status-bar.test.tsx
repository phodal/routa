import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KanbanStatusBar } from "../kanban-status-bar";
import type { KanbanBoardInfo } from "../../types";

const board: KanbanBoardInfo = {
  id: "board-1",
  workspaceId: "workspace-1",
  name: "Board",
  isDefault: true,
  sessionConcurrencyLimit: 1,
  queue: {
    runningCount: 1,
    runningCards: [],
    queuedCount: 2,
    queuedCardIds: [],
    queuedCards: [],
    queuedPositions: {},
  },
  columns: [{ id: "backlog", name: "Backlog", position: 0, stage: "backlog" }],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

describe("KanbanStatusBar runtime fitness", () => {
  it("renders runtime fitness summary and opens details on click", () => {
    const onFitnessClick = vi.fn();

    render(
      <KanbanStatusBar
        defaultCodebase={{
          id: "codebase-1",
          workspaceId: "workspace-1",
          repoPath: "/tmp/repo",
          branch: "main",
          label: "routa-js",
          isDefault: true,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }}
        codebases={[]}
        fileChangesSummary={{ changedFiles: 0, totalAdditions: 0, totalDeletions: 0 }}
        board={board}
        boardQueue={board.queue}
        onFitnessClick={onFitnessClick}
        runtimeFitness={{
          generatedAt: "2025-01-01T00:00:10.000Z",
          repoRoot: "/tmp/repo",
          hasRunning: true,
          latest: {
            mode: "full",
            currentStatus: "running",
            currentObservedAt: "2025-01-01T00:00:10.000Z",
            finalScore: null,
            hardGateBlocked: null,
            scoreBlocked: null,
            durationMs: null,
            dimensionCount: null,
            metricCount: 19,
            artifactPath: null,
            lastCompleted: {
              status: "passed",
              observedAt: "2025-01-01T00:00:00.000Z",
              finalScore: 93.2,
              hardGateBlocked: false,
              scoreBlocked: false,
              durationMs: 3200,
              dimensionCount: 8,
              metricCount: 18,
              artifactPath: "/tmp/runtime/latest-full.json",
            },
          },
          modes: [
            {
              mode: "fast",
              currentStatus: "missing",
              currentObservedAt: null,
              finalScore: null,
              hardGateBlocked: null,
              scoreBlocked: null,
              durationMs: null,
              dimensionCount: null,
              metricCount: null,
              artifactPath: null,
              lastCompleted: null,
            },
            {
              mode: "full",
              currentStatus: "running",
              currentObservedAt: "2025-01-01T00:00:10.000Z",
              finalScore: null,
              hardGateBlocked: null,
              scoreBlocked: null,
              durationMs: null,
              dimensionCount: null,
              metricCount: 19,
              artifactPath: null,
              lastCompleted: {
                status: "passed",
                observedAt: "2025-01-01T00:00:00.000Z",
                finalScore: 93.2,
                hardGateBlocked: false,
                scoreBlocked: false,
                durationMs: 3200,
                dimensionCount: 8,
                metricCount: 18,
                artifactPath: "/tmp/runtime/latest-full.json",
              },
            },
          ],
        }}
      />,
    );

    const badge = screen.getByTestId("kanban-runtime-fitness-status");
    expect(badge.textContent).toContain("Fitness");
    expect(badge.textContent).toContain("Full");
    expect(badge.textContent).toContain("Running");
    expect(badge.textContent).toContain("93.2");

    fireEvent.click(badge);
    expect(onFitnessClick).toHaveBeenCalledTimes(1);
  });

  it("prefers the active running mode even when latest points to a different completed mode", () => {
    const onFitnessClick = vi.fn();

    render(
      <KanbanStatusBar
        defaultCodebase={null}
        codebases={[]}
        fileChangesSummary={{ changedFiles: 0, totalAdditions: 0, totalDeletions: 0 }}
        board={board}
        boardQueue={board.queue}
        onFitnessClick={onFitnessClick}
        runtimeFitness={{
          generatedAt: "2025-01-01T00:00:12.000Z",
          repoRoot: "/tmp/repo",
          hasRunning: true,
          latest: {
            mode: "fast",
            currentStatus: "passed",
            currentObservedAt: "2025-01-01T00:00:12.000Z",
            finalScore: 88.1,
            hardGateBlocked: false,
            scoreBlocked: false,
            durationMs: 1500,
            dimensionCount: 6,
            metricCount: 15,
            artifactPath: "/tmp/runtime/latest-fast.json",
            lastCompleted: {
              status: "passed",
              observedAt: "2025-01-01T00:00:12.000Z",
              finalScore: 88.1,
              hardGateBlocked: false,
              scoreBlocked: false,
              durationMs: 1500,
              dimensionCount: 6,
              metricCount: 15,
              artifactPath: "/tmp/runtime/latest-fast.json",
            },
          },
          modes: [
            {
              mode: "fast",
              currentStatus: "passed",
              currentObservedAt: "2025-01-01T00:00:12.000Z",
              finalScore: 88.1,
              hardGateBlocked: false,
              scoreBlocked: false,
              durationMs: 1500,
              dimensionCount: 6,
              metricCount: 15,
              artifactPath: "/tmp/runtime/latest-fast.json",
              lastCompleted: {
                status: "passed",
                observedAt: "2025-01-01T00:00:12.000Z",
                finalScore: 88.1,
                hardGateBlocked: false,
                scoreBlocked: false,
                durationMs: 1500,
                dimensionCount: 6,
                metricCount: 15,
                artifactPath: "/tmp/runtime/latest-fast.json",
              },
            },
            {
              mode: "full",
              currentStatus: "running",
              currentObservedAt: "2025-01-01T00:00:10.000Z",
              finalScore: null,
              hardGateBlocked: null,
              scoreBlocked: null,
              durationMs: null,
              dimensionCount: null,
              metricCount: 21,
              artifactPath: null,
              lastCompleted: {
                status: "passed",
                observedAt: "2025-01-01T00:00:00.000Z",
                finalScore: 91.4,
                hardGateBlocked: false,
                scoreBlocked: false,
                durationMs: 2400,
                dimensionCount: 8,
                metricCount: 18,
                artifactPath: "/tmp/runtime/latest-full.json",
              },
            },
          ],
        }}
      />,
    );

    const badge = screen.getByTestId("kanban-runtime-fitness-status");
    expect(badge.textContent).toContain("Full");
    expect(badge.textContent).toContain("Running");
    expect(badge.textContent).toContain("91.4");

    fireEvent.click(badge);
    expect(onFitnessClick).toHaveBeenCalledTimes(1);
  });

  it("shows hard gate failures distinctly", () => {
    render(
      <KanbanStatusBar
        defaultCodebase={null}
        codebases={[]}
        fileChangesSummary={{ changedFiles: 0, totalAdditions: 0, totalDeletions: 0 }}
        board={board}
        boardQueue={board.queue}
        runtimeFitness={{
          generatedAt: "2025-01-01T00:00:12.000Z",
          repoRoot: "/tmp/repo",
          hasRunning: false,
          latest: {
            mode: "full",
            currentStatus: "failed",
            currentObservedAt: "2025-01-01T00:00:12.000Z",
            finalScore: 61.2,
            hardGateBlocked: true,
            scoreBlocked: false,
            durationMs: 3200,
            dimensionCount: 8,
            metricCount: 18,
            artifactPath: "/tmp/runtime/latest-full.json",
            lastCompleted: {
              status: "failed",
              observedAt: "2025-01-01T00:00:12.000Z",
              finalScore: 61.2,
              hardGateBlocked: true,
              scoreBlocked: false,
              durationMs: 3200,
              dimensionCount: 8,
              metricCount: 18,
              artifactPath: "/tmp/runtime/latest-full.json",
            },
          },
          modes: [
            {
              mode: "fast",
              currentStatus: "missing",
              currentObservedAt: null,
              finalScore: null,
              hardGateBlocked: null,
              scoreBlocked: null,
              durationMs: null,
              dimensionCount: null,
              metricCount: null,
              artifactPath: null,
              lastCompleted: null,
            },
            {
              mode: "full",
              currentStatus: "failed",
              currentObservedAt: "2025-01-01T00:00:12.000Z",
              finalScore: 61.2,
              hardGateBlocked: true,
              scoreBlocked: false,
              durationMs: 3200,
              dimensionCount: 8,
              metricCount: 18,
              artifactPath: "/tmp/runtime/latest-full.json",
              lastCompleted: {
                status: "failed",
                observedAt: "2025-01-01T00:00:12.000Z",
                finalScore: 61.2,
                hardGateBlocked: true,
                scoreBlocked: false,
                durationMs: 3200,
                dimensionCount: 8,
                metricCount: 18,
                artifactPath: "/tmp/runtime/latest-full.json",
              },
            },
          ],
        }}
      />,
    );

    const badge = screen.getByTestId("kanban-runtime-fitness-status");
    expect(badge.textContent).toContain("Hard gate failed");
    expect(badge.firstElementChild?.className).toContain("bg-rose-500");
  });
});
