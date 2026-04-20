import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GitHubActionsFlowsResponse } from "@/client/hooks/use-harness-settings-data";
import type { SpecDetectionResponse } from "@/core/harness/spec-detector-types";
import HarnessSettingsPage from "../page";

const repoPickerMock = vi.fn();
const routerReplaceMock = vi.fn();
const routerPushMock = vi.fn();
const useHarnessSettingsDataMock = vi.fn();
let currentSearchParams = new URLSearchParams();

function createSpecSourcesData(
  overrides: Partial<SpecDetectionResponse> = {},
): SpecDetectionResponse {
  return {
    generatedAt: "2026-03-30T00:00:00.000Z",
    repoRoot: "/Users/phodal/ai/routa-js",
    sources: [],
    warnings: [],
    ...overrides,
  };
}

function createGitHubActionsData(
  overrides: Partial<GitHubActionsFlowsResponse> = {},
): GitHubActionsFlowsResponse {
  return {
    generatedAt: "2026-03-30T00:00:00.000Z",
    repoRoot: "/Users/phodal/ai/routa-js",
    workflowsDir: ".github/workflows",
    flows: [],
    warnings: [],
    ...overrides,
  };
}

const mockHarnessSettingsData = {
  specsState: {
    loading: false,
    error: null,
    data: {
      files: [
        {
          name: "README.md",
          relativePath: "docs/fitness/README.md",
          kind: "rulebook",
          language: "markdown",
          metricCount: 0,
          metrics: [],
          source: "# Fitness README\n\n```bash\nentrix run --tier fast\n```",
          frontmatterSource: undefined,
        },
        {
          name: "code-quality.md",
          relativePath: "docs/fitness/code-quality.md",
          kind: "dimension",
          language: "markdown",
          dimension: "code_quality",
          weight: 24,
          thresholdPass: 90,
          thresholdWarn: 80,
          metricCount: 2,
          metrics: [],
          source: "# Code quality",
          frontmatterSource: "---",
        },
      ],
    },
  },
  planState: {
    loading: false,
    error: null,
    data: {
      metricCount: 2,
      hardGateCount: 1,
      dimensions: [],
    },
  },
  architectureState: {
    loading: false,
    error: null,
    data: null,
  },
  designDecisionsState: {
    loading: false,
    error: null,
    data: {
      generatedAt: "2026-03-30T00:00:00.000Z",
      repoRoot: "/Users/phodal/ai/routa-js",
      sources: [
        {
          kind: "canonical-doc",
          label: "Architecture",
          rootPath: "docs",
          confidence: "high",
          status: "documents-present",
          artifacts: [],
        },
      ],
      warnings: [],
    },
  },
  hooksState: {
    loading: false,
    error: null,
    data: {
      profiles: [],
      hookFiles: [],
    },
  },
  agentHooksState: {
    loading: false,
    error: null,
    data: {
      hooks: [],
    },
  },
  instructionsState: {
    loading: false,
    error: null,
    data: {
      generatedAt: "2026-03-29T00:00:00.000Z",
      repoRoot: "/Users/phodal/ai/routa-js",
      fileName: "CLAUDE.md",
      relativePath: "CLAUDE.md",
      source: "# Routa.js",
      fallbackUsed: false,
      audit: null,
    },
  },
  githubActionsState: {
    loading: false,
    error: null,
    data: createGitHubActionsData(),
  },
  automationsState: {
    loading: false,
    error: null,
    data: {
      generatedAt: "2026-03-30T00:00:00.000Z",
      repoRoot: "/Users/phodal/ai/routa-js",
      configFile: null,
      definitions: [],
      pendingSignals: [],
      recentRuns: [],
      warnings: [],
    },
  },
  specSourcesState: {
    loading: false,
    error: null,
    data: createSpecSourcesData(),
  },
  codeownersState: {
    loading: false,
    error: null,
    data: null,
  },
  reloadArchitecture: vi.fn(async () => {}),
  reloadInstructions: vi.fn(async () => {}),
};

const localStorageMock = (() => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: localStorageMock,
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
    push: routerPushMock,
  }),
  useSearchParams: () => ({
    get: (key: string) => currentSearchParams.get(key),
    toString: () => currentSearchParams.toString(),
  }),
}));

