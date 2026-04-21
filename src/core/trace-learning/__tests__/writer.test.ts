/**
 * Tests for trace learning types and writer.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createRunOutcome,
  withCardFingerprint,
  withRepoContext,
  withChangedFiles,
  withToolSequence,
  withEvidence,
  withFailureMode,
  withBouncePattern,
  withDuration,
  withContributor,
  type RunOutcome,
  type OutcomeStatus,
} from "../types";
import { RunOutcomeWriter } from "../writer";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("RunOutcome types", () => {
  it("should create a basic run outcome", () => {
    const outcome = createRunOutcome("session-123", "kanban_card", "workspace-1", "success");

    expect(outcome.id).toBeDefined();
    expect(outcome.sessionId).toBe("session-123");
    expect(outcome.taskType).toBe("kanban_card");
    expect(outcome.workspaceId).toBe("workspace-1");
    expect(outcome.outcome).toBe("success");
    expect(outcome.changedFiles).toEqual([]);
    expect(outcome.toolSequence).toEqual([]);
    expect(outcome.timestamp).toBeDefined();
  });

  it("should build outcome with card fingerprint", () => {
    const outcome = createRunOutcome("session-123", "kanban_card", "workspace-1", "success");
    const withCard = withCardFingerprint(outcome, {
      boardId: "board-1",
      columnId: "col-dev",
      taskId: "task-456",
      labels: ["bug", "frontend"],
    });

    expect(withCard.cardFingerprint).toEqual({
      boardId: "board-1",
      columnId: "col-dev",
      taskId: "task-456",
      labels: ["bug", "frontend"],
    });
  });

  it("should build outcome with repo context", () => {
    const outcome = createRunOutcome("session-123", "general_session", "workspace-1", "success");
    const withRepo = withRepoContext(outcome, "/path/to/repo", "main", "abc123");

    expect(withRepo.repoRoot).toBe("/path/to/repo");
    expect(withRepo.branch).toBe("main");
    expect(withRepo.revision).toBe("abc123");
  });

  it("should build outcome with changed files and tools", () => {
    const outcome = createRunOutcome("session-123", "general_session", "workspace-1", "success");
    const withFiles = withChangedFiles(outcome, ["src/app.ts", "src/utils.ts"]);
    const withTools = withToolSequence(withFiles, ["read_file", "write_file", "run_tests"]);

    expect(withTools.changedFiles).toEqual(["src/app.ts", "src/utils.ts"]);
    expect(withTools.toolSequence).toEqual(["read_file", "write_file", "run_tests"]);
  });

  it("should build outcome with evidence bundle", () => {
    const outcome = createRunOutcome("session-123", "kanban_card", "workspace-1", "success");
    const withEv = withEvidence(outcome, {
      testsRan: true,
      testsPassed: true,
      lintPassed: true,
      buildSucceeded: true,
    });

    expect(withEv.evidenceBundle.testsRan).toBe(true);
    expect(withEv.evidenceBundle.testsPassed).toBe(true);
    expect(withEv.evidenceBundle.lintPassed).toBe(true);
    expect(withEv.evidenceBundle.buildSucceeded).toBe(true);
  });

  it("should build outcome with failure mode", () => {
    const outcome = createRunOutcome("session-123", "kanban_card", "workspace-1", "failure");
    const withFailure = withFailureMode(outcome, "test_failure");

    expect(withFailure.outcome).toBe("failure");
    expect(withFailure.failureMode).toBe("test_failure");
  });

  it("should build outcome with bounce pattern", () => {
    const outcome = createRunOutcome("session-123", "kanban_card", "workspace-1", "partial");
    const withBounce = withBouncePattern(outcome, ["dev", "review", "dev"], true);

    expect(withBounce.bouncePattern).toEqual(["dev", "review", "dev"]);
    expect(withBounce.loopDetected).toBe(true);
  });

  it("should build outcome with duration and contributor", () => {
    const outcome = createRunOutcome("session-123", "kanban_card", "workspace-1", "success");
    const withDur = withDuration(outcome, 45000);
    const withContrib = withContributor(withDur, "claude", "sonnet-4");

    expect(withContrib.duration).toBe(45000);
    expect(withContrib.contributor).toEqual({
      provider: "claude",
      model: "sonnet-4",
    });
  });
});

describe("RunOutcomeWriter", () => {
  let tmpDir: string;
  let writer: RunOutcomeWriter;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "routa-test-"));
    writer = new RunOutcomeWriter(tmpDir);
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should append an outcome to JSONL file", async () => {
    const outcome = createRunOutcome("session-123", "kanban_card", "workspace-1", "success");
    await writer.append(outcome);

    const outcomes = await writer.readAll();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].sessionId).toBe("session-123");
  });

  it("should append multiple outcomes", async () => {
    const outcome1 = createRunOutcome("session-1", "kanban_card", "workspace-1", "success");
    const outcome2 = createRunOutcome("session-2", "general_session", "workspace-1", "failure");
    const outcome3 = createRunOutcome("session-3", "kanban_card", "workspace-1", "success");

    await writer.append(outcome1);
    await writer.append(outcome2);
    await writer.append(outcome3);

    const outcomes = await writer.readAll();
    expect(outcomes).toHaveLength(3);
    expect(outcomes[0].sessionId).toBe("session-1");
    expect(outcomes[1].sessionId).toBe("session-2");
    expect(outcomes[2].sessionId).toBe("session-3");
  });

  it("should filter outcomes by task type", async () => {
    const outcome1 = createRunOutcome("session-1", "kanban_card", "workspace-1", "success");
    const outcome2 = createRunOutcome("session-2", "general_session", "workspace-1", "failure");
    const outcome3 = createRunOutcome("session-3", "kanban_card", "workspace-1", "success");

    await writer.append(outcome1);
    await writer.append(outcome2);
    await writer.append(outcome3);

    const kanbanOutcomes = await writer.readByTaskType("kanban_card");
    expect(kanbanOutcomes).toHaveLength(2);
    expect(kanbanOutcomes[0].taskType).toBe("kanban_card");
    expect(kanbanOutcomes[1].taskType).toBe("kanban_card");

    const generalOutcomes = await writer.readByTaskType("general_session");
    expect(generalOutcomes).toHaveLength(1);
    expect(generalOutcomes[0].taskType).toBe("general_session");
  });

  it("should filter outcomes by status", async () => {
    const outcome1 = createRunOutcome("session-1", "kanban_card", "workspace-1", "success");
    const outcome2 = createRunOutcome("session-2", "kanban_card", "workspace-1", "failure");
    const outcome3 = createRunOutcome("session-3", "kanban_card", "workspace-1", "success");

    await writer.append(outcome1);
    await writer.append(outcome2);
    await writer.append(outcome3);

    const successes = await writer.readByStatus("success");
    expect(successes).toHaveLength(2);

    const failures = await writer.readByStatus("failure");
    expect(failures).toHaveLength(1);
  });

  it("should return empty array when file does not exist", async () => {
    const outcomes = await writer.readAll();
    expect(outcomes).toEqual([]);
  });

  it("should handle appendSafe without throwing", async () => {
    // Create a writer with an invalid path to trigger an error
    const invalidWriter = new RunOutcomeWriter("/invalid/path/that/cannot/be/created");
    const outcome = createRunOutcome("session-123", "kanban_card", "workspace-1", "success");

    // This should not throw
    await expect(invalidWriter.appendSafe(outcome)).resolves.toBeUndefined();
  });
});
