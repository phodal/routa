import { describe, expect, it } from "vitest";

import {
  isActionableEnumerationCommand,
  isActionableGlob,
  isActionablePathRoot,
  parseArgs,
  parseSearchCommandSegment,
  splitShellCommandSegments,
  tokenizeShellLike,
} from "../harness/analyze-search-tool-usage";

describe("analyze-search-tool-usage", () => {
  it("parses explicit root and limits", () => {
    expect(parseArgs([
      "--root", "/tmp/sessions",
      "--max-items", "12",
      "--max-files", "50",
      "--cwd-contains", "routa-js",
    ])).toEqual({
      rootPath: "/tmp/sessions",
      maxItems: 12,
      maxFiles: 50,
      cwdContains: "routa-js",
    });
  });

  it("splits shell pipelines while respecting quoted segments", () => {
    expect(splitShellCommandSegments("rg --files src | rg feature-explorer && find docs -name '*.md'"))
      .toEqual([
        "rg --files src",
        "rg feature-explorer",
        "find docs -name '*.md'",
      ]);
  });

  it("tokenizes quoted arguments", () => {
    expect(tokenizeShellLike("rg -n \"task adaptive\" 'src/app/[id]/page.tsx'"))
      .toEqual(["rg", "-n", "task adaptive", "src/app/[id]/page.tsx"]);
  });

  it("parses rg text search signals", () => {
    expect(parseSearchCommandSegment("rg -n \"taskAdaptiveHarness\" src/app src/core -S"))
      .toEqual({
        family: "rg_text",
        rawCommand: "rg -n \"taskAdaptiveHarness\" src/app src/core -S",
        pattern: "taskAdaptiveHarness",
        globs: [],
        pathTargets: ["src/app", "src/core"],
      });
  });

  it("parses rg file listing and globs", () => {
    expect(parseSearchCommandSegment("rg --files src/app -g '*.tsx' -g '*.ts'"))
      .toEqual({
        family: "rg_files",
        rawCommand: "rg --files src/app -g '*.tsx' -g '*.ts'",
        globs: ["*.tsx", "*.ts"],
        pathTargets: ["src/app"],
      });
  });

  it("parses find glob signals", () => {
    expect(parseSearchCommandSegment("find src/app -name '*.tsx' -o -name '*.ts'"))
      .toEqual({
        family: "find",
        rawCommand: "find src/app -name '*.tsx' -o -name '*.ts'",
        globs: ["*.tsx", "*.ts"],
        pathTargets: ["src/app"],
      });
  });

  it("parses custom grep and glob tools", () => {
    expect(parseSearchCommandSegment("taskAdaptiveHarness", "grep"))
      .toEqual({
        family: "custom_grep",
        rawCommand: "taskAdaptiveHarness",
        pattern: "taskAdaptiveHarness",
        globs: [],
        pathTargets: [],
      });

    expect(parseSearchCommandSegment("src/**/*.tsx", "glob"))
      .toEqual({
        family: "custom_glob",
        rawCommand: "src/**/*.tsx",
        globs: ["src/**/*.tsx"],
      pathTargets: [],
    });
  });

  it("filters out overly generic globs and keeps actionable ones", () => {
    expect(isActionableGlob("*.ts")).toBe(false);
    expect(isActionableGlob("*.rs")).toBe(false);
    expect(isActionableGlob("route.ts")).toBe(true);
    expect(isActionableGlob("*.test.tsx")).toBe(true);
    expect(isActionableGlob("Cargo.toml")).toBe(true);
  });

  it("filters noisy roots and keeps code-surface roots", () => {
    expect(isActionablePathRoot("src")).toBe(true);
    expect(isActionablePathRoot("crates")).toBe(true);
    expect(isActionablePathRoot("resources")).toBe(true);
    expect(isActionablePathRoot(".")).toBe(false);
    expect(isActionablePathRoot("node_modules")).toBe(false);
  });

  it("keeps root-first enumeration commands and drops generic ones", () => {
    expect(isActionableEnumerationCommand("rg --files src/app")).toBe(true);
    expect(isActionableEnumerationCommand("find resources/specialists -maxdepth 3 -type f")).toBe(true);
    expect(isActionableEnumerationCommand("rg --files .")).toBe(false);
    expect(isActionableEnumerationCommand("grep -v grep")).toBe(false);
  });
});