vi.mock("@/client/components/codemirror/code-viewer", () => ({
  CodeViewer: ({ code }: { code: string }) => <pre data-testid="code-viewer">{code}</pre>,
}));

vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children, workspaceSwitcher, titleBarRight }: { children: ReactNode; workspaceSwitcher?: ReactNode; titleBarRight?: ReactNode }) => (
    <div data-testid="desktop-shell-root">
      <aside data-testid="desktop-shell-sidebar" />
      <div>
        <div data-testid="desktop-shell-header">
          {workspaceSwitcher}
          {titleBarRight}
        </div>
        <main data-testid="desktop-shell-main">{children}</main>
      </div>
    </div>
  ),
}));

vi.mock("@/client/components/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />,
}));

vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: (props: { value: { path: string } | null; onChange: (selection: unknown) => void }) => {
    repoPickerMock(props);
    return (
      <button
        type="button"
        data-testid="repo-picker"
        onClick={() => props.onChange({
          name: "codex",
          path: "/Users/phodal/ai/codex",
          branch: "main",
        })}
      >
        {props.value?.path ?? "empty"}
      </button>
    );
  },
}));

vi.mock("@/client/components/harness-execution-plan-flow", () => ({
  HarnessExecutionPlanFlow: () => <div data-testid="execution-plan-flow" />,
}));

vi.mock("@/client/components/harness-agent-instructions-panel", () => ({
  HarnessAgentInstructionsPanel: ({ variant = "full" }: { variant?: "full" | "compact" }) => (
    <div data-testid={`instruction-panel-${variant}`}>Instruction file</div>
  ),
}));

vi.mock("@/client/components/harness-architecture-quality-panel", () => ({
  HarnessArchitectureQualityPanel: () => <div data-testid="architecture-quality-panel">Architecture quality</div>,
}));

vi.mock("@/client/components/harness-design-decision-panel", () => ({
  HarnessDesignDecisionPanel: ({ variant = "full" }: { variant?: "full" | "compact" }) => (
    <div data-testid={`design-decision-panel-${variant}`}>Design decisions</div>
  ),
}));

vi.mock("@/client/components/harness-fitness-files-dashboard", () => ({
  HarnessFitnessFilesDashboard: () => <div data-testid="fitness-files-dashboard" />,
}));

vi.mock("@/client/components/harness-governance-loop-graph", () => ({
  HarnessGovernanceLoopGraph: () => <div data-testid="governance-loop-graph" />,
}));

vi.mock("@/client/components/harness-lifecycle-view", () => ({
  HarnessLifecycleView: ({
    selectedNodeId,
    onSelectedNodeChange,
  }: {
    selectedNodeId?: string | null;
    onSelectedNodeChange?: (nodeId: string) => void;
    contextPanel?: ReactNode;
  }) => (
    <div data-testid="lifecycle-view">
      <div data-testid="selected-node-id">{selectedNodeId ?? ""}</div>
      <button type="button" onClick={() => onSelectedNodeChange?.("thinking")}>select-thinking</button>
      <button type="button" onClick={() => onSelectedNodeChange?.("release")}>select-release</button>
    </div>
  ),
}));

vi.mock("@/client/components/harness-github-actions-flow-panel", () => ({
  HarnessGitHubActionsFlowPanel: ({
    repoPath,
    data,
  }: {
    repoPath?: string;
    data?: { flows?: unknown[] } | null;
  }) => (
    <div
      data-testid="github-actions-flow-panel"
      data-repo-path={repoPath ?? ""}
      data-flow-count={String(data?.flows?.length ?? 0)}
    />
  ),
}));

vi.mock("@/client/components/harness-hook-runtime-panel", () => ({
  HarnessHookRuntimePanel: () => <div data-testid="hook-runtime-panel" />,
}));

vi.mock("@/client/components/harness-agent-hook-panel", () => ({
  HarnessAgentHookPanel: ({ variant = "full" }: { variant?: "full" | "compact" }) => (
    <div data-testid={`agent-hook-panel-${variant}`}>Agent hooks</div>
  ),
}));

