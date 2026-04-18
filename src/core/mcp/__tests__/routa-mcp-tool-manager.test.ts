import { describe, expect, it, vi } from "vitest";

import { RoutaMcpToolManager } from "../routa-mcp-tool-manager";

function createServerRecorder() {
  const registrations: Array<{
    name: string;
    description: string;
    schema: unknown;
    handler: (params: Record<string, unknown>) => Promise<unknown>;
  }> = [];

  return {
    registrations,
    server: {
      tool(
        name: string,
        description: string,
        schema: unknown,
        handler: (params: Record<string, unknown>) => Promise<unknown>,
      ) {
        registrations.push({ name, description, schema, handler });
      },
    },
  };
}

function createToolsMock() {
  return {
    createTask: vi.fn(async (params) => ({ success: true, data: { ...params, taskId: "task-1" } })),
    listAgents: vi.fn(async (workspaceId) => ({ success: true, data: [{ workspaceId }] })),
    readAgentConversation: vi.fn(async (params) => ({ success: true, data: params })),
    createAgent: vi.fn(async (params) => ({ success: true, data: params })),
    delegate: vi.fn(async (params) => ({ success: true, data: params })),
    messageAgent: vi.fn(async (params) => ({ success: true, data: params })),
    reportToParent: vi.fn(async (params) => ({ success: true, data: params })),
    wakeOrCreateTaskAgent: vi.fn(async (params) => ({ success: true, data: params })),
    sendMessageToTaskAgent: vi.fn(async (params) => ({ success: true, data: params })),
    getAgentStatus: vi.fn(async (agentId) => ({ success: true, data: { agentId } })),
    getAgentSummary: vi.fn(async (agentId) => ({ success: true, data: { agentId } })),
    subscribeToEvents: vi.fn(async (params) => ({ success: true, data: params })),
    unsubscribeFromEvents: vi.fn(async (subscriptionId) => ({ success: true, data: { subscriptionId } })),
    listTasks: vi.fn(async (workspaceId) => ({ success: true, data: [{ workspaceId }] })),
    updateTaskStatus: vi.fn(async (params) => ({ success: true, data: params })),
    updateTask: vi.fn(async (params) => ({ success: true, data: params })),
    requestArtifact: vi.fn(async (params) => ({ success: true, data: params })),
    provideArtifact: vi.fn(async (params) => ({ success: true, data: params })),
    listArtifacts: vi.fn(async (params) => ({ success: true, data: params })),
    getArtifact: vi.fn(async (params) => ({ success: true, data: params })),
    listPendingArtifactRequests: vi.fn(async (params) => ({ success: true, data: params })),
    captureScreenshot: vi.fn(async (params) => ({ success: true, data: params })),
  };
}

