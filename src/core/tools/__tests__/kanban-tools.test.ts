import { afterEach, describe, expect, it, vi } from "vitest";
import { createKanbanBoard } from "../../models/kanban";
import { EventBus, AgentEventType } from "../../events/event-bus";
import { createTask, VerificationVerdict } from "../../models/task";
import { createInMemorySystem } from "../../routa-system";
import { resetWorkflowOrchestrator } from "../../kanban/workflow-orchestrator-singleton";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { KanbanTools } from "../kanban-tools";

const isGitRepository = vi.fn();
const isBareGitRepository = vi.fn();
const getRepoDeliveryStatus = vi.fn();
const getRepoCommitChanges = vi.fn();
const getRepoRefSha = vi.fn();

vi.mock("@/core/git", () => ({
  isGitRepository: (...args: unknown[]) => isGitRepository(...args),
  isBareGitRepository: (...args: unknown[]) => isBareGitRepository(...args),
  getRepoDeliveryStatus: (...args: unknown[]) => getRepoDeliveryStatus(...args),
  getRepoCommitChanges: (...args: unknown[]) => getRepoCommitChanges(...args),
  getRepoRefSha: (...args: unknown[]) => getRepoRefSha(...args),
}));

vi.mock("@/core/git/git-utils", () => ({
  getRepoCommitChanges: (...args: unknown[]) => getRepoCommitChanges(...args),
  getRepoRefSha: (...args: unknown[]) => getRepoRefSha(...args),
}));