vi.mock("@/client/components/harness-repo-signals-panel", () => ({
  HarnessRepoSignalsPanel: ({ variant = "full" }: { variant?: "full" | "compact" }) => (
    <div data-testid={`repo-signals-panel-${variant}`}>Repo signals</div>
  ),
}));

vi.mock("@/client/components/harness-automation-panel", () => ({
  HarnessAutomationPanel: ({ variant = "full" }: { variant?: "full" | "compact" }) => (
    <div data-testid={`automation-panel-${variant}`}>Cleanup &amp; correction</div>
  ),
}));

vi.mock("@/client/components/harness-codeowners-panel", () => ({
  HarnessCodeownersPanel: ({ variant = "full" }: { variant?: "full" | "compact" }) => (
    <div data-testid={`codeowners-panel-${variant}`}>Codeowners</div>
  ),
}));

vi.mock("@/client/components/harness-review-triggers-panel", () => ({
  HarnessReviewTriggersPanel: ({ variant = "full" }: { variant?: "full" | "compact" }) => (
    <div data-testid={`review-triggers-panel-${variant}`}>Review triggers</div>
  ),
}));

vi.mock("@/client/components/harness-release-triggers-panel", () => ({
  HarnessReleaseTriggersPanel: ({ variant = "full" }: { variant?: "full" | "compact" }) => (
    <div data-testid={`release-triggers-panel-${variant}`}>Release triggers</div>
  ),
}));

vi.mock("@/client/components/harness-spec-sources-panel", () => ({
  HarnessSpecSourcesPanel: ({ variant = "full" }: { variant?: "full" | "compact" }) => (
    <div data-testid={`spec-sources-${variant}`}>Spec sources</div>
  ),
}));

vi.mock("@/app/workspace/[workspaceId]/spec/spec-page-client", () => ({
  SpecBoardPanel: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="spec-board-panel" data-workspace-id={workspaceId}>Spec board panel</div>
  ),
}));

vi.mock("@/client/components/harness-support-state", () => ({
  HarnessUnsupportedState: ({ className }: { className?: string }) => <div className={className} data-testid="unsupported-state" />,
  getHarnessUnsupportedRepoMessage: () => null,
}));

vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => ({
    workspaces: [
      {
        id: "default",
        title: "Default Workspace",
        status: "active",
        metadata: {},
        createdAt: "2026-03-29T00:00:00.000Z",
        updatedAt: "2026-03-29T00:00:00.000Z",
      },
    ],
    loading: false,
    fetchWorkspaces: vi.fn(async () => {}),
    createWorkspace: vi.fn(async () => null),
    archiveWorkspace: vi.fn(async () => {}),
  }),
  useCodebases: () => ({
    codebases: [
      {
        id: "cb-1",
        label: "phodal/routa",
        repoPath: "/Users/phodal/ai/routa-js",
        branch: "main",
        isDefault: true,
      },
    ],
    fetchCodebases: vi.fn(async () => {}),
  }),
}));

vi.mock("@/client/hooks/use-harness-settings-data", () => ({
  useHarnessSettingsData: (args: unknown) => useHarnessSettingsDataMock(args),
}));

