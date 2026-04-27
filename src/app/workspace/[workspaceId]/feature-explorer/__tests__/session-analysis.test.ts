import { describe, expect, it } from "vitest";

import {
  buildSessionAnalysisPrompt,
  sanitizeChangedFiles,
} from "../session-analysis";

describe("session-analysis", () => {
  it("filters noisy changed-file entries", () => {
    expect(sanitizeChangedFiles([
      "",
      "fatal: Unable to create '/tmp/repo/.git/index.lock': Operation not permitted",
      "index 2a57ee30..79132e49 100644",
      "crates/routa-server/src/api/kanban.rs",
      "src/app/workspace/[workspaceId]/feature-explorer/page.tsx",
    ])).toEqual([
      "crates/routa-server/src/api/kanban.rs",
      "src/app/workspace/[workspaceId]/feature-explorer/page.tsx",
    ]);
  });

  it("builds a localized analysis prompt with feature and session evidence", () => {
    const prompt = buildSessionAnalysisPrompt({
      locale: "zh",
      workspaceId: "default",
      repoName: "routa-js",
      repoPath: "/repo/default",
      branch: "main",
      featureDetail: {
        id: "kanban-workflow",
        name: "Kanban Workflow",
        group: "workspace",
        summary: "Kanban board workflow",
        status: "active",
        pages: [],
        apis: [],
        sourceFiles: ["crates/routa-server/src/api/kanban.rs"],
        relatedFeatures: [],
        domainObjects: [],
        sessionCount: 6,
        changedFiles: 1,
        updatedAt: "2026-04-17T08:00:00.000Z",
        fileTree: [],
      },
      selectedFilePaths: ["crates/routa-server/src/api/kanban.rs"],
      sessions: [
        {
          provider: "codex",
          sessionId: "019d-kanban-analysis",
          updatedAt: "2026-04-17T08:00:00.000Z",
          promptSnippet: "Trace why kanban.rs needed multiple follow-up passes",
          promptHistory: [
            "Trace why kanban.rs needed multiple follow-up passes",
            "Summarize what context should have been provided earlier",
          ],
          toolNames: ["exec_command", "apply_patch"],
          changedFiles: [
            "fatal: Unable to create '/tmp/repo/.git/index.lock': Operation not permitted",
            "crates/routa-server/src/api/kanban.rs",
          ],
          diagnostics: {
            toolCallCount: 3,
            failedToolCallCount: 1,
            toolCallsByName: {
              exec_command: 2,
              apply_patch: 1,
            },
            readFiles: [
              "crates/routa-server/src/api/kanban.rs",
              "http://127.0.0.1:3000/",
              "1.",
            ],
            writtenFiles: ["crates/routa-server/src/api/kanban.rs"],
            repeatedReadFiles: ["crates/routa-server/src/api/kanban.rs x2"],
            repeatedCommands: [
              "sed -n 1,200p crates/routa-server/src/api/kanban.rs x2",
              "{\"session_id\":123,\"yield_time_ms\":1000} x4",
            ],
            failedTools: [
              {
                toolName: "exec_command",
                command: "git status --short",
                message: "fatal: Unable to create '/tmp/repo/.git/index.lock'",
              },
            ],
          },
          resumeCommand: "codex resume 019d-kanban-analysis",
        },
      ],
    });

    expect(prompt).toContain("Feature ID: kanban-workflow");
    expect(prompt).toContain("Feature Name: Kanban Workflow");
    expect(prompt).toContain("crates/routa-server/src/api/kanban.rs");
    expect(prompt).toContain("019d-kanban-analysis");
    expect(prompt).toContain("~/.codex/sessions/**/019d-kanban-analysis*.jsonl");
    expect(prompt).toContain("### 会话相关性总览");
    expect(prompt).toContain("### 选中文件证据");
    expect(prompt).toContain("直接改动了选中文件");
    expect(prompt).toContain("可直接复用的提示词模板");
    expect(prompt).toContain("load_feature_retrospective_memory");
    expect(prompt).toContain("save_feature_retrospective_memory");
    expect(prompt).toContain("feature 级保存时，必须传上下文里的精确 `featureId`");
    expect(prompt).toContain("把 `taskType` 固定成 `analysis`");
    expect(prompt).toContain("把 Next.js 路由目录里的 `[workspaceId]`、`[featureId]` 当成字面路径片段");
    expect(prompt).toContain("不要直接推断文件已经移动或删除");
    expect(prompt).toContain("## 本次分析过程中的问题");
    expect(prompt).toContain("Scope: file:<path> | feature:<id>");
    expect(prompt).toContain("Next ask: <one sentence>");
    expect(prompt).toContain("Must include: <4-6 comma-separated fields>");
    expect(prompt).toContain("Avoid: <2-4 concise pitfalls or scope drifts>");
    expect(prompt).toContain("Still need: <what still requires repo or transcript reread>");
    expect(prompt).toContain("这 5 个标签必须全部出现");
    expect(prompt).toContain("未知时明确写 `unknown`");
    expect(prompt).toContain("### 选中文件重复读取");
    expect(prompt).not.toContain("git status --short");
    expect(prompt).not.toContain("Operation not permitted");
    expect(prompt).not.toContain("http://127.0.0.1");
    expect(prompt).not.toContain("\"session_id\":123");
  });

  it("switches to JSONL-first guidance when many sessions are selected", () => {
    const sessions = Array.from({ length: 4 }, (_, index) => ({
      provider: "codex" as const,
      sessionId: `session-${index + 1}`,
      updatedAt: `2026-04-1${index + 1}T08:00:00.000Z`,
      promptSnippet: index === 3
        ? "这个生成的 prompt 有问题，读取 jsonl 再改 specialist prompt"
        : `Analyze session ${index + 1}`,
      promptHistory: [index === 3
        ? "这个生成的 prompt 有问题，读取 jsonl 再改 specialist prompt"
        : `Analyze session ${index + 1}`],
      toolNames: ["exec_command"],
      changedFiles: index === 0
        ? ["src/app/workspace/[workspaceId]/feature-explorer/page.tsx"]
        : ["src/app/api/feature-explorer/route.ts"],
      diagnostics: {
        toolCallCount: 2,
        failedToolCallCount: 0,
        toolCallsByName: {
          exec_command: 2,
        },
        readFiles: index === 0
          ? ["src/app/workspace/[workspaceId]/feature-explorer/page.tsx"]
          : ["src/app/api/feature-explorer/route.ts"],
        writtenFiles: index === 0
          ? ["src/app/workspace/[workspaceId]/feature-explorer/page.tsx"]
          : [],
        repeatedReadFiles: [],
        repeatedCommands: [],
        failedTools: [],
      },
      resumeCommand: `codex resume session-${index + 1}`,
    }));

    const prompt = buildSessionAnalysisPrompt({
      locale: "zh",
      workspaceId: "default",
      repoName: "routa-js",
      repoPath: "/repo/default",
      branch: "main",
      featureDetail: {
        id: "feature-explorer",
        name: "Feature Explorer",
        group: "workspace",
        summary: "Explore feature surfaces",
        status: "active",
        pages: [],
        apis: [],
        sourceFiles: ["src/app/workspace/[workspaceId]/feature-explorer/page.tsx"],
        relatedFeatures: [],
        domainObjects: [],
        sessionCount: 12,
        changedFiles: 1,
        updatedAt: "2026-04-17T08:00:00.000Z",
        fileTree: [],
      },
      selectedFilePaths: ["src/app/workspace/[workspaceId]/feature-explorer/page.tsx"],
      sessions,
    });

    expect(prompt).toContain("如果 session 数量较多，优先直接读 Transcript Hints 里的 JSONL");
    expect(prompt).toContain("为避免 prompt 过长，这里不再内联逐条 session 证据块");
    expect(prompt).toContain("先走现成 tool / script");
    expect(prompt).toContain("scripts/harness/inspect-transcript-turns.ts");
    expect(prompt).toContain("load_feature_retrospective_memory");
    expect(prompt).toContain("save_feature_retrospective_memory");
    expect(prompt).toContain("Feature ID: feature-explorer");
    expect(prompt).toContain("Feature Name: Feature Explorer");
    expect(prompt).toContain("feature 级保存时，必须传上下文里的精确 `featureId`");
    expect(prompt).toContain("把 `taskType` 固定成 `analysis`");
    expect(prompt).toContain("把 Next.js 路由目录里的 `[workspaceId]`、`[featureId]` 当成字面路径片段");
    expect(prompt).toContain("不要直接推断文件已经移动或删除");
    expect(prompt).toContain("## 本次分析过程中的问题");
    expect(prompt).toContain("Scope: file:<path> | feature:<id>");
    expect(prompt).toContain("Next ask: <one sentence>");
    expect(prompt).toContain("Must include: <4-6 comma-separated fields>");
    expect(prompt).toContain("Avoid: <2-4 concise pitfalls or scope drifts>");
    expect(prompt).toContain("Still need: <what still requires repo or transcript reread>");
    expect(prompt).toContain("这 5 个标签必须全部出现");
    expect(prompt).toContain("未知时明确写 `unknown`");
    expect(prompt).toContain("已从 Transcript Hints 中省略明显是在调当前复盘 / prompt / JSONL 流程本身的元会话");
    expect(prompt).toContain("只提取真实用户 turns");
    expect(prompt).toContain("不要用 rg/grep 按关键字扫描整行 JSONL 再回显整段对象");
    expect(prompt).toContain("不要把任务扩写成整个仓库的架构评审");
    expect(prompt).toContain("如果没有先读这些 session 的 JSONL，就不要下仓库级结论");
    expect(prompt).toContain("如果这些 JSONL 读不到，就在输出中明确写出限制并停止");
    expect(prompt).toContain("不要用 git 历史、仓库文档或全仓扫描来替代 session 分析");
    expect(prompt).not.toContain("~/.codex/sessions/**/session-4*.jsonl");
    expect(prompt).not.toContain("~/.codex/sessions/**/session-2*.jsonl");
    expect(prompt).not.toContain("## Session 1");
    expect(prompt).not.toContain("### Prompt History");
  });
});
