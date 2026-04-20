/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it } from "vitest";
import { AgentTools } from "../agent-tools";
import { AgentEventType, EventBus } from "../../events/event-bus";
import { InMemoryAgentStore } from "../../store/agent-store";
import { InMemoryConversationStore } from "../../store/conversation-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { createTask } from "../../models/task";

describe("AgentTools.createTask", () => {
  let tools: AgentTools;
  let taskStore: InMemoryTaskStore;

  beforeEach(() => {
    taskStore = new InMemoryTaskStore();
    tools = new AgentTools(
      new InMemoryAgentStore(),
      new InMemoryConversationStore(),
      taskStore,
      new EventBus(),
    );
  });

  it("persists creationSource for session tasks", async () => {
    const result = await tools.createTask({
      title: "Session task",
      objective: "Keep task scoped to the session UI",
      workspaceId: "workspace-1",
      creationSource: "session",
    });

    expect(result.success).toBe(true);

    const taskId = (result.data as { taskId: string }).taskId;
    const task = await taskStore.get(taskId);
    expect(task?.creationSource).toBe("session");
  });
});

describe("AgentTools.updateTask synthetic completion", () => {
  let tools: AgentTools;
  let taskStore: InMemoryTaskStore;
  let eventBus: EventBus;

  beforeEach(() => {
    taskStore = new InMemoryTaskStore();
    eventBus = new EventBus();
    tools = new AgentTools(
      new InMemoryAgentStore(),
      new InMemoryConversationStore(),
      taskStore,
      eventBus,
    );
  });

  it("emits AGENT_COMPLETED when a running review gate writes verdict and report", async () => {
    const task = createTask({
      id: "task-review",
      title: "Review task",
      objective: "Allow review guard to continue",
      workspaceId: "workspace-1",
      columnId: "review",
    });
    task.laneSessions = [{
      sessionId: "session-review-1",
      columnId: "review",
      columnName: "Review",
      provider: "codex",
      role: "GATE",
      status: "running",
      completionRequirement: "verification_report",
      stepId: "qa-frontend",
      stepIndex: 0,
      stepName: "QA Frontend",
      startedAt: new Date().toISOString(),
    }];
    await taskStore.save(task);

    const events: AgentEventType[] = [];
    let completionPayload: Record<string, unknown> | undefined;
    eventBus.on("capture", (event) => {
      events.push(event.type);
      if (event.type === AgentEventType.AGENT_COMPLETED) {
        completionPayload = event.data;
      }
    });

    const result = await tools.updateTask({
      taskId: task.id,
      updates: {
        verificationVerdict: "APPROVED",
        verificationReport: "QA passed with screenshot and test results.",
      },
      agentId: "session-review-1",
    });

    expect(result.success).toBe(true);
    expect(events).toContain(AgentEventType.AGENT_COMPLETED);
    expect(completionPayload).toMatchObject({
      sessionId: "session-review-1",
      success: true,
      synthesizedBy: "updateTask",
      trigger: "verification_report",
      taskId: task.id,
    });
  });

  it("emits AGENT_COMPLETED only after verdict and report are both persisted across separate updates", async () => {
    const task = createTask({
      id: "task-review-split",
      title: "Review task split updates",
      objective: "Allow review guard to continue after separate writes",
      workspaceId: "workspace-1",
      columnId: "review",
      triggerSessionId: "session-review-1",
    });
    task.laneSessions = [{
      sessionId: "session-review-1",
      columnId: "review",
      columnName: "Review",
      provider: "codex",
      role: "GATE",
      status: "running",
      completionRequirement: "verification_report",
      stepId: "qa-frontend",
      stepIndex: 0,
      stepName: "QA Frontend",
      startedAt: new Date().toISOString(),
    }];
    await taskStore.save(task);

    const events: AgentEventType[] = [];
    let completionPayload: Record<string, unknown> | undefined;
    eventBus.on("capture", (event) => {
      events.push(event.type);
      if (event.type === AgentEventType.AGENT_COMPLETED) {
        completionPayload = event.data;
      }
    });

    const verdictResult = await tools.updateTask({
      taskId: task.id,
      updates: {
        verificationVerdict: "APPROVED",
      },
      agentId: "system",
    });

    expect(verdictResult.success).toBe(true);
    expect(events).not.toContain(AgentEventType.AGENT_COMPLETED);

    const reportResult = await tools.updateTask({
      taskId: task.id,
      updates: {
        verificationReport: "QA passed with screenshot and test results.",
      },
      agentId: "system",
    });

    expect(reportResult.success).toBe(true);
    expect(events).toContain(AgentEventType.AGENT_COMPLETED);
    expect(completionPayload).toMatchObject({
      sessionId: "session-review-1",
      success: true,
      synthesizedBy: "updateTask",
      trigger: "verification_report",
      taskId: task.id,
    });
  });

  it("does not emit AGENT_COMPLETED when a non-review running session only writes a verdict", async () => {
    const task = createTask({
      id: "task-dev",
      title: "Dev task",
      objective: "Do not synthesize unrelated completion",
      workspaceId: "workspace-1",
      columnId: "dev",
    });
    task.laneSessions = [{
      sessionId: "session-dev-1",
      columnId: "dev",
      columnName: "Dev",
      provider: "codex",
      role: "CRAFTER",
      status: "running",
      stepId: "dev-executor",
      stepIndex: 0,
      stepName: "Dev Crafter",
      startedAt: new Date().toISOString(),
    }];
    await taskStore.save(task);

    const events: AgentEventType[] = [];
    eventBus.on("capture", (event) => {
      events.push(event.type);
    });

    const result = await tools.updateTask({
      taskId: task.id,
      updates: {
        verificationVerdict: "APPROVED",
      },
      agentId: "session-dev-1",
    });

    expect(result.success).toBe(true);
    expect(events).not.toContain(AgentEventType.AGENT_COMPLETED);
  });
});
