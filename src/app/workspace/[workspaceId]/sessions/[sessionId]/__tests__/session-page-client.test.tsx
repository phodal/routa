import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AcpClientError } from "@/client/acp-client";
import { storePendingPrompt } from "@/client/utils/pending-prompt";
import { SessionPageClient } from "../session-page-client";

const {
  mockPush,
  mockConnect,
  mockCreateSession,
  mockResumeSession,
  mockPromptSession,
  mockSelectSession,
  mockSetProvider,
  mockPrompt,
  mockCreateWorkspace,
} = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockConnect: vi.fn(async () => {}),
  mockCreateSession: vi.fn(async (): Promise<{ sessionId: string; provider: string; role?: string; acpStatus?: string } | null> => null),
  mockResumeSession: vi.fn(async () => ({ sessionId: "session-1", provider: "codex", acpStatus: "ready", resumeMode: "native" })),
  mockPromptSession: vi.fn(async () => {}),
  mockSelectSession: vi.fn(),
  mockSetProvider: vi.fn(),
  mockPrompt: vi.fn(async () => {}),
  mockCreateWorkspace: vi.fn(async () => null),
}));

const navState = vi.hoisted(() => ({
  params: { workspaceId: "default", sessionId: "session-1" },
  searchParams: new URLSearchParams(),
}));

const workspaceState = vi.hoisted(() => ({
  workspaces: [
    {
      id: "default",
      title: "Default Workspace",
      status: "active" as const,
      metadata: {},
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  ],
  codebases: [],
}));

const acpState = vi.hoisted(() => ({
  connected: true,
  loading: false,
  sessionId: null as string | null,
  updates: [] as Array<Record<string, unknown>>,
  selectedProvider: "opencode",
}));

const notesState = vi.hoisted(() => ({
  notes: [],
  connected: true,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => navState.params,
  useSearchParams: () => navState.searchParams,
  usePathname: () => `/workspace/${navState.params.workspaceId}/sessions/${navState.params.sessionId}`,
}));

vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => ({
    workspaces: workspaceState.workspaces,
    loading: false,
    fetchWorkspaces: vi.fn(async () => {}),
    createWorkspace: mockCreateWorkspace,
    archiveWorkspace: vi.fn(async () => {}),
  }),
  useCodebases: () => ({
    codebases: workspaceState.codebases,
    fetchCodebases: vi.fn(async () => {}),
  }),
}));

vi.mock("@/client/hooks/use-acp", () => ({
  useAcp: () => ({
    connected: acpState.connected,
    loading: acpState.loading,
    sessionId: acpState.sessionId,
    updates: acpState.updates,
    providers: [{ id: "opencode", name: "OpenCode", description: "OpenCode", command: "opencode" }],
    selectedProvider: acpState.selectedProvider,
    error: null,
    authError: null,
    dockerConfigError: null,
    connect: mockConnect,
    createSession: mockCreateSession,
    resumeSession: mockResumeSession,
    selectSession: mockSelectSession,
    setProvider: mockSetProvider,
    setMode: vi.fn(async () => {}),
    prompt: mockPrompt,
    promptSession: mockPromptSession,
    respondToUserInput: vi.fn(async () => {}),
    respondToUserInputForSession: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    disconnect: vi.fn(),
    clearAuthError: vi.fn(),
    clearDockerConfigError: vi.fn(),
    listProviderModels: vi.fn(async () => []),
    writeTerminal: vi.fn(async () => {}),
    resizeTerminal: vi.fn(async () => {}),
  }),
}));

vi.mock("@/client/hooks/use-notes", () => ({
  useNotes: () => ({
    notes: notesState.notes,
    loading: false,
    error: null,
    connected: notesState.connected,
    fetchNotes: vi.fn(async () => {}),
    fetchNote: vi.fn(async () => null),
    createNote: vi.fn(async () => null),
    updateNote: vi.fn(async () => null),
    deleteNote: vi.fn(async () => {}),
  }),
}));

vi.mock("@/client/components/chat-panel", () => ({
  ChatPanel: () => <div data-testid="chat-panel">chat</div>,
}));

vi.mock("../left-sidebar", () => ({
  LeftSidebar: () => <div data-testid="left-sidebar">sidebar</div>,
}));

