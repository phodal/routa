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

vi.mock("@/core/kanban/workflow-orchestrator-singleton", () => ({
  enqueueKanbanTaskSession: (currentSystem: typeof system, params: { task: Task }) =>
    enqueueKanbanTaskSession(currentSystem, params),
  getKanbanSessionQueue: () => ({ removeCardJob }),
  processKanbanColumnTransition: (...args: unknown[]) => processKanbanColumnTransition(...args),
}));

import { GET, PATCH } from "../route";

const CANONICAL_STORY_OBJECTIVE = `Story summary

\`\`\`yaml
story:
  version: 1
  language: en
  title: Recompute INVEST
  problem_statement: INVEST validation should refresh when the story changes.
  user_value: Card detail shows an up-to-date validation snapshot.
  acceptance_criteria:
    - id: AC1
      text: Recalculate validation on objective changes.
      testable: true
    - id: AC2
      text: Persist the updated snapshot.
      testable: true
  constraints_and_affected_areas:
    - src/app/api/tasks/[taskId]/route.ts
  dependencies_and_sequencing:
    independent_story_check: pass
    depends_on:
      - none
    unblock_condition: none
  out_of_scope:
    - Specialist orchestration
  invest:
    independent:
      status: pass
      reason: No blocking dependency.
    negotiable:
      status: pass
      reason: Details can still evolve.
    valuable:
      status: pass
      reason: Reviewers can see the result.
    estimable:
      status: warning
      reason: The exact invocation path is still partial.
    small:
      status: pass
      reason: Scope is intentionally minimal.
    testable:
      status: pass
      reason: Route tests cover the behavior.
\`\`\``;

describe("/api/tasks/[taskId]", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    capturedEnqueueTask = undefined;
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

  it("recomputes investValidation when the objective changes", async () => {
    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ objective: CANONICAL_STORY_OBJECTIVE }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      id: "task-1",
      investValidation: expect.objectContaining({
        overall: "warning",
        estimable: expect.objectContaining({ status: "warning" }),
      }),
    }));
    expect(data.task.investValidation).toMatchObject({
      overall: "warning",
      estimable: { status: "warning" },
    });
  });

  it("auto-validates plain markdown when the objective changes", async () => {
    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({
        objective: `## Summary
Refresh a story without canonical YAML.

## Acceptance Criteria
- The updated task stores an automatic INVEST snapshot.
- Reviewers can inspect warnings from the API.

## Dependencies
- None. This can start now.`,
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.task.investValidation).toMatchObject({
      overall: "warning",
      independent: { status: "pass" },
      negotiable: { status: "warning" },
      testable: { status: "pass" },
    });
  });
});
