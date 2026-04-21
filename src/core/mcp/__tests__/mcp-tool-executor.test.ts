import { describe, expect, it, vi } from "vitest";

const { assembleTaskAdaptiveHarnessFromToolArgs } = vi.hoisted(() => ({
  assembleTaskAdaptiveHarnessFromToolArgs: vi.fn(async () => ({
    summary: "Recovered read failures and repeated path lookups from history.",
    warnings: [],
    selectedFiles: ["src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx"],
    matchedSessionIds: ["session-123"],
    failures: [],
    repeatedReadFiles: [],
    sessions: [],
  })),
}));

vi.mock("@/core/harness/task-adaptive-tool", () => ({
  TASK_ADAPTIVE_HARNESS_TOOL_NAME: "assemble_task_adaptive_harness",
  assembleTaskAdaptiveHarnessFromToolArgs,
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
  });
});
