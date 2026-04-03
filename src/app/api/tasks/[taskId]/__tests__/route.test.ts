import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createArtifact } from "@/core/models/artifact";
import { createTask, TaskStatus, VerificationVerdict, type Task } from "@/core/models/task";
import { InMemoryArtifactStore } from "@/core/store/artifact-store";

const notify = vi.fn();
const removeCardJob = vi.fn();
const enqueueKanbanTaskSession = vi.fn();
const processKanbanColumnTransition = vi.fn();
const archiveActiveTaskSession = vi.fn<(task: Task) => void>();
const prepareTaskForColumnChange = vi.fn<(fromColumnId?: string, task?: Task) => boolean>(() => false);
const buildTaskDeliveryReadiness = vi.fn();
const buildTaskDeliveryTransitionError = vi.fn(() => null);
let capturedEnqueueTask: Task | undefined;

const taskStore = {
  get: vi.fn<(_: string) => Promise<Task | null>>(),
  save: vi.fn<(task: Task) => Promise<void>>(),
};

const system = {
  taskStore,
  kanbanBoardStore: { get: vi.fn() },
  workspaceStore: { get: vi.fn() },
  worktreeStore: { assignSession: vi.fn() },
  codebaseStore: { findByRepoPath: vi.fn(), get: vi.fn(), getDefault: vi.fn() },
  eventBus: {},
  artifactStore: undefined as InMemoryArtifactStore | undefined,
};
const artifactStore = new InMemoryArtifactStore();

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
  GitWorktreeService: vi.fn(),
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
  buildTaskDeliveryReadiness: (...args: unknown[]) => buildTaskDeliveryReadiness(...args),
  buildTaskDeliveryTransitionError: (...args: unknown[]) => buildTaskDeliveryTransitionError(...args),
}));

vi.mock("@/core/kanban/workflow-orchestrator-singleton", () => ({
  enqueueKanbanTaskSession: (currentSystem: typeof system, params: { task: Task }) =>
    enqueueKanbanTaskSession(currentSystem, params),
  getKanbanSessionQueue: () => ({ removeCardJob }),
  processKanbanColumnTransition: (...args: unknown[]) => processKanbanColumnTransition(...args),
}));

import { GET, PATCH } from "../route";

