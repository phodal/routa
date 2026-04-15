import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { KanbanTab } from "../kanban-tab";
import { KanbanCardDetail } from "../kanban-card-detail";
import { KanbanCardActivityPanel } from "../kanban-card-activity";
import { KanbanMoveBlockedModal } from "../kanban-tab-modals";
import { buildKanbanSessionRestorePrompt } from "../kanban-tab-panels";
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
        onOpenCard={vi.fn()}
      />,
    );

    expect(screen.getByText("Cannot Move Card")).toBeTruthy();
    expect(screen.getByText("This move is blocked by the story-readiness gate for the target lane.")).toBeTruthy();
    expect(screen.getByText(/Required for next move:/)).toBeTruthy();
    expect(screen.getByText(/Missing fields:/)).toBeTruthy();
    expect(screen.getByText(/Use `update_task` to fill structured fields/)).toBeTruthy();
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

    fireEvent.click(screen.getByRole("button", { name: "Execution" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Execution" }));
    expect(screen.getByText(/Current run failed on Auggie:/i)).toBeTruthy();
    expect(screen.getByText(/403 Forbidden/i)).toBeTruthy();
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

    fireEvent.click(screen.getByRole("button", { name: "Execution" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Execution" }));
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

    expect(screen.getByRole("button", { name: "Story Readiness" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Story Readiness" }));
    expect(screen.getAllByText("Blocked for Dev").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Evidence Bundle" }));
    expect(screen.getByRole("button", { name: "Evidence Bundle" })).toBeTruthy();
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

    expect(screen.getByRole("button", { name: "Runs" })).toBeTruthy();
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
        allowedNativeTools: [],
        mcpProfile: "kanban-planning",
        systemPrompt: expect.stringContaining("You are the KanbanTask Agent"),
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
        allowedNativeTools: [],
        mcpProfile: "kanban-planning",
        systemPrompt: expect.stringContaining("你是当前工作区的看板任务代理"),
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