describe("KanbanTools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    isGitRepository.mockReset();
    isBareGitRepository.mockReset();
    getRepoDeliveryStatus.mockReset();
    getRepoCommitChanges.mockReset();
    getRepoRefSha.mockReset();
    globalThis.fetch = originalFetch;
    resetWorkflowOrchestrator();
  });
  it("creates a card on the default board when boardId is omitted", async () => {
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const tools = new KanbanTools(boardStore, taskStore);

    const board = createKanbanBoard({
      id: "board-1",
      workspaceId: "default",
      name: "Default Board",
      isDefault: true,
    });
    await boardStore.save(board);

    const result = await tools.createCard({
      workspaceId: "default",
      title: "Created without board id",
      columnId: "backlog",
    });

    expect(result.success).toBe(true);
    const tasks = await taskStore.listByWorkspace("default");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: "Created without board id",
      boardId: "board-1",
      columnId: "backlog",
    });
  });

  it("persists an assigned provider override on created cards", async () => {
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const tools = new KanbanTools(boardStore, taskStore);

    const board = createKanbanBoard({
      id: "board-1",
      workspaceId: "default",
      name: "Default Board",
      isDefault: true,
    });
    await boardStore.save(board);

    const result = await tools.createCard({
      workspaceId: "default",
      title: "Created with Codex",
      columnId: "backlog",
      assignedProvider: "codex",
    });

    expect(result.success).toBe(true);
    const tasks = await taskStore.listByWorkspace("default");
    expect(tasks[0]).toMatchObject({
      title: "Created with Codex",
      assignedProvider: "codex",
    });
  });

  it("lists cards by column on the default board when boardId is omitted", async () => {
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const tools = new KanbanTools(boardStore, taskStore);

    const board = createKanbanBoard({
      id: "board-1",
      workspaceId: "default",
      name: "Default Board",
      isDefault: true,
    });
    await boardStore.save(board);

    await tools.createCard({
      workspaceId: "default",
      title: "Backlog card",
      columnId: "backlog",
    });

    const result = await tools.listCardsByColumn("backlog", undefined, "default");

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      columnId: "backlog",
      cards: [{ title: "Backlog card" }],
    });
  });

  it("enqueues backlog automation immediately after createCard when attached to a Routa system", async () => {
    const system = createInMemorySystem();
    const tools = new KanbanTools(system.kanbanBoardStore, system.taskStore);
    tools.setEventBus(system.eventBus);
    tools.setAutomationSystem(system);

    const board = createKanbanBoard({
      id: "board-1",
      workspaceId: "default",
      name: "Default Board",
      isDefault: true,
      columns: [
        {
          id: "backlog",
          name: "Backlog",
          position: 0,
          stage: "backlog",
          automation: {
            enabled: true,
            transitionType: "entry",
            providerId: "claude",
            role: "CRAFTER",
            specialistId: "kanban-backlog-refiner",
            specialistName: "Backlog Refiner",
            steps: [{
              id: "step-1",
              providerId: "claude",
              role: "CRAFTER",
              specialistId: "kanban-backlog-refiner",
              specialistName: "Backlog Refiner",
            }],
          },
        },
      ],
    });
    await system.kanbanBoardStore.save(board);
    await system.kanbanBoardStore.setDefault("default", board.id);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: { sessionId: "session-backlog-1" },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await tools.createCard({
      workspaceId: "default",
      title: "Auto-start backlog card",
      description: "Probe automation bootstrap",
      columnId: "backlog",
    });

    expect(result.success).toBe(true);
    const tasks = await system.taskStore.listByWorkspace("default");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: "Auto-start backlog card",
      columnId: "backlog",
      triggerSessionId: "session-backlog-1",
    });
    expect(tasks[0].sessionIds).toContain("session-backlog-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/acp"),
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("requests a handoff from the previous lane session", async () => {
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const tools = new KanbanTools(boardStore, taskStore);

    const board = createKanbanBoard({
      id: "board-1",
      workspaceId: "default",
      name: "Default Board",
      isDefault: true,
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        { id: "dev", name: "Dev", position: 1, stage: "dev" },
        { id: "review", name: "Review", position: 2, stage: "review" },
      ],
    });
    await boardStore.save(board);

    const task = createTask({
      id: "task-1",
      title: "Review login flow",
      objective: "Verify the login flow in review",
      workspaceId: "default",
      boardId: board.id,
      columnId: "review",
    });
    task.laneSessions = [
      {
        sessionId: "session-dev-1",
        columnId: "dev",
        columnName: "Dev",
        provider: "opencode",
        role: "DEVELOPER",
        status: "completed",
        startedAt: "2026-03-17T00:00:00.000Z",
      },
      {
        sessionId: "session-review-1",
        columnId: "review",
        columnName: "Review",
        provider: "opencode",
        role: "GATE",
        status: "running",
        startedAt: "2026-03-17T00:10:00.000Z",
      },
    ];
    await taskStore.save(task);

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await tools.requestPreviousLaneHandoff({
      taskId: task.id,
      requestType: "environment_preparation",
      request: "Start the app and share the local URL.",
      sessionId: "session-review-1",
    });

    expect(result.success).toBe(true);
    const savedTask = await taskStore.get(task.id);
    expect(savedTask?.laneHandoffs[0]).toMatchObject({
      status: "delivered",
      toSessionId: "session-dev-1",
      requestType: "environment_preparation",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns review to dev on a not-approved handoff and persists worktree context", async () => {
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const tools = new KanbanTools(boardStore, taskStore);
    const eventBus = new EventBus();
    tools.setEventBus(eventBus);

    const transitionEvents: Array<{ fromColumnId: string; toColumnId: string }> = [];
    eventBus.on("test-review-return", (event) => {
      if (event.type === AgentEventType.COLUMN_TRANSITION) {
        transitionEvents.push(event.data as { fromColumnId: string; toColumnId: string });
      }
    });

    const board = createKanbanBoard({
      id: "board-1",
      workspaceId: "default",
      name: "Default Board",
      isDefault: true,
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        { id: "dev", name: "Dev", position: 1, stage: "dev" },
        { id: "review", name: "Review", position: 2, stage: "review" },
      ],
    });
    await boardStore.save(board);

    const task = createTask({
      id: "task-review-return",
      title: "Review returns to dev",
      objective: "Keep the original worktree on re-entry",
      workspaceId: "default",
      boardId: board.id,
      columnId: "review",
      worktreeId: "wt-1",
    });
    task.verificationVerdict = VerificationVerdict.NOT_APPROVED;
    task.triggerSessionId = "session-review-1";
    task.laneSessions = [
      {
        sessionId: "session-dev-1",
        worktreeId: "wt-1",
        cwd: "/tmp/worktrees/task-review-return",
        columnId: "dev",
        columnName: "Dev",
        provider: "opencode",
        role: "DEVELOPER",
        status: "completed",
        startedAt: "2026-03-17T00:00:00.000Z",
      },
      {
        sessionId: "session-review-1",
        columnId: "review",
        columnName: "Review",
        provider: "opencode",
        role: "GATE",
        status: "running",
        startedAt: "2026-03-17T00:10:00.000Z",
      },
    ];
    await taskStore.save(task);

    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

    const result = await tools.requestPreviousLaneHandoff({
      taskId: task.id,
      requestType: "runtime_context",
      request: "Reuse the existing app process and share the URL.",
      sessionId: "session-review-1",
    });

    expect(result.success).toBe(true);
    const savedTask = await taskStore.get(task.id);
    expect(savedTask).toMatchObject({
      columnId: "dev",
      status: "IN_PROGRESS",
      worktreeId: "wt-1",
      triggerSessionId: undefined,
    });
    expect(savedTask?.laneHandoffs[0]).toMatchObject({
      status: "delivered",
      worktreeId: "wt-1",
      cwd: "/tmp/worktrees/task-review-return",
      toColumnId: "dev",
    });
    expect(transitionEvents).toEqual([
      expect.objectContaining({
        fromColumnId: "review",
        toColumnId: "dev",
      }),
    ]);
  });

  it("submits a lane handoff response back to the requesting session", async () => {
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const tools = new KanbanTools(boardStore, taskStore);

    const task = createTask({
      id: "task-2",
      title: "Prepare review environment",
      objective: "Support review with runtime context",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "review",
    });
    task.laneHandoffs = [
      {
        id: "handoff-1",
        fromSessionId: "session-review-1",
        toSessionId: "session-dev-1",
        fromColumnId: "review",
        toColumnId: "dev",
        requestType: "runtime_context",
        request: "Seed demo data and confirm the route.",
        status: "delivered",
        requestedAt: "2026-03-17T00:00:00.000Z",
      },
    ];
    await taskStore.save(task);

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await tools.submitLaneHandoff({
      taskId: task.id,
      handoffId: "handoff-1",
      status: "completed",
      summary: "Service is running on http://127.0.0.1:3000 with seeded demo data.",
      sessionId: "session-dev-1",
    });

    expect(result.success).toBe(true);
    const savedTask = await taskStore.get(task.id);
    expect(savedTask?.laneHandoffs[0]).toMatchObject({
      status: "completed",
      responseSummary: "Service is running on http://127.0.0.1:3000 with seeded demo data.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records a deterministic failed handoff when the previous session is unavailable", async () => {
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const tools = new KanbanTools(boardStore, taskStore);

    const board = createKanbanBoard({
      id: "board-1",
      workspaceId: "default",
      name: "Default Board",
      isDefault: true,
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        { id: "dev", name: "Dev", position: 1, stage: "dev" },
        { id: "review", name: "Review", position: 2, stage: "review" },
      ],
    });
    await boardStore.save(board);

    const task = createTask({
      id: "task-3",
      title: "Review signup flow",
      objective: "Review signup flow in review",
      workspaceId: "default",
      boardId: board.id,
      columnId: "review",
    });
    task.laneSessions = [
      {
        sessionId: "session-dev-1",
        columnId: "dev",
        columnName: "Dev",
        provider: "opencode",
        role: "DEVELOPER",
        status: "completed",
        startedAt: "2026-03-17T00:00:00.000Z",
      },
      {
        sessionId: "session-review-1",
        columnId: "review",
        columnName: "Review",
        provider: "opencode",
        role: "GATE",
        status: "running",
        startedAt: "2026-03-17T00:10:00.000Z",
      },
    ];
    await taskStore.save(task);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      body: null,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response) as typeof fetch;

    const result = await tools.requestPreviousLaneHandoff({
      taskId: task.id,
      requestType: "runtime_context",
      request: "Share the seeded test account and local URL.",
      sessionId: "session-review-1",
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      status: "failed",
      targetSessionId: "session-dev-1",
    });

    const savedTask = await taskStore.get(task.id);
    expect(savedTask?.laneHandoffs[0]).toMatchObject({
      status: "failed",
      respondedAt: expect.any(String),
    });
    expect(savedTask?.laneHandoffs[0].responseSummary).toContain("Unable to deliver handoff request");
  });

  it("blocks cross-column moves while the current lane still has a later automation step pending", async () => {
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const tools = new KanbanTools(boardStore, taskStore);

    const board = createKanbanBoard({
      id: "board-multistep-1",
      workspaceId: "default",
      name: "Default Board",
      isDefault: true,
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
    await boardStore.save(board);

    const task = createTask({
      id: "task-multistep-1",
      title: "Run todo pipeline",
      objective: "Complete todo before dev",
      workspaceId: "default",
      boardId: board.id,
      columnId: "todo",
      triggerSessionId: "session-todo-1",
      assignedProvider: "codex",
      assignedRole: "CRAFTER",
      assignedSpecialistId: "kanban-todo-orchestrator",
      assignedSpecialistName: "Todo Orchestrator",
    });
    task.laneSessions = [
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
    await taskStore.save(task);

    const result = await tools.moveCard({
      cardId: task.id,
      targetColumnId: "dev",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Todo Orchestrator");
    expect(result.error).toContain("Verifier");

    const savedTask = await taskStore.get(task.id);
    expect(savedTask).toMatchObject({
      columnId: "todo",
      triggerSessionId: "session-todo-1",
    });
  });

  it("rejects description updates from dev onward and tells the agent to use comment", async () => {
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const tools = new KanbanTools(boardStore, taskStore);

    const board = createKanbanBoard({
      id: "board-1",
      workspaceId: "default",
      name: "Default Board",
      isDefault: true,
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        { id: "todo", name: "Todo", position: 1, stage: "todo" },
        { id: "dev", name: "Dev", position: 2, stage: "dev" },
      ],
    });
    await boardStore.save(board);

    await taskStore.save(createTask({
      id: "task-dev-1",
      title: "Frozen story",
      objective: "Original description",
      workspaceId: "default",
      boardId: board.id,
      columnId: "dev",
    }));

    const result = await tools.updateCard({
      cardId: "task-dev-1",
      description: "Rewrite the story in dev",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("description is frozen");
    expect(result.error).toContain("comment field instead");
  });

  it("blocks moving a backlog card into todo when canonical YAML is missing", async () => {
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const tools = new KanbanTools(boardStore, taskStore);

    const board = createKanbanBoard({
      id: "board-contract-gate",
      workspaceId: "default",
      name: "Default Board",
      isDefault: true,
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        {
          id: "todo",
          name: "Todo",
          position: 1,
          stage: "todo",
          automation: {
            enabled: true,
            contractRules: {
              requireCanonicalStory: true,
              loopBreakerThreshold: 2,
            },
          },
        },
      ],
    });
    await boardStore.save(board);

    const task = createTask({
      id: "task-contract-move",
      title: "Missing canonical contract",
      objective: "Only prose here",
      workspaceId: "default",
      boardId: board.id,
      columnId: "backlog",
    });
    await taskStore.save(task);

    const result = await tools.moveCard({
      cardId: task.id,
      targetColumnId: "todo",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Canonical story YAML is missing");

    const savedTask = await taskStore.get(task.id);
    expect(savedTask?.columnId).toBe("backlog");
    expect(savedTask?.comments.at(-1)?.body).toContain("Contract gate blocked:");
  });

  it("breaks the contract retry loop after repeated invalid description updates", async () => {
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const tools = new KanbanTools(boardStore, taskStore);

    const board = createKanbanBoard({
      id: "board-contract-update",
      workspaceId: "default",
      name: "Default Board",
      isDefault: true,
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        {
          id: "todo",
          name: "Todo",
          position: 1,
          stage: "todo",
          automation: {
            enabled: true,
            contractRules: {
              requireCanonicalStory: true,
              loopBreakerThreshold: 2,
            },
          },
        },
      ],
    });
    await boardStore.save(board);

    const task = createTask({
      id: "task-contract-update",
      title: "Malformed canonical contract",
      objective: "Initial prose",
      workspaceId: "default",
      boardId: board.id,
      columnId: "backlog",
    });
    await taskStore.save(task);

    const first = await tools.updateCard({
      cardId: task.id,
      description: "```yaml\nstory: [broken\n```",
      sessionId: "session-contract-1",
    });
    expect(first.success).toBe(false);

    const second = await tools.updateCard({
      cardId: task.id,
      description: "```yaml\nstory: [broken-again\n```",
      sessionId: "session-contract-2",
    });
    expect(second.success).toBe(false);
    expect(second.error).toContain("canonical story YAML is invalid");

    const savedTask = await taskStore.get(task.id);
    expect(savedTask?.labels).toContain("contract-gate-blocked");
    expect(savedTask?.lastSyncError).toContain("Stopped automatic retries for \"Todo\"");
    expect(savedTask?.comments.filter((entry) => entry.body.startsWith("Contract gate blocked:"))).toHaveLength(2);
  });

  it("blocks dev to review moves without committed changes and records the reason on the task", async () => {
    const system = createInMemorySystem();
    const tools = new KanbanTools(system.kanbanBoardStore, system.taskStore);
    tools.setAutomationSystem(system);

    const board = createKanbanBoard({
      id: "board-review-gate",
      workspaceId: "default",
      name: "Default Board",
      isDefault: true,
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        { id: "todo", name: "Todo", position: 1, stage: "todo" },
        { id: "dev", name: "Dev", position: 2, stage: "dev" },
        {
          id: "review",
          name: "Review",
          position: 3,
          stage: "review",
          automation: {
            enabled: true,
            deliveryRules: {
              requireCommittedChanges: true,
              requireCleanWorktree: true,
            },
          },
        },
      ],
    });
    await system.kanbanBoardStore.save(board);

    const task = createTask({
      id: "task-review-gate",
      title: "Need a commit before review",
      objective: "Implement the feature and request review",
      workspaceId: "default",
      boardId: board.id,
      columnId: "dev",
      triggerSessionId: "session-dev-gate",
      codebaseIds: ["codebase-1"],
    });
    await system.taskStore.save(task);

    vi.spyOn(system.codebaseStore, "get").mockResolvedValue({
      id: "codebase-1",
      workspaceId: "default",
      repoPath: "/repo/project",
      branch: "main",
      label: "project",
      sourceType: "github",
      sourceUrl: "https://github.com/acme/project",
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    isGitRepository.mockReturnValue(true);
    isBareGitRepository.mockReturnValue(false);
    getRepoDeliveryStatus.mockReturnValue({
      branch: "feature/task-review-gate",
      baseBranch: "main",
      baseRef: "origin/main",
      status: {
        clean: true,
        ahead: 0,
        behind: 0,
        modified: 0,
        untracked: 0,
      },
      commitsSinceBase: 0,
      hasCommitsSinceBase: false,
      hasUncommittedChanges: false,
      remoteUrl: "git@github.com:acme/project.git",
      isGitHubRepo: true,
      canCreatePullRequest: true,
    });

    const result = await tools.moveCard({
      cardId: task.id,
      targetColumnId: "review",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("no committed changes detected");

    const savedTask = await system.taskStore.get(task.id);
    expect(savedTask?.columnId).toBe("dev");
    expect(savedTask?.comments.at(-1)?.body).toContain("Move blocked:");
    expect(savedTask?.comments.at(-1)?.body).toContain("no committed changes detected");
  });

  it("captures delivery commit evidence when move_card advances a task to review", async () => {
    const system = createInMemorySystem();
    const tools = new KanbanTools(system.kanbanBoardStore, system.taskStore);
    tools.setAutomationSystem(system);

    const board = createKanbanBoard({
      id: "board-delivery-snapshot",
      workspaceId: "default",
      name: "Default Board",
      isDefault: true,
      columns: [
        { id: "dev", name: "Dev", position: 0, stage: "dev" },
        {
          id: "review",
          name: "Review",
          position: 1,
          stage: "review",
          automation: {
            enabled: true,
            deliveryRules: {
              requireCommittedChanges: true,
              requireCleanWorktree: true,
            },
          },
        },
      ],
    });
    await system.kanbanBoardStore.save(board);

    const task = createTask({
      id: "task-delivery-snapshot",
      title: "Capture delivered commit",
      objective: "Keep the commit visible after PR merge",
      workspaceId: "default",
      boardId: board.id,
      columnId: "dev",
      codebaseIds: ["codebase-1"],
    });
    await system.taskStore.save(task);

    vi.spyOn(system.codebaseStore, "get").mockResolvedValue({
      id: "codebase-1",
      workspaceId: "default",
      repoPath: "/repo/project",
      branch: "main",
      label: "project",
      sourceType: "github",
      sourceUrl: "https://github.com/acme/project",
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    isGitRepository.mockReturnValue(true);
    isBareGitRepository.mockReturnValue(false);
    getRepoDeliveryStatus.mockReturnValue({
      branch: "feature/task-delivery-snapshot",
      baseBranch: "main",
      baseRef: "origin/main",
      status: {
        clean: true,
        ahead: 1,
        behind: 0,
        modified: 0,
        untracked: 0,
      },
      commitsSinceBase: 1,
      hasCommitsSinceBase: true,
      hasUncommittedChanges: false,
      remoteUrl: "git@github.com:acme/project.git",
      isGitHubRepo: true,
      canCreatePullRequest: true,
    });
    getRepoRefSha.mockImplementation((_repoPath: string, ref: string) => {
      if (ref === "origin/main") return "base-sha";
      if (ref === "HEAD") return "head-sha";
      return null;
    });
    getRepoCommitChanges.mockReturnValue([{
      sha: "head-sha",
      shortSha: "head123",
      summary: "implement kanban delivery",
      authorName: "Routa",
      authoredAt: "2026-04-09T00:00:00.000Z",
      additions: 4,
      deletions: 1,
    }]);

    const result = await tools.moveCard({
      cardId: task.id,
      targetColumnId: "review",
    });

    expect(result.success).toBe(true);
    const savedTask = await system.taskStore.get(task.id);
    expect(savedTask?.deliverySnapshot).toMatchObject({
      repoPath: "/repo/project",
      baseRef: "origin/main",
      baseSha: "base-sha",
      headSha: "head-sha",
      source: "review_transition",
      commits: [{
        sha: "head-sha",
        summary: "implement kanban delivery",
      }],
    });
  });

  it("blocks review to done moves with uncommitted changes", async () => {
    const system = createInMemorySystem();
    const tools = new KanbanTools(system.kanbanBoardStore, system.taskStore);
    tools.setAutomationSystem(system);

    const board = createKanbanBoard({
      id: "board-done-gate",
      workspaceId: "default",
      name: "Default Board",
      isDefault: true,
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        { id: "todo", name: "Todo", position: 1, stage: "todo" },
        { id: "dev", name: "Dev", position: 2, stage: "dev" },
        { id: "review", name: "Review", position: 3, stage: "review" },
        {
          id: "done",
          name: "Done",
          position: 4,
          stage: "done",
          automation: {
            enabled: true,
            deliveryRules: {
              requireCommittedChanges: true,
              requireCleanWorktree: true,
              requirePullRequestReady: true,
            },
          },
        },
      ],
    });
    await system.kanbanBoardStore.save(board);

    const task = createTask({
      id: "task-done-gate",
      title: "Need clean working tree before done",
      objective: "Ship the feature cleanly",
      workspaceId: "default",
      boardId: board.id,
      columnId: "review",
      triggerSessionId: "session-review-gate",
      codebaseIds: ["codebase-1"],
    });
    await system.taskStore.save(task);

    vi.spyOn(system.codebaseStore, "get").mockResolvedValue({
      id: "codebase-1",
      workspaceId: "default",
      repoPath: "/repo/project",
      branch: "main",
      label: "project",
      sourceType: "github",
      sourceUrl: "https://github.com/acme/project",
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    isGitRepository.mockReturnValue(true);
    isBareGitRepository.mockReturnValue(false);
    getRepoDeliveryStatus.mockReturnValue({
      branch: "feature/task-done-gate",
      baseBranch: "main",
      baseRef: "origin/main",
      status: {
        clean: false,
        ahead: 1,
        behind: 0,
        modified: 2,
        untracked: 1,
      },
      commitsSinceBase: 1,
      hasCommitsSinceBase: true,
      hasUncommittedChanges: true,
      remoteUrl: "git@github.com:acme/project.git",
      isGitHubRepo: true,
      canCreatePullRequest: true,
    });

    const result = await tools.moveCard({
      cardId: task.id,
      targetColumnId: "done",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("uncommitted changes");
    expect(result.error).toContain("before marking the task done");

    const savedTask = await system.taskStore.get(task.id);
    expect(savedTask?.columnId).toBe("review");
  });

  it("appends update_card comment notes without rewriting the story description", async () => {
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const tools = new KanbanTools(boardStore, taskStore);

    const task = createTask({
      id: "task-review-1",
      title: "Review note trail",
      objective: "Stable story body",
      comment: "Initial note",
      workspaceId: "default",
      columnId: "review",
    });
    await taskStore.save(task);

    const result = await tools.updateCard({
      cardId: task.id,
      comment: "Second note",
      agentId: "agent-review-1",
      sessionId: "session-review-1",
    });

    expect(result.success).toBe(true);
    const saved = await taskStore.get(task.id);
    expect(saved?.objective).toBe("Stable story body");
    expect(saved?.comment).toBe("Initial note\n\nSecond note");
    expect(saved?.comments).toHaveLength(2);
    expect(saved?.comments.map((entry) => entry.body)).toEqual(["Initial note", "Second note"]);
    expect(saved?.comments[1]?.source).toBe("update_card");
    expect(saved?.comments[1]?.agentId).toBe("agent-review-1");
    expect(saved?.comments[1]?.sessionId).toBe("session-review-1");
    expect(result.data).toMatchObject({
      comment: "Initial note\n\nSecond note",
      comments: [
        { body: "Initial note", source: "legacy_import" },
        {
          body: "Second note",
          source: "update_card",
          agentId: "agent-review-1",
          sessionId: "session-review-1",
        },
      ],
    });
  });

  it("backfills legacy concatenated comments into multiple notes before appending", async () => {
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const tools = new KanbanTools(boardStore, taskStore);

    const task = createTask({
      id: "task-review-legacy",
      title: "Legacy note trail",
      objective: "Stable story body",
      comment: "Initial note\n\nSecond note",
      comments: [],
      workspaceId: "default",
      columnId: "review",
    });
    await taskStore.save(task);

    const result = await tools.updateCard({
      cardId: task.id,
      comment: "Third note",
    });

    expect(result.success).toBe(true);
    const saved = await taskStore.get(task.id);
    expect(saved?.comments.map((entry) => entry.body)).toEqual([
      "Initial note\n\nSecond note",
      "Third note",
    ]);
  });
});
