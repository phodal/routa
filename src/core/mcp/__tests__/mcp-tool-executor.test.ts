import { describe, expect, it, vi } from "vitest";

const {
  assembleTaskAdaptiveHarnessFromToolArgs,
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
}));

vi.mock("@/core/harness/task-adaptive-tool", () => ({
  TASK_ADAPTIVE_HARNESS_TOOL_NAME: "assemble_task_adaptive_harness",
  TASK_HISTORY_SUMMARY_TOOL_NAME: "summarize_task_history_context",
  FILE_SESSION_CONTEXT_TOOL_NAME: "summarize_file_session_context",
  assembleTaskAdaptiveHarnessFromToolArgs,
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
});
