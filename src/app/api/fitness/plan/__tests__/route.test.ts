import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repoRoot = "/home/runner/work/routa/routa";

const system = {
  codebaseStore: {
    get: vi.fn(),
    listByWorkspace: vi.fn(),
  },
};

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

import { GET } from "../route";

describe("/api/fitness/plan route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    system.codebaseStore.get.mockResolvedValue(undefined);
    system.codebaseStore.listByWorkspace.mockResolvedValue([]);
  });

  it("returns grouped code quality metrics for the selected tier and scope", async () => {
    const response = await GET(new NextRequest(`http://localhost/api/fitness/plan?repoPath=${encodeURIComponent(repoRoot)}&tier=normal&scope=local`));
    const data = await response.json();

    expect(response.status).toBe(200);

    const codeQuality = data.dimensions.find((dimension: { name: string }) => dimension.name === "code_quality");
    expect(codeQuality).toMatchObject({
      sourceFile: "code-quality.md",
    });
    expect(codeQuality.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "structural_guardrails", metricCount: 3, weight: 30 }),
      expect.objectContaining({ key: "duplication_and_complexity", metricCount: 4, weight: 25 }),
      expect.objectContaining({ key: "dependency_and_static_gates", metricCount: 4, weight: 25 }),
      expect.objectContaining({ key: "implementation_hygiene", metricCount: 3, weight: 20 }),
    ]));
    expect(codeQuality.groups).toHaveLength(4);
    expect(codeQuality.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "legacy_hotspot_budget_guard", group: "structural_guardrails" }),
      expect.objectContaining({ name: "duplicate_function_name", group: "duplication_and_complexity" }),
      expect.objectContaining({ name: "eslint_pass", group: "dependency_and_static_gates" }),
      expect.objectContaining({ name: "console_log_check", group: "implementation_hygiene" }),
    ]));
  });
});
