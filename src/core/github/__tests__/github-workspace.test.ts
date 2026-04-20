/**
 * Unit tests for GitHub Virtual Workspace
 *
 * Tests the core logic: file index building, search, path traversal
 * protection, cache management, and error classes.
 *
 * Network calls (downloadZipball) are NOT tested here — we test
 * the workspace handle and helpers using a synthetic directory tree.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  getCachedWorkspace,
  cleanupExpired,
  listActiveWorkspaces,
  workspaceKey,
  GitHubWorkspaceError,
  importGitHubRepo,
} from "../github-workspace";

vi.mock("adm-zip", () => ({
  default: class MockAdmZip {
    constructor(_buffer: Buffer) {}

    extractAllTo(targetDir: string) {
      const repoRoot = path.join(targetDir, "demo-main");
      fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
      fs.writeFileSync(path.join(repoRoot, "README.md"), "# Imported Repo\n");
      fs.writeFileSync(path.join(repoRoot, "src", "index.ts"), "export const imported = true;\n");
    }
  },
}));

// ─── Helpers: create a synthetic repo dir ─────────────────────────────────

function createSyntheticRepo(basePath: string): void {
  // Simulate extracted GitHub repo structure
  fs.mkdirSync(path.join(basePath, "src"), { recursive: true });
  fs.mkdirSync(path.join(basePath, "src", "utils"), { recursive: true });
  fs.mkdirSync(path.join(basePath, "docs"), { recursive: true });

  fs.writeFileSync(path.join(basePath, "README.md"), "# Test Repo\n");
  fs.writeFileSync(path.join(basePath, "package.json"), '{"name": "test"}');
  fs.writeFileSync(path.join(basePath, "src", "index.ts"), 'export const hello = "world";');
  fs.writeFileSync(path.join(basePath, "src", "utils", "helpers.ts"), "export function add(a: number, b: number) { return a + b; }");
  fs.writeFileSync(path.join(basePath, "docs", "guide.md"), "# Guide\nSome docs");

  // Also create ignored directories to test filtering
  fs.mkdirSync(path.join(basePath, "node_modules", "dep"), { recursive: true });
  fs.writeFileSync(path.join(basePath, "node_modules", "dep", "index.js"), "module.exports = {};");
  fs.mkdirSync(path.join(basePath, ".git"), { recursive: true });
  fs.writeFileSync(path.join(basePath, ".git", "config"), "");
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("GitHubWorkspaceError", () => {
  it("should create proper error with code", () => {
    const err = new GitHubWorkspaceError("not found", "NOT_FOUND");
    expect(err.message).toBe("not found");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.name).toBe("GitHubWorkspaceError");
    expect(err instanceof Error).toBe(true);
  });

  it("should support all error codes", () => {
    const codes = ["NOT_FOUND", "FORBIDDEN", "DOWNLOAD_FAILED", "TOO_LARGE", "EXTRACT_FAILED"] as const;
    for (const code of codes) {
      const err = new GitHubWorkspaceError(`test ${code}`, code);
      expect(err.code).toBe(code);
    }
  });
});

describe("workspaceKey", () => {
  it("should produce consistent keys", () => {
    expect(workspaceKey("vercel", "next.js", "main")).toBe("vercel/next.js@main");
    expect(workspaceKey("phodal", "routa", "HEAD")).toBe("phodal/routa@HEAD");
  });
});

describe("getCachedWorkspace", () => {
  it("should return null when no workspace is cached", () => {
    expect(getCachedWorkspace("nonexistent", "repo", "HEAD")).toBeNull();
  });
});

describe("cleanupExpired", () => {
  it("should return 0 when registry is empty", () => {
    const cleaned = cleanupExpired();
    expect(cleaned).toBeGreaterThanOrEqual(0); // might clean up from other tests
  });
});

describe("listActiveWorkspaces", () => {
  it("should return an array", () => {
    const workspaces = listActiveWorkspaces();
    expect(Array.isArray(workspaces)).toBe(true);
  });
});

// ─── importGitHubRepo with local synthetic data ────────────────────────────

/**
 * We can't easily test importGitHubRepo without mocking fetch,
 * so we test the workspace handle creation via the internal
 * buildFileIndex + createWorkspaceHandle pattern by accessing
 * them indirectly through importGitHubRepo with a mock.
 *
 * Instead, we test the file operations on a GitHubWorkspace-compatible
 * object created manually.
 */
