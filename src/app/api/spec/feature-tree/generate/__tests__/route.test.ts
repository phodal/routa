import { NextRequest } from "next/server";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────

const mockGenerateFeatureTree = vi.fn();
const mockPreflightFeatureTree = vi.fn();
vi.mock("@/core/spec/feature-tree-generator", () => ({
  generateFeatureTree: (...args: unknown[]) => mockGenerateFeatureTree(...args),
  preflightFeatureTree: (...args: unknown[]) => mockPreflightFeatureTree(...args),
}));

const mockResolveFitnessRepoRoot = vi.fn();
vi.mock("@/core/fitness/repo-root", () => ({
  resolveFitnessRepoRoot: (...args: unknown[]) => mockResolveFitnessRepoRoot(...args),
  isFitnessContextError: (msg: string) => msg.includes("context"),
  normalizeFitnessContextValue: (v: string | null) => v ?? undefined,
}));

import { POST } from "../route";

// ── Tests ──────────────────────────────────────────────────────────

describe("POST /api/spec/feature-tree/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns generated result on success", async () => {
    const fakeResult = {
      generatedAt: "2025-01-01T00:00:00Z",
      frameworksDetected: ["nextjs"],
      wroteFiles: ["FEATURE_TREE.md"],
      warnings: [],
      pagesCount: 5,
      apisCount: 3,
    };
    mockResolveFitnessRepoRoot.mockResolvedValue("/tmp/repo");
    mockPreflightFeatureTree.mockReturnValue({ selectedScanRoot: "/tmp/repo" });
    mockGenerateFeatureTree.mockResolvedValue(fakeResult);

    const req = new NextRequest("http://localhost/api/spec/feature-tree/generate", {
      method: "POST",
      body: JSON.stringify({ repoPath: "/tmp/repo" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(fakeResult);
    expect(mockPreflightFeatureTree).toHaveBeenCalledWith("/tmp/repo");
    expect(mockGenerateFeatureTree).toHaveBeenCalledWith({
      repoRoot: "/tmp/repo",
      scanRoot: "/tmp/repo",
      dryRun: false,
    });
  });

  it("passes dryRun option through", async () => {
    mockResolveFitnessRepoRoot.mockResolvedValue("/tmp/repo");
    mockPreflightFeatureTree.mockReturnValue({ selectedScanRoot: "/tmp/repo/src" });
    mockGenerateFeatureTree.mockResolvedValue({ pagesCount: 0, apisCount: 0 });

    const req = new NextRequest("http://localhost/api/spec/feature-tree/generate", {
      method: "POST",
      body: JSON.stringify({ repoPath: "/tmp/repo", dryRun: true }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockGenerateFeatureTree).toHaveBeenCalledWith({
      repoRoot: "/tmp/repo",
      scanRoot: "/tmp/repo/src",
      dryRun: true,
    });
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/api/spec/feature-tree/generate", {
      method: "POST",
      body: "not json",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  it("returns 400 when repo resolution gives a context error", async () => {
    mockResolveFitnessRepoRoot.mockRejectedValue(new Error("missing context"));

    const req = new NextRequest("http://localhost/api/spec/feature-tree/generate", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 500 when generation throws", async () => {
    mockResolveFitnessRepoRoot.mockResolvedValue("/tmp/repo");
    mockPreflightFeatureTree.mockReturnValue({ selectedScanRoot: "/tmp/repo" });
    mockGenerateFeatureTree.mockRejectedValue(new Error("scan failed"));

    const req = new NextRequest("http://localhost/api/spec/feature-tree/generate", {
      method: "POST",
      body: JSON.stringify({ repoPath: "/tmp/repo" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("scan failed");
  });
});
