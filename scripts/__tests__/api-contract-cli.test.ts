import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { fromRoot } from "../lib/paths";

function runScript(relativePath: string, args: string[] = []) {
  return spawnSync(process.execPath, ["--import", "tsx", fromRoot(relativePath), ...args], {
    cwd: fromRoot(),
    encoding: "utf8",
  });
}

describe("api contract cli", () => {
  it("does not fail the human parity check for backend-extra warning routes", () => {
    const result = runScript("scripts/fitness/check-api-parity.ts");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("All contract endpoints are implemented by both backends");
    expect(result.stdout).toContain("Extra in Next.js");
  });

  it("emits parity summary JSON", () => {
    const result = runScript("scripts/fitness/check-api-parity.ts", ["--json"]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      summary: { contractEndpoints: number; missingInNextjs: number; missingInRust: number };
    };
    expect(parsed.summary.contractEndpoints).toBeGreaterThan(0);
    expect(parsed.summary.missingInNextjs).toBe(0);
    expect(parsed.summary.missingInRust).toBe(0);
  });

  it("emits schema validation JSON report", () => {
    const result = runScript("scripts/fitness/validate-openapi-schema.ts", ["--json"]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      contractVersion: string;
      totalPaths: number;
      totalOperations: number;
      issues: Array<{ severity: string }>;
    };
    expect(parsed.contractVersion.length).toBeGreaterThan(0);
    expect(parsed.totalPaths).toBeGreaterThan(0);
    expect(parsed.totalOperations).toBeGreaterThan(0);
    expect(parsed.issues.some((issue) => issue.severity === "error")).toBe(false);
  });
});
