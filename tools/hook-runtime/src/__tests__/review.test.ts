import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runCommandMock = vi.hoisted(() => vi.fn());
const runReviewTriggerSpecialistMock = vi.hoisted(() => vi.fn());

vi.mock("../process.js", () => ({
  runCommand: runCommandMock,
}));

vi.mock("../specialist-review.js", () => ({
  runReviewTriggerSpecialist: runReviewTriggerSpecialistMock,
}));

import { runReviewTriggerPhase } from "../review.js";

describe("runReviewTriggerPhase", () => {
  const originalAllowReviewTriggerPush = process.env.ROUTA_ALLOW_REVIEW_TRIGGER_PUSH;
  const originalAllowReviewUnavailable = process.env.ROUTA_ALLOW_REVIEW_UNAVAILABLE;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Clear environment variables before each test to ensure clean state
    delete process.env.ROUTA_ALLOW_REVIEW_TRIGGER_PUSH;
    delete process.env.ROUTA_ALLOW_REVIEW_UNAVAILABLE;
  });

  afterEach(() => {
    vi.clearAllMocks();
    consoleLogSpy.mockRestore();

    if (originalAllowReviewTriggerPush === undefined) {
      delete process.env.ROUTA_ALLOW_REVIEW_TRIGGER_PUSH;
    } else {
      process.env.ROUTA_ALLOW_REVIEW_TRIGGER_PUSH = originalAllowReviewTriggerPush;
    }

    if (originalAllowReviewUnavailable === undefined) {
      delete process.env.ROUTA_ALLOW_REVIEW_UNAVAILABLE;
    } else {
      process.env.ROUTA_ALLOW_REVIEW_UNAVAILABLE = originalAllowReviewUnavailable;
    }
  });

  it("passes when no review trigger matches", async () => {
    runCommandMock
      .mockResolvedValueOnce({
        command: "git rev-parse",
        durationMs: 5,
        exitCode: 0,
        output: "origin/main\n",
      })
      .mockResolvedValueOnce({
        command: "git rev-parse --show-toplevel",
        durationMs: 5,
        exitCode: 0,
        output: `${process.cwd()}\n`,
      })
      .mockResolvedValueOnce({
        command: "git diff --name-only --diff-filter=ACMR origin/main",
        durationMs: 5,
        exitCode: 0,
        output: "tools/hook-runtime/src/review.ts\n",
      })
      .mockResolvedValueOnce({
        command: "git diff --name-only --diff-filter=ACMR",
        durationMs: 5,
        exitCode: 0,
        output: "",
      })
      .mockResolvedValueOnce({
        command: "git ls-files --others --exclude-standard",
        durationMs: 5,
        exitCode: 0,
        output: "",
      })
      .mockResolvedValueOnce({
        command: "entrix review-trigger",
        durationMs: 10,
        exitCode: 0,
        output: "",
      });

    const result = await runReviewTriggerPhase("jsonl");

    expect(result.allowed).toBe(true);
    expect(result.status).toBe("passed");
    expect(result.base).toBe("origin/main");
    expect(result.triggers).toEqual([]);
  });

  it("blocks a matched review trigger when the specialist rejects it", async () => {
    delete process.env.ROUTA_ALLOW_REVIEW_TRIGGER_PUSH;
    runCommandMock
      .mockResolvedValueOnce({
        command: "git rev-parse",
        durationMs: 5,
        exitCode: 0,
        output: "origin/main\n",
      })
      .mockResolvedValueOnce({
        command: "git rev-parse --show-toplevel",
        durationMs: 5,
        exitCode: 0,
        output: `${process.cwd()}\n`,
      })
      .mockResolvedValueOnce({
        command: "git diff --name-only --diff-filter=ACMR origin/main",
        durationMs: 5,
        exitCode: 0,
        output: "tools/hook-runtime/src/review.ts\n",
      })
      .mockResolvedValueOnce({
        command: "git diff --name-only --diff-filter=ACMR",
        durationMs: 5,
        exitCode: 0,
        output: "tools/hook-runtime/src/runtime.ts\n",
      })
      .mockResolvedValueOnce({
        command: "git ls-files --others --exclude-standard",
        durationMs: 5,
        exitCode: 0,
        output: "tmp/debug.txt\n",
      })
      .mockResolvedValueOnce({
        command: "entrix review-trigger",
        durationMs: 10,
        exitCode: 3,
        output: JSON.stringify({
          base: "origin/main",
          triggers: [{ action: "review", name: "oversized_change", severity: "high" }],
          committed_files: ["tools/hook-runtime/src/review.ts"],
          working_tree_files: ["tools/hook-runtime/src/runtime.ts"],
          untracked_files: ["tmp/debug.txt"],
          diff_stats: { file_count: 1, added_lines: 10, deleted_lines: 2 },
        }),
      });
    runReviewTriggerSpecialistMock.mockResolvedValueOnce({
      allowed: false,
      summary: "Automatic review specialist found a regression risk.",
      findings: [{ severity: "high", title: "Regression risk", reason: "Control flow changed without safeguards." }],
      raw: "{\"verdict\":\"fail\"}",
    });

    const result = await runReviewTriggerPhase("jsonl");

    expect(result.allowed).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.triggers).toHaveLength(1);
    expect(result.committedFiles).toEqual(["tools/hook-runtime/src/review.ts"]);
    expect(result.workingTreeFiles).toEqual(["tools/hook-runtime/src/runtime.ts"]);
    expect(result.untrackedFiles).toEqual(["tmp/debug.txt"]);
    expect(result.message).toContain("regression risk");
  });

  it("prints a compact human summary table for matched triggers", async () => {
    delete process.env.ROUTA_ALLOW_REVIEW_TRIGGER_PUSH;
    runCommandMock
      .mockResolvedValueOnce({
        command: "git rev-parse",
        durationMs: 5,
        exitCode: 0,
        output: "origin/main\n",
      })
      .mockResolvedValueOnce({
        command: "git rev-parse --show-toplevel",
        durationMs: 5,
        exitCode: 0,
        output: `${process.cwd()}\n`,
      })
      .mockResolvedValueOnce({
        command: "git diff --name-only --diff-filter=ACMR origin/main",
        durationMs: 5,
        exitCode: 0,
        output: "src/a.ts\nsrc/b.ts\napi-contract.yaml\n",
      })
      .mockResolvedValueOnce({
        command: "git diff --name-only --diff-filter=ACMR",
        durationMs: 5,
        exitCode: 0,
        output: "src/local-only.ts\n",
      })
      .mockResolvedValueOnce({
        command: "git ls-files --others --exclude-standard",
        durationMs: 5,
        exitCode: 0,
        output: "tmp/debug.txt\n",
      })
      .mockResolvedValueOnce({
        command: "entrix review-trigger",
        durationMs: 10,
        exitCode: 3,
        output: JSON.stringify({
          base: "origin/main",
          triggers: [
            {
              action: "review",
              name: "high_risk_directory_change",
              severity: "high",
              reasons: [
                "changed path: crates/routa-server/src/api/clone_local.rs",
                "changed path: crates/routa-server/src/api/codebases.rs",
                "changed path: crates/routa-server/src/api/mod.rs",
              ],
            },
            {
              action: "review",
              name: "oversized_change",
              severity: "medium",
              reasons: [
                "diff touched 32 files (threshold: 12)",
                "diff added 942 lines (threshold: 600)",
                "diff deleted 636 lines (threshold: 400)",
              ],
            },
          ],
          committed_files: ["src/a.ts", "src/b.ts", "api-contract.yaml"],
          working_tree_files: ["src/local-only.ts"],
          untracked_files: ["tmp/debug.txt"],
          diff_stats: { file_count: 32, added_lines: 942, deleted_lines: 636 },
        }),
      });
    runReviewTriggerSpecialistMock.mockResolvedValueOnce({
      allowed: false,
      summary: "Automatic review specialist found a regression risk.",
      findings: [{ severity: "high", title: "Regression risk", reason: "Control flow changed without safeguards." }],
      raw: "{\"verdict\":\"fail\"}",
    });

    const result = await runReviewTriggerPhase("human");

    expect(result.allowed).toBe(false);
    const output = consoleLogSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    expect(output).toContain("Human review required: 2 triggers across 3 committed files.");
    expect(output).toMatch(/\|\s+Base\s+\|\s+origin\/main\s+\|/);
    expect(output).toMatch(/\|\s+Added lines\s+\|\s+942\s+\|/);
    expect(output).toMatch(/\|\s+Workspace residue\s+\|\s+1 tracked, 1 untracked\s+\|/);
    expect(output).toContain("Matched triggers:");
    expect(output).toContain("[high] High Risk Directory Change");
    expect(output).toContain("changed path: 3 items. Examples:");
    expect(output).not.toContain("- Base: origin/main");
  });

  it("allows matched review trigger when bypass env var is set", async () => {
    process.env.ROUTA_ALLOW_REVIEW_TRIGGER_PUSH = "1";
    runCommandMock
      .mockResolvedValueOnce({
        command: "git rev-parse",
        durationMs: 5,
        exitCode: 0,
        output: "origin/main\n",
      })
      .mockResolvedValueOnce({
        command: "git rev-parse --show-toplevel",
        durationMs: 5,
        exitCode: 0,
        output: `${process.cwd()}\n`,
      })
      .mockResolvedValueOnce({
        command: "git diff --name-only --diff-filter=ACMR origin/main",
        durationMs: 5,
        exitCode: 0,
        output: "tools/hook-runtime/src/review.ts\n",
      })
      .mockResolvedValueOnce({
        command: "git diff --name-only --diff-filter=ACMR",
        durationMs: 5,
        exitCode: 0,
        output: "",
      })
      .mockResolvedValueOnce({
        command: "git ls-files --others --exclude-standard",
        durationMs: 5,
        exitCode: 0,
        output: "",
      })
      .mockResolvedValueOnce({
        command: "entrix review-trigger",
        durationMs: 10,
        exitCode: 3,
        output: JSON.stringify({
          base: "origin/main",
          triggers: [{ action: "review", name: "oversized_change", severity: "high" }],
          committed_files: ["tools/hook-runtime/src/review.ts"],
          diff_stats: { file_count: 1, added_lines: 10, deleted_lines: 2 },
        }),
      });

    const result = await runReviewTriggerPhase("jsonl");

    expect(result.allowed).toBe(true);
    expect(result.status).toBe("passed");
    expect(result.bypassed).toBe(true);
    expect(result.triggers).toHaveLength(1);
    expect(result.message).toContain("ROUTA_ALLOW_REVIEW_TRIGGER_PUSH=1 set");
    expect(runReviewTriggerSpecialistMock).not.toHaveBeenCalled();
  });

  it("falls back to legacy changed_files payloads", async () => {
    runCommandMock
      .mockResolvedValueOnce({
        command: "git rev-parse",
        durationMs: 5,
        exitCode: 0,
        output: "origin/main\n",
      })
      .mockResolvedValueOnce({
        command: "git rev-parse --show-toplevel",
        durationMs: 5,
        exitCode: 0,
        output: `${process.cwd()}\n`,
      })
      .mockResolvedValueOnce({
        command: "git diff --name-only --diff-filter=ACMR origin/main",
        durationMs: 5,
        exitCode: 0,
        output: "tools/hook-runtime/src/review.ts\n",
      })
      .mockResolvedValueOnce({
        command: "git diff --name-only --diff-filter=ACMR",
        durationMs: 5,
        exitCode: 0,
        output: "",
      })
      .mockResolvedValueOnce({
        command: "git ls-files --others --exclude-standard",
        durationMs: 5,
        exitCode: 0,
        output: "",
      })
      .mockResolvedValueOnce({
        command: "entrix review-trigger",
        durationMs: 10,
        exitCode: 3,
        output: JSON.stringify({
          base: "origin/main",
          triggers: [{ action: "review", name: "oversized_change", severity: "high" }],
          changed_files: ["tools/hook-runtime/src/review.ts"],
          diff_stats: { file_count: 1, added_lines: 10, deleted_lines: 2 },
        }),
      });
    runReviewTriggerSpecialistMock.mockResolvedValueOnce({
      allowed: true,
      summary: "Automatic review specialist approved the push.",
      findings: [],
      raw: "{\"verdict\":\"pass\"}",
    });

    const result = await runReviewTriggerPhase("jsonl");

    expect(result.changedFiles).toEqual(["tools/hook-runtime/src/review.ts"]);
    expect(result.committedFiles).toEqual(["tools/hook-runtime/src/review.ts"]);
    expect(result.allowed).toBe(true);
  });

  it("passes without invoking entrix when push scope has no committed files", async () => {
    runCommandMock
      .mockResolvedValueOnce({
        command: "git rev-parse",
        durationMs: 5,
        exitCode: 0,
        output: "origin/main\n",
      })
      .mockResolvedValueOnce({
        command: "git rev-parse --show-toplevel",
        durationMs: 5,
        exitCode: 0,
        output: `${process.cwd()}\n`,
      })
      .mockResolvedValueOnce({
        command: "git diff --name-only --diff-filter=ACMR origin/main",
        durationMs: 5,
        exitCode: 0,
        output: "",
      })
      .mockResolvedValueOnce({
        command: "git diff --name-only --diff-filter=ACMR",
        durationMs: 5,
        exitCode: 0,
        output: "tools/hook-runtime/src/runtime.ts\n",
      })
      .mockResolvedValueOnce({
        command: "git ls-files --others --exclude-standard",
        durationMs: 5,
        exitCode: 0,
        output: "tmp/debug.txt\n",
      });

    const result = await runReviewTriggerPhase("jsonl");

    expect(result.allowed).toBe(true);
    expect(result.status).toBe("passed");
    expect(result.committedFiles).toEqual([]);
    expect(result.workingTreeFiles).toEqual(["tools/hook-runtime/src/runtime.ts"]);
    expect(result.untrackedFiles).toEqual(["tmp/debug.txt"]);
    expect(runCommandMock).toHaveBeenCalledTimes(5);
  });

  it("blocks push when review evaluation is unavailable by default", async () => {
    runCommandMock
      .mockResolvedValueOnce({
        command: "git rev-parse",
        durationMs: 5,
        exitCode: 0,
        output: "origin/main\n",
      })
      .mockResolvedValueOnce({
        command: "git rev-parse --show-toplevel",
        durationMs: 5,
        exitCode: 0,
        output: `${process.cwd()}\n`,
      })
      .mockResolvedValueOnce({
        command: "git diff --name-only --diff-filter=ACMR origin/main",
        durationMs: 5,
        exitCode: 0,
        output: "tools/hook-runtime/src/review.ts\n",
      })
      .mockResolvedValueOnce({
        command: "git diff --name-only --diff-filter=ACMR",
        durationMs: 5,
        exitCode: 0,
        output: "",
      })
      .mockResolvedValueOnce({
        command: "git ls-files --others --exclude-standard",
        durationMs: 5,
        exitCode: 0,
        output: "",
      })
      .mockResolvedValueOnce({
        command: "entrix review-trigger",
        durationMs: 10,
        exitCode: 2,
        output: "python error",
      });

    const result = await runReviewTriggerPhase("jsonl");

    expect(result.allowed).toBe(false);
    expect(result.bypassed).toBe(false);
    expect(result.status).toBe("unavailable");
    expect(result.message).toContain("Blocking push");
    expect(result.message).toContain("ROUTA_ALLOW_REVIEW_UNAVAILABLE=1");
  });

  it("prints a short unavailable message in human mode when specialist review fails", async () => {
    runCommandMock
      .mockResolvedValueOnce({
        command: "git rev-parse",
        durationMs: 5,
        exitCode: 0,
        output: "origin/main\n",
      })
      .mockResolvedValueOnce({
        command: "git rev-parse --show-toplevel",
        durationMs: 5,
        exitCode: 0,
        output: `${process.cwd()}\n`,
      })
      .mockResolvedValueOnce({
        command: "git diff --name-only --diff-filter=ACMR origin/main",
        durationMs: 5,
        exitCode: 0,
        output: "tools/hook-runtime/src/review.ts\n",
      })
      .mockResolvedValueOnce({
        command: "git diff --name-only --diff-filter=ACMR",
        durationMs: 5,
        exitCode: 0,
        output: "",
      })
      .mockResolvedValueOnce({
        command: "git ls-files --others --exclude-standard",
        durationMs: 5,
        exitCode: 0,
        output: "",
      })
      .mockResolvedValueOnce({
        command: "entrix review-trigger",
        durationMs: 10,
        exitCode: 3,
        output: JSON.stringify({
          base: "origin/main",
          triggers: [{ action: "review", name: "oversized_change", severity: "high" }],
          committed_files: ["tools/hook-runtime/src/review.ts"],
          diff_stats: { file_count: 1, added_lines: 10, deleted_lines: 2 },
        }),
      });
    runReviewTriggerSpecialistMock.mockRejectedValueOnce(
      new Error("Missing ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY for automatic review specialist."),
    );

    const result = await runReviewTriggerPhase("human");

    expect(result.allowed).toBe(false);
    expect(result.status).toBe("unavailable");
    const output = consoleLogSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    expect(output).toContain("Automatic review specialist unavailable.");
    expect(output).toContain("Missing ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY");
    expect(output).toContain("ROUTA_ALLOW_REVIEW_UNAVAILABLE=1");
  });

  it("allows explicit bypass when review evaluation is unavailable", async () => {
    process.env.ROUTA_ALLOW_REVIEW_UNAVAILABLE = "1";
    runCommandMock
      .mockResolvedValueOnce({
        command: "git rev-parse",
        durationMs: 5,
        exitCode: 0,
        output: "origin/main\n",
      })
      .mockResolvedValueOnce({
        command: "git rev-parse --show-toplevel",
        durationMs: 5,
        exitCode: 0,
        output: `${process.cwd()}\n`,
      })
      .mockResolvedValueOnce({
        command: "git diff --name-only --diff-filter=ACMR origin/main",
        durationMs: 5,
        exitCode: 0,
        output: "tools/hook-runtime/src/review.ts\n",
      })
      .mockResolvedValueOnce({
        command: "git diff --name-only --diff-filter=ACMR",
        durationMs: 5,
        exitCode: 0,
        output: "",
      })
      .mockResolvedValueOnce({
        command: "git ls-files --others --exclude-standard",
        durationMs: 5,
        exitCode: 0,
        output: "",
      })
      .mockResolvedValueOnce({
        command: "entrix review-trigger",
        durationMs: 10,
        exitCode: 2,
        output: "python error",
      });

    const result = await runReviewTriggerPhase("jsonl");

    expect(result.allowed).toBe(true);
    expect(result.bypassed).toBe(true);
    expect(result.status).toBe("unavailable");
    expect(result.message).toContain("ROUTA_ALLOW_REVIEW_UNAVAILABLE=1");
  });

  it("marks review unavailable when executed from a non-repository root", async () => {
    runCommandMock
      .mockResolvedValueOnce({
        command: "git rev-parse",
        durationMs: 5,
        exitCode: 0,
        output: "origin/main\n",
      })
      .mockResolvedValueOnce({
        command: "git rev-parse --show-toplevel",
        durationMs: 5,
        exitCode: 0,
        output: "/tmp/other-repo\n",
      });

    const result = await runReviewTriggerPhase("jsonl");

    expect(result.allowed).toBe(false);
    expect(result.status).toBe("unavailable");
    expect(runCommandMock).toHaveBeenCalledTimes(2);
    expect(result.message).toContain("Review scope mismatch");
  });

  it("marks review unavailable when git root cannot be resolved", async () => {
    runCommandMock
      .mockResolvedValueOnce({
        command: "git rev-parse",
        durationMs: 5,
        exitCode: 0,
        output: "origin/main\n",
      })
      .mockResolvedValueOnce({
        command: "git rev-parse --show-toplevel",
        durationMs: 5,
        exitCode: 1,
        output: "",
      });

    const result = await runReviewTriggerPhase("jsonl");

    expect(result.allowed).toBe(false);
    expect(result.status).toBe("unavailable");
    expect(result.message).toContain("No git repository root found");
    expect(runCommandMock).toHaveBeenCalledTimes(2);
  });

  it("allows explicit bypass when git root cannot be resolved", async () => {
    process.env.ROUTA_ALLOW_REVIEW_UNAVAILABLE = "1";
    runCommandMock
      .mockResolvedValueOnce({
        command: "git rev-parse",
        durationMs: 5,
        exitCode: 0,
        output: "origin/main\n",
      })
      .mockResolvedValueOnce({
        command: "git rev-parse --show-toplevel",
        durationMs: 5,
        exitCode: 1,
        output: "",
      });

    const result = await runReviewTriggerPhase("jsonl");

    expect(result.allowed).toBe(true);
    expect(result.status).toBe("unavailable");
    expect(result.bypassed).toBe(true);
    expect(result.message).toContain("No git repository root found");
  });
});
