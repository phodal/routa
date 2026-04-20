import { describe, expect, it } from "vitest";

import {
  isVitestRelevantChange,
  normalizeSuccessSummary,
  pickBaseRef,
} from "../fitness/run-vitest-fast";

describe("run-vitest-fast helpers", () => {
  it("prefers upstream refs when available", () => {
    expect(pickBaseRef("origin/feature-base", ["origin/main", "main"])).toBe("origin/feature-base");
  });

  it("falls back to common main refs when upstream is missing", () => {
    expect(pickBaseRef(null, ["main", "origin/master"])).toBe("main");
    expect(pickBaseRef(null, ["origin/master"])).toBe("origin/master");
    expect(pickBaseRef(null, [])).toBeNull();
  });

  it("marks source and vitest config files as relevant", () => {
    expect(isVitestRelevantChange("src/core/foo.ts")).toBe(true);
    expect(isVitestRelevantChange("scripts/fitness/check-api-parity.ts")).toBe(true);
    expect(isVitestRelevantChange("tests/api-contract/run.ts")).toBe(true);
    expect(isVitestRelevantChange("vitest.config.ts")).toBe(true);
    expect(isVitestRelevantChange("package.json")).toBe(true);
  });

  it("skips unrelated changes", () => {
    expect(isVitestRelevantChange("docs/fitness/README.md")).toBe(false);
    expect(isVitestRelevantChange("crates/harness-monitor/src/tui.rs")).toBe(false);
  });

  it("normalizes vitest success summaries", () => {
    expect(normalizeSuccessSummary("Tests  1228 passed | 42 skipped (1270)")).toBe("Tests 1228 passed");
    expect(normalizeSuccessSummary("No test files found, exiting with code 0")).toBe("Tests 0 passed");
    expect(normalizeSuccessSummary("random output")).toBeNull();
  });
});
