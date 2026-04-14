import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import { afterEach, describe, expect, it } from "vitest";

import { readFitnessRuntimeStatusForRepoRoot } from "../runtime-status";

function runtimeRootForRepo(repoRoot: string): string {
  const marker = createHash("sha256").update(repoRoot).digest("hex");
  return path.join("/tmp", "harness-monitor", "runtime", marker);
}

function writeJson(targetPath: string, payload: unknown) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

describe("fitness runtime status", () => {
  const runtimeRoots = new Set<string>();

  afterEach(() => {
    for (const runtimeRoot of runtimeRoots) {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
    runtimeRoots.clear();
  });

  it("surfaces the newest running event while keeping the latest completed result", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "routa-fitness-runtime-"));
    const runtimeRoot = runtimeRootForRepo(repoRoot);
    runtimeRoots.add(runtimeRoot);

    const artifactPath = path.join(runtimeRoot, "artifacts", "fitness", "1717000000000-full.json");
    writeJson(artifactPath, {
      mode: "full",
      final_score: 91.2,
      hard_gate_blocked: true,
      score_blocked: false,
      duration_ms: 1820,
      metric_count: 12,
      generated_at_ms: 1717000000000,
      artifact_path: artifactPath,
      dimensions: [
        { hard_gate_failures: 2 },
      ],
      failing_metrics: [{ name: "lint" }],
    });
    writeJson(path.join(runtimeRoot, "artifacts", "fitness", "latest-full.json"), {
      mode: "full",
      final_score: 91.2,
      hard_gate_blocked: true,
      score_blocked: false,
      duration_ms: 1820,
      metric_count: 12,
      generated_at_ms: 1717000000000,
      artifact_path: artifactPath,
      dimensions: [
        { hard_gate_failures: 2 },
      ],
      failing_metrics: [{ name: "lint" }],
    });
    writeJson(path.join(runtimeRoot, "mailbox", "fitness", "new", "1717000000001-full.json"), {
      type: "fitness",
      repo_root: repoRoot,
      observed_at_ms: 1717000000001,
      mode: "full",
      status: "failed",
      final_score: 91.2,
      hard_gate_blocked: true,
      score_blocked: false,
      duration_ms: 1820,
      metric_count: 12,
      artifact_path: artifactPath,
    });
    writeJson(path.join(runtimeRoot, "mailbox", "fitness", "new", "1717000000300-fast.json"), {
      type: "fitness",
      repo_root: repoRoot,
      observed_at_ms: 1717000000300,
      mode: "fast",
      status: "running",
      final_score: null,
      hard_gate_blocked: null,
      score_blocked: null,
      duration_ms: 0,
      metric_count: 4,
      artifact_path: null,
    });

    const status = await readFitnessRuntimeStatusForRepoRoot(repoRoot);

    expect(status.activeRun?.mode).toBe("fast");
    expect(status.activeRun?.status).toBe("running");
    expect(status.latestRun?.mode).toBe("full");
    expect(status.latestRun?.status).toBe("failed");
    expect(status.latestRun?.hardGateFailureCount).toBe(2);
    expect(status.latestRun?.failingMetricCount).toBe(1);
    expect(status.latestRun?.blockerCount).toBe(2);
  });

  it("falls back to the latest runtime snapshot when mailbox events are missing", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "routa-fitness-runtime-"));
    const runtimeRoot = runtimeRootForRepo(repoRoot);
    runtimeRoots.add(runtimeRoot);

    writeJson(path.join(runtimeRoot, "artifacts", "fitness", "latest-fast.json"), {
      mode: "fast",
      final_score: 98,
      hard_gate_blocked: false,
      score_blocked: false,
      duration_ms: 240,
      metric_count: 6,
      generated_at_ms: 1717000000600,
      artifact_path: path.join(runtimeRoot, "artifacts", "fitness", "1717000000600-fast.json"),
      dimensions: [],
      failing_metrics: [],
    });

    const status = await readFitnessRuntimeStatusForRepoRoot(repoRoot);

    expect(status.activeRun).toBeNull();
    expect(status.latestRun?.mode).toBe("fast");
    expect(status.latestRun?.status).toBe("unknown");
    expect(status.latestRun?.finalScore).toBe(98);
  });
});
