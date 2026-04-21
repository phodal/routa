/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AgentRole } from "../../models/agent";
import {
  createTask,
  TaskPriority,
  TaskStatus,
  VerificationVerdict,
} from "../../models/task";
import type { TraceRecord } from "../types";
import { buildTraceRunDigest } from "../trace-run-digest";
import {
  buildRunOutcome,
  buildTaskFingerprint,
  readRunOutcomes,
  saveRunOutcome,
} from "../run-outcome";
import { loadLearnedPlaybook, syncLearnedPlaybookArtifact } from "../trace-playbook";

function makeRecord(
  sessionId: string,
  eventType: TraceRecord["eventType"],
  overrides: Partial<TraceRecord> = {},
): TraceRecord {
  return {
    version: "0.1.0",
    id: `${sessionId}-${Math.random().toString(16).slice(2, 10)}`,
    timestamp: new Date().toISOString(),
    sessionId,
    contributor: { provider: "test" },
    eventType,
    ...overrides,
  };
}

function makeTraces(sessionId: string, testPassed: boolean): TraceRecord[] {
  return [
    makeRecord(sessionId, "tool_call", {
      timestamp: "2026-04-20T10:00:00Z",
      files: [{ path: "src/index.ts", operation: "write" }],
      tool: { name: "write_file", toolCallId: "tc-write", status: "running" },
    }),
    makeRecord(sessionId, "tool_result", {
      timestamp: "2026-04-20T10:00:30Z",
      tool: { name: "write_file", toolCallId: "tc-write", status: "completed" },
    }),
    makeRecord(sessionId, "tool_call", {
      timestamp: "2026-04-20T10:01:00Z",
      tool: {
        name: "run_command",
        toolCallId: "tc-test",
        status: "running",
        input: { command: "npm test" },
      },
    }),
    makeRecord(sessionId, "tool_result", {
      timestamp: "2026-04-20T10:02:00Z",
      tool: {
        name: "run_command",
        toolCallId: "tc-test",
        status: testPassed ? "completed" : "failed",
        output: testPassed ? "All tests green" : "Tests failing",
      },
    }),
  ];
}

function makeTask(status: TaskStatus, verdict?: VerificationVerdict) {
  const task = createTask({
    id: "task-1",
    title: "Add tests",
    objective: "Strengthen verification coverage",
    workspaceId: "ws-agg",
    boardId: "board-1",
    columnId: "dev",
    position: 0,
    priority: TaskPriority.HIGH,
    labels: ["bug", "frontend"],
    scope: "src/core",
    acceptanceCriteria: ["tests added", "verification green"],
    verificationCommands: ["npm test"],
    status,
  });
  task.verificationVerdict = verdict;
  task.laneSessions = [
    {
      sessionId: "lane-1",
      columnId: "dev",
      status: "completed",
      startedAt: "2026-04-20T09:00:00Z",
      completedAt: "2026-04-20T09:15:00Z",
    },
    {
      sessionId: "lane-2",
      columnId: "review",
      status: "failed",
      startedAt: "2026-04-20T09:15:00Z",
      completedAt: "2026-04-20T09:30:00Z",
      recoveryReason: "completion_criteria_not_met",
    },
    {
      sessionId: "lane-3",
      columnId: "dev",
      status: "running",
      startedAt: "2026-04-20T09:30:00Z",
      recoveryReason: "watchdog_inactivity",
    },
  ];
  return task;
}

