import { describe, expect, it } from "vitest";
import type { TaskInfo, TaskRunInfo } from "../../types";
import { getStableOrderedSessionIds } from "../kanban-card-session-utils";

function buildTask(overrides?: Partial<TaskInfo>): TaskInfo {
  return {
    id: "task-1",
    title: "Stable run order",
    objective: "Preserve persisted session ordering in the UI.",
    status: "IN_PROGRESS",
    boardId: "board-1",
    columnId: "backlog",
    position: 0,
    priority: "medium",
    labels: [],
    createdAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("getStableOrderedSessionIds", () => {
  it("preserves persisted task order when the live ledger returns newest-first", () => {
    const task = buildTask({
      laneSessions: [
        {
          sessionId: "session-dev",
          columnId: "dev",
          status: "completed",
          startedAt: "2026-04-01T08:00:00.000Z",
        },
        {
          sessionId: "session-todo",
          columnId: "todo",
          status: "completed",
          startedAt: "2026-04-01T09:00:00.000Z",
        },
        {
          sessionId: "session-backlog",
          columnId: "backlog",
          status: "running",
          startedAt: "2026-04-01T10:00:00.000Z",
        },
      ],
    });

    const runs: TaskRunInfo[] = [
      { id: "session-backlog", sessionId: "session-backlog", kind: "embedded_acp", status: "running", startedAt: "2026-04-01T10:00:00.000Z" },
      { id: "session-todo", sessionId: "session-todo", kind: "embedded_acp", status: "completed", startedAt: "2026-04-01T09:00:00.000Z" },
      { id: "session-dev", sessionId: "session-dev", kind: "embedded_acp", status: "completed", startedAt: "2026-04-01T08:00:00.000Z" },
    ];

    expect(getStableOrderedSessionIds(task, runs)).toEqual([
      "session-dev",
      "session-todo",
      "session-backlog",
    ]);
  });

  it("appends runs that are not yet present in the persisted task history", () => {
    const task = buildTask({
      laneSessions: [{
        sessionId: "session-1",
        columnId: "todo",
        status: "running",
        startedAt: "2026-04-01T08:00:00.000Z",
      }],
    });

    const runs: TaskRunInfo[] = [
      { id: "session-2", sessionId: "session-2", kind: "embedded_acp", status: "running", startedAt: "2026-04-01T09:00:00.000Z" },
      { id: "session-1", sessionId: "session-1", kind: "embedded_acp", status: "running", startedAt: "2026-04-01T08:00:00.000Z" },
    ];

    expect(getStableOrderedSessionIds(task, runs)).toEqual(["session-1", "session-2"]);
  });
});