describe("/api/tasks/[taskId]", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    capturedEnqueueTask = undefined;
    buildTaskDeliveryReadiness.mockResolvedValue({
      checked: false,
      modified: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
      commitsSinceBase: 0,
      hasCommitsSinceBase: false,
      hasUncommittedChanges: false,
      isGitHubRepo: false,
      canCreatePullRequest: false,
      reason: "Task has no linked repository or worktree.",
    });
    buildTaskDeliveryTransitionError.mockReturnValue(null);
    taskStore.save.mockResolvedValue();
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue(null);
    system.artifactStore = undefined;
    await artifactStore.deleteByTask("task-1");
    taskStore.get.mockResolvedValue(createTask({
      id: "task-1",
      title: "Retry review",
      objective: "Retry review",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "todo",
      status: TaskStatus.PENDING,
      triggerSessionId: "session-old",
      assignedProvider: "codex",
      assignedRole: "GATE",
      assignedSpecialistId: "pr-reviewer",
      assignedSpecialistName: "PR Reviewer",
    }));
    enqueueKanbanTaskSession.mockImplementation(async (_system, params: { task: Task }) => {
      capturedEnqueueTask = structuredClone(params.task);
      return {
        sessionId: "session-new",
        queued: false,
      };
    });
    processKanbanColumnTransition.mockResolvedValue(undefined);
  });

  it("returns default evidence summary when artifact storage is unavailable", async () => {
    const response = await GET(new NextRequest("http://localhost/api/tasks/task-1"), {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.task.artifactSummary).toEqual({
      total: 0,
      byType: {},
      requiredSatisfied: true,
      missingRequired: [],
    });
    expect(data.task.evidenceSummary).toEqual({
      artifact: {
        total: 0,
        byType: {},
        requiredSatisfied: true,
        missingRequired: [],
      },
      verification: {
        hasVerdict: false,
        verdict: undefined,
        hasReport: false,
      },
      completion: {
        hasSummary: false,
      },
      runs: {
        total: 0,
        latestStatus: "idle",
      },
    });
    expect(data.task.storyReadiness).toMatchObject({
      ready: true,
      missing: [],
      requiredTaskFields: [],
    });
    expect(data.task.investValidation).toMatchObject({
      source: "heuristic",
      overallStatus: "fail",
    });
  });

  it("reports missing required artifacts and latest run status in evidence summary", async () => {
    const task = createTask({
      id: "task-1",
      title: "Verify dev handoff",
      objective: "Surface evidence requirements",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "todo",
      status: TaskStatus.PENDING,
      triggerSessionId: "session-todo-1",
    });
    task.sessionIds = ["session-todo-1"];
    task.laneSessions = [{
      sessionId: "session-todo-1",
      columnId: "todo",
      columnName: "Todo",
      status: "running",
      startedAt: "2026-03-18T00:00:00.000Z",
    }];
    task.verificationVerdict = VerificationVerdict.APPROVED;
    task.verificationReport = "Checks passed";
    task.completionSummary = "Ready for dev";
    taskStore.get.mockResolvedValue(task);
    system.artifactStore = artifactStore;
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        { id: "todo", name: "Todo", position: 0, stage: "todo" },
        {
          id: "dev",
          name: "Dev",
          position: 1,
          stage: "dev",
          automation: {
            requiredArtifacts: ["screenshot", "logs"],
          },
        },
      ],
    });

    await artifactStore.saveArtifact(createArtifact({
      id: "artifact-1",
      type: "logs",
      taskId: "task-1",
      workspaceId: "workspace-1",
      status: "provided",
    }));

    const response = await GET(new NextRequest("http://localhost/api/tasks/task-1"), {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.task.evidenceSummary).toMatchObject({
      artifact: {
        total: 1,
        byType: {
          logs: 1,
        },
        requiredSatisfied: false,
        missingRequired: ["screenshot"],
      },
      verification: {
        hasVerdict: true,
        verdict: "APPROVED",
        hasReport: true,
      },
      completion: {
        hasSummary: true,
      },
      runs: {
        total: 1,
        latestStatus: "running",
      },
    });
    expect(data.task.storyReadiness).toMatchObject({
      ready: true,
      requiredTaskFields: [],
    });
  });

  it("blocks moving a card into a lane when required task fields are missing", async () => {
    const existingTask = createTask({
      id: "task-1",
      title: "Prepare dev handoff",
      objective: "Need scope and verification plan",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "todo",
      status: TaskStatus.PENDING,
    });
    taskStore.get.mockResolvedValue(existingTask);
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        { id: "todo", name: "Todo", position: 0, stage: "todo" },
        {
          id: "dev",
          name: "Dev",
          position: 1,
          stage: "dev",
          automation: {
            requiredTaskFields: ["scope", "acceptance_criteria", "verification_plan"],
          },
        },
      ],
    });

    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ columnId: "dev" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Cannot move task to "Dev": missing required task fields');
    expect(data.missingTaskFields).toEqual(["scope", "acceptance criteria", "verification plan"]);
    expect(data.storyReadiness).toMatchObject({
      ready: false,
      missing: ["scope", "acceptance_criteria", "verification_plan"],
    });
  });

  it("clears the active queue entry before rerunning a task trigger", async () => {
    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ retryTrigger: true }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(archiveActiveTaskSession).toHaveBeenCalledTimes(1);
    expect(removeCardJob).toHaveBeenCalledWith("task-1");
    expect(enqueueKanbanTaskSession).toHaveBeenCalledTimes(1);
    expect(enqueueKanbanTaskSession).toHaveBeenCalledWith(system, expect.objectContaining({
      expectedColumnId: "todo",
      ignoreExistingTrigger: true,
    }));
    expect(capturedEnqueueTask).toMatchObject({
      id: "task-1",
      triggerSessionId: undefined,
    });
    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      id: "task-1",
      triggerSessionId: "session-new",
    }));
    expect(data.task.triggerSessionId).toBe("session-new");
  });

  it("rejects moving a card out of a lane while later automation steps are still pending", async () => {
    const existingTask = createTask({
      id: "task-1",
      title: "Run todo pipeline",
      objective: "Complete todo before dev",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "todo",
      status: TaskStatus.PENDING,
      triggerSessionId: "session-todo-1",
      assignedProvider: "codex",
      assignedRole: "CRAFTER",
      assignedSpecialistId: "kanban-todo-orchestrator",
      assignedSpecialistName: "Todo Orchestrator",
    });
    existingTask.laneSessions = [
      {
        sessionId: "session-todo-1",
        columnId: "todo",
        columnName: "Todo",
        stepId: "step-1",
        stepIndex: 0,
        stepName: "Todo Orchestrator",
        provider: "codex",
        role: "CRAFTER",
        specialistId: "kanban-todo-orchestrator",
        specialistName: "Todo Orchestrator",
        status: "running",
        startedAt: "2026-03-18T00:00:00.000Z",
      },
    ];
    taskStore.get.mockResolvedValue(existingTask);
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        {
          id: "todo",
          name: "Todo",
          position: 1,
          stage: "todo",
          automation: {
            enabled: true,
            steps: [
              {
                id: "step-1",
                providerId: "codex",
                role: "CRAFTER",
                specialistId: "kanban-todo-orchestrator",
                specialistName: "Todo Orchestrator",
              },
              {
                id: "step-2",
                role: "GATE",
                specialistId: "gate",
                specialistName: "Verifier",
              },
            ],
          },
        },
        { id: "dev", name: "Dev", position: 2, stage: "dev" },
      ],
    });

    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ columnId: "dev" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Todo Orchestrator");
    expect(data.error).toContain("Verifier");
    expect(taskStore.save).not.toHaveBeenCalled();
    expect(enqueueKanbanTaskSession).not.toHaveBeenCalled();
  });

  it("blocks moving a card to review when no committed changes are available", async () => {
    const existingTask = createTask({
      id: "task-1",
      title: "Review blocked without commit",
      objective: "Need a real code commit before review",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "dev",
      status: TaskStatus.IN_PROGRESS,
    });
    taskStore.get.mockResolvedValue(existingTask);
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        { id: "dev", name: "Dev", position: 1, stage: "dev" },
        { id: "review", name: "Review", position: 2, stage: "review" },
      ],
    });
    buildTaskDeliveryReadiness.mockResolvedValue({
      checked: true,
      branch: "issue/task-1",
      baseBranch: "main",
      baseRef: "origin/main",
      modified: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
      commitsSinceBase: 0,
      hasCommitsSinceBase: false,
      hasUncommittedChanges: false,
      isGitHubRepo: true,
      canCreatePullRequest: false,
    });
    buildTaskDeliveryTransitionError.mockReturnValue(
      'Cannot move task to "Review": no committed changes detected on branch "issue/task-1" relative to "origin/main". Commit your implementation before requesting review.',
    );

    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ columnId: "review" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("no committed changes detected");
    expect(data.deliveryReadiness).toMatchObject({
      checked: true,
      commitsSinceBase: 0,
      hasCommitsSinceBase: false,
    });
    expect(taskStore.save).not.toHaveBeenCalled();
  });

  it("blocks moving a card to done when a GitHub task is not PR-ready", async () => {
    const existingTask = createTask({
      id: "task-1",
      title: "Done blocked until PR is ready",
      objective: "Need a clean feature branch before completion",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "review",
      status: TaskStatus.REVIEW_REQUIRED,
    });
    taskStore.get.mockResolvedValue(existingTask);
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        { id: "review", name: "Review", position: 2, stage: "review" },
        { id: "done", name: "Done", position: 3, stage: "done" },
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
    buildTaskDeliveryTransitionError.mockReturnValue(
      'Cannot move task to "Done": GitHub repo is not PR-ready yet. Use a feature branch instead of "main" so this task can open a pull request cleanly.',
    );

    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ columnId: "done" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("PR-ready");
    expect(data.deliveryReadiness).toMatchObject({
      checked: true,
      branch: "main",
      canCreatePullRequest: false,
    });
    expect(taskStore.save).not.toHaveBeenCalled();
  });

  it("processes non-dev automated column transitions before returning", async () => {
    const existingTask = createTask({
      id: "task-1",
      title: "Move into todo",
      objective: "Ensure todo automation is started eagerly.",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
    });
    taskStore.get.mockResolvedValue(existingTask);
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        {
          id: "todo",
          name: "Todo",
          position: 1,
          stage: "todo",
          automation: {
            enabled: true,
            steps: [{ id: "todo-a2a", transport: "a2a", role: "CRAFTER" }],
            transitionType: "entry",
          },
        },
      ],
    });

    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ columnId: "todo" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });

    expect(response.status).toBe(200);
    expect(processKanbanColumnTransition).toHaveBeenCalledWith(system, expect.objectContaining({
      cardId: "task-1",
      boardId: "board-1",
      fromColumnId: "backlog",
      toColumnId: "todo",
      toColumnName: "Todo",
    }));
  });
});