describe("RoutaMcpToolManager", () => {
  it("registers only essential tools in essential mode and honors allowedTools", () => {
    const tools = createToolsMock();
    const manager = new RoutaMcpToolManager(tools as never, "ws-1");
    manager.setAllowedTools(new Set(["create_task", "list_agents", "delegate_task_to_agent"]));

    const { registrations, server } = createServerRecorder();
    manager.registerTools(server as never);

    expect(registrations.map((entry) => entry.name)).toEqual([
      "create_task",
      "list_agents",
      "delegate_task_to_agent",
    ]);
  });

  it("registers full-mode tools and delegates callback params correctly", async () => {
    const tools = createToolsMock();
    const manager = new RoutaMcpToolManager(tools as never, "ws-1");
    manager.setToolMode("full");
    manager.setSessionId("session-123");
    manager.setNoteTools({
      createNote: vi.fn(async (params) => ({ success: true, data: params })),
      readNote: vi.fn(async () => ({ success: true, data: {} })),
      listNotes: vi.fn(async () => ({ success: true, data: [] })),
      setNoteContent: vi.fn(async (params) => ({ success: true, data: params })),
      appendToNote: vi.fn(async () => ({ success: true, data: {} })),
      getMyTask: vi.fn(async () => ({ success: true, data: {} })),
      convertTaskBlocks: vi.fn(async () => ({ success: true, data: {} })),
    } as never);
    manager.setWorkspaceTools({
      gitStatus: vi.fn(async (params) => ({ success: true, data: params })),
      gitDiff: vi.fn(async () => ({ success: true, data: {} })),
      gitCommit: vi.fn(async () => ({ success: true, data: {} })),
      getWorkspaceInfo: vi.fn(async () => ({ success: true, data: {} })),
      getWorkspaceDetails: vi.fn(async () => ({ success: true, data: {} })),
      setWorkspaceTitle: vi.fn(async () => ({ success: true, data: {} })),
      listWorkspaces: vi.fn(async () => ({ success: true, data: [] })),
      createWorkspace: vi.fn(async () => ({ success: true, data: {} })),
      listSpecialists: vi.fn(async () => ({ success: true, data: [] })),
    } as never);
    const orchestrator = {
      getSessionForAgent: vi.fn(() => "resolved-session"),
      delegateTaskWithSpawn: vi.fn(async (params) => ({ success: true, data: params })),
    };
    manager.setOrchestrator(orchestrator as never);

    const { registrations, server } = createServerRecorder();
    manager.registerTools(server as never);

    expect(registrations.some((entry) => entry.name === "list_tasks")).toBe(true);
    expect(registrations.some((entry) => entry.name === "git_status")).toBe(true);
    expect(registrations.some((entry) => entry.name === "create_note")).toBe(true);
    expect(registrations.some((entry) => entry.name === "read_canvas_sdk_resource")).toBe(true);
    expect(registrations.some((entry) => entry.name === "read_specialist_spec_resource")).toBe(true);

    const createTaskTool = registrations.find((entry) => entry.name === "create_task");
    const noteTool = registrations.find((entry) => entry.name === "create_note");
    const delegateTool = registrations.find((entry) => entry.name === "delegate_task_to_agent");
    const canvasSdkTool = registrations.find((entry) => entry.name === "read_canvas_sdk_resource");
    const specialistSpecTool = registrations.find((entry) => entry.name === "read_specialist_spec_resource");
    expect(createTaskTool).toBeDefined();
    expect(noteTool).toBeDefined();
    expect(delegateTool).toBeDefined();
    expect(canvasSdkTool).toBeDefined();
    expect(specialistSpecTool).toBeDefined();

    await createTaskTool!.handler({
      title: "Task",
      objective: "Objective",
    });
    expect(tools.createTask).toHaveBeenCalledWith({
      title: "Task",
      objective: "Objective",
      workspaceId: "ws-1",
    });

    await noteTool!.handler({
      title: "Spec",
      content: "Body",
      noteId: "spec",
    });
    expect((manager as unknown as { noteTools: { createNote: ReturnType<typeof vi.fn> } }).noteTools.createNote)
      .toHaveBeenCalledWith({
        title: "Spec",
        content: "Body",
        noteId: "spec",
        workspaceId: "ws-1",
        sessionId: "session-123",
      });

    const result = await delegateTool!.handler({
      taskId: "task-1",
      callerAgentId: "agent-1",
      specialist: "CRAFTER",
    });
    expect(orchestrator.delegateTaskWithSpawn).toHaveBeenCalledWith({
      taskId: "task-1",
      callerAgentId: "agent-1",
      callerSessionId: "resolved-session",
      workspaceId: "ws-1",
      specialist: "CRAFTER",
      provider: undefined,
      cwd: undefined,
      additionalInstructions: undefined,
      waitMode: undefined,
    });
    expect(result).toMatchObject({
      content: [{ type: "text" }],
      isError: false,
    });
    expect((result as { content: Array<{ text: string }> }).content[0]?.text).toContain(
      '"callerAgentId": "agent-1"',
    );

    const canvasSdkResult = await canvasSdkTool!.handler({
      uri: "resource://routa/canvas-sdk/manifest",
    });
    expect(canvasSdkResult).toMatchObject({
      content: [{ type: "text" }],
      isError: false,
    });
    const canvasSdkPayload = JSON.parse(
      (canvasSdkResult as { content: Array<{ text: string }> }).content[0]?.text ?? "{}",
    ) as { text?: string };
    expect(canvasSdkPayload.text).toContain('"moduleSpecifier"');

    const specialistSpecResult = await specialistSpecTool!.handler({
      uri: "resource://routa/specialists/feature-tree/manifest",
    });
    expect(specialistSpecResult).toMatchObject({
      content: [{ type: "text" }],
      isError: false,
    });
    const specialistSpecPayload = JSON.parse(
      (specialistSpecResult as { content: Array<{ text: string }> }).content[0]?.text ?? "{}",
    ) as { text?: string };
    expect(specialistSpecPayload.text).toContain('"baseRulesInPrompt"');
  });

  it("returns MCP errors when orchestrator or note tools are unavailable", async () => {
    const tools = createToolsMock();
    const manager = new RoutaMcpToolManager(tools as never, "ws-1");

    const { registrations, server } = createServerRecorder();
    manager.registerTools(server as never);

    const delegateTool = registrations.find((entry) => entry.name === "delegate_task_to_agent");
    expect(delegateTool).toBeDefined();
    const delegateResult = await delegateTool!.handler({
      taskId: "task-1",
      callerAgentId: "agent-1",
      specialist: "CRAFTER",
    });
    expect(delegateResult).toMatchObject({
      content: [{ type: "text" }],
      isError: true,
    });
    expect((delegateResult as { content: Array<{ text: string }> }).content[0]?.text).toContain(
      "Orchestrator not available. Multi-agent delegation requires orchestrator setup.",
    );
  });
});
