import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { detectHarnessAutomations } from "../automations";

function mkdirp(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(filePath: string, content = "") {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

describe("detectHarnessAutomations", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-automations-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads repo-defined finding and schedule automations and separates definitions from runtime", async () => {
    writeFile(path.join(tmpDir, "docs/harness/automations.yml"), [
      "schema: harness-automation-v1",
      "definitions:",
      "  - id: long-file-window",
      "    name: Long-file window",
      "    description: Queue oversized files for the refactor window.",
      "    source:",
      "      type: finding",
      "      findingType: long-file",
      "      maxItems: 2",
      "      deferUntilCron: \"0 10 * * 1\"",
      "    target:",
      "      type: workflow",
      "      ref: refactor-window",
      "  - id: weekly-harness-fluency",
      "    name: Weekly harness fluency",
      "    source:",
      "      type: schedule",
      "      cron: \"0 3 * * 1\"",
      "      timezone: UTC",
      "    target:",
      "      type: specialist",
      "      ref: harness-test",
      "    runtime:",
      "      scheduleName: Weekly harness fluency",
    ].join("\n"));

    writeFile(path.join(tmpDir, "docs/fitness/file_budgets.json"), JSON.stringify({
      default_max_lines: 20,
      include_roots: ["src"],
      extensions: [".ts"],
      extension_max_lines: { ".ts": 20 },
      excluded_parts: [],
      overrides: [],
    }));
    writeFile(path.join(tmpDir, "src/oversized.ts"), new Array(35).fill("export const x = 1;").join("\n"));
    writeFile(path.join(tmpDir, "src/normal.ts"), "export const ok = true;\n");

    const report = await detectHarnessAutomations(tmpDir, {
      schedules: [
        {
          id: "schedule-1",
          name: "Weekly harness fluency",
          cronExpr: "0 3 * * 1",
          taskPrompt: "Run harness fluency",
          agentId: "claude-code",
          workspaceId: "default",
          enabled: true,
          lastRunAt: new Date("2026-04-01T00:00:00.000Z"),
          nextRunAt: new Date("2026-04-08T00:00:00.000Z"),
          lastTaskId: "task-1",
          promptTemplate: undefined,
          createdAt: new Date("2026-03-28T00:00:00.000Z"),
          updatedAt: new Date("2026-04-01T00:00:00.000Z"),
        },
      ],
    });

    expect(report.configFile?.relativePath?.replace(/\\/g, "/")).toBe("docs/harness/automations.yml");
    expect(report.definitions).toHaveLength(2);
    expect(report.definitions.find((item) => item.id === "long-file-window")).toMatchObject({
      runtimeStatus: "pending",
      pendingCount: 1,
      targetType: "workflow",
    });
    expect(report.pendingSignals).toHaveLength(1);
    expect(report.pendingSignals[0]).toMatchObject({
      automationId: "long-file-window",
      signalType: "long-file",
      relativePath: "src/oversized.ts",
      deferUntilCron: "0 10 * * 1",
    });
    expect(report.recentRuns).toHaveLength(1);
    expect(report.recentRuns[0]).toMatchObject({
      automationId: "weekly-harness-fluency",
      runtimeBinding: "Weekly harness fluency",
      status: "active",
    });
  });

  it("surfaces issue garbage-collector suspects as pending cleanup signals", async () => {
    writeFile(path.join(tmpDir, "docs/harness/automations.yml"), [
      "schema: harness-automation-v1",
      "definitions:",
      "  - id: issue-gc-review",
      "    name: Issue cleanup review",
      "    description: Review docs/issues suspects before running issue garbage collection.",
      "    source:",
      "      type: finding",
      "      findingType: issue-suspect",
      "      maxItems: 2",
      "      deferUntilCron: \"0 9 * * 1\"",
      "    target:",
      "      type: workflow",
      "      ref: issue-garbage-collector",
    ].join("\n"));
    writeFile(path.join(tmpDir, ".github/scripts/issue-scanner.py"), [
      "import json, sys",
      "if __name__ == '__main__':",
      "    print(json.dumps([",
      "        {'file_a': '2026-04-01-old-bug.md', 'file_b': None, 'reason': 'Open for 35 days (>30), likely stale', 'type': 'stale'},",
      "        {'file_a': '2026-04-02-dup-a.md', 'file_b': '2026-04-02-dup-b.md', 'reason': \"Same area 'ui', keywords: {'layout', 'panel'}\", 'type': 'duplicate'}",
      "    ]))",
    ].join("\n"));

    const report = await detectHarnessAutomations(tmpDir);

    expect(report.definitions).toHaveLength(1);
    expect(report.definitions[0]).toMatchObject({
      id: "issue-gc-review",
      sourceLabel: "issue-suspect · docs/issues scan · defer 0 9 * * 1",
      targetType: "workflow",
      runtimeStatus: "pending",
      pendingCount: 2,
    });
    expect(report.pendingSignals).toHaveLength(2);
    expect(report.pendingSignals[0]).toMatchObject({
      automationId: "issue-gc-review",
      signalType: "stale",
      relativePath: "docs/issues/2026-04-01-old-bug.md",
      deferUntilCron: "0 9 * * 1",
      severity: "high",
    });
    expect(report.pendingSignals[1]).toMatchObject({
      signalType: "duplicate",
      severity: "medium",
    });
  });

  it("returns a warning when no automation config exists", async () => {
    const report = await detectHarnessAutomations(tmpDir);
    expect(report.configFile).toBeNull();
    expect(report.definitions).toEqual([]);
    expect(report.warnings[0].replace(/\\/g, "/")).toContain("docs/harness/automations.yml");
  });
});
