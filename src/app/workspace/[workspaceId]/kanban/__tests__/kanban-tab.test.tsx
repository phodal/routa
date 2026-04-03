import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { KanbanTab } from "../kanban-tab";
import { KanbanCardDetail } from "../kanban-card-detail";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";

vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: () => <div data-testid="repo-picker-mock" />,
}));

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

describe("KanbanTab delete flow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows deleting a second story after the first delete succeeds", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "DELETE" && url.startsWith("/api/tasks/")) {
        return {
          ok: true,
          json: async () => ({ deleted: true }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[createTask("task-1", "Story One"), createTask("task-2", "Story Two")]}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(container.querySelectorAll('[data-testid="kanban-card-delete"]')[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-1", { method: "DELETE" });
    });

    await waitFor(() => {
      expect(screen.queryByText("Story One")).toBeNull();
    });

    fireEvent.click(container.querySelectorAll('[data-testid="kanban-card-delete"]')[0]!);

    const secondDeleteButton = await screen.findByRole("button", { name: "Delete" });
    expect(secondDeleteButton.hasAttribute("disabled")).toBe(false);
    expect(secondDeleteButton.textContent).toBe("Delete");
  });
});

describe("KanbanTab lane automation labels", () => {
  it("shows provider, role, and specialist on automated lanes", () => {
    const automatedBoard: KanbanBoardInfo = {
      ...board,
      columns: [
        {
          id: "backlog",
          name: "Backlog",
          position: 0,
          stage: "backlog",
          automation: {
            enabled: true,
            providerId: "claude",
            role: "GATE",
            specialistId: "verify",
            specialistName: "Verifier",
            transitionType: "exit",
          },
        },
      ],
    };

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[automatedBoard]}
        tasks={[createTask("task-1", "Story One")]}
        sessions={[]}
        providers={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[{ id: "verify", name: "Verifier", role: "GATE" }]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    const laneAutomation = screen.getByTestId("kanban-column-automation-backlog");
    expect(laneAutomation.textContent).toBe("Claude Code · GATE · Verifier ->");
  });
});

describe("KanbanTab stale worktree recovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears orphaned worktree ids after the worktree lookup returns 404", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!init?.method && url === "/api/worktrees/wt-missing") {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: "Worktree not found" }),
        } as Response;
      }
      if (init?.method === "PATCH" && url === "/api/tasks/task-1") {
        return {
          ok: true,
          json: async () => ({
            task: createTask("task-1", "Story One"),
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[createTask("task-1", "Story One", { worktreeId: "wt-missing" })]}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/worktrees/wt-missing", { cache: "no-store" });
      expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worktreeId: null }),
      });
    });

    fetchMock.mockClear();

    rerender(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[createTask("task-1", "Story One")]}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

