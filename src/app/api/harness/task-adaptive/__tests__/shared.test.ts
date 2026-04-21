/**
 * @vitest-environment node
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assembleTaskAdaptiveHarness,
  loadTaskAdaptiveFrictionProfiles,
  refreshTaskAdaptiveFrictionProfiles,
  summarizeFileSessionContext,
} from "../shared";

function ensureFile(filePath: string, content = ""): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeFeatureSurfaceIndex(
  repoRoot: string,
  payload: Record<string, unknown>,
): void {
  ensureFile(
    path.join(repoRoot, "docs", "product-specs", "feature-tree.index.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
}

function writeTranscript(
  filePath: string,
  cwd: string,
  sessionId: string,
  events: unknown[],
): void {
  ensureFile(
    filePath,
    [
      JSON.stringify({
        timestamp: "2026-04-21T01:00:00.000Z",
        type: "session_meta",
        payload: {
          id: sessionId,
          timestamp: "2026-04-21T01:00:00.000Z",
          cwd,
          source: "cli",
          model_provider: "openai",
        },
      }),
      ...events.map((event) => JSON.stringify(event)),
      "",
    ].join("\n"),
  );
}

function writeFeatureTreeIndex(repoRoot: string, features: Array<{
  id: string;
  name: string;
  sourceFiles: string[];
}>): void {
  ensureFile(
    path.join(repoRoot, "docs/product-specs/feature-tree.index.json"),
    JSON.stringify({
      metadata: {
        features: features.map((feature) => ({
          id: feature.id,
          name: feature.name,
          group: "test",
          summary: `${feature.name} summary`,
          status: "active",
          pages: [],
          apis: [],
          sourceFiles: feature.sourceFiles,
          relatedFeatures: [],
          domainObjects: [],
        })),
      },
    }, null, 2),
  );
}

describe("assembleTaskAdaptiveHarness", () => {
  const originalHome = process.env.HOME;
  const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
  });

  it("prioritizes failed reads and repeated reads in the compiled pack", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-adaptive-harness-"));
    process.env.HOME = tempRoot;
    process.env.CLAUDE_CONFIG_DIR = "";

    const repoRoot = path.join(tempRoot, "repo");
    ensureFile(path.join(repoRoot, "src/app/page.tsx"), "export default function Page() { return null; }\n");

    writeTranscript(
      path.join(tempRoot, ".codex", "sessions", "session-a.jsonl"),
      repoRoot,
      "session-a",
      [
        {
          timestamp: "2026-04-21T01:01:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Implement task-adaptive loading for page context",
          },
        },
        {
          timestamp: "2026-04-21T01:02:00.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: "{\"cmd\":\"sed -n '1,200p' src/app/page.tsx\"}",
          },
        },
        {
          timestamp: "2026-04-21T01:02:10.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "sed -n '1,200p' src/app/page.tsx"],
            aggregated_output: "export default function Page() { return null; }\n",
            exit_code: 0,
          },
        },
        {
          timestamp: "2026-04-21T01:03:00.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: "{\"cmd\":\"sed -n '1,200p' src/app/page.tsx\"}",
          },
        },
        {
          timestamp: "2026-04-21T01:03:05.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "sed -n '1,200p' src/app/page.tsx"],
            stderr: "Operation not permitted",
            exit_code: 1,
            status: "failed",
          },
        },
        {
          timestamp: "2026-04-21T01:04:00.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "git status --short"],
            aggregated_output: " M src/app/page.tsx\n",
            exit_code: 0,
          },
        },
      ],
    );

    const pack = await assembleTaskAdaptiveHarness(repoRoot, {
      taskLabel: "Task-adaptive loading",
      filePaths: ["src/app/page.tsx"],
      taskType: "analysis",
    });

    expect(pack.failures[0]).toMatchObject({
      sessionId: "session-a",
      toolName: "exec_command",
      message: "Operation not permitted",
    });
    expect(pack.repeatedReadFiles).toContain("src/app/page.tsx");
    expect(pack.sessions[0]).toMatchObject({
      sessionId: "session-a",
      matchedFiles: ["src/app/page.tsx"],
      matchedReadFiles: ["src/app/page.tsx"],
      matchedChangedFiles: ["src/app/page.tsx"],
      repeatedReadFiles: ["src/app/page.tsx"],
    });
    expect(pack.summary).toContain("High-Priority Friction Signals");
    expect(pack.summary).toContain("Operation not permitted");
    expect(pack.matchConfidence).toBe("high");
    expect(pack.matchReasons).toContain("Started from 1 explicit related files on the card.");
    expect(pack.matchedFileDetails).toEqual([expect.objectContaining({
      filePath: "src/app/page.tsx",
      changes: 1,
      sessions: 1,
      updatedAt: expect.stringContaining("2026-04-21T01:04:00"),
    })]);
    expect(pack.recommendedToolMode).toBe("essential");
    expect(pack.recommendedAllowedNativeTools).toEqual(["Read", "Grep", "Glob"]);
  });

  it("infers relevant files from selected history session ids when files are omitted", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-adaptive-harness-session-ids-"));
    process.env.HOME = tempRoot;
    process.env.CLAUDE_CONFIG_DIR = "";

    const repoRoot = path.join(tempRoot, "repo");
    ensureFile(path.join(repoRoot, "src/app/layout.tsx"), "export default function Layout({ children }: { children: React.ReactNode }) { return children; }\n");

    writeTranscript(
      path.join(tempRoot, ".codex", "sessions", "session-b.jsonl"),
      repoRoot,
      "session-b",
      [
        {
          timestamp: "2026-04-21T02:01:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Inspect layout context first",
          },
        },
        {
          timestamp: "2026-04-21T02:02:00.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: "{\"cmd\":\"sed -n '1,200p' src/app/layout.tsx\"}",
          },
        },
        {
          timestamp: "2026-04-21T02:03:00.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "git status --short"],
            aggregated_output: " M src/app/layout.tsx\n",
            exit_code: 0,
          },
        },
      ],
    );

    const pack = await assembleTaskAdaptiveHarness(repoRoot, {
      historySessionIds: ["session-b"],
      taskType: "planning",
    });

    expect(pack.selectedFiles).toContain("src/app/layout.tsx");
    expect(pack.matchedFileDetails).toEqual([expect.objectContaining({
      filePath: "src/app/layout.tsx",
      changes: 1,
      sessions: 1,
      updatedAt: expect.stringContaining("2026-04-21T02:03:00"),
    })]);
    expect(pack.matchedSessionIds).toContain("session-b");
    expect(pack.historySummary).toMatchObject({
      seedSessionCount: 1,
      recoveredSessionCount: 1,
      matchedFileCount: 1,
      seedSessions: [expect.objectContaining({
        sessionId: "session-b",
        touchedFiles: ["src/app/layout.tsx"],
      })],
    });
    expect(pack.recommendedMcpProfile).toBe("kanban-planning");
    expect(pack.recommendedAllowedNativeTools).toEqual(["Read", "Grep", "Glob"]);
  });

  it("keeps explicit file paths ahead of history-session inferred files", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-adaptive-harness-priority-"));
    process.env.HOME = tempRoot;
    process.env.CLAUDE_CONFIG_DIR = "";

    const repoRoot = path.join(tempRoot, "repo");
    ensureFile(path.join(repoRoot, "src/explicit.ts"), "export const explicit = true;\n");
    ensureFile(path.join(repoRoot, "src/inferred-a.ts"), "export const inferredA = true;\n");
    ensureFile(path.join(repoRoot, "src/inferred-b.ts"), "export const inferredB = true;\n");

    writeTranscript(
      path.join(tempRoot, ".codex", "sessions", "session-priority.jsonl"),
      repoRoot,
      "session-priority",
      [
        {
          timestamp: "2026-04-21T03:01:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Inspect inferred files first",
          },
        },
        {
          timestamp: "2026-04-21T03:02:00.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: "{\"cmd\":\"sed -n '1,120p' src/inferred-a.ts\"}",
          },
        },
        {
          timestamp: "2026-04-21T03:03:00.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "git status --short"],
            aggregated_output: " M src/inferred-a.ts\n M src/inferred-b.ts\n",
            exit_code: 0,
          },
        },
      ],
    );

    const pack = await assembleTaskAdaptiveHarness(repoRoot, {
      filePaths: ["src/explicit.ts"],
      historySessionIds: ["session-priority"],
      maxFiles: 1,
      taskType: "analysis",
    });

    expect(pack.selectedFiles).toEqual(["src/explicit.ts"]);
  });

  it("infers features and files from context search hints when history and files are absent", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-adaptive-harness-hints-"));
    process.env.HOME = tempRoot;
    process.env.CLAUDE_CONFIG_DIR = "";

    const repoRoot = path.join(tempRoot, "repo");
    ensureFile(
      path.join(repoRoot, "src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx"),
      "export function KanbanCardDetail() { return null; }\n",
    );
    ensureFile(
      path.join(repoRoot, "src/app/api/tasks/route.ts"),
      "export async function POST() { return Response.json({ ok: true }); }\n",
    );
    writeFeatureSurfaceIndex(repoRoot, {
      generatedAt: "2026-04-21T12:00:00.000Z",
      pages: [{
        route: "/workspace/:workspaceId/kanban",
        title: "Kanban Board",
        description: "Backlog refine and JIT context card detail",
        sourceFile: "src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx",
      }],
      implementationApis: [{
        label: "nextjs",
        domain: "kanban",
        method: "POST",
        path: "/api/tasks",
        sourceFiles: ["src/app/api/tasks/route.ts"],
      }],
      metadata: {
        schemaVersion: 1,
        capabilityGroups: [],
        features: [{
          id: "kanban-workflow",
          name: "Kanban Workflow",
          group: "coordination",
          summary: "Backlog refine, card detail, and JIT context loading.",
          status: "active",
          pages: ["/workspace/:workspaceId/kanban"],
          apis: ["POST /api/tasks"],
          sourceFiles: [
            "src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx",
            "src/app/api/tasks/route.ts",
          ],
          relatedFeatures: ["feature-explorer"],
          domainObjects: ["task"],
        }],
      },
    });

    const pack = await assembleTaskAdaptiveHarness(repoRoot, {
      query: "kanban card detail jit context",
      routeCandidates: ["/workspace/:workspaceId/kanban"],
      apiCandidates: ["POST /api/tasks"],
      moduleHints: ["kanban-card-detail"],
      symptomHints: ["operation not permitted"],
      taskType: "planning",
    });

    expect(pack.featureId).toBe("kanban-workflow");
    expect(pack.featureName).toBe("Kanban Workflow");
    expect(pack.selectedFiles).toEqual([
      "src/app/api/tasks/route.ts",
      "src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx",
    ]);
    expect(pack.matchedFileDetails).toEqual([
      {
        filePath: "src/app/api/tasks/route.ts",
        changes: 0,
        sessions: 0,
        updatedAt: "",
      },
      {
        filePath: "src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx",
        changes: 0,
        sessions: 0,
        updatedAt: "",
      },
    ]);
    expect(pack.warnings).not.toContain("No task-adaptive files could be resolved from the current request.");
    expect(pack.matchedSessionIds).toEqual([]);
    expect(pack.matchConfidence).toBe("medium");
    expect(pack.matchReasons).toEqual(expect.arrayContaining([
      "Matched 1 route hints to page entry points.",
      "Matched 1 API hints to implementation entry points.",
    ]));
    expect(pack.summary).toContain("Kanban Workflow");
    expect(pack.summary).toContain("src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx");
  });

  it("falls back to history-session prompt and file signals when feature hints are too weak", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-adaptive-harness-signal-fallback-"));
    process.env.HOME = tempRoot;
    process.env.CLAUDE_CONFIG_DIR = "";

    const repoRoot = path.join(tempRoot, "repo");
    ensureFile(
      path.join(repoRoot, "src/core/kanban/task-flow-history.ts"),
      "export function appendTaskFlowHistory() { return null; }\n",
    );
    writeFeatureSurfaceIndex(repoRoot, {
      generatedAt: "2026-04-21T12:00:00.000Z",
      pages: [],
      implementationApis: [],
      metadata: {
        schemaVersion: 1,
        capabilityGroups: [],
        features: [],
      },
    });

    writeTranscript(
      path.join(tempRoot, ".codex", "sessions", "session-signal.jsonl"),
      repoRoot,
      "session-signal",
      [
        {
          timestamp: "2026-04-21T01:01:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Implement persistent flow event model for kanban history",
          },
        },
        {
          timestamp: "2026-04-21T01:02:00.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "git status --short"],
            aggregated_output: " M src/core/kanban/task-flow-history.ts\n",
            exit_code: 0,
          },
        },
      ],
    );

    const pack = await assembleTaskAdaptiveHarness(repoRoot, {
      query: "persistent flow event model",
      taskType: "analysis",
    });

    expect(pack.selectedFiles).toContain("src/core/kanban/task-flow-history.ts");
    expect(pack.matchConfidence).toBe("low");
    expect(pack.matchReasons).toContain(
      "Recovered 1 files from history-session prompt and file signals when feature hints were weak.",
    );
  });

  it("supports Chinese query hints when recovering files from history-session signals", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-adaptive-harness-zh-signal-fallback-"));
    process.env.HOME = tempRoot;
    process.env.CLAUDE_CONFIG_DIR = "";

    const repoRoot = path.join(tempRoot, "repo");
    ensureFile(
      path.join(repoRoot, "src/core/kanban/task-flow-history.ts"),
      "export function appendTaskFlowHistory() { return null; }\n",
    );
    writeFeatureSurfaceIndex(repoRoot, {
      generatedAt: "2026-04-21T12:00:00.000Z",
      pages: [],
      implementationApis: [],
      metadata: {
        schemaVersion: 1,
        capabilityGroups: [],
        features: [],
      },
    });

    writeTranscript(
      path.join(tempRoot, ".codex", "sessions", "session-zh-signal.jsonl"),
      repoRoot,
      "session-zh-signal",
      [
        {
          timestamp: "2026-04-21T01:01:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "为 Kanban 建立可持久化的流动事件模型",
          },
        },
        {
          timestamp: "2026-04-21T01:02:00.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "git status --short"],
            aggregated_output: " M src/core/kanban/task-flow-history.ts\n",
            exit_code: 0,
          },
        },
      ],
    );

    const pack = await assembleTaskAdaptiveHarness(repoRoot, {
      query: "为 Kanban 建立可持久化的流动事件模型",
      locale: "zh-CN",
      taskType: "analysis",
    });

    expect(pack.selectedFiles).toContain("src/core/kanban/task-flow-history.ts");
    expect(pack.matchReasons).toContain(
      "在 feature/file 线索不足时，根据 history-session prompt 和文件信号补回了 1 个文件。",
    );
  });

  it("falls back from repo root and task title when query hints are omitted", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-adaptive-harness-task-label-fallback-"));
    process.env.HOME = tempRoot;
    process.env.CLAUDE_CONFIG_DIR = "";

    const repoRoot = path.join(tempRoot, "repo");
    ensureFile(
      path.join(repoRoot, "src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx"),
      "export function KanbanPageClient() { return null; }\n",
    );
    ensureFile(
      path.join(repoRoot, "src/app/api/kanban/events/route.ts"),
      "export async function GET() { return Response.json({ ok: true }); }\n",
    );
    writeFeatureSurfaceIndex(repoRoot, {
      generatedAt: "2026-04-21T12:00:00.000Z",
      pages: [{
        route: "/workspace/:workspaceId/kanban",
        title: "Kanban Board",
        description: "Kanban board workflow with flow events and execution history.",
        sourceFile: "src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx",
      }],
      implementationApis: [{
        label: "nextjs",
        domain: "kanban",
        method: "GET",
        path: "/api/kanban/events",
        sourceFiles: ["src/app/api/kanban/events/route.ts"],
      }],
      metadata: {
        schemaVersion: 1,
        capabilityGroups: [],
        features: [{
          id: "kanban-workflow",
          name: "Kanban Workflow",
          group: "coordination",
          summary: "Persistent flow events, execution history, and kanban board lifecycle.",
          status: "active",
          pages: ["/workspace/:workspaceId/kanban"],
          apis: ["GET /api/kanban/events"],
          sourceFiles: [
            "src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx",
            "src/app/api/kanban/events/route.ts",
          ],
          relatedFeatures: [],
          domainObjects: ["task", "kanban-event"],
        }],
      },
    });

    const pack = await assembleTaskAdaptiveHarness(repoRoot, {
      taskLabel: "为 Kanban 建立可持久化的流动事件模型",
      taskType: "implementation",
      locale: "zh-CN",
    });

    expect(pack.featureId).toBe("kanban-workflow");
    expect(pack.featureName).toBe("Kanban Workflow");
    expect(pack.selectedFiles).toEqual([
      "src/app/api/kanban/events/route.ts",
      "src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx",
    ]);
    expect(pack.warnings).not.toContain("No task-adaptive files could be resolved from the current request.");
    expect(pack.matchConfidence).toBe("medium");
    expect(pack.matchReasons).toContain("根据任务标题和搜索线索收敛出 1 个 feature 候选。");
  });

  it("persists reusable friction profiles for hotspot files and features", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-adaptive-friction-profiles-"));
    process.env.HOME = tempRoot;
    process.env.CLAUDE_CONFIG_DIR = "";

    const repoRoot = path.join(tempRoot, "repo");
    ensureFile(path.join(repoRoot, "src/app/page.tsx"), "export default function Page() { return null; }\n");
    writeFeatureTreeIndex(repoRoot, [
      {
        id: "feature-explorer",
        name: "Feature Explorer",
        sourceFiles: ["src/app/page.tsx"],
      },
    ]);

    writeTranscript(
      path.join(tempRoot, ".codex", "sessions", "session-c.jsonl"),
      repoRoot,
      "session-c",
      [
        {
          timestamp: "2026-04-21T03:01:00.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: "{\"cmd\":\"sed -n '1,200p' src/app/page.tsx\"}",
          },
        },
        {
          timestamp: "2026-04-21T03:01:05.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "sed -n '1,200p' src/app/page.tsx"],
            stderr: "No such file or directory",
            exit_code: 1,
            status: "failed",
          },
        },
        {
          timestamp: "2026-04-21T03:02:00.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "git status --short"],
            aggregated_output: " M src/app/page.tsx\n",
            exit_code: 0,
          },
        },
      ],
    );

    writeTranscript(
      path.join(tempRoot, ".codex", "sessions", "session-d.jsonl"),
      repoRoot,
      "session-d",
      [
        {
          timestamp: "2026-04-21T03:03:00.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: "{\"cmd\":\"sed -n '1,200p' src/app/page.tsx\"}",
          },
        },
        {
          timestamp: "2026-04-21T03:03:04.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "sed -n '1,200p' src/app/page.tsx"],
            aggregated_output: "export default function Page() { return null; }\n",
            exit_code: 0,
          },
        },
        {
          timestamp: "2026-04-21T03:04:00.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "git status --short"],
            aggregated_output: " M src/app/page.tsx\n",
            exit_code: 0,
          },
        },
      ],
    );

    const snapshot = await refreshTaskAdaptiveFrictionProfiles(repoRoot, {
      minFileSessions: 2,
      minFeatureSessions: 2,
    });

    expect(Object.keys(snapshot.fileProfiles)).toContain("src/app/page.tsx");
    expect(Object.keys(snapshot.featureProfiles)).toContain("feature-explorer");

    const loadedSnapshot = loadTaskAdaptiveFrictionProfiles(repoRoot);
    expect(loadedSnapshot?.fileProfiles["src/app/page.tsx"]).toBeDefined();
    expect(loadedSnapshot?.featureProfiles["feature-explorer"]).toBeDefined();
  });

  it("reuses stored friction profiles before transcript fallback", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-adaptive-friction-profile-reuse-"));
    process.env.HOME = tempRoot;
    process.env.CLAUDE_CONFIG_DIR = "";

    const repoRoot = path.join(tempRoot, "repo");
    ensureFile(path.join(repoRoot, "src/app/page.tsx"), "export default function Page() { return null; }\n");
    writeFeatureTreeIndex(repoRoot, [
      {
        id: "feature-explorer",
        name: "Feature Explorer",
        sourceFiles: ["src/app/page.tsx"],
      },
    ]);

    const transcriptPath = path.join(tempRoot, ".codex", "sessions", "session-e.jsonl");
    writeTranscript(
      transcriptPath,
      repoRoot,
      "session-e",
      [
        {
          timestamp: "2026-04-21T04:01:00.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: "{\"cmd\":\"sed -n '1,200p' src/app/page.tsx\"}",
          },
        },
        {
          timestamp: "2026-04-21T04:01:04.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "sed -n '1,200p' src/app/page.tsx"],
            stderr: "Operation not permitted",
            exit_code: 1,
            status: "failed",
          },
        },
        {
          timestamp: "2026-04-21T04:02:00.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "git status --short"],
            aggregated_output: " M src/app/page.tsx\n",
            exit_code: 0,
          },
        },
      ],
    );

    await refreshTaskAdaptiveFrictionProfiles(repoRoot, {
      minFileSessions: 1,
      minFeatureSessions: 1,
    });
    fs.rmSync(transcriptPath);

    const pack = await assembleTaskAdaptiveHarness(repoRoot, {
      filePaths: ["src/app/page.tsx"],
      featureId: "feature-explorer",
      taskType: "analysis",
    });

    expect(pack.frictionProfiles).toHaveLength(2);
    expect(pack.failures[0]).toMatchObject({
      sessionId: "session-e",
      message: "Operation not permitted",
    });
    expect(pack.summary).toContain("Reusable Friction Profiles");
    expect(pack.summary).toContain("Loaded 2 reusable friction profiles");
    expect(pack.matchedSessionIds).toContain("session-e");
  });

  it("keeps explicit feature candidates ahead of inferred fallback features", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-adaptive-feature-order-"));
    process.env.HOME = tempRoot;
    process.env.CLAUDE_CONFIG_DIR = "";

    const repoRoot = path.join(tempRoot, "repo");
    ensureFile(path.join(repoRoot, "src/a2a.ts"), "export const a2a = true;\n");
    ensureFile(path.join(repoRoot, "src/feature-explorer.ts"), "export const featureExplorer = true;\n");

    writeFeatureSurfaceIndex(repoRoot, {
      metadata: {
        features: [
          {
            id: "feature-explorer",
            name: "Feature Explorer",
            group: "test",
            summary: "Feature Explorer session analysis",
            status: "active",
            pages: ["/workspace/:workspaceId/feature-explorer"],
            apis: [],
            sourceFiles: ["src/feature-explorer.ts"],
            relatedFeatures: [],
            domainObjects: [],
          },
          {
            id: "a2a",
            name: "A2A",
            group: "test",
            summary: "A2A session analysis bridge",
            status: "active",
            pages: [],
            apis: [],
            sourceFiles: ["src/a2a.ts"],
            relatedFeatures: [],
            domainObjects: [],
          },
        ],
      },
      pages: [
        {
          route: "/workspace/:workspaceId/feature-explorer",
          title: "Feature Explorer",
          description: "Session analysis page",
          sourceFile: "src/feature-explorer.ts",
        },
      ],
      implementationApis: [],
      warnings: [],
    });

    const pack = await assembleTaskAdaptiveHarness(repoRoot, {
      taskLabel: "梳理 Feature Explorer 的 session analysis 上下文",
      taskType: "analysis",
      locale: "zh-CN",
      query: "feature explorer session analysis",
      featureIds: ["feature-explorer"],
      routeCandidates: ["/workspace/:workspaceId/feature-explorer"],
      moduleHints: ["feature-explorer", "session-analysis"],
    });

    expect(pack.featureId).toBe("feature-explorer");
    expect(pack.featureName).toBe("Feature Explorer");
    expect(pack.selectedFiles[0]).toBe("src/feature-explorer.ts");
    expect(pack.matchReasons).toContain("使用了 1 个显式 feature 候选来扩展源码范围。");
  });

  it("builds file-session context summaries with direct vs adjacent evidence and friction buckets", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-adaptive-file-session-context-"));
    process.env.HOME = tempRoot;
    process.env.CLAUDE_CONFIG_DIR = "";

    const repoRoot = path.join(tempRoot, "repo");
    const focusFile = "src/app/workspace/[workspaceId]/feature-explorer/feature-explorer-page-client.tsx";
    const adjacentFile = "src/app/api/feature-explorer/route.ts";
    ensureFile(path.join(repoRoot, focusFile), "export function FeatureExplorerPageClient() { return null; }\n");
    ensureFile(path.join(repoRoot, adjacentFile), "export async function GET() { return Response.json({ ok: true }); }\n");
    writeFeatureTreeIndex(repoRoot, [
      {
        id: "feature-explorer",
        name: "Feature Explorer",
        sourceFiles: [focusFile, adjacentFile],
      },
    ]);

    writeTranscript(
      path.join(tempRoot, ".codex", "sessions", "session-direct.jsonl"),
      repoRoot,
      "session-direct",
      [
        {
          timestamp: "2026-04-21T05:01:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "http://localhost:3000/workspace/default/feature-explorer?feature=workspace-overview 这个页面帮我看一下",
          },
        },
        {
          timestamp: "2026-04-21T05:02:00.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: JSON.stringify({ cmd: `sed -n '1,200p' '${focusFile}'` }),
          },
        },
        {
          timestamp: "2026-04-21T05:02:04.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", `sed -n '1,200p' '${focusFile}'`],
            aggregated_output: "export function FeatureExplorerPageClient() { return null; }\n",
            exit_code: 0,
          },
        },
        {
          timestamp: "2026-04-21T05:03:00.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: JSON.stringify({ cmd: `sed -n '1,200p' '${focusFile}'` }),
          },
        },
        {
          timestamp: "2026-04-21T05:03:05.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", `sed -n '1,200p' '${focusFile}'`],
            aggregated_output: "export function FeatureExplorerPageClient() { return null; }\n",
            exit_code: 0,
          },
        },
        {
          timestamp: "2026-04-21T05:04:00.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: JSON.stringify({ cmd: `pnpm vitest run '${focusFile}'` }),
          },
        },
        {
          timestamp: "2026-04-21T05:04:04.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", `pnpm vitest run '${focusFile}'`],
            stderr: "zsh:1: command not found: pnpm",
            exit_code: 1,
            status: "failed",
          },
        },
        {
          timestamp: "2026-04-21T05:05:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "提交一下？",
          },
        },
        {
          timestamp: "2026-04-21T05:06:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: `顺便看看 ${adjacentFile}`,
          },
        },
        {
          timestamp: "2026-04-21T05:07:00.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "git status --short"],
            aggregated_output: ` M ${focusFile}\n`,
            exit_code: 0,
          },
        },
      ],
    );

    writeTranscript(
      path.join(tempRoot, ".codex", "sessions", "session-adjacent.jsonl"),
      repoRoot,
      "session-adjacent",
      [
        {
          timestamp: "2026-04-21T06:01:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "分析 https://github.com/phodal/routa/issues/485 的实现情况",
          },
        },
        {
          timestamp: "2026-04-21T06:02:00.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: JSON.stringify({ cmd: `sed -n '1,200p' '${adjacentFile}'` }),
          },
        },
        {
          timestamp: "2026-04-21T06:02:04.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", `sed -n '1,200p' '${adjacentFile}'`],
            aggregated_output: "export async function GET() { return Response.json({ ok: true }); }\n",
            exit_code: 0,
          },
        },
        {
          timestamp: "2026-04-21T06:03:00.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "git status --short"],
            aggregated_output: ` M ${adjacentFile}\n`,
            exit_code: 0,
          },
        },
      ],
    );

    const summary = await summarizeFileSessionContext(repoRoot, {
      filePaths: [focusFile],
      featureId: "feature-explorer",
      taskType: "analysis",
      maxFiles: 4,
      maxSessions: 4,
    });

    expect(summary.focusFiles).toEqual([focusFile]);
    expect(summary.directSessions.map((session) => session.sessionId)).toContain("session-direct");
    expect(summary.adjacentSessions.map((session) => session.sessionId)).toContain("session-adjacent");
    expect(summary.inputFrictions).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "ui_url_without_entry_file", sessionId: "session-direct" }),
      expect.objectContaining({ category: "feature_anchor_mismatch", sessionId: "session-direct" }),
      expect.objectContaining({ category: "follow_up_without_scope", sessionId: "session-direct" }),
      expect.objectContaining({ category: "issue_reference_only", sessionId: "session-adjacent" }),
    ]));
    expect(summary.environmentFrictions).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "missing_dependency", sessionId: "session-direct" }),
    ]));
    expect(summary.scopeDriftSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: "session-direct" }),
    ]));
    expect(summary.repeatedFileHotspots).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: focusFile }),
    ]));
    expect(summary.repeatedCommandHotspots.length).toBeGreaterThan(0);
    expect(summary.openingPrompts).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: "session-direct" }),
      expect.objectContaining({ sessionId: "session-adjacent" }),
    ]));
    expect(summary.transcriptHints).toContain("~/.codex/sessions/**/session-direct*.jsonl");
  });

  it("demotes meta-analysis and off-target sessions when ranking file context", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-adaptive-file-session-ranking-"));
    process.env.HOME = tempRoot;
    process.env.CLAUDE_CONFIG_DIR = "";

    const repoRoot = path.join(tempRoot, "repo");
    const focusFile = "src/app/workspace/[workspaceId]/feature-explorer/__tests__/feature-explorer-page-client.test.tsx";
    const siblingFile = "src/app/workspace/[workspaceId]/feature-explorer/feature-explorer-page-client.tsx";
    const adjacentFile = "src/app/api/feature-explorer/route.ts";
    ensureFile(path.join(repoRoot, focusFile), "export const testFile = true;\n");
    ensureFile(path.join(repoRoot, siblingFile), "export function FeatureExplorerPageClient() { return null; }\n");
    ensureFile(path.join(repoRoot, adjacentFile), "export async function GET() { return Response.json({ ok: true }); }\n");
    writeFeatureTreeIndex(repoRoot, [
      {
        id: "feature-explorer",
        name: "Feature Explorer",
        sourceFiles: [focusFile, siblingFile, adjacentFile],
      },
    ]);

    writeTranscript(
      path.join(tempRoot, ".codex", "sessions", "session-focused.jsonl"),
      repoRoot,
      "session-focused",
      [
        {
          timestamp: "2026-04-21T07:01:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "修一下 feature-explorer 里的会话分析测试",
          },
        },
        {
          timestamp: "2026-04-21T07:02:00.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: JSON.stringify({ cmd: `sed -n '1,200p' '${focusFile}'` }),
          },
        },
        {
          timestamp: "2026-04-21T07:02:04.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", `sed -n '1,200p' '${focusFile}'`],
            aggregated_output: "export const testFile = true;\n",
            exit_code: 0,
          },
        },
        {
          timestamp: "2026-04-21T07:03:00.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "git status --short"],
            aggregated_output: ` M ${focusFile}\n`,
            exit_code: 0,
          },
        },
      ],
    );

    writeTranscript(
      path.join(tempRoot, ".codex", "sessions", "session-kanban-adjacent.jsonl"),
      repoRoot,
      "session-kanban-adjacent",
      [
        {
          timestamp: "2026-04-21T08:01:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "当前的看板页面会出现这个问题：[Image #1] 有没有可能在这个时候把这些信息发给 Kanban Agent？",
          },
        },
        {
          timestamp: "2026-04-21T08:02:00.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "git status --short"],
            aggregated_output: ` M ${adjacentFile}\n`,
            exit_code: 0,
          },
        },
      ],
    );

    writeTranscript(
      path.join(tempRoot, ".codex", "sessions", "session-meta-analyst.jsonl"),
      repoRoot,
      "session-meta-analyst",
      [
        {
          timestamp: "2026-04-21T09:01:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "You analyze historical coding sessions for one or more specific files. Your mission: review the provided session evidence first.",
          },
        },
        {
          timestamp: "2026-04-21T09:02:00.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: JSON.stringify({ cmd: `sed -n '1,200p' '${focusFile}'` }),
          },
        },
        {
          timestamp: "2026-04-21T09:02:04.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", `sed -n '1,200p' '${focusFile}'`],
            aggregated_output: "export const testFile = true;\n",
            exit_code: 0,
          },
        },
        {
          timestamp: "2026-04-21T09:03:00.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "git status --short"],
            aggregated_output: ` M ${adjacentFile}\n`,
            exit_code: 0,
          },
        },
      ],
    );

    const summary = await summarizeFileSessionContext(repoRoot, {
      filePaths: [focusFile],
      featureId: "feature-explorer",
      taskType: "analysis",
      maxFiles: 4,
      maxSessions: 6,
    });

    expect(summary.directSessions.map((session) => session.sessionId)).toContain("session-focused");
    expect(summary.directSessions.map((session) => session.sessionId)).not.toContain("session-kanban-adjacent");
    expect(summary.directSessions.map((session) => session.sessionId)).not.toContain("session-meta-analyst");
    expect(summary.adjacentSessions.map((session) => session.sessionId)).toContain("session-kanban-adjacent");
    expect(summary.weakSessions.map((session) => session.sessionId)).toContain("session-meta-analyst");
    expect(summary.matchedSessionIds).toEqual(expect.arrayContaining([
      "session-focused",
      "session-kanban-adjacent",
      "session-meta-analyst",
    ]));
  });
});
