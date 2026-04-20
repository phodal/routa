import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function runtimeRoot(repoRoot: string): string {
  const marker = createHash("sha256").update(repoRoot).digest("hex");
  return path.join("/tmp", "harness-monitor", "runtime", marker);
}

function createRuntimeFixture(tempDirs: string[], prefix: string) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(repoRoot);
  const root = runtimeRoot(repoRoot);
  fs.mkdirSync(path.join(root, "artifacts", "fitness"), { recursive: true });
  fs.mkdirSync(root, { recursive: true });
  return { repoRoot, root };
}

describe("/api/fitness/runtime route", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    system.codebaseStore.get.mockResolvedValue(undefined);
    system.codebaseStore.listByWorkspace.mockResolvedValue([]);
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(runtimeRoot(dir), { recursive: true, force: true });
    }
  });

  it("returns a running mode together with the previous completed snapshot", async () => {
    const { repoRoot, root } = createRuntimeFixture(tempDirs, "routa-runtime-fitness-");

    fs.writeFileSync(
      path.join(root, "events.jsonl"),
      [
        JSON.stringify({
          type: "fitness",
          repo_root: repoRoot,
          observed_at_ms: 1_700_000_000_000,
          mode: "full",
          status: "passed",
          final_score: 93.2,
          hard_gate_blocked: false,
          score_blocked: false,
          duration_ms: 3210,
          dimension_count: 8,
          metric_count: 18,
          artifact_path: path.join(root, "artifacts", "fitness", "latest-full.json"),
        }),
        JSON.stringify({
          type: "fitness",
          repo_root: repoRoot,
          observed_at_ms: 1_700_000_010_000,
          mode: "full",
          status: "running",
          metric_count: 19,
        }),
        "",
      ].join("\n"),
      "utf-8",
    );

    fs.writeFileSync(
      path.join(root, "artifacts", "fitness", "latest-full.json"),
      JSON.stringify({
        generated_at_ms: 1_700_000_000_000,
        final_score: 93.2,
        hard_gate_blocked: false,
        score_blocked: false,
        duration_ms: 3210,
        metric_count: 18,
        dimensions: new Array(8).fill({}),
      }),
      "utf-8",
    );

    const response = await GET(new NextRequest(
      `http://localhost/api/fitness/runtime?repoPath=${encodeURIComponent(repoRoot)}`,
    ));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.repoRoot).toBe(repoRoot);
    expect(data.hasRunning).toBe(true);
    expect(data.latest).toMatchObject({
      mode: "full",
      currentStatus: "running",
      metricCount: 19,
    });

    const full = data.modes.find((entry: { mode: string }) => entry.mode === "full");
    expect(full).toMatchObject({
      currentStatus: "running",
      lastCompleted: {
        status: "passed",
        finalScore: 93.2,
        hardGateBlocked: false,
        scoreBlocked: false,
        dimensionCount: 8,
        metricCount: 18,
      },
    });

    const fast = data.modes.find((entry: { mode: string }) => entry.mode === "fast");
    expect(fast?.currentStatus).toBe("missing");
  });

  it("returns missing when the runtime cache does not exist yet", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "routa-runtime-fitness-empty-"));
    tempDirs.push(repoRoot);

    const response = await GET(new NextRequest(
      `http://localhost/api/fitness/runtime?repoPath=${encodeURIComponent(repoRoot)}`,
    ));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.hasRunning).toBe(false);
    expect(data.latest).toBeNull();
    expect(data.modes).toEqual([
      expect.objectContaining({ mode: "fast", currentStatus: "missing" }),
      expect.objectContaining({ mode: "full", currentStatus: "missing" }),
    ]);
  });

  it("resolves runtime fitness via codebaseId", async () => {
    const { repoRoot, root } = createRuntimeFixture(tempDirs, "routa-runtime-fitness-codebase-");
    system.codebaseStore.get.mockResolvedValue({
      id: "codebase-1",
      repoPath: repoRoot,
    });

    fs.writeFileSync(
      path.join(root, "events.jsonl"),
      `${JSON.stringify({
        type: "fitness",
        observed_at_ms: 1_700_000_100_000,
        mode: "fast",
        status: "passed",
        final_score: 87.5,
        hard_gate_blocked: false,
        score_blocked: false,
        duration_ms: 1800,
        dimension_count: 6,
        metric_count: 14,
        artifact_path: path.join(root, "artifacts", "fitness", "latest-fast.json"),
      })}\n`,
      "utf-8",
    );

    const response = await GET(new NextRequest(
      "http://localhost/api/fitness/runtime?codebaseId=codebase-1",
    ));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(system.codebaseStore.get).toHaveBeenCalledWith("codebase-1");
    expect(data.repoRoot).toBe(repoRoot);
    expect(data.latest).toMatchObject({
      mode: "fast",
      currentStatus: "passed",
      finalScore: 87.5,
    });
  });

  it("falls back to workspace-level codebase resolution when no repoPath is provided", async () => {
    const { repoRoot } = createRuntimeFixture(tempDirs, "routa-runtime-fitness-workspace-");
    system.codebaseStore.listByWorkspace.mockResolvedValue([
      {
        id: "codebase-1",
        repoPath: repoRoot,
        isDefault: true,
      },
    ]);

    const response = await GET(new NextRequest(
      "http://localhost/api/fitness/runtime?workspaceId=workspace-1",
    ));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(system.codebaseStore.listByWorkspace).toHaveBeenCalledWith("workspace-1");
    expect(data.repoRoot).toBe(repoRoot);
    expect(data.latest).toBeNull();
    expect(data.modes).toEqual([
      expect.objectContaining({ mode: "fast", currentStatus: "missing" }),
      expect.objectContaining({ mode: "full", currentStatus: "missing" }),
    ]);
  });

  it("returns 400 when no runtime fitness context is provided", async () => {
    const response = await GET(new NextRequest("http://localhost/api/fitness/runtime"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Runtime Fitness 上下文无效");
  });
});
