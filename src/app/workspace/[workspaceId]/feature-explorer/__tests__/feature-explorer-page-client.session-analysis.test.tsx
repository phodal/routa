import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navState = vi.hoisted(() => ({
  push: vi.fn(),
}));

const clipboardState = vi.hoisted(() => ({
  writeText: vi.fn(),
}));

const { useWorkspaces, useCodebases } = vi.hoisted(() => ({
  useWorkspaces: vi.fn(),
  useCodebases: vi.fn(),
}));

const { useFeatureExplorerData } = vi.hoisted(() => ({
  useFeatureExplorerData: vi.fn(),
}));

const analysisAcpState = vi.hoisted(() => ({
  connected: false,
  sessionId: null as string | null,
  updates: [],
  providers: [
    {
      id: "opencode",
      name: "OpenCode",
      description: "OpenCode provider",
      command: "opencode",
      status: "available" as const,
      source: "static" as const,
    },
    {
      id: "codex",
      name: "Codex",
      description: "Codex provider",
      command: "codex-acp",
      status: "available" as const,
      source: "static" as const,
    },
  ],
  selectedProvider: "opencode",
  loading: false,
  error: null as string | null,
  authError: null,
  dockerConfigError: null as string | null,
  connect: vi.fn(async () => {
    analysisAcpState.connected = true;
  }),
  createSession: vi.fn(),
  resumeSession: vi.fn(),
  forkSession: vi.fn(),
  selectSession: vi.fn((sessionId: string) => {
    analysisAcpState.sessionId = sessionId;
  }),
  setProvider: vi.fn((provider: string) => {
    analysisAcpState.selectedProvider = provider;
  }),
  setMode: vi.fn(),
  prompt: vi.fn(),
  promptSession: vi.fn(async (sessionId: string, _text: string) => {
    analysisAcpState.sessionId = sessionId;
  }),
  respondToUserInput: vi.fn(),
  respondToUserInputForSession: vi.fn(),
  cancel: vi.fn(),
  disconnect: vi.fn(),
  clearAuthError: vi.fn(),
  clearDockerConfigError: vi.fn(),
  listProviderModels: vi.fn(async () => []),
  writeTerminal: vi.fn(),
  resizeTerminal: vi.fn(),
}));

const sessionLaunchState = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
  storePendingPrompt: vi.fn(),
}));

const localStorageMock = vi.hoisted(() => {
  let store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store = new Map<string, string>();
    }),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navState.push }),
}));

vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces,
  useCodebases,
}));

vi.mock("../use-feature-explorer-data", () => ({
  useFeatureExplorerData,
}));

vi.mock("@/client/hooks/use-acp", () => ({
  useAcp: () => analysisAcpState,
}));

vi.mock("@/client/utils/diagnostics", () => ({
  desktopAwareFetch: sessionLaunchState.desktopAwareFetch,
}));

vi.mock("@/client/utils/pending-prompt", () => ({
  storePendingPrompt: sessionLaunchState.storePendingPrompt,
}));

vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="desktop-shell">{children}</div>,
}));

vi.mock("@/client/components/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />,
}));

vi.mock("@/client/components/chat-panel", () => ({
  ChatPanel: ({ activeSessionId }: { activeSessionId: string | null }) => (
    <div data-testid="chat-panel">{activeSessionId ?? "no-session"}</div>
  ),
}));

vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: ({
    value,
    onChange,
  }: {
    value: { name: string; path: string; branch: string } | null;
    onChange: (value: { name: string; path: string; branch: string } | null) => void;
  }) => (
    <div>
      <div data-testid="repo-picker-value">
        {value ? `${value.name}|${value.path}|${value.branch}` : "none"}
      </div>
      <button
        type="button"
        onClick={() => onChange({ name: "local-project", path: "/tmp/local-project", branch: "feature-x" })}
      >
        switch repo
      </button>
      <button type="button" onClick={() => onChange(null)}>
        clear repo
      </button>
    </div>
  ),
}));

vi.mock("@/client/components/acp-provider-dropdown", () => ({
  AcpProviderDropdown: ({
    providers,
    onProviderChange,
    dataTestId,
  }: {
    providers: Array<{ id: string; name: string }>;
    onProviderChange: (provider: string) => void;
    dataTestId?: string;
  }) => (
    <div data-testid={dataTestId ?? "acp-provider-dropdown"}>
      {providers.map((provider) => (
        <button key={provider.id} type="button" onClick={() => onProviderChange(provider.id)}>
          {provider.name}
        </button>
      ))}
    </div>
  ),
}));

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
});

