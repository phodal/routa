import { afterEach, describe, expect, it, vi } from "vitest";

import { formatReviewPhaseLabel, handleCliError, parseArgs } from "../cli.js";

describe("handleCliError", () => {
  const originalOutputMode = process.env.ROUTA_HOOK_RUNTIME_OUTPUT_MODE;
  const originalMetrics = process.env.ROUTA_HOOK_RUNTIME_METRICS;
  const originalProfile = process.env.ROUTA_HOOK_RUNTIME_PROFILE;
  const originalReviewUnavailable = process.env.ROUTA_ALLOW_REVIEW_UNAVAILABLE;
  const originalReviewProvider = process.env.ROUTA_REVIEW_PROVIDER;

  afterEach(() => {
    process.exitCode = undefined;
    if (originalOutputMode === undefined) {
      delete process.env.ROUTA_HOOK_RUNTIME_OUTPUT_MODE;
    } else {
      process.env.ROUTA_HOOK_RUNTIME_OUTPUT_MODE = originalOutputMode;
    }
    if (originalMetrics === undefined) {
      delete process.env.ROUTA_HOOK_RUNTIME_METRICS;
    } else {
      process.env.ROUTA_HOOK_RUNTIME_METRICS = originalMetrics;
    }
    if (originalProfile === undefined) {
      delete process.env.ROUTA_HOOK_RUNTIME_PROFILE;
    } else {
      process.env.ROUTA_HOOK_RUNTIME_PROFILE = originalProfile;
    }
    if (originalReviewUnavailable === undefined) {
      delete process.env.ROUTA_ALLOW_REVIEW_UNAVAILABLE;
    } else {
      process.env.ROUTA_ALLOW_REVIEW_UNAVAILABLE = originalReviewUnavailable;
    }
    if (originalReviewProvider === undefined) {
      delete process.env.ROUTA_REVIEW_PROVIDER;
    } else {
      process.env.ROUTA_REVIEW_PROVIDER = originalReviewProvider;
    }
    vi.restoreAllMocks();
  });

  it("sets a non-zero exit code in human mode", () => {
    delete process.env.ROUTA_HOOK_RUNTIME_OUTPUT_MODE;
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    handleCliError(new Error("Review-trigger matched in a non-interactive push."), []);

    expect(stderr).toHaveBeenCalledWith("Review-trigger matched in a non-interactive push.");
    expect(process.exitCode).toBe(1);
  });

  it("sets a non-zero exit code in jsonl mode without writing to stderr", () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    handleCliError(new Error("blocked"), ["--jsonl"]);

    expect(stderr).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});

describe("parseArgs", () => {
  it("defaults profile and metrics from pre-push profile by default", () => {
    const options = parseArgs([]);
    expect(options.profile).toBe("pre-push");
    expect(options.profilePhases).toEqual(["submodule", "fitness", "review"]);
    expect(options.metricNames).toEqual([
      "eslint_pass",
      "ts_typecheck_pass",
      "ts_test_pass_full",
      "clippy_pass",
      "rust_test_pass",
      "graph_test_mapping_probe",
    ]);
  });

  it("defaults profile and metrics for pre-commit", () => {
    const options = parseArgs(["--profile", "pre-commit"]);
    expect(options.profile).toBe("pre-commit");
    expect(options.profilePhases).toEqual(["fitness-fast"]);
    expect(options.metricNames).toEqual(["eslint_pass"]);
  });

  it("uses profile name from environment when no explicit argument is given", () => {
    process.env.ROUTA_HOOK_RUNTIME_PROFILE = "local-validate";
    const options = parseArgs([]);
    expect(options.profile).toBe("local-validate");
    expect(options.profilePhases).toEqual(["fitness", "review"]);
  });

  it("lets explicit --metrics override profile fallback metrics", () => {
    const options = parseArgs(["--profile", "pre-commit", "--metrics", "clippy_pass,rust_test_pass"]);

    expect(options.profile).toBe("pre-commit");
    expect(options.metricNames).toEqual(["clippy_pass", "rust_test_pass"]);
  });

  it("uses metric names from environment by default", () => {
    process.env.ROUTA_HOOK_RUNTIME_METRICS = "eslint_pass,ts_test_pass";

    const options = parseArgs([]);

    expect(options.metricNames).toEqual(["eslint_pass", "ts_test_pass"]);
  });

  it("lets --metrics override env metric names", () => {
    process.env.ROUTA_HOOK_RUNTIME_METRICS = "eslint_pass,ts_test_pass";

    const options = parseArgs(["--metrics", "clippy_pass,rust_test_pass"]);

    expect(options.metricNames).toEqual(["clippy_pass", "rust_test_pass"]);
  });

  it("supports run subcommand style invocation", () => {
    const options = parseArgs(["run", "--profile", "local-validate"]);

    expect(options.profile).toBe("local-validate");
    expect(options.profilePhases).toEqual(["fitness", "review"]);
  });

  it("supports --allow-review-unavailable to bypass review scope gating", () => {
    const prev = process.env.ROUTA_ALLOW_REVIEW_UNAVAILABLE;
    delete process.env.ROUTA_ALLOW_REVIEW_UNAVAILABLE;
    try {
      const options = parseArgs(["run", "--allow-review-unavailable", "--profile", "local-validate"]);

      expect(options.allowReviewUnavailable).toBe(true);
      expect(process.env.ROUTA_ALLOW_REVIEW_UNAVAILABLE).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.ROUTA_ALLOW_REVIEW_UNAVAILABLE = prev;
    }
  });

  it("accepts --provider and keeps it in parsed options", () => {
    const options = parseArgs(["run", "--provider", "claude", "--profile", "local-validate"]);

    expect(options.reviewProvider).toBe("claude");
  });

  it("defaults review provider from environment when not explicitly set", () => {
    process.env.ROUTA_REVIEW_PROVIDER = "anthropic";

    const options = parseArgs([]);

    expect(options.reviewProvider).toBe("anthropic");
  });
});

describe("formatReviewPhaseLabel", () => {
  it("describes unavailable review state without flattening it to blocked", () => {
    expect(
      formatReviewPhaseLabel({
        allowed: false,
        base: "origin/main",
        bypassed: false,
        message: "review unavailable",
        status: "unavailable",
        triggers: [],
      }),
    ).toBe("unavailable");
  });

  it("marks bypassed unavailable review state explicitly", () => {
    expect(
      formatReviewPhaseLabel({
        allowed: true,
        base: "origin/main",
        bypassed: true,
        message: "review unavailable but bypassed",
        status: "unavailable",
        triggers: [],
      }),
    ).toBe("unavailable (bypassed)");
  });
});
