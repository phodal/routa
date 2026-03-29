import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("../../utils/diagnostics", () => ({
  desktopAwareFetch,
}));

vi.mock("../fitness-analysis-content", () => ({
  FitnessAnalysisContent: ({ viewMode }: { viewMode: string }) => (
    <div data-testid="fitness-analysis-content">{viewMode}</div>
  ),
}));

import { FitnessAnalysisPanel } from "../fitness-analysis-panel";

const genericReport = {
  modelVersion: 2,
  modelPath: "/tmp/model.yaml",
  profile: "generic",
  mode: "deterministic",
  repoRoot: "/Users/phodal/ai/routa-js",
  generatedAt: "2026-03-29T04:50:58.741337+00:00",
  snapshotPath: "/tmp/report.json",
  overallLevel: "agent_centric",
  overallLevelName: "Agent-Centric",
  currentLevelReadiness: 1,
  nextLevel: "agent_first",
  nextLevelName: "Agent-First",
  nextLevelReadiness: 0,
  blockingTargetLevel: "agent_first",
  blockingTargetLevelName: "Agent-First",
  dimensions: {},
  cells: [],
  criteria: [
    {
      id: "governance.agent_first.machine_readable_guardrails",
      level: "agent_first",
      dimension: "governance",
      weight: 2,
      critical: true,
      status: "fail",
      detectorType: "all_of",
      detail: "missing CODEOWNERS",
      evidence: ["docs/fitness/review-triggers.yaml"],
      whyItMatters: "Guardrails need machine-readable ownership and dependency controls.",
      recommendedAction: "Add CODEOWNERS or dependency automation.",
      evidenceHint: ".github/CODEOWNERS or renovate.json",
    },
  ],
  recommendations: [
    {
      criterionId: "governance.agent_first.machine_readable_guardrails",
      action: "Pair review-trigger rules with CODEOWNERS or Renovate",
      whyItMatters: "Without a native ownership surface, governance remains concentrated in one file.",
      evidenceHint: ".github/CODEOWNERS plus docs/fitness/review-triggers.yaml",
      critical: true,
      weight: 2,
    },
  ],
  blockingCriteria: [
    {
      id: "governance.agent_first.machine_readable_guardrails",
      level: "agent_first",
      dimension: "governance",
      weight: 2,
      critical: true,
      status: "fail",
      detectorType: "all_of",
      detail: "missing CODEOWNERS",
      evidence: ["docs/fitness/review-triggers.yaml"],
      whyItMatters: "Guardrails need machine-readable ownership and dependency controls.",
      recommendedAction: "Add CODEOWNERS or dependency automation.",
      evidenceHint: ".github/CODEOWNERS or renovate.json",
    },
  ],
  comparison: {
    previousGeneratedAt: "2026-03-29T04:45:58.741337+00:00",
    previousOverallLevel: "agent_centric",
    overallChange: "same",
    dimensionChanges: [],
    criteriaChanges: [],
  },
  evidencePacks: [],
};

describe("FitnessAnalysisPanel", () => {
  beforeEach(() => {
    desktopAwareFetch.mockReset();
    desktopAwareFetch.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/fitness/report")) {
        return {
          ok: true,
          json: async () => ({
            generatedAt: "2026-03-29T04:50:58.741337+00:00",
            profiles: [
              {
                profile: "generic",
                status: "ok",
                source: "snapshot",
                report: genericReport,
              },
              {
                profile: "agent_orchestrator",
                status: "missing",
                source: "snapshot",
                error: "暂无快照",
              },
            ],
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
  });

  it("surfaces a summary-first workflow without advanced debug views", async () => {
    render(
      <FitnessAnalysisPanel
        workspaceId="default"
        repoPath="/Users/phodal/ai/routa-js"
        codebaseLabel="routa-js"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Generic/)).toBeTruthy();
    });

    expect(screen.getByText("routa-js")).toBeTruthy();
    expect(screen.getAllByText(/Blockers/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId("fitness-dashboard")).toBeTruthy();
    expect(screen.getByTestId("fitness-analysis-content").textContent).toBe("overview");
    expect(screen.queryByText("Report Controls")).toBeNull();
    expect(screen.queryByText("Mode")).toBeNull();
    expect(screen.queryByText("Views")).toBeNull();
  });
});
