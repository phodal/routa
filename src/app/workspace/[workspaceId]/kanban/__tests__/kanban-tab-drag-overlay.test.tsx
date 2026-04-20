import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanTab } from "../kanban-tab";
import type { KanbanBoardInfo, TaskInfo } from "../../types";

const { dndKitHarness } = vi.hoisted(() => ({
  dndKitHarness: {
    onDragStart: null as null | ((event: {
      active: {
        id: string;
        rect?: { current?: { initial?: { width: number; height: number } | null } };
      };
    }) => void),
    emitDragStart(event: {
      active: {
        id: string;
        rect?: { current?: { initial?: { width: number; height: number } | null } };
      };
    }) {
      this.onDragStart?.(event);
    },
    reset() {
      this.onDragStart = null;
    },
  },
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({
    children,
    onDragStart,
  }: {
    children: ReactNode;
    onDragStart?: (event: {
      active: {
        id: string;
        rect?: { current?: { initial?: { width: number; height: number } | null } };
      };
    }) => void;
  }) => {
    dndKitHarness.onDragStart = onDragStart ?? null;
    return <>{children}</>;
  },
  DragOverlay: ({ children }: { children: ReactNode }) => <>{children}</>,
  MouseSensor: class {},
  TouchSensor: class {},
  closestCorners: vi.fn(),
  useDroppable: () => ({
    isOver: false,
    setNodeRef: vi.fn(),
  }),
  useDraggable: () => ({
    attributes: {},
    isDragging: false,
    listeners: {},
    setNodeRef: vi.fn(),
  }),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
}));

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
    { id: "todo", name: "Todo", position: 1, stage: "todo" },
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
  dndKitHarness.reset();
});

describe("KanbanTab drag overlay", () => {
  it("renders a drag overlay while a card is active", () => {
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

    act(() => {
      dndKitHarness.emitDragStart({
        active: {
          id: "task-1",
          rect: {
            current: {
              initial: {
                width: 320,
                height: 180,
              },
            },
          },
        },
      });
    });

    expect(screen.getByTestId("kanban-card-overlay").textContent).toContain("Story One");
  });
});
