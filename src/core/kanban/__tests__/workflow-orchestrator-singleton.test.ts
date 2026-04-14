import fs from "fs";
import os from "os";
import path from "path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  dispatchSessionPromptMock,
  triggerAssignedTaskAgentMock,
  getInternalApiOriginMock,
  createGitWorktreeMock,
} = vi.hoisted(() => ({
  dispatchSessionPromptMock: vi.fn(),
  triggerAssignedTaskAgentMock: vi.fn(),
  getInternalApiOriginMock: vi.fn(() => "http://localhost"),
  createGitWorktreeMock: vi.fn(),
}));

vi.mock("@/core/acp/session-prompt", () => ({
  dispatchSessionPrompt: dispatchSessionPromptMock,
}));

vi.mock("../agent-trigger", () => ({
  triggerAssignedTaskAgent: triggerAssignedTaskAgentMock,
  getInternalApiOrigin: getInternalApiOriginMock,
}));

vi.mock("../../git/git-worktree-service", () => ({
  GitWorktreeService: vi.fn(class {
    constructor(private worktreeStore: unknown) {}

    createWorktree = (codebaseId: string, options?: unknown) =>
      createGitWorktreeMock.call(this, codebaseId, options);
  }),
}));

import { createInMemorySystem } from "../../routa-system";
import { getHttpSessionStore } from "../../acp/http-session-store";
import {
  closeSqliteDatabase,
  ensureSqliteDefaultWorkspace,
  getSqliteDatabase,
} from "../../db/sqlite";
import {
  SqliteCodebaseStore,
  SqliteKanbanBoardStore,
  SqliteTaskStore,
  SqliteWorkspaceStore,
  SqliteWorktreeStore,
} from "../../db/sqlite-stores";
import { createCodebase } from "../../models/codebase";
import { createKanbanBoard } from "../../models/kanban";
import { createTask, TaskStatus } from "../../models/task";
import {
  enqueueKanbanTaskSession,
  getWorkflowOrchestrator,
  resetWorkflowOrchestrator,
  startWorkflowOrchestrator,
} from "../workflow-orchestrator-singleton";

