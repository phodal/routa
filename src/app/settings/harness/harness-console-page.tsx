"use client";

import { useEffect, useMemo, useState } from "react";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { CodeViewer } from "@/client/components/codemirror/code-viewer";
import { RepoPicker, type RepoSelection } from "@/client/components/repo-picker";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import {
  HarnessExecutionPlanFlow,
  type TierValue,
} from "@/client/components/harness-execution-plan-flow";
import { HarnessAgentInstructionsPanel } from "@/client/components/harness-agent-instructions-panel";
import { HarnessDesignDecisionPanel } from "@/client/components/harness-design-decision-panel";
import { HarnessFitnessFilesDashboard } from "@/client/components/harness-fitness-files-dashboard";
import { HarnessGovernanceLoopGraph } from "@/client/components/harness-governance-loop-graph";
import { HarnessLifecycleView } from "@/client/components/harness-lifecycle-view";
import { HarnessGitHubActionsFlowPanel } from "@/client/components/harness-github-actions-flow-panel";
import { HarnessHookRuntimePanel } from "@/client/components/harness-hook-runtime-panel";
import { HarnessAgentHookPanel } from "@/client/components/harness-agent-hook-panel";
import { HarnessRepoSignalsPanel } from "@/client/components/harness-repo-signals-panel";
import { HarnessCodeownersPanel } from "@/client/components/harness-codeowners-panel";
import { HarnessReviewTriggersPanel } from "@/client/components/harness-review-triggers-panel";
import { HarnessReleaseTriggersPanel } from "@/client/components/harness-release-triggers-panel";
import { HarnessSpecSourcesPanel } from "@/client/components/harness-spec-sources-panel";
import {
  HarnessUnsupportedState,
  getHarnessUnsupportedRepoMessage,
} from "@/client/components/harness-support-state";
import { useHarnessSettingsData } from "@/client/hooks/use-harness-settings-data";
import { useCodebases, useWorkspaces } from "@/client/hooks/use-workspaces";
import { loadRepoSelection, saveRepoSelection } from "@/client/utils/repo-selection-storage";

type SectionId =
  | "overview"
  | "spec-sources"
  | "agent-instructions"
  | "design-decisions"
  | "repo-signals"
  | "hook-systems"
  | "review-triggers"
  | "release-triggers"
  | "codeowners"
  | "entrix-fitness"
  | "ci-cd";

interface SectionDef {
  id: SectionId;
  label: string;
  shortLabel: string;
  code: string;
}

type SectionStatusTone = "neutral" | "success" | "warning";

type SectionStatus = {
  label: string;
  tone?: SectionStatusTone;
};

const SECTIONS: SectionDef[] = [
  { id: "overview", label: "Overview", shortLabel: "Overview", code: "OV" },
  { id: "spec-sources", label: "Spec Sources", shortLabel: "Specs", code: "SP" },
  { id: "agent-instructions", label: "Agent Instructions", shortLabel: "Instructions", code: "AI" },
  { id: "design-decisions", label: "Design Decisions", shortLabel: "ADR", code: "DD" },
  { id: "repo-signals", label: "Repository Signals", shortLabel: "Signals", code: "RS" },
  { id: "hook-systems", label: "Hook Systems", shortLabel: "Hooks", code: "HK" },
  { id: "review-triggers", label: "Review Triggers", shortLabel: "Review", code: "RV" },
  { id: "release-triggers", label: "Release Triggers", shortLabel: "Release", code: "RL" },
  { id: "codeowners", label: "Codeowners", shortLabel: "Owners", code: "CO" },
  { id: "entrix-fitness", label: "Entrix Fitness", shortLabel: "Fitness", code: "FT" },
  { id: "ci-cd", label: "CI / CD", shortLabel: "CI/CD", code: "CI" },
];

const GOVERNANCE_NODE_SECTION_MAP: Partial<Record<string, SectionId>> = {
  thinking: "spec-sources",
  coding: "design-decisions",
  build: "agent-instructions",
  test: "repo-signals",
  lint: "entrix-fitness",
  precommit: "entrix-fitness",
  review: "review-triggers",
  release: "ci-cd",
  commit: "ci-cd",
  "post-commit": "ci-cd",
};

const DEFAULT_EXPLORER_WIDTH = 296;
const MIN_EXPLORER_WIDTH = 220;
const MAX_EXPLORER_WIDTH = 460;
const DEFAULT_BOTTOM_PANEL_HEIGHT = 280;
const MIN_BOTTOM_PANEL_HEIGHT = 180;
const MAX_BOTTOM_PANEL_HEIGHT = 520;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function extractMarkdownCodeBlocks(source: string) {
  const matches = [...source.matchAll(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g)];
  return matches.map((match, index) => ({
    id: `${match[1] || "text"}-${index}`,
    language: match[1] || "text",
    code: match[2]?.trim() ?? "",
  })).filter((block) => block.code.length > 0);
}