vi.mock("@/client/components/app-header", () => ({
  AppHeader: ({ leftSlot, rightSlot }: { leftSlot?: React.ReactNode; rightSlot?: React.ReactNode }) => (
    <div data-testid="app-header">
      <div data-testid="header-left">{leftSlot}</div>
      <div data-testid="header-right">{rightSlot}</div>
    </div>
  ),
}));

vi.mock("@/client/components/task-panel", () => ({
  CraftersView: ({ agents }: { agents: Array<{ id: string }> }) => (
    <div data-testid="crafters-view">{agents.length}</div>
  ),
}));

vi.mock("@/client/components/agent-install-panel", () => ({
  AgentInstallPanel: () => <div data-testid="agent-install-panel">install</div>,
}));

vi.mock("@/client/components/specialist-manager", () => ({
  SpecialistManager: ({ open }: { open: boolean }) => (open ? <div data-testid="specialist-manager" /> : null),
}));

vi.mock("@/client/components/settings-panel", () => ({
  SettingsPanel: ({ open }: { open: boolean }) => (open ? <div data-testid="settings-panel" /> : null),
  DockerConfigModal: ({ open }: { open: boolean }) => (open ? <div data-testid="docker-config-modal" /> : null),
  loadDefaultProviders: () => ({}),
  loadProviderConnectionConfig: () => ({ model: undefined, baseUrl: undefined, apiKey: undefined }),
  getModelDefinitionByAlias: () => undefined,
}));

vi.mock("@/client/components/desktop-nav-rail", () => ({
  DesktopNavRail: () => <div data-testid="desktop-nav-rail" />,
}));

vi.mock("@/client/acp-client", () => ({
  AcpClientError: class MockAcpClientError extends Error {
    code: number;

    constructor(message: string, code: number) {
      super(message);
      this.name = "AcpClientError";
      this.code = code;
    }
  },
  BrowserAcpClient: class MockBrowserAcpClient {
    initialize = vi.fn(async () => {});
    newSession = vi.fn(async () => ({ sessionId: "child-session-1", routaAgentId: "agent-1" }));
    onUpdate = vi.fn();
    disconnect = vi.fn();
  },
}));

