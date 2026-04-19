import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  dispatchSessionPromptMock,
  triggerAssignedTaskAgentMock,
  getInternalApiOriginMock,
  createGitWorktreeMock,
  fetchRemoteMock,
  getRepoStatusMock,
} = vi.hoisted(() => ({
  dispatchSessionPromptMock: vi.fn(),
  triggerAssignedTaskAgentMock: vi.fn(),
  getInternalApiOriginMock: vi.fn(() => "http://localhost"),
  createGitWorktreeMock: vi.fn(),
  fetchRemoteMock: vi.fn(() => true),
  getRepoStatusMock: vi.fn(() => ({ clean: true, ahead: 0, behind: 0, modified: 0, untracked: 0 })),
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
    createWorktree = createGitWorktreeMock;
  }),
}));

vi.mock("../../git/git-utils", () => ({
  fetchRemote: fetchRemoteMock,
  getRepoStatus: getRepoStatusMock,
}));

import { createInMemorySystem } from "../../routa-system";
import { getHttpSessionStore } from "../../acp/http-session-store";
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
    fetchRemoteMock.mockReset();
    fetchRemoteMock.mockReturnValue(true);
    getRepoStatusMock.mockReset();
    getRepoStatusMock.mockReturnValue({ clean: true, ahead: 0, behind: 0, modified: 0, untracked: 0 });
  });

  afterEach(() => {
    resetWorkflowOrchestrator();
    dispatchSessionPromptMock.mockReset();
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
      baseBranch: "main",
    }));
    const updatedTask = await system.taskStore.get("task-1");
    expect(updatedTask).toMatchObject({
      worktreeId: "wt-fresh",
      triggerSessionId: "session-dev-1",
    });
  });
});
