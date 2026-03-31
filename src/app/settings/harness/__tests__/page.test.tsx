import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SpecDetectionResponse } from "@/core/harness/spec-detector-types";
import HarnessSettingsPage from "../page";

const repoPickerMock = vi.fn();
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
          artifacts: [
            {
              id: "architecture-top-level",
              title: "Top-level architecture contract",
              path: "docs/ARCHITECTURE.md",
              type: "architecture",
              status: "canonical",
              summary: "Canonical architecture overview for runtime boundaries and invariants.",
              codeRefs: ["Workspace-first scope over hidden global state"],
            },
          ],
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
    },
  },
  githubActionsState: {
    loading: false,
    error: null,
    data: {
      flows: [],
    },
  },
  specSourcesState: {
    loading: false,
    error: null,
    data: createSpecSourcesData(),
  },
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

vi.mock("@/client/components/settings-route-shell", () => ({
  SettingsRouteShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="settings-route-shell">{children}</div>
  ),
}));

vi.mock("@/client/components/settings-page-header", () => ({
  SettingsPageHeader: ({ extra }: { extra?: ReactNode }) => (
    <div data-testid="settings-page-header">
      {extra}
    </div>
  ),
}));

vi.mock("@/client/components/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />,
}));

vi.mock("@/client/components/codemirror/code-viewer", () => ({
  CodeViewer: ({ value }: { value: string }) => <pre data-testid="code-viewer">{value}</pre>,
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
  HarnessAgentInstructionsPanel: ({
    variant = "full",
    onAuditRerun,
  }: {
    variant?: "full" | "compact";
    onAuditRerun?: () => void;
  }) => (
    <div data-testid={`instruction-panel-${variant}`}>
      <span>Instruction file - CLAUDE.md</span>
      {onAuditRerun ? (
        <button type="button" onClick={onAuditRerun}>
          rerun-audit-{variant}
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock("@/client/components/harness-fitness-files-dashboard", () => ({
  HarnessFitnessFilesDashboard: () => <div data-testid="fitness-files-dashboard" />,
}));

vi.mock("@/client/components/harness-governance-loop-graph", () => ({
  HarnessGovernanceLoopGraph: ({
    contextPanel,
    selectedNodeId,
    onSelectedNodeChange,
  }: {
    contextPanel?: ReactNode;
    selectedNodeId?: string | null;
    onSelectedNodeChange?: (nodeId: string) => void;
  }) => (
    <div data-testid="governance-loop-graph">
      <div data-testid="selected-node-id">{selectedNodeId}</div>
      <div data-testid="context-panel-state">{contextPanel ? "present" : "absent"}</div>
      <button type="button" onClick={() => onSelectedNodeChange?.("thinking")}>select-thinking</button>
      <button type="button" onClick={() => onSelectedNodeChange?.("release")}>select-release</button>
      {contextPanel}
    </div>
  ),
}));

vi.mock("@/client/components/harness-github-actions-flow-panel", () => ({
  HarnessGitHubActionsFlowPanel: ({ initialCategory }: { initialCategory?: "Validation" | "Release" | "Automation" | "Maintenance" }) => (
    <div data-testid="github-actions-flow-panel">{initialCategory ?? "default"}</div>
  ),
}));

vi.mock("@/client/components/harness-hook-runtime-panel", () => ({
  HarnessHookRuntimePanel: () => <div data-testid="hook-runtime-panel" />,
}));

vi.mock("@/client/components/harness-agent-hook-panel", () => ({
  HarnessAgentHookPanel: ({ variant = "full" }: { variant?: "full" | "compact" }) => (
    <div data-testid={`agent-hook-panel-${variant}`}>Hook systems</div>
  ),
}));

vi.mock("@/client/components/harness-repo-signals-panel", () => ({
  HarnessRepoSignalsPanel: () => <div data-testid="repo-signals-panel" />,
}));

vi.mock("@/client/components/harness-review-triggers-panel", () => ({
  HarnessReviewTriggersPanel: () => <div data-testid="review-triggers-panel" />,
}));

vi.mock("@/client/components/harness-spec-sources-panel", () => ({
  HarnessSpecSourcesPanel: (props: { variant?: string }) => (
    <div data-testid={props.variant === "compact" ? "spec-sources-compact" : "spec-sources-full"} />
  ),
}));

vi.mock("@/client/components/harness-support-state", () => ({
  HarnessUnsupportedState: () => <div data-testid="unsupported-state" />,
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
  }),
  useCodebases: () => ({
    codebases: [
      {
        id: "cb-1",
        label: "phodal/routa",
        repoPath: "/Users/phodal/ai/routa-js",
        branch: "main",
      },
    ],
    fetchCodebases: vi.fn(async () => {}),
  }),
}));

vi.mock("@/client/hooks/use-harness-settings-data", () => ({
  useHarnessSettingsData: () => mockHarnessSettingsData,
}));

describe("HarnessSettingsPage", () => {
  beforeEach(() => {
    repoPickerMock.mockReset();
    window.localStorage.clear();
    mockHarnessSettingsData.reloadInstructions.mockClear();
    mockHarnessSettingsData.specSourcesState = {
      loading: false,
      error: null,
      data: createSpecSourcesData(),
    };
  });

  it("defaults the governance loop to overview mode without rendering a compact context panel", async () => {
    const { findByTestId } = render(<HarnessSettingsPage />);

    // Wait for initial node selection to resolve
    await findByTestId("selected-node-id");

    expect(screen.getByTestId("selected-node-id").textContent).toBe("");
    expect(screen.getByTestId("context-panel-state").textContent).toBe("absent");
    expect(screen.getAllByText("Instruction file - CLAUDE.md")).toHaveLength(1);
    expect(screen.getByTestId("instruction-panel-full")).not.toBeNull();
    expect(screen.queryByTestId("instruction-panel-compact")).toBeNull();
  });

  it("wires the instruction audit rerun action to harness data reload", () => {
    render(<HarnessSettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "rerun-audit-full" }));

    expect(mockHarnessSettingsData.reloadInstructions).toHaveBeenCalledTimes(1);
  });

  it("switches the governance context to the release GitHub Actions view", () => {
    render(<HarnessSettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "select-release" }));

    expect(screen.getByTestId("selected-node-id").textContent).toBe("release");
    expect(screen.getByTestId("context-panel-state").textContent).toBe("present");
    expect(within(screen.getByTestId("governance-loop-graph")).getByTestId("github-actions-flow-panel").textContent).toBe("Release");
  });

  it("renders the compact spec sources panel for the thinking node while keeping the full panel visible", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "select-thinking" }));

    expect(screen.getByTestId("selected-node-id").textContent).toBe("thinking");
    expect(within(screen.getByTestId("governance-loop-graph")).getByTestId("spec-sources-compact")).not.toBeNull();
    expect(screen.getByTestId("spec-sources-full")).not.toBeNull();
  });

  it("renders the test feedback loop panel in the main layout", () => {
    render(<HarnessSettingsPage />);

    expect(screen.getByTestId("repo-signals-panel")).not.toBeNull();
  });

  it("defaults the fitness source view to README when no spec is selected", () => {
    render(<HarnessSettingsPage />);

    expect(screen.getByRole("heading", { name: "README.md" })).not.toBeNull();
    expect(screen.getByText(/Entrix loader skips README/i)).not.toBeNull();
  });

  it("persists the selected local repository for the workspace", () => {
    const { unmount } = render(<HarnessSettingsPage />);

    fireEvent.click(screen.getByTestId("repo-picker"));

    expect(window.localStorage.getItem("routa.repoSelection.harness.default")).toContain("/Users/phodal/ai/codex");

    unmount();
    render(<HarnessSettingsPage />);

    expect(screen.getByTestId("repo-picker").textContent).toBe("/Users/phodal/ai/codex");
  });
});