describe("SessionPageClient", () => {
  beforeEach(() => {
    navState.params = { workspaceId: "default", sessionId: "session-1" };
    navState.searchParams = new URLSearchParams();
    workspaceState.codebases = [];
    acpState.connected = true;
    acpState.loading = false;
    acpState.sessionId = null;
    acpState.updates = [];
    acpState.selectedProvider = "opencode";
    notesState.notes = [];
    notesState.connected = true;
    mockPush.mockReset();
    mockConnect.mockReset();
    mockCreateSession.mockReset();
    mockResumeSession.mockReset();
    mockPromptSession.mockReset();
    mockSelectSession.mockReset();
    mockSetProvider.mockReset();
    mockPrompt.mockReset();
    mockCreateWorkspace.mockReset();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("resolves placeholder params from the real URL and auto-selects the resolved session", async () => {
    navState.params = { workspaceId: "__placeholder__", sessionId: "__placeholder__" };
    window.history.pushState({}, "", "/workspace/ws-123/sessions/session-abc");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ session: {} }) }) as Response));

    render(<SessionPageClient />);

    await waitFor(() => {
      expect(mockSelectSession).toHaveBeenCalledWith("session-abc");
    });
  });

  it("auto-connects ACP on mount when disconnected", async () => {
    acpState.connected = false;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ globalMode: "essential", specialists: [], sessions: [] }) }) as Response));

    render(<SessionPageClient />);

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
  });

  it("restores session role and provider metadata for an existing session", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/specialists") {
        return { ok: true, json: async () => ({ specialists: [] }) } as Response;
      }
      if (url === "/api/sessions/session-1") {
        return {
          ok: true,
          json: async () => ({ session: { role: "DEVELOPER", provider: "claude" } }),
        } as Response;
      }
      if (url === "/api/sessions?parentSessionId=session-1") {
        return { ok: true, json: async () => ({ sessions: [] }) } as Response;
      }
      if (url === "/api/mcp/tools") {
        return { ok: true, json: async () => ({ globalMode: "essential" }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionPageClient />);

    await waitFor(() => {
      expect(mockSetProvider).toHaveBeenCalledWith("claude");
    });
    await waitFor(() => {
      expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("DEVELOPER");
    });
  });

  it("sends a stored pending prompt once ACP is already ready", async () => {
    storePendingPrompt("session-1", "continue execution");
    acpState.updates = [
      { update: { sessionUpdate: "acp_status", status: "ready" } },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ session: {}, sessions: [], specialists: [], globalMode: "essential" }) }) as Response));

    render(<SessionPageClient />);

    await waitFor(() => {
      expect(mockPrompt).toHaveBeenCalledWith("continue execution", undefined);
    });
  });

  it("loads skill context for a structured pending prompt before sending", async () => {
    storePendingPrompt("session-1", {
      text: "build repo slides",
      skillName: "slide-skill",
      skillRepoPath: "/tmp/routa/tools/ppt-template",
    });
    acpState.updates = [
      { update: { sessionUpdate: "acp_status", status: "ready" } },
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/skills?name=slide-skill&repoPath=%2Ftmp%2Frouta%2Ftools%2Fppt-template") {
        return {
          ok: true,
          json: async () => ({
            name: "slide-skill",
            content: "Use this skill as reference material when creating slides.",
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ session: {}, sessions: [], specialists: [], globalMode: "essential" }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionPageClient />);

    await waitFor(() => {
      expect(mockPrompt).toHaveBeenCalledWith("build repo slides", {
        skillName: "slide-skill",
        skillContent: "Use this skill as reference material when creating slides.",
      });
    });
  });

  it("renders RepoSlide session results when launched from RepoSlide", async () => {
    navState.searchParams = new URLSearchParams("source=reposlide&codebaseId=cb-1");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/specialists") {
        return { ok: true, json: async () => ({ specialists: [] }) } as Response;
      }
      if (url === "/api/sessions/session-1") {
        return { ok: true, json: async () => ({ session: {} }) } as Response;
      }
      if (url === "/api/sessions?parentSessionId=session-1") {
        return { ok: true, json: async () => ({ sessions: [] }) } as Response;
      }
      if (url === "/api/mcp/tools") {
        return { ok: true, json: async () => ({ globalMode: "essential" }) } as Response;
      }
      if (url === "/api/sessions/session-1/reposlide-result") {
        return {
          ok: true,
          json: async () => ({
            latestEventKind: "agent_message",
            result: {
              status: "completed",
              deckPath: "/tmp/repo-slide-output/demo-deck.pptx",
              downloadUrl: "/api/sessions/session-1/reposlide-result/download",
              latestAssistantMessage: "Saved PPTX to /tmp/repo-slide-output/demo-deck.pptx\nSlide outline:\n- Intro\n- Architecture",
              summary: "Saved PPTX to /tmp/repo-slide-output/demo-deck.pptx\nSlide outline:\n- Intro\n- Architecture",
              updatedAt: "2026-04-01T03:00:00.000Z",
            },
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionPageClient />);

    expect(await screen.findByText("RepoSlide Run")).toBeTruthy();
    expect(await screen.findByText("Deck ready for download")).toBeTruthy();
    expect(await screen.findByText("/tmp/repo-slide-output/demo-deck.pptx")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download PPTX" }).getAttribute("href")).toBe(
      "/api/sessions/session-1/reposlide-result/download",
    );
    expect(screen.getByRole("link", { name: "Back to RepoSlide" }).getAttribute("href")).toBe(
      "/workspace/default/codebases/cb-1/reposlide",
    );
  });

  it("loads the global tool mode on mount", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/mcp/tools" && !init?.method) {
        return { ok: true, json: async () => ({ globalMode: "full" }) } as Response;
      }
      if (url === "/api/mcp/tools" && init?.method === "PATCH") {
        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }
      if (url === "/api/specialists") {
        return { ok: true, json: async () => ({ specialists: [] }) } as Response;
      }
      if (url === "/api/sessions/session-1") {
        return { ok: true, json: async () => ({ session: {} }) } as Response;
      }
      if (url === "/api/sessions?parentSessionId=session-1") {
        return { ok: true, json: async () => ({ sessions: [] }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionPageClient />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/mcp/tools", { cache: "no-store" });
    });
  });

  it("shows a Resume action for codex sessions and calls ACP resume", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/specialists") {
        return { ok: true, json: async () => ({ specialists: [] }) } as Response;
      }
      if (url === "/api/sessions/session-1") {
        return {
          ok: true,
          json: async () => ({
            session: {
              sessionId: "session-1",
              provider: "codex",
              cwd: "/tmp/codex",
              role: "DEVELOPER",
              resumeCapabilities: { supported: true, mode: "native" },
            },
          }),
        } as Response;
      }
      if (url === "/api/sessions?parentSessionId=session-1") {
        return { ok: true, json: async () => ({ sessions: [] }) } as Response;
      }
      if (url === "/api/mcp/tools") {
        return { ok: true, json: async () => ({ globalMode: "essential" }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionPageClient />);

    const resumeButton = await screen.findByRole("button", { name: "Resume" });
    fireEvent.click(resumeButton);

    await waitFor(() => {
      expect(mockResumeSession).toHaveBeenCalledWith("session-1", "/tmp/codex", { throwOnError: true });
    });
  });

  it("recreates a new codex session from transcript when native resume is blocked by ownership lease", async () => {
    mockResumeSession.mockRejectedValueOnce(
      new AcpClientError(
        "Session ownership lease expired on instance next-90290 at 2026-04-09T01:30:18.664Z, and embedded ACP processes cannot be resumed on a different instance.",
        -32010,
      ),
    );
    mockCreateSession.mockResolvedValueOnce({
      sessionId: "session-restored",
      provider: "codex",
      role: "DEVELOPER",
      acpStatus: "ready",
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/specialists") {
        return { ok: true, json: async () => ({ specialists: [] }) } as Response;
      }
      if (url === "/api/sessions/session-1") {
        return {
          ok: true,
          json: async () => ({
            session: {
              sessionId: "session-1",
              name: "Original Session",
              provider: "codex",
              cwd: "/tmp/codex",
              branch: "main",
              role: "DEVELOPER",
              resumeCapabilities: { supported: true, mode: "native" },
            },
          }),
        } as Response;
      }
      if (url === "/api/sessions/session-1/transcript") {
        return {
          ok: true,
          json: async () => ({
            messages: [
              { role: "user", content: "Please continue the refactor." },
              { role: "assistant", content: "I was updating the ACP resume flow." },
            ],
          }),
        } as Response;
      }
      if (url === "/api/sessions?parentSessionId=session-1") {
        return { ok: true, json: async () => ({ sessions: [] }) } as Response;
      }
      if (url === "/api/mcp/tools") {
        return { ok: true, json: async () => ({ globalMode: "essential" }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionPageClient />);

    const resumeButton = await screen.findByRole("button", { name: "Resume" });
    fireEvent.click(resumeButton);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledWith(
        "/tmp/codex",
        "codex",
        undefined,
        "DEVELOPER",
        "default",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        "main",
      );
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/workspace/default/sessions/session-restored");
    });

    const pendingPrompt = sessionStorage.getItem("routa_pending_prompt_session-restored");
    expect(pendingPrompt).toContain("Transcript excerpt:");
    expect(mockPromptSession).not.toHaveBeenCalled();
  });

  it("recreates a new codex session when the backend does not support session/load", async () => {
    mockResumeSession.mockRejectedValueOnce(
      new AcpClientError(
        "session/load not supported - create a new session instead",
        -32601,
      ),
    );
    mockCreateSession.mockResolvedValueOnce({
      sessionId: "session-rust-recreated",
      provider: "codex",
      role: "CRAFTER",
      acpStatus: "ready",
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/specialists") {
        return { ok: true, json: async () => ({ specialists: [] }) } as Response;
      }
      if (url === "/api/sessions/session-1") {
        return {
          ok: true,
          json: async () => ({
            session: {
              sessionId: "session-1",
              provider: "codex",
              cwd: "/tmp/codex",
              role: "CRAFTER",
              resumeCapabilities: { supported: true, mode: "native" },
            },
          }),
        } as Response;
      }
      if (url === "/api/sessions/session-1/transcript") {
        return {
          ok: true,
          json: async () => ({
            messages: [{ role: "user", content: "Restore this session on Rust backend." }],
          }),
        } as Response;
      }
      if (url === "/api/sessions?parentSessionId=session-1") {
        return { ok: true, json: async () => ({ sessions: [] }) } as Response;
      }
      if (url === "/api/mcp/tools") {
        return { ok: true, json: async () => ({ globalMode: "essential" }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionPageClient />);

    const resumeButton = await screen.findByRole("button", { name: "Resume" });
    fireEvent.click(resumeButton);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledWith(
        "/tmp/codex",
        "codex",
        undefined,
        "CRAFTER",
        "default",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
      expect(mockPush).toHaveBeenCalledWith("/workspace/default/sessions/session-rust-recreated");
    });
  });
});
