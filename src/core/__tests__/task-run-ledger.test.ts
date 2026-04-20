import { describe, expect, it } from "vitest";

import { buildTaskRunLedger } from "@/core/task-run-ledger";
import { createTask, type Task, type TaskLaneSession } from "@/core/models/task";

describe("buildTaskRunLedger", () => {
  it("marks a stale running lane as failed when the linked ACP session is error", () => {
    const task = createTask({
      id: "task-1",
      title: "Stale lane recovery",
      objective: "Verify stale error mapping",
      workspaceId: "workspace-1",
    });

    const taskWithLane: Task = {
      ...task,
      laneSessions: [{
        sessionId: "session-stale",
        status: "running",
        columnId: "review",
        startedAt: "2026-01-01T00:00:00.000Z",
      } as TaskLaneSession],
    };

    const ledger = buildTaskRunLedger(taskWithLane, new Map([[
      "session-stale",
      {
        sessionId: "session-stale",
        executionMode: "embedded",
        ownerInstanceId: "runner-1",
        provider: "claude",
        createdAt: "2026-01-01T00:00:00.000Z",
        acpStatus: "error",
      },
    ]]));

    expect(ledger).toEqual([
      expect.objectContaining({
        id: "session-stale",
        kind: "embedded_acp",
        status: "failed",
        ownerInstanceId: "runner-1",
        provider: "claude",
      }),
    ]);
  });

  it("keeps completed lane status when explicit, even if ACP session is terminal", () => {
    const task = createTask({
      id: "task-2",
      title: "Completed lane",
      objective: "Verify precedence",
      workspaceId: "workspace-1",
    });

    const taskWithLane: Task = {
      ...task,
      laneSessions: [{
        sessionId: "session-complete",
        status: "completed",
        columnId: "backlog",
        startedAt: "2026-01-01T00:00:00.000Z",
      } as TaskLaneSession],
    };

    const ledger = buildTaskRunLedger(taskWithLane, new Map([[
      "session-complete",
      {
        sessionId: "session-complete",
        executionMode: "embedded",
        ownerInstanceId: "runner-2",
        provider: "claude",
        createdAt: "2026-01-01T00:00:00.000Z",
        acpStatus: "error",
      },
    ]]));

    expect(ledger).toEqual([
      expect.objectContaining({
        id: "session-complete",
        status: "completed",
        ownerInstanceId: "runner-2",
      }),
    ]);
  });

  it("treats undefined lane status as running while ACP session is connecting", () => {
    const task = createTask({
      id: "task-3",
      title: "Connecting lane",
      objective: "Verify status inference",
      workspaceId: "workspace-1",
    });

    const taskWithLane: Task = {
      ...task,
      laneSessions: [{
        sessionId: "session-connecting",
        columnId: "backlog",
        status: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
      } as TaskLaneSession],
    };

    const ledger = buildTaskRunLedger(taskWithLane, new Map([[
      "session-connecting",
      {
        sessionId: "session-connecting",
        executionMode: "embedded",
        ownerInstanceId: "runner-3",
        provider: "claude",
        createdAt: "2026-01-01T00:00:00.000Z",
        acpStatus: "connecting",
      },
    ]]));

    expect(ledger).toEqual([
      expect.objectContaining({
        id: "session-connecting",
        status: "running",
        ownerInstanceId: "runner-3",
      }),
    ]);
  });
});
