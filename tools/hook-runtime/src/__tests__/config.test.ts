import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getRuntimeProfiles,
  resetRuntimeProfilesCache,
  resolveRuntimeProfileConfig,
} from "../config.js";

describe("hook runtime profile config", () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
    resetRuntimeProfilesCache();
  });

  it("loads default profiles from the checked-in hooks yaml", () => {
    const profile = resolveRuntimeProfileConfig("pre-push");

    expect(profile.phases).toEqual(["submodule", "fitness", "review"]);
    expect(profile.fallbackMetrics).toEqual([
      "eslint_pass",
      "ts_typecheck_pass",
      "ts_test_pass",
      "clippy_pass",
      "rust_test_pass",
    ]);
  });

  it("falls back per profile when yaml omits fields", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hook-runtime-config-"));
    try {
      mkdirSync(path.join(tempDir, "docs", "fitness", "runtime"), { recursive: true });
      writeFileSync(
        path.join(tempDir, "docs", "fitness", "runtime", "hooks.yaml"),
        [
          "schema: hook-runtime-v1",
          "profiles:",
          "  pre-commit:",
          "    phases:",
          "      - fitness",
        ].join("\n"),
        "utf-8",
      );

      process.chdir(tempDir);
      resetRuntimeProfilesCache();

      const profiles = getRuntimeProfiles();

      expect(profiles["pre-commit"].phases).toEqual(["fitness"]);
      expect(profiles["pre-commit"].fallbackMetrics).toEqual(["eslint_pass"]);
      expect(profiles["pre-push"].phases).toEqual(["submodule", "fitness", "review"]);
    } finally {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Windows may keep temp dirs locked; cleanup will happen on reboot
      }
    }
  });
});
