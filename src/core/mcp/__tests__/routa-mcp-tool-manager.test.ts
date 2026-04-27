import { describe, expect, it, vi } from "vitest";

const {
  assembleTaskAdaptiveHarnessFromToolArgs,
  confirmFeatureTreeStoryContextFromToolArgs,
  inspectTranscriptTurnsFromToolArgs,
  loadFeatureTreeContextFromToolArgs,
  loadFeatureRetrospectiveMemoryFromToolArgs,
  saveFeatureRetrospectiveMemoryFromToolArgs,
  summarizeFileSessionContextFromToolArgs,
  summarizeTaskHistoryContextFromToolArgs,
} = vi.hoisted(() => ({
  assembleTaskAdaptiveHarnessFromToolArgs: vi.fn(async () => ({
    summary: "Recovered history-session context for the current task.",
    warnings: [],
    selectedFiles: ["src/core/mcp/routa-mcp-tool-manager.ts"],
    matchedFileDetails: [{
      filePath: "src/core/mcp/routa-mcp-tool-manager.ts",
      changes: 1,
      sessions: 1,
      updatedAt: "2026-04-21T12:00:00.000Z",
    }],
    matchedSessionIds: ["session-123"],
    failures: [],
    repeatedReadFiles: [],
    sessions: [],
  })),
  summarizeTaskHistoryContextFromToolArgs: vi.fn(async () => ({
    historySummary: {
      overview: "Started from 2 linked history sessions and narrowed to 1 recovered session.",
      seedSessionCount: 2,
      recoveredSessionCount: 1,
      matchedFileCount: 1,
      seedSessions: [],
    },
    selectedFiles: ["src/core/mcp/routa-mcp-tool-manager.ts"],
    matchedFileDetails: [],
    matchedSessionIds: ["session-123"],
    warnings: [],
  })),
  summarizeFileSessionContextFromToolArgs: vi.fn(async () => ({
    selectedFiles: ["src/core/mcp/routa-mcp-tool-manager.ts"],
    focusFiles: ["src/core/mcp/routa-mcp-tool-manager.ts"],
    matchedFileDetails: [],
    matchedSessionIds: ["session-123"],
    directSessions: [],
    adjacentSessions: [],
    weakSessions: [],
    openingPrompts: [],
    scopeDriftSignals: [],
    inputFrictions: [],
    environmentFrictions: [],
    repeatedFileHotspots: [],
    repeatedCommandHotspots: [],
    transcriptHints: ["~/.codex/sessions/**/session-123*.jsonl"],
    warnings: [],
    matchConfidence: "high",
    matchReasons: ["Started from 1 explicit related files on the card."],
  })),
  inspectTranscriptTurnsFromToolArgs: vi.fn(async () => ({
    sessions: [{
      provider: "codex",
      sessionId: "session-123",
      updatedAt: "2026-04-21T12:00:00.000Z",
      transcriptPath: "/tmp/session-123.jsonl",
      openingUserPrompt: "Inspect the selected test history first",
      followUpUserPrompts: [],
      matchedFilePaths: ["src/core/mcp/routa-mcp-tool-manager.ts"],
      relevantSignals: [],
      failedSignals: [],
      scopeDriftPrompts: [],
      resumeCommand: "codex resume session-123",
    }],
    missingSessionIds: [],
    warnings: [],
  })),
  loadFeatureRetrospectiveMemoryFromToolArgs: vi.fn(async () => ({
    storageRoot: "/tmp/.routa/projects/routa-js/feature-explorer/retrospectives",
    matchedMemories: [{
      scope: "file",
      targetId: "src/core/mcp/routa-mcp-tool-manager.ts",
      updatedAt: "2026-04-22T09:00:00.000Z",
      summary: "Mention the MCP tool names you expect to use before opening transcripts.",
      featureId: "feature-explorer",
      featureName: "Feature Explorer",
    }],
  })),
  saveFeatureRetrospectiveMemoryFromToolArgs: vi.fn(async () => ({
    storagePath: "/tmp/.routa/projects/routa-js/feature-explorer/retrospectives/files/src/core/mcp/routa-mcp-tool-manager.ts.json",
    saved: {
      scope: "file",
      targetId: "src/core/mcp/routa-mcp-tool-manager.ts",
      updatedAt: "2026-04-22T09:30:00.000Z",
      summary: "Start from the MCP manager and executor pair before scanning unrelated runtime code.",
      featureId: "feature-explorer",
      featureName: "Feature Explorer",
    },
  })),
  loadFeatureTreeContextFromToolArgs: vi.fn(async () => ({
    warnings: [],
    features: [{
      id: "feature-explorer",
      name: "Feature Explorer",
      summary: "Feature explorer pages, APIs, and session analysis surfaces.",
      pages: ["/workspace/:workspaceId/feature-explorer"],
      apis: ["GET /api/feature-explorer"],
      sourceFiles: ["src/core/mcp/routa-mcp-tool-manager.ts"],
      relatedFeatures: ["spec"],
      matchReasons: ["Explicit feature candidate: feature-explorer"],
      score: 40,
    }],
  })),
  confirmFeatureTreeStoryContextFromToolArgs: vi.fn(async () => ({
    warnings: [],
    selectedFeature: {
      id: "feature-explorer",
      name: "Feature Explorer",
      summary: "Feature explorer pages, APIs, and session analysis surfaces.",
      pages: ["/workspace/:workspaceId/feature-explorer"],
      apis: ["GET /api/feature-explorer"],
      sourceFiles: ["src/core/mcp/routa-mcp-tool-manager.ts"],
      relatedFeatures: ["spec"],
      matchReasons: ["Explicit feature candidate: feature-explorer"],
      score: 40,
    },
    confirmedContextSearchSpec: {
      query: "feature explorer",
      featureCandidates: ["feature-explorer"],
      relatedFiles: ["src/core/mcp/routa-mcp-tool-manager.ts"],
    },
    featureTreeYamlBlock: "feature_tree:\n  feature_id: \"feature-explorer\"",
  })),
}));

