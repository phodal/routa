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
} from "../shared";

function ensureFile(filePath: string, content = ""): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
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
    expect(pack.matchedSessionIds).toContain("session-b");
    expect(pack.recommendedMcpProfile).toBe("kanban-planning");
    expect(pack.recommendedAllowedNativeTools).toEqual(["Read", "Grep", "Glob"]);
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
});