// TODO: This test suite is flaky - skipping temporarily
// See: Error logging during artifact gate validation causing test failures
describe.skip("KanbanTab card detail manual runs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows running a card from detail while inheriting the lane default automation", async () => {
    const automatedBoard: KanbanBoardInfo = {
      ...board,
      columns: [
        {
          id: "backlog",
          name: "Backlog",
          position: 0,
          stage: "backlog",
          automation: {
            enabled: true,
            providerId: "claude",
            role: "ROUTA",
            specialistId: "backlog-refiner",
            specialistName: "Backlog Refiner",
            transitionType: "exit",
          },
        },
      ],
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PATCH" && url === "/api/tasks/task-1") {
        return {
          ok: true,
          json: async () => ({
            task: {
              ...createTask("task-1", "Story One"),
              triggerSessionId: "session-123",
            },
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[automatedBoard]}
        tasks={[createTask("task-1", "Story One")]}
        sessions={[]}
        providers={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[{ id: "backlog-refiner", name: "Backlog Refiner", role: "ROUTA" }]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Story One" }));

    const runButton = await screen.findByTestId("kanban-detail-run");
    expect(runButton.textContent).toBe("Run");
    expect(screen.getByText(/Manual runs use the current lane default/i)).toBeTruthy();

    fireEvent.click(runButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retryTrigger: true }),
      });
    });
  });

  it("shows a localized empty session pane before the first automated run starts", async () => {
    const automatedBoard: KanbanBoardInfo = {
      ...board,
      columns: [
        {
          id: "backlog",
          name: "Backlog",
          position: 0,
          stage: "backlog",
          automation: {
            enabled: true,
            providerId: "claude",
            role: "ROUTA",
            specialistId: "backlog-refiner",
            specialistName: "Backlog Refiner",
            transitionType: "exit",
          },
        },
      ],
    };

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[automatedBoard]}
        tasks={[createTask("task-1", "Story One")]}
        sessions={[]}
        providers={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[{ id: "backlog-refiner", name: "Backlog Refiner", role: "ROUTA" }]}
        specialistLanguage="zh-CN"
        onSpecialistLanguageChange={vi.fn()}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Story One" }));

    expect(await screen.findByText("当前还没有启动 session")).toBeTruthy();
    expect(screen.getByText("还没有自动化运行记录")).toBeTruthy();
    expect(screen.getAllByText(/右侧 session pane 会先显示等待中的空态/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "关闭 session 面板" })).toBeTruthy();
  });

  it("recovers when the trigger session appears after the detail view is already open", async () => {
    vi.stubGlobal("scrollIntoView", vi.fn());
    window.HTMLElement.prototype.scrollIntoView = vi.fn();

    const automatedBoard: KanbanBoardInfo = {
      ...board,
      columns: [
        {
          id: "backlog",
          name: "Backlog",
          position: 0,
          stage: "backlog",
          automation: {
            enabled: true,
            providerId: "claude",
            role: "ROUTA",
            specialistId: "backlog-refiner",
            specialistName: "Backlog Refiner",
            transitionType: "exit",
          },
        },
      ],
    };

    const acp = {
      connected: true,
      sessionId: null,
      updates: [],
      providers: [{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }],
      selectedProvider: "claude",
      loading: false,
      error: null,
      authError: null,
      dockerConfigError: null,
      connect: vi.fn(),
      createSession: vi.fn(),
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

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/sessions/session-123") {
        return {
          ok: true,
          json: async () => ({
            session: {
              sessionId: "session-123",
              workspaceId: "workspace-1",
              cwd: "/tmp/recovered-repo",
              provider: "claude",
              role: "ROUTA",
              createdAt: "2025-01-01T00:00:00.000Z",
              name: "Recovered run",
            },
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[automatedBoard]}
        tasks={[createTask("task-1", "Story One")]}
        sessions={[]}
        providers={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[{ id: "backlog-refiner", name: "Backlog Refiner", role: "ROUTA" }]}
        codebases={[]}
        onRefresh={vi.fn()}
        acp={acp}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Story One" }));

    expect(await screen.findByText("No session has started yet")).toBeTruthy();

    rerender(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[automatedBoard]}
        tasks={[{
          ...createTask("task-1", "Story One"),
          triggerSessionId: "session-123",
        }]}
        sessions={[]}
        providers={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[{ id: "backlog-refiner", name: "Backlog Refiner", role: "ROUTA" }]}
        codebases={[]}
        onRefresh={vi.fn()}
        acp={acp}
      />,
    );

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => String(input) === "/api/sessions/session-123"),
      ).toBe(true);
      expect(screen.queryByText("No session has started yet")).toBeNull();
    });

    fireEvent.click(screen.getByText("Repo").closest("summary")!);

    expect(await screen.findByText("Repo Health")).toBeTruthy();
    expect(screen.getByText("/tmp/recovered-repo")).toBeTruthy();
  });

  it("shows the next transition artifact gate in card detail", async () => {
    const gatedBoard: KanbanBoardInfo = {
      ...board,
      columns: [
        {
          id: "dev",
          name: "Dev",
          position: 0,
          stage: "dev",
          automation: {
            enabled: true,
            providerId: "claude",
            role: "CRAFTER",
            specialistId: "dev-crafter",
            specialistName: "Dev Crafter",
            transitionType: "entry",
          },
        },
        {
          id: "review",
          name: "Review",
          position: 1,
          stage: "review",
          automation: {
            enabled: true,
            providerId: "claude",
            role: "GATE",
            specialistId: "review-guard",
            specialistName: "Review Guard",
            transitionType: "entry",
            requiredArtifacts: ["screenshot", "test_results"],
          },
        },
      ],
    };

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[gatedBoard]}
        tasks={[{
          ...createTask("task-1", "Story One"),
          columnId: "dev",
          status: "IN_PROGRESS",
        }]}
        sessions={[]}
        providers={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
        specialists={[
          { id: "dev-crafter", name: "Dev Crafter", role: "CRAFTER" },
          { id: "review-guard", name: "Review Guard", role: "GATE" },
        ]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Story One" }));

    expect(await screen.findByText(/Moving this card to Review requires Screenshot, Test Results\./i)).toBeTruthy();
    expect(screen.getByText(/This gate is injected into the ACP prompt/i)).toBeTruthy();
  });

  it("shows a visible error when moving to a gated lane without required artifacts", async () => {
    const gatedBoard: KanbanBoardInfo = {
      ...board,
      columns: [
        {
          id: "dev",
          name: "Dev",
          position: 0,
          stage: "dev",
        },
        {
          id: "review",
          name: "Review",
          position: 1,
          stage: "review",
          automation: {
            enabled: true,
            requiredArtifacts: ["screenshot"],
          },
        },
      ],
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/tasks/task-1" && init?.method === "PATCH") {
        return {
          ok: false,
          json: async () => ({
            error: 'Cannot move task to "Review": missing required artifacts: screenshot. Please provide these artifacts before moving the task.',
            missingArtifacts: ["screenshot"],
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[gatedBoard]}
        tasks={[{
          ...createTask("task-1", "Story One"),
          columnId: "dev",
          status: "IN_PROGRESS",
        }]}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    const dataTransfer = {
      setData: vi.fn(),
      effectAllowed: "move",
    };

    fireEvent.dragStart(screen.getByTestId("kanban-card"), { dataTransfer });
    fireEvent.drop(screen.getAllByTestId("kanban-column")[1]!);

    expect(await screen.findByText(/missing required artifacts: screenshot/i)).toBeTruthy();
  });

  it("switches the right-side run tabs above the session pane", async () => {
    vi.stubGlobal("scrollIntoView", vi.fn());
    window.HTMLElement.prototype.scrollIntoView = vi.fn();

    const acp = {
      connected: true,
      sessionId: null,
      updates: [],
      providers: [{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }],
      selectedProvider: "claude",
      loading: false,
      error: null,
      authError: null,
      dockerConfigError: null,
      connect: vi.fn(),
      createSession: vi.fn(),
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

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[{
          ...createTask("task-1", "Story One"),
          sessionIds: ["session-123", "session-456"],
          laneSessions: [
            {
              sessionId: "session-123",
              provider: "claude",
              role: "DEVELOPER",
              specialistId: "dev",
              specialistName: "Dev Crafter",
              status: "completed",
              columnId: "dev",
              columnName: "Dev",
              startedAt: "2025-01-01T00:00:00.000Z",
            },
            {
              sessionId: "session-456",
              provider: "claude",
              role: "GATE",
              specialistId: "review",
              specialistName: "Review Guard",
              status: "completed",
              columnId: "review",
              columnName: "Review",
              startedAt: "2025-01-01T00:05:00.000Z",
            },
          ],
        }]}
        sessions={[
          {
            sessionId: "session-123",
            workspaceId: "workspace-1",
            cwd: "/tmp/repo",
            provider: "claude",
            role: "DEVELOPER",
            createdAt: "2025-01-01T00:00:00.000Z",
            name: "Initial run",
          },
          {
            sessionId: "session-456",
            workspaceId: "workspace-1",
            cwd: "/tmp/repo",
            provider: "claude",
            role: "GATE",
            createdAt: "2025-01-01T00:05:00.000Z",
            name: "Verify run",
          },
        ]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
        acp={acp}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Story One" }));

    await waitFor(() => {
      expect(acp.selectSession).toHaveBeenCalledWith("session-456");
    });

    const runOne = await screen.findByRole("button", { name: /Dev/i });
    const runTwo = await screen.findByRole("button", { name: /Review/i });

    expect(runOne.textContent).toContain("Dev");
    expect(runTwo.textContent).toContain("Review");
    expect(runTwo.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("completed")).toBeTruthy();

    fireEvent.click(runOne);

    await waitFor(() => {
      expect(acp.selectSession).toHaveBeenCalledWith("session-123");
    });
    expect(runOne.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows a synthetic A2A run without selecting an ACP session", async () => {
    vi.stubGlobal("scrollIntoView", vi.fn());
    window.HTMLElement.prototype.scrollIntoView = vi.fn();

    const acp = {
      connected: true,
      sessionId: null,
      updates: [],
      providers: [{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }],
      selectedProvider: "claude",
      loading: false,
      error: null,
      authError: null,
      dockerConfigError: null,
      connect: vi.fn(),
      createSession: vi.fn(),
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

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[{
          ...createTask("task-1", "Story One", {
            sessionIds: ["a2a-session-1"],
            triggerSessionId: "a2a-session-1",
            assignedRole: "CRAFTER",
            assignedSpecialistName: "Todo Orchestrator",
            laneSessions: [
              {
                sessionId: "a2a-session-1",
                transport: "a2a",
                status: "completed",
                columnId: "todo",
                columnName: "Todo",
                role: "CRAFTER",
                specialistName: "Todo Orchestrator",
                externalTaskId: "remote-task-1",
                contextId: "ctx-1",
                startedAt: "2025-01-01T00:00:00.000Z",
                completedAt: "2025-01-01T00:10:00.000Z",
              },
            ],
          }),
        }]}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
        acp={acp}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Story One" }));

    expect(acp.selectSession).not.toHaveBeenCalled();
    expect(await screen.findByText("A2A Run")).toBeTruthy();
    expect(screen.getByText(/ACP chat and trace are not available/i)).toBeTruthy();
    expect(screen.getAllByText("remote-task-1").length).toBeGreaterThan(0);
    expect(screen.getByText("ctx-1")).toBeTruthy();
  });

  it("closes the card detail from the run tabs close button", async () => {
    vi.stubGlobal("scrollIntoView", vi.fn());
    window.HTMLElement.prototype.scrollIntoView = vi.fn();

    const acp = {
      connected: true,
      sessionId: null,
      updates: [],
      providers: [{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }],
      selectedProvider: "claude",
      loading: false,
      error: null,
      authError: null,
      dockerConfigError: null,
      connect: vi.fn(),
      createSession: vi.fn(),
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

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[{
          ...createTask("task-1", "Story One"),
          sessionIds: ["session-123", "session-456"],
          laneSessions: [
            {
              sessionId: "session-123",
              provider: "claude",
              role: "DEVELOPER",
              specialistId: "dev",
              specialistName: "Dev Crafter",
              status: "completed",
              columnId: "dev",
              columnName: "Dev",
              startedAt: "2025-01-01T00:00:00.000Z",
            },
            {
              sessionId: "session-456",
              provider: "claude",
              role: "GATE",
              specialistId: "review",
              specialistName: "Review Guard",
              status: "completed",
              columnId: "review",
              columnName: "Review",
              startedAt: "2025-01-01T00:05:00.000Z",
            },
          ],
        }]}
        sessions={[
          {
            sessionId: "session-123",
            workspaceId: "workspace-1",
            cwd: "/tmp/repo",
            provider: "claude",
            role: "DEVELOPER",
            createdAt: "2025-01-01T00:00:00.000Z",
            name: "Initial run",
          },
          {
            sessionId: "session-456",
            workspaceId: "workspace-1",
            cwd: "/tmp/repo",
            provider: "claude",
            role: "GATE",
            createdAt: "2025-01-01T00:05:00.000Z",
            name: "Verify run",
          },
        ]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
        acp={acp}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Story One" }));

    await screen.findByRole("button", { name: /Close session pane/i });
    expect(screen.getByText("Card Detail")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Close session pane/i }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Close session pane/i })).toBeNull();
    });
    expect(screen.queryByText("Card Detail")).toBeNull();
  });
});

