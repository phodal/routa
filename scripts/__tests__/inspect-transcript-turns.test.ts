import { describe, expect, it } from "vitest";

import { parseArgs } from "../harness/inspect-transcript-turns";

describe("inspect-transcript-turns", () => {
  it("parses repeated session and file flags", () => {
    expect(parseArgs([
      "--repo-root", "/repo",
      "--session-id", "session-a",
      "--session-id", "session-b",
      "--file", "src/a.ts",
      "--file", "src/b.ts",
      "--feature-id", "feature-explorer",
      "--max-user-prompts", "4",
      "--max-signals", "6",
    ])).toEqual({
      repoRoot: "/repo",
      sessionIds: ["session-a", "session-b"],
      filePaths: ["src/a.ts", "src/b.ts"],
      featureId: "feature-explorer",
      maxUserPrompts: 4,
      maxSignals: 6,
    });
  });

  it("requires at least one session id", () => {
    expect(() => parseArgs(["--file", "src/a.ts"])).toThrow("At least one --session-id is required");
  });

  it("rejects invalid numeric limits", () => {
    expect(() => parseArgs(["--session-id", "session-a", "--max-signals", "0"])).toThrow(
      "--max-signals must be a positive integer",
    );
  });
});
