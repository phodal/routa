import { describe, expect, it, vi } from "vitest";

import {
  resolveFailureRoute,
  runRuntime,
  runHookRuntime,
  splitMetricsByExecutionMode,
  type HookRuntimeOptions,
  type HookRuntimeProfile,
  type ReviewPhaseResult,
} from "../runtime.js";
import type { HookMetric } from "../metrics.js";

function buildMetric(name: string, serial = false): HookMetric {
  return {
    command: `echo ${name}`,
    hardGate: true,
    name,
    serial,
    sourceFile: "docs/fitness/unit-test.md",
  };
}

describe("runHookRuntime", () => {
  it("executes phases strictly by profile order through adapters", async () => {
    const options = {
      autoFix: false,
      dryRun: false,
      failFast: true,
      jobs: 2,
      metricNames: ["eslint_pass"],
      outputMode: "human" as const,
      profile: "local-validate",
      tailLines: 10,
    } satisfies HookRuntimeOptions;

    const profile: HookRuntimeProfile = {
      fallbackMetrics: ["eslint_pass"],
      name: "local-validate",
      phases: ["fitness", "review"],
    };

    const reviewResult: ReviewPhaseResult = {
      allowed: true,
      base: "origin/main",
      bypassed: false,
      changedFiles: [],
      diffFileCount: 0,
      message: "review passed",
      status: "passed",
      triggers: [],
    };

    const runSubmodulePhase = vi.fn();
    const runFitnessPhase = vi.fn(async () => []);
    const runReviewPhase = vi.fn(async () => reviewResult);

    await runHookRuntime(
      options,
      profile,
      {
        phaseAdapters: {
          runSubmodulePhase,
          runFitnessPhase,
          runReviewPhase,
        },
      },
    );

    expect(runFitnessPhase).toHaveBeenCalledTimes(1);
    expect(runFitnessPhase).toHaveBeenCalledWith(options, 1, 2);
    expect(runReviewPhase).toHaveBeenCalledTimes(1);
    expect(runReviewPhase).toHaveBeenCalledWith(false, "human", 2, 2);
    expect(runSubmodulePhase).not.toHaveBeenCalled();
  });

  it("runs fitness-fast as an alias for the fitness phase order", async () => {
    const options = {
      autoFix: false,
      dryRun: false,
      failFast: true,
      jobs: 2,
      metricNames: ["eslint_pass"],
      outputMode: "human" as const,
      profile: "pre-commit",
      tailLines: 10,
    } satisfies HookRuntimeOptions;

    const profile: HookRuntimeProfile = {
      fallbackMetrics: ["eslint_pass"],
      name: "pre-commit",
      phases: ["fitness-fast", "review"],
    };

    const reviewResult: ReviewPhaseResult = {
      allowed: true,
      base: "origin/main",
      bypassed: false,
      changedFiles: [],
      diffFileCount: 0,
      message: "review passed",
      status: "passed",
      triggers: [],
    };

    const runFitnessPhase = vi.fn(async () => []);
    const runReviewPhase = vi.fn(async () => reviewResult);

    await runHookRuntime(
      options,
      profile,
      {
        phaseAdapters: {
          runFitnessPhase,
          runReviewPhase,
        },
      },
    );

    expect(runFitnessPhase).toHaveBeenCalledTimes(1);
    expect(runFitnessPhase).toHaveBeenCalledWith(options, 1, 2);
    expect(runReviewPhase).toHaveBeenCalledTimes(1);
    expect(runReviewPhase).toHaveBeenCalledWith(false, "human", 2, 2);
  });

  it("uses resolveRuntimeProfile through runRuntime by profile name", async () => {
    const options = {
      autoFix: false,
      dryRun: false,
      failFast: true,
      jobs: 2,
      metricNames: ["eslint_pass"],
      outputMode: "human" as const,
      profile: "pre-commit",
      tailLines: 10,
    } satisfies HookRuntimeOptions;

    const runFitnessPhase = vi.fn(async () => []);

    await runRuntime(
      options,
      "pre-commit",
      {
        phaseAdapters: {
          runFitnessPhase,
        },
      },
    );

    expect(runFitnessPhase).toHaveBeenCalledTimes(1);
  });

  it("resolves the agent failure route when running in an agent context", () => {
    const options = {
      autoFix: false,
      dryRun: false,
      failFast: true,
      jobs: 2,
      metricNames: ["eslint_pass"],
      outputMode: "human" as const,
      profile: "pre-commit",
      tailLines: 10,
    } satisfies HookRuntimeOptions;

    const route = resolveFailureRoute(
      options,
      {
        isAiAgent: true,
        hasClaude: true,
      },
      {
        outputMode: "human",
        autoFix: false,
      },
    );

    expect(route.name).toBe("agent");
  });

  it("resolves the missing-claude failure route when claude is unavailable", async () => {
    const options = {
      autoFix: false,
      dryRun: false,
      failFast: true,
      jobs: 2,
      metricNames: ["eslint_pass"],
      outputMode: "human" as const,
      profile: "pre-commit",
      tailLines: 10,
    } satisfies HookRuntimeOptions;

    const route = resolveFailureRoute(
      options,
      {
        isAiAgent: false,
        hasClaude: false,
      },
      {
        outputMode: "human",
        autoFix: false,
      },
    );

    await expect(route.execute([], options)).rejects.toThrow("Claude CLI not found");
    expect(route.name).toBe("missing-claude");
  });

  it("resolves the auto-fix failure route when auto-fix is enabled", () => {
    const options = {
      autoFix: true,
      dryRun: false,
      failFast: true,
      jobs: 2,
      metricNames: ["eslint_pass"],
      outputMode: "human" as const,
      profile: "pre-commit",
      tailLines: 10,
    } satisfies HookRuntimeOptions;

    const route = resolveFailureRoute(
      options,
      {
        isAiAgent: false,
        hasClaude: true,
      },
      {
        outputMode: "human",
        autoFix: true,
      },
    );

    expect(route.name).toBe("auto-fix");
  });

  it("splits serial metrics out of the parallel execution pool", () => {
    const result = splitMetricsByExecutionMode([
      buildMetric("eslint_pass"),
      buildMetric("rust_test_pass", true),
      buildMetric("ts_test_pass_full"),
    ]);

    expect(result.parallelMetrics.map((metric) => metric.name)).toEqual([
      "eslint_pass",
      "ts_test_pass_full",
    ]);
    expect(result.serialMetrics.map((metric) => metric.name)).toEqual([
      "rust_test_pass",
    ]);
  });
});