describe("workflow orchestrator singleton prompt path", () => {
  beforeEach(() => {
    resetWorkflowOrchestrator();
    triggerAssignedTaskAgentMock.mockReset();
    getInternalApiOriginMock.mockReset();
    getInternalApiOriginMock.mockReturnValue("http://localhost");
    createGitWorktreeMock.mockReset();
  });

  afterEach(() => {
    resetWorkflowOrchestrator();
    dispatchSessionPromptMock.mockReset();
    closeSqliteDatabase();
    delete process.env.ROUTA_DB_DRIVER;
    delete process.env.ROUTA_DB_PATH;
  });

  it("sends recovery prompt via agent tools when routa agent session exists", async () => {
    const system = createInMemorySystem();
    const createAgentResult = await system.tools.createAgent({
      name: "watchdog-test-agent",
      role: "ROUTA",
      workspaceId: "default",
    });
    expect(createAgentResult.success).toBe(true);
    const sessionAgentId = (createAgentResult.data as { agentId: string }).agentId;
    const sessionId = "session-watchdog-tool-path";

    const sessionStore = getHttpSessionStore();
    sessionStore.upsertSession({
      sessionId,
      workspaceId: "default",
      cwd: "/tmp",
      routaAgentId: sessionAgentId,
      createdAt: new Date().toISOString(),
    });

    const readConversation = vi
      .spyOn(system.tools, "readAgentConversation")
      .mockResolvedValue({ success: true, data: { messages: [] } });
    const messageAgent = vi
      .spyOn(system.tools, "messageAgent")
      .mockResolvedValue({ success: true, data: { delivered: true } });

    startWorkflowOrchestrator(system);
    const orchestrator = getWorkflowOrchestrator(system);
    await (orchestrator as unknown as {
      notifyKanbanAgent: (params: {
        workspaceId: string;
        sessionId: string;
        cardId: string;
        cardTitle: string;
        boardId: string;
        columnId: string;
        reason: string;
        mode: "watchdog_retry";
      }) => Promise<void>;
    }).notifyKanbanAgent({
      workspaceId: "default",
      sessionId,
      cardId: "card-1",
      cardTitle: "Test card",
      boardId: "board-1",
      columnId: "dev",
      reason: "No activity for too long.",
      mode: "watchdog_retry",
    });

    expect(readConversation).toHaveBeenCalledWith({
      agentId: sessionAgentId,
      lastN: 5,
    });
    expect(messageAgent).toHaveBeenCalledWith({
      fromAgentId: sessionAgentId,
      toAgentId: sessionAgentId,
      message: expect.stringContaining(`acp session id = ${sessionId}`),
    });
    expect(dispatchSessionPromptMock).not.toHaveBeenCalled();
  });

  it("falls back to session/prompt when agent message fails", async () => {
    const system = createInMemorySystem();
    const createAgentResult = await system.tools.createAgent({
      name: "watchdog-fallback-agent",
      role: "ROUTA",
      workspaceId: "default",
    });
    const sessionAgentId = (createAgentResult.data as { agentId: string }).agentId;
    const sessionId = "session-watchdog-fallback-path";

    const sessionStore = getHttpSessionStore();
    sessionStore.upsertSession({
      sessionId,
      workspaceId: "default",
      cwd: "/tmp",
      routaAgentId: sessionAgentId,
      createdAt: new Date().toISOString(),
    });

    vi.spyOn(system.tools, "readAgentConversation").mockResolvedValue({ success: true, data: { messages: [] } });
    vi.spyOn(system.tools, "messageAgent").mockResolvedValue({ success: false, error: "temporary failure" });
    dispatchSessionPromptMock.mockResolvedValue(undefined);

    startWorkflowOrchestrator(system);
    const orchestrator = getWorkflowOrchestrator(system);
    await (orchestrator as unknown as {
      notifyKanbanAgent: (params: {
        workspaceId: string;
        sessionId: string;
        cardId: string;
        cardTitle: string;
        boardId: string;
        columnId: string;
        reason: string;
        mode: "watchdog_retry";
      }) => Promise<void>;
    }).notifyKanbanAgent({
      workspaceId: "default",
      sessionId,
      cardId: "card-1",
      cardTitle: "Test card",
      boardId: "board-1",
      columnId: "dev",
      reason: "No activity for too long.",
      mode: "watchdog_retry",
    });

    expect(dispatchSessionPromptMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      workspaceId: "default",
      prompt: [expect.objectContaining({ type: "text" })],
    }));
  });

  it("recreates a missing dev worktree before starting a new task session", async () => {
    const system = createInMemorySystem();
    const board = createKanbanBoard({
      id: "board-1",
      workspaceId: "default",
      name: "Board",
      isDefault: true,
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        { id: "dev", name: "Dev", position: 1, stage: "dev" },
      ],
    });
    await system.kanbanBoardStore.save(board);
    await system.codebaseStore.add(createCodebase({
      id: "repo-1",
      workspaceId: "default",
      repoPath: "/tmp/repos/main",
      branch: "main",
      isDefault: true,
    }));

    const task = createTask({
      id: "task-1",
      title: "Retry stale worktree",
      objective: "Recreate missing worktree before dev rerun",
      workspaceId: "default",
      boardId: board.id,
      columnId: "dev",
      status: TaskStatus.IN_PROGRESS,
      worktreeId: "wt-stale",
    });
    await system.taskStore.save(task);

    createGitWorktreeMock.mockResolvedValue({
      id: "wt-fresh",
      codebaseId: "repo-1",
      workspaceId: "default",
      worktreePath: "/tmp/worktrees/task-1",
      branch: "issue/task-1",
      baseBranch: "main",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    triggerAssignedTaskAgentMock.mockResolvedValue({
      sessionId: "session-dev-1",
      transport: "acp",
    });

    const result = await enqueueKanbanTaskSession(system, {
      task,
      expectedColumnId: "dev",
      ignoreExistingTrigger: true,
      bypassQueue: true,
    });

    expect(result).toEqual({ sessionId: "session-dev-1", queued: false, error: undefined });
    expect(createGitWorktreeMock).toHaveBeenCalledWith("repo-1", expect.objectContaining({
      branch: "issue/task-1",
      baseBranch: "main",
    }));
    const updatedTask = await system.taskStore.get("task-1");
    expect(updatedTask).toMatchObject({
      worktreeId: "wt-fresh",
      triggerSessionId: "session-dev-1",
    });
  });

  it("recreates missing worktrees schema for sqlite dev sessions and persists the new worktree record", async () => {
    const dbPath = path.join(os.tmpdir(), `routa-workflow-sqlite-${Date.now()}.db`);
    process.env.ROUTA_DB_DRIVER = "sqlite";
    process.env.ROUTA_DB_PATH = dbPath;
    closeSqliteDatabase();

    try {
      getSqliteDatabase(dbPath);
      closeSqliteDatabase();

      const legacy = new BetterSqlite3(dbPath);
      legacy.exec("DROP TABLE worktrees");
      legacy.close();

      const db = getSqliteDatabase(dbPath);
      ensureSqliteDefaultWorkspace();

      const system = createInMemorySystem();
      system.workspaceStore = new SqliteWorkspaceStore(db);
      system.codebaseStore = new SqliteCodebaseStore(db);
      system.worktreeStore = new SqliteWorktreeStore(db);
      system.taskStore = new SqliteTaskStore(db);
      system.kanbanBoardStore = new SqliteKanbanBoardStore(db);
      system.isPersistent = true;

      const board = createKanbanBoard({
        id: "board-sqlite",
        workspaceId: "default",
        name: "SQLite Board",
        isDefault: true,
        columns: [
          { id: "todo", name: "Todo", position: 0, stage: "todo" },
          { id: "dev", name: "Dev", position: 1, stage: "dev" },
        ],
      });
      await system.kanbanBoardStore.save(board);
      await system.codebaseStore.add(createCodebase({
        id: "repo-sqlite",
        workspaceId: "default",
        repoPath: "/tmp/repos/sqlite-main",
        branch: "main",
        isDefault: true,
      }));

      const task = createTask({
        id: "task-sqlite",
        title: "Recover legacy sqlite worktree",
        objective: "Ensure dev entry writes worktree rows after legacy upgrade",
        workspaceId: "default",
        boardId: board.id,
        columnId: "dev",
        status: TaskStatus.IN_PROGRESS,
      });
      await system.taskStore.save(task);

      createGitWorktreeMock.mockImplementation(async function (
        this: {
          worktreeStore: {
            add(worktree: {
              id: string;
              codebaseId: string;
              workspaceId: string;
              worktreePath: string;
              branch: string;
              baseBranch: string;
              status: string;
              createdAt: Date;
              updatedAt: Date;
            }): Promise<void>;
          };
        },
        codebaseId: string,
        options?: { branch?: string; baseBranch?: string },
      ) {
        const worktree = {
          id: "wt-sqlite",
          codebaseId,
          workspaceId: "default",
          worktreePath: "/tmp/worktrees/task-sqlite",
          branch: options?.branch ?? "issue/task-sqlite",
          baseBranch: options?.baseBranch ?? "main",
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await this.worktreeStore.add(worktree);
        return worktree;
      });
      triggerAssignedTaskAgentMock.mockResolvedValue({
        sessionId: "session-sqlite-1",
        transport: "acp",
      });

      const result = await enqueueKanbanTaskSession(system, {
        task,
        expectedColumnId: "dev",
        ignoreExistingTrigger: true,
        bypassQueue: true,
      });

      expect(result).toEqual({ sessionId: "session-sqlite-1", queued: false, error: undefined });
      const updatedTask = await system.taskStore.get("task-sqlite");
      expect(updatedTask).toMatchObject({
        worktreeId: "wt-sqlite",
        triggerSessionId: "session-sqlite-1",
        columnId: "dev",
        status: TaskStatus.IN_PROGRESS,
      });
      expect(updatedTask?.lastSyncError).toBeUndefined();
      expect(updatedTask?.laneSessions.at(-1)).toMatchObject({
        sessionId: "session-sqlite-1",
        worktreeId: "wt-sqlite",
        cwd: "/tmp/worktrees/task-sqlite",
      });

      const persistedWorktree = await system.worktreeStore.get("wt-sqlite");
      expect(persistedWorktree).toMatchObject({
        id: "wt-sqlite",
        codebaseId: "repo-sqlite",
        sessionId: "session-sqlite-1",
        branch: expect.stringMatching(/^issue\/task-sql/),
        worktreePath: "/tmp/worktrees/task-sqlite",
      });
    } finally {
      closeSqliteDatabase();
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
    }
  });
});