function sectionStatusClass(tone: SectionStatusTone = "neutral") {
  switch (tone) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-800";
    default:
      return "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary";
  }
}

export default function HarnessConsolePage() {
  const workspacesHook = useWorkspaces();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const workspaceId = selectedWorkspaceId || workspacesHook.workspaces[0]?.id || "";
  const { codebases } = useCodebases(workspaceId);
  const [selectedCodebaseId, setSelectedCodebaseId] = useState("");
  const [selectedRepoOverrideState, setSelectedRepoOverrideState] = useState<{
    workspaceId: string;
    selection: RepoSelection | null;
  }>({ workspaceId: "", selection: null });
  const [selectedTier, setSelectedTier] = useState<TierValue>("normal");
  const [selectedSpecName, setSelectedSpecName] = useState("");

  const persistedRepoSelection = useMemo(
    () => loadRepoSelection("harness", workspaceId),
    [workspaceId],
  );
  const selectedRepoOverride = selectedRepoOverrideState.workspaceId === workspaceId
    ? selectedRepoOverrideState.selection
    : null;
  const effectiveRepoOverride = selectedRepoOverride ?? persistedRepoSelection;

  const activeWorkspaceTitle = useMemo(() => {
    return workspacesHook.workspaces.find((workspace) => workspace.id === workspaceId)?.title
      ?? workspacesHook.workspaces[0]?.title
      ?? undefined;
  }, [workspaceId, workspacesHook.workspaces]);

  const activeCodebase = useMemo(() => {
    const effectiveCodebaseId = codebases.some((codebase) => codebase.id === selectedCodebaseId)
      ? selectedCodebaseId
      : (codebases.find((codebase) => codebase.isDefault)?.id ?? codebases[0]?.id ?? "");
    return codebases.find((codebase) => codebase.id === effectiveCodebaseId) ?? null;
  }, [codebases, selectedCodebaseId]);

  const matchedSelectedCodebase = useMemo(() => {
    if (!effectiveRepoOverride) {
      return activeCodebase;
    }
    return codebases.find((codebase) => (
      codebase.repoPath === effectiveRepoOverride.path
      && (effectiveRepoOverride.branch ? (codebase.branch ?? "") === effectiveRepoOverride.branch : true)
    )) ?? codebases.find((codebase) => codebase.repoPath === effectiveRepoOverride.path) ?? null;
  }, [activeCodebase, codebases, effectiveRepoOverride]);

  const activeRepoSelection = useMemo(() => {
    if (effectiveRepoOverride) {
      return effectiveRepoOverride;
    }
    if (!activeCodebase) {
      return null;
    }
    return {
      name: activeCodebase.label ?? activeCodebase.repoPath.split("/").pop() ?? activeCodebase.repoPath,
      path: activeCodebase.repoPath,
      branch: activeCodebase.branch ?? "",
    } satisfies RepoSelection;
  }, [activeCodebase, effectiveRepoOverride]);

  const activeRepoPath = activeRepoSelection?.path;
  const activeRepoCodebaseId = matchedSelectedCodebase?.id;

  const {
    specsState,
    planState,
    hooksState,
    agentHooksState,
    instructionsState,
    githubActionsState,
    specSourcesState,
    designDecisionsState,
    codeownersState,
    reloadInstructions,
  } = useHarnessSettingsData({
    workspaceId,
    codebaseId: activeRepoCodebaseId,
    repoPath: activeRepoPath,
    selectedTier,
  });

  const resolvedCodeownersState = useMemo(
    () => codeownersState ?? { loading: false, error: null, data: null },
    [codeownersState],
  );
  const specFiles = useMemo(() => specsState.data?.files ?? [], [specsState.data?.files]);

  const visibleSpec = useMemo(() => {
    if (specFiles.length === 0) {
      return null;
    }
    return specFiles.find((file) => file.name === selectedSpecName)
      ?? specFiles.find((file) => file.name.toLowerCase() === "readme.md")
      ?? specFiles.find((file) => file.kind === "dimension")
      ?? specFiles[0]
      ?? null;
  }, [selectedSpecName, specFiles]);

  const dimensionSpecs = specFiles.filter((file) => file.kind === "dimension");
  const primaryFiles = specFiles.filter((file) => file.kind === "rulebook" || file.kind === "manifest" || file.kind === "dimension");
  const auxiliaryFiles = specFiles.filter((file) => !primaryFiles.includes(file));
  const selectedRepoLabel = activeRepoSelection?.name ?? "None";
  const unsupportedRepoMessage = getHarnessUnsupportedRepoMessage(
    specsState.error,
    planState.error,
    designDecisionsState.error,
  );
  const hasArchitectureOrAdrSignal = useMemo(
    () => (designDecisionsState.data?.sources.length ?? 0) > 0,
    [designDecisionsState.data],
  );
  const visibleSpecCodeBlocks = useMemo(
    () => (visibleSpec && visibleSpec.language === "markdown" ? extractMarkdownCodeBlocks(visibleSpec.source) : []),
    [visibleSpec],
  );
  const hookCount = useMemo(
    () => (hooksState.data?.hookFiles?.length ?? 0) + (agentHooksState.data?.hooks?.length ?? 0),
    [hooksState.data?.hookFiles?.length, agentHooksState.data?.hooks?.length],
  );
  const workflowCount = useMemo(
    () => githubActionsState.data?.flows?.length ?? 0,
    [githubActionsState.data?.flows?.length],
  );

  useEffect(() => {
    saveRepoSelection("harness", workspaceId, activeRepoSelection);
  }, [activeRepoSelection, workspaceId]);

  const [activeSection, setActiveSection] = useState<SectionId>("overview");
  const [openTabs, setOpenTabs] = useState<SectionId[]>(["overview"]);
  const [governanceView, setGovernanceView] = useState<"lifecycle" | "loop">("lifecycle");
  const [selectedGovernanceNodeId, setSelectedGovernanceNodeId] = useState<string | null>(null);
  const [bottomPanelTab, setBottomPanelTab] = useState<"context" | "plan" | "fitness">("context");
  const [showBottomPanel, setShowBottomPanel] = useState(false);
  const [explorerWidth, setExplorerWidth] = useState(DEFAULT_EXPLORER_WIDTH);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(DEFAULT_BOTTOM_PANEL_HEIGHT);

  function openSection(id: SectionId) {
    setOpenTabs((current) => (current.includes(id) ? current : [...current, id]));
    setActiveSection(id);
  }

  function closeTab(id: SectionId) {
    const remaining: SectionId[] = openTabs.filter((tabId): tabId is SectionId => tabId !== id);
    const nextTabs: SectionId[] = remaining.length > 0 ? remaining : ["overview"];
    setOpenTabs(nextTabs);
    if (activeSection === id) {
      setActiveSection(nextTabs[nextTabs.length - 1] ?? "overview");
    }
  }

  function openBottomPanel(tab: "context" | "plan" | "fitness") {
    setBottomPanelTab(tab);
    setShowBottomPanel(true);
  }

  function handleGovernanceNodeClick(nodeId: string) {
    setSelectedGovernanceNodeId(nodeId);
    openBottomPanel("context");
  }

  function handleExplorerResizeStart(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = explorerWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setExplorerWidth(clamp(startWidth + deltaX, MIN_EXPLORER_WIDTH, MAX_EXPLORER_WIDTH));
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  function handleBottomPanelResizeStart(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = bottomPanelHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      setBottomPanelHeight(clamp(startHeight + deltaY, MIN_BOTTOM_PANEL_HEIGHT, MAX_BOTTOM_PANEL_HEIGHT));
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  const sectionStatuses = useMemo((): Map<SectionId, SectionStatus | null> => {
    const map = new Map<SectionId, SectionStatus | null>();
    map.set("spec-sources", specSourcesState.data ? { label: `${specSourcesState.data.sources?.length ?? 0} sources` } : null);
    map.set("agent-instructions", instructionsState.data ? { label: instructionsState.data.fileName, tone: instructionsState.data.fallbackUsed ? "warning" : "success" } : null);
    map.set("design-decisions", designDecisionsState.data ? { label: `${designDecisionsState.data.sources?.length ?? 0} docs` } : null);
    map.set("hook-systems", hookCount > 0 ? { label: `${hookCount} hooks` } : null);
    map.set("review-triggers", hooksState.data?.reviewTriggerFile ? { label: `${hooksState.data.reviewTriggerFile.ruleCount} rules` } : null);
    map.set("release-triggers", hooksState.data?.releaseTriggerFile ? { label: `${hooksState.data.releaseTriggerFile.ruleCount} rules` } : null);
    map.set("codeowners", resolvedCodeownersState.data
      ? {
          label: resolvedCodeownersState.data.codeownersFile ? "ready" : "missing",
          tone: resolvedCodeownersState.data.codeownersFile ? "success" : "warning",
        }
      : null);
    map.set("entrix-fitness", specFiles.length > 0 ? { label: `${dimensionSpecs.length}d / ${planState.data?.metricCount ?? 0}m` } : null);
    map.set("ci-cd", workflowCount > 0 ? { label: `${workflowCount} flows` } : null);
    return map;
  }, [
    designDecisionsState.data,
    dimensionSpecs.length,
    hookCount,
    hooksState.data,
    instructionsState.data,
    planState.data?.metricCount,
    resolvedCodeownersState.data,
    specFiles.length,
    specSourcesState.data,
    workflowCount,
  ]);

  const selectedGovernanceSection = selectedGovernanceNodeId
    ? (GOVERNANCE_NODE_SECTION_MAP[selectedGovernanceNodeId] ?? null)
    : null;

  const governanceContextPanel = useMemo(() => {
    if (selectedGovernanceNodeId === null) {
      return null;
    }
    const props = { repoLabel: selectedRepoLabel, unsupportedMessage: unsupportedRepoMessage };
    switch (selectedGovernanceNodeId) {
      case "thinking":
        return <HarnessSpecSourcesPanel {...props} data={specSourcesState.data} loading={specSourcesState.loading} error={specSourcesState.error} variant="compact" />;
      case "coding":
        return <HarnessDesignDecisionPanel {...props} data={designDecisionsState.data} loading={designDecisionsState.loading} error={designDecisionsState.error} variant="compact" />;
      case "build":
        return <HarnessAgentInstructionsPanel workspaceId={workspaceId} codebaseId={activeRepoCodebaseId} repoPath={activeRepoPath} {...props} data={instructionsState.data} loading={instructionsState.loading} error={instructionsState.error} onAuditRerun={reloadInstructions} variant="compact" />;
      case "lint":
      case "precommit":
        return <HarnessExecutionPlanFlow loading={planState.loading} error={planState.error} plan={planState.data} repoLabel={selectedRepoLabel} selectedTier={selectedTier} onTierChange={setSelectedTier} unsupportedMessage={unsupportedRepoMessage} variant="compact" />;
      case "test":
        return <HarnessRepoSignalsPanel workspaceId={workspaceId} codebaseId={activeRepoCodebaseId} repoPath={activeRepoPath} {...props} mode="test" variant="compact" />;
      case "release":
        return <HarnessGitHubActionsFlowPanel workspaceId={workspaceId} codebaseId={activeRepoCodebaseId} repoPath={activeRepoPath} {...props} data={githubActionsState.data} loading={githubActionsState.loading} error={githubActionsState.error} variant="compact" initialCategory="Release" />;
      case "review":
        return (
          <div className="space-y-3">
            <HarnessReviewTriggersPanel {...props} data={hooksState.data} loading={hooksState.loading} error={hooksState.error} variant="compact" />
            <HarnessReleaseTriggersPanel {...props} data={hooksState.data} loading={hooksState.loading} error={hooksState.error} variant="compact" />
            <HarnessCodeownersPanel {...props} data={resolvedCodeownersState.data} loading={resolvedCodeownersState.loading} error={resolvedCodeownersState.error} variant="compact" />
          </div>
        );
      case "commit":
      case "post-commit":
        return <HarnessGitHubActionsFlowPanel workspaceId={workspaceId} codebaseId={activeRepoCodebaseId} repoPath={activeRepoPath} {...props} data={githubActionsState.data} loading={githubActionsState.loading} error={githubActionsState.error} variant="compact" />;
      default:
        return <div className="p-3 text-[11px] text-desktop-text-secondary">选择 Lifecycle 节点查看对应组件的上下文视图。</div>;
    }
  }, [
    activeRepoCodebaseId,
    activeRepoPath,
    designDecisionsState.data,
    designDecisionsState.error,
    designDecisionsState.loading,
    githubActionsState.data,
    githubActionsState.error,
    githubActionsState.loading,
    hooksState.data,
    hooksState.error,
    hooksState.loading,
    instructionsState.data,
    instructionsState.error,
    instructionsState.loading,
    planState.data,
    planState.error,
    planState.loading,
    reloadInstructions,
    resolvedCodeownersState.data,
    resolvedCodeownersState.error,
    resolvedCodeownersState.loading,
    selectedGovernanceNodeId,
    selectedRepoLabel,
    selectedTier,
    specSourcesState.data,
    specSourcesState.error,
    specSourcesState.loading,
    unsupportedRepoMessage,
    workspaceId,
  ]);

  function renderFitnessDetailArea() {
    return (
      <div className="desktop-panel overflow-hidden">
        <div className="desktop-panel-header">
          <span>Fitness Sources</span>
          <span className="text-desktop-text-secondary">{specFiles.length} discovered</span>
        </div>
        <div className="grid gap-0 xl:grid-cols-[280px_minmax(0,1fr)]">
          <div className="min-w-0 border-r border-desktop-border bg-desktop-bg-secondary/40 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Discovery</div>
            <div className="space-y-1.5">
              {specsState.loading ? <div className="text-[10px] text-desktop-text-secondary">Loading fitness files...</div> : null}
              {unsupportedRepoMessage ? <HarnessUnsupportedState className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300" /> : null}
              {specsState.error && !unsupportedRepoMessage ? <div className="text-[10px] text-red-600 dark:text-red-400">{specsState.error}</div> : null}
              {!specsState.loading && !specsState.error && !unsupportedRepoMessage && specFiles.length === 0 ? <div className="text-[10px] text-desktop-text-secondary">No fitness files found.</div> : null}
              {!unsupportedRepoMessage ? primaryFiles.map((file) => (
                <button
                  key={file.name}
                  type="button"
                  onClick={() => setSelectedSpecName(file.name)}
                  className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors ${
                    visibleSpec?.name === file.name
                      ? "border-desktop-accent bg-desktop-bg-active text-desktop-text-primary"
                      : "border-transparent bg-desktop-bg-primary text-desktop-text-secondary hover:border-desktop-border hover:bg-desktop-bg-primary/80 hover:text-desktop-text-primary"
                  }`}
                >
                  <div className="text-[11px] font-medium">{file.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-current/75">
                    <span>{file.kind === "dimension" ? (file.dimension ?? "dimension") : file.kind}</span>
                    <span className="font-mono">{file.language}</span>
                    {file.metricCount > 0 ? <span className="ml-auto">{file.metricCount} metrics</span> : null}
                  </div>
                </button>
              )) : null}
              {!unsupportedRepoMessage && auxiliaryFiles.length > 0 ? (
                <details className="rounded-md border border-desktop-border bg-desktop-bg-primary/60 px-2.5 py-2">
                  <summary className="cursor-pointer text-[9px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Auxiliary ({auxiliaryFiles.length})</summary>
                  <div className="mt-2 space-y-1">
                    {auxiliaryFiles.map((file) => (
                      <button
                        key={file.name}
                        type="button"
                        onClick={() => setSelectedSpecName(file.name)}
                        className={`w-full rounded px-2 py-1 text-left text-[10px] transition-colors ${
                          visibleSpec?.name === file.name
                            ? "bg-desktop-bg-active text-desktop-text-primary"
                            : "text-desktop-text-secondary hover:bg-desktop-bg-primary hover:text-desktop-text-primary"
                        }`}
                      >
                        {file.name}
                      </button>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          </div>

          <div className="min-w-0 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Source View</div>
                <div className="mt-1 text-sm font-semibold text-desktop-text-primary">{visibleSpec?.name ?? "Select a file"}</div>
              </div>
              {visibleSpec?.kind === "dimension" ? (
                <div className="flex flex-wrap gap-1.5 text-[9px]">
                  <span className="desktop-badge">w:{visibleSpec.weight ?? 0}</span>
                  <span className="desktop-badge desktop-badge-success">pass:{visibleSpec.thresholdPass ?? 90}</span>
                  <span className="desktop-badge desktop-badge-warning">warn:{visibleSpec.thresholdWarn ?? 80}</span>
                </div>
              ) : null}
            </div>

            {unsupportedRepoMessage ? (
              <div className="mt-3">
                <HarnessUnsupportedState />
              </div>
            ) : visibleSpec ? (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center gap-1.5 text-[9px] text-desktop-text-secondary">
                  <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5">{visibleSpec.kind}</span>
                  <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5">{visibleSpec.language}</span>
                  <span className="font-mono text-desktop-text-primary">{visibleSpec.relativePath}</span>
                </div>

                {visibleSpec.kind === "dimension" && visibleSpec.frontmatterSource ? (
                  <details className="rounded-md border border-desktop-border bg-desktop-bg-secondary/50 p-2.5">
                    <summary className="cursor-pointer text-[9px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Frontmatter</summary>
                    <div className="mt-2">
                      <CodeViewer
                        code={visibleSpec.frontmatterSource}
                        filename={`${visibleSpec.name}.frontmatter.yaml`}
                        language="yaml"
                        maxHeight="200px"
                        showHeader={false}
                        wordWrap
                      />
                    </div>
                  </details>
                ) : null}

                {visibleSpec.language === "yaml" ? (
                  <CodeViewer
                    code={visibleSpec.source}
                    filename={visibleSpec.name}
                    language="yaml"
                    maxHeight="320px"
                    showHeader={false}
                    wordWrap
                  />
                ) : null}

                {visibleSpec.language === "markdown" && visibleSpec.kind !== "dimension" ? (
                  visibleSpecCodeBlocks.length > 0 ? (
                    <div className="space-y-2">
                      {visibleSpecCodeBlocks.map((block) => (
                        <CodeViewer
                          key={block.id}
                          code={block.code}
                          filename={`${visibleSpec.name}.${block.language || "txt"}`}
                          maxHeight="200px"
                          showHeader={false}
                          wordWrap
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-desktop-text-secondary">No command blocks found in this markdown file.</div>
                  )
                ) : null}

                {visibleSpec.kind === "dimension" ? (
                  <div className="overflow-hidden rounded-md border border-desktop-border">
                    <div className="grid grid-cols-[minmax(0,1.5fr)_auto] gap-2 border-b border-desktop-border bg-desktop-bg-secondary px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
                      <div>Metric</div>
                      <div>Dispatch</div>
                    </div>
                    {visibleSpec.metrics.map((metric) => (
                      <div key={metric.name} className="grid grid-cols-[minmax(0,1.5fr)_auto] gap-2 border-t border-desktop-border px-3 py-2.5 first:border-t-0">
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold text-desktop-text-primary">{metric.name}</div>
                          <div className="mt-1 break-all font-mono text-[9px] text-desktop-text-secondary">{metric.command || "No command"}</div>
                          {metric.description ? <div className="mt-1 text-[10px] text-desktop-text-secondary">{metric.description}</div> : null}
                        </div>
                        <div className="flex flex-wrap content-start justify-end gap-1 text-[9px]">
                          <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5 text-desktop-text-secondary">{metric.runner}</span>
                          <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5 text-desktop-text-secondary">{metric.tier}</span>
                          <span className={`rounded-full border px-2 py-0.5 ${metric.hardGate ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400" : "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary"}`}>
                            {metric.gate}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-3 text-[11px] text-desktop-text-secondary">Select a fitness file to inspect.</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderOverview() {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-desktop-border pb-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
            {governanceView === "lifecycle" ? "Lifecycle View" : "Governance Loop"}
          </div>
          <div className="inline-flex items-center gap-0.5 rounded border border-desktop-border bg-desktop-bg-primary p-0.5 normal-case tracking-normal">
            {(["lifecycle", "loop"] as const).map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => setGovernanceView(view)}
                className={`rounded px-2.5 py-1 text-[10px] font-medium ${
                  governanceView === view
                    ? "bg-desktop-accent text-desktop-accent-text"
                    : "text-desktop-text-secondary hover:bg-desktop-bg-active hover:text-desktop-text-primary"
                }`}
              >
                {view === "lifecycle" ? "Lifecycle" : "Loop"}
              </button>
            ))}
          </div>
        </div>
        {governanceView === "lifecycle" ? (
          <HarnessLifecycleView
            selectedNodeId={selectedGovernanceNodeId}
            onSelectedNodeChange={handleGovernanceNodeClick}
            contextPanel={null}
            designDecisionNodeEnabled={hasArchitectureOrAdrSignal}
          />
        ) : (
          <HarnessGovernanceLoopGraph
            repoPath={activeRepoPath}
            selectedTier={selectedTier}
            specsError={specsState.error}
            dimensionCount={dimensionSpecs.length}
            planError={planState.error}
            metricCount={planState.data?.metricCount ?? 0}
            hardGateCount={planState.data?.hardGateCount ?? 0}
            unsupportedMessage={unsupportedRepoMessage}
            hooksData={hooksState.data}
            hooksError={hooksState.error}
            workflowData={githubActionsState.data}
            workflowError={githubActionsState.error}
            instructionsData={instructionsState.data}
            instructionsError={instructionsState.error}
            fitnessFiles={specFiles}
            designDecisionNodeEnabled={hasArchitectureOrAdrSignal}
            selectedNodeId={selectedGovernanceNodeId}
            onSelectedNodeChange={handleGovernanceNodeClick}
            contextPanel={null}
          />
        )}
      </div>
    );
  }

  function renderSectionContent(sectionId: SectionId) {
    const sharedProps = {
      repoLabel: selectedRepoLabel,
      unsupportedMessage: unsupportedRepoMessage,
    };

    switch (sectionId) {
      case "overview":
        return renderOverview();
      case "spec-sources":
        return <HarnessSpecSourcesPanel {...sharedProps} data={specSourcesState.data} loading={specSourcesState.loading} error={specSourcesState.error} />;
      case "agent-instructions":
        return <HarnessAgentInstructionsPanel workspaceId={workspaceId} codebaseId={activeRepoCodebaseId} repoPath={activeRepoPath} {...sharedProps} data={instructionsState.data} loading={instructionsState.loading} error={instructionsState.error} onAuditRerun={reloadInstructions} />;
      case "design-decisions":
        return <HarnessDesignDecisionPanel {...sharedProps} data={designDecisionsState.data} loading={designDecisionsState.loading} error={designDecisionsState.error} />;
      case "repo-signals":
        return <HarnessRepoSignalsPanel workspaceId={workspaceId} codebaseId={activeRepoCodebaseId} repoPath={activeRepoPath} {...sharedProps} mode="test" />;
      case "hook-systems":
        return (
          <div className="space-y-4">
            <HarnessHookRuntimePanel workspaceId={workspaceId} codebaseId={activeRepoCodebaseId} repoPath={activeRepoPath} {...sharedProps} data={hooksState.data} loading={hooksState.loading} error={hooksState.error} embedded />
            <HarnessAgentHookPanel workspaceId={workspaceId} codebaseId={activeRepoCodebaseId} repoPath={activeRepoPath} {...sharedProps} data={agentHooksState.data} loading={agentHooksState.loading} error={agentHooksState.error} embedded />
          </div>
        );
      case "review-triggers":
        return <HarnessReviewTriggersPanel {...sharedProps} data={hooksState.data} loading={hooksState.loading} error={hooksState.error} />;
      case "release-triggers":
        return <HarnessReleaseTriggersPanel {...sharedProps} data={hooksState.data} loading={hooksState.loading} error={hooksState.error} />;
      case "codeowners":
        return <HarnessCodeownersPanel {...sharedProps} data={resolvedCodeownersState.data} loading={resolvedCodeownersState.loading} error={resolvedCodeownersState.error} />;
      case "entrix-fitness":
        return (
          <div className="space-y-4">
            <HarnessFitnessFilesDashboard
              specFiles={specFiles}
              selectedSpec={visibleSpec}
              loading={specsState.loading}
              error={specsState.error}
              unsupportedMessage={unsupportedRepoMessage}
              embedded
            />
            {renderFitnessDetailArea()}
            <HarnessExecutionPlanFlow
              loading={planState.loading}
              error={planState.error}
              plan={planState.data}
              repoLabel={selectedRepoLabel}
              selectedTier={selectedTier}
              onTierChange={setSelectedTier}
              unsupportedMessage={unsupportedRepoMessage}
              embedded
            />
          </div>
        );
      case "ci-cd":
        return <HarnessGitHubActionsFlowPanel workspaceId={workspaceId} codebaseId={activeRepoCodebaseId} repoPath={activeRepoPath} {...sharedProps} data={githubActionsState.data} loading={githubActionsState.loading} error={githubActionsState.error} />;
      default:
        return null;
    }
  }

  const titleBarRight = (
    <div className="flex items-center gap-2">
      <RepoPicker
        value={activeRepoSelection}
        onChange={(selection) => {
          setSelectedRepoOverrideState({ workspaceId, selection });
          if (!selection) {
            setSelectedCodebaseId("");
            return;
          }
          const matchedCodebase = codebases.find((codebase) => (
            codebase.repoPath === selection.path
            && (selection.branch ? (codebase.branch ?? "") === selection.branch : true)
          )) ?? codebases.find((codebase) => codebase.repoPath === selection.path)
            ?? codebases.find((codebase) => (
              (codebase.label ?? codebase.repoPath.split("/").pop() ?? codebase.repoPath) === selection.name
            ));
          setSelectedCodebaseId(matchedCodebase?.id ?? "");
        }}
        pathDisplay="hidden"
        additionalRepos={codebases.map((codebase) => ({
          name: codebase.label ?? codebase.repoPath.split("/").pop() ?? codebase.repoPath,
          path: codebase.repoPath,
          branch: codebase.branch ?? "",
        }))}
      />
      <button type="button" className="desktop-btn desktop-btn-secondary" onClick={() => openBottomPanel("plan")}>Plan</button>
      <button type="button" className="desktop-btn desktop-btn-secondary" onClick={() => openBottomPanel("fitness")}>Fitness</button>
    </div>
  );

  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceTitle={activeWorkspaceTitle}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspacesHook.workspaces}
          activeWorkspaceId={workspaceId || null}
          activeWorkspaceTitle={activeWorkspaceTitle}
          onSelect={(nextWorkspaceId) => {
            setSelectedWorkspaceId(nextWorkspaceId);
            setSelectedRepoOverrideState({ workspaceId: nextWorkspaceId, selection: null });
            setSelectedCodebaseId("");
          }}
          onCreate={async (title) => {
            const workspace = await workspacesHook.createWorkspace(title);
            if (workspace) {
              setSelectedWorkspaceId(workspace.id);
              setSelectedRepoOverrideState({ workspaceId: workspace.id, selection: null });
              setSelectedCodebaseId("");
            }
          }}
          loading={workspacesHook.loading}
          compact
          desktop
        />
      )}
      titleBarRight={titleBarRight}
    >
      <div className="flex h-full min-h-0 overflow-hidden bg-desktop-bg-primary text-desktop-text-primary" data-testid="harness-console-root">
        <aside
          className="flex shrink-0 flex-col border-r border-desktop-border bg-desktop-bg-secondary"
          data-testid="harness-console-explorer"
          style={{ width: `${explorerWidth}px` }}
        >
          <div className="border-b border-desktop-border px-3 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Explorer</div>
            <div className="mt-1 truncate text-[11px] text-desktop-text-secondary">{selectedRepoLabel}</div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-2 desktop-scrollbar-thin">
            <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Sections</div>
            <div className="space-y-1">
              {SECTIONS.map((section) => {
                const isActive = activeSection === section.id;
                const status = sectionStatuses.get(section.id) ?? null;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => openSection(section.id)}
                    className={`desktop-list-item w-full rounded-md border text-left ${
                      isActive
                        ? "active border-desktop-border"
                        : "border-transparent"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-desktop-text-primary">{section.label}</span>
                    {status ? (
                      <span className={`ml-2 shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-medium ${sectionStatusClass(status.tone)}`}>
                        {status.label}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <div
          role="separator"
          aria-label="Resize explorer"
          data-testid="harness-console-explorer-resizer"
          className="w-1 shrink-0 cursor-col-resize bg-desktop-border/60 transition-colors hover:bg-desktop-accent"
          onMouseDown={handleExplorerResizeStart}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-desktop-border bg-desktop-bg-secondary px-2">
            <div className="flex h-full items-center overflow-x-auto desktop-scrollbar-thin" data-testid="harness-console-tabs">
              {openTabs.map((tabId) => {
                const section = SECTIONS.find((item) => item.id === tabId);
                if (!section) {
                  return null;
                }
                const isActive = activeSection === tabId;
                return (
                  <div key={tabId} className={`group flex h-full shrink-0 items-center border-r border-desktop-border ${isActive ? "bg-desktop-bg-primary" : "bg-desktop-bg-secondary"}`}>
                    <button
                      type="button"
                      onClick={() => setActiveSection(tabId)}
                      className={`h-full border-b-2 px-3 text-[11px] font-medium ${isActive ? "border-desktop-accent text-desktop-text-primary" : "border-transparent text-desktop-text-secondary hover:bg-desktop-bg-active/70 hover:text-desktop-text-primary"}`}
                    >
                      {section.shortLabel}
                    </button>
                    {tabId !== "overview" ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          closeTab(tabId);
                        }}
                        className="mr-1 rounded px-1 py-0.5 text-[10px] text-desktop-text-secondary opacity-0 transition-opacity hover:bg-desktop-bg-active hover:text-desktop-text-primary group-hover:opacity-100"
                      >
                        x
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>

          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-desktop-bg-primary p-4 desktop-scrollbar">
            {renderSectionContent(activeSection)}
          </div>

          {showBottomPanel ? (
            <>
              <div
                role="separator"
                aria-label="Resize bottom panel"
                data-testid="harness-console-bottom-resizer"
                className="h-1 shrink-0 cursor-row-resize bg-desktop-border/60 transition-colors hover:bg-desktop-accent"
                onMouseDown={handleBottomPanelResizeStart}
              />
              <div
                className="flex shrink-0 flex-col border-t border-desktop-border bg-desktop-bg-secondary"
                data-testid="harness-console-bottom-panel"
                style={{ height: `${bottomPanelHeight}px` }}
              >
              <div className="flex h-9 items-center justify-between border-b border-desktop-border px-3">
                <div className="flex items-center gap-1">
                  {(["context", "plan", "fitness"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setBottomPanelTab(tab)}
                      className={`rounded px-2.5 py-1 text-[10px] font-medium ${
                        bottomPanelTab === tab
                          ? "bg-desktop-accent text-desktop-accent-text"
                          : "text-desktop-text-secondary hover:bg-desktop-bg-active hover:text-desktop-text-primary"
                      }`}
                    >
                      {tab === "context" ? "Context" : tab === "plan" ? "Execution Plan" : "Fitness"}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 text-[10px] text-desktop-text-secondary">
                  {selectedGovernanceNodeId ? <span>node: {selectedGovernanceNodeId}</span> : null}
                  {selectedGovernanceSection ? (
                    <button
                      type="button"
                      className="desktop-btn desktop-btn-secondary"
                      onClick={() => openSection(selectedGovernanceSection)}
                    >
                      Open full view
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="desktop-btn desktop-btn-secondary"
                    onClick={() => setShowBottomPanel(false)}
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3 desktop-scrollbar-thin">
                {bottomPanelTab === "context" ? governanceContextPanel : null}
                {bottomPanelTab === "plan" ? (
                  <HarnessExecutionPlanFlow
                    loading={planState.loading}
                    error={planState.error}
                    plan={planState.data}
                    repoLabel={selectedRepoLabel}
                    selectedTier={selectedTier}
                    onTierChange={setSelectedTier}
                    unsupportedMessage={unsupportedRepoMessage}
                    variant="compact"
                  />
                ) : null}
                {bottomPanelTab === "fitness" ? (
                  <HarnessFitnessFilesDashboard
                    specFiles={specFiles}
                    selectedSpec={visibleSpec}
                    loading={specsState.loading}
                    error={specsState.error}
                    unsupportedMessage={unsupportedRepoMessage}
                    embedded
                  />
                ) : null}
              </div>
              </div>
            </>
          ) : null}

          <div className="flex h-6 shrink-0 items-center justify-between bg-desktop-accent px-3 text-[10px] text-desktop-accent-text">
            <div className="flex items-center gap-3">
              <span>{activeWorkspaceTitle ?? "-"}</span>
            </div>
            <div className="flex items-center gap-3">
              <span>{hookCount} hooks</span>
              <span>{workflowCount} workflows</span>
            </div>
          </div>
        </div>
      </div>
    </DesktopAppShell>
  );
}
