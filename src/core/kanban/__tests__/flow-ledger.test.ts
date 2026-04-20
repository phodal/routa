import { describe, expect, it } from "vitest";
import { analyzeFlowForTasks, formatFlowGuidanceForPrompt } from "../flow-ledger";
import { createTask } from "../../models/task";
import type { Task, TaskLaneSession, TaskLaneHandoff } from "../../models/task";

function makeSession(overrides: Partial<TaskLaneSession> & { sessionId: string; startedAt: string }): TaskLaneSession {
  return {
    status: "completed",
    ...overrides,
  };
}

function makeHandoff(overrides: Partial<TaskLaneHandoff> & { id: string; fromSessionId: string; toSessionId: string; requestedAt: string }): TaskLaneHandoff {
  return {
    requestType: "runtime_context",
    request: "test request",
    status: "completed",
    ...overrides,
  };
}

function makeTask(id: string, overrides?: Partial<Task>): Task {
  return createTask({
    id,
    title: `Task ${id}`,
    objective: `Objective for ${id}`,
    workspaceId: "ws-1",
    boardId: "board-1",
    ...overrides,
  });
}

describe("analyzeFlowForTasks", () => {
  it("returns empty report for tasks with no sessions", () => {
    const tasks = [makeTask("t1"), makeTask("t2")];
    const report = analyzeFlowForTasks(tasks, { workspaceId: "ws-1" });

    expect(report.workspaceId).toBe("ws-1");
    expect(report.taskCount).toBe(2);
    expect(report.sessionCount).toBe(0);
    expect(report.bouncePatterns).toEqual([]);
    expect(report.laneMetrics).toEqual([]);
    expect(report.failureHotspots).toEqual([]);
    expect(report.handoffFriction).toEqual([]);
    expect(report.guidance).toEqual([]);
  });

  it("detects bounce patterns (review → dev → review)", () => {
    const tasks = [
      makeTask("t1"),
      makeTask("t2"),
    ];
    // t1: dev → review → dev (bounce from review back to dev)
    tasks[0].laneSessions = [
      makeSession({ sessionId: "s1", columnId: "dev", startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T01:00:00Z" }),
      makeSession({ sessionId: "s2", columnId: "review", startedAt: "2026-01-01T02:00:00Z", completedAt: "2026-01-01T03:00:00Z" }),
      makeSession({ sessionId: "s3", columnId: "dev", startedAt: "2026-01-01T04:00:00Z", completedAt: "2026-01-01T05:00:00Z" }),
    ];
    // t2: same pattern
    tasks[1].laneSessions = [
      makeSession({ sessionId: "s4", columnId: "dev", startedAt: "2026-01-02T00:00:00Z", completedAt: "2026-01-02T01:00:00Z" }),
      makeSession({ sessionId: "s5", columnId: "review", startedAt: "2026-01-02T02:00:00Z", completedAt: "2026-01-02T03:00:00Z" }),
      makeSession({ sessionId: "s6", columnId: "dev", startedAt: "2026-01-02T04:00:00Z", completedAt: "2026-01-02T05:00:00Z" }),
    ];

    const report = analyzeFlowForTasks(tasks, { workspaceId: "ws-1" });

    expect(report.bouncePatterns.length).toBeGreaterThan(0);
    const bounce = report.bouncePatterns[0];
    expect(bounce.fromColumnId).toBe("review");
    expect(bounce.toColumnId).toBe("dev");
    expect(bounce.occurrences).toBe(2);
    expect(bounce.taskIds).toContain("t1");
    expect(bounce.taskIds).toContain("t2");
  });

  it("computes lane metrics with durations", () => {
    const task = makeTask("t1");
    task.laneSessions = [
      makeSession({
        sessionId: "s1",
        columnId: "dev",
        columnName: "Dev",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T01:00:00Z",
        status: "completed",
      }),
      makeSession({
        sessionId: "s2",
        columnId: "dev",
        columnName: "Dev",
        startedAt: "2026-01-01T02:00:00Z",
        completedAt: "2026-01-01T04:00:00Z",
        status: "completed",
      }),
      makeSession({
        sessionId: "s3",
        columnId: "review",
        columnName: "Review",
        startedAt: "2026-01-01T05:00:00Z",
        completedAt: "2026-01-01T05:30:00Z",
        status: "completed",
      }),
    ];

    const report = analyzeFlowForTasks([task], { workspaceId: "ws-1" });

    expect(report.laneMetrics.length).toBe(2);
    const devMetrics = report.laneMetrics.find((m) => m.columnId === "dev");
    expect(devMetrics).toBeDefined();
    expect(devMetrics!.totalSessions).toBe(2);
    expect(devMetrics!.completedSessions).toBe(2);
    expect(devMetrics!.failedSessions).toBe(0);
    expect(devMetrics!.columnName).toBe("Dev");
    // 1h + 2h = 3h avg = 1.5h = 5400000ms
    expect(devMetrics!.avgDurationMs).toBe(5400000);
  });

  it("detects failure hotspots", () => {
    const task = makeTask("t1");
    task.laneSessions = [
      makeSession({ sessionId: "s1", columnId: "dev", startedAt: "2026-01-01T00:00:00Z", status: "failed", recoveryReason: "agent_failed" }),
      makeSession({ sessionId: "s2", columnId: "dev", startedAt: "2026-01-01T01:00:00Z", status: "timed_out", recoveryReason: "watchdog_inactivity" }),
      makeSession({ sessionId: "s3", columnId: "dev", startedAt: "2026-01-01T02:00:00Z", status: "failed", recoveryReason: "agent_failed" }),
      makeSession({ sessionId: "s4", columnId: "review", startedAt: "2026-01-01T03:00:00Z", status: "completed" }),
    ];

    const report = analyzeFlowForTasks([task], { workspaceId: "ws-1" });

    expect(report.failureHotspots.length).toBeGreaterThan(0);
    const devHotspot = report.failureHotspots.find((h) => h.columnId === "dev");
    expect(devHotspot).toBeDefined();
    expect(devHotspot!.failureCount).toBe(2);
    expect(devHotspot!.timeoutCount).toBe(1);
    expect(devHotspot!.topRecoveryReasons[0].reason).toBe("agent_failed");
    expect(devHotspot!.topRecoveryReasons[0].count).toBe(2);
  });

  it("computes handoff friction", () => {
    const task = makeTask("t1");
    task.laneSessions = [
      makeSession({ sessionId: "s1", columnId: "dev", startedAt: "2026-01-01T00:00:00Z" }),
    ];
    task.laneHandoffs = [
      makeHandoff({
        id: "h1",
        fromSessionId: "s1",
        toSessionId: "s2",
        fromColumnId: "review",
        toColumnId: "dev",
        status: "completed",
        requestedAt: "2026-01-01T00:00:00Z",
        respondedAt: "2026-01-01T00:30:00Z",
      }),
      makeHandoff({
        id: "h2",
        fromSessionId: "s3",
        toSessionId: "s4",
        fromColumnId: "review",
        toColumnId: "dev",
        status: "blocked",
        requestedAt: "2026-01-01T01:00:00Z",
      }),
      makeHandoff({
        id: "h3",
        fromSessionId: "s5",
        toSessionId: "s6",
        fromColumnId: "review",
        toColumnId: "dev",
        status: "failed",
        requestedAt: "2026-01-01T02:00:00Z",
      }),
    ];

    const report = analyzeFlowForTasks([task], { workspaceId: "ws-1" });

    expect(report.handoffFriction.length).toBe(1);
    const friction = report.handoffFriction[0];
    expect(friction.fromColumnId).toBe("review");
    expect(friction.toColumnId).toBe("dev");
    expect(friction.totalHandoffs).toBe(3);
    expect(friction.blockedHandoffs).toBe(1);
    expect(friction.failedHandoffs).toBe(1);
    expect(friction.frictionRate).toBeCloseTo(2 / 3, 2);
  });

  it("filters sessions by time window", () => {
    const task = makeTask("t1");
    task.laneSessions = [
      makeSession({ sessionId: "s1", columnId: "dev", startedAt: "2026-01-01T00:00:00Z", status: "failed" }),
      makeSession({ sessionId: "s2", columnId: "dev", startedAt: "2026-02-01T00:00:00Z", status: "completed" }),
    ];

    const report = analyzeFlowForTasks([task], {
      workspaceId: "ws-1",
      windowStart: "2026-01-15T00:00:00Z",
    });

    // Only the February session should be included
    expect(report.sessionCount).toBe(1);
    expect(report.failureHotspots.length).toBe(0);
  });

  it("generates guidance for high-frequency bounces", () => {
    const tasks: Task[] = [];
    for (let i = 0; i < 5; i++) {
      const t = makeTask(`t${i}`);
      t.laneSessions = [
        makeSession({ sessionId: `s${i}a`, columnId: "dev", startedAt: `2026-01-0${i + 1}T00:00:00Z` }),
        makeSession({ sessionId: `s${i}b`, columnId: "review", startedAt: `2026-01-0${i + 1}T01:00:00Z` }),
        makeSession({ sessionId: `s${i}c`, columnId: "dev", startedAt: `2026-01-0${i + 1}T02:00:00Z` }),
      ];
      tasks.push(t);
    }

    const report = analyzeFlowForTasks(tasks, { workspaceId: "ws-1" });

    const bounceGuidance = report.guidance.filter((g) => g.category === "bounce_pattern");
    expect(bounceGuidance.length).toBeGreaterThan(0);
    expect(bounceGuidance[0].severity).toBe("critical");
    expect(bounceGuidance[0].affectedColumns).toContain("review");
    expect(bounceGuidance[0].affectedColumns).toContain("dev");
  });

  it("generates guidance for high failure rates", () => {
    const task = makeTask("t1");
    task.laneSessions = [
      makeSession({ sessionId: "s1", columnId: "dev", startedAt: "2026-01-01T00:00:00Z", status: "failed" }),
      makeSession({ sessionId: "s2", columnId: "dev", startedAt: "2026-01-01T01:00:00Z", status: "failed" }),
      makeSession({ sessionId: "s3", columnId: "dev", startedAt: "2026-01-01T02:00:00Z", status: "failed" }),
      makeSession({ sessionId: "s4", columnId: "dev", startedAt: "2026-01-01T03:00:00Z", status: "completed" }),
    ];

    const report = analyzeFlowForTasks([task], { workspaceId: "ws-1" });

    const failureGuidance = report.guidance.filter((g) => g.category === "failure_hotspot");
    expect(failureGuidance.length).toBeGreaterThan(0);
    expect(failureGuidance[0].severity).toBe("critical");
  });

  it("sets boardId when provided", () => {
    const report = analyzeFlowForTasks([], { workspaceId: "ws-1", boardId: "board-1" });
    expect(report.boardId).toBe("board-1");
  });
});

describe("formatFlowGuidanceForPrompt", () => {
  it("returns empty string when no actionable guidance", () => {
    const report = analyzeFlowForTasks([], { workspaceId: "ws-1" });
    expect(formatFlowGuidanceForPrompt(report)).toBe("");
  });

  it("formats guidance items for prompt injection", () => {
    const tasks: Task[] = [];
    // Create enough bouncing tasks to generate critical guidance
    for (let i = 0; i < 5; i++) {
      const t = makeTask(`t${i}`);
      t.laneSessions = [
        makeSession({ sessionId: `s${i}a`, columnId: "dev", startedAt: `2026-01-0${i + 1}T00:00:00Z` }),
        makeSession({ sessionId: `s${i}b`, columnId: "review", startedAt: `2026-01-0${i + 1}T01:00:00Z` }),
        makeSession({ sessionId: `s${i}c`, columnId: "dev", startedAt: `2026-01-0${i + 1}T02:00:00Z` }),
      ];
      tasks.push(t);
    }

    const report = analyzeFlowForTasks(tasks, { workspaceId: "ws-1" });
    const formatted = formatFlowGuidanceForPrompt(report);

    expect(formatted).toContain("## Flow Guidance");
    expect(formatted).toContain("[CRITICAL]");
    expect(formatted).toContain("bounce");
  });

  it("limits to 5 guidance items in prompt", () => {
    const task = makeTask("t1");
    // Create many different failure patterns
    task.laneSessions = [];
    const columns = ["backlog", "todo", "dev", "review", "done", "blocked"];
    for (let i = 0; i < columns.length; i++) {
      for (let j = 0; j < 5; j++) {
        task.laneSessions.push(
          makeSession({
            sessionId: `s${i}-${j}`,
            columnId: columns[i],
            startedAt: `2026-01-0${j + 1}T0${i}:00:00Z`,
            status: j < 3 ? "failed" : "completed",
            recoveryReason: j < 3 ? "agent_failed" : undefined,
          }),
        );
      }
    }

    const report = analyzeFlowForTasks([task], { workspaceId: "ws-1" });
    const formatted = formatFlowGuidanceForPrompt(report);
    const criticalOrWarning = formatted.match(/\[(CRITICAL|WARNING)\]/g);
    // Should be capped at 5
    expect((criticalOrWarning?.length ?? 0)).toBeLessThanOrEqual(5);
  });
});
