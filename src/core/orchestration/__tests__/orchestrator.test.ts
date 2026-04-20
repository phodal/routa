import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentRole, AgentStatus, ModelTier, createAgent } from "@/core/models/agent";
import { TaskStatus, createTask } from "@/core/models/task";

const specialistByRoleMock = vi.hoisted(() => vi.fn());
const specialistByIdMock = vi.hoisted(() => vi.fn());
const buildDelegationPromptMock = vi.hoisted(() => vi.fn(() => "delegation prompt"));
const checkDelegationDepthMock = vi.hoisted(() => vi.fn());
const calculateChildDepthMock = vi.hoisted(() => vi.fn((depth: number) => depth + 1));
const buildAgentMetadataMock = vi.hoisted(() => vi.fn());
const uuidMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
const recordDelegationMock = vi.hoisted(() => vi.fn(async () => {}));
const recordChildSessionStartMock = vi.hoisted(() => vi.fn(async () => {}));
const recordChildCompletionMock = vi.hoisted(() => vi.fn(async () => {}));
const AgentMemoryWriterMock = vi.hoisted(() =>
  vi.fn(function MockAgentMemoryWriter() {
    return {
      recordDelegation: recordDelegationMock,
      recordChildSessionStart: recordChildSessionStartMock,
      recordChildCompletion: recordChildCompletionMock,
    };
  }),
);

vi.mock("../specialist-prompts", () => ({
  getSpecialistByRole: specialistByRoleMock,
  getSpecialistById: specialistByIdMock,
  buildDelegationPrompt: buildDelegationPromptMock,
}));

vi.mock("../delegation-depth", () => ({
  checkDelegationDepth: checkDelegationDepthMock,
  calculateChildDepth: calculateChildDepthMock,
  buildAgentMetadata: buildAgentMetadataMock,
}));

vi.mock("uuid", () => ({
  v4: uuidMock,
}));

vi.mock("@/core/acp/http-session-store", () => ({
  getHttpSessionStore: () => ({
    getSession: getSessionMock,
  }),
}));

vi.mock("@/core/storage/agent-memory-writer", () => ({
  AgentMemoryWriter: AgentMemoryWriterMock,
}));

const { RoutaOrchestrator } = await import("../orchestrator");

function createSystemFixture() {
  const task = createTask({
    id: "task-1",
    title: "Frontend polish task",
    objective: "Improve the frontend experience",
    scope: "Touch the dashboard UI only",
    acceptanceCriteria: ["renders updated layout"],
    verificationCommands: ["npm run test"],
    testCases: ["layout renders correctly"],
    workspaceId: "ws-1",
    position: 0,
    labels: [],
  });

  const eventBus = {
    on: vi.fn(),
    emit: vi.fn(),
  };

  const taskStore = {
    get: vi.fn(async (taskId: string) => (taskId === task.id ? task : undefined)),
    save: vi.fn(async () => {}),
  };

  const callerAgent = createAgent({
    id: "caller-agent",
    name: "Lead",
    role: AgentRole.ROUTA,
    workspaceId: "ws-1",
    modelTier: ModelTier.SMART,
    metadata: {},
  });

  const existingRosterAgent = createAgent({
    id: "existing-team-agent",
    name: "Existing Frontend Dev",
    role: AgentRole.CRAFTER,
    workspaceId: "ws-1",
    modelTier: ModelTier.BALANCED,
    metadata: {
      rosterRoleId: "team-frontend-dev",
      displayLabel: "Lee",
    },
  });

  const agentStore = {
    get: vi.fn(async (agentId: string) => {
      if (agentId === "caller-agent") {
        return callerAgent;
      }
      if (agentId === "existing-team-agent") {
        return existingRosterAgent;
      }
      return undefined;
    }),
    listByWorkspace: vi.fn(async () => [existingRosterAgent]),
    updateStatus: vi.fn(async () => {}),
  };

  const system = {
    eventBus,
    taskStore,
    agentStore,
    conversationStore: {},
    tools: {
      createAgent: vi.fn(async () => ({
        success: true,
        data: { agentId: "child-agent-1" },
      })),
      reportToParent: vi.fn(async () => ({ success: true })),
    },
  };

  const processManager = {
    killSession: vi.fn(),
  };

  return {
    task,
    callerAgent,
    existingRosterAgent,
    system,
    processManager,
  };
}

