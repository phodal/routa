import { describe, expect, it } from "vitest";
import { RUNTIME_FITNESS_MODES, type RuntimeFitnessStatusResponse } from "../runtime-status-types";

describe("runtime-status-types", () => {
  it("keeps the runtime mode order stable", () => {
    expect(RUNTIME_FITNESS_MODES).toEqual(["fast", "full"]);
  });

  it("allows runtime payloads with running summaries and completed history", () => {
    const payload: RuntimeFitnessStatusResponse = {
      generatedAt: "2026-04-15T00:00:00.000Z",
      repoRoot: "/tmp/repo",
      hasRunning: true,
      latest: {
        mode: "full",
        currentStatus: "running",
        currentObservedAt: "2026-04-15T00:00:00.000Z",
        finalScore: null,
        hardGateBlocked: null,
        scoreBlocked: null,
        durationMs: null,
        dimensionCount: null,
        metricCount: 21,
        artifactPath: null,
        lastCompleted: {
          status: "passed",
          observedAt: "2026-04-14T23:59:00.000Z",
          finalScore: 92.4,
          hardGateBlocked: false,
          scoreBlocked: false,
          durationMs: 1800,
          dimensionCount: 8,
          metricCount: 18,
          artifactPath: "/tmp/runtime/latest-full.json",
        },
      },
      modes: [],
    };

    expect(payload.latest?.lastCompleted?.status).toBe("passed");
    expect(payload.latest?.currentStatus).toBe("running");
  });
});
