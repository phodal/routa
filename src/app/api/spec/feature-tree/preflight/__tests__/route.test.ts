import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPreflightFeatureTree = vi.fn();
vi.mock("@/core/spec/feature-tree-cli", () => ({
  preflightFeatureTreeViaCli: (...args: unknown[]) => mockPreflightFeatureTree(...args),
}));

const mockResolveFitnessRepoRoot = vi.fn();
vi.mock("@/core/fitness/repo-root", () => ({
  resolveFitnessRepoRoot: (...args: unknown[]) => mockResolveFitnessRepoRoot(...args),
  isFitnessContextError: (msg: string) => msg.includes("context"),
  normalizeFitnessContextValue: (v: string | null) => v ?? undefined,
}));

import { GET } from "../route";

describe("GET /api/spec/feature-tree/preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns preflight result on success", async () => {
    const fakeResult = {
      repoRoot: "/tmp/repo",
      selectedScanRoot: "/tmp/repo/packages/app",
      frameworksDetected: ["nextjs"],
      adapters: [],
      candidateRoots: [],
      warnings: [],
    };
    mockResolveFitnessRepoRoot.mockResolvedValue("/tmp/repo");
    mockPreflightFeatureTree.mockReturnValue(fakeResult);

    const req = new NextRequest("http://localhost/api/spec/feature-tree/preflight?repoPath=/tmp/repo");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(fakeResult);
    expect(mockPreflightFeatureTree).toHaveBeenCalledWith("/tmp/repo");
  });

  it("returns 400 when repo resolution gives a context error", async () => {
    mockResolveFitnessRepoRoot.mockRejectedValue(new Error("missing context"));

    const req = new NextRequest("http://localhost/api/spec/feature-tree/preflight");
    const res = await GET(req);

    expect(res.status).toBe(400);
  });

  it("returns 500 when preflight throws", async () => {
    mockResolveFitnessRepoRoot.mockResolvedValue("/tmp/repo");
    mockPreflightFeatureTree.mockImplementation(() => {
      throw new Error("preflight failed");
    });

    const req = new NextRequest("http://localhost/api/spec/feature-tree/preflight?repoPath=/tmp/repo");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("preflight failed");
  });
});