describe("trace playbook runtime ledger", () => {
  let tmpDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-playbook-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpDir;
    execFileSync("git", ["init", "-b", "main"], { cwd: tmpDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "trace-playbook@example.com"], { cwd: tmpDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Trace Playbook Test"], { cwd: tmpDir, stdio: "ignore" });
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: tmpDir, stdio: "ignore" });
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("buildTaskFingerprint incorporates lane context and labels", () => {
    const baseTask = makeTask(TaskStatus.COMPLETED, VerificationVerdict.APPROVED);
    const sameFingerprint = buildTaskFingerprint(baseTask);

    const movedTask = { ...baseTask, columnId: "review" };
    const relabeledTask = { ...baseTask, labels: ["backend"] };

    expect(buildTaskFingerprint(baseTask)).toBe(sameFingerprint);
    expect(buildTaskFingerprint(movedTask)).not.toBe(sameFingerprint);
    expect(buildTaskFingerprint(relabeledTask)).not.toBe(sameFingerprint);
  });

  it("captures richer run outcome metadata from task and traces", async () => {
    const task = makeTask(TaskStatus.NEEDS_FIX, VerificationVerdict.NOT_APPROVED);
    const traces = makeTraces("sess-failure", false);
    const digest = buildTraceRunDigest("sess-failure", traces);

    const outcome = buildRunOutcome({
      cwd: tmpDir,
      task,
      taskId: task.id,
      sessionId: "sess-failure",
      workspaceId: task.workspaceId,
      role: AgentRole.CRAFTER,
      provider: "copilot",
      traces,
      digest,
    });

    await saveRunOutcome(tmpDir, outcome);
    const stored = await readRunOutcomes(tmpDir);

    expect(stored).toHaveLength(1);
    expect(outcome.taskType).toBe("kanban_card");
    expect(outcome.cardFingerprint).toEqual({
      boardId: "board-1",
      columnId: "dev",
      taskId: "task-1",
      labels: ["bug", "frontend"],
      priority: TaskPriority.HIGH,
      creationSource: undefined,
    });
    expect(outcome.changedFiles).toEqual(["src/index.ts"]);
    expect(outcome.toolSequence).toEqual(["write_file", "run_command"]);
    expect(outcome.evidenceBundle.testsRan).toBe(true);
    expect(outcome.evidenceBundle.testsPassed).toBe(false);
    expect(outcome.evidenceBundle.reviewApproved).toBe(false);
    expect(outcome.failureMode).toBe("review_not_approved");
    expect(outcome.loopDetected).toBe(true);
    expect(outcome.bouncePattern).toEqual(["dev", "review", "dev"]);
    expect(outcome.recoveryActions).toEqual([
      "completion_criteria_not_met",
      "watchdog_inactivity",
    ]);
  });

  it("loads learned playbooks only after multiple related outcomes exist", async () => {
    const successTask = makeTask(TaskStatus.COMPLETED, VerificationVerdict.APPROVED);
    const successTraces = makeTraces("sess-success", true);
    const successOutcome = buildRunOutcome({
      cwd: tmpDir,
      task: successTask,
      taskId: successTask.id,
      sessionId: "sess-success",
      workspaceId: successTask.workspaceId,
      role: AgentRole.CRAFTER,
      provider: "copilot",
      traces: successTraces,
      digest: buildTraceRunDigest("sess-success", successTraces),
    });

    await saveRunOutcome(tmpDir, successOutcome);

    expect(
      await loadLearnedPlaybook(tmpDir, successOutcome.fingerprint, successTask.title, successTask.workspaceId),
    ).toBeNull();

    const failureTask = makeTask(TaskStatus.NEEDS_FIX, VerificationVerdict.NOT_APPROVED);
    const failureTraces = makeTraces("sess-failure", false);
    const failureOutcome = buildRunOutcome({
      cwd: tmpDir,
      task: failureTask,
      taskId: failureTask.id,
      sessionId: "sess-failure",
      workspaceId: failureTask.workspaceId,
      role: AgentRole.CRAFTER,
      provider: "copilot",
      traces: failureTraces,
      digest: buildTraceRunDigest("sess-failure", failureTraces),
    });
    await saveRunOutcome(tmpDir, failureOutcome);

    const playbook = await loadLearnedPlaybook(
      tmpDir,
      successOutcome.fingerprint,
      successTask.title,
      successTask.workspaceId,
    );

    expect(playbook).not.toBeNull();
    expect(playbook?.sampleSize).toBe(2);
    expect(playbook?.preferredTools).toContain("write_file");
    expect(playbook?.keyFiles).toContain("src/index.ts");
    expect(playbook?.verificationCommands.some((command) => command.includes("npm test"))).toBe(true);
    expect(playbook?.antiPatterns.some((entry) => entry.includes("review not approved"))).toBe(true);
    expect(playbook?.antiPatterns.some((entry) => entry.includes("Loop detected"))).toBe(true);
  });

  it("materializes learned playbook artifacts into docs/fitness/playbooks", async () => {
    const successTask = makeTask(TaskStatus.COMPLETED, VerificationVerdict.APPROVED);
    const successTraces = makeTraces("sess-success", true);
    const successOutcome = buildRunOutcome({
      cwd: tmpDir,
      task: successTask,
      taskId: successTask.id,
      sessionId: "sess-success",
      workspaceId: successTask.workspaceId,
      role: AgentRole.CRAFTER,
      provider: "copilot",
      traces: successTraces,
      digest: buildTraceRunDigest("sess-success", successTraces),
    });
    await saveRunOutcome(tmpDir, successOutcome);

    const failureTask = makeTask(TaskStatus.NEEDS_FIX, VerificationVerdict.NOT_APPROVED);
    const failureTraces = makeTraces("sess-failure", false);
    const failureOutcome = buildRunOutcome({
      cwd: tmpDir,
      task: failureTask,
      taskId: failureTask.id,
      sessionId: "sess-failure",
      workspaceId: failureTask.workspaceId,
      role: AgentRole.CRAFTER,
      provider: "copilot",
      traces: failureTraces,
      digest: buildTraceRunDigest("sess-failure", failureTraces),
    });
    await saveRunOutcome(tmpDir, failureOutcome);

    const playbook = await syncLearnedPlaybookArtifact(
      tmpDir,
      successOutcome.fingerprint,
      successTask.title,
      successTask.workspaceId,
    );

    expect(playbook?.sampleSize).toBe(2);

    const artifactPath = path.join(
      tmpDir,
      "docs",
      "fitness",
      "playbooks",
      `trace-learning-kanban_card-${successOutcome.fingerprint}.json`,
    );
    const artifact = JSON.parse(await fs.readFile(artifactPath, "utf8"));

    expect(artifact).toMatchObject({
      id: `trace-learning-kanban_card-${successOutcome.fingerprint}`,
      taskType: "kanban_card",
      confidence: 0.5,
      strategy: {
        preferredToolOrder: expect.arrayContaining(["write_file", "run_command"]),
        keyFiles: expect.arrayContaining(["src/index.ts"]),
      },
      provenance: {
        evidenceCount: 2,
        successRate: 0.5,
      },
    });
  });
});