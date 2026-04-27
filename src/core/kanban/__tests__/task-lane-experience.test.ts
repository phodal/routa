import { describe, expect, it } from "vitest";
import { createTask } from "../../models/task";
import {
  buildLaneExperiencePromptSection,
  refreshTaskLaneExperienceMemory,
  synthesizeTaskLaneJitContextAnalysis,
} from "../task-lane-experience";
import type { FlowDiagnosisReport } from "../flow-ledger-types";

describe("task lane experience memory", () => {
  it("synthesizes per-lane JIT analysis from lane sessions and flow guidance", () => {
    const task = createTask({
      id: "task-lane-memory",
      title: "Stabilize review lane",
      objective: "Reduce review bouncebacks",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "review",
      contextSearchSpec: {
        query: "review bouncebacks",
        featureCandidates: ["kanban-workflow"],
        relatedFiles: ["src/core/kanban/agent-trigger.ts"],
      },
    });
    task.laneSessions = [
      {
        sessionId: "dev-1",
        columnId: "dev",
        columnName: "Dev",
        status: "completed",
        startedAt: "2026-04-23T08:00:00.000Z",
        completedAt: "2026-04-23T08:20:00.000Z",
        specialistName: "Developer",
      },
      {
        sessionId: "review-1",
        columnId: "review",
        columnName: "Review",
        status: "failed",
        startedAt: "2026-04-23T09:00:00.000Z",
        completedAt: "2026-04-23T09:10:00.000Z",
        recoveryReason: "completion_criteria_not_met",
        specialistName: "Review Guard",
      },
      {
        sessionId: "review-2",
        columnId: "review",
        columnName: "Review",
        status: "running",
        startedAt: "2026-04-23T10:00:00.000Z",
        recoveredFromSessionId: "review-1",
        recoveryReason: "completion_criteria_not_met",
        objective: "Verify the review fix",
      },
    ];
    task.laneHandoffs = [{
      id: "handoff-1",
      fromSessionId: "review-1",
      toSessionId: "dev-1",
      fromColumnId: "review",
      toColumnId: "dev",
      requestType: "runtime_context",
      request: "Rerun the review command",
      status: "blocked",
      requestedAt: "2026-04-23T09:12:00.000Z",
      responseSummary: "Dev server was not running",
    }];
    const flowReport: FlowDiagnosisReport = {
      workspaceId: "ws-1",
      boardId: "board-1",
      analyzedAt: "2026-04-23T10:30:00.000Z",
      taskCount: 3,
      sessionCount: 9,
      bouncePatterns: [],
      laneMetrics: [],
      failureHotspots: [],
      handoffFriction: [],
      guidance: [{
        category: "handoff_friction",
        severity: "warning",
        summary: "Review to dev handoffs are frequently blocked.",
        recommendation: "Prepare runtime verification before review handoff.",
        affectedColumns: ["review", "dev"],
      }],
    };

    const perLaneAnalysis = synthesizeTaskLaneJitContextAnalysis(task, {
      flowReport,
      synthesizedAt: "2026-04-23T11:00:00.000Z",
    });

    expect(Object.keys(perLaneAnalysis ?? {})).toEqual(["dev", "review"]);
    expect(perLaneAnalysis?.review).toEqual(expect.objectContaining({
      columnId: "review",
      columnName: "Review",
      sessionCount: 2,
      latestSessionId: "review-2",
      latestStatus: "running",
      failedSessions: 1,
      recoveredSessions: 1,
      flowGuidance: [expect.objectContaining({
        category: "handoff_friction",
      })],
      contextHints: expect.objectContaining({
        query: "review bouncebacks",
        featureCandidates: ["kanban-workflow"],
      }),
    }));
    expect(perLaneAnalysis?.review.learnedPatterns.join(" ")).toContain("Recovery has been needed");
    expect(perLaneAnalysis?.review.topFailures.join(" ")).toContain("review-1 ended as failed");
    expect(perLaneAnalysis?.review.topFailures.join(" ")).toContain("Dev server was not running");
    expect(perLaneAnalysis?.review.recommendedActions).toContain("Prepare runtime verification before review handoff.");
  });

  it("refreshes the task snapshot and formats prompt-ready lane memory", () => {
    const task = createTask({
      id: "task-lane-prompt",
      title: "Continue dev work",
      objective: "Use prior dev attempts",
      workspaceId: "ws-1",
      columnId: "dev",
    });
    task.laneSessions = [{
      sessionId: "dev-1",
      columnId: "dev",
      columnName: "Dev",
      status: "completed",
      startedAt: "2026-04-23T08:00:00.000Z",
      completedAt: "2026-04-23T08:30:00.000Z",
    }];

    refreshTaskLaneExperienceMemory(task);
    const firstSnapshot = JSON.parse(JSON.stringify(task.jitContextSnapshot));
    const firstPromptSection = buildLaneExperiencePromptSection(task);

    expect(task.jitContextSnapshot?.perLaneAnalysis?.dev).toEqual(expect.objectContaining({
      summary: expect.stringContaining("Dev has 1 lane session"),
    }));
    expect(task.jitContextSnapshot?.summary).toBe("Kanban lane experience memory for Continue dev work.");

    const promptSection = buildLaneExperiencePromptSection(task);
    expect(promptSection).toContain("## Lane Experience Memory");
    expect(promptSection).toContain("Dev has 1 lane session");
    expect(promptSection).toContain("Reuse the latest Dev session context");

    refreshTaskLaneExperienceMemory(task);
    expect(task.jitContextSnapshot).toEqual(firstSnapshot);
    expect(buildLaneExperiencePromptSection(task)).toBe(firstPromptSection);
  });

  it("preserves existing flow guidance when refreshing without a fresh flow report", () => {
    const task = createTask({
      id: "task-lane-guidance",
      title: "Continue guided lane",
      objective: "Reuse flow guidance",
      workspaceId: "ws-1",
      columnId: "review",
      jitContextSnapshot: {
        generatedAt: "2026-04-23T08:00:00.000Z",
        summary: "Existing lane memory",
        matchConfidence: "low",
        matchReasons: [],
        warnings: [],
        matchedFileDetails: [],
        matchedSessionIds: [],
        failures: [],
        repeatedReadFiles: [],
        sessions: [],
        perLaneAnalysis: {
          review: {
            columnId: "review",
            columnName: "Review",
            synthesizedAt: "2026-04-23T08:00:00.000Z",
            sessionCount: 1,
            latestSessionId: "review-1",
            latestStatus: "completed",
            completedSessions: 1,
            failedSessions: 0,
            recoveredSessions: 0,
            summary: "Review has 1 lane session. Board flow guidance has 1 related item(s).",
            learnedPatterns: ["Board-level handoff_friction: Prepare review context first."],
            topFailures: [],
            recommendedActions: ["Prepare runtime evidence before review handoff."],
            flowGuidance: [{
              category: "handoff_friction",
              severity: "warning",
              summary: "Prepare review context first.",
              recommendation: "Prepare runtime evidence before review handoff.",
              affectedColumns: ["review"],
            }],
          },
        },
      },
    });
    task.laneSessions = [{
      sessionId: "review-2",
      columnId: "review",
      columnName: "Review",
      status: "completed",
      startedAt: "2026-04-23T09:00:00.000Z",
      completedAt: "2026-04-23T09:10:00.000Z",
    }];

    refreshTaskLaneExperienceMemory(task);

    const reviewMemory = task.jitContextSnapshot?.perLaneAnalysis?.review;
    expect(reviewMemory?.flowGuidance).toEqual([expect.objectContaining({
      category: "handoff_friction",
    })]);
    expect(reviewMemory?.summary).toContain("Board flow guidance has 1 related item");
    expect(reviewMemory?.recommendedActions).toContain("Prepare runtime evidence before review handoff.");
  });

  it("bounds handoff failure text before storing lane memory", () => {
    const longFailure = `Failure ${"details ".repeat(80)}`;
    const task = createTask({
      id: "task-lane-long-failure",
      title: "Bound failure memory",
      objective: "Avoid prompt bloat",
      workspaceId: "ws-1",
      columnId: "review",
    });
    task.laneSessions = [{
      sessionId: "review-1",
      columnId: "review",
      columnName: "Review",
      status: "failed",
      startedAt: "2026-04-23T09:00:00.000Z",
      completedAt: "2026-04-23T09:10:00.000Z",
    }];
    task.laneHandoffs = [{
      id: "handoff-long",
      fromSessionId: "review-1",
      toSessionId: "dev-1",
      fromColumnId: "review",
      toColumnId: "dev",
      requestType: "runtime_context",
      request: "Inspect failure",
      status: "blocked",
      requestedAt: "2026-04-23T09:12:00.000Z",
      responseSummary: longFailure,
    }];

    const perLaneAnalysis = synthesizeTaskLaneJitContextAnalysis(task, {
      synthesizedAt: "2026-04-23T11:00:00.000Z",
    });
    const handoffFailure = perLaneAnalysis?.review.topFailures.find((failure) =>
      failure.includes("handoff-long")
    );

    expect(handoffFailure).toContain("...");
    expect(handoffFailure?.length).toBeLessThanOrEqual(320);
  });
});
