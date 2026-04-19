import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => true),
      realpathSync: vi.fn((p: string) => p),
    },
  };
});

import fs from "node:fs";

import { POST } from "../route";

describe("POST /api/spec/feature-tree/commit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPreflightFeatureTree.mockReturnValue({
      selectedScanRoot: "/tmp/repo/packages/app",
    });
  });

  it("commits generated result with metadata", async () => {
    const fakeResult = {
      generatedAt: "2025-01-01T00:00:00Z",
      frameworksDetected: ["nextjs"],
      wroteFiles: ["FEATURE_TREE.md"],
      warnings: [],
      pagesCount: 5,
      apisCount: 3,
    };
    const metadata = {
      schemaVersion: 1,
      capabilityGroups: [],
      features: [],
    };

    mockResolveFitnessRepoRoot.mockResolvedValue("/tmp/repo");
    mockGenerateFeatureTree.mockResolvedValue(fakeResult);

    const req = new NextRequest("http://localhost/api/spec/feature-tree/commit", {
      method: "POST",
      body: JSON.stringify({ repoPath: "/tmp/repo", metadata }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(fakeResult);
    expect(mockGenerateFeatureTree).toHaveBeenCalledWith({
      repoRoot: "/tmp/repo",
      scanRoot: "/tmp/repo/packages/app",
      metadata,
      dryRun: false,
    });
  });

  it("prefers an explicit scanRoot", async () => {
    mockResolveFitnessRepoRoot.mockResolvedValue("/tmp/repo");
    mockGenerateFeatureTree.mockResolvedValue({ pagesCount: 0, apisCount: 0 });

    const req = new NextRequest("http://localhost/api/spec/feature-tree/commit", {
      method: "POST",
      body: JSON.stringify({ repoPath: "/tmp/repo", scanRoot: "/tmp/repo/custom-root" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockGenerateFeatureTree).toHaveBeenCalledWith({
      repoRoot: "/tmp/repo",
      scanRoot: "/tmp/repo/custom-root",
      metadata: null,
      dryRun: false,
    });
    expect(mockPreflightFeatureTree).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/api/spec/feature-tree/commit", {
      method: "POST",
      body: "not json",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects scanRoot outside the repository", async () => {
    mockResolveFitnessRepoRoot.mockResolvedValue("/tmp/repo");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.realpathSync).mockImplementation((p) => String(p));

    const req = new NextRequest("http://localhost/api/spec/feature-tree/commit", {
      method: "POST",
      body: JSON.stringify({ repoPath: "/tmp/repo", scanRoot: "/etc/passwd" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("scanRoot must be inside the repository");
    expect(mockGenerateFeatureTree).not.toHaveBeenCalled();
  });

  it("rejects scanRoot that resolves outside repo via symlink", async () => {
    mockResolveFitnessRepoRoot.mockResolvedValue("/tmp/repo");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.realpathSync).mockImplementation((p) => {
      if (String(p) === "/tmp/repo/symlink-dir") return "/outside/repo";
      return String(p);
    });

    const req = new NextRequest("http://localhost/api/spec/feature-tree/commit", {
      method: "POST",
      body: JSON.stringify({ repoPath: "/tmp/repo", scanRoot: "/tmp/repo/symlink-dir" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("scanRoot must be inside the repository");
    expect(mockGenerateFeatureTree).not.toHaveBeenCalled();
  });

  it("rejects invalid metadata without features array", async () => {
    mockResolveFitnessRepoRoot.mockResolvedValue("/tmp/repo");

    const req = new NextRequest("http://localhost/api/spec/feature-tree/commit", {
      method: "POST",
      body: JSON.stringify({ repoPath: "/tmp/repo", metadata: { bad: true } }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid metadata: must contain a features array");
    expect(mockGenerateFeatureTree).not.toHaveBeenCalled();
  });
});