vi.mock("@/core/harness/task-adaptive-tool", () => ({
  TASK_ADAPTIVE_HARNESS_TOOL_NAME: "assemble_task_adaptive_harness",
  TASK_HISTORY_SUMMARY_TOOL_NAME: "summarize_task_history_context",
  FILE_SESSION_CONTEXT_TOOL_NAME: "summarize_file_session_context",
  TRANSCRIPT_TURN_INSPECTION_TOOL_NAME: "inspect_transcript_turns",
  LOAD_RETROSPECTIVE_MEMORY_TOOL_NAME: "load_feature_retrospective_memory",
  SAVE_RETROSPECTIVE_MEMORY_TOOL_NAME: "save_feature_retrospective_memory",
  LOAD_FEATURE_TREE_CONTEXT_TOOL_NAME: "load_feature_tree_context",
  CONFIRM_FEATURE_TREE_STORY_CONTEXT_TOOL_NAME: "confirm_feature_tree_story_context",
  assembleTaskAdaptiveHarnessFromToolArgs,
  confirmFeatureTreeStoryContextFromToolArgs,
  inspectTranscriptTurnsFromToolArgs,
  loadFeatureTreeContextFromToolArgs,
  loadFeatureRetrospectiveMemoryFromToolArgs,
  saveFeatureRetrospectiveMemoryFromToolArgs,
  summarizeFileSessionContextFromToolArgs,
  summarizeTaskHistoryContextFromToolArgs,
}));

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
    saveJitContext: vi.fn(async (params) => ({ success: true, data: params })),
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
    expect(registrations.some((entry) => entry.name === "assemble_task_adaptive_harness")).toBe(true);
    expect(registrations.some((entry) => entry.name === "summarize_task_history_context")).toBe(true);
    expect(registrations.some((entry) => entry.name === "summarize_file_session_context")).toBe(true);
    expect(registrations.some((entry) => entry.name === "inspect_transcript_turns")).toBe(true);
    expect(registrations.some((entry) => entry.name === "save_history_memory_context")).toBe(true);
    expect(registrations.some((entry) => entry.name === "load_feature_retrospective_memory")).toBe(true);
    expect(registrations.some((entry) => entry.name === "load_feature_tree_context")).toBe(true);
    expect(registrations.some((entry) => entry.name === "confirm_feature_tree_story_context")).toBe(true);
    expect(registrations.some((entry) => entry.name === "save_feature_retrospective_memory")).toBe(true);

    const createTaskTool = registrations.find((entry) => entry.name === "create_task");
    const noteTool = registrations.find((entry) => entry.name === "create_note");
    const delegateTool = registrations.find((entry) => entry.name === "delegate_task_to_agent");
    const canvasSdkTool = registrations.find((entry) => entry.name === "read_canvas_sdk_resource");
    const specialistSpecTool = registrations.find((entry) => entry.name === "read_specialist_spec_resource");
    const taskAdaptiveHarnessTool = registrations.find((entry) => entry.name === "assemble_task_adaptive_harness");
    const historySummaryTool = registrations.find((entry) => entry.name === "summarize_task_history_context");
    const fileSessionContextTool = registrations.find((entry) => entry.name === "summarize_file_session_context");
    const transcriptTurnInspectionTool = registrations.find((entry) => entry.name === "inspect_transcript_turns");
    const saveHistoryMemoryTool = registrations.find((entry) => entry.name === "save_history_memory_context");
    const loadRetrospectiveMemoryTool = registrations.find((entry) => entry.name === "load_feature_retrospective_memory");
    const loadFeatureTreeContextTool = registrations.find((entry) => entry.name === "load_feature_tree_context");
    const confirmFeatureTreeStoryContextTool = registrations.find((entry) => entry.name === "confirm_feature_tree_story_context");
    const saveRetrospectiveMemoryTool = registrations.find((entry) => entry.name === "save_feature_retrospective_memory");
    expect(createTaskTool).toBeDefined();
    expect(noteTool).toBeDefined();
    expect(delegateTool).toBeDefined();
    expect(canvasSdkTool).toBeDefined();
    expect(specialistSpecTool).toBeDefined();
    expect(taskAdaptiveHarnessTool).toBeDefined();
    expect(historySummaryTool).toBeDefined();
    expect(fileSessionContextTool).toBeDefined();
    expect(transcriptTurnInspectionTool).toBeDefined();
    expect(saveHistoryMemoryTool).toBeDefined();
    expect(loadRetrospectiveMemoryTool).toBeDefined();
    expect(loadFeatureTreeContextTool).toBeDefined();
    expect(confirmFeatureTreeStoryContextTool).toBeDefined();
    expect(saveRetrospectiveMemoryTool).toBeDefined();

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

    const confirmFeatureTreeResult = await confirmFeatureTreeStoryContextTool!.handler({
      query: "feature explorer",
    });
    expect(confirmFeatureTreeStoryContextFromToolArgs).toHaveBeenCalledWith({
      query: "feature explorer",
    }, "ws-1");
    expect(confirmFeatureTreeResult).toMatchObject({
      content: [{ type: "text" }],
      isError: false,
    });
    expect((confirmFeatureTreeResult as { content: Array<{ text: string }> }).content[0]?.text).toContain(
      '"featureTreeYamlBlock":',
    );

    const taskAdaptiveHarnessResult = await taskAdaptiveHarnessTool!.handler({
      taskLabel: "Investigate history-session loading",
      historySessionIds: ["session-123"],
    });
    expect(assembleTaskAdaptiveHarnessFromToolArgs).toHaveBeenCalledWith({
      taskLabel: "Investigate history-session loading",
      historySessionIds: ["session-123"],
    }, "ws-1");
    expect(taskAdaptiveHarnessResult).toMatchObject({
      content: [{ type: "text" }],
      isError: false,
    });

    const historySummaryResult = await historySummaryTool!.handler({
      taskLabel: "Summarize linked history",
      historySessionIds: ["session-1", "session-2"],
    });
    expect(summarizeTaskHistoryContextFromToolArgs).toHaveBeenCalledWith({
      taskLabel: "Summarize linked history",
      historySessionIds: ["session-1", "session-2"],
    }, "ws-1");
    expect(historySummaryResult).toMatchObject({
      content: [{ type: "text" }],
      isError: false,
    });

    const fileSessionContextResult = await fileSessionContextTool!.handler({
      filePaths: ["src/core/mcp/routa-mcp-tool-manager.ts"],
      historySessionIds: ["session-123"],
    });
    expect(summarizeFileSessionContextFromToolArgs).toHaveBeenCalledWith({
      filePaths: ["src/core/mcp/routa-mcp-tool-manager.ts"],
      historySessionIds: ["session-123"],
    }, "ws-1");
    expect(fileSessionContextResult).toMatchObject({
      content: [{ type: "text" }],
      isError: false,
    });

    const transcriptTurnInspectionResult = await transcriptTurnInspectionTool!.handler({
      sessionIds: ["session-123"],
      filePaths: ["src/core/mcp/routa-mcp-tool-manager.ts"],
    });
    expect(inspectTranscriptTurnsFromToolArgs).toHaveBeenCalledWith({
      sessionIds: ["session-123"],
      filePaths: ["src/core/mcp/routa-mcp-tool-manager.ts"],
    }, "ws-1");
    expect(transcriptTurnInspectionResult).toMatchObject({
      content: [{ type: "text" }],
      isError: false,
    });
    expect((transcriptTurnInspectionResult as { content: Array<{ text: string }> }).content[0]?.text).toContain(
      '"transcriptPath": "/tmp/session-123.jsonl"',
    );

    await saveHistoryMemoryTool!.handler({
      taskId: "task-1",
      summary: "Start from the MCP manager and executor pair before scanning unrelated runtime code.",
      topFiles: ["src/core/mcp/routa-mcp-tool-manager.ts"],
      reusablePrompts: ["Check the task-adaptive history memory tool registration first."],
    });
    expect(tools.saveJitContext).toHaveBeenCalledWith({
      taskId: "task-1",
      result: {
        updatedAt: undefined,
        summary: "Start from the MCP manager and executor pair before scanning unrelated runtime code.",
        topFiles: ["src/core/mcp/routa-mcp-tool-manager.ts"],
        topSessions: [],
        reusablePrompts: ["Check the task-adaptive history memory tool registration first."],
        recommendedContextSearchSpec: undefined,
      },
      agentId: "system",
    });

    const loadRetrospectiveMemoryResult = await loadRetrospectiveMemoryTool!.handler({
      repoPath: "/repo/default",
      featureId: "feature-explorer",
      filePaths: ["src/core/mcp/routa-mcp-tool-manager.ts"],
    });
    expect(loadFeatureRetrospectiveMemoryFromToolArgs).toHaveBeenCalledWith({
      repoPath: "/repo/default",
      featureId: "feature-explorer",
      filePaths: ["src/core/mcp/routa-mcp-tool-manager.ts"],
    }, "ws-1");
    expect((loadRetrospectiveMemoryResult as { content: Array<{ text: string }> }).content[0]?.text).toContain(
      '"matchedMemories": [',
    );

    const saveRetrospectiveMemoryResult = await saveRetrospectiveMemoryTool!.handler({
      repoPath: "/repo/default",
      scope: "file",
      filePath: "src/core/mcp/routa-mcp-tool-manager.ts",
      featureId: "feature-explorer",
      summary: "Start from the MCP manager and executor pair before scanning unrelated runtime code.",
    });
    expect(saveFeatureRetrospectiveMemoryFromToolArgs).toHaveBeenCalledWith({
      repoPath: "/repo/default",
      scope: "file",
      filePath: "src/core/mcp/routa-mcp-tool-manager.ts",
      featureId: "feature-explorer",
      summary: "Start from the MCP manager and executor pair before scanning unrelated runtime code.",
    }, "ws-1");
    expect((saveRetrospectiveMemoryResult as { content: Array<{ text: string }> }).content[0]?.text).toContain(
      '"storagePath":',
    );
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
