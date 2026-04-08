import { afterEach, describe, expect, it, vi } from "vitest";
import { createKanbanBoard } from "../../models/kanban";
import { createTask } from "../../models/task";
import { createInMemorySystem } from "../../routa-system";
import { resetWorkflowOrchestrator } from "../../kanban/workflow-orchestrator-singleton";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { KanbanTools } from "../kanban-tools";

describe("KanbanTools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
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
