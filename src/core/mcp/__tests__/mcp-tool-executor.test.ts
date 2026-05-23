import { describe, expect, it, vi } from "vitest";

const {
  assembleTaskAdaptiveHarnessFromToolArgs,
  confirmFeatureTreeStoryContextFromToolArgs,
  inspectTranscriptTurnsFromToolArgs,
  loadFeatureTreeContextFromToolArgs,
  loadFeatureRetrospectiveMemoryFromToolArgs,
  saveReasoningMemoryFromToolArgs,
  saveFeatureRetrospectiveMemoryFromToolArgs,
  searchReasoningMemoriesFromToolArgs,
  summarizeFileSessionContextFromToolArgs,
  summarizeTaskHistoryContextFromToolArgs,
} = vi.hoisted(() => ({
  assembleTaskAdaptiveHarnessFromToolArgs: vi.fn(async () => ({
    summary: "Recovered read failures and repeated path lookups from history.",
    warnings: [],
    selectedFiles: ["src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx"],
    matchedFileDetails: [{
      filePath: "src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx",
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
    selectedFiles: ["src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx"],
    matchedFileDetails: [],
    matchedSessionIds: ["session-123"],
    warnings: [],
  })),
  summarizeFileSessionContextFromToolArgs: vi.fn(async () => ({
    selectedFiles: ["src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx"],
    focusFiles: ["src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx"],
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
      matchedFilePaths: ["src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx"],
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
      targetId: "src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx",
      updatedAt: "2026-04-22T09:00:00.000Z",
      summary: "Open with the exact file path and ask for a read-only retrospective first.",
      featureId: "kanban-workflow",
      featureName: "Kanban Workflow",
    }],
  })),
  saveFeatureRetrospectiveMemoryFromToolArgs: vi.fn(async () => ({
    storagePath: "/tmp/.routa/projects/routa-js/feature-explorer/retrospectives/files/src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx.json",
    saved: {
      scope: "file",
      targetId: "src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx",
      updatedAt: "2026-04-22T09:30:00.000Z",
      summary: "State the API entry point and whether transcript JSONL reads are allowed.",
      featureId: "kanban-workflow",
      featureName: "Kanban Workflow",
    },
  })),
  searchReasoningMemoriesFromToolArgs: vi.fn(async () => ({
    storagePath: "/tmp/.routa/projects/routa-js/reasoning-memory/memories.json",
    memories: [{
      id: "memory-1",
      title: "Preserve route contracts",
      content: "Add contract tests before reshaping API route behavior.",
      outcome: "failure",
      score: 98,
      matchReasons: ["feature kanban-workflow"],
    }],
    promptSection: "## Relevant Strategy Memory\n\n1. Preserve route contracts",
  })),
  saveReasoningMemoryFromToolArgs: vi.fn(async () => ({
    storagePath: "/tmp/.routa/projects/routa-js/reasoning-memory/memories.json",
    saved: {
      id: "memory-1",
      title: "Preserve route contracts",
      content: "Add contract tests before reshaping API route behavior.",
      outcome: "failure",
    },
  })),
  loadFeatureTreeContextFromToolArgs: vi.fn(async () => ({
    warnings: [],
    features: [{
      id: "kanban-workflow",
      name: "Kanban Workflow",
      summary: "Board flow, automation, and event persistence surfaces.",
      pages: ["/workspace/:workspaceId/kanban"],
      apis: ["POST /api/kanban/events"],
      sourceFiles: ["src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx"],
      relatedFeatures: ["tasks"],
      matchReasons: ["Explicit feature candidate: kanban-workflow"],
      score: 42,
    }],
  })),
  confirmFeatureTreeStoryContextFromToolArgs: vi.fn(async () => ({
    warnings: [],
    selectedFeature: {
      id: "kanban-workflow",
      name: "Kanban Workflow",
      summary: "Board flow, automation, and event persistence surfaces.",
      pages: ["/workspace/:workspaceId/kanban"],
      apis: ["POST /api/kanban/events"],
      sourceFiles: ["src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx"],
      relatedFeatures: ["tasks"],
      matchReasons: ["Explicit feature candidate: kanban-workflow"],
      score: 42,
    },
    confirmedContextSearchSpec: {
      query: "kanban workflow",
      featureCandidates: ["kanban-workflow"],
      relatedFiles: ["src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx"],
      routeCandidates: ["/workspace/:workspaceId/kanban"],
      apiCandidates: ["POST /api/kanban/events"],
    },
    featureTreeYamlBlock: "feature_tree:\n  feature_id: \"kanban-workflow\"",
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
  SEARCH_REASONING_MEMORY_TOOL_NAME: "search_reasoning_memories",
  SAVE_REASONING_MEMORY_TOOL_NAME: "save_reasoning_memory",
  assembleTaskAdaptiveHarnessFromToolArgs,
  confirmFeatureTreeStoryContextFromToolArgs,
  inspectTranscriptTurnsFromToolArgs,
  loadFeatureTreeContextFromToolArgs,
  loadFeatureRetrospectiveMemoryFromToolArgs,
  saveReasoningMemoryFromToolArgs,
  saveFeatureRetrospectiveMemoryFromToolArgs,
  searchReasoningMemoriesFromToolArgs,
  summarizeFileSessionContextFromToolArgs,
  summarizeTaskHistoryContextFromToolArgs,
}));

import { executeMcpTool, getMcpToolDefinitions } from "../mcp-tool-executor";

describe("executeMcpTool", () => {
  it("reads specialist spec resources without requiring workspaceId", async () => {
    const result = await executeMcpTool(
      {} as never,
      "read_specialist_spec_resource",
      { uri: "resource://routa/specialists/feature-tree/manifest" },
    );

    expect(result).toMatchObject({
      content: [{ type: "text" }],
      isError: false,
    });
    const payload = JSON.parse((result as { content: Array<{ text: string }> }).content[0]?.text ?? "{}") as {
      text?: string;
    };
    expect(payload.text).toContain(
      '"baseRulesInPrompt": true',
    );
  });

  it("assembles task-adaptive harness packs from MCP args", async () => {
    const result = await executeMcpTool(
      {} as never,
      "assemble_task_adaptive_harness",
      {
        workspaceId: "workspace-1",
        taskLabel: "Repair Kanban history-aware loading",
        taskType: "planning",
        historySessionIds: ["session-123"],
      },
    );

    expect(assembleTaskAdaptiveHarnessFromToolArgs).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      taskLabel: "Repair Kanban history-aware loading",
      taskType: "planning",
      historySessionIds: ["session-123"],
    }, "workspace-1");
    expect(result).toMatchObject({
      content: [{ type: "text" }],
      isError: false,
    });
    expect((result as { content: Array<{ text: string }> }).content[0]?.text).toContain(
      '"matchedSessionIds": [',
    );
  });

  it("surfaces the task-adaptive harness tool in essential allowlisted profiles", () => {
    expect(
      getMcpToolDefinitions("essential", "kanban-planning").some((tool) => tool.name === "assemble_task_adaptive_harness"),
    ).toBe(true);
    expect(
      getMcpToolDefinitions("essential", "team-coordination").some((tool) => tool.name === "assemble_task_adaptive_harness"),
    ).toBe(true);
    expect(
      getMcpToolDefinitions("essential", "kanban-planning").some((tool) => tool.name === "summarize_task_history_context"),
    ).toBe(true);
    expect(
      getMcpToolDefinitions("essential", "kanban-planning").some((tool) => tool.name === "summarize_file_session_context"),
    ).toBe(true);
    expect(
      getMcpToolDefinitions("essential", "kanban-planning").some((tool) => tool.name === "inspect_transcript_turns"),
    ).toBe(true);
    expect(
      getMcpToolDefinitions("essential", "kanban-planning").some((tool) => tool.name === "load_feature_retrospective_memory"),
    ).toBe(true);
    expect(
      getMcpToolDefinitions("essential", "kanban-planning").some((tool) => tool.name === "save_feature_retrospective_memory"),
    ).toBe(true);
    expect(
      getMcpToolDefinitions("essential", "kanban-planning").some((tool) => tool.name === "search_reasoning_memories"),
    ).toBe(true);
    expect(
      getMcpToolDefinitions("essential", "kanban-planning").some((tool) => tool.name === "save_reasoning_memory"),
    ).toBe(true);
    expect(
      getMcpToolDefinitions("essential", "kanban-planning").some((tool) => tool.name === "load_feature_tree_context"),
    ).toBe(true);
    expect(
      getMcpToolDefinitions("essential", "kanban-planning").some((tool) => tool.name === "confirm_feature_tree_story_context"),
    ).toBe(true);
    expect(
      getMcpToolDefinitions("essential", "kanban-planning").some((tool) => tool.name === "save_history_memory_context"),
    ).toBe(true);
    expect(
      getMcpToolDefinitions("full", "kanban-planning").some((tool) => tool.name === "provide_artifact"),
    ).toBe(true);
    expect(
      getMcpToolDefinitions("full", "kanban-planning").some((tool) => tool.name === "list_artifacts"),
    ).toBe(true);
    expect(
      getMcpToolDefinitions("full", "kanban-planning").some((tool) => tool.name === "get_artifact"),
    ).toBe(true);
    expect(
      getMcpToolDefinitions("full", "kanban-planning").some((tool) => tool.name === "capture_screenshot"),
    ).toBe(true);
    expect(
      getMcpToolDefinitions("full", "kanban-planning").some((tool) => tool.name === "create_note"),
    ).toBe(true);

    const loadFeatureTreeTool = getMcpToolDefinitions("essential", "kanban-planning")
      .find((tool) => tool.name === "load_feature_tree_context");
    const confirmFeatureTreeTool = getMcpToolDefinitions("essential", "kanban-planning")
      .find((tool) => tool.name === "confirm_feature_tree_story_context");
    expect((loadFeatureTreeTool?.inputSchema as { properties?: Record<string, { type?: string }> }).properties?.maxFeatures?.type)
      .toBe("integer");
    expect((confirmFeatureTreeTool?.inputSchema as { properties?: Record<string, { type?: string }> }).properties?.maxFeatures?.type)
      .toBe("integer");
  });

  it("hides protected update_task workflow fields for kanban-planning", () => {
    const updateTaskTool = getMcpToolDefinitions("full", "kanban-planning")
      .find((tool) => tool.name === "update_task");
    const properties = updateTaskTool?.inputSchema?.properties as Record<string, unknown> | undefined;

    expect(properties).toBeDefined();
    expect(properties).toHaveProperty("scope");
    expect(properties).toHaveProperty("acceptanceCriteria");
    expect(properties).not.toHaveProperty("status");
    expect(properties).not.toHaveProperty("completionSummary");
    expect(properties).not.toHaveProperty("verificationVerdict");
    expect(properties).not.toHaveProperty("assignedTo");
  });

  it("blocks kanban-planning update_task calls that try to write workflow metadata", async () => {
    const tools = {
      updateTask: vi.fn(async () => ({
        success: true,
        data: { taskId: "task-1" },
      })),
    } as never;

    const result = await executeMcpTool(
      tools,
      "update_task",
      {
        workspaceId: "workspace-1",
        taskId: "task-1",
        status: "COMPLETED",
        verificationVerdict: "APPROVED",
      },
      undefined,
      undefined,
      undefined,
      "kanban-planning",
    );

    expect((tools as { updateTask: ReturnType<typeof vi.fn> }).updateTask).not.toHaveBeenCalled();
    expect(result).toMatchObject({ isError: true });
    expect((result as { content: Array<{ text: string }> }).content[0]?.text).toContain(
      "protected task workflow fields",
    );
  });

  it("allows kanban-planning update_task calls for story-readiness fields", async () => {
    const tools = {
      updateTask: vi.fn(async (params) => ({
        success: true,
        data: { taskId: params.taskId, updatedFields: Object.keys(params.updates) },
      })),
    } as never;

    const result = await executeMcpTool(
      tools,
      "update_task",
      {
        workspaceId: "workspace-1",
        taskId: "task-1",
        scope: "Clarify the story boundary",
        acceptanceCriteria: ["Story fields are complete"],
        verificationCommands: ["npm run test -- kanban"],
        testCases: ["Move gate can read structured fields"],
      },
      undefined,
      undefined,
      undefined,
      "kanban-planning",
    );

    expect((tools as { updateTask: ReturnType<typeof vi.fn> }).updateTask).toHaveBeenCalledWith({
      taskId: "task-1",
      expectedVersion: undefined,
      agentId: "system",
      sessionId: undefined,
      updates: expect.objectContaining({
        scope: "Clarify the story boundary",
        acceptanceCriteria: ["Story fields are complete"],
        verificationCommands: ["npm run test -- kanban"],
        testCases: ["Move gate can read structured fields"],
      }),
    });
    expect(result).toMatchObject({ isError: false });
  });

  it("loads prompt-ready feature tree context from MCP args", async () => {
    const result = await executeMcpTool(
      {} as never,
      "load_feature_tree_context",
      {
        workspaceId: "workspace-1",
        featureIds: ["kanban-workflow"],
        filePaths: ["src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx"],
      },
    );

    expect(loadFeatureTreeContextFromToolArgs).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      featureIds: ["kanban-workflow"],
      filePaths: ["src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx"],
    }, "workspace-1");
    expect(result).toMatchObject({
      content: [{ type: "text" }],
      isError: false,
    });
    expect((result as { content: Array<{ text: string }> }).content[0]?.text).toContain(
      '"kanban-workflow"',
    );
  });

  it("confirms prompt-ready feature tree story context from MCP args", async () => {
    const result = await executeMcpTool(
      {} as never,
      "confirm_feature_tree_story_context",
      {
        workspaceId: "workspace-1",
        query: "kanban workflow",
      },
    );

    expect(confirmFeatureTreeStoryContextFromToolArgs).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      query: "kanban workflow",
    }, "workspace-1");
    expect(result).toMatchObject({
      content: [{ type: "text" }],
      isError: false,
    });
    expect((result as { content: Array<{ text: string }> }).content[0]?.text).toContain(
      '"featureTreeYamlBlock":',
    );
  });

  it("builds compressed history summaries from MCP args", async () => {
    const result = await executeMcpTool(
      {} as never,
      "summarize_task_history_context",
      {
        workspaceId: "workspace-1",
        taskLabel: "Summarize Kanban history",
        historySessionIds: ["session-1", "session-2"],
      },
    );

    expect(summarizeTaskHistoryContextFromToolArgs).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      taskLabel: "Summarize Kanban history",
      historySessionIds: ["session-1", "session-2"],
    }, "workspace-1");
    expect(result).toMatchObject({
      content: [{ type: "text" }],
      isError: false,
    });
    expect((result as { content: Array<{ text: string }> }).content[0]?.text).toContain(
      '"historySummary": {',
    );
  });

  it("builds file-session context summaries from MCP args", async () => {
    const result = await executeMcpTool(
      {} as never,
      "summarize_file_session_context",
      {
        workspaceId: "workspace-1",
        filePaths: ["src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx"],
        historySessionIds: ["session-123"],
      },
    );

    expect(summarizeFileSessionContextFromToolArgs).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      filePaths: ["src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx"],
      historySessionIds: ["session-123"],
    }, "workspace-1");
    expect(result).toMatchObject({
      content: [{ type: "text" }],
      isError: false,
    });
    expect((result as { content: Array<{ text: string }> }).content[0]?.text).toContain(
      '"focusFiles": [',
    );
  });

  it("inspects transcript turns from MCP args", async () => {
    const result = await executeMcpTool(
      {} as never,
      "inspect_transcript_turns",
      {
        workspaceId: "workspace-1",
        sessionIds: ["session-123"],
        filePaths: ["src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx"],
      },
    );

    expect(inspectTranscriptTurnsFromToolArgs).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      sessionIds: ["session-123"],
      filePaths: ["src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx"],
    }, "workspace-1");
    expect(result).toMatchObject({
      content: [{ type: "text" }],
      isError: false,
    });
    expect((result as { content: Array<{ text: string }> }).content[0]?.text).toContain(
      '"transcriptPath": "/tmp/session-123.jsonl"',
    );
  });

  it("loads saved retrospective memory from MCP args", async () => {
    const result = await executeMcpTool(
      {} as never,
      "load_feature_retrospective_memory",
      {
        workspaceId: "workspace-1",
        featureId: "kanban-workflow",
        filePaths: ["src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx"],
      },
    );

    expect(loadFeatureRetrospectiveMemoryFromToolArgs).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      featureId: "kanban-workflow",
      filePaths: ["src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx"],
    }, "workspace-1");
    expect((result as { content: Array<{ text: string }> }).content[0]?.text).toContain(
      '"matchedMemories": [',
    );
  });

  it("saves retrospective memory through MCP args", async () => {
    const result = await executeMcpTool(
      {} as never,
      "save_feature_retrospective_memory",
      {
        workspaceId: "workspace-1",
        scope: "file",
        filePath: "src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx",
        featureId: "kanban-workflow",
        summary: "State the API entry point and whether transcript JSONL reads are allowed.",
      },
    );

    expect(saveFeatureRetrospectiveMemoryFromToolArgs).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      scope: "file",
      filePath: "src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx",
      featureId: "kanban-workflow",
      summary: "State the API entry point and whether transcript JSONL reads are allowed.",
    }, "workspace-1");
    expect((result as { content: Array<{ text: string }> }).content[0]?.text).toContain(
      '"storagePath":',
    );
  });

  it("searches strategy memory through MCP args", async () => {
    const result = await executeMcpTool(
      {} as never,
      "search_reasoning_memories",
      {
        workspaceId: "workspace-1",
        query: "kanban API route parity",
        featureIds: ["kanban-workflow"],
        filePaths: ["src/app/api/kanban/route.ts"],
        lane: "dev",
        provider: "codex",
      },
    );

    expect(searchReasoningMemoriesFromToolArgs).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      query: "kanban API route parity",
      featureIds: ["kanban-workflow"],
      filePaths: ["src/app/api/kanban/route.ts"],
      lane: "dev",
      provider: "codex",
    }, "workspace-1");
    expect((result as { content: Array<{ text: string }> }).content[0]?.text).toContain(
      '"promptSection": "## Relevant Strategy Memory',
    );
  });

  it("saves strategy memory through MCP args", async () => {
    const result = await executeMcpTool(
      {} as never,
      "save_reasoning_memory",
      {
        workspaceId: "workspace-1",
        title: "Preserve route contracts",
        content: "Add contract tests before reshaping API route behavior.",
        outcome: "failure",
        featureId: "kanban-workflow",
        filePaths: ["src/app/api/kanban/route.ts"],
        lane: "dev",
        provider: "codex",
      },
    );

    expect(saveReasoningMemoryFromToolArgs).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      title: "Preserve route contracts",
      content: "Add contract tests before reshaping API route behavior.",
      outcome: "failure",
      featureId: "kanban-workflow",
      filePaths: ["src/app/api/kanban/route.ts"],
      lane: "dev",
      provider: "codex",
    }, "workspace-1");
    expect((result as { content: Array<{ text: string }> }).content[0]?.text).toContain(
      '"saved": {',
    );
  });

  it("saves task-adaptive history memory through MCP args", async () => {
    const tools = {
      saveJitContext: vi.fn(async (params) => ({
        success: true,
        data: {
          taskId: params.taskId,
          saved: true,
          summary: params.result.summary,
          topFiles: params.result.topFiles,
          topSessions: params.result.topSessions,
          reusablePrompts: params.result.reusablePrompts,
        },
      })),
    } as never;

    const result = await executeMcpTool(
      tools,
      "save_history_memory_context",
      {
        workspaceId: "workspace-1",
        taskId: "task-1",
        summary: "Start from the Kanban API and blocked interval reconstruction.",
        topFiles: ["crates/routa-server/src/api/kanban.rs"],
        topSessions: [
          {
            sessionId: "session-123",
            provider: "codex",
            reason: "Touched the durable flow-event implementation directly.",
          },
        ],
        reusablePrompts: ["Check Rust and TS flow-event parity first."],
        recommendedContextSearchSpec: {
          query: "kanban flow event persistence",
          featureCandidates: ["kanban-workflow"],
        },
      },
    );

    expect((tools as { saveJitContext: ReturnType<typeof vi.fn> }).saveJitContext).toHaveBeenCalledWith({
      taskId: "task-1",
      result: {
        updatedAt: expect.any(String),
        summary: "Start from the Kanban API and blocked interval reconstruction.",
        topFiles: ["crates/routa-server/src/api/kanban.rs"],
        topSessions: [
          {
            sessionId: "session-123",
            provider: "codex",
            reason: "Touched the durable flow-event implementation directly.",
          },
        ],
        reusablePrompts: ["Check Rust and TS flow-event parity first."],
        recommendedContextSearchSpec: {
          query: "kanban flow event persistence",
          featureCandidates: ["kanban-workflow"],
        },
      },
      agentId: "system",
    });
    expect((result as { content: Array<{ text: string }> }).content[0]?.text).toContain(
      '"saved": true',
    );
  });
});
