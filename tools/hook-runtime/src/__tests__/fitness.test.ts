import { describe, expect, it, vi } from "vitest";

import type { HookMetric } from "../metrics.js";

const runCommandMock = vi.hoisted(() => vi.fn());

vi.mock("../process.js", async () => {
  const actual = await vi.importActual<typeof import("../process.js")>("../process.js");
  return {
    ...actual,
    runCommand: runCommandMock,
  };
});

import { runMetric, summarizeFailures } from "../fitness.js";

function buildMetric(overrides: Partial<HookMetric> = {}): HookMetric {
  return {
    command: "fake-command",
    hardGate: true,
    name: "rust_test_pass",
    pattern: "test result: ok",
    sourceFile: "docs/fitness/unit-test.md",
    ...overrides,
  };
}

describe("runMetric", () => {
  it("fails when the command exits non-zero even if the pattern appears in output", async () => {
    runCommandMock.mockResolvedValueOnce({
      command: "fake-command",
      durationMs: 10,
      exitCode: 1,
      output: "test result: ok\nerror: later failure",
    });

    const result = await runMetric(buildMetric());

    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it("passes only when the command exits zero and the pattern matches", async () => {
    runCommandMock.mockResolvedValueOnce({
      command: "fake-command",
      durationMs: 10,
      exitCode: 0,
      output: "test result: ok",
    });

    const result = await runMetric(buildMetric());

    expect(result.passed).toBe(true);
  });

  it("forwards env overrides to the process runner", async () => {
    runCommandMock.mockResolvedValueOnce({
      command: "fake-command",
      durationMs: 10,
      exitCode: 0,
      output: "test result: ok",
    });

    await runMetric(buildMetric(), {
      env: {
        NODE_ENV: process.env.NODE_ENV ?? "test",
        ROUTA_FITNESS_CHANGED_BASE: "origin/main",
      },
    });

    expect(runCommandMock).toHaveBeenCalledWith(
      "fake-command",
      expect.objectContaining({
        env: expect.objectContaining({
          ROUTA_FITNESS_CHANGED_BASE: "origin/main",
        }),
      }),
    );
  });
});

describe("summarizeFailures", () => {
  it("prefers vitest failed test names over generic error lines", () => {
    const results = [
      {
        durationMs: 25,
        exitCode: 1,
        metric: buildMetric({ name: "ts_test_pass" }),
        output: [
          "stdout | some.test.ts > prints an expected failure log",
          "Type error: Something else",
          "",
          " FAIL  tools/hook-runtime/src/__tests__/actual-broken.test.ts > actual broken case",
          "AssertionError: expected true to be false",
        ].join("\n"),
        passed: false,
      },
    ];

    const [summary] = summarizeFailures(results);

    expect(summary?.outputTail).toContain("FAIL  tools/hook-runtime/src/__tests__/actual-broken.test.ts > actual broken case");
    expect(summary?.outputTail).not.toContain("Type error: Something else");
  });

  it("extracts vitest failure headers from ansi-colored terminal output", () => {
    const results = [
      {
        durationMs: 25,
        exitCode: 1,
        metric: buildMetric({ name: "ts_test_pass" }),
        output: [
          "stdout | src/core/acp/__tests__/session-write-buffer.test.ts > SessionWriteBuffer > error handling > continues working after a persist failure",
          "stderr | src/core/kanban/__tests__/workflow-orchestrator-singleton.test.ts > workflow orchestrator singleton prompt path > falls back to session/prompt when agent message fails",
          "\u001b[31mFAIL\u001b[39m  src/core/acp/__tests__/actual-broken.test.ts > actual broken case",
          "AssertionError: expected true to be false",
        ].join("\n"),
        passed: false,
      },
    ];

    const [summary] = summarizeFailures(results);

    expect(summary?.outputTail).toContain("FAIL  src/core/acp/__tests__/actual-broken.test.ts > actual broken case");
    expect(summary?.outputTail).not.toContain("continues working after a persist failure");
    expect(summary?.outputTail).not.toContain("falls back to session/prompt when agent message fails");
  });

  it("keeps the assertion lines that belong to the failing vitest block", () => {
    const results = [
      {
        durationMs: 25,
        exitCode: 1,
        metric: buildMetric({ name: "ts_test_pass" }),
        output: [
          "stdout | src/core/acp/__tests__/session-write-buffer.test.ts > SessionWriteBuffer > error handling > does not throw when persistFn fails",
          "[SessionWriteBuffer] Flush failed for s1: Error: DB down",
          "stderr | src/core/acp/__tests__/session-write-buffer.test.ts > SessionWriteBuffer > error handling > continues working after a persist failure",
          "[SessionWriteBuffer] Flush failed for s1: Error: DB down",
          "FAIL  src/core/acp/__tests__/session-write-buffer.test.ts > SessionWriteBuffer > error handling > does not throw when persistFn fails",
          "AssertionError: expected promise to resolve but it rejected with 'Error: DB down'",
          "at src/core/acp/__tests__/session-write-buffer.test.ts:82:15",
          "stdout | src/core/kanban/__tests__/workflow-orchestrator-singleton.test.ts > workflow orchestrator singleton prompt path > falls back to session/prompt when agent message fails",
        ].join("\n"),
        passed: false,
      },
    ];

    const [summary] = summarizeFailures(results);

    expect(summary?.outputTail).toContain(
      "FAIL  src/core/acp/__tests__/session-write-buffer.test.ts > SessionWriteBuffer > error handling > does not throw when persistFn fails",
    );
    expect(summary?.outputTail).toContain(
      "AssertionError: expected promise to resolve but it rejected with 'Error: DB down'",
    );
    expect(summary?.outputTail).toContain("at src/core/acp/__tests__/session-write-buffer.test.ts:82:15");
    expect(summary?.outputTail).not.toContain("workflow orchestrator singleton prompt path");
  });

  it("keeps full lines when the excerpt is trimmed to the tail", () => {
    const results = [
      {
        durationMs: 25,
        exitCode: 1,
        metric: buildMetric({ name: "ts_test_pass" }),
        output: [
          ...Array.from({ length: 300 }, (_, index) => `noise ${index}`),
          "stdout | src/core/acp/__tests__/session-write-buffer.test.ts > SessionWriteBuffer > error handling > does not throw when persistFn fails",
          "[SessionWriteBuffer] Flush failed for s1: Error: DB down",
          "at src/core/acp/__tests__/session-write-buffer.test.ts:82:15",
        ].join("\n"),
        passed: false,
      },
    ];

    const [summary] = summarizeFailures(results);

    expect(summary?.outputTail.startsWith("| src/core/acp")).toBe(false);
    expect(summary?.outputTail).toContain("stdout | src/core/acp/__tests__/session-write-buffer.test.ts");
  });

  it("extracts a likely test failure block when vitest does not print a FAIL header", () => {
    const results = [
      {
        durationMs: 25,
        exitCode: 1,
        metric: buildMetric({ name: "ts_test_pass" }),
        output: [
          "| src/core/acp/__tests__/session-write-buffer.test.ts > SessionWriteBuffer > error handling > does not throw when persistFn fails",
          "[SessionWriteBuffer] Flush failed for s1: Error: DB down",
          "at runWithTimeout (file:///Users/phodal/ai/routa-js/node_modules/@vitest/runner/dist/index.js:1627:10)",
          "stderr | src/core/acp/__tests__/session-write-buffer.test.ts > SessionWriteBuffer > error handling > continues working after a persist failure",
          "[SessionWriteBuffer] Flush failed for s1: Error: DB down",
          "stdout | src/core/kanban/__tests__/workflow-orchestrator-singleton.test.ts > workflow orchestrator singleton prompt path > falls back to session/prompt when agent message fails",
        ].join("\n"),
        passed: false,
      },
    ];

    const [summary] = summarizeFailures(results);

    expect(summary?.outputTail).toContain(
      "| src/core/acp/__tests__/session-write-buffer.test.ts > SessionWriteBuffer > error handling > does not throw when persistFn fails",
    );
    expect(summary?.outputTail).toContain("[SessionWriteBuffer] Flush failed for s1: Error: DB down");
    expect(summary?.outputTail).toContain("at runWithTimeout");
    expect(summary?.outputTail).not.toContain("workflow orchestrator singleton prompt path");
  });

  it("keeps the file path for eslint-style diagnostics", () => {
    const results = [
      {
        durationMs: 25,
        exitCode: 1,
        metric: buildMetric({ name: "eslint_pass", command: "npm run lint 2>&1" }),
        output: [
          "/Users/phodal/ai/routa-js/src/client/components/fitness-analysis-charts.tsx",
          "  215:0  error  Parsing error: '}' expected",
          "",
          "✖ 1 problem (1 error, 0 warnings)",
        ].join("\n"),
        passed: false,
      },
    ];

    const [summary] = summarizeFailures(results);

    expect(summary?.focusLine).toBe("/Users/phodal/ai/routa-js/src/client/components/fitness-analysis-charts.tsx");
    expect(summary?.outputTail).toContain("/Users/phodal/ai/routa-js/src/client/components/fitness-analysis-charts.tsx");
    expect(summary?.outputTail).toContain("215:0  error  Parsing error: '}' expected");
    expect(summary?.outputTail).toContain("✖ 1 problem (1 error, 0 warnings)");
  });

  it("ignores successful stdout logs that contain '0 errors'", () => {
    const results = [
      {
        durationMs: 25,
        exitCode: 1,
        metric: buildMetric({ name: "ts_test_pass", command: "npm run test:run 2>&1" }),
        output: [
          "stdout | src/core/storage/__tests__/local-providers.test.ts > MigrationTool > migrates legacy traces to new location",
          "[Migration] Completed: 1 files migrated, 0 errors",
          "FAIL  src/core/acp/__tests__/actual-broken.test.ts > actual broken case",
          "AssertionError: expected true to be false",
        ].join("\n"),
        passed: false,
      },
    ];

    const [summary] = summarizeFailures(results);

    expect(summary?.focusLine).toBe("src/core/acp/__tests__/actual-broken.test.ts > actual broken case");
    expect(summary?.outputTail).toContain("FAIL  src/core/acp/__tests__/actual-broken.test.ts > actual broken case");
    expect(summary?.outputTail).toContain("AssertionError: expected true to be false");
    expect(summary?.outputTail).not.toContain("MigrationTool > migrates legacy traces to new location");
    expect(summary?.outputTail).not.toContain("[Migration] Completed: 1 files migrated, 0 errors");
  });
});
