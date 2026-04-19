import { describe, expect, it } from "vitest";

import { createTask } from "../../models/task";
import {
  getNonDevAutomationRunCount,
  hasExceededNonDevAutomationRepeatLimit,
} from "../workflow-orchestrator";

describe("workflow orchestrator loop guard", () => {
  it("counts consecutive prior runs for non-dev lanes", () => {
    const task = createTask({
      id: "task-loop-count",
      title: "Loop count",
      objective: "Count repeated non-dev automation runs",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "todo",
    });

    task.laneSessions = [
      {
        sessionId: "todo-1",
        columnId: "todo",
        status: "completed",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "dev-1",
        columnId: "dev",
        status: "completed",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "todo-2",
        columnId: "todo",
        status: "failed",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "todo-3",
        columnId: "todo",
        status: "transitioned",
        startedAt: new Date().toISOString(),
      },
    ];

    expect(getNonDevAutomationRunCount(task, "todo", "todo")).toBe(2);
  });

  it("resets the non-dev repeat count after the card leaves and re-enters the lane", () => {
    const task = createTask({
      id: "task-review-reentry",
      title: "Review reentry",
      objective: "Allow a fresh review run after returning from dev",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "review",
    });

    task.laneSessions = [
      {
        sessionId: "review-1",
        columnId: "review",
        status: "completed",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "review-2",
        columnId: "review",
        status: "failed",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "dev-1",
        columnId: "dev",
        status: "transitioned",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "review-3",
        columnId: "review",
        status: "timed_out",
        startedAt: new Date().toISOString(),
      },
    ];

    expect(getNonDevAutomationRunCount(task, "review", "review")).toBe(1);
    expect(hasExceededNonDevAutomationRepeatLimit(task, "review", "review")).toBe(false);
  });

  it("blocks the fourth run for the same non-dev lane", () => {
    const task = createTask({
      id: "task-loop-block",
      title: "Loop guard",
      objective: "Stop repeated non-dev automation loops",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "review",
    });

    task.laneSessions = [
      {
        sessionId: "review-1",
        columnId: "review",
        status: "completed",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "review-2",
        columnId: "review",
        status: "failed",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "review-3",
        columnId: "review",
        status: "transitioned",
        startedAt: new Date().toISOString(),
      },
    ];

    expect(hasExceededNonDevAutomationRepeatLimit(task, "review", "review")).toBe(true);
  });

  it("does not apply the repeat limit to blocked lane", () => {
    const task = createTask({
      id: "task-blocked-retry",
      title: "Blocked retry",
      objective: "Blocked resolver should always be allowed to run",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "blocked",
    });

    task.laneSessions = [
      {
        sessionId: "blocked-1",
        columnId: "blocked",
        status: "failed",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "blocked-2",
        columnId: "blocked",
        status: "failed",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "blocked-3",
        columnId: "blocked",
        status: "failed",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "blocked-4",
        columnId: "blocked",
        status: "failed",
        startedAt: new Date().toISOString(),
      },
    ];

    expect(getNonDevAutomationRunCount(task, "blocked", "blocked")).toBe(4);
    expect(hasExceededNonDevAutomationRepeatLimit(task, "blocked", "blocked")).toBe(false);
  });

  it("does not apply the repeat limit to dev lane recovery runs", () => {
    const task = createTask({
      id: "task-dev-recovery",
      title: "Dev recovery",
      objective: "Dev retries should stay available",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "dev",
    });

    task.laneSessions = [
      {
        sessionId: "dev-1",
        columnId: "dev",
        status: "failed",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "dev-2",
        columnId: "dev",
        status: "timed_out",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "dev-3",
        columnId: "dev",
        status: "running",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "dev-4",
        columnId: "dev",
        status: "completed",
        startedAt: new Date().toISOString(),
      },
    ];

    expect(getNonDevAutomationRunCount(task, "dev", "dev")).toBe(0);
    expect(hasExceededNonDevAutomationRepeatLimit(task, "dev", "dev")).toBe(false);
  });
});
