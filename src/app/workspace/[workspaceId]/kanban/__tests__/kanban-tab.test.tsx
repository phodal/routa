import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { KanbanTab } from "../kanban-tab";
import { KanbanCardDetail } from "../kanban-card-detail";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";

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

afterEach(() => {
  desktopAwareFetch.mockReset();
});

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

describe("KanbanTab GitHub import", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves the selected ACP provider when importing backlog issues", async () => {
    desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/github/issues?workspaceId=workspace-1&codebaseId=codebase-1") {
        return {
          ok: true,
          json: async () => ({
            repo: "phodal/routa-js",
            codebase: { id: "codebase-1", label: "routa-js" },
            issues: [{
              id: "issue-1",
              number: 161,
              title: "Imported issue",
              body: "Imported from GitHub",
              url: "https://github.com/phodal/routa-js/issues/161",
              state: "open",
              labels: ["bug"],
              assignees: [],
              updatedAt: "2025-01-01T00:00:00.000Z",
            }],
          }),
        } as Response;
      }
      throw new Error(`Unexpected desktopAwareFetch: ${url}`);
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/tasks" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            task: createTask("task-imported", "Imported issue", {
              assignedProvider: "codex",
              codebaseIds: ["codebase-1"],
            }),
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
        tasks={[]}
        sessions={[]}
        providers={[{
          id: "codex",
          name: "Codex",
          description: "Codex provider",
          command: "codex-acp",
          status: "available",
        }]}
        specialists={[]}
        codebases={[{
          id: "codebase-1",
          repoPath: "/Users/phodal/repos/routa-js",
          sourceUrl: "https://github.com/phodal/routa-js",
          isDefault: true,
          label: "routa-js",
          branch: "main",
        }]}
        acp={{
          connected: true,
          sessionId: null,
          updates: [],
          providers: [],
          selectedProvider: "codex",
          loading: false,
          error: null,
          authError: null,
          dockerConfigError: null,
          setProvider: vi.fn(),
          connect: vi.fn(),
          disconnect: vi.fn(),
          createSession: vi.fn(),
          createSessionWithOptions: vi.fn(),
          createSessionWithWorkspace: vi.fn(),
          prompt: vi.fn(),
          cancel: vi.fn(),
          listSessions: vi.fn(),
          selectSession: vi.fn(),
          deleteSession: vi.fn(),
          listProviderModels: vi.fn(),
          clearAuthError: vi.fn(),
        } as UseAcpState & UseAcpActions}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /import issues/i }));

    expect(await screen.findByRole("link", { name: /imported issue/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /import selected/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace-1",
          boardId: "board-1",
          columnId: "backlog",
          title: "Imported issue",
          objective: "Imported from GitHub",
          labels: ["bug"],
          codebaseIds: ["codebase-1"],
          githubId: "issue-1",
          githubNumber: 161,
          githubUrl: "https://github.com/phodal/routa-js/issues/161",
          githubRepo: "phodal/routa-js",
          githubState: "open",
          assignedProvider: "codex",
        }),
      });
    });
  });
});

describe("KanbanTab manual card creation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves the selected ACP provider when creating a manual card", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/tasks" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            task: createTask("task-manual", "create a js hello world", {
              assignedProvider: "codex",
              codebaseIds: ["codebase-1"],
            }),
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
        tasks={[]}
        sessions={[]}
        providers={[{
          id: "codex",
          name: "Codex",
          description: "Codex provider",
          command: "codex-acp",
          status: "available",
        }]}
        specialists={[]}
        codebases={[{
          id: "codebase-1",
          repoPath: "/Users/phodal/repos/routa-js",
          sourceUrl: "https://github.com/phodal/routa-js",
          isDefault: true,
          label: "routa-js",
          branch: "main",
        }]}
        acp={{
          connected: true,
          sessionId: null,
          updates: [],
          providers: [],
          selectedProvider: "codex",
          loading: false,
          error: null,
          authError: null,
          dockerConfigError: null,
          setProvider: vi.fn(),
          connect: vi.fn(),
          disconnect: vi.fn(),
          createSession: vi.fn(),
          createSessionWithOptions: vi.fn(),
          createSessionWithWorkspace: vi.fn(),
          prompt: vi.fn(),
          cancel: vi.fn(),
          listSessions: vi.fn(),
          selectSession: vi.fn(),
          deleteSession: vi.fn(),
          listProviderModels: vi.fn(),
          clearAuthError: vi.fn(),
        } as UseAcpState & UseAcpActions}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Manual" }));
    fireEvent.change(screen.getByPlaceholderText("Task title"), {
      target: { value: "create a js hello world" },
    });

    const editor = document.querySelector("[contenteditable='true']");
    if (!(editor instanceof HTMLElement)) {
      throw new Error("Expected TipTap editor");
    }
    editor.innerHTML = "<p>Create a JavaScript Hello World example.</p>";
    fireEvent.input(editor);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Create" }).hasAttribute("disabled")).toBe(false);
    });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace-1",
          boardId: "board-1",
          title: "create a js hello world",
          objective: "Create a JavaScript Hello World example.",
          testCases: [],
          priority: "medium",
          labels: [],
          createGitHubIssue: false,
          creationSource: "manual",
          repoPath: "/Users/phodal/repos/routa-js",
          codebaseIds: ["codebase-1"],
          assignedProvider: "codex",
        }),
      });
    });
  });
});

