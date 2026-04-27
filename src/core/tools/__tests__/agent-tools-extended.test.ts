/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { EventBus } from "../../events/event-bus";
import { AgentRole, AgentStatus, ModelTier, createAgent } from "../../models/agent";
import { MessageRole, createMessage } from "../../models/message";
import { TaskStatus, createTask } from "../../models/task";
import { InMemoryAgentStore } from "../../store/agent-store";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryConversationStore } from "../../store/conversation-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { AgentTools } from "../agent-tools";
import { createKanbanBoard } from "../../models/kanban";

describe("AgentTools extended coverage", () => {
  let tools: AgentTools;
  let agentStore: InMemoryAgentStore;
  let conversationStore: InMemoryConversationStore;
  let taskStore: InMemoryTaskStore;
  let kanbanBoardStore: InMemoryKanbanBoardStore;
  let eventBus: EventBus;

  beforeEach(() => {
    agentStore = new InMemoryAgentStore();
    conversationStore = new InMemoryConversationStore();
    taskStore = new InMemoryTaskStore();
    kanbanBoardStore = new InMemoryKanbanBoardStore();
    eventBus = new EventBus();
    tools = new AgentTools(agentStore, conversationStore, taskStore, eventBus);
    tools.setKanbanBoardStore(kanbanBoardStore);
  });

  it("creates agents, lists them, and rejects invalid roles", async () => {
    const invalid = await tools.createAgent({
      name: "Broken",
      role: "unknown",
      workspaceId: "ws-1",
    });
    expect(invalid.success).toBe(false);
    expect(invalid.error).toContain("Invalid role");

    const created = await tools.createAgent({
      name: "Verifier",
      role: "gate",
      workspaceId: "ws-1",
      modelTier: "fast",
      metadata: { specialist: "gate" },
    });
    expect(created.success).toBe(true);

    const listed = await tools.listAgents("ws-1");
    expect(listed.data).toEqual([
      expect.objectContaining({
        name: "Verifier",
        role: AgentRole.GATE,
        modelTier: ModelTier.FAST,
        metadata: { specialist: "gate" },
      }),
    ]);
  });

  it("delegates tasks with helpful hints and wakes existing task agents", async () => {
    const agent = createAgent({
      id: "agent-1",
      name: "Crafter",
      role: AgentRole.CRAFTER,
      workspaceId: "ws-1",
      modelTier: ModelTier.SMART,
      metadata: {},
    });
    await agentStore.save(agent);

    const missingTask = await tools.delegate({
      agentId: "agent-1",
      taskId: "frontend task",
      callerAgentId: "caller-1",
    });
    expect(missingTask.success).toBe(false);
    expect(missingTask.error).toContain('The taskId "frontend task" looks like a task name');

    const task = createTask({
      id: "task-1",
      title: "Implement feature",
      objective: "Build feature",
      workspaceId: "ws-1",
      position: 0,
      labels: [],
    });
    task.assignedTo = "agent-1";
    task.status = TaskStatus.PENDING;
    await taskStore.save(task);

    const woken = await tools.wakeOrCreateTaskAgent({
      taskId: "task-1",
      contextMessage: "Please continue implementation",
      callerAgentId: "caller-1",
      workspaceId: "ws-1",
    });

    expect(woken).toEqual({
      success: true,
      data: {
        agentId: "agent-1",
        action: "woken",
        name: "Crafter",
      },
    });
    expect((await taskStore.get("task-1"))?.assignedTo).toBe("agent-1");
  });

  it("reports to parent, updates task state, and summarizes agent activity", async () => {
    const parent = createAgent({
      id: "parent-1",
      name: "Lead",
      role: AgentRole.ROUTA,
      workspaceId: "ws-1",
      modelTier: ModelTier.SMART,
      metadata: {},
    });
    const child = createAgent({
      id: "child-1",
      name: "Crafter",
      role: AgentRole.CRAFTER,
      workspaceId: "ws-1",
      parentId: "parent-1",
      modelTier: ModelTier.BALANCED,
      metadata: {},
    });
    await agentStore.save(parent);
    await agentStore.save(child);

    const task = createTask({
      id: "task-2",
      title: "Ship fix",
      objective: "Finish the bug fix",
      workspaceId: "ws-1",
      position: 0,
      labels: [],
    });
    task.assignedTo = "child-1";
    task.status = TaskStatus.IN_PROGRESS;
    await taskStore.save(task);

    await conversationStore.append(
      createMessage({
        id: "msg-1",
        agentId: "child-1",
        role: MessageRole.ASSISTANT,
        content: "Implemented the fix and verified it locally.",
      }),
    );
    await conversationStore.append(
      createMessage({
        id: "msg-2",
        agentId: "child-1",
        role: MessageRole.TOOL,
        content: "tool-call",
        toolName: "run_tests",
      }),
    );

    const report = await tools.reportToParent({
      agentId: "child-1",
      report: {
        agentId: "child-1",
        taskId: "task-2",
        success: true,
        summary: "Fix shipped",
        filesModified: ["src/app.ts"],
      },
    });

    expect(report.success).toBe(true);
    expect((await taskStore.get("task-2"))?.status).toBe(TaskStatus.COMPLETED);

    const status = await tools.getAgentStatus("child-1");
    expect(status.success).toBe(true);
    expect(status.data).toEqual(
      expect.objectContaining({
        agentId: "child-1",
        messageCount: 2,
        tasks: [expect.objectContaining({ id: "task-2", status: TaskStatus.COMPLETED })],
      }),
    );

    const summary = await tools.getAgentSummary("child-1");
    expect(summary.success).toBe(true);
    expect(summary.data).toEqual(
      expect.objectContaining({
        agentId: "child-1",
        toolCallCount: 1,
        lastResponse: expect.objectContaining({
          content: "Implemented the fix and verified it locally.",
        }),
        activeTasks: [],
      }),
    );
  });

  it("converges final review verdicts into the matching board column", async () => {
    await kanbanBoardStore.save(createKanbanBoard({
      id: "board-1",
      workspaceId: "ws-1",
      name: "Main",
      columns: [
        { id: "backlog", name: "Backlog", stage: "backlog", position: 0 },
        { id: "todo", name: "Todo", stage: "todo", position: 1 },
        { id: "dev", name: "Dev", stage: "dev", position: 2 },
        {
          id: "review",
          name: "Review",
          stage: "review",
          position: 3,
          automation: {
            enabled: true,
            steps: [
              {
                id: "qa-frontend",
                role: "GATE",
                specialistId: "kanban-qa-frontend",
                specialistName: "QA Frontend",
              },
              {
                id: "review-guard",
                role: "GATE",
                specialistId: "kanban-review-guard",
                specialistName: "Review Guard",
              },
            ],
          },
        },
        { id: "done", name: "Done", stage: "done", position: 4 },
      ],
    }));

    const task = createTask({
      id: "task-review-1",
      title: "Converge review",
      objective: "Move approved review work to done",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "review",
    });
    task.assignedSpecialistId = "kanban-review-guard";
    task.assignedSpecialistName = "Review Guard";
    await taskStore.save(task);

    const result = await tools.updateTask({
      taskId: "task-review-1",
      updates: {
        verificationVerdict: "APPROVED",
        verificationReport: "Checks passed",
      },
      agentId: "agent-1",
    });

    expect(result.success).toBe(true);
    const updated = await taskStore.get("task-review-1");
    expect(updated?.columnId).toBe("done");
    expect(updated?.status).toBe(TaskStatus.COMPLETED);
  });

  it("maps converged review verdicts from board stage when done uses a custom id", async () => {
    await kanbanBoardStore.save(createKanbanBoard({
      id: "board-1",
      workspaceId: "ws-1",
      name: "Main",
      columns: [
        { id: "backlog", name: "Backlog", stage: "backlog", position: 0 },
        { id: "todo", name: "Todo", stage: "todo", position: 1 },
        { id: "dev", name: "Dev", stage: "dev", position: 2 },
        {
          id: "review",
          name: "Review",
          stage: "review",
          position: 3,
          automation: {
            enabled: true,
            steps: [
              {
                id: "qa-frontend",
                role: "GATE",
                specialistId: "kanban-qa-frontend",
                specialistName: "QA Frontend",
              },
              {
                id: "review-guard",
                role: "GATE",
                specialistId: "kanban-review-guard",
                specialistName: "Review Guard",
              },
            ],
          },
        },
        { id: "released-stage", name: "Released", stage: "done", position: 4 },
      ],
    }));

    const task = createTask({
      id: "task-review-2",
      title: "Converge review custom done",
      objective: "Move approved review work to a custom done lane",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "review",
    });
    task.assignedSpecialistId = "kanban-review-guard";
    task.assignedSpecialistName = "Review Guard";
    await taskStore.save(task);

    const result = await tools.updateTask({
      taskId: "task-review-2",
      updates: {
        verificationVerdict: "APPROVED",
        verificationReport: "Checks passed",
      },
      agentId: "agent-1",
    });

    expect(result.success).toBe(true);
    const updated = await taskStore.get("task-review-2");
    expect(updated?.columnId).toBe("released-stage");
    expect(updated?.status).toBe(TaskStatus.COMPLETED);
  });

  it("persists structured jit context analysis through updateTask", async () => {
    const task = createTask({
      id: "task-jit-analysis",
      title: "Analyze JIT history",
      objective: "Persist structured history analysis",
      workspaceId: "ws-1",
      boardId: "board-1",
      columnId: "todo",
      jitContextSnapshot: {
        generatedAt: "2026-04-21T08:00:00.000Z",
        summary: "Recovered history context for kanban-workflow.",
        matchConfidence: "high",
        matchReasons: ["Matched the kanban-workflow feature."],
        warnings: [],
        matchedFileDetails: [],
        matchedSessionIds: ["session-codex"],
        failures: [],
        repeatedReadFiles: [],
        sessions: [],
      },
    });
    await taskStore.save(task);

    const result = await tools.saveJitContext({
      taskId: "task-jit-analysis",
      result: {
        summary: "Start from the Kanban API and blocked interval reconstruction.",
        topFiles: ["crates/routa-server/src/api/kanban.rs"],
        topSessions: [{
          sessionId: "session-codex",
          provider: "codex",
          reason: "This session touched the durable flow-event path directly.",
        }],
        reusablePrompts: ["Check Rust and TS flow-event parity first."],
        recommendedContextSearchSpec: {
          query: "kanban flow event persistence",
          featureCandidates: ["kanban-workflow"],
        },
      },
      agentId: "agent-1",
    });

    expect(result.success).toBe(true);
    const updated = await taskStore.get("task-jit-analysis");
    expect(updated?.jitContextSnapshot?.analysis).toEqual(expect.objectContaining({
      summary: "Start from the Kanban API and blocked interval reconstruction.",
      topFiles: ["crates/routa-server/src/api/kanban.rs"],
      topSessions: [
        expect.objectContaining({
          sessionId: "session-codex",
          provider: "codex",
        }),
      ],
      recommendedContextSearchSpec: expect.objectContaining({
        query: "kanban flow event persistence",
        featureCandidates: ["kanban-workflow"],
      }),
    }));
    expect(updated?.jitContextSnapshot?.summary).toBe("Recovered history context for kanban-workflow.");
  });
});