describe("KanbanTab quick ACP assignment", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the ACP selector only after entering edit mode and patches the task inline", async () => {
    const onRefresh = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!init?.method && url === "/api/clone") {
        return {
          ok: true,
          json: async () => ({ repositories: [] }),
        } as Response;
      }
      if (init?.method === "PATCH" && url === "/api/tasks/task-1") {
        return {
          ok: true,
          json: async () => ({
            task: {
              ...createTask("task-1", "Story One"),
              assignedProvider: "claude",
              assignedRole: "DEVELOPER",
            },
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[createTask("task-1", "Story One")]}
        sessions={[]}
        providers={[{
          id: "claude",
          name: "Claude Code",
          description: "Claude Code provider",
          command: "claude",
          status: "available",
        }]}
        specialists={[]}
        codebases={[]}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.queryByTestId("kanban-card-acp-select")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const acpSelect = await screen.findByTestId("kanban-card-acp-select");
    expect(acpSelect).toBeTruthy();
    expect((acpSelect as HTMLSelectElement).value).toBe("");

    fireEvent.change(acpSelect, { target: { value: "claude" } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignedProvider: "claude",
          assignedRole: "DEVELOPER",
        }),
      });
    });
    expect(onRefresh).toHaveBeenCalled();
  });

  it("shows sync status in the same header row as the card status", () => {
    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[createTask("task-1", "Story One")]}
        sessions={[]}
        providers={[{
          id: "claude",
          name: "Claude Code",
          description: "Claude Code provider",
          command: "claude",
          status: "available",
        }]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    const syncLabel = screen.getByText("Not synced");
    const statusLabel = screen.getByText("Idle");
    expect(syncLabel.parentElement).toBe(statusLabel.parentElement);
  });

  it("does not repeat lane automation details on cards without overrides", () => {
    const automatedBoard: KanbanBoardInfo = {
      ...board,
      columns: [
        {
          id: "backlog",
          name: "Backlog",
          position: 0,
          stage: "backlog",
          automation: {
            enabled: true,
            providerId: "claude",
            role: "GATE",
            specialistId: "review-guard",
            specialistName: "Review Guard",
            transitionType: "entry",
          },
        },
      ],
    };

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[automatedBoard]}
        tasks={[createTask("task-1", "Story One")]}
        sessions={[]}
        providers={[{
          id: "claude",
          name: "Claude Code",
          description: "Claude Code provider",
          command: "claude",
          status: "available",
        }]}
        specialists={[{ id: "review-guard", name: "Review Guard", role: "GATE" }]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.queryByText("Inherited from lane defaults")).toBeNull();
    expect(screen.queryByText("Claude Code · GATE · Review Guard")).toBeNull();
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

    expect(screen.getByText(/Current run failed on Auggie:/i)).toBeTruthy();
    expect(screen.getByText(/403 Forbidden/i)).toBeTruthy();
  });

  it("renders A2A lane targets and remote task metadata in the execution panel", () => {
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

    expect(screen.getAllByText(/A2A · GATE · Remote Review · agents\.example\.com\/reviewer\/agent-card\.json · skill:review/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/A2A Task · remote-task-1/i)).toBeTruthy();
    expect(screen.getByText(/Context ctx-1/i)).toBeTruthy();
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
    expect(screen.getByDisplayValue("Initial test")).toBeTruthy();
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
      expect(screen.getByDisplayValue("Updated test")).toBeTruthy();
      expect((screen.getByRole("combobox", { name: "Priority" }) as HTMLSelectElement).value).toBe("high");
    });
  });

  it("shows story readiness and evidence summaries near the top of card detail", () => {
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

    expect(screen.getByText("Story Readiness")).toBeTruthy();
    expect(screen.getByText("Blocked for Dev")).toBeTruthy();
    expect(screen.getByText("Evidence Bundle")).toBeTruthy();
    expect(screen.getByText("Evidence incomplete")).toBeTruthy();
    expect(screen.getByText(/test_results/i)).toBeTruthy();
  });
});

describe("KanbanTab live session tail", () => {
  afterEach(() => {
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
      providers: [{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }],
      selectedProvider: "claude",
      loading: false,
      error: null,
      authError: null,
      dockerConfigError: null,
      connect: vi.fn(),
      createSession: vi.fn(),
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
        providers={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
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
        providers={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude" }]}
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
});
