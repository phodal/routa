import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { KanbanTab } from "../kanban-tab";
import { KanbanCardDetail } from "../kanban-card-detail";
import { KanbanCardActivityBar, KanbanCardActivityPanel } from "../kanban-card-activity";
import { KanbanMoveBlockedModal } from "../kanban-tab-modals";
import { buildKanbanSessionRestorePrompt } from "../kanban-tab-panels";
import { buildKanbanMoveBlockedRemediationPrompt } from "../i18n/kanban-task-agent";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";
import { resetDesktopAwareFetchToGlobalFetch } from "./test-utils";

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return {
    ...actual,
    desktopAwareFetch,
  };
});

vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: () => <div data-testid="repo-picker-mock" />,
  shortenRepoPath: (value: string) => value,
}));

vi.mock("../use-runtime-fitness-status", async () => {
  const { mockUseRuntimeFitnessStatus } = await import("./test-utils");
  return {
    useRuntimeFitnessStatus: mockUseRuntimeFitnessStatus,
  };
});

const board: KanbanBoardInfo = {
  id: "board-1",
  workspaceId: "workspace-1",
  name: "Default Board",
  isDefault: true,
  sessionConcurrencyLimit: 1,
  queue: {
    runningCount: 0,
    runningCards: [],
    queuedCount: 0,
    queuedCardIds: [],
    queuedCards: [],
    queuedPositions: {},
  },
  columns: [
    { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
  ],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

function createTask(id: string, title: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id,
    title,
    objective: `${title} objective`,
    status: "PENDING",
    boardId: board.id,
    columnId: "backlog",
    position: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
});

describe("kanban session restore prompt", () => {
  it("uses card context and filters noisy tool or terminal transcript", () => {
    const prompt = buildKanbanSessionRestorePrompt(
      createTask("task-restore", "Upgrade dirs", {
        objective: "Update dirs requirement from 5 to 6",
        status: "IN_PROGRESS",
      }),
      {
        sessionId: "session-old",
        name: "Upgrade dirs · Dev Crafter",
        workspaceId: "workspace-1",
        cwd: "/tmp/worktree",
        branch: "issue/dirs",
        provider: "codex",
        createdAt: "2025-01-01T00:00:00.000Z",
      },
      [
        {
          role: "terminal",
          content: "cargo test --all\nrunning 100 tests\n...",
        },
        {
          role: "assistant",
          content: "2026-04-09T04:03:47.306949Z INFO routa_server: Starting Routa backend server on 127.0.0.1:0\n".repeat(20),
        },
        {
          role: "tool",
          toolName: "shell",
          content: "test result: ok. 8 passed; 0 failed",
        },
        {
          role: "assistant",
          content: "cargo test --all passed; cargo clippy is the remaining verification.",
        },
      ],
    );

    expect(prompt).toContain("Card context:");
    expect(prompt).toContain("- Card: Upgrade dirs");
    expect(prompt).toContain("Assistant: cargo test --all passed");
    expect(prompt).not.toContain("Starting Routa backend server");
    expect(prompt).not.toContain("test result: ok");
    expect(prompt).not.toContain("running 100 tests");
  });
});

describe("kanban move-blocked remediation prompt", () => {
  it("requires moving the card after repairing story-readiness fields", () => {
    const prompt = buildKanbanMoveBlockedRemediationPrompt({
      workspaceId: "workspace-1",
      boardId: "board-1",
      cardId: "card-1",
      cardTitle: "Repair story readiness",
      targetColumnId: "review",
      repoPath: "/tmp/repo",
      missingFields: ["scope", "verification plan"],
    });

    expect(prompt).toContain("you must call move_card to move card card-1 into review");
    expect(prompt).not.toContain("Do not move the card");
  });

  it("requires the Chinese remediation agent to move the card after repair", () => {
    const prompt = buildKanbanMoveBlockedRemediationPrompt({
      workspaceId: "workspace-1",
      boardId: "board-1",
      cardId: "card-1",
      cardTitle: "修复 story-readiness",
      targetColumnId: "review",
      repoPath: "/tmp/repo",
      missingFields: ["scope", "verification plan"],
      language: "zh-CN",
    });

    expect(prompt).toContain("必须调用 move_card，把 card card-1 移动到 review");
    expect(prompt).not.toContain("不要移动卡片");
  });
});

describe("kanban move blocked modal", () => {
  it("surfaces story-readiness remediation with update_task guidance", () => {
    render(
      <KanbanMoveBlockedModal
        blocked={{
          message: 'Cannot move task to "Dev": missing required task fields: scope, verification plan.',
          storyReadiness: {
            ready: false,
            missing: ["scope", "verification_plan"],
            requiredTaskFields: ["scope", "acceptance_criteria", "verification_plan"],
            checks: {
              scope: false,
              acceptanceCriteria: true,
              verificationCommands: false,
              testCases: true,
              verificationPlan: true,
              dependenciesDeclared: false,
            },
          },
          missingTaskFields: ["scope", "verification plan"],
        }}
        onClose={vi.fn()}
        onDelegateFix={vi.fn()}
        onOpenCard={vi.fn()}
      />,
    );

    expect(screen.getByText("Cannot Move Card")).toBeTruthy();
    expect(screen.getByText("This move is blocked by the story-readiness gate for the target lane.")).toBeTruthy();
    expect(screen.getByText(/Required for next move:/)).toBeTruthy();
    expect(screen.getByText(/Missing fields:/)).toBeTruthy();
    expect(screen.getByText(/Use `update_task` to fill structured fields/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask Kanban Agent to Fix" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
  });
});

describe("KanbanCardDetail repository health", () => {
  it("offers session mismatch interventions in repositories", async () => {
    const onPatchTask = vi.fn(async () => createTask("task-1", "Story One"));
    const onSelectSession = vi.fn();
    const onRefresh = vi.fn();

    render(
      <KanbanCardDetail
        task={{
          ...createTask("task-1", "Story One"),
          triggerSessionId: "session-123",
          codebaseIds: ["repo-a"],
        }}
        boardColumns={board.columns}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[
          {
            id: "repo-a",
            workspaceId: "workspace-1",
            repoPath: "/tmp/repo-a",
            label: "Repo A",
            isDefault: true,
            sourceType: "local",
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
          },
          {
            id: "repo-b",
            workspaceId: "workspace-1",
            repoPath: "/tmp/repo-b",
            label: "Repo B",
            isDefault: false,
            sourceType: "local",
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
          },
        ]}
        allCodebaseIds={["repo-a", "repo-b"]}
        worktreeCache={{}}
        sessionInfo={{
          sessionId: "session-123",
          workspaceId: "workspace-1",
          cwd: "/tmp/repo-b",
          provider: "claude",
          role: "DEVELOPER",
          createdAt: "2025-01-01T00:00:00.000Z",
        }}
        sessions={[]}
        fullWidth
        onPatchTask={onPatchTask}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={onRefresh}
        onSelectSession={onSelectSession}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Execution" }));
    fireEvent.click(screen.getByText("Repo").closest("summary")!);

    expect(await screen.findByText("Repo Health")).toBeTruthy();
    expect(screen.getByText(/Active session is running in a different directory/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Open active session/i }));
    expect(onSelectSession).toHaveBeenCalledWith("session-123");

    fireEvent.click(screen.getByRole("button", { name: /Use session repo/i }));

    await waitFor(() => {
      expect(onPatchTask).toHaveBeenCalledWith("task-1", { codebaseIds: ["repo-b", "repo-a"] });
    });
    expect(onRefresh).toHaveBeenCalled();
  });

  it("surfaces provider runtime failures in the execution panel", () => {
    render(
      <KanbanCardDetail
        task={{
          ...createTask("task-err", "Story Failure"),
          assignedProvider: "auggie",
          assignedRole: "DEVELOPER",
          triggerSessionId: "session-err",
          lastSyncError: "Permission denied: HTTP error: 403 Forbidden",
        }}
        boardColumns={board.columns}
        availableProviders={[{
          id: "auggie",
          name: "Auggie",
          description: "Auggie provider",
          command: "auggie",
          status: "available",
        }]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        sessionInfo={{
          sessionId: "session-err",
          workspaceId: "workspace-1",
          cwd: "/tmp/project",
          provider: "auggie",
          role: "DEVELOPER",
          acpStatus: "error",
          acpError: "Permission denied: HTTP error: 403 Forbidden",
          createdAt: "2025-01-01T00:00:00.000Z",
        }}
        sessions={[]}
        fullWidth
        onPatchTask={vi.fn(async () => createTask("task-err", "Story Failure"))}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "Execution" }));
    expect(screen.getByText(/Current run failed on Auggie:/i)).toBeTruthy();
    expect(screen.getByText(/403 Forbidden/i)).toBeTruthy();
  });

  it("loads JIT Context lazily from history-session retrieval", async () => {
    desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/harness/task-adaptive/history-summary")) {
        return new Response(JSON.stringify({
          historySummary: {
            overview: "Started from 1 linked transcript session and narrowed to 1 recovered session plus 1 candidate file.",
            seedSessionCount: 1,
            recoveredSessionCount: 1,
            matchedFileCount: 1,
            seedSessions: [],
          },
          featureId: "kanban-workflow",
          featureName: "Kanban Workflow",
          selectedFiles: ["src/app/page.tsx"],
          matchedFileDetails: [{
            filePath: "src/app/page.tsx",
            changes: 1,
            sessions: 1,
            updatedAt: "2026-04-21T02:03:00.000Z",
          }],
          matchedSessionIds: ["session-codex"],
          warnings: ["Prefer the API route before the UI shell."],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/harness/task-adaptive")) {
        return new Response(JSON.stringify({
          summary: "history summary",
          historySummary: {
            overview: "Started from 3 linked history sessions and narrowed to 2 recovered sessions plus 1 candidate file.",
            seedSessionCount: 3,
            recoveredSessionCount: 2,
            matchedFileCount: 1,
            seedSessions: [{
              provider: "codex",
              sessionId: "session-trigger",
              updatedAt: "2026-04-21T02:00:00.000Z",
              promptSnippet: "Trace the Kanban task-adaptive loading path first.",
              touchedFiles: ["src/app/page.tsx", "src/app/layout.tsx"],
              repeatedReadFiles: ["src/app/page.tsx"],
              toolNames: ["exec_command"],
              failedReadSignals: [],
            }],
          },
          warnings: ["Prefer the API route before the UI shell.", "Prefer the API route before the UI shell."],
          matchConfidence: "high",
          matchReasons: [
            "Started from 3 linked history sessions as retrieval seeds.",
            "Started from 3 linked history sessions as retrieval seeds.",
          ],
          selectedFiles: ["src/app/page.tsx"],
          matchedFileDetails: [{
            filePath: "src/app/page.tsx",
            changes: 1,
            sessions: 1,
            updatedAt: "2026-04-21T02:03:00.000Z",
          }],
          matchedSessionIds: ["session-trigger", "session-history"],
          failures: [{
            provider: "codex",
            sessionId: "session-history",
            message: "Operation not permitted",
            toolName: "exec_command",
            command: "sed -n '1,200p' src/app/page.tsx",
          }, {
            provider: "codex",
            sessionId: "session-history",
            message: "Operation not permitted",
            toolName: "exec_command",
            command: "sed -n '1,200p' src/app/page.tsx",
          }],
          repeatedReadFiles: ["src/app/page.tsx", "src/app/page.tsx"],
          sessions: [{
            provider: "codex",
            sessionId: "session-history",
            updatedAt: "2026-04-21T02:03:00.000Z",
            promptSnippet: "Investigate why page context could not be read.",
            matchedFiles: ["src/app/page.tsx"],
            matchedChangedFiles: ["src/app/page.tsx"],
            matchedReadFiles: ["src/app/page.tsx"],
            matchedWrittenFiles: [],
            repeatedReadFiles: ["src/app/page.tsx"],
            toolNames: ["exec_command"],
            failedReadSignals: [],
          }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected desktopAwareFetch: ${url}`);
    });

    const onPatchTask = vi.fn(async () => createTask("task-jit", "Recover JIT context"));

    render(
      <KanbanCardDetail
        task={{
          ...createTask("task-jit", "Recover JIT context"),
          columnId: "backlog",
          assignedRole: "CRAFTER",
          contextSearchSpec: {
            query: "recover jit context",
            featureCandidates: ["kanban-workflow"],
            relatedFiles: ["src/app/page.tsx"],
          },
          triggerSessionId: "session-trigger",
          sessionIds: ["session-history"],
          laneSessions: [{
            sessionId: "session-lane",
            status: "completed",
            startedAt: "2025-01-01T00:00:00.000Z",
          }],
          codebaseIds: ["repo-a"],
        }}
        boardColumns={board.columns}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[{
          id: "repo-a",
          workspaceId: "workspace-1",
          repoPath: "/tmp/repo-a",
          label: "Repo A",
          isDefault: true,
          sourceType: "local",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }]}
        allCodebaseIds={["repo-a"]}
        worktreeCache={{}}
        sessions={[]}
        fullWidth
        onPatchTask={onPatchTask}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(desktopAwareFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "History Memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Show History Memory" }));

    expect(await screen.findByText("Historical issues")).toBeTruthy();
    expect(screen.getByText("History Summary")).toBeTruthy();
    expect(screen.getAllByText("Seed sessions: 3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Recovered sessions: 2").length).toBeGreaterThan(0);
    expect(screen.getByText("Trace the Kanban task-adaptive loading path first.")).toBeTruthy();
    expect(screen.getByText("Match confidence")).toBeTruthy();
    expect(screen.getAllByText("High").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Started from 3 linked history sessions as retrieval seeds.")).toHaveLength(1);
    expect(screen.getAllByText("Operation not permitted")).toHaveLength(1);
    expect(screen.getAllByText("Prefer the API route before the UI shell.")).toHaveLength(1);
    expect(screen.getByText("Repeated read hotspots")).toBeTruthy();
    expect(screen.getAllByText("src/app/page.tsx").length).toBeGreaterThan(0);
    expect(screen.getByText("Changes: 1")).toBeTruthy();
    expect(screen.getByText("sessions: 1")).toBeTruthy();
    expect(screen.getByText("session-history")).toBeTruthy();
    expect(screen.getAllByText(/Matched files: src\/app\/page\.tsx/).length).toBeGreaterThan(0);

    expect(desktopAwareFetch).toHaveBeenCalledWith(
      "/api/harness/task-adaptive",
      expect.objectContaining({
        method: "POST",
        body: expect.any(String),
      }),
    );

    const requestBody = JSON.parse(String(desktopAwareFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody.taskAdaptiveHarness).toEqual(expect.objectContaining({
      taskId: "task-jit",
      taskLabel: "Recover JIT context",
      query: "recover jit context",
      historySessionIds: ["session-trigger", "session-history", "session-lane"],
      taskType: "planning",
      locale: "en",
      role: "CRAFTER",
    }));
    await waitFor(() => {
      expect(onPatchTask).toHaveBeenCalledWith(
        "task-jit",
        expect.objectContaining({
          jitContextSnapshot: expect.objectContaining({
            summary: "history summary",
            recommendedContextSearchSpec: expect.objectContaining({
              query: "recover jit context",
              relatedFiles: ["src/app/page.tsx"],
            }),
          }),
        }),
      );
    });
  });

  it("opens a dedicated history analysis flow from JIT Context", async () => {
    desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/harness/task-adaptive/history-summary")) {
        return new Response(JSON.stringify({
          historySummary: {
            overview: "Started from 1 linked transcript session and narrowed to 1 recovered session plus 1 candidate file.",
            seedSessionCount: 1,
            recoveredSessionCount: 1,
            matchedFileCount: 1,
            seedSessions: [],
          },
          featureId: "kanban-workflow",
          featureName: "Kanban Workflow",
          selectedFiles: ["src/app/page.tsx"],
          matchedFileDetails: [{
            filePath: "src/app/page.tsx",
            changes: 1,
            sessions: 1,
            updatedAt: "2026-04-21T02:03:00.000Z",
          }],
          matchedSessionIds: ["session-codex"],
          warnings: ["Prefer the API route before the UI shell."],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/harness/task-adaptive")) {
        return new Response(JSON.stringify({
          summary: "history summary",
          historySummary: {
            overview: "Started from 3 linked history sessions and narrowed to 2 recovered sessions plus 1 candidate file.",
            seedSessionCount: 3,
            recoveredSessionCount: 2,
            matchedFileCount: 1,
            seedSessions: [{
              provider: "codex",
              sessionId: "session-trigger",
              updatedAt: "2026-04-21T02:00:00.000Z",
              promptSnippet: "Trace the Kanban task-adaptive loading path first.",
              touchedFiles: ["src/app/page.tsx"],
              repeatedReadFiles: [],
              toolNames: ["exec_command"],
              failedReadSignals: [],
            }],
          },
          warnings: ["Prefer the API route before the UI shell."],
          matchConfidence: "high",
          matchReasons: ["Started from 3 linked history sessions as retrieval seeds."],
          selectedFiles: ["src/app/page.tsx"],
          matchedFileDetails: [{
            filePath: "src/app/page.tsx",
            changes: 1,
            sessions: 1,
            updatedAt: "2026-04-21T02:03:00.000Z",
          }],
          matchedSessionIds: ["session-codex"],
          failures: [],
          repeatedReadFiles: [],
          sessions: [{
            provider: "codex",
            sessionId: "session-codex",
            updatedAt: "2026-04-21T02:03:00.000Z",
            promptSnippet: "Inspect the Kanban API route before touching the UI shell.",
            matchedFiles: ["src/app/page.tsx"],
            matchedChangedFiles: ["src/app/page.tsx"],
            matchedReadFiles: ["src/app/page.tsx"],
            matchedWrittenFiles: [],
            repeatedReadFiles: [],
            toolNames: ["exec_command"],
            failedReadSignals: [],
          }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected desktopAwareFetch: ${url}`);
    });

    const targetWindow = {
      close: vi.fn(),
      location: { href: "about:blank" },
    } as unknown as Window;
    const openSpy = vi.spyOn(window, "open").mockReturnValue(targetWindow);
    const onOpenHistoryAnalysis = vi.fn(async () => {});

    render(
      <KanbanCardDetail
        task={{
          ...createTask("task-jit-analysis", "Recover JIT context"),
          columnId: "backlog",
          assignedRole: "CRAFTER",
          contextSearchSpec: {
            query: "recover jit context",
            featureCandidates: ["kanban-workflow"],
            relatedFiles: ["src/app/page.tsx"],
          },
          triggerSessionId: "session-trigger",
          sessionIds: ["session-history"],
          laneSessions: [{
            sessionId: "session-lane",
            status: "completed",
            startedAt: "2025-01-01T00:00:00.000Z",
          }],
          codebaseIds: ["repo-a"],
        }}
        boardColumns={board.columns}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[{
          id: "repo-a",
          workspaceId: "workspace-1",
          repoPath: "/tmp/repo-a",
          label: "Repo A",
          isDefault: true,
          sourceType: "local",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }]}
        allCodebaseIds={["repo-a"]}
        worktreeCache={{}}
        sessions={[]}
        fullWidth
        onPatchTask={vi.fn(async () => createTask("task-jit-analysis", "Recover JIT context"))}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
        onOpenJitContextHistoryAnalysis={onOpenHistoryAnalysis}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "History Memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Show History Memory" }));
    await screen.findByText("History Summary");

    fireEvent.click(screen.getByRole("button", { name: "Open History Analysis" }));

    await waitFor(() => {
      expect(onOpenHistoryAnalysis).toHaveBeenCalledWith(
        expect.stringContaining("summarize_task_history_context"),
        targetWindow,
      );
    });
    const lastOpenHistoryAnalysisCall = onOpenHistoryAnalysis.mock.calls.at(-1) as [unknown, unknown] | undefined;
    expect(lastOpenHistoryAnalysisCall).toBeTruthy();
    if (!lastOpenHistoryAnalysisCall) {
      throw new Error("expected history analysis prompt");
    }
    const historyAnalysisPrompt = String(lastOpenHistoryAnalysisCall[0] ?? "");
    const historyTargetWindow = lastOpenHistoryAnalysisCall[1];
    expect(historyTargetWindow).toBe(targetWindow);
    expect(historyAnalysisPrompt).toContain("- Task ID: task-jit-analysis");
    expect(historyAnalysisPrompt).toContain("- Repo Path: /tmp/repo-a");
    expect(historyAnalysisPrompt).toContain("- Task Type: planning");
    expect(historyAnalysisPrompt).toContain("### Transcript Hints");
    expect(historyAnalysisPrompt).toContain("~/.codex/sessions/**/session-codex*.jsonl");
    expect(historyAnalysisPrompt).toContain("### Final Matched Codex Or Claude Sessions");
    expect(historyAnalysisPrompt).toContain("Inspect the Kanban API route before touching the UI shell.");
    expect(historyAnalysisPrompt).toContain("Call `save_history_memory_context`");
    expect(historyAnalysisPrompt).toContain("Save action:");
    expect(historyAnalysisPrompt).toContain("Use `taskId=task-jit-analysis` in the tool call.");
    expect(historyAnalysisPrompt).not.toContain("\"jitContextAnalysis\"");
    expect(historyAnalysisPrompt).not.toContain("Required JSON payload:");
    expect(historyAnalysisPrompt).not.toContain("```json");
    expect(historyAnalysisPrompt).not.toContain("Preloaded tool result:");
    expect(historyAnalysisPrompt).not.toContain("The system already executed `summarize_task_history_context` before this session started.");
    expect(openSpy).toHaveBeenCalledWith("about:blank", "_blank");
    expect(screen.getByText("History analysis opened in a new page.")).toBeTruthy();
    openSpy.mockRestore();
  });

  it("renders saved structured history analysis from the persisted task snapshot", () => {
    render(
      <KanbanCardDetail
        task={{
          ...createTask("task-jit-saved-analysis", "Recover JIT context"),
          columnId: "backlog",
          assignedRole: "CRAFTER",
          jitContextSnapshot: {
            generatedAt: "2026-04-21T08:00:00.000Z",
            summary: "Recovered history context for Kanban workflow.",
            matchConfidence: "high",
            matchReasons: ["Matched the kanban-workflow feature."],
            warnings: [],
            matchedFileDetails: [{
              filePath: "crates/routa-server/src/api/kanban.rs",
              changes: 1,
              sessions: 3,
              updatedAt: "2026-04-21T08:00:00.000Z",
            }],
            matchedSessionIds: ["session-codex"],
            failures: [],
            repeatedReadFiles: [],
            sessions: [],
            analysis: {
              updatedAt: "2026-04-21T09:00:00.000Z",
              summary: "Start from the Kanban API and blocked interval reconstruction before touching the dashboard.",
              topFiles: ["crates/routa-server/src/api/kanban.rs"],
              topSessions: [{
                sessionId: "session-codex",
                provider: "codex",
                reason: "This session covered the durable flow-event implementation.",
              }],
              reusablePrompts: ["Check Rust and TS flow-event parity first."],
              recommendedContextSearchSpec: {
                query: "kanban flow event persistence",
                featureCandidates: ["kanban-workflow"],
                relatedFiles: ["crates/routa-server/src/api/kanban.rs"],
              },
            },
          },
        }}
        boardColumns={board.columns}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        sessions={[]}
        fullWidth
        onPatchTask={vi.fn(async () => createTask("task-jit-saved-analysis", "Recover JIT context"))}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "History Memory" }));

    expect(screen.getByText("Saved History Memory")).toBeTruthy();
    expect(screen.getByText("Start from the Kanban API and blocked interval reconstruction before touching the dashboard.")).toBeTruthy();
    expect(screen.getByText("Top files")).toBeTruthy();
    expect(screen.getByText("Top sessions")).toBeTruthy();
    expect(screen.getByText("Reusable prompts")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide History Memory" })).toBeTruthy();
  });

  it("keeps the selected history memory tab after the detail pane remounts", () => {
    const task = {
      ...createTask("task-jit-tab-persist", "Recover persisted history memory"),
      jitContextSnapshot: {
        generatedAt: "2026-04-22T08:00:00.000Z",
        summary: "Recovered history context for Kanban workflow.",
        matchConfidence: "high" as const,
        matchReasons: ["Matched the saved Kanban workflow memory."],
        warnings: [],
        matchedFileDetails: [],
        matchedSessionIds: [],
        failures: [],
        repeatedReadFiles: [],
        sessions: [],
        analysis: {
          updatedAt: "2026-04-22T09:00:00.000Z",
          summary: "Resume from the saved memory instead of re-reading the full backlog transcript.",
          topFiles: ["src/app/api/kanban/boards/route.ts"],
          topSessions: [{
            sessionId: "session-jit-tab-persist",
            provider: "codex",
            reason: "This session already narrowed the feature and file scope.",
          }],
          reusablePrompts: ["Start from the previously matched Kanban route before searching wider."],
        },
      },
    };

    const props = {
      task,
      boardColumns: board.columns,
      availableProviders: [],
      specialists: [],
      specialistLanguage: "en" as const,
      codebases: [],
      allCodebaseIds: [],
      worktreeCache: {},
      sessions: [],
      fullWidth: true,
      onPatchTask: vi.fn(async () => task),
      onRetryTrigger: vi.fn(),
      onDelete: vi.fn(),
      onRefresh: vi.fn(),
    };

    const firstRender = render(<KanbanCardDetail {...props} />);

    fireEvent.click(screen.getByRole("tab", { name: "History Memory" }));
    expect(screen.getByRole("tab", { name: "History Memory" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Saved History Memory")).toBeTruthy();

    firstRender.unmount();

    render(<KanbanCardDetail {...props} />);

    expect(screen.getByRole("tab", { name: "History Memory" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Saved History Memory")).toBeTruthy();
    expect(screen.queryByText("Review Feedback")).toBeNull();
  });

  it("does not load or show speculative history memory for a fresh backlog card before refinement confirms context", async () => {
    const onPatchTask = vi.fn(async () => createTask("task-backlog-unconfirmed", "Investigate feature memory"));

    render(
      <KanbanCardDetail
        task={{
          ...createTask("task-backlog-unconfirmed", "[Feature] Investigate feature memory", {
            columnId: "backlog",
            assignedRole: "CRAFTER",
            jitContextSnapshot: {
              generatedAt: "2026-04-22T08:00:00.000Z",
              summary: "Speculative feature-explorer history memory.",
              featureId: "feature-explorer",
              featureName: "Feature Explorer",
              matchConfidence: "high",
              matchReasons: ["Matched a speculative feature seed."],
              warnings: [],
              matchedFileDetails: [{
                filePath: "src/app/workspace/[workspaceId]/feature-explorer/feature-explorer-page-client.tsx",
                changes: 4,
                sessions: 3,
                updatedAt: "2026-04-22T08:00:00.000Z",
              }],
              matchedSessionIds: ["session-speculative"],
              failures: [],
              repeatedReadFiles: [],
              sessions: [],
              recommendedContextSearchSpec: {
                query: "feature explorer",
                featureCandidates: ["feature-explorer"],
                relatedFiles: ["src/app/workspace/[workspaceId]/feature-explorer/feature-explorer-page-client.tsx"],
              },
            },
          }),
        }}
        boardColumns={board.columns}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        sessions={[]}
        fullWidth
        onPatchTask={onPatchTask}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "History Memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Show History Memory" }));

    expect(screen.getByText("History memory becomes available after backlog refinement confirms feature or file hints for this card.")).toBeTruthy();
    expect(screen.queryByText("Speculative feature-explorer history memory.")).toBeNull();
    expect(screen.queryByText("Feature Explorer")).toBeNull();
    expect(desktopAwareFetch).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(onPatchTask).toHaveBeenCalledWith("task-backlog-unconfirmed", {
        jitContextSnapshot: null,
      });
    });
  });

  it("loads JIT Context from search hints even when no history sessions are linked", async () => {
    desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
      if (url === "/api/harness/task-adaptive") {
        return new Response(JSON.stringify({
          summary: "Recovered relevant files from feature search hints.",
          warnings: [],
          featureId: "kanban-workflow",
          featureName: "Kanban Workflow",
          selectedFiles: [
            "src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx",
            "src/app/api/tasks/route.ts",
          ],
          matchedFileDetails: [
            {
              filePath: "src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx",
              changes: 0,
              sessions: 0,
              updatedAt: "",
            },
            {
              filePath: "src/app/api/tasks/route.ts",
              changes: 0,
              sessions: 0,
              updatedAt: "",
            },
          ],
          matchedSessionIds: [],
          failures: [],
          repeatedReadFiles: [],
          sessions: [],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected desktopAwareFetch: ${url}`);
    });

    const onPatchTask = vi.fn(async () => createTask("task-jit-hints", "Recover JIT context"));

    render(
      <KanbanCardDetail
        task={{
          ...createTask("task-jit-hints", "Recover JIT context"),
          assignedRole: "CRAFTER",
          codebaseIds: ["repo-a"],
          contextSearchSpec: {
            query: "kanban card detail jit context",
            routeCandidates: ["/workspace/:workspaceId/kanban"],
            apiCandidates: ["POST /api/tasks"],
            moduleHints: ["kanban-card-detail"],
          },
        }}
        boardColumns={board.columns}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[{
          id: "repo-a",
          workspaceId: "workspace-1",
          repoPath: "/tmp/repo-a",
          label: "Repo A",
          isDefault: true,
          sourceType: "local",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }]}
        allCodebaseIds={["repo-a"]}
        worktreeCache={{}}
        sessions={[]}
        fullWidth
        onPatchTask={onPatchTask}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "History Memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Show History Memory" }));

    await waitFor(() => {
      expect(onPatchTask).toHaveBeenCalledWith(
        "task-jit-hints",
        expect.objectContaining({
          jitContextSnapshot: expect.objectContaining({
            featureId: "kanban-workflow",
            featureName: "Kanban Workflow",
            matchedFileDetails: expect.arrayContaining([
              expect.objectContaining({
                filePath: "src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx",
              }),
              expect.objectContaining({
                filePath: "src/app/api/tasks/route.ts",
              }),
            ]),
          }),
        }),
      );
    });

    const requestBody = JSON.parse(String(desktopAwareFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody.taskAdaptiveHarness).toEqual(expect.objectContaining({
      taskId: "task-jit-hints",
      taskLabel: "Recover JIT context",
      query: "kanban card detail jit context",
      routeCandidates: ["/workspace/:workspaceId/kanban"],
      apiCandidates: ["POST /api/tasks"],
      moduleHints: ["kanban-card-detail"],
      taskType: "planning",
      locale: "en",
      role: "CRAFTER",
    }));
  });

  it("surfaces JIT Context warnings even when no sessions or files are recovered", async () => {
    desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
      if (url === "/api/harness/task-adaptive") {
        return new Response(JSON.stringify({
          summary: "No files recovered.",
          warnings: ["Feature not found: missing-feature", "No task-adaptive files could be resolved from the current request."],
          selectedFiles: [],
          matchedFileDetails: [],
          matchedSessionIds: [],
          failures: [],
          repeatedReadFiles: [],
          sessions: [],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected desktopAwareFetch: ${url}`);
    });

    const onPatchTask = vi.fn(async () => createTask("task-jit-warnings", "Broken JIT context"));

    render(
      <KanbanCardDetail
        task={{
          ...createTask("task-jit-warnings", "Broken JIT context"),
          assignedRole: "CRAFTER",
          codebaseIds: ["repo-a"],
          contextSearchSpec: {
            featureCandidates: ["missing-feature"],
          },
        }}
        boardColumns={board.columns}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[{
          id: "repo-a",
          workspaceId: "workspace-1",
          repoPath: "/tmp/repo-a",
          label: "Repo A",
          isDefault: true,
          sourceType: "local",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }]}
        allCodebaseIds={["repo-a"]}
        worktreeCache={{}}
        sessions={[]}
        fullWidth
        onPatchTask={onPatchTask}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "History Memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Show History Memory" }));

    await waitFor(() => {
      expect(onPatchTask).toHaveBeenCalledWith(
        "task-jit-warnings",
        expect.objectContaining({
          jitContextSnapshot: expect.objectContaining({
            warnings: [
              "Feature not found: missing-feature",
              "No task-adaptive files could be resolved from the current request.",
            ],
          }),
        }),
      );
    });
  });

  it("resets JIT Context when the task context search spec changes on the same card", async () => {
    desktopAwareFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        summary: "First JIT result",
        warnings: [],
        featureId: "feature-a",
        featureName: "Feature A",
        selectedFiles: ["src/app/alpha.tsx"],
        matchedFileDetails: [{
          filePath: "src/app/alpha.tsx",
          changes: 1,
          sessions: 1,
          updatedAt: "2026-04-21T10:00:00.000Z",
        }],
        matchedSessionIds: [],
        failures: [],
        repeatedReadFiles: [],
        sessions: [],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        summary: "Second JIT result",
        warnings: [],
        featureId: "feature-b",
        featureName: "Feature B",
        selectedFiles: ["src/app/beta.tsx"],
        matchedFileDetails: [{
          filePath: "src/app/beta.tsx",
          changes: 2,
          sessions: 1,
          updatedAt: "2026-04-21T11:00:00.000Z",
        }],
        matchedSessionIds: [],
        failures: [],
        repeatedReadFiles: [],
        sessions: [],
      })));

    const onPatchTask = vi.fn(async () => createTask("task-jit-refresh", "Refresh JIT context"));

    const baseProps = {
      boardColumns: board.columns,
      availableProviders: [],
      specialists: [],
      specialistLanguage: "en" as const,
      codebases: [{
        id: "repo-a",
        workspaceId: "workspace-1",
        repoPath: "/tmp/repo-a",
        label: "Repo A",
        isDefault: true,
        sourceType: "local" as const,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      }],
      allCodebaseIds: ["repo-a"],
      worktreeCache: {},
      sessions: [],
      fullWidth: true,
      onPatchTask,
      onRetryTrigger: vi.fn(),
      onDelete: vi.fn(),
      onRefresh: vi.fn(),
    };

    const { rerender } = render(
      <KanbanCardDetail
        {...baseProps}
        task={{
          ...createTask("task-jit-refresh", "Refresh JIT context"),
          assignedRole: "CRAFTER",
          codebaseIds: ["repo-a"],
          contextSearchSpec: {
            query: "first-query",
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "History Memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Show History Memory" }));
    await waitFor(() => {
      expect(onPatchTask).toHaveBeenCalledWith(
        "task-jit-refresh",
        expect.objectContaining({
          jitContextSnapshot: expect.objectContaining({
            featureName: "Feature A",
          }),
        }),
      );
    });

    rerender(
      <KanbanCardDetail
        {...baseProps}
        task={{
          ...createTask("task-jit-refresh", "Refresh JIT context"),
          assignedRole: "CRAFTER",
          codebaseIds: ["repo-a"],
          contextSearchSpec: {
            query: "second-query",
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "History Memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Show History Memory" }));
    await waitFor(() => {
      expect(onPatchTask).toHaveBeenCalledWith(
        "task-jit-refresh",
        expect.objectContaining({
          jitContextSnapshot: expect.objectContaining({
            featureName: "Feature B",
          }),
        }),
      );
    });

    const firstRequestBody = JSON.parse(String(desktopAwareFetch.mock.calls[0]?.[1]?.body));
    const secondRequestBody = JSON.parse(String(desktopAwareFetch.mock.calls[1]?.[1]?.body));
    expect(firstRequestBody.taskAdaptiveHarness.query).toBe("first-query");
    expect(secondRequestBody.taskAdaptiveHarness.query).toBe("second-query");
    expect(screen.queryByText("Feature A")).toBeNull();
  });

  it("prefers the current override provider over a stale selected session when a rerun fails before session creation", () => {
    render(
      <KanbanCardDetail
        task={{
          ...createTask("task-stale", "Story Stale Provider"),
          assignedProvider: "claude",
          assignedRole: "CRAFTER",
          lastSyncError: "Claude Code SDK not configured. Set ANTHROPIC_AUTH_TOKEN environment variable.",
          laneSessions: [{
            sessionId: "session-old-codex",
            provider: "codex",
            role: "DEVELOPER",
            status: "failed",
            startedAt: "2025-01-01T00:00:00.000Z",
          }],
        }}
        boardColumns={board.columns}
        availableProviders={[
          {
            id: "claude",
            name: "Claude Code",
            description: "Claude provider",
            command: "claude",
            status: "available",
          },
          {
            id: "codex",
            name: "Codex",
            description: "Codex provider",
            command: "codex-acp",
            status: "available",
          },
        ]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        sessionInfo={{
          sessionId: "session-old-codex",
          workspaceId: "workspace-1",
          cwd: "/tmp/project",
          provider: "codex",
          role: "DEVELOPER",
          createdAt: "2025-01-01T00:00:00.000Z",
        }}
        sessions={[]}
        fullWidth
        onPatchTask={vi.fn(async () => createTask("task-stale", "Story Stale Provider"))}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "Execution" }));
    expect(screen.getByText(/Current run failed on Claude Code:/i)).toBeTruthy();
    expect(screen.queryByText(/Current run failed on Codex:/i)).toBeNull();
  });

  it("renders legacy A2A lane targets as ACP summaries in the execution panel", () => {
    const a2aBoard: KanbanBoardInfo = {
      ...board,
      columns: [
        {
          id: "review",
          name: "Review",
          position: 0,
          stage: "review",
          automation: {
            enabled: true,
            steps: [{
              id: "review-a2a",
              transport: "a2a",
              role: "GATE",
              specialistName: "Remote Review",
              agentCardUrl: "https://agents.example.com/reviewer/agent-card.json",
              skillId: "review",
            }],
            transitionType: "entry",
          },
        },
      ],
    };

    render(
      <KanbanCardDetail
        task={{
          ...createTask("task-a2a", "Story Remote"),
          columnId: "review",
          triggerSessionId: "a2a-session-1",
          laneSessions: [{
            sessionId: "a2a-session-1",
            columnId: "review",
            columnName: "Review",
            role: "GATE",
            specialistName: "Remote Review",
            transport: "a2a",
            externalTaskId: "remote-task-1",
            contextId: "ctx-1",
            status: "running",
            startedAt: "2025-01-01T00:00:00.000Z",
          }],
        }}
        boardColumns={a2aBoard.columns}
        availableProviders={[]}
        specialists={[{ id: "remote-review", name: "Remote Review", role: "GATE" }]}
        specialistLanguage="en"
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        sessions={[]}
        fullWidth
        onPatchTask={vi.fn(async () => createTask("task-a2a", "Story Remote"))}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "Execution" }));
    expect(screen.getAllByText(/Workspace default · GATE · Remote Review/i).length).toBeGreaterThan(0);
  });

  it("syncs detail fields when the same task updates in the background", async () => {
    const { rerender } = render(
      <KanbanCardDetail
        task={{
          ...createTask("task-sync", "Story One"),
          objective: "Initial objective",
          testCases: ["Initial test"],
          priority: "medium",
        }}
        boardColumns={board.columns}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        sessions={[]}
        fullWidth
        onPatchTask={vi.fn(async () => createTask("task-sync", "Story One"))}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue("Story One")).toBeTruthy();
    expect(screen.getByText("Initial objective")).toBeTruthy();
    expect(screen.getByText("- Initial test")).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Priority" }) as HTMLSelectElement).value).toBe("medium");

    rerender(
      <KanbanCardDetail
        task={{
          ...createTask("task-sync", "Story One Updated"),
          objective: "Updated objective",
          testCases: ["Updated test"],
          priority: "high",
        }}
        boardColumns={board.columns}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        sessions={[]}
        fullWidth
        onPatchTask={vi.fn(async () => createTask("task-sync", "Story One Updated"))}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue("Story One Updated")).toBeTruthy();
      expect(screen.getByText("Updated objective")).toBeTruthy();
      expect(screen.getByText("- Updated test")).toBeTruthy();
      expect((screen.getByRole("combobox", { name: "Priority" }) as HTMLSelectElement).value).toBe("high");
    });
  });

  it("keeps evidence summary focused on delivery readiness instead of run history", () => {
    render(
      <KanbanCardDetail
        task={{
          ...createTask("task-summary", "Story Summary"),
          columnId: "todo",
          storyReadiness: {
            ready: false,
            missing: ["scope", "verification_plan"],
            requiredTaskFields: ["scope", "acceptance_criteria", "verification_plan"],
            checks: {
              scope: false,
              acceptanceCriteria: true,
              verificationCommands: false,
              testCases: true,
              verificationPlan: true,
              dependenciesDeclared: false,
            },
          },
          investValidation: {
            source: "heuristic",
            overallStatus: "warning",
            checks: {
              independent: { status: "pass", reason: "No blocking prerequisite was detected." },
              negotiable: { status: "warning", reason: "Human review still needed." },
              valuable: { status: "pass", reason: "Objective is clear enough." },
              estimable: { status: "warning", reason: "Scope is incomplete." },
              small: { status: "pass", reason: "Story remains narrow." },
              testable: { status: "pass", reason: "Test cases exist." },
            },
            issues: [],
          },
          evidenceSummary: {
            artifact: {
              total: 1,
              byType: { screenshot: 1 },
              requiredSatisfied: false,
              missingRequired: ["test_results"],
            },
            verification: {
              hasVerdict: false,
              hasReport: true,
            },
            completion: {
              hasSummary: false,
            },
            runs: {
              total: 2,
              latestStatus: "completed",
            },
          },
        }}
        boardColumns={board.columns}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        sessions={[]}
        fullWidth
        onPatchTask={vi.fn(async () => createTask("task-summary", "Story Summary"))}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: "Story Readiness" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Story Readiness" }));
    expect(screen.getAllByText("Blocked for Dev").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "Evidence Bundle" }));
    expect(screen.getByRole("tab", { name: "Evidence Bundle" })).toBeTruthy();
    expect(screen.getAllByText("Evidence incomplete").length).toBeGreaterThan(0);
    expect(screen.getByText(/test_results/i)).toBeTruthy();
    expect(screen.queryByText("Latest Run")).toBeNull();
  });

  it("shows the full run session id in activity history", async () => {
    render(
      <KanbanCardActivityPanel
        task={{
          ...createTask("task-runs", "Story Runs"),
          columnId: "review",
          laneSessions: [{
            sessionId: "session-review-long-id-1234567890",
            columnId: "review",
            columnName: "Review",
            provider: "codex",
            role: "GATE",
            status: "running",
            startedAt: "2025-01-01T00:00:00.000Z",
          }],
        }}
        sessions={[]}
        specialists={[]}
        specialistLanguage="en"
      />,
    );

    expect(await screen.findByText("session-review-long-id-1234567890")).toBeTruthy();
  });

  it("keeps run row selection separate from copying the session id", async () => {
    const onSelectSession = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    render(
      <KanbanCardActivityPanel
        task={{
          ...createTask("task-runs-copy", "Story Runs Copy"),
          columnId: "review",
          laneSessions: [{
            sessionId: "session-review-copy-123",
            columnId: "review",
            columnName: "Review",
            provider: "codex",
            role: "GATE",
            status: "running",
            startedAt: "2025-01-01T00:00:00.000Z",
          }],
        }}
        sessions={[]}
        specialists={[]}
        specialistLanguage="en"
        onSelectSession={onSelectSession}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /run 1/i }));
    expect(onSelectSession).toHaveBeenCalledWith("session-review-copy-123");

    fireEvent.click(screen.getByRole("button", { name: "Copy to clipboard" }));
    expect(writeText).toHaveBeenCalledWith("session-review-copy-123");
    expect(onSelectSession).toHaveBeenCalledTimes(1);
  });

  it("keeps the runs tab visible in split detail mode", () => {
    render(
      <KanbanCardDetail
        task={{
          ...createTask("task-split-runs", "Story Split Runs"),
          laneSessions: [{
            sessionId: "session-split-1",
            columnId: "review",
            columnName: "Review",
            provider: "codex",
            role: "GATE",
            status: "completed",
            startedAt: "2025-01-01T00:00:00.000Z",
          }],
        }}
        boardColumns={board.columns}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        sessions={[]}
        onPatchTask={vi.fn(async () => createTask("task-split-runs", "Story Split Runs"))}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: "Runs" })).toBeTruthy();
  });

  it("shows full review feedback in the description tab after review sends the card back", () => {
    render(
      <KanbanCardDetail
        task={{
          ...createTask("task-review", "Story Review"),
          columnId: "dev",
          verificationVerdict: "NOT_APPROVED",
          verificationReport: "AC3 failed.\n\nEditor compatibility still breaks pasted rich text spans.",
        }}
        boardColumns={board.columns}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        sessions={[]}
        fullWidth
        onPatchTask={vi.fn(async () => createTask("task-review", "Story Review"))}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText("Review Feedback")).toBeTruthy();
    expect(screen.getByText("Returned to Dev")).toBeTruthy();
    expect(screen.getByText(/AC3 failed/i)).toBeTruthy();
    expect(screen.getByText(/Editor compatibility still breaks/i)).toBeTruthy();
  });
});