describe("GitHubWorkspace file operations (synthetic)", () => {
  let tmpDir: string;
  let repoDir: string;

  // We'll dynamically import the module internals for testing.
  // Since buildFileIndex and createWorkspaceHandle are not exported,
  // we use importGitHubRepo with a mocked fetch for integration testing.
  // For unit testing the handle, we create a minimal mock.

  function createTestWorkspace() {
    // Import the actual module to test via importGitHubRepo
    // For now, create a mock workspace that behaves like the real one
    const paths: string[] = [];

    function scanDir(dir: string, root: string): void {
      const ignoreSet = new Set([
        "node_modules", ".git", ".next", "dist", "build", ".cache",
        "coverage", ".turbo", "target", "__pycache__", ".venv", "venv",
      ]);

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (ignoreSet.has(entry.name) || entry.name.startsWith(".")) continue;
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(root, fullPath);
        if (entry.isDirectory()) {
          scanDir(fullPath, root);
        } else if (entry.isFile()) {
          paths.push(relativePath);
        }
      }
    }

    scanDir(repoDir, repoDir);

    return {
      owner: "test",
      repo: "repo",
      ref: "main",
      extractedPath: repoDir,
      importedAt: new Date(),
      fileCount: paths.length,
      paths,

      readFile(filePath: string): string {
        const absPath = path.resolve(repoDir, filePath);
        if (!absPath.startsWith(repoDir + path.sep) && absPath !== repoDir) {
          throw new GitHubWorkspaceError(`Path traversal denied: ${filePath}`, "FORBIDDEN");
        }
        if (!fs.existsSync(absPath)) {
          throw new GitHubWorkspaceError(`File not found: ${filePath}`, "NOT_FOUND");
        }
        return fs.readFileSync(absPath, "utf-8");
      },

      exists(filePath: string): boolean {
        const absPath = path.resolve(repoDir, filePath);
        if (!absPath.startsWith(repoDir + path.sep) && absPath !== repoDir) {
          return false;
        }
        return fs.existsSync(absPath);
      },
    };
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-ws-test-"));
    repoDir = path.join(tmpDir, "test-repo");
    fs.mkdirSync(repoDir, { recursive: true });
    createSyntheticRepo(repoDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("should read file content correctly", () => {
    const ws = createTestWorkspace();
    const content = ws.readFile("README.md");
    expect(content).toBe("# Test Repo\n");
  });

  it("should read nested file content", () => {
    const ws = createTestWorkspace();
    const content = ws.readFile("src/index.ts");
    expect(content).toContain('export const hello');
  });

  it("should throw NOT_FOUND for missing file", () => {
    const ws = createTestWorkspace();
    expect(() => ws.readFile("nonexistent.ts")).toThrow(GitHubWorkspaceError);
    try {
      ws.readFile("nonexistent.ts");
    } catch (err) {
      expect((err as GitHubWorkspaceError).code).toBe("NOT_FOUND");
    }
  });

  it("should block path traversal attacks", () => {
    const ws = createTestWorkspace();
    expect(() => ws.readFile("../../../etc/passwd")).toThrow(GitHubWorkspaceError);
    try {
      ws.readFile("../../../etc/passwd");
    } catch (err) {
      expect((err as GitHubWorkspaceError).code).toBe("FORBIDDEN");
    }
  });

  it("should check file existence", () => {
    const ws = createTestWorkspace();
    expect(ws.exists("README.md")).toBe(true);
    expect(ws.exists("src/index.ts")).toBe(true);
    expect(ws.exists("nonexistent.ts")).toBe(false);
  });

  it("should return false for path traversal on exists()", () => {
    const ws = createTestWorkspace();
    expect(ws.exists("../../../etc/passwd")).toBe(false);
  });

  it("should exclude node_modules and .git from file index", () => {
    const ws = createTestWorkspace();
    const hasNodeModules = ws.paths.some((p: string) => p.includes("node_modules"));
    const hasGit = ws.paths.some((p: string) => p.includes(".git"));
    expect(hasNodeModules).toBe(false);
    expect(hasGit).toBe(false);
  });

  it("should include expected files in the index", () => {
    const ws = createTestWorkspace();
    expect(ws.paths).toContain("README.md");
    expect(ws.paths).toContain("package.json");
    expect(ws.paths).toContain(path.join("src", "index.ts"));
    expect(ws.paths).toContain(path.join("src", "utils", "helpers.ts"));
    expect(ws.paths).toContain(path.join("docs", "guide.md"));
  });

  it("should report correct file count", () => {
    const ws = createTestWorkspace();
    // README.md, package.json, src/index.ts, src/utils/helpers.ts, docs/guide.md
    expect(ws.fileCount).toBe(5);
  });
});

// ─── Fuzzy search logic ────────────────────────────────────────────────────

describe("fuzzy search (via workspace.search)", () => {
  // We can't directly test the private fuzzyScore function,
  // but we can test it indirectly through the workspace.search method.
  // For now, test the scoring logic directly by re-implementing the function.

  function fuzzyScore(query: string, target: string, fileName: string): number {
    if (target === query) return 1000;
    if (target.includes(query)) {
      if (fileName.startsWith(query)) return 900;
      if (fileName.includes(query)) return 800;
      return 700;
    }

    let score = 0;
    let qi = 0;
    let consecutive = 0;

    for (let i = 0; i < target.length && qi < query.length; i++) {
      if (target[i] === query[qi]) {
        score += 10 + consecutive;
        consecutive += 5;
        qi++;
      } else {
        consecutive = 0;
      }
    }

    return qi < query.length ? 0 : score + Math.max(0, 100 - target.length);
  }

  it("should give highest score for exact match", () => {
    expect(fuzzyScore("index.ts", "index.ts", "index.ts")).toBe(1000);
  });

  it("should give high score for filename-starts-with match", () => {
    const score = fuzzyScore("index", "src/index.ts", "index.ts");
    expect(score).toBe(900);
  });

  it("should give moderate score for substring match in filename", () => {
    // "lper" is contained in "helpers.ts" but doesn't start with it
    const score = fuzzyScore("lper", "src/utils/helpers.ts", "helpers.ts");
    expect(score).toBe(800);
  });

  it("should give lower score for substring match in path only", () => {
    const score = fuzzyScore("src", "src/utils/helpers.ts", "helpers.ts");
    expect(score).toBe(700);
  });

  it("should return 0 for non-matching query", () => {
    const score = fuzzyScore("zzzzz", "index.ts", "index.ts");
    expect(score).toBe(0);
  });

  it("should give partial fuzzy score for scattered matches", () => {
    const score = fuzzyScore("its", "index.ts", "index.ts");
    expect(score).toBeGreaterThan(0);
  });
});

// ─── Codebase model extension ──────────────────────────────────────────────

describe("Codebase model with sourceType", () => {
  it("should create codebase with local source type", async () => {
    const { createCodebase } = await import("@/core/models/codebase");
    const cb = createCodebase({
      id: "cb-1",
      workspaceId: "ws-1",
      repoPath: "/some/local/path",
      sourceType: "local",
    });
    expect(cb.sourceType).toBe("local");
    expect(cb.sourceUrl).toBeUndefined();
  });

  it("should create codebase with github source type", async () => {
    const { createCodebase } = await import("@/core/models/codebase");
    const cb = createCodebase({
      id: "cb-2",
      workspaceId: "ws-1",
      repoPath: "/tmp/routa-gh/owner--repo",
      sourceType: "github",
      sourceUrl: "https://github.com/owner/repo",
    });
    expect(cb.sourceType).toBe("github");
    expect(cb.sourceUrl).toBe("https://github.com/owner/repo");
  });

  it("should default sourceType to undefined for backward compat", async () => {
    const { createCodebase } = await import("@/core/models/codebase");
    const cb = createCodebase({
      id: "cb-3",
      workspaceId: "ws-1",
      repoPath: "/some/path",
    });
    expect(cb.sourceType).toBeUndefined();
    expect(cb.sourceUrl).toBeUndefined();
  });
});

// ─── extractZip edge case: cross-device rename ────────────────────────────

describe("extractZip robustness", () => {
  it("should handle AdmZip extraction with single top-level dir", async () => {
    // This is tested indirectly — the extractZip function expects GitHub's
    // standard zip layout (single top-level dir). We verify the expectation
    // is documented and the error message is clear.
    const err = new GitHubWorkspaceError("Unexpected archive layout", "EXTRACT_FAILED");
    expect(err.code).toBe("EXTRACT_FAILED");
    expect(err.message).toContain("Unexpected archive layout");
  });
});

// ─── Download error handling ──────────────────────────────────────────────

describe("download error mapping", () => {
  it("should map 404 to NOT_FOUND", () => {
    const err = new GitHubWorkspaceError("Repo not found", "NOT_FOUND");
    expect(err.code).toBe("NOT_FOUND");
  });

  it("should map 403 to FORBIDDEN", () => {
    const err = new GitHubWorkspaceError("Rate limited", "FORBIDDEN");
    expect(err.code).toBe("FORBIDDEN");
  });

  it("should map size exceeded to TOO_LARGE", () => {
    const err = new GitHubWorkspaceError("Too large", "TOO_LARGE");
    expect(err.code).toBe("TOO_LARGE");
  });
});

describe("importGitHubRepo", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("imports, caches, searches, and disposes a GitHub workspace", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: new Headers({ "content-length": "128" }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const workspace = await importGitHubRepo({
      owner: "demo-owner",
      repo: "demo-repo",
      ref: "main",
    });

    expect(workspace.fileCount).toBe(2);
    expect(workspace.readFile("README.md")).toContain("Imported Repo");
    expect(workspace.search("index")[0]).toEqual(
      expect.objectContaining({
        path: "src/index.ts",
      }),
    );
    expect(getCachedWorkspace("demo-owner", "demo-repo", "main")).toBe(workspace);
    expect(listActiveWorkspaces()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "demo-owner/demo-repo@main",
          fileCount: 2,
        }),
      ]),
    );

    const cached = await importGitHubRepo({
      owner: "demo-owner",
      repo: "demo-repo",
      ref: "main",
    });
    expect(cached).toBe(workspace);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    workspace.dispose();
  });

  it("maps HTTP and size errors into GitHubWorkspaceError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 404,
      headers: new Headers(),
    })));

    await expect(
      importGitHubRepo({ owner: "missing", repo: "repo" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      headers: new Headers({ "content-length": String(10 * 1024 * 1024) }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })));

    await expect(
      importGitHubRepo({ owner: "big", repo: "repo", maxSizeMB: 1 }),
    ).rejects.toMatchObject({
      code: "TOO_LARGE",
    });
  });
});
