import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { system, executeEntrixRun } = vi.hoisted(() => ({
  system: {
    codebaseStore: {
      get: vi.fn(),
      listByWorkspace: vi.fn(),
    },
  },
  executeEntrixRun: vi.fn(),
}));

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

vi.mock("@/core/fitness/entrix-runner", async () => {
  const actual = await vi.importActual<typeof import("@/core/fitness/entrix-runner")>(
    "@/core/fitness/entrix-runner",
  );
  return {
    ...actual,
    executeEntrixRun,
  };
});

import { POST } from "../route";

describe("/api/fitness/run route", () => {
  const repoRoot = process.cwd();

  beforeEach(() => {
    vi.clearAllMocks();
    system.codebaseStore.get.mockResolvedValue(undefined);
    system.codebaseStore.listByWorkspace.mockResolvedValue([]);
  });

  it("returns JSON by default", async () => {
    executeEntrixRun.mockResolvedValue({
      generatedAt: "2026-04-20T00:00:00Z",
      repoRoot,
      tier: "fast",
      scope: "local",
      command: "entrix",
      args: ["run", "--tier", "fast", "--scope", "local", "--json"],
      durationMs: 1200,
      exitCode: 0,
      report: {
        finalScore: 97,
        hardGateBlocked: false,
        scoreBlocked: false,
        dimensions: [],
      },
      summary: {
        finalScore: 97,
        hardGateBlocked: false,
        scoreBlocked: false,
        dimensionCount: 0,
        metricCount: 0,
        failingMetricCount: 0,
        dimensions: [],
        slowestMetricMs: 0,
        checksCount: 0,
        failedChecks: 0,
        passRate: 1,
        durationMs: 1200,
      },
    });

    const response = await POST(new NextRequest("http://localhost/api/fitness/run", {
      method: "POST",
      body: JSON.stringify({ repoPath: repoRoot }),
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.repoRoot).toBe(repoRoot);
    expect(data.summary.finalScore).toBe(97);
  });

  it("returns autoresearch metric lines when metrics format is requested", async () => {
    executeEntrixRun.mockResolvedValue({
      generatedAt: "2026-04-20T00:00:00Z",
      repoRoot,
      tier: "fast",
      scope: "local",
      command: "entrix",
      args: ["run", "--tier", "fast", "--scope", "local", "--json"],
      durationMs: 4321,
      exitCode: 1,
      report: {
        finalScore: 81.5,
        hardGateBlocked: true,
        scoreBlocked: false,
        dimensions: [],
      },
      summary: {
        finalScore: 81.5,
        hardGateBlocked: true,
        scoreBlocked: false,
        dimensionCount: 1,
        metricCount: 2,
        failingMetricCount: 1,
        dimensions: [],
        slowestMetricMs: 1800,
        checksCount: 2,
        failedChecks: 1,
        passRate: 0.5,
        durationMs: 4321,
      },
    });

    const response = await POST(new NextRequest("http://localhost/api/fitness/run", {
      method: "POST",
      body: JSON.stringify({ repoPath: repoRoot, outputFormat: "metrics" }),
    }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(body).toContain("METRIC fitness_ms=4321");
    expect(body).toContain("METRIC hard_gate_hits=1");
    expect(body).toContain("checks_failed=1");
  });
});