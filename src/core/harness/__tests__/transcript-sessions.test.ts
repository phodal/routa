/**
 * @vitest-environment node
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { inspectTranscriptTurns } from "../transcript-sessions";

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

function setModifiedMs(filePath: string, modifiedMs: number): void {
  const timestamp = new Date(modifiedMs);
  fs.utimesSync(filePath, timestamp, timestamp);
}

describe("inspectTranscriptTurns", () => {
  const originalHome = process.env.HOME;
  const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
  });

  it("extracts only real user turns and focus-file evidence", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "transcript-turn-inspection-"));
    process.env.HOME = tempRoot;
    process.env.CLAUDE_CONFIG_DIR = "";

    const repoRoot = path.join(tempRoot, "repo");
    const focusFile = "src/app/workspace/[workspaceId]/feature-explorer/__tests__/feature-explorer-page-client.test.tsx";
    const otherFile = "src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx";
    ensureFile(path.join(repoRoot, focusFile), "export const testFile = true;\n");
    ensureFile(path.join(repoRoot, otherFile), "export const otherFile = true;\n");

    writeTranscript(
      path.join(tempRoot, ".codex", "sessions", "session-focus.jsonl"),
      repoRoot,
      "session-focus",
      [
        {
          timestamp: "2026-04-21T02:00:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "developer",
            content: [{
              type: "input_text",
              text: "<permissions instructions>do not use this as user evidence</permissions instructions>",
            }],
          },
        },
        {
          timestamp: "2026-04-21T02:01:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: `读取这个 ${focusFile}，看看为什么需要反复修测试`,
          },
        },
        {
          timestamp: "2026-04-21T02:02:00.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: JSON.stringify({ cmd: `sed -n '1,200p' '${focusFile}'` }),
          },
        },
        {
          timestamp: "2026-04-21T02:03:00.000Z",
          type: "response_item",
          payload: {
            type: "custom_tool_call",
            name: "apply_patch",
            input: `*** Begin Patch\n*** Update File: ${path.join(repoRoot, focusFile)}\n@@\n-export const testFile = true;\n+export const testFile = false;\n*** End Patch\n`,
          },
        },
        {
          timestamp: "2026-04-21T02:04:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{
              type: "input_text",
              text: "<turn_aborted>\nThe user interrupted the previous turn on purpose. Any running unified exec processes may still be running in the background.\n</turn_aborted>",
            }],
          },
        },
        {
          timestamp: "2026-04-21T02:04:30.000Z",
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
          timestamp: "2026-04-21T02:05:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: `再顺手看看 http://localhost:3001/workspace/default/feature-explorer?feature=workspace-overview&file=${encodeURIComponent(otherFile)}`,
          },
        },
      ],
    );

    const result = inspectTranscriptTurns(repoRoot, {
      sessionIds: ["session-focus"],
      filePaths: [focusFile],
      featureId: "feature-explorer",
    });

    expect(result.missingSessionIds).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      sessionId: "session-focus",
      openingUserPrompt: expect.stringContaining(focusFile),
      matchedFilePaths: [focusFile],
      transcriptPath: expect.stringContaining("session-focus.jsonl"),
    });
    expect(result.sessions[0]?.openingUserPrompt).not.toContain("permissions instructions");
    expect(result.sessions[0]?.followUpUserPrompts).toEqual([
      expect.stringContaining("feature=workspace-overview"),
    ]);
    expect(result.sessions[0]?.followUpUserPrompts.join("\n")).not.toContain("interrupted the previous turn");
    expect(result.sessions[0]?.relevantSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "command",
        toolName: "exec_command",
        matchedFilePaths: [focusFile],
      }),
      expect.objectContaining({
        kind: "patch",
        toolName: "apply_patch",
        matchedFilePaths: [focusFile],
      }),
    ]));
    expect(result.sessions[0]?.failedSignals).toEqual([
      expect.objectContaining({
        kind: "failure",
        exitCode: 1,
        matchedFilePaths: [focusFile],
      }),
    ]);
    expect(result.sessions[0]?.scopeDriftPrompts).toEqual([
      expect.stringContaining("feature=workspace-overview"),
    ]);
  });

  it("reports missing session ids without fabricating evidence", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "transcript-turn-missing-"));
    process.env.HOME = tempRoot;
    process.env.CLAUDE_CONFIG_DIR = "";

    const repoRoot = path.join(tempRoot, "repo");
    ensureFile(path.join(repoRoot, "src/index.ts"), "export const ready = true;\n");

    const result = inspectTranscriptTurns(repoRoot, {
      sessionIds: ["missing-session"],
      filePaths: ["src/index.ts"],
    });

    expect(result.sessions).toEqual([]);
    expect(result.missingSessionIds).toEqual(["missing-session"]);
  });

  it("finds explicitly requested sessions even when they are older than the recent transcript window", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "transcript-turn-older-"));
    process.env.HOME = tempRoot;
    process.env.CLAUDE_CONFIG_DIR = "";

    const repoRoot = path.join(tempRoot, "repo");
    const focusFile = "src/app/workspace/[workspaceId]/feature-explorer/__tests__/feature-explorer-page-client.test.tsx";
    ensureFile(path.join(repoRoot, focusFile), "export const ready = true;\n");

    const sessionDir = path.join(tempRoot, ".codex", "sessions");
    const baseTime = Date.parse("2026-04-21T03:00:00.000Z");
    const olderTargetPath = path.join(sessionDir, "rollout-older-session-target.jsonl");
    writeTranscript(olderTargetPath, repoRoot, "older-session-target", [
      {
        timestamp: "2026-04-21T01:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: `只分析 ${focusFile} 对应的历史会话`,
        },
      },
    ]);
    setModifiedMs(olderTargetPath, baseTime);

    for (let index = 0; index < 205; index += 1) {
      const fillerPath = path.join(sessionDir, `filler-${index}.jsonl`);
      writeTranscript(fillerPath, repoRoot, `filler-${index}`, []);
      setModifiedMs(fillerPath, baseTime + index + 1);
    }

    const result = inspectTranscriptTurns(repoRoot, {
      sessionIds: ["older-session-target"],
      filePaths: [focusFile],
    });

    expect(result.missingSessionIds).toEqual([]);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      sessionId: "older-session-target",
      transcriptPath: expect.stringContaining("older-session-target"),
      openingUserPrompt: expect.stringContaining(focusFile),
    });
  });
});
