"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "@/i18n";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { CodeViewer } from "@/client/components/codemirror/code-viewer";
import { RepoPicker, type RepoSelection } from "@/client/components/repo-picker";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import {
  HarnessExecutionPlanFlow,
  type TierValue,
} from "@/client/components/harness-execution-plan-flow";
import { HarnessAgentInstructionsPanel } from "@/client/components/harness-agent-instructions-panel";
import { HarnessArchitectureQualityPanel } from "@/client/components/harness-architecture-quality-panel";
import { HarnessAutomationPanel } from "@/client/components/harness-automation-panel";
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
import { SpecBoardPanel } from "@/app/workspace/[workspaceId]/spec/spec-page-client";
import { useHarnessSettingsData } from "@/client/hooks/use-harness-settings-data";
import { useCodebases, useWorkspaces } from "@/client/hooks/use-workspaces";
import { loadRepoSelection, saveRepoSelection } from "@/client/utils/repo-selection-storage";
import { normalizeWorkspaceQueryId, resolveWorkspaceSelection } from "@/client/utils/workspace-id";

type SectionId =
  | "overview"
  | "spec"
  | "architecture-quality"
  | "spec-sources"
  | "agent-instructions"
  | "design-decisions"
  | "repo-signals"
  | "automations"
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
  group?: "intent" | "control" | "flow" | "signal";
}

type SectionStatusTone = "neutral" | "success" | "warning";

type SectionStatus = {
  label: string;
  tone?: SectionStatusTone;
};

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

