import { describe, expect, it } from "vitest";
import { buildCargoArgs, normalizeLegacyArgs, renderHelp, shouldShowHelp } from "../index.js";

describe("harness-fluency legacy wrapper", () => {
  it("drops the historical leading fluency token before forwarding", () => {
    expect(normalizeLegacyArgs(["fluency", "--json"])).toEqual(["--json"]);
    expect(normalizeLegacyArgs(["run", "--profile", "orchestrator"])).toEqual([
      "--profile",
      "orchestrator",
    ]);
  });

  it("builds the routa-cli cargo invocation", () => {
    expect(buildCargoArgs(["--json", "--compare-last"])).toEqual([
      "run",
      "-p",
      "routa-cli",
      "--",
      "fitness",
      "fluency",
      "--json",
      "--compare-last",
    ]);
  });

  it("documents the canonical routa-cli command", () => {
    expect(renderHelp()).toContain("Canonical command: cargo run -p routa-cli -- fitness fluency");
    expect(renderHelp()).toContain("--json");
  });

  it("treats help as a wrapper-only path", () => {
    expect(shouldShowHelp(["--help"])).toBe(true);
    expect(shouldShowHelp(["fluency", "-h"])).toBe(true);
    expect(shouldShowHelp(["--json"])).toBe(false);
  });
});
