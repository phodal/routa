import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { KanbanColumnInfo, TaskInfo } from "../../types";
import { KanbanCard } from "../kanban-card";

vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({
    attributes: {},
    isDragging: false,
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
  }),
}));

const boardColumns: KanbanColumnInfo[] = [
  { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
  { id: "todo", name: "Todo", position: 1, stage: "todo" },
  { id: "dev", name: "Dev", position: 2, stage: "dev" },
  {
    id: "review",
    name: "Review",
    position: 3,
    stage: "review",
    automation: {
      enabled: false,
      requiredArtifacts: ["screenshot"],
    },
  },
];

function buildTask(overrides?: Partial<TaskInfo>): TaskInfo {
  return {
    id: "task-1",
    title: "Artifact status",
    objective: "Show artifact gate state on the card.",
    status: "IN_PROGRESS",
    boardId: "board-1",
    columnId: "dev",
    position: 0,
    priority: "medium",
    labels: [],
    createdAt: "2025-01-01T00:00:00.000Z",
    artifactSummary: {
      total: 0,
      byType: {},
    },
    ...overrides,
  };
}

describe("KanbanCard artifact gate status", () => {
  it("shows missing artifact gate state when the next lane is still blocked", () => {
    render(
      <KanbanCard
        task={buildTask()}
        boardColumns={boardColumns}
        specialistLanguage="en"
        availableProviders={[]}
        specialists={[]}
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        onOpenDetail={vi.fn()}
        onDelete={vi.fn()}
        onPatchTask={vi.fn()}
        onRetryTrigger={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByTestId("kanban-card-artifact-gate").textContent).toContain("Needs Screenshot");
  });

  it("shows ready state and artifact count once the gate is satisfied", () => {
    render(
      <KanbanCard
        task={buildTask({
          artifactSummary: {
            total: 2,
            byType: {
              screenshot: 1,
              logs: 1,
            },
          },
        })}
        boardColumns={boardColumns}
        specialistLanguage="en"
        availableProviders={[]}
        specialists={[]}
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        onOpenDetail={vi.fn()}
        onDelete={vi.fn()}
        onPatchTask={vi.fn()}
        onRetryTrigger={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByTestId("kanban-card-artifact-gate").textContent).toContain("Review ready");
    expect(screen.getByTestId("kanban-card-artifact-count").textContent).toContain("2 artifacts");
  });

  it("renders live session tail as a single-line preview", () => {
    render(
      <KanbanCard
        task={buildTask()}
        boardColumns={boardColumns}
        liveMessageTail="Updated parser; now handling edge-case whitespace and retry flow."
        specialistLanguage="en"
        availableProviders={[]}
        specialists={[]}
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        onOpenDetail={vi.fn()}
        onDelete={vi.fn()}
        onPatchTask={vi.fn()}
        onRetryTrigger={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText("Live Session")).toBeTruthy();
    expect(screen.getByTestId("kanban-card-live-tail").textContent).toContain("Updated parser;");
  });

  it("surfaces review feedback on cards returned to dev", () => {
    render(
      <KanbanCard
        task={buildTask({
          columnId: "dev",
          verificationVerdict: "NOT_APPROVED",
          verificationReport: "AC3 failed: editor still strips nested marks when pasting rich text.",
        })}
        boardColumns={boardColumns}
        specialistLanguage="en"
        availableProviders={[]}
        specialists={[]}
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        onOpenDetail={vi.fn()}
        onDelete={vi.fn()}
        onPatchTask={vi.fn()}
        onRetryTrigger={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByTestId("kanban-card-review-feedback").textContent).toContain("Returned to Dev");
    expect(screen.getByTestId("kanban-card-review-feedback").textContent).toContain("AC3 failed");
  });

  it("renders imported pull requests with a PR badge", () => {
    render(
      <KanbanCard
        task={buildTask({
          githubNumber: 289,
          githubUrl: "https://github.com/acme/platform/pull/289",
          isPullRequest: true,
        })}
        boardColumns={boardColumns}
        specialistLanguage="en"
        availableProviders={[]}
        specialists={[]}
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        onOpenDetail={vi.fn()}
        onDelete={vi.fn()}
        onPatchTask={vi.fn()}
        onRetryTrigger={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("link", { name: "PR #289" }).getAttribute("href"),
    ).toBe("https://github.com/acme/platform/pull/289");
  });

  it("shows a run action when the lane is automated through the board auto provider", () => {
    render(
      <KanbanCard
        task={buildTask({ columnId: "backlog" })}
        boardColumns={[{
          id: "backlog",
          name: "Backlog",
          position: 0,
          stage: "backlog",
          automation: {
            enabled: true,
            role: "ROUTA",
            specialistId: "backlog-refiner",
            specialistName: "Backlog Refiner",
          },
        }]}
        specialistLanguage="en"
        availableProviders={[{ id: "codex", name: "Codex", description: "Codex provider", command: "codex" }]}
        specialists={[{ id: "backlog-refiner", name: "Backlog Refiner", role: "ROUTA", defaultProvider: "claude" }]}
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        autoProviderId="codex"
        onOpenDetail={vi.fn()}
        onDelete={vi.fn()}
        onPatchTask={vi.fn()}
        onRetryTrigger={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Run" })).toBeTruthy();
  });

  it("renders canonical story body instead of raw yaml on the card", () => {
    render(
      <KanbanCard
        task={buildTask({
          title: "Canonical story preview",
          objective: `\`\`\`yaml
story:
  version: 1
  language: en
  title: Canonical story preview
  problem_statement: |
    Dependency upgrades can regress editor behavior without explicit validation.
  user_value: |
    Maintainers can review the change as a structured story instead of raw YAML only.
  acceptance_criteria:
    - id: AC1
      text: Card preview shows story content.
      testable: true
    - id: AC2
      text: Raw fenced YAML is hidden in the list.
      testable: true
  constraints_and_affected_areas:
    - src/app/workspace/[workspaceId]/kanban/kanban-card.tsx
  dependencies_and_sequencing:
    independent_story_check: pass
    depends_on: []
    unblock_condition: none
  out_of_scope:
    - unrelated cleanup
  invest:
    independent:
      status: pass
      reason: no prerequisite
    negotiable:
      status: pass
      reason: presentation only
    valuable:
      status: pass
      reason: faster scanning
    estimable:
      status: pass
      reason: card-only change
    small:
      status: pass
      reason: one component
    testable:
      status: pass
      reason: preview is visible
\`\`\``,
        })}
        boardColumns={boardColumns}
        specialistLanguage="en"
        availableProviders={[]}
        specialists={[]}
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        onOpenDetail={vi.fn()}
        onDelete={vi.fn()}
        onPatchTask={vi.fn()}
        onRetryTrigger={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText(/Dependency upgrades can regress editor behavior/i)).toBeTruthy();
    expect(screen.queryByText(/```yaml/i)).toBeNull();
  });
});