describe("HarnessSettingsPage", () => {
  beforeEach(() => {
    repoPickerMock.mockReset();
    routerReplaceMock.mockReset();
    routerPushMock.mockReset();
    currentSearchParams = new URLSearchParams();
    window.localStorage.clear();
    mockHarnessSettingsData.reloadArchitecture.mockClear();
    mockHarnessSettingsData.reloadInstructions.mockClear();
    useHarnessSettingsDataMock.mockReset();
    useHarnessSettingsDataMock.mockReturnValue(mockHarnessSettingsData);
    mockHarnessSettingsData.specSourcesState = {
      loading: false,
      error: null,
      data: createSpecSourcesData(),
    };
  });

  it("renders the console workbench at /settings/harness without overview side panels", () => {
    render(<HarnessSettingsPage />);

    expect(screen.getByTestId("desktop-shell-sidebar")).not.toBeNull();
    expect(screen.getAllByTestId("harness-console-explorer")).toHaveLength(1);
    expect(screen.getByTestId("workspace-switcher")).not.toBeNull();
    expect(screen.queryByTestId("harness-console-bottom-panel")).toBeNull();
    expect(screen.queryByPlaceholderText("Search sections")).toBeNull();
    expect(screen.getByText("CLAUDE.md")).not.toBeNull();
    expect(screen.queryByText("Workbench Context")).toBeNull();
    expect(screen.queryByText("Quick Actions")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open context" })).toBeNull();
    expect(screen.queryByText("repo: phodal/routa")).toBeNull();
    expect(screen.queryByText("dimensions: 1")).toBeNull();
    expect(screen.queryByText("metrics: 2")).toBeNull();
    expect(screen.queryByText("hard gates: 1")).toBeNull();
    expect(screen.getAllByText("Overview").length).toBeGreaterThan(0);
    expect(screen.getByText("Intent")).not.toBeNull();
    expect(screen.getByText("Control")).not.toBeNull();
    expect(screen.getByText("Flow")).not.toBeNull();
    expect(screen.getByText("Signal")).not.toBeNull();
    expect(screen.getByText("Cleanup & Correction")).not.toBeNull();
    expect(screen.getByText("Test Feedback")).not.toBeNull();
  });

  it("uses the active codebase context by default", () => {
    render(<HarnessSettingsPage />);

    expect(useHarnessSettingsDataMock).toHaveBeenCalledWith({
      workspaceId: "default",
      codebaseId: "cb-1",
      repoPath: "/Users/phodal/ai/routa-js",
      selectedTier: "normal",
      enableArchitecture: false,
      preferCurrentRepoForArchitecture: true,
    });
    expect(window.localStorage.getItem("routa.repoSelection.harness.default")).toBeNull();
  });

  it("opens the tab from the section query parameter on first render", () => {
    currentSearchParams = new URLSearchParams("section=hook-systems");

    render(<HarnessSettingsPage />);

    expect(screen.getByTestId("hook-runtime-panel")).not.toBeNull();
    expect(screen.getByTestId("agent-hook-panel-full")).not.toBeNull();
    expect(screen.queryByTestId("lifecycle-view")).toBeNull();
  });

  it("opens the automations tab from the section query parameter on first render", () => {
    currentSearchParams = new URLSearchParams("section=automations");

    render(<HarnessSettingsPage />);

    expect(screen.getByTestId("automation-panel-full")).not.toBeNull();
    expect(screen.queryByTestId("lifecycle-view")).toBeNull();
  });

  it("opens the architecture tab from the section query parameter and enables architecture loading", () => {
    currentSearchParams = new URLSearchParams("section=architecture-quality");

    render(<HarnessSettingsPage />);

    expect(screen.getByTestId("architecture-quality-panel")).not.toBeNull();
    expect(useHarnessSettingsDataMock).toHaveBeenCalledWith({
      workspaceId: "default",
      codebaseId: "cb-1",
      repoPath: "/Users/phodal/ai/routa-js",
      selectedTier: "normal",
      enableArchitecture: true,
      preferCurrentRepoForArchitecture: true,
    });
  });

  it("updates the section query parameter when opening another section", () => {
    currentSearchParams = new URLSearchParams("workspaceId=default");

    render(<HarnessSettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: /Spec Sources/i }));

    expect(routerReplaceMock).toHaveBeenCalledWith("/settings/harness?workspaceId=default&section=spec-sources");
  });

  it("renders the spec board from the section query parameter", () => {
    currentSearchParams = new URLSearchParams("workspaceId=default&section=spec");

    render(<HarnessSettingsPage />);

    const panel = screen.getByTestId("spec-board-panel");
    expect(panel).not.toBeNull();
    expect(panel.getAttribute("data-workspace-id")).toBe("default");
  });

  it("opens the spec section and preserves workspace id in the url", () => {
    currentSearchParams = new URLSearchParams("workspaceId=default");

    render(<HarnessSettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: /^Spec$/i }));

    expect(routerReplaceMock).toHaveBeenCalledWith("/settings/harness?workspaceId=default&section=spec");
  });

  it("persists an explicit repo override from the picker", () => {
    render(<HarnessSettingsPage />);

    fireEvent.click(screen.getByTestId("repo-picker"));

    expect(useHarnessSettingsDataMock).toHaveBeenLastCalledWith({
      workspaceId: "default",
      codebaseId: undefined,
      repoPath: "/Users/phodal/ai/codex",
      selectedTier: "normal",
      enableArchitecture: false,
      preferCurrentRepoForArchitecture: false,
    });
    expect(window.localStorage.getItem("routa.repoSelection.harness.default")).toContain("/Users/phodal/ai/codex");
  });

  it("opens the bottom panel with compact context when clicking a lifecycle node", () => {
    mockHarnessSettingsData.specSourcesState = {
      loading: false,
      error: null,
      data: createSpecSourcesData({
        sources: [
          {
            kind: "framework",
            system: "bmad",
            rootPath: "docs",
            confidence: "low",
            status: "legacy",
            evidence: ["docs/prd.md"],
            children: [{ type: "prd", path: "docs/prd.md" }],
          },
        ],
      }),
    };

    render(<HarnessSettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "select-thinking" }));

    const bottomPanel = screen.getByTestId("harness-console-bottom-panel");
    expect(bottomPanel).not.toBeNull();
    expect(screen.getByTestId("selected-node-id").textContent).toBe("thinking");
    expect(within(bottomPanel).getByTestId("spec-sources-compact")).not.toBeNull();
  });

  it("does not crash when design decision data is missing sources during spec sources render", () => {
    currentSearchParams = new URLSearchParams("section=spec-sources");
    mockHarnessSettingsData.designDecisionsState = {
      loading: false,
      error: null,
      data: {
        generatedAt: "2026-03-30T00:00:00.000Z",
        repoRoot: "/Users/phodal/ai/routa-js",
        warnings: [],
      } as never,
    };
    mockHarnessSettingsData.specSourcesState = {
      loading: false,
      error: null,
      data: createSpecSourcesData({
        sources: [
          {
            kind: "framework",
            system: "bmad",
            rootPath: "docs",
            confidence: "low",
            status: "legacy",
            evidence: ["docs/prd.md"],
            children: [{ type: "prd", path: "docs/prd.md" }],
          },
        ],
      }),
    };

    render(<HarnessSettingsPage />);

    expect(screen.getByTestId("spec-sources-full")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Spec Sources/i })).not.toBeNull();
  });

  it("does not crash when automation data is missing definitions", () => {
    currentSearchParams = new URLSearchParams("section=automations");
    mockHarnessSettingsData.automationsState = {
      loading: false,
      error: null,
      data: {
        generatedAt: "2026-03-30T00:00:00.000Z",
        repoRoot: "/Users/phodal/ai/routa-js",
        warnings: [],
      } as never,
    };

    render(<HarnessSettingsPage />);

    expect(screen.getByTestId("automation-panel-full")).not.toBeNull();
  });

  it("passes the active repo context into the CI/CD section", () => {
    currentSearchParams = new URLSearchParams("section=ci-cd");
    mockHarnessSettingsData.githubActionsState = {
      loading: false,
      error: null,
      data: createGitHubActionsData({
        flows: [{ id: "ci", name: "CI", event: "push", yaml: "name: CI", jobs: [] }],
      }),
    };

    render(<HarnessSettingsPage />);

    const panel = screen.getByTestId("github-actions-flow-panel");
    expect(panel.getAttribute("data-repo-path")).toBe("/Users/phodal/ai/routa-js");
    expect(panel.getAttribute("data-flow-count")).toBe("1");
  });

  it("resizes the explorer pane via the drag handle", () => {
    render(<HarnessSettingsPage />);

    const explorer = screen.getByTestId("harness-console-explorer");
    const resizer = screen.getByTestId("harness-console-explorer-resizer");

    expect(explorer.getAttribute("style")).toContain("240px");

    fireEvent.mouseDown(resizer, { clientX: 240 });
    fireEvent.mouseMove(document, { clientX: 304 });
    fireEvent.mouseUp(document);

    expect(explorer.getAttribute("style")).toContain("304px");
  });

  it("shows the overview context panel inline without resize controls", () => {
    render(<HarnessSettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "select-thinking" }));

    const bottomPanel = screen.getByTestId("harness-console-bottom-panel");

    expect(bottomPanel.getAttribute("style")).toBeNull();
    expect(screen.queryByTestId("harness-console-bottom-resizer")).toBeNull();
  });
});
