import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Helper to remove directory with retries for Windows file locking issues
async function rmWithRetry(dir: string, retries = 5, delay = 200): Promise<void> {
  // On Windows, files can be locked briefly after operations
  if (process.platform === "win32") {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (let i = 0; i < retries; i++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      if (i === retries - 1) {
        // On Windows, if cleanup fails, just warn and continue
        // The OS will clean up temp files eventually
        if (process.platform === "win32") {
          console.warn(`Warning: Could not clean up temp directory ${dir}: ${err}`);
          return;
        }
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

describe("loadHookMetrics", () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
    vi.resetModules();
  });

  it("returns a clear message when fitness manifest is missing", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "hook-metric-missing-"));
    process.chdir(tempDir);
    vi.resetModules();

    const { loadHookMetrics } = await import("../metrics.js");

    await expect(loadHookMetrics(["eslint_pass"])).rejects.toThrow(
      'Cannot find fitness manifest at "docs/fitness/manifest.yaml"',
    );

    await rmWithRetry(tempDir);
  });

  it("keeps explicit metric-not-found messaging", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "hook-metric-missing-metric-"));
    const docsDir = path.join(tempDir, "docs", "fitness");
    await mkdir(docsDir, { recursive: true });
    await writeFile(path.join(docsDir, "manifest.yaml"), "evidence_files:\n  - docs/fitness/sample.md\n", "utf-8");
    await writeFile(path.join(docsDir, "sample.md"), "---\nmetrics:\n  - name: existing_metric\n    command: echo ok\n    hard_gate: true\n---\nplaceholder\n", "utf-8");

    process.chdir(tempDir);
    vi.resetModules();
    const { loadHookMetrics } = await import("../metrics.js");

    await expect(loadHookMetrics(["missing_metric"])).rejects.toThrow(
      'Unable to find fitness metric "missing_metric" in docs/fitness manifest files.',
    );

    await rmWithRetry(tempDir);
  });

  it("parses serial execution hints from frontmatter metrics", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "hook-metric-serial-"));
    const docsDir = path.join(tempDir, "docs", "fitness");
    await mkdir(docsDir, { recursive: true });
    await writeFile(path.join(docsDir, "manifest.yaml"), "evidence_files:\n  - docs/fitness/sample.md\n", "utf-8");
    await writeFile(
      path.join(docsDir, "sample.md"),
      "---\nmetrics:\n  - name: rust_test_pass\n    command: cargo test\n    hard_gate: true\n    serial: true\n---\nplaceholder\n",
      "utf-8",
    );

    process.chdir(tempDir);
    vi.resetModules();
    const { loadHookMetrics } = await import("../metrics.js");

    const [metric] = await loadHookMetrics(["rust_test_pass"]);
    expect(metric?.serial).toBe(true);

    await rmWithRetry(tempDir);
  });
});
