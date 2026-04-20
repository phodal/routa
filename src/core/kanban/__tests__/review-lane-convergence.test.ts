import { describe, expect, it } from "vitest";

import { createTask } from "../../models/task";
import { VerificationVerdict } from "../../models/task";
import { createKanbanBoard } from "../../models/kanban";
import { resolveReviewLaneConvergenceTarget } from "../review-lane-convergence";

describe("review lane convergence", () => {
  it("moves approved review verdicts to done after the final review step", () => {
    const board = createKanbanBoard({
      id: "board-review-1",
      workspaceId: "default",
      name: "Board",
      columns: [
        { id: "backlog", name: "Backlog", stage: "backlog", position: 0 },
        { id: "todo", name: "Todo", stage: "todo", position: 1 },
        { id: "dev", name: "Dev", stage: "dev", position: 2 },
        {
          id: "review",
          name: "Review",
          stage: "review",
          position: 3,
          automation: {
            enabled: true,
            steps: [
              {
                id: "qa-frontend",
                role: "GATE",
                specialistId: "kanban-qa-frontend",
                specialistName: "QA Frontend",
              },
              {
                id: "review-guard",
                role: "GATE",
                specialistId: "kanban-review-guard",
                specialistName: "Review Guard",
              },
            ],
          },
        },
        { id: "done", name: "Done", stage: "done", position: 4 },
        { id: "blocked", name: "Blocked", stage: "blocked", position: 5 },
      ],
    });

    const task = createTask({
      id: "task-review-1",
      title: "Approve final review",
      objective: "Converge review lane after Review Guard writes a verdict",
      workspaceId: "default",
      boardId: board.id,
      columnId: "review",
    });
    task.assignedSpecialistId = "kanban-review-guard";
    task.assignedSpecialistName = "Review Guard";
    task.verificationVerdict = VerificationVerdict.APPROVED;

    expect(resolveReviewLaneConvergenceTarget(task, board.columns)).toBe("done");
  });

  it("does not converge while the review lane still has a pending next step", () => {
    const board = createKanbanBoard({
      id: "board-review-2",
      workspaceId: "default",
      name: "Board",
      columns: [
        { id: "dev", name: "Dev", stage: "dev", position: 0 },
        {
          id: "review",
          name: "Review",
          stage: "review",
          position: 1,
          automation: {
            enabled: true,
            steps: [
              {
                id: "qa-frontend",
                role: "GATE",
                specialistId: "kanban-qa-frontend",
                specialistName: "QA Frontend",
              },
              {
                id: "review-guard",
                role: "GATE",
                specialistId: "kanban-review-guard",
                specialistName: "Review Guard",
              },
            ],
          },
        },
        { id: "done", name: "Done", stage: "done", position: 2 },
      ],
    });

    const task = createTask({
      id: "task-review-2",
      title: "Fail intermediate QA",
      objective: "Keep review lane alive while Review Guard is still pending",
      workspaceId: "default",
      boardId: board.id,
      columnId: "review",
    });
    task.assignedSpecialistId = "kanban-qa-frontend";
    task.assignedSpecialistName = "QA Frontend";
    task.verificationVerdict = VerificationVerdict.NOT_APPROVED;

    expect(resolveReviewLaneConvergenceTarget(task, board.columns)).toBeUndefined();
  });
});
