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

describe("/api/fitness/specs route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    system.codebaseStore.get.mockResolvedValue(undefined);
    system.codebaseStore.listByWorkspace.mockResolvedValue([]);
  });

  it("loads nested fitness specs and surfaces grouped code quality metadata", async () => {
    const response = await GET(new NextRequest(`http://localhost/api/fitness/specs?repoPath=${encodeURIComponent(repoRoot)}`));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.files.some((file: { relativePath: string }) => file.relativePath === "runtime/observability.md")).toBe(true);

    const codeQuality = data.files.find((file: { relativePath: string }) => file.relativePath === "code-quality.md");
    expect(codeQuality).toMatchObject({
      kind: "dimension",
      metricCount: 19,
    });
    expect(codeQuality.groups).toEqual([
      expect.objectContaining({ key: "structural_guardrails", weight: 30, metricCount: 5 }),
      expect.objectContaining({ key: "duplication_and_complexity", weight: 25, metricCount: 6 }),
      expect.objectContaining({ key: "dependency_and_static_gates", weight: 25, metricCount: 5 }),
      expect.objectContaining({ key: "implementation_hygiene", weight: 20, metricCount: 3 }),
    ]);
  });
});