Object.defineProperty(navigator, "clipboard", {
  value: clipboardState,
  writable: true,
});

import { FeatureExplorerPageClient } from "../feature-explorer-page-client";

describe("FeatureExplorerPageClient session analysis", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/workspace/default/feature-explorer");
    window.localStorage.clear();
    navState.push.mockReset();
    clipboardState.writeText.mockReset();
    sessionLaunchState.desktopAwareFetch.mockReset();
    sessionLaunchState.storePendingPrompt.mockReset();
    analysisAcpState.connected = false;
    analysisAcpState.sessionId = null;
    analysisAcpState.selectedProvider = "opencode";
    analysisAcpState.error = null;
    analysisAcpState.connect.mockClear();
    analysisAcpState.createSession.mockReset();
    analysisAcpState.resumeSession.mockReset();
    analysisAcpState.forkSession.mockReset();
    analysisAcpState.selectSession.mockClear();
    analysisAcpState.setProvider.mockClear();
    analysisAcpState.setMode.mockReset();
    analysisAcpState.prompt.mockReset();
    analysisAcpState.promptSession.mockClear();
    analysisAcpState.respondToUserInput.mockReset();
    analysisAcpState.respondToUserInputForSession.mockReset();
    analysisAcpState.cancel.mockReset();
    analysisAcpState.disconnect.mockReset();
    analysisAcpState.clearAuthError.mockReset();
    analysisAcpState.clearDockerConfigError.mockReset();
    analysisAcpState.listProviderModels.mockReset();
    analysisAcpState.writeTerminal.mockReset();
    analysisAcpState.resizeTerminal.mockReset();
    useWorkspaces.mockReturnValue({
      loading: false,
      workspaces: [{ id: "default", title: "Default Workspace" }],
      createWorkspace: vi.fn(),
    });
    useCodebases.mockReturnValue({
      codebases: [
        {
          id: "cb-default",
          workspaceId: "default",
          repoPath: "/repo/default",
          branch: "main",
          label: "routa-js",
          isDefault: true,
          createdAt: "",
          updatedAt: "",
        },
      ],
      fetchCodebases: vi.fn(),
    });
    useFeatureExplorerData.mockReturnValue({
      loading: false,
      error: null,
      capabilityGroups: [],
      features: [],
      surfaceIndex: {
        generatedAt: "",
        pages: [],
        apis: [],
        contractApis: [],
        nextjsApis: [],
        rustApis: [],
        metadata: null,
        repoRoot: "",
        warnings: [],
      },
      featureDetail: null,
      featureDetailLoading: false,
      initialFeatureId: "",
      fetchFeatureDetail: vi.fn().mockResolvedValue(null),
    });
  });

  it("renders selected file session evidence with resume command", async () => {
    useFeatureExplorerData.mockReturnValue({
      loading: false,
      error: null,
      capabilityGroups: [{ id: "workspace", name: "Workspace", description: "" }],
      features: [
        {
          id: "workspace-overview",
          name: "Workspace Overview",
          group: "workspace",
          summary: "Workspace shell",
          status: "shipped",
          sessionCount: 12,
          changedFiles: 1,
          updatedAt: "2026-04-17T08:00:00.000Z",
          sourceFileCount: 1,
          pageCount: 1,
          apiCount: 0,
        },
      ],
      surfaceIndex: {
        generatedAt: "",
        pages: [],
        apis: [],
        contractApis: [],
        nextjsApis: [],
        rustApis: [],
        metadata: null,
        repoRoot: "",
        warnings: [],
      },
      featureDetail: {
        id: "workspace-overview",
        name: "Workspace Overview",
        group: "workspace",
        summary: "Workspace shell",
        status: "shipped",
        pages: [],
        apis: [],
        sourceFiles: ["src/app/workspace/[workspaceId]/page.tsx"],
        relatedFiles: ["src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx"],
        relatedFeatures: [],
        domainObjects: [],
        sessionCount: 12,
        changedFiles: 1,
        updatedAt: "2026-04-17T08:00:00.000Z",
        fileTree: [
          {
            id: "file-kanban-page",
            name: "kanban-page-client.tsx",
            path: "src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx",
            kind: "file",
            children: [],
          },
        ],
        fileStats: {
          "src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx": {
            changes: 3,
            sessions: 3,
            updatedAt: "2026-04-17T08:00:00.000Z",
          },
        },
        fileSignals: {
          "src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx": {
            sessions: [
              {
                provider: "codex",
                sessionId: "019d-selected-file",
                updatedAt: "2026-04-17T08:00:00.000Z",
                promptSnippet: "Connect selected file signals to the right inspector panel",
                promptHistory: [
                  "Connect selected file signals to the right inspector panel",
                  "Keep user prompts grouped under the owning session card",
                  "Move session changed files into the owning session card",
                ],
                toolNames: ["exec_command", "apply_patch"],
                changedFiles: [
                  "crates/routa-server/src/api/mcp_routes/tool_executor/agents_tasks.rs",
                  "src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx",
                ],
                resumeCommand: "codex resume 019d-selected-file",
              },
            ],
            toolHistory: ["exec_command", "apply_patch"],
            promptHistory: ["Connect selected file signals to the right inspector panel"],
          },
        },
      },
      featureDetailLoading: false,
      initialFeatureId: "workspace-overview",
      fetchFeatureDetail: vi.fn().mockResolvedValue(null),
    });

    render(<FeatureExplorerPageClient workspaceId="default" />);

    await waitFor(() => {
      expect(screen.getByText("Codex")).toBeTruthy();
    });

    expect(screen.getByText("019d-selected-file")).toBeTruthy();
    expect(screen.queryByText("codex resume 019d-selected-file")).toBeNull();
    expect(screen.queryByText("exec_command")).toBeNull();
    expect(screen.getByText("Connect selected file signals to the right inspector panel")).toBeTruthy();
    expect(screen.getByText("Keep user prompts grouped under the owning session card")).toBeTruthy();
    expect(screen.queryByText("Move session changed files into the owning session card")).toBeNull();
    expect(screen.getByRole("button", { name: "Show All" })).toBeTruthy();
    expect(screen.getByText("Related files")).toBeTruthy();
    expect(screen.getByText("crates/routa-server/src/api/mcp_routes/tool_executor/agents_tasks.rs")).toBeTruthy();
    expect(screen.getByText("src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx")).toBeTruthy();
    expect(screen.queryByText("Active file")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show All" }));
    expect(screen.getByText("Move session changed files into the owning session card")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show Less" })).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Resume: 019d-selected-file",
      }),
    );
    expect(clipboardState.writeText).toHaveBeenCalledWith("codex resume 019d-selected-file");
  });

  it("launches a file session analysis specialist from the inspector", async () => {
    sessionLaunchState.desktopAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          sessionId: "analysis-session-1",
        },
      }),
    });

    useFeatureExplorerData.mockReturnValue({
      loading: false,
      error: null,
      capabilityGroups: [{ id: "workspace", name: "Workspace", description: "" }],
      features: [
        {
          id: "workspace-overview",
          name: "Workspace Overview",
          group: "workspace",
          summary: "Workspace shell",
          status: "shipped",
          sessionCount: 12,
          changedFiles: 1,
          updatedAt: "2026-04-17T08:00:00.000Z",
          sourceFileCount: 1,
          pageCount: 1,
          apiCount: 0,
        },
      ],
      surfaceIndex: {
        generatedAt: "",
        pages: [],
        apis: [],
        contractApis: [],
        nextjsApis: [],
        rustApis: [],
        metadata: null,
        repoRoot: "",
        warnings: [],
      },
      featureDetail: {
        id: "workspace-overview",
        name: "Workspace Overview",
        group: "workspace",
        summary: "Workspace shell",
        status: "shipped",
        pages: [],
        apis: [],
        sourceFiles: ["crates/routa-server/src/api/kanban.rs"],
        relatedFeatures: [],
        domainObjects: [],
        sessionCount: 12,
        changedFiles: 1,
        updatedAt: "2026-04-17T08:00:00.000Z",
        fileTree: [
          {
            id: "file-kanban-api",
            name: "kanban.rs",
            path: "crates/routa-server/src/api/kanban.rs",
            kind: "file",
            children: [],
          },
        ],
        fileStats: {
          "crates/routa-server/src/api/kanban.rs": {
            changes: 4,
            sessions: 6,
            updatedAt: "2026-04-17T08:00:00.000Z",
          },
        },
        fileSignals: {
          "crates/routa-server/src/api/kanban.rs": {
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
                  "fatal: Unable to create '/Users/phodal/ai/routa-js/.git/index.lock': Operation not permitted",
                  "crates/routa-server/src/api/kanban.rs",
                ],
                diagnostics: {
                  toolCallCount: 4,
                  failedToolCallCount: 1,
                  toolCallsByName: {
                    exec_command: 3,
                    apply_patch: 1,
                  },
                  readFiles: ["crates/routa-server/src/api/kanban.rs"],
                  writtenFiles: ["crates/routa-server/src/api/kanban.rs"],
                  repeatedReadFiles: ["crates/routa-server/src/api/kanban.rs x2"],
                  repeatedCommands: ["sed -n 1,200p crates/routa-server/src/api/kanban.rs x2"],
                  failedTools: [
                    {
                      toolName: "exec_command",
                      command: "git status --short",
                      message: "fatal: Unable to create '/Users/phodal/ai/routa-js/.git/index.lock'",
                    },
                  ],
                },
                resumeCommand: "codex resume 019d-kanban-analysis",
              },
              {
                provider: "codex",
                sessionId: "019d-kanban-followup",
                updatedAt: "2026-04-17T06:00:00.000Z",
                promptSnippet: "Verify whether kanban handlers were re-read too often",
                promptHistory: [
                  "Verify whether kanban handlers were re-read too often",
                ],
                toolNames: ["exec_command"],
                changedFiles: [
                  "crates/routa-server/src/api/kanban.rs",
                  "src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx",
                ],
                diagnostics: {
                  toolCallCount: 2,
                  failedToolCallCount: 0,
                  toolCallsByName: {
                    exec_command: 2,
                  },
                  readFiles: [
                    "crates/routa-server/src/api/kanban.rs",
                    "src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx",
                  ],
                  writtenFiles: ["src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx"],
                  repeatedReadFiles: [],
                  repeatedCommands: ["rg -n kanban src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx x2"],
                  failedTools: [],
                },
                resumeCommand: "codex resume 019d-kanban-followup",
              },
            ],
            toolHistory: ["exec_command", "apply_patch"],
            promptHistory: ["Trace why kanban.rs needed multiple follow-up passes"],
          },
        },
      },
      featureDetailLoading: false,
      initialFeatureId: "workspace-overview",
      fetchFeatureDetail: vi.fn().mockResolvedValue(null),
    });

    const view = render(<FeatureExplorerPageClient workspaceId="default" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open analysis panel" })).toBeTruthy();
    });

    expect(screen.queryByText(/Operation not permitted/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open analysis panel" }));

    await waitFor(() => {
      expect(screen.getByTestId("feature-explorer-session-analysis-drawer")).toBeTruthy();
    });

    expect(screen.getByText("Session diagnostics")).toBeTruthy();
    expect(screen.getByText("Tool call breakdown")).toBeTruthy();
    expect(screen.getAllByText("Read files").length).toBeGreaterThan(0);
    expect(screen.getByText("Repeated reads")).toBeTruthy();
    expect(screen.getByText("Repeated commands")).toBeTruthy();
    expect(screen.getByText("Failed tools")).toBeTruthy();
    expect(screen.getByText("git status --short")).toBeTruthy();
    expect(screen.getByText("crates/routa-server/src/api/kanban.rs x2")).toBeTruthy();
    expect(
      (screen.getByTestId("feature-explorer-session-analysis-toggle-019d-kanban-analysis") as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByTestId("feature-explorer-session-analysis-toggle-019d-kanban-followup") as HTMLInputElement).checked,
    ).toBe(true);

    fireEvent.click(
      within(screen.getByTestId("feature-explorer-session-analysis-provider")).getByRole("button", { name: "Codex" }),
    );
    view.rerender(<FeatureExplorerPageClient workspaceId="default" />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze selected sessions" }));

    await waitFor(() => {
      expect(sessionLaunchState.desktopAwareFetch).toHaveBeenCalledTimes(1);
    });

    const [path, options] = sessionLaunchState.desktopAwareFetch.mock.calls[0] as [
      string,
      { body: string; method: string },
    ];
    expect(path).toBe("/api/acp");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.method).toBe("session/new");
    expect(body.params).toMatchObject({
      workspaceId: "default",
      cwd: "/repo/default",
      branch: "main",
      role: "ROUTA",
      specialistId: "file-session-analyst",
      specialistLocale: "en",
      provider: "codex",
    });

    await waitFor(() => {
      expect(analysisAcpState.selectSession).toHaveBeenCalledWith("analysis-session-1");
      expect(analysisAcpState.promptSession).toHaveBeenCalledWith(
        "analysis-session-1",
        expect.stringContaining("crates/routa-server/src/api/kanban.rs"),
      );
    });

    const prompt = analysisAcpState.promptSession.mock.calls[0]?.[1];
    expect(prompt).toBeTruthy();
    expect(prompt).toContain("019d-kanban-analysis");
    expect(prompt).toContain("019d-kanban-followup");
    expect(prompt).toContain("Summarize what context should have been provided earlier");
    expect(prompt).not.toContain("Operation not permitted");
    expect(sessionLaunchState.storePendingPrompt).not.toHaveBeenCalled();
    expect(navState.push).not.toHaveBeenCalledWith("/workspace/default/sessions/analysis-session-1");
    await waitFor(() => {
      expect(screen.getByTestId("feature-explorer-analysis-session-drawer")).toBeTruthy();
    });
    expect(screen.getByTestId("chat-panel").textContent).toBe("analysis-session-1");
  });

  it("aggregates folder selection sessions across descendant files", async () => {
    useFeatureExplorerData.mockReturnValue({
      loading: false,
      error: null,
      capabilityGroups: [{ id: "workspace", name: "Workspace", description: "" }],
      features: [
        {
          id: "workspace-overview",
          name: "Workspace Overview",
          group: "workspace",
          summary: "Workspace shell",
          status: "shipped",
          sessionCount: 12,
          changedFiles: 2,
          updatedAt: "2026-04-17T08:00:00.000Z",
          sourceFileCount: 2,
          pageCount: 1,
          apiCount: 0,
        },
      ],
      surfaceIndex: {
        generatedAt: "",
        pages: [],
        apis: [],
        contractApis: [],
        nextjsApis: [],
        rustApis: [],
        metadata: null,
        repoRoot: "",
        warnings: [],
      },
      featureDetail: {
        id: "workspace-overview",
        name: "Workspace Overview",
        group: "workspace",
        summary: "Workspace shell",
        status: "shipped",
        pages: [],
        apis: [],
        sourceFiles: [
          "src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx",
          "src/app/workspace/[workspaceId]/overview/page.tsx",
        ],
        relatedFeatures: [],
        domainObjects: [],
        sessionCount: 12,
        changedFiles: 2,
        updatedAt: "2026-04-17T08:00:00.000Z",
        fileTree: [
          {
            id: "folder-workspace",
            name: "workspace",
            path: "src/app/workspace/[workspaceId]",
            kind: "folder",
            children: [
              {
                id: "file-kanban-page",
                name: "kanban-page-client.tsx",
                path: "src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx",
                kind: "file",
                children: [],
              },
              {
                id: "file-overview-page",
                name: "page.tsx",
                path: "src/app/workspace/[workspaceId]/overview/page.tsx",
                kind: "file",
                children: [],
              },
            ],
          },
        ],
        fileStats: {
          "src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx": {
            changes: 3,
            sessions: 1,
            updatedAt: "2026-04-17T08:00:00.000Z",
          },
          "src/app/workspace/[workspaceId]/overview/page.tsx": {
            changes: 1,
            sessions: 1,
            updatedAt: "2026-04-16T08:00:00.000Z",
          },
        },
        fileSignals: {
          "src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx": {
            sessions: [
              {
                provider: "codex",
                sessionId: "019d-folder-a",
                updatedAt: "2026-04-17T08:00:00.000Z",
                promptSnippet: "Kanban workspace file changes",
                promptHistory: ["Kanban workspace file changes"],
                toolNames: ["apply_patch"],
                changedFiles: ["src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx"],
                resumeCommand: "codex resume 019d-folder-a",
              },
            ],
            toolHistory: ["apply_patch"],
            promptHistory: ["Kanban workspace file changes"],
          },
          "src/app/workspace/[workspaceId]/overview/page.tsx": {
            sessions: [
              {
                provider: "codex",
                sessionId: "019d-folder-b",
                updatedAt: "2026-04-16T08:00:00.000Z",
                promptSnippet: "Overview page cleanup",
                promptHistory: ["Overview page cleanup"],
                toolNames: ["exec_command"],
                changedFiles: ["src/app/workspace/[workspaceId]/overview/page.tsx"],
                resumeCommand: "codex resume 019d-folder-b",
              },
            ],
            toolHistory: ["exec_command"],
            promptHistory: ["Overview page cleanup"],
          },
        },
      },
      featureDetailLoading: false,
      initialFeatureId: "workspace-overview",
      fetchFeatureDetail: vi.fn().mockResolvedValue(null),
    });

    render(<FeatureExplorerPageClient workspaceId="default" />);

    await waitFor(() => {
      expect(screen.getByText("019d-folder-a")).toBeTruthy();
    });

    expect(screen.queryByText("019d-folder-b")).toBeNull();

    fireEvent.click(screen.getByTestId("feature-tree-select-folder-workspace"));

    await waitFor(() => {
      expect(screen.getByText("019d-folder-b")).toBeTruthy();
    });
    expect((screen.getByTestId("feature-tree-select-folder-workspace") as HTMLInputElement).checked).toBe(true);
  });

  it("hydrates file selection from the url and keeps it in sync", async () => {
    window.history.replaceState(
      {},
      "",
      "/workspace/default/feature-explorer?feature=workspace-overview&file=src%2Fapp%2Fworkspace%2F%5BworkspaceId%5D%2Fkanban%2Fkanban-page-client.tsx",
    );

    useFeatureExplorerData.mockReturnValue({
      loading: false,
      error: null,
      capabilityGroups: [{ id: "workspace", name: "Workspace", description: "" }],
      features: [
        {
          id: "workspace-overview",
          name: "Workspace Overview",
          group: "workspace",
          summary: "Workspace shell",
          status: "shipped",
          sessionCount: 12,
          changedFiles: 2,
          updatedAt: "2026-04-17T08:00:00.000Z",
          sourceFileCount: 2,
          pageCount: 1,
          apiCount: 0,
        },
      ],
      surfaceIndex: {
        generatedAt: "",
        pages: [],
        apis: [],
        contractApis: [],
        nextjsApis: [],
        rustApis: [],
        metadata: null,
        repoRoot: "",
        warnings: [],
      },
      featureDetail: {
        id: "workspace-overview",
        name: "Workspace Overview",
        group: "workspace",
        summary: "Workspace shell",
        status: "shipped",
        pages: [],
        apis: [],
        sourceFiles: [
          "src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx",
          "src/app/workspace/[workspaceId]/overview/page.tsx",
        ],
        relatedFeatures: [],
        domainObjects: [],
        sessionCount: 12,
        changedFiles: 2,
        updatedAt: "2026-04-17T08:00:00.000Z",
        fileTree: [
          {
            id: "file-kanban-page",
            name: "kanban-page-client.tsx",
            path: "src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx",
            kind: "file",
            children: [],
          },
          {
            id: "file-overview-page",
            name: "page.tsx",
            path: "src/app/workspace/[workspaceId]/overview/page.tsx",
            kind: "file",
            children: [],
          },
        ],
        fileStats: {
          "src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx": {
            changes: 3,
            sessions: 3,
            updatedAt: "2026-04-17T08:00:00.000Z",
          },
          "src/app/workspace/[workspaceId]/overview/page.tsx": {
            changes: 1,
            sessions: 1,
            updatedAt: "2026-04-16T08:00:00.000Z",
          },
        },
        fileSignals: {},
      },
      featureDetailLoading: false,
      initialFeatureId: "workspace-overview",
      fetchFeatureDetail: vi.fn().mockResolvedValue(null),
    });

    render(<FeatureExplorerPageClient workspaceId="default" />);

    await waitFor(() => {
      expect(screen.getAllByText("kanban-page-client.tsx").length).toBeGreaterThan(0);
    });

    expect(window.location.search).toContain("feature=workspace-overview");
    expect(window.location.search).toContain(
      "file=src%2Fapp%2Fworkspace%2F%5BworkspaceId%5D%2Fkanban%2Fkanban-page-client.tsx",
    );

    fireEvent.click(screen.getByRole("button", { name: "page.tsx" }));

    await waitFor(() => {
      expect(window.location.search).toContain(
        "file=src%2Fapp%2Fworkspace%2F%5BworkspaceId%5D%2Foverview%2Fpage.tsx",
      );
    });
  });

});
