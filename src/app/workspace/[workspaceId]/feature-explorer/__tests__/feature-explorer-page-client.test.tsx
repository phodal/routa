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
  updates: [] as Array<{ sessionId: string; update?: Record<string, unknown> }>,
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

describe("FeatureExplorerPageClient", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/workspace/default/feature-explorer");
    window.localStorage.clear();
    navState.push.mockReset();
    clipboardState.writeText.mockReset();
    sessionLaunchState.desktopAwareFetch.mockReset();
    sessionLaunchState.storePendingPrompt.mockReset();
    analysisAcpState.connected = false;
    analysisAcpState.sessionId = null;
    analysisAcpState.updates = [];
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

  it("uses the default codebase until the user selects another local repository", async () => {
    const view = render(<FeatureExplorerPageClient workspaceId="default" />);

    expect(screen.getByTestId("repo-picker-value").textContent).toBe("routa-js|/repo/default|main");
    expect(useFeatureExplorerData).toHaveBeenLastCalledWith({
      workspaceId: "default",
      repoPath: "/repo/default",
      refreshKey: "/repo/default:main:0",
    });

    expect(window.localStorage.getItem("routa.repoSelection.featureExplorer.default")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "switch repo" }));

    await waitFor(() => {
      expect(screen.getByTestId("repo-picker-value").textContent).toBe(
        "local-project|/tmp/local-project|feature-x",
      );
    });

    expect(useFeatureExplorerData).toHaveBeenLastCalledWith({
      workspaceId: "default",
      repoPath: "/tmp/local-project",
      refreshKey: "/tmp/local-project:feature-x:0",
    });
    expect(window.localStorage.getItem("routa.repoSelection.featureExplorer.default")).toContain(
      "/tmp/local-project",
    );

    fireEvent.click(screen.getByRole("button", { name: "clear repo" }));

    await waitFor(() => {
      expect(screen.getByTestId("repo-picker-value").textContent).toBe("routa-js|/repo/default|main");
    });

    expect(useFeatureExplorerData).toHaveBeenLastCalledWith({
      workspaceId: "default",
      repoPath: "/repo/default",
      refreshKey: "/repo/default:main:0",
    });
    expect(window.localStorage.getItem("routa.repoSelection.featureExplorer.default")).toBeNull();
  });

  it("hydrates the last repo selection from localStorage", async () => {
    window.localStorage.setItem(
      "routa.repoSelection.featureExplorer.default",
      JSON.stringify({
        name: "persisted-repo",
        path: "/tmp/persisted-repo",
        branch: "debug-branch",
      }),
    );

    const view = render(<FeatureExplorerPageClient workspaceId="default" />);

    await waitFor(() => {
      expect(screen.getByTestId("repo-picker-value").textContent).toBe(
        "persisted-repo|/tmp/persisted-repo|debug-branch",
      );
    });

    expect(useFeatureExplorerData).toHaveBeenLastCalledWith({
      workspaceId: "default",
      repoPath: "/tmp/persisted-repo",
      refreshKey: "/tmp/persisted-repo:debug-branch:0",
    });
  });

  it("falls back to the workspace codebase when nothing is stored", async () => {
    window.localStorage.clear();

    const view = render(<FeatureExplorerPageClient workspaceId="default" />);

    await waitFor(() => {
      expect(screen.getByTestId("repo-picker-value").textContent).toBe(
        "routa-js|/repo/default|main",
      );
    });

    expect(useFeatureExplorerData).toHaveBeenLastCalledWith({
      workspaceId: "default",
      repoPath: "/repo/default",
      refreshKey: "/repo/default:main:0",
    });
    expect(window.localStorage.getItem("routa.repoSelection.featureExplorer.default")).toBeNull();
  });

  it("opens the generate drawer and posts generation requests with the selected repo context", async () => {
    sessionLaunchState.desktopAwareFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          repoRoot: "/repo/default",
          selectedScanRoot: "/repo/default",
          frameworksDetected: ["nextjs"],
          adapters: [{ id: "nextjs-app-router", confidence: "high", signals: ["src/app"] }],
          candidateRoots: [],
          warnings: [],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    sessionLaunchState.desktopAwareFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          generatedAt: "2026-04-18T07:50:22.614Z",
          frameworksDetected: ["nextjs"],
          wroteFiles: [
            "docs/product-specs/FEATURE_TREE.md",
            "docs/product-specs/feature-tree.index.json",
          ],
          warnings: [],
          pagesCount: 28,
          apisCount: 737,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    render(<FeatureExplorerPageClient workspaceId="default" />);

    fireEvent.click(screen.getByTestId("generate-feature-tree-button"));

    expect(screen.getByTestId("generate-feature-tree-drawer")).toBeTruthy();

    await screen.findByText("Quick scan");
    fireEvent.click(screen.getByRole("button", { name: "Quick scan" }));
    fireEvent.click(screen.getByLabelText("Preview only"));
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(sessionLaunchState.desktopAwareFetch).toHaveBeenCalledWith(
        "/spec/feature-tree/generate",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    const generateCall = sessionLaunchState.desktopAwareFetch.mock.calls.find(
      ([input]) => input === "/spec/feature-tree/generate",
    );
    const requestBody = JSON.parse((generateCall?.[1] as RequestInit)?.body as string);
    expect(requestBody).toEqual({
      workspaceId: "default",
      repoPath: "/repo/default",
      dryRun: true,
    });

    await waitFor(() => {
      expect(screen.getAllByText("nextjs").length).toBeGreaterThan(0);
      expect(screen.getByText("737")).toBeTruthy();
    });
  });

  it("closes the generate drawer after a successful quick-scan write", async () => {
    sessionLaunchState.desktopAwareFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          repoRoot: "/repo/default",
          selectedScanRoot: "/repo/default",
          frameworksDetected: ["nextjs"],
          adapters: [{ id: "nextjs-app-router", confidence: "high", signals: ["src/app"] }],
          candidateRoots: [],
          warnings: [],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    sessionLaunchState.desktopAwareFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          generatedAt: "2026-04-18T07:50:22.614Z",
          frameworksDetected: ["nextjs"],
          wroteFiles: [
            "docs/product-specs/FEATURE_TREE.md",
            "docs/product-specs/feature-tree.index.json",
          ],
          warnings: [],
          pagesCount: 28,
          apisCount: 737,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    render(<FeatureExplorerPageClient workspaceId="default" />);

    fireEvent.click(screen.getByTestId("generate-feature-tree-button"));

    expect(screen.getByTestId("generate-feature-tree-drawer")).toBeTruthy();

    await screen.findByText("Quick scan");
    fireEvent.click(screen.getByRole("button", { name: "Quick scan" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(screen.queryByTestId("generate-feature-tree-drawer")).toBeNull();
    });
  });

  it("runs agent-first generation and auto-commits returned metadata after turn completion", async () => {
    analysisAcpState.createSession.mockResolvedValue({ sessionId: "feature-tree-session-1" });
    sessionLaunchState.desktopAwareFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            repoRoot: "/repo/default",
            selectedScanRoot: "/repo/default/packages/app",
            frameworksDetected: ["nextjs"],
            adapters: [{ id: "nextjs-app-router", confidence: "high", signals: ["src/app"] }],
            candidateRoots: [
              {
                path: "/repo/default/packages/app",
                kind: "app",
                score: 99,
                surfaceCounts: { pages: 16, appRouterApis: 1, pagesApis: 3, rustApis: 0 },
                adapters: ["nextjs-app-router", "nextjs-pages-api"],
                warnings: [],
              },
            ],
            warnings: ["Selected nested scan root packages/app based on detected product surface."],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sessionId: "feature-tree-session-1",
            messages: [
              {
                role: "assistant",
                content: JSON.stringify({
                  schemaVersion: 1,
                  capabilityGroups: [{ id: "workspace", name: "Workspace" }],
                  features: [{ id: "workspace-overview", name: "Workspace Overview", group: "workspace", status: "draft" }],
                }),
              },
            ],
            latestEventKind: "turn_complete",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            generatedAt: "2026-04-19T12:00:00.000Z",
            frameworksDetected: ["nextjs"],
            wroteFiles: [
              "docs/product-specs/FEATURE_TREE.md",
              "docs/product-specs/feature-tree.index.json",
            ],
            warnings: ["Scanned packages/app and wrote outputs to repo root."],
            pagesCount: 16,
            apisCount: 4,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    const view = render(<FeatureExplorerPageClient workspaceId="default" />);

    fireEvent.click(screen.getByTestId("generate-feature-tree-button"));

    await screen.findByText("Agent");
    fireEvent.click(screen.getByRole("button", { name: "Generate with agent" }));

    await waitFor(() => {
      expect(analysisAcpState.connect).toHaveBeenCalled();
      expect(analysisAcpState.createSession).toHaveBeenCalledWith(
        "/repo/default",
        "opencode",
        undefined,
        "ROUTA",
        "default",
        undefined,
        undefined,
        "feature-tree-orchestrator",
        "en",
        undefined,
        undefined,
        "main",
      );
      expect(analysisAcpState.promptSession).toHaveBeenCalledWith(
        "feature-tree-session-1",
        expect.stringContaining("Preferred scan root: /repo/default/packages/app"),
      );
    });

    analysisAcpState.updates = [
      {
        sessionId: "feature-tree-session-1",
        update: { sessionUpdate: "turn_complete" },
      },
    ];

    view.rerender(<FeatureExplorerPageClient workspaceId="default" />);

    await waitFor(() => {
      expect(sessionLaunchState.desktopAwareFetch).toHaveBeenCalledWith(
        "/sessions/feature-tree-session-1/transcript",
        { cache: "no-store" },
      );
      expect(sessionLaunchState.desktopAwareFetch).toHaveBeenCalledWith(
        "/spec/feature-tree/commit",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    const commitCall = sessionLaunchState.desktopAwareFetch.mock.calls.find(
      ([input]) => input === "/spec/feature-tree/commit",
    );
    const commitBody = JSON.parse((commitCall?.[1] as RequestInit)?.body as string);
    expect(commitBody).toEqual({
      workspaceId: "default",
      repoPath: "/repo/default",
      scanRoot: "/repo/default/packages/app",
      metadata: {
        schemaVersion: 1,
        capabilityGroups: [{ id: "workspace", name: "Workspace" }],
        features: [{ id: "workspace-overview", name: "Workspace Overview", group: "workspace", status: "draft" }],
      },
    });
  });

  it("retries transcript hydration after turn completion without re-triggering the spinner forever", async () => {
    analysisAcpState.createSession.mockResolvedValue({ sessionId: "feature-tree-session-1" });
    sessionLaunchState.desktopAwareFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            repoRoot: "/repo/default",
            selectedScanRoot: "/repo/default/packages/app",
            frameworksDetected: ["nextjs"],
            adapters: [{ id: "nextjs-app-router", confidence: "high", signals: ["src/app"] }],
            candidateRoots: [],
            warnings: [],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sessionId: "feature-tree-session-1",
            messages: [
              {
                role: "assistant",
                content: "working on it",
              },
            ],
            latestEventKind: "turn_complete",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sessionId: "feature-tree-session-1",
            messages: [
              {
                role: "assistant",
                content: JSON.stringify({
                  schemaVersion: 1,
                  capabilityGroups: [{ id: "workspace", name: "Workspace" }],
                  features: [{ id: "workspace-overview", name: "Workspace Overview", group: "workspace", status: "draft" }],
                }),
              },
            ],
            latestEventKind: "turn_complete",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            generatedAt: "2026-04-19T12:00:00.000Z",
            frameworksDetected: ["nextjs"],
            wroteFiles: [
              "docs/product-specs/FEATURE_TREE.md",
              "docs/product-specs/feature-tree.index.json",
            ],
            warnings: [],
            pagesCount: 16,
            apisCount: 4,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    const view = render(<FeatureExplorerPageClient workspaceId="default" />);

    fireEvent.click(screen.getByTestId("generate-feature-tree-button"));
    await screen.findByText("Agent");
    fireEvent.click(screen.getByRole("button", { name: "Generate with agent" }));

    await waitFor(() => {
      expect(analysisAcpState.promptSession).toHaveBeenCalledWith(
        "feature-tree-session-1",
        expect.stringContaining("Preferred scan root: /repo/default/packages/app"),
      );
    });

    analysisAcpState.updates = [
      {
        sessionId: "feature-tree-session-1",
        update: { sessionUpdate: "turn_complete" },
      },
    ];

    view.rerender(<FeatureExplorerPageClient workspaceId="default" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Applying agent result…" })).toBeTruthy();
    });

    expect(
      sessionLaunchState.desktopAwareFetch.mock.calls.filter(
        ([input]) => input === "/sessions/feature-tree-session-1/transcript",
      ),
    ).toHaveLength(1);
    expect(
      sessionLaunchState.desktopAwareFetch.mock.calls.filter(
        ([input]) => input === "/spec/feature-tree/commit",
      ),
    ).toHaveLength(0);

    await waitFor(() => {
      expect(
        sessionLaunchState.desktopAwareFetch.mock.calls.filter(
          ([input]) => input === "/sessions/feature-tree-session-1/transcript",
        ),
      ).toHaveLength(2);
    }, { timeout: 2000 });

    await waitFor(() => {
      expect(
        sessionLaunchState.desktopAwareFetch.mock.calls.filter(
          ([input]) => input === "/spec/feature-tree/commit",
        ),
      ).toHaveLength(1);
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Applying agent result…" })).toBeNull();
    });
  });

  it("commits feature tree metadata when the specialist result only appears in tool output", async () => {
    analysisAcpState.createSession.mockResolvedValue({ sessionId: "feature-tree-session-1" });
    sessionLaunchState.desktopAwareFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            repoRoot: "/repo/default",
            selectedScanRoot: "/repo/default/packages/app",
            frameworksDetected: ["nextjs"],
            adapters: [{ id: "nextjs-app-router", confidence: "high", signals: ["src/app"] }],
            candidateRoots: [],
            warnings: [],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sessionId: "feature-tree-session-1",
            history: [
              {
                update: {
                  sessionUpdate: "tool_call_update",
                  toolCallId: "call_123",
                  kind: "shell",
                  status: "completed",
                  rawOutput: {
                    schemaVersion: 1,
                    capabilityGroups: [{ id: "workspace", name: "Workspace" }],
                    features: [{ id: "workspace-overview", name: "Workspace Overview", group: "workspace", status: "draft" }],
                  },
                },
              },
            ],
            messages: [
              {
                role: "tool",
                content: "{\n  \"schemaVersion\": 1,\n  \"capabilityGroups\": [{\"id\": \"workspace\", \"name\": \"Workspace\"}],\n  \"features\": [{\"id\": \"workspace-overview\", \"name\": \"Workspace Overview\", \"group\": \"workspace\", \"status\": \"draft\"}]\n}",
              },
            ],
            latestEventKind: "turn_complete",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            generatedAt: "2026-04-19T12:00:00.000Z",
            frameworksDetected: ["nextjs"],
            wroteFiles: [
              "docs/product-specs/FEATURE_TREE.md",
              "docs/product-specs/feature-tree.index.json",
            ],
            warnings: [],
            pagesCount: 16,
            apisCount: 4,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    const view = render(<FeatureExplorerPageClient workspaceId="default" />);

    fireEvent.click(screen.getByTestId("generate-feature-tree-button"));
    await screen.findByText("Agent");
    fireEvent.click(screen.getByRole("button", { name: "Generate with agent" }));

    await waitFor(() => {
      expect(analysisAcpState.promptSession).toHaveBeenCalledWith(
        "feature-tree-session-1",
        expect.stringContaining("Preferred scan root: /repo/default/packages/app"),
      );
    });

    analysisAcpState.updates = [
      {
        sessionId: "feature-tree-session-1",
        update: { sessionUpdate: "turn_complete" },
      },
    ];

    view.rerender(<FeatureExplorerPageClient workspaceId="default" />);

    await waitFor(() => {
      expect(sessionLaunchState.desktopAwareFetch).toHaveBeenCalledWith(
        "/spec/feature-tree/commit",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    const commitCall = sessionLaunchState.desktopAwareFetch.mock.calls.find(
      ([input]) => input === "/spec/feature-tree/commit",
    );
    const commitBody = JSON.parse((commitCall?.[1] as RequestInit)?.body as string);
    expect(commitBody.metadata).toEqual({
      schemaVersion: 1,
      capabilityGroups: [{ id: "workspace", name: "Workspace" }],
      features: [{ id: "workspace-overview", name: "Workspace Overview", group: "workspace", status: "draft" }],
    });
  });

  it("renders a feature-first structure view from the feature tree index", async () => {
    useFeatureExplorerData.mockReturnValue({
      loading: false,
      error: null,
      capabilityGroups: [{ id: "execution", name: "Execution", description: "" }],
      features: [
        {
          id: "feature-a",
          name: "Feature A",
          group: "execution",
          summary: "Summary",
          status: "active",
          sessionCount: 0,
          changedFiles: 1,
          updatedAt: "-",
          sourceFileCount: 1,
          pageCount: 1,
          apiCount: 1,
        },
      ],
      surfaceIndex: {
        generatedAt: "",
        pages: [
          {
            route: "/workspace/:workspaceId/feature-explorer",
            title: "Feature Explorer",
            description: "Explore features.",
            sourceFile: "src/app/workspace/[workspaceId]/feature-explorer/page.tsx",
          },
        ],
        apis: [],
        contractApis: [
          {
            domain: "feature-explorer",
            method: "GET",
            path: "/api/feature-explorer",
            operationId: "listFeatureExplorer",
            summary: "List features",
          },
        ],
        nextjsApis: [
          {
            domain: "feature-explorer",
            method: "GET",
            path: "/api/feature-explorer",
            sourceFiles: ["src/app/api/feature-explorer/route.ts"],
          },
        ],
        rustApis: [
          {
            domain: "feature-explorer",
            method: "GET",
            path: "/api/feature-explorer",
            sourceFiles: ["crates/routa-server/src/api/feature_explorer.rs"],
          },
        ],
        metadata: {
          schemaVersion: 1,
          capabilityGroups: [],
          features: [
            {
              id: "feature-a",
              name: "Feature A",
              pages: ["/workspace/:workspaceId/feature-explorer"],
              apis: ["GET /api/feature-explorer"],
              sourceFiles: ["src/app/workspace/[workspaceId]/feature-explorer/page.tsx"],
            },
          ],
        },
        repoRoot: "/repo/default",
        warnings: [],
      },
      featureDetail: null,
      featureDetailLoading: false,
      initialFeatureId: "feature-a",
      fetchFeatureDetail: vi.fn().mockResolvedValue(null),
    });

    render(<FeatureExplorerPageClient workspaceId="default" />);

    const executionGroupToggle = screen.getByRole("button", { name: /Execution/i });
    expect(screen.getAllByText("Execution").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Feature A").length).toBeGreaterThan(0);
    expect(screen.queryByText("Feature Structure")).toBeNull();
    expect(screen.getByText("Summary")).toBeTruthy();
    expect(screen.getByTestId("feature-metric-pages-feature-a").textContent).toContain("1");
    expect(screen.getByTestId("feature-metric-apis-feature-a").textContent).toContain("1");
    expect(within(executionGroupToggle).getByText("1 Pages")).toBeTruthy();
    expect(within(executionGroupToggle).getByText("1 API")).toBeTruthy();
    expect(within(executionGroupToggle).getByText("1 files")).toBeTruthy();
    expect(screen.getByLabelText("Expand Feature A")).toBeTruthy();
    expect(screen.getByText("Feature taxonomy ready")).toBeTruthy();
    expect(screen.getByText("1 curated")).toBeTruthy();
    expect(screen.getByText("0 inferred")).toBeTruthy();
    expect(screen.getByText("Frontend routes")).toBeTruthy();
    expect(screen.getAllByText("API surfaces").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Source files").length).toBeGreaterThan(0);
    expect(screen.queryByText("/workspace/:workspaceId/feature-explorer")).toBeNull();
    expect(screen.queryByText("/api/feature-explorer")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Frontend routes/i }));
    expect(screen.getByText("/workspace/:workspaceId/feature-explorer")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /API Source/i }));
    expect(screen.getByText("/api/feature-explorer")).toBeTruthy();

    expect(screen.queryByRole("button", { name: "Context" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Screenshot" })).toBeNull();
    expect(screen.queryByRole("button", { name: "API" })).toBeNull();
  });

  it("switches surface navigation to surfaces tree mode", async () => {
    useFeatureExplorerData.mockReturnValue({
      loading: false,
      error: null,
      capabilityGroups: [],
      features: [],
      surfaceIndex: {
        generatedAt: "",
        pages: [
          {
            route: "/workspace/:workspaceId/feature-explorer",
            title: "Feature Explorer",
            description: "Explore features.",
            sourceFile: "src/app/workspace/[workspaceId]/feature-explorer/page.tsx",
          },
        ],
        apis: [],
        contractApis: [],
        nextjsApis: [],
        rustApis: [],
        metadata: null,
        repoRoot: "/repo/default",
        warnings: [],
      },
      featureDetail: null,
      featureDetailLoading: false,
      initialFeatureId: "",
      fetchFeatureDetail: vi.fn().mockResolvedValue(null),
    });

    render(<FeatureExplorerPageClient workspaceId="default" />);

    fireEvent.click(screen.getByRole("button", { name: "Surfaces" }));

    expect(screen.getByText("/workspace")).toBeTruthy();
    expect(screen.queryByText(":workspaceId")).toBeNull();
    expect(screen.queryByText("feature-explorer")).toBeNull();
  });

  it("shows inferred repository status when only auto-generated feature groups exist", async () => {
    useFeatureExplorerData.mockReturnValue({
      loading: false,
      error: null,
      capabilityGroups: [{ id: "inferred-surfaces", name: "Inferred Surfaces", description: "Auto-derived groups" }],
      features: [
        {
          id: "feature-explorer",
          name: "Feature Explorer",
          group: "inferred-surfaces",
          summary: "Auto-inferred from routes and APIs",
          status: "inferred",
          sessionCount: 2,
          changedFiles: 1,
          updatedAt: "-",
          sourceFileCount: 0,
          pageCount: 1,
          apiCount: 1,
        },
      ],
      surfaceIndex: {
        generatedAt: "",
        pages: [
          {
            route: "/workspace/:workspaceId/feature-explorer",
            title: "Feature Explorer",
            description: "Explore features.",
            sourceFile: "",
          },
        ],
        apis: [],
        contractApis: [
          {
            domain: "feature-explorer",
            method: "GET",
            path: "/api/feature-explorer",
            operationId: "listFeatureExplorer",
            summary: "List features",
          },
        ],
        nextjsApis: [],
        rustApis: [],
        metadata: {
          schemaVersion: 1,
          capabilityGroups: [{ id: "inferred-surfaces", name: "Inferred Surfaces", description: "Auto-derived groups" }],
          features: [
            {
              id: "feature-explorer",
              name: "Feature Explorer",
              group: "inferred-surfaces",
              summary: "Auto-inferred from routes and APIs",
              status: "inferred",
              pages: ["/workspace/:workspaceId/feature-explorer"],
              apis: ["GET /api/feature-explorer"],
              sourceFiles: [],
            },
          ],
        },
        repoRoot: "/repo/default",
        warnings: [],
      },
      featureDetail: null,
      featureDetailLoading: false,
      initialFeatureId: "feature-explorer",
      fetchFeatureDetail: vi.fn().mockResolvedValue(null),
    });

    render(<FeatureExplorerPageClient workspaceId="default" />);

    expect(screen.getByText("Inferred feature map available")).toBeTruthy();
    expect(screen.getByText("0 curated")).toBeTruthy();
    expect(screen.getByText("1 inferred")).toBeTruthy();
    expect(screen.queryByText("Feature taxonomy missing")).toBeNull();
    expect(screen.getAllByText("Inferred Surfaces").length).toBeGreaterThan(0);
  });

  it("keeps feature navigation in the incoming source order", async () => {
    useFeatureExplorerData.mockReturnValue({
      loading: false,
      error: null,
      capabilityGroups: [{ id: "execution", name: "Execution", description: "" }],
      features: [
        {
          id: "feature-low",
          name: "Feature Low",
          group: "execution",
          summary: "Low priority",
          status: "active",
          sessionCount: 1,
          changedFiles: 10,
          updatedAt: "-",
          sourceFileCount: 1,
          pageCount: 0,
          apiCount: 0,
        },
        {
          id: "feature-high",
          name: "Feature High",
          group: "execution",
          summary: "High priority",
          status: "active",
          sessionCount: 9,
          changedFiles: 2,
          updatedAt: "-",
          sourceFileCount: 1,
          pageCount: 0,
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
        repoRoot: "/repo/default",
        warnings: [],
      },
      featureDetail: null,
      featureDetailLoading: false,
      initialFeatureId: "",
      fetchFeatureDetail: vi.fn().mockResolvedValue(null),
    });

    render(<FeatureExplorerPageClient workspaceId="default" />);

    const highFeature = screen.getByRole("button", { name: /Feature High/ });
    const lowFeature = screen.getByRole("button", { name: /Feature Low/ });

    expect(lowFeature.compareDocumentPosition(highFeature) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("switches to the API tree work view", async () => {
    useFeatureExplorerData.mockReturnValue({
      loading: false,
      error: null,
      capabilityGroups: [{ id: "execution", name: "Execution", description: "" }],
      features: [
        {
          id: "feature-nextjs",
          name: "Feature Next.js",
          group: "execution",
          summary: "Mapped to a Next.js API",
          status: "active",
          sessionCount: 1,
          changedFiles: 1,
          updatedAt: "-",
          sourceFileCount: 1,
          pageCount: 0,
          apiCount: 1,
        },
        {
          id: "feature-hidden",
          name: "Feature Hidden",
          group: "execution",
          summary: "No Next.js API mapping",
          status: "active",
          sessionCount: 9,
          changedFiles: 9,
          updatedAt: "-",
          sourceFileCount: 1,
          pageCount: 0,
          apiCount: 0,
        },
      ],
      surfaceIndex: {
        generatedAt: "",
        pages: [],
        apis: [],
        contractApis: [],
        nextjsApis: [
          {
            domain: "feature-explorer",
            method: "GET",
            path: "/api/feature-explorer",
            sourceFiles: ["src/app/api/feature-explorer/route.ts"],
          },
        ],
        rustApis: [],
        metadata: {
          schemaVersion: 1,
          capabilityGroups: [],
          features: [
            {
              id: "feature-nextjs",
              name: "Feature Next.js",
              pages: [],
              apis: ["GET /api/feature-explorer"],
              sourceFiles: ["src/app/api/feature-explorer/route.ts"],
            },
          ],
        },
        repoRoot: "/repo/default",
        warnings: [],
      },
      featureDetail: null,
      featureDetailLoading: false,
      initialFeatureId: "",
      fetchFeatureDetail: vi.fn().mockResolvedValue(null),
    });

    render(<FeatureExplorerPageClient workspaceId="default" />);

    expect(screen.getByLabelText("Expand Feature Next.js")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Feature Hidden" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "APIs" }));

    expect(screen.getByText("/feature-explorer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Feature Next\.js/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Feature Hidden/ })).toBeNull();
  });

  it("expands capability features into concrete page and api surfaces", async () => {
    useFeatureExplorerData.mockReturnValue({
      loading: false,
      error: null,
      capabilityGroups: [{ id: "execution", name: "Execution", description: "Execution surfaces" }],
      features: [
        {
          id: "feature-explorer",
          name: "Feature Explorer",
          group: "execution",
          summary: "Inspect workspace feature surfaces.",
          status: "evolving",
          sessionCount: 7,
          changedFiles: 7,
          updatedAt: "-",
          sourceFileCount: 7,
          pageCount: 1,
          apiCount: 2,
        },
      ],
      surfaceIndex: {
        generatedAt: "",
        pages: [
          {
            route: "/workspace/:workspaceId/feature-explorer",
            title: "Feature Explorer",
            description: "Explore features.",
            sourceFile: "src/app/workspace/[workspaceId]/feature-explorer/page.tsx",
          },
        ],
        apis: [],
        contractApis: [
          {
            domain: "feature-explorer",
            method: "GET",
            path: "/api/feature-explorer",
            operationId: "listFeatureExplorer",
            summary: "List features",
          },
        ],
        nextjsApis: [
          {
            domain: "feature-explorer",
            method: "GET",
            path: "/api/feature-explorer",
            sourceFiles: ["src/app/api/feature-explorer/route.ts"],
          },
        ],
        rustApis: [],
        metadata: {
          schemaVersion: 1,
          capabilityGroups: [{ id: "execution", name: "Execution", description: "Execution surfaces" }],
          features: [
            {
              id: "feature-explorer",
              name: "Feature Explorer",
              group: "execution",
              pages: ["/workspace/:workspaceId/feature-explorer"],
              apis: ["GET /api/feature-explorer"],
              sourceFiles: ["src/app/workspace/[workspaceId]/feature-explorer/page.tsx"],
            },
          ],
        },
        repoRoot: "/repo/default",
        warnings: [],
      },
      featureDetail: null,
      featureDetailLoading: false,
      initialFeatureId: "feature-explorer",
      fetchFeatureDetail: vi.fn().mockResolvedValue(null),
    });

    render(<FeatureExplorerPageClient workspaceId="default" />);

    expect(screen.getByLabelText("Expand Feature Explorer")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Expand Feature Explorer"));

    expect(screen.getByRole("button", { name: "Feature Explorer" })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "/workspace/:workspaceId/feature-explorer" })).toBeTruthy();
    });
  });

  it("does not duplicate feature details in the inspector for feature selections", async () => {
    useFeatureExplorerData.mockReturnValue({
      loading: false,
      error: null,
      capabilityGroups: [{ id: "kanban", name: "Kanban", description: "Kanban workflows" }],
      features: [
        {
          id: "kanban-workflow",
          name: "Kanban Workflow",
          group: "kanban",
          summary: "Workflow surface",
          status: "active",
          sessionCount: 6,
          changedFiles: 6,
          updatedAt: "2026-04-17T08:00:00.000Z",
          sourceFileCount: 1,
          pageCount: 0,
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
        id: "kanban-workflow",
        name: "Kanban Workflow",
        group: "kanban",
        summary: "Workflow surface",
        status: "active",
        pages: [],
        apis: [],
        sourceFiles: ["src/app/api/kanban/boards/route.ts"],
        relatedFeatures: [],
        domainObjects: [],
        sessionCount: 6,
        changedFiles: 6,
        updatedAt: "2026-04-17T08:00:00.000Z",
        fileTree: [],
        fileStats: {},
      },
      featureDetailLoading: false,
      initialFeatureId: "kanban-workflow",
      fetchFeatureDetail: vi.fn().mockResolvedValue(null),
    });

    render(<FeatureExplorerPageClient workspaceId="default" />);

    expect(screen.queryByText("Selected surface")).toBeNull();
    expect(screen.getAllByText("Kanban Workflow").length).toBeGreaterThan(0);
    expect(screen.queryByText("Capability group")).toBeNull();
  });

  it("keeps the inspector focused on surface evidence when a non-feature surface is selected", async () => {
    useFeatureExplorerData.mockReturnValue({
      loading: false,
      error: null,
      capabilityGroups: [{ id: "workspace", name: "Workspace", description: "Workspace surfaces" }],
      features: [
        {
          id: "feature-explorer",
          name: "Feature Explorer",
          group: "workspace",
          summary: "Inspect feature surfaces",
          status: "active",
          sessionCount: 12,
          changedFiles: 8,
          updatedAt: "2026-04-20T08:00:00.000Z",
          sourceFileCount: 2,
          pageCount: 1,
          apiCount: 1,
        },
      ],
      surfaceIndex: {
        generatedAt: "",
        pages: [
          {
            route: "/workspace/:workspaceId/feature-explorer",
            title: "Feature Explorer",
            description: "Inspect feature surfaces",
            sourceFile: "src/app/workspace/[workspaceId]/feature-explorer/page.tsx",
          },
        ],
        apis: [],
        contractApis: [
          {
            domain: "feature-explorer",
            method: "GET",
            path: "/api/feature-explorer",
            operationId: "listFeatureExplorer",
            summary: "List feature explorer features",
          },
        ],
        nextjsApis: [
          {
            domain: "feature-explorer",
            method: "GET",
            path: "/api/feature-explorer",
            sourceFiles: ["src/app/api/feature-explorer/route.ts"],
          },
        ],
        rustApis: [],
        metadata: {
          schemaVersion: 1,
          capabilityGroups: [{ id: "workspace", name: "Workspace", description: "Workspace surfaces" }],
          features: [
            {
              id: "feature-explorer",
              name: "Feature Explorer",
              group: "workspace",
              pages: ["/workspace/:workspaceId/feature-explorer"],
              apis: ["GET /api/feature-explorer"],
              sourceFiles: [
                "src/app/workspace/[workspaceId]/feature-explorer/page.tsx",
                "src/app/api/feature-explorer/route.ts",
              ],
            },
          ],
        },
        repoRoot: "/repo/default",
        warnings: [],
      },
      featureDetail: {
        id: "feature-explorer",
        name: "Feature Explorer",
        group: "workspace",
        summary: "Inspect feature surfaces",
        status: "active",
        pages: ["/workspace/:workspaceId/feature-explorer"],
        apis: ["GET /api/feature-explorer"],
        sourceFiles: [
          "src/app/workspace/[workspaceId]/feature-explorer/page.tsx",
          "src/app/api/feature-explorer/route.ts",
        ],
        relatedFeatures: [],
        domainObjects: [],
        sessionCount: 12,
        changedFiles: 8,
        updatedAt: "2026-04-20T08:00:00.000Z",
        fileTree: [],
        fileStats: {},
      },
      featureDetailLoading: false,
      initialFeatureId: "feature-explorer",
      fetchFeatureDetail: vi.fn().mockResolvedValue(null),
    });

    render(<FeatureExplorerPageClient workspaceId="default" />);

    fireEvent.click(screen.getByLabelText("Expand Feature Explorer"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "/api/feature-explorer" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "/api/feature-explorer" }));

    await waitFor(() => {
      expect(screen.getByText("Selected surface")).toBeTruthy();
    });
    expect(screen.queryByText("Learned prompt context")).toBeNull();
  });

  it("summarizes folder session counts from descendant files", async () => {
    useFeatureExplorerData.mockReturnValue({
      loading: false,
      error: null,
      capabilityGroups: [
        { id: "kanban", name: "Kanban", description: "" },
      ],
      features: [
        {
          id: "kanban-workflow",
          name: "Kanban Workflow",
          group: "kanban",
          summary: "Workflow surface",
          status: "active",
          sessionCount: 6,
          changedFiles: 6,
          updatedAt: "2026-04-17T08:00:00.000Z",
          sourceFileCount: 1,
          pageCount: 0,
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
        id: "kanban-workflow",
        name: "Kanban Workflow",
        group: "kanban",
        summary: "Workflow surface",
        status: "active",
        pages: [],
        apis: [],
        sourceFiles: ["src/app/api/kanban/boards/route.ts"],
        relatedFeatures: [],
        domainObjects: [],
        sessionCount: 6,
        changedFiles: 6,
        updatedAt: "2026-04-17T08:00:00.000Z",
        fileTree: [
          {
            id: "folder-src",
            name: "src",
            path: "src",
            kind: "folder",
            children: [
              {
                id: "folder-app",
                name: "app",
                path: "src/app",
                kind: "folder",
                children: [
                  {
                    id: "file-route",
                    name: "route.ts",
                    path: "src/app/api/kanban/boards/route.ts",
                    kind: "file",
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
        fileStats: {
          "src/app/api/kanban/boards/route.ts": {
            changes: 6,
            sessions: 6,
            updatedAt: "2026-04-17T08:00:00.000Z",
          },
        },
      },
      featureDetailLoading: false,
      initialFeatureId: "kanban-workflow",
      fetchFeatureDetail: vi.fn().mockResolvedValue(null),
    });

    render(<FeatureExplorerPageClient workspaceId="default" />);

    await waitFor(() => {
      expect(screen.getByTestId("feature-tree-sessions-folder-src").textContent).toBe("6");
    });

    expect(screen.getAllByText("Kanban Workflow").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Source files").length).toBeGreaterThan(0);
    expect(screen.getByTestId("feature-tree-changes-folder-src").textContent).toBe("6");
    expect(screen.getByTestId("feature-tree-sessions-folder-app").textContent).toBe("6");
    expect(screen.getByTestId("feature-tree-updated-folder-src").textContent).not.toBe("-");

    fireEvent.click(screen.getByTestId("feature-tree-select-folder-src"));
    expect((screen.getByTestId("feature-tree-select-folder-src") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("feature-tree-select-file-route") as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByTestId("feature-tree-select-folder-src"));
    expect((screen.getByTestId("feature-tree-select-folder-src") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("feature-tree-select-file-route") as HTMLInputElement).checked).toBe(true);
  });

  it("updates inspector evidence when activating a different file row", async () => {
    useFeatureExplorerData.mockReturnValue({
      loading: false,
      error: null,
      capabilityGroups: [{ id: "workspace", name: "Workspace", description: "" }],
      features: [
        {
          id: "workspace-overview",
          name: "Workspace Overview",
          group: "workspace",
          summary: "Workspace entry point",
          status: "shipped",
          sessionCount: 2,
          changedFiles: 2,
          updatedAt: "2026-04-18T08:00:00.000Z",
          sourceFileCount: 2,
          pageCount: 1,
          apiCount: 0,
        },
      ],
      surfaceIndex: {
        generatedAt: "",
        pages: [
          {
            route: "/workspace/:workspaceId",
            title: "Workspace Overview",
            description: "Workspace entry point",
            sourceFile: "src/app/workspace/[workspaceId]/page.tsx",
          },
        ],
        apis: [],
        contractApis: [],
        nextjsApis: [],
        rustApis: [],
        implementationApis: [],
        metadata: {
          schemaVersion: 1,
          capabilityGroups: [{ id: "workspace", name: "Workspace", description: "" }],
          features: [
            {
              id: "workspace-overview",
              name: "Workspace Overview",
              group: "workspace",
              pages: ["/workspace/:workspaceId"],
              apis: [],
              sourceFiles: [
                "src/app/workspace/[workspaceId]/overview/page.tsx",
                "src/app/workspace/[workspaceId]/page.tsx",
              ],
            },
          ],
        },
        repoRoot: "/repo/default",
        warnings: [],
      },
      featureDetail: {
        id: "workspace-overview",
        name: "Workspace Overview",
        group: "workspace",
        summary: "Workspace entry point",
        status: "shipped",
        pages: ["/workspace/:workspaceId"],
        apis: [],
        sourceFiles: [
          "src/app/workspace/[workspaceId]/overview/page.tsx",
          "src/app/workspace/[workspaceId]/page.tsx",
        ],
        relatedFeatures: [],
        domainObjects: [],
        sessionCount: 2,
        changedFiles: 2,
        updatedAt: "2026-04-18T08:00:00.000Z",
        fileTree: [
          {
            id: "folder-src",
            name: "src",
            path: "src",
            kind: "folder",
            children: [
              {
                id: "folder-app",
                name: "app",
                path: "src/app",
                kind: "folder",
                children: [
                  {
                    id: "file-overview",
                    name: "page.tsx",
                    path: "src/app/workspace/[workspaceId]/overview/page.tsx",
                    kind: "file",
                    children: [],
                  },
                  {
                    id: "file-root",
                    name: "page.tsx",
                    path: "src/app/workspace/[workspaceId]/page.tsx",
                    kind: "file",
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
        fileStats: {
          "src/app/workspace/[workspaceId]/overview/page.tsx": {
            changes: 1,
            sessions: 1,
            updatedAt: "2026-04-17T08:00:00.000Z",
          },
          "src/app/workspace/[workspaceId]/page.tsx": {
            changes: 1,
            sessions: 1,
            updatedAt: "2026-04-18T08:00:00.000Z",
          },
        },
        fileSignals: {
          "src/app/workspace/[workspaceId]/overview/page.tsx": {
            sessions: [
              {
                provider: "codex",
                sessionId: "session-overview",
                updatedAt: "2026-04-17T08:00:00.000Z",
                promptSnippet: "overview prompt",
                promptHistory: ["overview prompt"],
                toolNames: ["Read"],
                changedFiles: ["src/app/workspace/[workspaceId]/overview/page.tsx"],
              },
            ],
            toolHistory: ["Read"],
            promptHistory: ["overview prompt"],
          },
          "src/app/workspace/[workspaceId]/page.tsx": {
            sessions: [
              {
                provider: "codex",
                sessionId: "session-root",
                updatedAt: "2026-04-18T08:00:00.000Z",
                promptSnippet: "root prompt",
                promptHistory: ["root prompt"],
                toolNames: ["Write"],
                changedFiles: ["src/app/workspace/[workspaceId]/page.tsx"],
              },
            ],
            toolHistory: ["Write"],
            promptHistory: ["root prompt"],
          },
        },
      },
      featureDetailLoading: false,
      initialFeatureId: "workspace-overview",
      fetchFeatureDetail: vi.fn().mockResolvedValue(null),
    });

    render(<FeatureExplorerPageClient workspaceId="default" />);

    await waitFor(() => {
      expect(screen.getByText("session-overview")).toBeTruthy();
    });

    expect((screen.getByTestId("feature-tree-select-file-overview") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("feature-tree-select-file-root") as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByTestId("feature-tree-activate-file-root"));

    await waitFor(() => {
      expect(screen.getByText("session-root")).toBeTruthy();
    });

    expect(screen.queryByText("session-overview")).toBeNull();
    expect((screen.getByTestId("feature-tree-select-file-overview") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("feature-tree-select-file-root") as HTMLInputElement).checked).toBe(true);
  });

});
