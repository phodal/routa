import { describe, expect, it } from "vitest";
import {
  DEFAULT_KANBAN_COLUMNS,
  normalizeDefaultKanbanColumnPositions,
} from "@/core/models/kanban";
import { applyRecommendedAutomationToColumns } from "../boards";

describe("applyRecommendedAutomationToColumns", () => {
  it("applies lane-specific specialists to a bare default board", () => {
    const columns = applyRecommendedAutomationToColumns(DEFAULT_KANBAN_COLUMNS);

    expect(columns.map((column) => column.automation?.steps?.[0]?.specialistId)).toEqual([
      "kanban-backlog-refiner",
      "kanban-todo-orchestrator",
      "kanban-dev-executor",
      "kanban-qa-frontend",
      "kanban-pr-publisher",
      "kanban-blocked-resolver",
    ]);
    expect(columns.map((column) => column.automation?.steps?.[0]?.role)).toEqual([
      "CRAFTER",
      "CRAFTER",
      "CRAFTER",
      "GATE",
      "DEVELOPER",
      "CRAFTER",
    ]);
    expect(columns[0].automation?.autoAdvanceOnSuccess).toBe(true);
    expect(columns.slice(1).every((column) => column.automation?.autoAdvanceOnSuccess === false)).toBe(true);
    expect(columns[1]?.automation?.contractRules).toEqual({
      requireCanonicalStory: true,
      loopBreakerThreshold: 2,
    });
    expect(columns[3]?.automation?.requiredArtifacts).toEqual(["screenshot", "test_results"]);
    expect(columns[3]?.automation?.deliveryRules).toEqual({
      requireCommittedChanges: true,
      requireCleanWorktree: true,
    });
    expect(columns[4]?.automation?.deliveryRules).toEqual({
      requireCommittedChanges: true,
      requireCleanWorktree: true,
      requirePullRequestReady: true,
      autoMergeAfterPR: undefined,
      mergeStrategy: undefined,
    });
    expect(columns[4]?.automation?.steps?.map((step) => step.specialistId)).toEqual([
      "kanban-pr-publisher",
      "kanban-auto-merger",
      "kanban-done-reporter",
    ]);
    expect(columns[3]?.automation?.steps?.map((step) => step.specialistId)).toEqual([
      "kanban-qa-frontend",
      "kanban-review-guard",
    ]);
  });

  it("normalizes the default board layout to keep blocked after done", () => {
    const columns = normalizeDefaultKanbanColumnPositions([
      { ...DEFAULT_KANBAN_COLUMNS.find((column) => column.id === "blocked")!, position: 4 },
      { ...DEFAULT_KANBAN_COLUMNS.find((column) => column.id === "done")!, position: 5 },
      ...DEFAULT_KANBAN_COLUMNS.filter((column) => column.id !== "blocked" && column.id !== "done"),
    ]);

    expect(columns.map((column) => column.id)).toEqual([
      "backlog",
      "todo",
      "dev",
      "review",
      "done",
      "blocked",
    ]);
    expect(columns.map((column) => column.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("backfills legacy backlog automation with system auto-advance", () => {
    const columns = applyRecommendedAutomationToColumns([
      {
        ...DEFAULT_KANBAN_COLUMNS[0],
        automation: {
          enabled: true,
          autoAdvanceOnSuccess: false,
        },
      },
      ...DEFAULT_KANBAN_COLUMNS.slice(1),
    ]);

    expect(columns[0].automation?.steps?.[0]?.specialistId).toBe("kanban-backlog-refiner");
    expect(columns[0].automation?.autoAdvanceOnSuccess).toBe(true);
  });

  it("refreshes system-owned backlog specialist settings on an existing default board", () => {
    const columns = applyRecommendedAutomationToColumns([
      {
        ...DEFAULT_KANBAN_COLUMNS[0],
        automation: {
          enabled: true,
          steps: [{
            id: "backlog-refiner",
            role: "CRAFTER",
            specialistId: "kanban-backlog-refiner",
            specialistName: "Backlog Refiner",
          }],
          specialistId: "kanban-backlog-refiner",
          specialistName: "Backlog Refiner",
          autoAdvanceOnSuccess: false,
        },
      },
    ]);

    expect(columns[0].automation?.steps?.[0]?.specialistId).toBe("kanban-backlog-refiner");
    expect(columns[0].automation?.autoAdvanceOnSuccess).toBe(true);
  });

  it("preserves specialist locale on system-owned default lane automation", () => {
    const columns = applyRecommendedAutomationToColumns([
      {
        ...DEFAULT_KANBAN_COLUMNS[0],
        automation: {
          enabled: true,
          steps: [{
            id: "backlog-refiner",
            role: "CRAFTER",
            specialistId: "kanban-backlog-refiner",
            specialistName: "Backlog Refiner",
            specialistLocale: "zh-CN",
          }],
          specialistId: "kanban-backlog-refiner",
          specialistName: "Backlog Refiner",
          specialistLocale: "zh-CN",
          autoAdvanceOnSuccess: false,
        },
      },
    ]);

    expect(columns[0].automation?.specialistLocale).toBe("zh-CN");
    expect(columns[0].automation?.steps?.[0]?.specialistLocale).toBe("zh-CN");
    expect(columns[0].automation?.autoAdvanceOnSuccess).toBe(true);
  });

  it("preserves a customized lane specialist", () => {
    const columns = applyRecommendedAutomationToColumns([
      {
        ...DEFAULT_KANBAN_COLUMNS[2],
        automation: {
          enabled: true,
          steps: [{
            id: "custom-dev-step",
            role: "DEVELOPER",
            specialistId: "custom-dev-sweeper",
            specialistName: "Custom Dev Sweeper",
          }],
          autoAdvanceOnSuccess: true,
        },
      },
    ]);

    expect(columns[0].automation?.steps?.[0]?.specialistId).toBe("custom-dev-sweeper");
    expect(columns[0].automation?.autoAdvanceOnSuccess).toBe(true);
  });

  it("backfills the review screenshot gate when the lane has no explicit artifact policy", () => {
    const columns = applyRecommendedAutomationToColumns([
      DEFAULT_KANBAN_COLUMNS[3],
    ]);

    expect(columns[0].automation?.requiredArtifacts).toEqual(["screenshot", "test_results"]);
  });

  it("preserves a customized review lane that uses review guard directly", () => {
    const columns = applyRecommendedAutomationToColumns([
      {
        ...DEFAULT_KANBAN_COLUMNS[3],
        automation: {
          enabled: true,
          steps: [{
            id: "review-guard",
            role: "GATE",
            specialistId: "kanban-review-guard",
            specialistName: "Review Guard",
          }],
          specialistId: "kanban-review-guard",
          specialistName: "Review Guard",
          requiredArtifacts: ["screenshot"],
          autoAdvanceOnSuccess: false,
        },
      },
    ]);

    expect(columns[0].automation?.steps?.map((step) => step.specialistId)).toEqual([
      "kanban-review-guard",
    ]);
    expect(columns[0].automation?.requiredArtifacts).toEqual(["screenshot"]);
  });

  it("preserves a review lane whose first step was changed from qa to review guard", () => {
    const columns = applyRecommendedAutomationToColumns([
      {
        ...DEFAULT_KANBAN_COLUMNS[3],
        automation: {
          enabled: true,
          steps: [
            {
              id: "qa-frontend",
              role: "GATE",
              specialistId: "kanban-review-guard",
              specialistName: "Review Guard",
            },
            {
              id: "review-guard",
              role: "GATE",
              specialistId: "kanban-review-guard",
              specialistName: "Review Guard",
            },
          ],
          specialistId: "kanban-review-guard",
          specialistName: "Review Guard",
          requiredArtifacts: ["screenshot", "test_results"],
          autoAdvanceOnSuccess: false,
        },
      },
    ]);

    expect(columns[0].automation?.steps?.map((step) => step.specialistId)).toEqual([
      "kanban-review-guard",
      "kanban-review-guard",
    ]);
  });
});
