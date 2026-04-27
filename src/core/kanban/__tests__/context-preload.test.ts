import { beforeEach, describe, expect, it, vi } from "vitest";

const { listByWorkspaceMock, readFeatureSurfaceIndexMock } = vi.hoisted(() => ({
  listByWorkspaceMock: vi.fn(),
  readFeatureSurfaceIndexMock: vi.fn(),
}));

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => ({
    taskStore: {
      listByWorkspace: listByWorkspaceMock,
    },
  }),
}));

vi.mock("@/core/spec/feature-surface-index", () => ({
  readFeatureSurfaceIndex: readFeatureSurfaceIndexMock,
}));

import { createTask } from "@/core/models/task";
import {
  buildFeatureTreeRetrievalHints,
  buildRelevantFeatureTreePromptSection,
  buildRelevantHistoryMemoryPromptSection,
  buildSavedHistoryMemoryPromptSection,
  buildHistoryMemoryRetrievalHints,
  confirmFeatureTreeStoryContext,
  loadRelevantFeatureTreeContext,
  loadRelevantTaskHistoryMemories,
} from "../context-preload";

describe("context-preload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads matching saved task history memories from the same workspace and repo", async () => {
    const matchingTask = createTask({
      id: "task-history-1",
      title: "Persist Kanban flow events",
      objective: "Persist Kanban flow events",
      workspaceId: "default",
      jitContextSnapshot: {
        generatedAt: "2026-04-22T10:00:00.000Z",
        repoPath: "/repo",
        summary: "retrieval summary",
        matchConfidence: "high",
        matchReasons: ["shared feature"],
        warnings: [],
        matchedFileDetails: [],
        matchedSessionIds: [],
        failures: [],
        repeatedReadFiles: [],
        sessions: [],
        featureId: "kanban-workflow",
        analysis: {
          updatedAt: "2026-04-22T10:05:00.000Z",
          summary: "Start from kanban.rs and events_kanban.rs before broader MCP scanning.",
          topFiles: [
            "crates/routa-server/src/api/kanban.rs",
            "crates/routa-server/src/api/mcp_routes/tool_executor/events_kanban.rs",
          ],
          topSessions: [{
            sessionId: "019daf46-1a5b-7001-8a17-df4a7053ace0",
            provider: "codex",
            reason: "Directly covers the flow-event write path.",
          }],
          reusablePrompts: ["Verify the write path before dashboard work."],
          recommendedContextSearchSpec: {
            featureCandidates: ["kanban-workflow"],
            relatedFiles: ["crates/routa-server/src/api/kanban.rs"],
          },
        },
      },
    });

    const unrelatedTask = createTask({
      id: "task-history-2",
      title: "Inspect feature explorer regressions",
      objective: "Inspect feature explorer regressions",
      workspaceId: "default",
      jitContextSnapshot: {
        generatedAt: "2026-04-22T09:00:00.000Z",
        repoPath: "/other-repo",
        summary: "retrieval summary",
        matchConfidence: "medium",
        matchReasons: [],
        warnings: [],
        matchedFileDetails: [],
        matchedSessionIds: [],
        failures: [],
        repeatedReadFiles: [],
        sessions: [],
        analysis: {
          summary: "Look at feature explorer first.",
          topFiles: ["src/app/workspace/[workspaceId]/feature-explorer/page.tsx"],
          topSessions: [],
          reusablePrompts: [],
        },
      },
    });

    listByWorkspaceMock.mockResolvedValue([matchingTask, unrelatedTask]);

    const entries = await loadRelevantTaskHistoryMemories({
      workspaceId: "default",
      repoPath: "/repo",
      hints: buildHistoryMemoryRetrievalHints({
        taskLabel: "Build persistent Kanban flow events",
        query: "kanban flow event persistence",
        featureIds: ["kanban-workflow"],
        filePaths: ["crates/routa-server/src/api/kanban.rs"],
      }),
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      taskId: "task-history-1",
      title: "Persist Kanban flow events",
    });
    expect(entries[0]?.topFiles).toEqual(expect.arrayContaining([
      "crates/routa-server/src/api/kanban.rs",
    ]));
    expect(entries[0]?.matchReasons.join(" ")).toContain("Shared feature candidates");
  });

  it("builds a prompt-ready relevant history memory section", () => {
    const section = buildRelevantHistoryMemoryPromptSection([{
      taskId: "task-history-1",
      title: "Persist Kanban flow events",
      summary: "Start from kanban.rs and events_kanban.rs before broader MCP scanning.",
      topFiles: ["crates/routa-server/src/api/kanban.rs"],
      topSessions: [{
        sessionId: "019daf46-1a5b-7001-8a17-df4a7053ace0",
        provider: "codex",
        reason: "Directly covers the flow-event write path.",
      }],
      reusablePrompts: ["Verify the write path before dashboard work."],
      matchReasons: ["Shared feature candidates: kanban-workflow"],
      score: 42,
      updatedAt: "2026-04-22T10:05:00.000Z",
    }], "en");

    expect(section).toContain("## Relevant History Memory");
    expect(section).toContain("Persist Kanban flow events");
    expect(section).toContain("Top files: crates/routa-server/src/api/kanban.rs");
    expect(section).toContain("Reusable prompts: Verify the write path before dashboard work.");
  });

  it("loads relevant feature tree context from feature ids and files", async () => {
    readFeatureSurfaceIndexMock.mockResolvedValue({
      repoRoot: "/repo",
      warnings: [],
      generatedAt: "2026-04-22T10:00:00.000Z",
      pages: [],
      apis: [],
      contractApis: [],
      nextjsApis: [],
      rustApis: [],
      implementationApis: [],
      metadata: {
        schemaVersion: 1,
        capabilityGroups: [],
        features: [{
          id: "kanban-workflow",
          name: "Kanban Workflow",
          summary: "Board flow, automation, and event persistence surfaces.",
          pages: ["/workspace/:workspaceId/kanban"],
          apis: ["POST /api/kanban/events"],
          sourceFiles: [
            "crates/routa-server/src/api/kanban.rs",
            "src/app/api/kanban/events/route.ts",
          ],
          relatedFeatures: ["tasks"],
        }],
      },
    });

    const result = await loadRelevantFeatureTreeContext({
      repoPath: "/repo",
      hints: buildFeatureTreeRetrievalHints({
        featureIds: ["kanban-workflow"],
        query: "kanban flow event persistence",
        filePaths: ["crates/routa-server/src/api/kanban.rs"],
        routeCandidates: ["/workspace/:workspaceId/kanban"],
      }),
    });

    expect(result.features).toHaveLength(1);
    expect(result.features[0]).toMatchObject({
      id: "kanban-workflow",
      name: "Kanban Workflow",
    });
    expect(result.features[0]?.matchReasons.join(" ")).toContain("Explicit feature candidate");
  });

  it("normalizes confirmed feature routes and returns a story-indented YAML block", async () => {
    readFeatureSurfaceIndexMock.mockResolvedValue({
      repoRoot: "/repo",
      warnings: [],
      generatedAt: "2026-04-22T10:00:00.000Z",
      pages: [],
      apis: [],
      contractApis: [],
      nextjsApis: [],
      rustApis: [],
      implementationApis: [],
      metadata: {
        schemaVersion: 1,
        capabilityGroups: [],
        features: [{
          id: "kanban-workflow",
          name: "Kanban Workflow",
          summary: "Board flow, automation, and event persistence surfaces.",
          pages: ["/workspace/:workspaceId/kanban/"],
          apis: ["POST   /API/KANBAN/EVENTS"],
          sourceFiles: ["crates/routa-server/src/api/kanban.rs"],
          relatedFeatures: ["tasks"],
        }],
      },
    });

    const result = await confirmFeatureTreeStoryContext({
      repoPath: "/repo",
      hints: buildFeatureTreeRetrievalHints({
        featureIds: ["kanban-workflow"],
        query: "kanban flow event persistence",
      }),
    });

    expect(result.confirmedContextSearchSpec).toMatchObject({
      featureCandidates: ["kanban-workflow"],
      relatedFiles: ["crates/routa-server/src/api/kanban.rs"],
      routeCandidates: ["/workspace/:workspaceId/kanban"],
      apiCandidates: ["post /api/kanban/events"],
    });
    expect(result.featureTreeYamlBlock).toContain("  feature_tree:");
    expect(result.featureTreeYamlBlock).toContain("    pages:");
    expect(result.featureTreeYamlBlock).toContain("      - \"/workspace/:workspaceId/kanban\"");
  });

  it("renders saved history memory for task prompts", () => {
    const task = createTask({
      id: "task-history-3",
      title: "Reuse history memory",
      objective: "Reuse history memory",
      workspaceId: "default",
      jitContextSnapshot: {
        generatedAt: "2026-04-22T10:00:00.000Z",
        summary: "retrieval summary",
        matchConfidence: "high",
        matchReasons: [],
        warnings: [],
        matchedFileDetails: [],
        matchedSessionIds: [],
        failures: [],
        repeatedReadFiles: [],
        sessions: [],
        analysis: {
          updatedAt: "2026-04-22T10:05:00.000Z",
          summary: "Start from kanban.rs first.",
          topFiles: ["crates/routa-server/src/api/kanban.rs"],
          topSessions: [{
            sessionId: "019daf46-1a5b-7001-8a17-df4a7053ace0",
            reason: "Direct match",
          }],
          reusablePrompts: ["Start from kanban.rs first."],
          recommendedContextSearchSpec: {
            featureCandidates: ["kanban-workflow"],
          },
        },
      },
    });

    const section = buildSavedHistoryMemoryPromptSection(task);

    expect(section).toContain("## Saved History Memory");
    expect(section).toContain("Top files: crates/routa-server/src/api/kanban.rs");
    expect(section).toContain("Recommended context search spec");
  });

  it("renders a prompt-ready feature tree section", () => {
    const section = buildRelevantFeatureTreePromptSection([{
      id: "kanban-workflow",
      name: "Kanban Workflow",
      summary: "Board flow, automation, and event persistence surfaces.",
      pages: ["/workspace/:workspaceId/kanban"],
      apis: ["POST /api/kanban/events"],
      sourceFiles: ["crates/routa-server/src/api/kanban.rs"],
      relatedFeatures: ["tasks"],
      matchReasons: ["Explicit feature candidate: kanban-workflow"],
      score: 40,
    }]);

    expect(section).toContain("## Relevant Feature Tree Context");
    expect(section).toContain("Kanban Workflow (kanban-workflow)");
    expect(section).toContain("Source files: crates/routa-server/src/api/kanban.rs");
  });
});
