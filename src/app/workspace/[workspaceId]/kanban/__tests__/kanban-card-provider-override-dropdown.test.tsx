import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KanbanCardDetail } from "../kanban-card-detail";
import type { KanbanBoardInfo, TaskInfo } from "../../types";

const board: KanbanBoardInfo = {
  id: "board-1",
  workspaceId: "workspace-1",
  name: "Default Board",
  isDefault: true,
  sessionConcurrencyLimit: 1,
  queue: {
    runningCount: 0,
    runningCards: [],
    queuedCount: 0,
    queuedCardIds: [],
    queuedCards: [],
    queuedPositions: {},
  },
  columns: [
    { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
  ],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

function createTask(id: string, title: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id,
    title,
    objective: `${title} objective`,
    status: "PENDING",
    boardId: board.id,
    columnId: "backlog",
    position: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("KanbanCardDetail provider override", () => {
  it("uses the ACP provider dropdown for card session overrides", async () => {
    const onPatchTask = vi.fn(async (_taskId: string, payload: Record<string, unknown>) =>
      createTask("task-provider", "Story Provider", payload as Partial<TaskInfo>),
    );

    render(
      <KanbanCardDetail
        task={createTask("task-provider", "Story Provider")}
        boardColumns={board.columns}
        availableProviders={[{
          id: "claude",
          name: "Claude Code",
          description: "Claude provider",
          command: "claude",
          status: "available",
        }]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        sessions={[]}
        fullWidth
        onPatchTask={onPatchTask}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Execution" }));
    fireEvent.click(screen.getByText("Card session override").closest("summary")!);

    const providerDropdown = screen.getByTestId("kanban-detail-provider-override");
    expect(providerDropdown.tagName).toBe("BUTTON");
    expect(providerDropdown.textContent).toContain("Use lane default");

    fireEvent.click(providerDropdown);
    fireEvent.click(await screen.findByRole("button", { name: /Claude Code/ }));

    await waitFor(() => {
      expect(onPatchTask).toHaveBeenCalledWith("task-provider", {
        assignedProvider: "claude",
        assignedRole: "DEVELOPER",
      });
    });
  });
});
