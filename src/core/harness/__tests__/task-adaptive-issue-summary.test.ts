/**
 * @vitest-environment node
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildTaskAdaptiveIssueSummary,
  formatTaskAdaptiveIssueSummaryMarkdown,
  TASK_ADAPTIVE_ISSUE_SUMMARY_MARKER,
} from "../task-adaptive-issue-summary";

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
        timestamp: "2026-04-22T01:00:00.000Z",
        type: "session_meta",
        payload: {
          id: sessionId,
          timestamp: "2026-04-22T01:00:00.000Z",
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

function writeFeatureTreeIndex(
  repoRoot: string,
  features: Array<{
    id: string;
    name: string;
    sourceFiles: string[];
  }>,
): void {
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

function writeFrictionProfileSnapshot(repoRoot: string, snapshot: unknown): void {
  ensureFile(
    path.join(repoRoot, ".routa/feature-explorer/friction-profiles.json"),
    JSON.stringify(snapshot, null, 2),
  );
}

describe("task-adaptive-issue-summary", () => {
  const originalHome = process.env.HOME;
  const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
  });

  it("builds a sanitized hotspot summary from reusable friction profiles", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-adaptive-issue-summary-"));
    process.env.HOME = tempRoot;
    process.env.CLAUDE_CONFIG_DIR = "";

    const repoRoot = path.join(tempRoot, "repo");
    const focusFile = "src/app/feature-explorer/page.tsx";
    ensureFile(path.join(repoRoot, focusFile), "export default function Page() { return null; }\n");
    writeFeatureTreeIndex(repoRoot, [
      {
        id: "feature-explorer",
        name: "Feature Explorer",
        sourceFiles: [focusFile],
      },
    ]);

    writeTranscript(
      path.join(tempRoot, ".codex", "sessions", "session-a.jsonl"),
      repoRoot,
      "session-a",
      [
        {
          timestamp: "2026-04-22T01:01:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Investigate feature explorer churn",
          },
        },
        {
          timestamp: "2026-04-22T01:02:00.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", "pnpm vitest run src/app/feature-explorer/page.tsx"],
            stderr: "zsh:1: command not found: pnpm",
            exit_code: 1,
            status: "failed",
          },
        },
        {
          timestamp: "2026-04-22T01:03:00.000Z",
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
      path.join(tempRoot, ".codex", "sessions", "session-b.jsonl"),
      repoRoot,
      "session-b",
      [
        {
          timestamp: "2026-04-22T02:01:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Re-check feature explorer failures",
          },
        },
        {
          timestamp: "2026-04-22T02:02:00.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            command: ["/bin/zsh", "-lc", `sed -n '1,200p' ${focusFile}`],
            stderr: "Operation not permitted",
            exit_code: 1,
            status: "failed",
          },
        },
        {
          timestamp: "2026-04-22T02:03:00.000Z",
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

    const summary = await buildTaskAdaptiveIssueSummary(repoRoot);
    const markdown = formatTaskAdaptiveIssueSummaryMarkdown(summary);

    expect(summary.source).toBe("refreshed");
    expect(summary.counts.featureProfiles).toBeGreaterThan(0);
    expect(summary.counts.fileProfiles).toBeGreaterThan(0);
    expect(summary.topFeatures[0]).toMatchObject({
      featureId: "feature-explorer",
      featureName: "Feature Explorer",
    });
    expect(summary.topFiles[0]).toMatchObject({
      filePath: focusFile,
      featureIds: ["feature-explorer"],
    });
    expect(summary.recommendedFollowUpFiles[0]).toMatchObject({
      filePath: focusFile,
      featureIds: ["feature-explorer"],
      confidence: "high",
    });
    expect(summary.topFailureCategories).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "missing_dependency" }),
      expect.objectContaining({ category: "permission_or_worktree" }),
    ]));
    expect(markdown).toContain(TASK_ADAPTIVE_ISSUE_SUMMARY_MARKER);
    expect(markdown).toContain("Feature Explorer (`feature-explorer`)");
    expect(markdown).toContain("### Recommended Follow-Up Files");
    expect(markdown).toContain("confidence: high");
    expect(markdown).toContain("missing_dependency");
    expect(markdown).not.toContain("session-a");
    expect(markdown).not.toContain("session-b");
    expect(markdown).not.toContain("Investigate feature explorer churn");
    expect(markdown).not.toContain("Re-check feature explorer failures");
    expect(markdown).not.toContain("/tmp/");
  });

  it("prefers product hotspots over repo-maintenance files in follow-up recommendations", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-adaptive-issue-summary-ranking-"));
    process.env.HOME = tempRoot;
    process.env.CLAUDE_CONFIG_DIR = "";

    const repoRoot = path.join(tempRoot, "repo");
    const productFile = "src/core/harness/task-adaptive-issue-summary.ts";
    const docsFile = "docs/issues/issue-gc-state.yaml";
    ensureFile(path.join(repoRoot, productFile), "export const ready = true;\n");
    ensureFile(path.join(repoRoot, docsFile), "last_reviewed_at: \"2026-04-24\"\n");
    writeFeatureTreeIndex(repoRoot, [
      {
        id: "feature-explorer",
        name: "Feature Explorer",
        sourceFiles: [productFile],
      },
    ]);
    writeFrictionProfileSnapshot(repoRoot, {
      generatedAt: "2026-04-24T08:00:00.000Z",
      thresholds: {
        minFileSessions: 2,
        minFeatureSessions: 2,
      },
      fileProfiles: {
        [productFile]: {
          scope: "file",
          targetId: productFile,
          targetLabel: productFile,
          generatedAt: "2026-04-24T07:00:00.000Z",
          updatedAt: "2026-04-24T07:00:00.000Z",
          selectedFiles: [productFile],
          matchedFileDetails: [],
          matchedSessionIds: ["session-a", "session-b", "session-c", "session-d"],
          failures: [
            {
              provider: "openai",
              sessionId: "session-a",
              message: "command not found: pnpm",
              toolName: "exec_command",
              command: "pnpm vitest run src/core/harness/task-adaptive-issue-summary.ts",
            },
          ],
          repeatedReadFiles: [productFile],
          sessions: [],
        },
        [docsFile]: {
          scope: "file",
          targetId: docsFile,
          targetLabel: docsFile,
          generatedAt: "2026-04-24T08:30:00.000Z",
          updatedAt: "2026-04-24T08:30:00.000Z",
          selectedFiles: [docsFile],
          matchedFileDetails: [],
          matchedSessionIds: ["session-e", "session-f", "session-g", "session-h"],
          failures: [
            {
              provider: "openai",
              sessionId: "session-e",
              message: "No such file or directory",
              toolName: "exec_command",
              command: "sed -n '1,80p' docs/issues/issue-gc-state.yaml",
            },
            {
              provider: "openai",
              sessionId: "session-f",
              message: "No such file or directory",
              toolName: "exec_command",
              command: "sed -n '1,80p' docs/issues/issue-gc-state.yaml",
            },
            {
              provider: "openai",
              sessionId: "session-g",
              message: "No such file or directory",
              toolName: "exec_command",
              command: "sed -n '1,80p' docs/issues/issue-gc-state.yaml",
            },
          ],
          repeatedReadFiles: [docsFile],
          sessions: [],
        },
      },
      featureProfiles: {
        "feature-explorer": {
          scope: "feature",
          targetId: "feature-explorer",
          targetLabel: "Feature Explorer",
          generatedAt: "2026-04-24T07:30:00.000Z",
          updatedAt: "2026-04-24T07:30:00.000Z",
          featureId: "feature-explorer",
          featureName: "Feature Explorer",
          selectedFiles: [productFile],
          matchedFileDetails: [],
          matchedSessionIds: ["session-a", "session-b", "session-c", "session-d"],
          failures: [],
          repeatedReadFiles: [productFile],
          sessions: [],
        },
      },
    });

    const summary = await buildTaskAdaptiveIssueSummary(repoRoot, { refresh: false });
    const markdown = formatTaskAdaptiveIssueSummaryMarkdown(summary);

    expect(summary.source).toBe("cached");
    expect(summary.topFiles[0]?.filePath).toBe(productFile);
    expect(summary.topFiles[1]?.filePath).toBe(docsFile);
    expect(summary.recommendedFollowUpFiles.map((file) => file.filePath)).toContain(productFile);
    expect(summary.recommendedFollowUpFiles.map((file) => file.filePath)).not.toContain(docsFile);
    expect(summary.recommendedFollowUpFiles[0]).toMatchObject({
      filePath: productFile,
      confidence: "high",
      featureIds: ["feature-explorer"],
    });
    expect(summary.recommendedFollowUpFiles[0]?.rationale).toContain("product-facing source hotspot");
    expect(markdown).toContain("### Recommended Follow-Up Files");
    expect(markdown).toContain(productFile);
  });
});
