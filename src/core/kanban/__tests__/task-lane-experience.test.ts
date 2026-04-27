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

    refreshTaskLaneExperienceMemory(task, {
      synthesizedAt: "2026-04-23T09:00:00.000Z",
    });

    expect(task.jitContextSnapshot?.perLaneAnalysis?.dev).toEqual(expect.objectContaining({
      summary: expect.stringContaining("Dev has 1 lane session"),
    }));
    expect(task.jitContextSnapshot?.summary).toBe("Kanban lane experience memory for Continue dev work.");

    const promptSection = buildLaneExperiencePromptSection(task);
    expect(promptSection).toContain("## Lane Experience Memory");
    expect(promptSection).toContain("Dev has 1 lane session");
    expect(promptSection).toContain("Reuse the latest Dev session context");
  });
});
