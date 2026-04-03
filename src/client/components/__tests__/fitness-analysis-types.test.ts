import { describe, expect, it } from "vitest";

import { normalizeApiResponse } from "../fitness-analysis-types";

describe("normalizeApiResponse", () => {
  it("keeps additive baseline insight fields from analyze/report payloads", () => {
    const entries = normalizeApiResponse({
      profiles: [
        {
          profile: "generic",
          status: "ok",
          source: "analysis",
          durationMs: 4200,
          report: {
            topPrioritizedActions: [
              {
                criterionId: "governance.agent_first.machine_readable_guardrails",
                action: "Add CODEOWNERS",
                whyItMatters: "Ownership is missing.",
                evidenceHint: ".github/CODEOWNERS",
                critical: true,
                weight: 2,
              },
            ],
            dominantMissingDimensions: [
              {
                dimension: "governance",
                name: "Verification & Guardrails",
                failingCriteria: 3,
                criticalFailures: 2,
                failedWeight: 5,
                blockingFailures: 2,
              },
            ],
            autonomyRecommendation: {
              band: "low",
              rationale: "Critical blockers remain.",
            },
            lifecycleSensorPlacement: {
              fast: {
                applicableCriteria: 3,
                passingCriteria: 1,
                failingCriteria: 2,
                criticalFailures: 1,
                evidenceModes: { static: 2 },
              },
              normal: {
                applicableCriteria: 2,
                passingCriteria: 1,
                failingCriteria: 1,
                criticalFailures: 0,
                evidenceModes: { runtime: 1 },
              },
              fullOrDeep: {
                applicableCriteria: 1,
                passingCriteria: 0,
                failingCriteria: 1,
                criticalFailures: 0,
                evidenceModes: { ai: 1 },
              },
              continuous: {
                applicableCriteria: 0,
                passingCriteria: 0,
                failingCriteria: 0,
                criticalFailures: 0,
                evidenceModes: {},
              },
            },
            framing: "harnessability",
            termMapping: {
              internalTerm: "Harness Fluency",
              publicTerm: "Harnessability",
              activeTerm: "Harnessability",
            },
          },
        },
      ],
    });

    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.profile).toBe("generic");
    expect(entry.durationMs).toBe(4200);
    expect(entry.report?.topPrioritizedActions?.[0].action).toBe("Add CODEOWNERS");
    expect(entry.report?.dominantMissingDimensions?.[0].dimension).toBe("governance");
    expect(entry.report?.autonomyRecommendation?.band).toBe("low");
    expect(entry.report?.lifecycleSensorPlacement?.fast.failingCriteria).toBe(2);
    expect(entry.report?.framing).toBe("harnessability");
    expect(entry.report?.termMapping?.activeTerm).toBe("Harnessability");
  });

  it("remains backward compatible with legacy and invalid payload entries", () => {
    const entries = normalizeApiResponse({
      profiles: [
        {
          profile: "generic",
          status: "ok",
          source: "snapshot",
          report: {
            overallLevel: "agent_centric",
          },
        },
        {
          profile: "agent_orchestrator",
          status: "ok",
          source: "analysis",
          report: "not-an-object",
        },
        {
          profile: "generic",
          status: "unknown",
          source: "analysis",
        },
      ],
    });

    expect(entries).toHaveLength(2);
    expect(entries[0].report?.overallLevel).toBe("agent_centric");
    expect(entries[1].report).toBeUndefined();
  });
});
