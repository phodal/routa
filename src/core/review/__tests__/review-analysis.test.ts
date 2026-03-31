import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { buildReviewAnalysisPayload } from "../review-analysis";

const tempDirs: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitNoGpgCommit(cwd: string, ...args: string[]): string {
  if (args[0] === "commit") {
    return git(cwd, "-c", "commit.gpgSign=false", ...args);
  }
  return git(cwd, ...args);
}

describe("buildReviewAnalysisPayload", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("collects diff, changed files, and review rules from a local repo", () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "routa-review-"));
    tempDirs.push(repoDir);

    git(repoDir, "init", "-b", "main");
    git(repoDir, "config", "user.name", "Routa Test");
    git(repoDir, "config", "user.email", "test@example.com");

    fs.writeFileSync(path.join(repoDir, "AGENTS.md"), "# Test\n");
    fs.mkdirSync(path.join(repoDir, ".routa"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, ".routa", "review-rules.md"), "Ignore formatting-only issues.\n");
    fs.writeFileSync(path.join(repoDir, "example.ts"), "export const value = 1;\n");

    git(repoDir, "add", ".");
    gitNoGpgCommit(repoDir, "commit", "-m", "initial");

    fs.writeFileSync(path.join(repoDir, "example.ts"), "export const value = 2;\n");
    git(repoDir, "add", "example.ts");
    gitNoGpgCommit(repoDir, "commit", "-m", "update");

    const payload = buildReviewAnalysisPayload({
      repoPath: repoDir,
      base: "HEAD~1",
      head: "HEAD",
    });

    // Verify repoRoot exists and points to the same canonical directory.
    // This avoids false negatives where equivalent paths differ in presentation
    // (e.g. /var vs /private/var on macOS, 8.3 aliases on Windows).
    expect(fs.existsSync(payload.repoRoot)).toBe(true);
    expect(fs.realpathSync.native(payload.repoRoot)).toBe(fs.realpathSync.native(repoDir));
    expect(payload.changedFiles).toContain("example.ts");
    expect(payload.diff).toContain("-export const value = 1;");
    expect(payload.diff).toContain("+export const value = 2;");
    expect(payload.reviewRules).toContain("Ignore formatting-only issues.");
    expect(payload.configSnippets.some((snippet) => snippet.path === "AGENTS.md")).toBe(true);
  }, 15_000);
});
