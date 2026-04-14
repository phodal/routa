import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, TaskStatus, VerificationVerdict, type Task } from "@/core/models/task";
import type { TaskDeliveryReadiness } from "@/core/kanban/task-delivery-readiness";

const notify = vi.fn();
const removeCardJob = vi.fn();
const enqueueKanbanTaskSession = vi.fn();
const processKanbanColumnTransition = vi.fn();
const archiveActiveTaskSession = vi.fn<(task: Task) => void>();
const prepareTaskForColumnChange = vi.fn<(fromColumnId?: string, task?: Task) => boolean>(() => false);
const buildTaskDeliveryReadiness = vi.fn<
  (task: Task, currentSystem: typeof system) => Promise<TaskDeliveryReadiness>
>();
const buildTaskDeliveryTransitionErrorFromRules = vi.fn<
  (readiness: TaskDeliveryReadiness, targetColumnName: string, deliveryRules: Record<string, unknown> | undefined) => string | null
>(() => null);

const taskStore = {
  get: vi.fn<(_: string) => Promise<Task | null>>(),
  save: vi.fn<(task: Task) => Promise<void>>(),
};

const system = {
  taskStore,
  kanbanBoardStore: { get: vi.fn() },
  workspaceStore: { get: vi.fn() },
  worktreeStore: { assignSession: vi.fn(), get: vi.fn() },
  codebaseStore: { findByRepoPath: vi.fn(), get: vi.fn(), getDefault: vi.fn() },
  eventBus: {},
  artifactStore: undefined,
};

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

vi.mock("@/core/kanban/kanban-event-broadcaster", () => ({
  getKanbanEventBroadcaster: () => ({ notify }),
}));

vi.mock("@/core/kanban/task-board-context", () => ({
  ensureTaskBoardContext: vi.fn(async () => ({})),
}));

vi.mock("@/core/kanban/github-issues", () => ({
  updateGitHubIssue: vi.fn(),
}));

vi.mock("@/core/git/git-worktree-service", () => ({
  GitWorktreeService: vi.fn(class {}),
}));

vi.mock("@/core/models/workspace", () => ({
  getDefaultWorkspaceWorktreeRoot: vi.fn(),
  getEffectiveWorkspaceMetadata: vi.fn(),
}));

vi.mock("@/core/kanban/column-transition", () => ({
  emitColumnTransition: vi.fn(),
}));

vi.mock("@/core/kanban/task-session-transition", () => ({
  archiveActiveTaskSession: (task: Task) => archiveActiveTaskSession(task),
  prepareTaskForColumnChange: (fromColumnId?: string, task?: Task) =>
    prepareTaskForColumnChange(fromColumnId, task),
}));

vi.mock("@/core/kanban/task-delivery-readiness", () => ({
  buildTaskDeliveryReadiness: (task: Task, currentSystem: typeof system) =>
    buildTaskDeliveryReadiness(task, currentSystem),
  buildTaskDeliveryTransitionErrorFromRules: (
    readiness: TaskDeliveryReadiness,
    targetColumnName: string,
    deliveryRules: Record<string, unknown> | undefined,
  ) => buildTaskDeliveryTransitionErrorFromRules(readiness, targetColumnName, deliveryRules),
}));

vi.mock("@/core/kanban/workflow-orchestrator-singleton", () => ({
  enqueueKanbanTaskSession: (currentSystem: typeof system, params: { task: Task }) =>
    enqueueKanbanTaskSession(currentSystem, params),
  getKanbanSessionQueue: () => ({ removeCardJob }),
  processKanbanColumnTransition: (...args: unknown[]) => processKanbanColumnTransition(...args),
}));

import { PATCH } from "../route";

describe("/api/tasks/[taskId] verdict convergence gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskStore.save.mockResolvedValue();
    taskStore.get.mockResolvedValue(createTask({
      id: "task-1",
      title: "Finalize review verdict",
      objective: "Leave review only when done checks pass",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "review",
      status: TaskStatus.REVIEW_REQUIRED,
    }));
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        {
          id: "review",
          name: "Review",
          position: 0,
          stage: "review",
          automation: {
            enabled: true,
            steps: [
              {
                id: "review-guard",
                role: "GATE",
                specialistId: "kanban-review-guard",
                specialistName: "Review Guard",
              },
            ],
          },
        },
        {
          id: "done",
          name: "Done",
          position: 1,
          stage: "done",
          automation: {
            deliveryRules: {
              requirePullRequestReady: true,
            },
          },
        },
      ],
    });
    buildTaskDeliveryReadiness.mockResolvedValue({
      checked: true,
      branch: "main",
      baseBranch: "main",
      baseRef: "origin/main",
      modified: 0,
      untracked: 0,
      ahead: 1,
      behind: 0,
      commitsSinceBase: 1,
      hasCommitsSinceBase: true,
      hasUncommittedChanges: false,
      isGitHubRepo: true,
      canCreatePullRequest: false,
    });
    buildTaskDeliveryTransitionErrorFromRules.mockReturnValue(
      'Cannot move task to "Done": GitHub repo is not PR-ready yet. Use a feature branch instead of "main" so this task can open a pull request cleanly.',
    );
  });

  it("re-validates the converged lane before saving", async () => {
    const response = await PATCH(new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({
        columnId: "review",
        verificationVerdict: VerificationVerdict.APPROVED,
      }),
      headers: { "Content-Type": "application/json" },
    }), {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Cannot move task to "Done"');
    expect(data.deliveryReadiness).toMatchObject({
      checked: true,
      branch: "main",
      canCreatePullRequest: false,
    });
    expect(taskStore.save).not.toHaveBeenCalled();
  });
});
