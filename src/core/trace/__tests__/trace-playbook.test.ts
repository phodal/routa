/**
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { AgentRole } from "../../models/agent";
import type { TraceRunDigest } from "../trace-run-digest";
import {
  buildTaskFingerprint,
  loadLearnedPlaybook,
  saveTraceLedgerEntry,
} from "../trace-playbook";

function makeDigest(overrides: Partial<TraceRunDigest> = {}): TraceRunDigest {
  return {
    sessionId: "sess-1",
    totalEvents: 1,
    filesTouched: [
      { path: "src/index.ts", operations: ["write"], touchCount: 2 },
    ],
    toolCalls: [{ name: "write_file", count: 2, failures: 0 }],
    errorCount: 0,
    errorSummaries: [],
    keyThoughts: [],
    timeRange: null,
    verificationSignals: [],
    churnMarkers: [],
    confidenceFlags: [],
    ...overrides,
  };
}

describe("trace playbook ledger", () => {
  it("builds stable fingerprints per workspace and task content", () => {
    const base = { workspaceId: "ws-1", title: "Refactor API", scope: "api", acceptanceCriteria: [] };
    const fp1 = buildTaskFingerprint(base);
    const fp2 = buildTaskFingerprint(base);
    const fpOtherWorkspace = buildTaskFingerprint({ ...base, workspaceId: "ws-2" });

    expect(fp1).toBe(fp2);
    expect(fp1).not.toBe(fpOtherWorkspace);
  });

  it("loads a learned playbook aggregated from prior ledger entries", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "trace-playbook-"));
    try {
      const fingerprint = buildTaskFingerprint({
        workspaceId: "ws-agg",
        title: "Add tests",
        scope: "",
        acceptanceCriteria: [],
      });

      await saveTraceLedgerEntry(cwd, {
        fingerprint,
        workspaceId: "ws-agg",
        taskId: "task-1",
        taskTitle: "Add tests",
        sessionId: "sess-success",
        role: AgentRole.CRAFTER,
        outcome: "success",
        verificationVerdict: "APPROVED",
        timestamp: new Date().toISOString(),
        digest: makeDigest({
          verificationSignals: [{ command: "npm test", passed: true }],
        }),
      });

      await saveTraceLedgerEntry(cwd, {
        fingerprint,
        workspaceId: "ws-agg",
        taskId: "task-1",
        taskTitle: "Add tests",
        sessionId: "sess-failure",
        role: AgentRole.CRAFTER,
        outcome: "failure",
        verificationVerdict: "NOT_APPROVED",
        timestamp: new Date().toISOString(),
        digest: makeDigest({
          verificationSignals: [
            { command: "npm test", passed: false, outputSummary: "Tests failing" },
          ],
          confidenceFlags: ["No verification commands detected"],
          churnMarkers: [{ target: "src/index.ts", type: "file", count: 4 }],
        }),
      });

      const playbook = await loadLearnedPlaybook(cwd, fingerprint, "Add tests", "ws-agg");
      expect(playbook).not.toBeNull();
      expect(playbook?.sampleSize).toBe(2);
      expect(playbook?.preferredTools).toContain("write_file");
      expect(playbook?.keyFiles).toContain("src/index.ts");
      expect(playbook?.verificationCommands.some((cmd) => cmd.includes("npm test"))).toBe(true);
      expect(playbook?.antiPatterns.some((a) => a.toLowerCase().includes("churn"))).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