describe("KanbanCardActivityBar", () => {
  it("renders run tabs with lane icons and numeric labels while preserving the full title in the tooltip", async () => {
    desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/tasks/task-tabs/runs") {
        return new Response(JSON.stringify({
          runs: [
            { id: "run-1", sessionId: "session-1", status: "failed", kind: "embedded_acp" },
            { id: "run-2", sessionId: "session-2", status: "completed", kind: "embedded_acp" },
          ],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected desktopAwareFetch: ${url}`);
    });

    render(
      <KanbanCardActivityBar
        task={createTask("task-tabs", "Compact run tabs", {
          laneSessions: [
            {
              sessionId: "session-1",
              stepName: "Backlog 梳理员",
              columnName: "Backlog",
              status: "failed",
              startedAt: "2025-01-01T00:00:00.000Z",
            },
            {
              sessionId: "session-2",
              stepName: "开发执行员",
              columnName: "Todo",
              status: "completed",
              startedAt: "2025-01-01T00:10:00.000Z",
            },
          ],
          triggerSessionId: "session-2",
        })}
        sessions={[
          {
            sessionId: "session-1",
            name: "Backlog 梳理员",
            workspaceId: "workspace-1",
            cwd: "/tmp/repo",
            provider: "codex",
            createdAt: "2025-01-01T00:00:00.000Z",
          },
          {
            sessionId: "session-2",
            name: "开发执行员",
            workspaceId: "workspace-1",
            cwd: "/tmp/repo",
            provider: "codex",
            createdAt: "2025-01-01T00:10:00.000Z",
          },
        ]}
        currentSessionId="session-2"
        onSelectSession={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTitle("Backlog 梳理员 · Backlog · Run 1")).toBeTruthy();
      expect(screen.getByTitle("开发执行员 · Todo · Run 2")).toBeTruthy();
    });

    expect(screen.queryByText("BAC 梳理")).toBeNull();
    expect(screen.queryByText("Backlog 梳理员")).toBeNull();
    expect(screen.getByTitle("Backlog 梳理员 · Backlog · Run 1").getAttribute("title")).toBe(
      "Backlog 梳理员 · Backlog · Run 1",
    );
    expect(screen.getByLabelText("Backlog")).toBeTruthy();
    expect(screen.getByTitle("Backlog 梳理员 · Backlog · Run 1").parentElement?.className).toContain("flex-wrap");
  });
});

describe("KanbanTab live session tail", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("polls active trigger session history and shows the latest tail on the card", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/sessions/session-123/history?consolidated=true") {
        return {
          ok: true,
          json: async () => ({
            history: [
              { update: { sessionUpdate: "agent_message", content: { type: "text", text: "Done. Added live tail support." } } },
            ],
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: GET ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[{
          ...createTask("task-1", "Story One"),
          triggerSessionId: "session-123",
          laneSessions: [{
            sessionId: "session-123",
            status: "running",
            startedAt: "2025-01-01T00:00:00.000Z",
          }],
        }]}
        sessions={[{
          sessionId: "session-123",
          cwd: "/tmp/project",
          workspaceId: "workspace-1",
          provider: "claude",
          acpStatus: "ready",
          createdAt: "2025-01-01T00:00:00.000Z",
        }]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session-123/history?consolidated=true", { cache: "no-store" });
      expect(screen.getByTestId("kanban-card-live-tail").textContent).toContain("Added live tail support.");
    });
  });

  it("does not poll history for completed trigger sessions", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[{
          ...createTask("task-1", "Story One"),
          triggerSessionId: "session-123",
          laneSessions: [{
            sessionId: "session-123",
            status: "completed",
            startedAt: "2025-01-01T00:00:00.000Z",
            completedAt: "2025-01-01T00:01:00.000Z",
          }],
        }]}
        sessions={[{
          sessionId: "session-123",
          cwd: "/tmp/project",
          workspaceId: "workspace-1",
          provider: "claude",
          acpStatus: "ready",
          createdAt: "2025-01-01T00:00:00.000Z",
        }]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).not.toHaveBeenCalled();
    });
    expect(screen.queryByTestId("kanban-card-live-tail")).toBeNull();
  });

  it("uses a slower polling cadence for live session tails", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        history: [
          { update: { sessionUpdate: "agent_message", content: { type: "text", text: "Still working." } } },
        ],
      }),
    }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[{
          ...createTask("task-1", "Story One"),
          triggerSessionId: "session-123",
          laneSessions: [{
            sessionId: "session-123",
            status: "running",
            startedAt: "2025-01-01T00:00:00.000Z",
          }],
        }]}
        sessions={[{
          sessionId: "session-123",
          cwd: "/tmp/project",
          workspaceId: "workspace-1",
          provider: "claude",
          acpStatus: "ready",
          createdAt: "2025-01-01T00:00:00.000Z",
        }]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not poll live session tails while the page is hidden", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        history: [
          { update: { sessionUpdate: "agent_message", content: { type: "text", text: "Still working." } } },
        ],
      }),
    }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    const visibilityState = { value: "visible" };
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState.value,
    });

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[{
          ...createTask("task-1", "Story One"),
          triggerSessionId: "session-123",
          laneSessions: [{
            sessionId: "session-123",
            status: "running",
            startedAt: "2025-01-01T00:00:00.000Z",
          }],
        }]}
        sessions={[{
          sessionId: "session-123",
          cwd: "/tmp/project",
          workspaceId: "workspace-1",
          provider: "claude",
          acpStatus: "ready",
          createdAt: "2025-01-01T00:00:00.000Z",
        }]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      visibilityState.value = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      visibilityState.value = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("KanbanTab agent prompt flow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a read-only terminal hint when the Kanban agent panel opens", async () => {
    vi.stubGlobal(
      "scrollIntoView",
      vi.fn(),
    );
    window.HTMLElement.prototype.scrollIntoView = vi.fn();

    const acp = {
      connected: true,
      sessionId: null,
      updates: [],
      providers: [{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude", status: "available" }],
      selectedProvider: "claude",
      loading: false,
      error: null,
      authError: null,
      dockerConfigError: null,
      connect: vi.fn(),
      createSession: vi.fn(),
      resumeSession: vi.fn(),
      forkSession: vi.fn(),
      selectSession: vi.fn(),
      setProvider: vi.fn(),
      setMode: vi.fn(),
      prompt: vi.fn(),
      promptSession: vi.fn(),
      respondToUserInput: vi.fn(),
      respondToUserInputForSession: vi.fn(),
      writeTerminal: vi.fn(),
      resizeTerminal: vi.fn(),
      cancel: vi.fn(),
      disconnect: vi.fn(),
      clearAuthError: vi.fn(),
      clearDockerConfigError: vi.fn(),
      listProviderModels: vi.fn(),
    } satisfies Partial<UseAcpState & UseAcpActions> as UseAcpState & UseAcpActions;

    const onAgentPrompt = vi.fn().mockResolvedValue("session-123");

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[createTask("task-1", "Story One")]}
        sessions={[
          {
            sessionId: "session-123",
            cwd: "/tmp/project",
            workspaceId: "workspace-1",
            provider: "claude",
            createdAt: "2025-01-01T00:00:00.000Z",
          },
        ]}
        providers={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude", status: "available" }]}
        specialists={[]}
        specialistLanguage="en"
        onSpecialistLanguageChange={vi.fn()}
        codebases={[]}
        onRefresh={vi.fn()}
        acp={acp}
        onAgentPrompt={onAgentPrompt}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Describe work to plan in Kanban..."), {
      target: { value: "Investigate lane issue" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(onAgentPrompt).toHaveBeenCalled();
    });
    expect(onAgentPrompt).toHaveBeenCalledWith(
      "Investigate lane issue",
      expect.objectContaining({
        provider: "claude",
        role: "CRAFTER",
        toolMode: "full",
        allowedNativeTools: ["Read", "Grep", "Glob"],
        mcpProfile: "kanban-planning",
        systemPrompt: expect.stringContaining("You are the KanbanTask Agent"),
        taskAdaptiveHarness: {
          taskLabel: "Investigate lane issue",
          taskType: "planning",
          locale: "en",
          role: "CRAFTER",
        },
      }),
    );
    await waitFor(() => {
      expect(screen.queryByDisplayValue("Investigate lane issue")).toBeNull();
    });
  });

  it("localizes the KanbanTask Agent input and prompt in Chinese", async () => {
    const onAgentPrompt = vi.fn(async () => null);
    const acp = {
      connected: true,
      selectedProvider: "claude",
      setProvider: vi.fn(),
      selectSession: vi.fn(),
    } as unknown as UseAcpState & UseAcpActions;

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[createTask("task-1", "Story One")]}
        sessions={[]}
        providers={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude", status: "available" }]}
        specialists={[]}
        specialistLanguage="zh-CN"
        onSpecialistLanguageChange={vi.fn()}
        codebases={[]}
        onRefresh={vi.fn()}
        acp={acp}
        onAgentPrompt={onAgentPrompt}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("描述要在 Kanban 中规划的工作..."), {
      target: { value: "调查 lane 问题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(onAgentPrompt).toHaveBeenCalled();
    });
    expect(onAgentPrompt).toHaveBeenCalledWith(
      "调查 lane 问题",
      expect.objectContaining({
        provider: "claude",
        role: "CRAFTER",
        toolMode: "full",
        allowedNativeTools: ["Read", "Grep", "Glob"],
        mcpProfile: "kanban-planning",
        systemPrompt: expect.stringContaining("你是当前工作区的看板任务代理"),
        taskAdaptiveHarness: {
          taskLabel: "调查 lane 问题",
          taskType: "planning",
          locale: "zh-CN",
          role: "CRAFTER",
        },
      }),
    );
    expect(screen.getByDisplayValue("调查 lane 问题")).toBeTruthy();
  });

  it("renders canonical story descriptions instead of leaving the detail blank", () => {
    render(
      <KanbanCardDetail
        task={{
          ...createTask("task-canonical", "Canonical Story"),
          objective: `\`\`\`yaml
story:
  version: 1
  language: en
  title: Upgrade @tiptap/core safely
  problem_statement: |
    Dependency upgrades can regress editor behavior without explicit validation.
  user_value: |
    Maintainers can review the change as a structured story instead of raw YAML only.
  acceptance_criteria:
    - id: AC1
      text: Detail view shows the canonical story content.
      testable: true
    - id: AC2
      text: Reviewers can inspect the AI-produced analysis in place.
      testable: true
  constraints_and_affected_areas:
    - src/app/workspace/[workspaceId]/kanban/kanban-description-editor.tsx
  dependencies_and_sequencing:
    independent_story_check: pass
    depends_on: []
    unblock_condition: none
  out_of_scope:
    - unrelated UI cleanup
  invest:
    independent:
      status: pass
      reason: No blocking prerequisites.
    negotiable:
      status: pass
      reason: Tradeoffs can still be discussed.
    valuable:
      status: pass
      reason: Reviewers need visible story context.
    estimable:
      status: pass
      reason: Scope is constrained to description rendering.
    small:
      status: pass
      reason: One focused UI fix.
    testable:
      status: pass
      reason: Visible renderer can be asserted in tests.
\`\`\``,
        }}
        boardColumns={board.columns}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        sessions={[]}
        fullWidth
        onPatchTask={vi.fn(async () => createTask("task-canonical", "Canonical Story"))}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(document.body.textContent ?? "").toContain("Dependency upgrades can regress editor behavior");
    expect(document.body.textContent ?? "").toContain("Maintainers can review the change as a structured story instead of raw YAML only.");
  });
});