describe("KanbanCardDetail changes tab", () => {
  it("loads task-scoped worktree changes when the changes tab opens", async () => {
    desktopAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        changes: {
          codebaseId: "codebase-1",
          repoPath: "/tmp/repos/main",
          label: "feature-worktree",
          branch: "task/story-one",
          status: {
            clean: false,
            ahead: 0,
            behind: 0,
            modified: 1,
            untracked: 1,
          },
          files: [
            { path: "src/app.tsx", status: "modified" },
            { path: "notes/todo.md", status: "untracked" },
          ],
          source: "worktree",
          worktreeId: "wt-1",
          worktreePath: "/tmp/worktrees/story-one",
        },
      }),
    } as Response);

    render(
      <KanbanCardDetail
        task={createTask("task-1", "Story One", {
          worktreeId: "wt-1",
          codebaseIds: ["codebase-1"],
        })}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[{
          id: "codebase-1",
          workspaceId: "workspace-1",
          repoPath: "/tmp/repos/main",
          branch: "main",
          isDefault: true,
          sourceType: "github",
          sourceUrl: "https://example.com/repo.git",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        }]}
        allCodebaseIds={["codebase-1"]}
        worktreeCache={{
          "wt-1": {
            id: "wt-1",
            codebaseId: "codebase-1",
            workspaceId: "workspace-1",
            worktreePath: "/tmp/worktrees/story-one",
            branch: "task/story-one",
            baseBranch: "main",
            status: "active",
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
          },
        }}
        onPatchTask={vi.fn(async () => createTask("task-1", "Story One"))}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Changes" }));

    await waitFor(() => {
      expect(desktopAwareFetch).toHaveBeenCalledWith("/api/tasks/task-1/changes", { cache: "no-store" });
    });

    expect(await screen.findByText("feature-worktree")).toBeTruthy();
    expect(screen.getByText("/tmp/worktrees/story-one")).toBeTruthy();
    expect(screen.getByText("src/app.tsx")).toBeTruthy();
    expect(screen.getByText("notes/todo.md")).toBeTruthy();
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

  it("selects the active ACP session after targeted session backfill succeeds", async () => {
    const acp = {
      connected: true,
      sessionId: null,
      updates: [],
      providers: [{ id: "codex", name: "Codex", description: "Codex provider", command: "codex-acp" }],
      selectedProvider: "codex",
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
              cwd: "/tmp/repo",
              provider: "codex",
              role: "CRAFTER",
              createdAt: "2025-01-01T00:00:00.000Z",
              name: "Backfilled live run",
            },
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[{
          ...createTask("task-1", "Story One", {
            triggerSessionId: "session-123",
            laneSessions: [
              {
                sessionId: "session-123",
                provider: "codex",
                role: "CRAFTER",
                specialistId: "backlog",
                specialistName: "Backlog Refiner",
                status: "running",
                columnId: "backlog",
                columnName: "Backlog",
                startedAt: "2025-01-01T00:00:00.000Z",
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

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session-123", expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }));
    });

    await waitFor(() => {
      expect(acp.selectSession).toHaveBeenCalledWith("session-123");
    });
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
