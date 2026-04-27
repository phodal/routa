import { describe, expect, it } from "vitest";

import { getHttpSessionStore } from "@/core/acp/http-session-store";
import {
  BACKLOG_CONTEXT_SEARCH_SPEC_WARNING,
  filterBacklogContextSearchSpec,
  hasConfirmedBacklogContextInspection,
} from "@/core/kanban/backlog-context-confirmation";

function seedSessionHistory(params: {
  sessionId: string;
  tool?: string;
  kind?: string;
  title?: string;
  rawInput?: Record<string, unknown>;
  rawOutput?: unknown;
}) {
  const store = getHttpSessionStore();
  store.upsertSession({
    sessionId: params.sessionId,
    workspaceId: "workspace-1",
    cwd: "/tmp/repo",
    createdAt: new Date().toISOString(),
  });
  store.pushNotificationToHistory(params.sessionId, {
    sessionId: params.sessionId,
    update: {
      sessionUpdate: "tool_call",
      tool: params.tool,
      kind: params.kind,
      title: params.title,
      rawInput: params.rawInput,
      rawOutput: params.rawOutput,
    },
  });
}

describe("backlog context confirmation", () => {
  it("treats read-like MCP tools as confirming backlog inspection", async () => {
    const sessionId = `session-read-${Date.now()}`;
    seedSessionHistory({
      sessionId,
      tool: "load_feature_tree_context",
      kind: "glob",
    });

    await expect(hasConfirmedBacklogContextInspection(sessionId)).resolves.toBe(true);
  });

  it("treats feature-tree story confirmation as confirming backlog inspection", async () => {
    const sessionId = `session-feature-tree-${Date.now()}`;
    seedSessionHistory({
      sessionId,
      tool: "confirm_feature_tree_story_context",
      kind: "task",
      rawOutput: {
        content: [{
          type: "text",
          text: JSON.stringify({
            confirmedContextSearchSpec: {
              featureCandidates: ["kanban-workflow"],
              relatedFiles: ["src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx"],
            },
          }),
        }],
      },
    });

    await expect(hasConfirmedBacklogContextInspection(sessionId)).resolves.toBe(true);
  });

  it("does not treat empty feature-tree story confirmation output as confirmed", async () => {
    const sessionId = `session-feature-tree-empty-${Date.now()}`;
    seedSessionHistory({
      sessionId,
      tool: "confirm_feature_tree_story_context",
      kind: "task",
      rawOutput: {
        content: [{
          type: "text",
          text: JSON.stringify({
            warnings: ["No matching feature tree entry found."],
          }),
        }],
      },
    });

    await expect(hasConfirmedBacklogContextInspection(sessionId)).resolves.toBe(false);
  });

  it("treats shell rg commands as confirming backlog inspection", async () => {
    const sessionId = `session-rg-${Date.now()}`;
    seedSessionHistory({
      sessionId,
      kind: "bash",
      rawInput: { command: "rg --files src/app" },
    });

    await expect(hasConfirmedBacklogContextInspection(sessionId)).resolves.toBe(true);
  });

  it("strips speculative backlog context when the session has not inspected the repo", async () => {
    const sessionId = `session-no-confirm-${Date.now()}`;
    seedSessionHistory({
      sessionId,
      tool: "move_card",
      kind: "task",
    });

    const result = await filterBacklogContextSearchSpec({
      contextSearchSpec: {
        query: "superpowers import",
        featureCandidates: ["feature-explorer"],
      },
      columnId: "backlog",
      sessionId,
    });

    expect(result).toEqual({
      contextSearchSpec: undefined,
      stripped: true,
      warning: BACKLOG_CONTEXT_SEARCH_SPEC_WARNING,
    });
  });
});