function createOrchestratorFixture() {
  const fixture = createSystemFixture();
  const orchestrator = new RoutaOrchestrator(
    fixture.system as never,
    fixture.processManager as never,
    {
      defaultCrafterProvider: "claude",
      defaultGateProvider: "opencode",
      defaultCwd: "/workspace/project",
      serverPort: "3333",
    },
  );

  return { ...fixture, orchestrator };
}

describe("RoutaOrchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockReset();
    getSessionMock.mockReturnValue(undefined);
    AgentMemoryWriterMock.mockClear();
    recordDelegationMock.mockClear();
    recordChildSessionStartMock.mockClear();
    recordChildCompletionMock.mockClear();
    uuidMock
      .mockReturnValueOnce("session-uuid-1")
      .mockReturnValueOnce("group-uuid-1");
    checkDelegationDepthMock.mockResolvedValue({
      allowed: true,
      currentDepth: 1,
    });
    specialistByRoleMock.mockImplementation((role: AgentRole) => {
      if (role === AgentRole.CRAFTER) {
        return {
          id: "crafter",
          name: "Crafter",
          role: AgentRole.CRAFTER,
          defaultModelTier: ModelTier.BALANCED,
        };
      }
      if (role === AgentRole.GATE) {
        return {
          id: "gate",
          name: "Gate",
          role: AgentRole.GATE,
          defaultModelTier: ModelTier.SMART,
        };
      }
      return undefined;
    });
    specialistByIdMock.mockImplementation((id: string) => {
      if (id === "crafter") {
        return {
          id: "crafter",
          name: "Crafter",
          role: AgentRole.CRAFTER,
          defaultModelTier: ModelTier.BALANCED,
        };
      }
      if (id === "gate") {
        return {
          id: "gate",
          name: "Gate",
          role: AgentRole.GATE,
          defaultModelTier: ModelTier.SMART,
        };
      }
      return undefined;
    });
    buildAgentMetadataMock.mockImplementation(
      (
        depth: number,
        callerAgentId?: string,
        specialistId?: string,
        runtimeMetadata?: Record<string, string>,
      ) => ({
        delegationDepth: String(depth),
        createdByAgentId: callerAgentId ?? "",
        specialist: specialistId ?? "",
        ...runtimeMetadata,
      }),
    );
  });

  it("returns an error for unknown specialists", async () => {
    const { orchestrator } = createOrchestratorFixture();

    const result = await orchestrator.delegateTaskWithSpawn({
      taskId: "task-1",
      callerAgentId: "caller-agent",
      callerSessionId: "caller-session",
      workspaceId: "ws-1",
      specialist: "unknown-specialist",
    });

    expect(result).toEqual({
      success: false,
      error:
        'Unknown specialist: unknown-specialist. Use "CRAFTER", "GATE", "crafter", or "gate".',
    });
  });

  it("returns a task-name hint when the task id is not a UUID", async () => {
    const { orchestrator } = createOrchestratorFixture();

    const result = await orchestrator.delegateTaskWithSpawn({
      taskId: "frontend cleanup",
      callerAgentId: "caller-agent",
      callerSessionId: "caller-session",
      workspaceId: "ws-1",
      specialist: "crafter",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('The taskId "frontend cleanup" looks like a task name');
    expect(result.error).toContain("First call create_task");
  });

  it("returns an error when loading the delegated task fails", async () => {
    const { orchestrator, system, task } = createOrchestratorFixture();
    (system.taskStore.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("store exploded"));

    const result = await orchestrator.delegateTaskWithSpawn({
      taskId: task.id,
      callerAgentId: "caller-agent",
      callerSessionId: "caller-session",
      workspaceId: task.workspaceId,
      specialist: "crafter",
    });

    expect(result).toEqual({
      success: false,
      error: `Failed to load task ${task.id}: store exploded`,
    });
    expect(system.tools.createAgent).not.toHaveBeenCalled();
  });

  it("writes delegation memory under the caller session cwd when the child runs elsewhere", async () => {
    const { orchestrator, task } = createOrchestratorFixture();
    getSessionMock.mockImplementation((sessionId: string) =>
      sessionId === "caller-session" ? { cwd: "/workspace/parent-repo" } : undefined,
    );
    (orchestrator as unknown as { spawnChildAgent: () => Promise<{ sandboxId?: string }> }).spawnChildAgent =
      vi.fn(async () => ({ sandboxId: "sandbox-1" }));

    const result = await orchestrator.delegateTaskWithSpawn({
      taskId: task.id,
      callerAgentId: "caller-agent",
      callerSessionId: "caller-session",
      workspaceId: task.workspaceId,
      specialist: "crafter",
      cwd: "/workspace/child-repo",
    });

    expect(result.success).toBe(true);
    expect(AgentMemoryWriterMock).toHaveBeenCalledWith("/workspace/parent-repo");
    expect(AgentMemoryWriterMock).toHaveBeenCalledWith("/workspace/child-repo");
    expect(recordDelegationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "caller-session",
        taskId: task.id,
      }),
    );
    expect(recordChildSessionStartMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-uuid-1",
        taskId: task.id,
      }),
    );
  });

  it("skips parent delegation memory when the caller session is unknown", async () => {
    const { orchestrator, task } = createOrchestratorFixture();
    (orchestrator as unknown as { spawnChildAgent: () => Promise<{ sandboxId?: string }> }).spawnChildAgent =
      vi.fn(async () => ({ sandboxId: "sandbox-1" }));

    const result = await orchestrator.delegateTaskWithSpawn({
      taskId: task.id,
      callerAgentId: "caller-agent",
      callerSessionId: "unknown",
      workspaceId: task.workspaceId,
      specialist: "crafter",
      cwd: "/workspace/child-repo",
    });

    expect(result.success).toBe(true);
    expect(AgentMemoryWriterMock).toHaveBeenCalledTimes(1);
    expect(AgentMemoryWriterMock).toHaveBeenCalledWith("/workspace/child-repo");
    expect(recordDelegationMock).not.toHaveBeenCalled();
    expect(recordChildSessionStartMock).toHaveBeenCalledTimes(1);
  });

  it("creates after_all delegation groups and assigns roster metadata for team leads", async () => {
    const { orchestrator, system, callerAgent, task } = createOrchestratorFixture();
    callerAgent.metadata.specialist = "team-agent-lead";
    (orchestrator as unknown as { spawnChildAgent: () => Promise<{ sandboxId?: string }> }).spawnChildAgent =
      vi.fn(async () => ({ sandboxId: "sandbox-1" }));
    const sessionRegistrationHandler = vi.fn();
    orchestrator.setSessionRegistrationHandler(sessionRegistrationHandler);

    const result = await orchestrator.delegateTaskWithSpawn({
      taskId: task.id,
      callerAgentId: callerAgent.id,
      callerSessionId: "caller-session",
      workspaceId: task.workspaceId,
      specialist: "crafter",
      additionalInstructions: "Focus on frontend React polish",
      waitMode: "after_all",
    });

    expect(result.success).toBe(true);
    expect(system.tools.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        role: AgentRole.CRAFTER,
        workspaceId: "ws-1",
        parentId: "caller-agent",
        metadata: expect.objectContaining({
          delegationDepth: "2",
          createdByAgentId: "caller-agent",
          specialist: "crafter",
          rosterRoleId: "team-frontend-dev",
          displayLabel: "Taylor",
        }),
      }),
    );
    expect(system.taskStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: task.id,
        status: TaskStatus.IN_PROGRESS,
        assignedTo: "child-agent-1",
      }),
    );
    expect(system.agentStore.updateStatus).toHaveBeenCalledWith(
      "child-agent-1",
      AgentStatus.ACTIVE,
    );
    expect(sessionRegistrationHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxId: "sandbox-1",
        parentSessionId: "caller-session",
      }),
    );
    expect(orchestrator.getSessionForAgent("child-agent-1")).toEqual(expect.any(String));
    expect(orchestrator.getChildAgents("caller-agent")).toEqual([
      expect.objectContaining({
        agentId: "child-agent-1",
        parentAgentId: "caller-agent",
        parentSessionId: "caller-session",
        taskId: task.id,
        provider: "claude",
      }),
    ]);
    expect(
      (orchestrator as unknown as { activeGroupByAgent: Map<string, string> }).activeGroupByAgent.get(
        "caller-agent",
      ),
    ).toMatch(/^delegation-group-/);
  });

  it("deduplicates concurrent completion finalization for the same child", async () => {
    const { orchestrator, task } = createOrchestratorFixture();
    (orchestrator as unknown as { spawnChildAgent: () => Promise<{ sandboxId?: string }> }).spawnChildAgent =
      vi.fn(async () => ({ sandboxId: "sandbox-1" }));
    const sendPromptToSessionMock = vi.fn(async () => {});
    (orchestrator as unknown as { sendPromptToSession: typeof sendPromptToSessionMock }).sendPromptToSession =
      sendPromptToSessionMock;

    await orchestrator.delegateTaskWithSpawn({
      taskId: task.id,
      callerAgentId: "caller-agent",
      callerSessionId: "caller-session",
      workspaceId: task.workspaceId,
      specialist: "crafter",
    });

    recordChildCompletionMock.mockClear();
    const record = orchestrator.getChildAgents("caller-agent")[0];

    await Promise.all([
      (
        orchestrator as unknown as {
          finalizeChildCompletion: (
            childAgentId: string,
            record: unknown,
            source: "reported",
          ) => Promise<void>;
        }
      ).finalizeChildCompletion("child-agent-1", record, "reported"),
      (
        orchestrator as unknown as {
          finalizeChildCompletion: (
            childAgentId: string,
            record: unknown,
            source: "reported",
          ) => Promise<void>;
        }
      ).finalizeChildCompletion("child-agent-1", record, "reported"),
    ]);

    expect(recordChildCompletionMock).toHaveBeenCalledTimes(1);
    expect(sendPromptToSessionMock).toHaveBeenCalledTimes(1);
  });

  it("retries waking the parent on session-end fallback without rewriting completion memory", async () => {
    const { orchestrator, task } = createOrchestratorFixture();
    (orchestrator as unknown as { spawnChildAgent: () => Promise<{ sandboxId?: string }> }).spawnChildAgent =
      vi.fn(async () => ({ sandboxId: "sandbox-1" }));
    const sendPromptToSessionMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("wake exploded"))
      .mockResolvedValueOnce(undefined);
    (orchestrator as unknown as { sendPromptToSession: typeof sendPromptToSessionMock }).sendPromptToSession =
      sendPromptToSessionMock;

    await orchestrator.delegateTaskWithSpawn({
      taskId: task.id,
      callerAgentId: "caller-agent",
      callerSessionId: "caller-session",
      workspaceId: task.workspaceId,
      specialist: "crafter",
    });

    recordChildCompletionMock.mockClear();
    const record = orchestrator.getChildAgents("caller-agent")[0];

    await expect(
      (
        orchestrator as unknown as {
          finalizeChildCompletion: (
            childAgentId: string,
            record: unknown,
            source: "reported",
          ) => Promise<void>;
        }
      ).finalizeChildCompletion("child-agent-1", record, "reported"),
    ).rejects.toThrow("wake exploded");

    vi.useFakeTimers();
    try {
      const completionPromise = (
        orchestrator as unknown as {
          scheduleSessionEndCompletion: (
            childAgentId: string,
            record: unknown,
          ) => Promise<void>;
        }
      ).scheduleSessionEndCompletion("child-agent-1", record);

      await vi.advanceTimersByTimeAsync(500);
      await expect(completionPromise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }

    expect(recordChildCompletionMock).toHaveBeenCalledTimes(1);
    expect(sendPromptToSessionMock).toHaveBeenCalledTimes(2);
  });

  it("still skips session-end finalization after a successful completion", async () => {
    const { orchestrator, task } = createOrchestratorFixture();
    (orchestrator as unknown as { spawnChildAgent: () => Promise<{ sandboxId?: string }> }).spawnChildAgent =
      vi.fn(async () => ({ sandboxId: "sandbox-1" }));
    const sendPromptToSessionMock = vi.fn(async () => {});
    (orchestrator as unknown as { sendPromptToSession: typeof sendPromptToSessionMock }).sendPromptToSession =
      sendPromptToSessionMock;

    await orchestrator.delegateTaskWithSpawn({
      taskId: task.id,
      callerAgentId: "caller-agent",
      callerSessionId: "caller-session",
      workspaceId: task.workspaceId,
      specialist: "crafter",
    });

    recordChildCompletionMock.mockClear();
    vi.useFakeTimers();
    try {
      const record = orchestrator.getChildAgents("caller-agent")[0];
      await expect(
        (
          orchestrator as unknown as {
            finalizeChildCompletion: (
              childAgentId: string,
              record: unknown,
              source: "reported",
            ) => Promise<void>;
          }
        ).finalizeChildCompletion("child-agent-1", record, "reported"),
      ).resolves.toBeUndefined();

      recordChildCompletionMock.mockClear();
      sendPromptToSessionMock.mockClear();

      const completionPromise = (
        orchestrator as unknown as {
          scheduleSessionEndCompletion: (
            childAgentId: string,
            record: unknown,
          ) => Promise<void>;
        }
      ).scheduleSessionEndCompletion("child-agent-1", record);

      await vi.advanceTimersByTimeAsync(500);
      await expect(completionPromise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }

    expect(recordChildCompletionMock).not.toHaveBeenCalled();
    expect(sendPromptToSessionMock).not.toHaveBeenCalled();
  });

  it("keeps completion handling non-blocking when the task snapshot lookup fails", async () => {
    const { orchestrator, system, task } = createOrchestratorFixture();
    (orchestrator as unknown as { spawnChildAgent: () => Promise<{ sandboxId?: string }> }).spawnChildAgent =
      vi.fn(async () => ({ sandboxId: "sandbox-1" }));
    const sendPromptToSessionMock = vi.fn(async () => {});
    (orchestrator as unknown as { sendPromptToSession: typeof sendPromptToSessionMock }).sendPromptToSession =
      sendPromptToSessionMock;

    await orchestrator.delegateTaskWithSpawn({
      taskId: task.id,
      callerAgentId: "caller-agent",
      callerSessionId: "caller-session",
      workspaceId: task.workspaceId,
      specialist: "crafter",
    });

    recordChildCompletionMock.mockClear();
    (system.taskStore.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("store exploded"));
    const record = orchestrator.getChildAgents("caller-agent")[0];

    await expect(
      (
        orchestrator as unknown as {
          finalizeChildCompletion: (
            childAgentId: string,
            record: unknown,
            source: "session_end",
          ) => Promise<void>;
        }
      ).finalizeChildCompletion("child-agent-1", record, "session_end"),
    ).resolves.toBeUndefined();

    expect(recordChildCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskTitle: task.id,
        status: "unknown",
        snapshotSource: "session_end",
      }),
    );
    expect(sendPromptToSessionMock).toHaveBeenCalledTimes(1);
  });

  it("rolls back task and agent state when spawning the child process fails", async () => {
    const { orchestrator, system, task } = createOrchestratorFixture();
    (orchestrator as unknown as { spawnChildAgent: () => Promise<{ sandboxId?: string }> }).spawnChildAgent =
      vi.fn(async () => {
        throw new Error("spawn exploded");
      });

    const result = await orchestrator.delegateTaskWithSpawn({
      taskId: task.id,
      callerAgentId: "caller-agent",
      callerSessionId: "caller-session",
      workspaceId: task.workspaceId,
      specialist: "crafter",
    });

    expect(result).toEqual({
      success: false,
      error: "Failed to spawn agent process: spawn exploded",
    });
    expect(system.agentStore.updateStatus).toHaveBeenNthCalledWith(
      1,
      "child-agent-1",
      AgentStatus.ACTIVE,
    );
    expect(system.agentStore.updateStatus).toHaveBeenNthCalledWith(
      2,
      "child-agent-1",
      AgentStatus.ERROR,
    );
    expect(system.taskStore.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: task.id,
        status: TaskStatus.BLOCKED,
      }),
    );
  });
});
