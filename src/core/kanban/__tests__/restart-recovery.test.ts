import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, TaskStatus, VerificationVerdict, type Task } from "@/core/models/task";
import { reviveMissingEntryAutomations } from "../restart-recovery";

const notify = vi.fn();
const processKanbanColumnTransition = vi.fn();
const enqueueKanbanTaskSession = vi.fn();

vi.mock("@/core/kanban/kanban-event-broadcaster", () => ({
  getKanbanEventBroadcaster: () => ({ notify }),
}));

vi.mock("@/core/kanban/workflow-orchestrator-singleton", () => ({
  processKanbanColumnTransition: (...args: unknown[]) => processKanbanColumnTransition(...args),
  enqueueKanbanTaskSession: (...args: unknown[]) => enqueueKanbanTaskSession(...args),
}));

function createTaskWithRunningSession(overrides?: Partial<Task>): Task {
  return {
    ...createTask({
      id: "task-1",
      title: "Backlog story",
      objective: "Backlog story",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
    }),
    triggerSessionId: "session-1",
    laneSessions: [{
      sessionId: "session-1",
      columnId: "backlog",
      status: "running",
      startedAt: "2025-01-01T00:00:00.000Z",
    }],
    ...overrides,
  };
}

describe("kanban restart recovery", () => {
  const taskStore = {
    listByWorkspace: vi.fn<(_: string) => Promise<Task[]>>(),
    save: vi.fn<(task: Task) => Promise<void>>(),
  };

  const kanbanBoardStore = {
    get: vi.fn(),
  };

  const system = {
    taskStore,
    kanbanBoardStore,
  };

  const sessionStore = {
    getSession: vi.fn(),
  };

  const processManager = {
    hasActiveSession: vi.fn<(sessionId: string) => boolean>(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    taskStore.save.mockResolvedValue(undefined);
    enqueueKanbanTaskSession.mockResolvedValue({ sessionId: "session-next", queued: false });
    sessionStore.getSession.mockReturnValue(undefined);
    processManager.hasActiveSession.mockReturnValue(false);
  });

  it("revives ownerless hydrated sessions even if the lease timestamp is still in the future", async () => {
    kanbanBoardStore.get.mockResolvedValue({
      id: "board-1",
      columns: [{
        id: "backlog",
        name: "Backlog",
        position: 0,
        stage: "backlog",
        automation: {
          enabled: true,
          transitionType: "entry",
          steps: [{ id: "backlog-refiner", role: "CRAFTER" }],
        },
      }],
    });
    taskStore.listByWorkspace.mockResolvedValue([createTaskWithRunningSession()]);
    sessionStore.getSession.mockReturnValue({
      sessionId: "session-1",
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
    });

    await reviveMissingEntryAutomations(system as never, "workspace-1", "board-1", {
      sessionStore: sessionStore as never,
      processManager: processManager as never,
    });

    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      id: "task-1",
      triggerSessionId: undefined,
      laneSessions: [expect.objectContaining({
        sessionId: "session-1",
        status: "timed_out",
      })],
    }));
    expect(processKanbanColumnTransition).toHaveBeenCalledWith(system, expect.objectContaining({
      cardId: "task-1",
      fromColumnId: "__revive__",
      toColumnId: "backlog",
    }));
  });

  it("re-enqueues the next review step when recovery resumes a multi-step lane", async () => {
    const reviewBoard = {
      id: "board-1",
      columns: [{
        id: "review",
        name: "Review",
        position: 0,
        stage: "review",
        automation: {
          enabled: true,
          transitionType: "entry",
          steps: [
            { id: "qa-frontend", role: "GATE", specialistId: "kanban-qa-frontend", specialistName: "QA Frontend" },
            { id: "review-guard", role: "GATE", specialistId: "kanban-review-guard", specialistName: "Review Guard" },
          ],
        },
      }],
    };
    kanbanBoardStore.get.mockResolvedValue(reviewBoard);
    taskStore.listByWorkspace.mockResolvedValue([{
      ...createTaskWithRunningSession({
        title: "Approved review story",
        objective: "Review story",
        columnId: "review",
        status: TaskStatus.REVIEW_REQUIRED,
        verificationVerdict: VerificationVerdict.APPROVED,
        verificationReport: "looks good",
      }),
      laneSessions: [{
        sessionId: "session-1",
        columnId: "review",
        status: "running",
        stepId: "qa-frontend",
        stepIndex: 0,
        stepName: "QA Frontend",
        startedAt: "2025-01-01T00:00:00.000Z",
      }],
    }]);

    await reviveMissingEntryAutomations(system as never, "workspace-1", "board-1", {
      sessionStore: sessionStore as never,
      processManager: processManager as never,
    });

    expect(enqueueKanbanTaskSession).toHaveBeenCalledWith(system, expect.objectContaining({
      expectedColumnId: "review",
      ignoreExistingTrigger: true,
      stepIndex: 1,
      step: expect.objectContaining({ id: "review-guard" }),
    }));
    expect(processKanbanColumnTransition).not.toHaveBeenCalled();
  });

  it("skips re-triggering when the last automation step already completed", async () => {
    kanbanBoardStore.get.mockResolvedValue({
      id: "board-1",
      columns: [{
        id: "backlog",
        name: "Backlog",
        position: 0,
        stage: "backlog",
        automation: {
          enabled: true,
          transitionType: "entry",
          steps: [{ id: "backlog-refiner", role: "CRAFTER" }],
        },
      }],
    });
    taskStore.listByWorkspace.mockResolvedValue([{
      ...createTask({
        id: "task-1",
        title: "Refined backlog story",
        objective: "Refined backlog story",
        workspaceId: "workspace-1",
        boardId: "board-1",
        columnId: "backlog",
        status: TaskStatus.PENDING,
      }),
      laneSessions: [{
        sessionId: "session-1",
        columnId: "backlog",
        status: "completed",
        stepId: "backlog-refiner",
        stepIndex: 0,
        stepName: "Backlog Refiner",
        startedAt: "2025-01-01T00:00:00.000Z",
      }],
    }]);

    await reviveMissingEntryAutomations(system as never, "workspace-1", "board-1", {
      sessionStore: sessionStore as never,
      processManager: processManager as never,
    });

    expect(processKanbanColumnTransition).not.toHaveBeenCalled();
    expect(enqueueKanbanTaskSession).not.toHaveBeenCalled();
  });

  it("maps convergence status from the target column stage for custom done columns", async () => {
    const reviewBoard = {
      id: "board-1",
      columns: [
        {
          id: "review",
          name: "Review",
          position: 0,
          stage: "review",
          automation: {
            enabled: true,
            transitionType: "entry",
            steps: [
              { id: "qa-frontend", role: "GATE" },
              { id: "review-guard", role: "GATE" },
            ],
          },
        },
        {
          id: "stage-7",
          name: "Released",
          position: 1,
          stage: "done",
        },
      ],
    };
    kanbanBoardStore.get.mockResolvedValue(reviewBoard);
    taskStore.listByWorkspace.mockResolvedValue([{
      ...createTask({
        id: "task-1",
        title: "Approved review story",
        objective: "Review story",
        workspaceId: "workspace-1",
        boardId: "board-1",
        columnId: "review",
        status: TaskStatus.REVIEW_REQUIRED,
      }),
      verificationVerdict: VerificationVerdict.APPROVED,
      laneSessions: [{
        sessionId: "session-review-guard",
        columnId: "review",
        status: "completed",
        stepId: "review-guard",
        stepIndex: 1,
        stepName: "Review Guard",
        startedAt: "2025-01-01T00:00:00.000Z",
      }],
    }]);

    await reviveMissingEntryAutomations(system as never, "workspace-1", "board-1", {
      sessionStore: sessionStore as never,
      processManager: processManager as never,
    });

    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      id: "task-1",
      columnId: "stage-7",
      status: TaskStatus.COMPLETED,
    }));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      action: "moved",
      resourceId: "task-1",
    }));
    expect(processKanbanColumnTransition).toHaveBeenCalledWith(system, expect.objectContaining({
      cardId: "task-1",
      fromColumnId: "review",
      toColumnId: "stage-7",
      toColumnName: "Released",
    }));
  });

  it("triggers entry automation immediately after convergence moves a card back to dev", async () => {
    const reviewBoard = {
      id: "board-1",
      columns: [
        {
          id: "review",
          name: "Review",
          position: 0,
          stage: "review",
          automation: {
            enabled: true,
            transitionType: "entry",
            steps: [
              { id: "qa-frontend", role: "GATE" },
              { id: "review-guard", role: "GATE" },
            ],
          },
        },
        {
          id: "implementation",
          name: "Implementation",
          position: 1,
          stage: "dev",
          automation: {
            enabled: true,
            transitionType: "entry",
            steps: [{ id: "builder", role: "DEVELOPER" }],
          },
        },
      ],
    };
    kanbanBoardStore.get.mockResolvedValue(reviewBoard);
    taskStore.listByWorkspace.mockResolvedValue([{
      ...createTask({
        id: "task-1",
        title: "Rejected review story",
        objective: "Review story",
        workspaceId: "workspace-1",
        boardId: "board-1",
        columnId: "review",
        status: TaskStatus.REVIEW_REQUIRED,
      }),
      verificationVerdict: VerificationVerdict.NOT_APPROVED,
      laneSessions: [{
        sessionId: "session-review-guard",
        columnId: "review",
        status: "completed",
        stepId: "review-guard",
        stepIndex: 1,
        stepName: "Review Guard",
        startedAt: "2025-01-01T00:00:00.000Z",
      }],
    }]);

    await reviveMissingEntryAutomations(system as never, "workspace-1", "board-1", {
      sessionStore: sessionStore as never,
      processManager: processManager as never,
    });

    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      id: "task-1",
      columnId: "implementation",
      status: TaskStatus.IN_PROGRESS,
    }));
    expect(processKanbanColumnTransition).toHaveBeenCalledWith(system, expect.objectContaining({
      cardId: "task-1",
      fromColumnId: "review",
      toColumnId: "implementation",
      toColumnName: "Implementation",
    }));
  });
});
