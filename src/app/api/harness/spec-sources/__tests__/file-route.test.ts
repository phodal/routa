import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const system = {
  codebaseStore: {
    get: vi.fn(),
    listByWorkspace: vi.fn(),
  },
};

const getCurrentRoutaRepoRootMock = vi.fn();

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

vi.mock("@/core/fitness/repo-root", () => ({
  getCurrentRoutaRepoRoot: () => getCurrentRoutaRepoRootMock(),
}));

// Lazy import after mocks
let GET: (req: import("next/server").NextRequest) => Promise<Response>;
beforeEach(async () => {
  vi.resetModules();
  ({ GET } = await import("../file/route"));
});

function makeRequest(params: Record<string, string>): import("next/server").NextRequest {
  const url = new URL("http://localhost/api/harness/spec-sources/file");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { nextUrl: url } as unknown as import("next/server").NextRequest;
}

describe("GET /api/harness/spec-sources/file", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "routa-spec-file-"));
    system.codebaseStore.get.mockResolvedValue(undefined);
    system.codebaseStore.listByWorkspace.mockResolvedValue([]);
    getCurrentRoutaRepoRootMock.mockReturnValue(undefined);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns file content when the file exists within the repo root", async () => {
    const filePath = "docs/spec.md";
    const absoluteFilePath = path.join(tempDir, filePath);
    fs.mkdirSync(path.dirname(absoluteFilePath), { recursive: true });
    fs.writeFileSync(absoluteFilePath, "# Spec content");

    const req = makeRequest({ repoPath: tempDir, filePath });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe("# Spec content");
    expect(body.filePath).toBe(filePath);
  });

  it("returns 404 when the file does not exist", async () => {
    const req = makeRequest({ repoPath: tempDir, filePath: "missing.md" });
    const res = await GET(req);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found|找不到|未找到/i);
  });

  it("returns 400 for invalid context (no workspaceId/codebaseId/repoPath)", async () => {
    const req = makeRequest({ filePath: "docs/spec.md" });
    const res = await GET(req);

    expect(res.status).toBe(400);
  });

  it("returns 400 when filePath is missing", async () => {
    const req = makeRequest({ repoPath: tempDir });
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/filePath/i);
  });

  it("returns 400 when filePath attempts path traversal outside repoRoot", async () => {
    const req = makeRequest({ repoPath: tempDir, filePath: "../../etc/passwd" });
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/path traversal|invalid path|范围/i);
  });
});