const DEFAULT_EXPLORER_WIDTH = 240;
const MIN_EXPLORER_WIDTH = 220;
const MAX_EXPLORER_WIDTH = 460;
const DEFAULT_BOTTOM_PANEL_HEIGHT = 280;
const MIN_BOTTOM_PANEL_HEIGHT = 180;
const MAX_BOTTOM_PANEL_HEIGHT = 520;
const HARNESS_SECTION_QUERY_KEY = "section";
const DEFAULT_SECTION: SectionId = "overview";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function resolveSectionId(value: string | null | undefined): SectionId {
  switch (value) {
    case "spec":
    case "architecture-quality":
    case "spec-sources":
    case "agent-instructions":
    case "design-decisions":
    case "repo-signals":
    case "automations":
    case "hook-systems":
    case "review-triggers":
    case "release-triggers":
    case "codeowners":
    case "entrix-fitness":
    case "ci-cd":
      return value;
    case "overview":
    default:
      return DEFAULT_SECTION;
  }
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
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspacesHook = useWorkspaces();
  const sectionFromUrl = resolveSectionId(searchParams.get(HARNESS_SECTION_QUERY_KEY));
  const architectureSectionActive = sectionFromUrl === "architecture-quality";
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const urlWorkspaceId = normalizeWorkspaceQueryId(searchParams.get("workspaceId"));
  const workspaceId = resolveWorkspaceSelection(
    selectedWorkspaceId,
    urlWorkspaceId,
    workspacesHook.workspaces,
  );
  const { codebases } = useCodebases(workspaceId);
  const [selectedCodebaseId, setSelectedCodebaseId] = useState("");
  const [selectedRepoOverrideState, setSelectedRepoOverrideState] = useState<{
    workspaceId: string;
    selection: RepoSelection | null;
  }>({ workspaceId: "", selection: null });
  const [selectedTier, setSelectedTier] = useState<TierValue>("normal");
  const [selectedSpecName, setSelectedSpecName] = useState("");

  const rawPersistedRepoSelection = useMemo(
    () => loadRepoSelection("harness", workspaceId),
    [workspaceId],
  );

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

  const persistedRepoSelection = useMemo(() => {
    if (!rawPersistedRepoSelection) {
      return null;
    }
    if (
      activeCodebase
      && rawPersistedRepoSelection.path === activeCodebase.repoPath
      && rawPersistedRepoSelection.branch === (activeCodebase.branch ?? "")
    ) {
      return null;
    }
    return rawPersistedRepoSelection;
  }, [activeCodebase, rawPersistedRepoSelection]);

  const selectedRepoOverride = selectedRepoOverrideState.workspaceId === workspaceId
    ? selectedRepoOverrideState.selection
    : null;
  const effectiveRepoOverride = selectedRepoOverride ?? persistedRepoSelection;

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
  const activeRepoCodebaseId = effectiveRepoOverride ? matchedSelectedCodebase?.id : activeCodebase?.id;
  const {
    specsState,
    planState,
    architectureState,
    hooksState,
    agentHooksState,
    instructionsState,
    githubActionsState,
    specSourcesState,
    designDecisionsState,
    codeownersState,
    automationsState,
    reloadArchitecture,
    reloadInstructions,
  } = useHarnessSettingsData({
    workspaceId,
    codebaseId: activeRepoCodebaseId,
    repoPath: activeRepoPath,
    selectedTier,
    enableArchitecture: architectureSectionActive,
    preferCurrentRepoForArchitecture: workspaceId === "default" && !effectiveRepoOverride,
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
    () => (designDecisionsState.data?.sources?.length ?? 0) > 0,
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
  const automationRuleCount = useMemo(
    () => automationsState.data?.definitions?.length ?? 0,
    [automationsState.data?.definitions?.length],
  );

  useEffect(() => {
    if (selectedRepoOverrideState.workspaceId !== workspaceId) {
      return;
    }
    saveRepoSelection("harness", workspaceId, selectedRepoOverrideState.selection);
  }, [selectedRepoOverrideState, workspaceId]);

  const [openTabs, setOpenTabs] = useState<SectionId[]>(
    sectionFromUrl === DEFAULT_SECTION ? [DEFAULT_SECTION] : [DEFAULT_SECTION, sectionFromUrl],
  );
  const [governanceView, setGovernanceView] = useState<"lifecycle" | "loop">("lifecycle");
  const [selectedGovernanceNodeId, setSelectedGovernanceNodeId] = useState<string | null>(null);
  const [bottomPanelTab, setBottomPanelTab] = useState<"context" | "plan" | "fitness">("context");
  const [showBottomPanel, setShowBottomPanel] = useState(false);
  const [explorerWidth, setExplorerWidth] = useState(DEFAULT_EXPLORER_WIDTH);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(DEFAULT_BOTTOM_PANEL_HEIGHT);

  const activeSection = sectionFromUrl;
  const showSectionTabs = activeSection !== "spec";
  const visibleTabs = useMemo(() => (
    openTabs.includes(activeSection) ? openTabs : [...openTabs, activeSection]
  ), [activeSection, openTabs]);

  const replaceSectionInUrl = useCallback((id: SectionId) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(HARNESS_SECTION_QUERY_KEY, id);
    const next = params.toString();
    router.replace(next ? `/settings/harness?${next}` : "/settings/harness");
  }, [router, searchParams]);

  function openSection(id: SectionId) {
    setOpenTabs((current) => (current.includes(id) ? current : [...current, id]));
    replaceSectionInUrl(id);
  }

  function closeTab(id: SectionId) {
    const remaining: SectionId[] = visibleTabs.filter((tabId): tabId is SectionId => tabId !== id);
    const nextTabs: SectionId[] = remaining.length > 0 ? remaining : ["overview"];
    setOpenTabs(nextTabs);
    if (activeSection === id) {
      const nextSection = nextTabs[nextTabs.length - 1] ?? DEFAULT_SECTION;
      replaceSectionInUrl(nextSection);
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
    const resizeInlinePanel = activeSection === "overview";

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = resizeInlinePanel
        ? moveEvent.clientY - startY
        : startY - moveEvent.clientY;
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
    map.set("architecture-quality", architectureState.data
      ? {
          label: `${architectureState.data.failedRuleCount}/${architectureState.data.ruleCount} rules`,
          tone: architectureState.data.summaryStatus === "fail" ? "warning" : "success",
        }
      : null);
    map.set("spec-sources", specSourcesState.data ? { label: `${specSourcesState.data.sources?.length ?? 0} sources` } : null);
    map.set("agent-instructions", instructionsState.data ? { label: instructionsState.data.fileName, tone: instructionsState.data.fallbackUsed ? "warning" : "success" } : null);
    map.set("design-decisions", designDecisionsState.data ? { label: `${designDecisionsState.data.sources?.length ?? 0} docs` } : null);
    map.set("automations", automationsState.data ? { label: `${automationRuleCount} rules` } : null);
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
    automationsState.data,
    designDecisionsState.data,
    automationRuleCount,
    architectureState.data,
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

  const sections = useMemo((): SectionDef[] => [
    { id: "overview", label: t.settings.harness.overview, shortLabel: "Overview", code: "OV" },
    { id: "spec", label: t.nav.spec, shortLabel: t.nav.spec, code: "IB", group: "intent" },
    {
      id: "architecture-quality",
      label: t.settings.harness.architectureQuality.title,
      shortLabel: t.settings.harness.architectureQuality.navigationLabel,
      code: "AQ",
      group: "signal",
    },
    { id: "spec-sources", label: t.settings.harness.specSources, shortLabel: "Specs", code: "SP", group: "intent" },
    { id: "agent-instructions", label: t.settings.harness.agentInstructions, shortLabel: "Instructions", code: "AI", group: "intent" },
    { id: "design-decisions", label: t.settings.harness.designDecisions, shortLabel: "ADR", code: "DD", group: "intent" },
    { id: "repo-signals", label: t.settings.harness.repositorySignals, shortLabel: "Feedback", code: "RS", group: "signal" },
    { id: "automations", label: t.settings.harness.automations, shortLabel: "Cleanup", code: "CC", group: "flow" },
    { id: "hook-systems", label: t.settings.harness.hookSystems, shortLabel: "Hooks", code: "HK", group: "control" },
    { id: "review-triggers", label: t.settings.harness.reviewTriggers, shortLabel: "Review", code: "RV", group: "control" },
    { id: "release-triggers", label: t.settings.harness.releaseTriggers, shortLabel: "Release", code: "RL", group: "control" },
    { id: "codeowners", label: t.settings.harness.codeowners, shortLabel: "Owners", code: "CO", group: "control" },
    { id: "entrix-fitness", label: t.settings.harness.entrixFitness, shortLabel: "Fitness", code: "FT", group: "signal" },
    { id: "ci-cd", label: t.settings.harness.ciCd, shortLabel: "CI/CD", code: "CI", group: "flow" },
  ], [t]);

  const groupedSections = useMemo(() => {
    const groupOrder = ["intent", "control", "flow", "signal"] as const;
    const groupLabels = {
      intent: t.settings.harness.sectionGroups.intent,
      control: t.settings.harness.sectionGroups.control,
      flow: t.settings.harness.sectionGroups.flow,
      signal: t.settings.harness.sectionGroups.signal,
    } as const;
    return groupOrder.map((groupId) => ({
      id: groupId,
      label: groupLabels[groupId],
      sections: sections.filter((section) => section.group === groupId),
    })).filter((group) => group.sections.length > 0);
  }, [sections, t]);

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
        return <HarnessSpecSourcesPanel workspaceId={workspaceId} codebaseId={activeRepoCodebaseId} repoPath={activeRepoPath} {...props} data={specSourcesState.data} loading={specSourcesState.loading} error={specSourcesState.error} variant="compact" />;
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
    activeRepoCodebaseId,
    activeRepoPath,
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
      <div className="overflow-hidden rounded-sm border border-desktop-border bg-desktop-bg-primary">
        <div className="grid gap-0 xl:grid-cols-[280px_minmax(0,1fr)]">
          <div className="min-w-0 border-r border-desktop-border bg-desktop-bg-secondary/40 p-3">
            <div className="mb-2 flex items-center justify-between gap-2 text-[11px]">
              <div className="font-semibold text-desktop-text-primary">Sources</div>
              <div className="text-desktop-text-secondary">{specFiles.length}</div>
            </div>
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
              <div className="text-sm font-semibold text-desktop-text-primary">{visibleSpec?.name ?? "Select a file"}</div>
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
      <div className="space-y-2">
        <div className="flex items-center justify-end border-b border-desktop-border pb-2">
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
        {activeSection === "overview" ? renderGovernanceBottomPanel() : null}
      </div>
    );
  }

  function renderGovernanceBottomPanel() {
    if (!showBottomPanel) {
      return null;
    }

    const inlineOverviewPanel = activeSection === "overview";
    const panelBorderClass = inlineOverviewPanel
      ? "border border-desktop-border"
      : "border-t border-desktop-border";
    const panelStyle = inlineOverviewPanel ? undefined : { height: `${bottomPanelHeight}px` };

    return (
      <div className="flex flex-col">
        {inlineOverviewPanel ? null : (
          <div
            role="separator"
            aria-label="Resize bottom panel"
            data-testid="harness-console-bottom-resizer"
            className="h-1 shrink-0 cursor-row-resize bg-desktop-border/60 transition-colors hover:bg-desktop-accent"
            onMouseDown={handleBottomPanelResizeStart}
          />
        )}
        <div
          className={`flex shrink-0 flex-col bg-desktop-bg-secondary ${panelBorderClass}`}
          data-testid="harness-console-bottom-panel"
          style={panelStyle}
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

          <div className={inlineOverviewPanel ? "p-3" : "min-h-0 flex-1 overflow-y-auto p-3 desktop-scrollbar-thin"}>
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
      case "spec":
        return <SpecBoardPanel workspaceId={workspaceId} />;
      case "architecture-quality":
        return (
          <HarnessArchitectureQualityPanel
            repoLabel={selectedRepoLabel}
            unsupportedMessage={unsupportedRepoMessage}
            data={architectureState.data}
            loading={architectureState.loading}
            error={architectureState.error}
            onRefresh={reloadArchitecture}
            embedded
          />
        );
      case "spec-sources":
        return <HarnessSpecSourcesPanel workspaceId={workspaceId} codebaseId={activeRepoCodebaseId} repoPath={activeRepoPath} {...sharedProps} data={specSourcesState.data} loading={specSourcesState.loading} error={specSourcesState.error} hideHeader />;
      case "agent-instructions":
        return <HarnessAgentInstructionsPanel workspaceId={workspaceId} codebaseId={activeRepoCodebaseId} repoPath={activeRepoPath} {...sharedProps} data={instructionsState.data} loading={instructionsState.loading} error={instructionsState.error} onAuditRerun={reloadInstructions} hideHeader />;
      case "design-decisions":
        return <HarnessDesignDecisionPanel {...sharedProps} data={designDecisionsState.data} loading={designDecisionsState.loading} error={designDecisionsState.error} hideHeader />;
      case "repo-signals":
        return <HarnessRepoSignalsPanel workspaceId={workspaceId} codebaseId={activeRepoCodebaseId} repoPath={activeRepoPath} {...sharedProps} mode="test" hideHeader />;
      case "automations":
        return <HarnessAutomationPanel {...sharedProps} data={automationsState.data} loading={automationsState.loading} error={automationsState.error} hideHeader />;
      case "hook-systems":
        return (
          <div className="space-y-4">
            <HarnessHookRuntimePanel workspaceId={workspaceId} codebaseId={activeRepoCodebaseId} repoPath={activeRepoPath} {...sharedProps} data={hooksState.data} loading={hooksState.loading} error={hooksState.error} embedded />
            <HarnessAgentHookPanel workspaceId={workspaceId} codebaseId={activeRepoCodebaseId} repoPath={activeRepoPath} {...sharedProps} data={agentHooksState.data} loading={agentHooksState.loading} error={agentHooksState.error} embedded />
          </div>
        );
      case "review-triggers":
        return <HarnessReviewTriggersPanel {...sharedProps} data={hooksState.data} loading={hooksState.loading} error={hooksState.error} hideHeader />;
      case "release-triggers":
        return <HarnessReleaseTriggersPanel {...sharedProps} data={hooksState.data} loading={hooksState.loading} error={hooksState.error} hideHeader />;
      case "codeowners":
        return <HarnessCodeownersPanel {...sharedProps} data={resolvedCodeownersState.data} loading={resolvedCodeownersState.loading} error={resolvedCodeownersState.error} hideHeader />;
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
        return <HarnessGitHubActionsFlowPanel workspaceId={workspaceId} codebaseId={activeRepoCodebaseId} repoPath={activeRepoPath} {...sharedProps} data={githubActionsState.data} loading={githubActionsState.loading} error={githubActionsState.error} hideHeader />;
      default:
        return null;
    }
  }

  function renderExplorerSectionButton(section: SectionDef) {
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
  }

  const titleBarRight = activeSection === "spec"
    ? null
    : (
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
          <div className="flex-1 overflow-y-auto px-2 py-3 desktop-scrollbar-thin">
            <div className="space-y-3">
              <div className="space-y-1">
                {renderExplorerSectionButton(sections[0] as SectionDef)}
              </div>
              {groupedSections.map((group) => (
                <div key={group.id} className="space-y-1">
                  <div className="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
                    {group.label}
                  </div>
                  {group.sections.map((section) => renderExplorerSectionButton(section))}
                </div>
              ))}
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
          {showSectionTabs ? (
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-desktop-border bg-desktop-bg-secondary px-2">
              <div className="flex h-full items-center overflow-x-auto desktop-scrollbar-thin" data-testid="harness-console-tabs">
                {visibleTabs.map((tabId) => {
                  const section = sections.find((item) => item.id === tabId);
                  if (!section) {
                    return null;
                  }
                  const isActive = activeSection === tabId;
                  return (
                    <div key={tabId} className={`group flex h-full shrink-0 items-center border-r border-desktop-border ${isActive ? "bg-desktop-bg-primary" : "bg-desktop-bg-secondary"}`}>
                      <button
                        type="button"
                        onClick={() => openSection(tabId)}
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
          ) : null}

          <div className={`min-h-0 flex-1 overflow-y-auto bg-desktop-bg-primary ${activeSection === "spec" ? "p-3" : "p-4"} desktop-scrollbar`}>
            {renderSectionContent(activeSection)}
          </div>

          {activeSection !== "overview" ? renderGovernanceBottomPanel() : null}

          <div className="flex h-6 shrink-0 items-center justify-between bg-desktop-accent px-3 text-[10px] text-desktop-accent-text">
            <div className="flex items-center gap-3">
              <span>{activeWorkspaceTitle ?? "-"}</span>
            </div>
            <div className="flex items-center gap-3">
              <span>{automationRuleCount} cleanup rules</span>
              <span>{hookCount} hooks</span>
              <span>{workflowCount} workflows</span>
            </div>
          </div>
        </div>
      </div>
    </DesktopAppShell>
  );
}
