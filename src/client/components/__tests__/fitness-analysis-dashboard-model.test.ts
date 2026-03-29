import { describe, expect, it } from "vitest";

import { buildFitnessDashboardModel } from "../fitness-analysis-dashboard-model";
import type { FitnessReport } from "../fitness-analysis-types";

const report: FitnessReport = {
  modelVersion: 2,
  modelPath: "/tmp/model.yaml",
  profile: "generic",
  mode: "deterministic",
  repoRoot: "/repo",
  generatedAt: "2026-03-29T10:00:00.000Z",
  snapshotPath: "/tmp/report.json",
  overallLevel: "agent_centric",
  overallLevelName: "Agent-Centric",
  currentLevelReadiness: 1,
  nextLevel: "agent_first",
  nextLevelName: "Agent-First",
  nextLevelReadiness: 0.6,
  blockingTargetLevel: "agent_first",
  blockingTargetLevelName: "Agent-First",
  dimensions: {
    governance: {
      dimension: "governance",
      name: "Verification & Guardrails",
      level: "agent_centric",
      levelName: "Agent-Centric",
      levelIndex: 3,
      score: 1,
      nextLevel: "agent_first",
      nextLevelName: "Agent-First",
      nextLevelProgress: 0,
    },
    context: {
      dimension: "context",
      name: "Context Readiness",
      level: "agent_centric",
      levelName: "Agent-Centric",
      levelIndex: 3,
      score: 0.8,
      nextLevel: "agent_first",
      nextLevelName: "Agent-First",
      nextLevelProgress: 0.2,
    },
  },
  cells: [
    {
      id: "governance:awareness",
      dimension: "governance",
      dimensionName: "Verification & Guardrails",
      level: "awareness",
      levelName: "Awareness",
      score: 1,
      passed: true,
      passedWeight: 3,
      applicableWeight: 3,
      criteria: [],
    },
    {
      id: "context:agent_centric",
      dimension: "context",
      dimensionName: "Context Readiness",
      level: "agent_centric",
      levelName: "Agent-Centric",
      score: 0.8,
      passed: false,
      passedWeight: 4,
      applicableWeight: 5,
      criteria: [],
    },
  ],
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
      evidence: [],
      whyItMatters: "Ownership is missing.",
      recommendedAction: "Add CODEOWNERS.",
      evidenceHint: ".github/CODEOWNERS",
    },
    {
      id: "context.agent_first.intent_docs",
      level: "agent_first",
      dimension: "context",
      weight: 1,
      critical: false,
      status: "skipped",
      detectorType: "all_of",
      detail: "missing context",
      evidence: [],
      whyItMatters: "Context is thin.",
      recommendedAction: "Add docs.",
      evidenceHint: "docs/design-docs",
    },
    {
      id: "context.agent_centric.reference_pack",
      level: "agent_centric",
      dimension: "context",
      weight: 1,
      critical: false,
      status: "pass",
      detectorType: "all_of",
      detail: "ok",
      evidence: [],
      whyItMatters: "Good.",
      recommendedAction: "Keep it.",
      evidenceHint: "docs/references",
    },
  ],
  recommendations: [],
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
      evidence: [],
      whyItMatters: "Ownership is missing.",
      recommendedAction: "Add CODEOWNERS.",
      evidenceHint: ".github/CODEOWNERS",
    },
  ],
  comparison: {
    previousGeneratedAt: "2026-03-29T09:00:00.000Z",
    previousOverallLevel: "assisted_coding",
    overallChange: "up",
    dimensionChanges: [
      {
        dimension: "context",
        previousLevel: "assisted_coding",
        currentLevel: "agent_centric",
        change: "up",
      },
    ],
    criteriaChanges: [
      {
        id: "governance.agent_first.machine_readable_guardrails",
        previousStatus: "pass",
        currentStatus: "fail",
      },
    ],
  },
  evidencePacks: [],
};

describe("buildFitnessDashboardModel", () => {
  it("maps a fitness report into dashboard metrics and chart data", () => {
    const model = buildFitnessDashboardModel(report);

    expect(model.metrics.overallReadiness).toBe(100);
    expect(model.metrics.nextUnlockReadiness).toBe(60);
    expect(model.metrics.blockerCount).toBe(1);
    expect(model.metrics.passRate).toBe(33);
    expect(model.gateSummary).toEqual({ pass: 1, warn: 1, fail: 1 });
    expect(model.radar).toEqual([
      expect.objectContaining({ key: "governance", current: 100, target: 100 }),
      expect.objectContaining({ key: "context", current: 80, target: 100 }),
    ]);
    expect(model.blockerHotspots).toEqual([
      expect.objectContaining({ dimension: "governance", count: 2, leadingCriterion: "Machine Readable Guardrails" }),
    ]);
    expect(model.heatmapLevels).toEqual(["awareness", "agent_centric"]);
    expect(model.heatmapDimensions).toEqual(["governance", "context"]);
  });
});
