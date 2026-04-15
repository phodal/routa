import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanTab } from "../kanban-tab";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import { resetDesktopAwareFetchToGlobalFetch } from "./test-utils";

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return {
    ...actual,
    desktopAwareFetch,
  };
});

vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: () => <div data-testid="repo-picker-mock" />,
}));

vi.mock("../use-runtime-fitness-status", async () => {
  const { mockUseRuntimeFitnessStatus } = await import("./test-utils");
  return {
    useRuntimeFitnessStatus: mockUseRuntimeFitnessStatus,
  };
});

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

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  window.history.replaceState({}, "", "/workspace/workspace-1/kanban");
});

describe("KanbanTab URL state", () => {
  it("syncs card detail open and close with the taskId query param", async () => {
    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[createTask("task-1", "Story One")]}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Story One" }));
    await screen.findByText("Card Detail");

    expect(window.location.search).toContain("taskId=task-1");

    fireEvent.click(screen.getByRole("button", { name: /Close card detail/i }));

    await waitFor(() => {
      expect(screen.queryByText("Card Detail")).toBeNull();
    });
    expect(window.location.search).not.toContain("taskId=");
  });

  it("reopens the correct card detail when history navigation restores the taskId query param", async () => {
    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[createTask("task-1", "Story One"), createTask("task-2", "Story Two")]}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Story Two" }));
    await screen.findByDisplayValue("Story Two");

    fireEvent.click(screen.getByRole("button", { name: /Close card detail/i }));
    await waitFor(() => {
      expect(screen.queryByText("Card Detail")).toBeNull();
    });

    window.history.pushState({}, "", "/workspace/workspace-1/kanban?taskId=task-1");
    window.dispatchEvent(new PopStateEvent("popstate"));

    await screen.findByText("Card Detail");
    expect(screen.getByDisplayValue("Story One")).toBeTruthy();
  });

  it("syncs board selection with boardId and restores a deep-linked board/task combination", async () => {
    const secondBoard: KanbanBoardInfo = {
      ...board,
      id: "board-2",
      name: "Review Board",
      isDefault: false,
    };

    window.history.replaceState({}, "", "/workspace/workspace-1/kanban?boardId=board-2&taskId=task-2");

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board, secondBoard]}
        tasks={[
          createTask("task-1", "Story One", { boardId: board.id }),
          createTask("task-2", "Story Two", { boardId: secondBoard.id }),
        ]}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    await screen.findByDisplayValue("Story Two");
    const boardSelect = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    expect(boardSelect.value).toBe("board-2");

    fireEvent.change(boardSelect, { target: { value: "board-1" } });

    await waitFor(() => {
      expect(screen.queryByText("Card Detail")).toBeNull();
    });
    expect(window.location.search).toContain("boardId=board-1");
    expect(window.location.search).not.toContain("taskId=");
  });
});
