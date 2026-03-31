"use client";

import { useEffect, useMemo, useState } from "react";
import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { CodeViewer } from "@/client/components/codemirror/code-viewer";
import { HarnessMark } from "@/client/components/harness-mark";
import { RepoPicker, type RepoSelection } from "@/client/components/repo-picker";
import {
  HarnessExecutionPlanFlow,
  type TierValue,
} from "@/client/components/harness-execution-plan-flow";
import { HarnessSectionCard } from "@/client/components/harness-section-card";
import { HarnessAgentInstructionsPanel } from "@/client/components/harness-agent-instructions-panel";
import { HarnessDesignDecisionPanel } from "@/client/components/harness-design-decision-panel";
import { HarnessFitnessFilesDashboard } from "@/client/components/harness-fitness-files-dashboard";
import { HarnessGovernanceLoopGraph } from "@/client/components/harness-governance-loop-graph";
import { HarnessGitHubActionsFlowPanel } from "@/client/components/harness-github-actions-flow-panel";
import { HarnessHookRuntimePanel } from "@/client/components/harness-hook-runtime-panel";
import { HarnessAgentHookPanel } from "@/client/components/harness-agent-hook-panel";
import { HarnessRepoSignalsPanel } from "@/client/components/harness-repo-signals-panel";
import { HarnessReviewTriggersPanel } from "@/client/components/harness-review-triggers-panel";
import { HarnessSpecSourcesPanel } from "@/client/components/harness-spec-sources-panel";
import { HarnessUnsupportedState, getHarnessUnsupportedRepoMessage } from "@/client/components/harness-support-state";
import { HarnessFloatingNav, type HarnessNavSection } from "@/client/components/harness-floating-nav";
import { useHarnessSettingsData } from "@/client/hooks/use-harness-settings-data";
import { useCodebases, useWorkspaces } from "@/client/hooks/use-workspaces";
import { loadRepoSelection, saveRepoSelection } from "@/client/utils/repo-selection-storage";
import { useTranslation } from "@/i18n";

function extractMarkdownCodeBlocks(source: string) {
  const matches = [...source.matchAll(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g)];
  return matches.map((match, index) => ({
    id: `${match[1] || "text"}-${index}`,
    language: match[1] || "text",
    code: match[2]?.trim() ?? "",
  })).filter((block) => block.code.length > 0);
}

export default function HarnessSettingsPage() {
  const { t } = useTranslation();
  const workspacesHook = useWorkspaces();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const workspaceId = selectedWorkspaceId || workspacesHook.workspaces[0]?.id || "";
  const { codebases } = useCodebases(workspaceId);
  const [selectedCodebaseId, setSelectedCodebaseId] = useState("");
  const [selectedRepoOverrideState, setSelectedRepoOverrideState] = useState<{
    workspaceId: string;
    selection: RepoSelection | null;
  }>({
    workspaceId: "",
    selection: null,
  });
  const [selectedTier, setSelectedTier] = useState<TierValue>("normal");
  const [selectedSpecName, setSelectedSpecName] = useState("");
  const [selectedGovernanceNodeId, setSelectedGovernanceNodeId] = useState<string | null>(null);

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
    )) ?? codebases.find((codebase) => codebase.repoPath === effectiveRepoOverride.path)
      ?? null;
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
    reloadInstructions,
  } = useHarnessSettingsData({
    workspaceId,
    codebaseId: activeRepoCodebaseId,
    repoPath: activeRepoPath,
    selectedTier,
  });
  const specFiles = useMemo(
    () => specsState.data?.files ?? [],
    [specsState.data?.files],
  );

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
  const selectedRepo = activeRepoSelection;
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

  useEffect(() => {
    saveRepoSelection("harness", workspaceId, activeRepoSelection);
  }, [activeRepoSelection, workspaceId]);

  // 定义导航 sections
  const navSections: HarnessNavSection[] = useMemo(() => [
    { id: "governance-loop", label: t.settings.harness.governanceLoop },
    { id: "spec-sources", label: t.settings.harness.specSources },
    { id: "agent-instructions", label: t.settings.harness.agentInstructions },
    { id: "repo-signals", label: t.settings.harness.repositorySignals },
    { id: "hook-systems", label: t.settings.harness.hookSystems },
    { id: "review-triggers", label: t.settings.harness.reviewTriggers },
    { id: "entrix-fitness", label: t.settings.harness.entrixFitness },
    { id: "ci-cd", label: t.settings.harness.ciCd },
  ], [t.settings.harness.agentInstructions, t.settings.harness.ciCd, t.settings.harness.entrixFitness, t.settings.harness.governanceLoop, t.settings.harness.hookSystems, t.settings.harness.repositorySignals, t.settings.harness.reviewTriggers, t.settings.harness.specSources]);

  const governanceContextPanel = useMemo(() => {
    if (selectedGovernanceNodeId === null) {
      return null;
    }
    switch (selectedGovernanceNodeId) {
      case "thinking":
        return (
          <HarnessSpecSourcesPanel
            repoLabel={selectedRepoLabel}
            unsupportedMessage={unsupportedRepoMessage}
            data={specSourcesState.data}
            loading={specSourcesState.loading}
            error={specSourcesState.error}
            variant="compact"
          />
        );
      case "coding":
        return (
          <HarnessDesignDecisionPanel
            repoLabel={selectedRepoLabel}
            unsupportedMessage={unsupportedRepoMessage}
            data={designDecisionsState.data}
            loading={designDecisionsState.loading}
            error={designDecisionsState.error}
            variant="compact"
          />
        );
      case "build":
        return (
          <HarnessAgentInstructionsPanel
            workspaceId={workspaceId}
            codebaseId={activeRepoCodebaseId}
            repoPath={activeRepoPath}
            repoLabel={selectedRepoLabel}
            unsupportedMessage={unsupportedRepoMessage}
            data={instructionsState.data}
            loading={instructionsState.loading}
            error={instructionsState.error}
            onAuditRerun={reloadInstructions}
            variant="compact"
          />
        );
      case "lint":
      case "precommit":
        return (
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
        );
      case "test":
        return (
          <HarnessRepoSignalsPanel
            workspaceId={workspaceId}
            codebaseId={activeRepoCodebaseId}
            repoPath={activeRepoPath}
            repoLabel={selectedRepoLabel}
            mode="test"
            unsupportedMessage={unsupportedRepoMessage}
            variant="compact"
          />
        );
      case "release":
        return (
          <HarnessGitHubActionsFlowPanel
            workspaceId={workspaceId}
            codebaseId={activeRepoCodebaseId}
            repoPath={activeRepoPath}
            repoLabel={selectedRepoLabel}
            unsupportedMessage={unsupportedRepoMessage}
            data={githubActionsState.data}
            loading={githubActionsState.loading}
            error={githubActionsState.error}
            variant="compact"
            initialCategory="Release"
          />
        );
      case "review":
        return (
          <HarnessReviewTriggersPanel
            repoLabel={selectedRepoLabel}
            unsupportedMessage={unsupportedRepoMessage}
            data={hooksState.data}
            loading={hooksState.loading}
            error={hooksState.error}
            variant="compact"
            showDetailToggle
            defaultShowDetails={false}
          />
        );
      case "commit":
      case "post-commit":
        return (
          <HarnessGitHubActionsFlowPanel
            workspaceId={workspaceId}
            codebaseId={activeRepoCodebaseId}
            repoPath={activeRepoPath}
            repoLabel={selectedRepoLabel}
            unsupportedMessage={unsupportedRepoMessage}
            data={githubActionsState.data}
            loading={githubActionsState.loading}
            error={githubActionsState.error}
            variant="compact"
          />
        );
      default:
        return (
          <div className="space-y-3">
            <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Connected surfaces</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {["Instruction file - CLAUDE.md", "Hook systems", "Entrix Fitness", "CI/CD"].map((label) => (
                  <span key={label} className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-[10px] text-desktop-text-primary">
                    {label}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 p-3 text-[11px] text-desktop-text-secondary">
              选择 `设计决策`、`编码实现`、`本地验证`、`变更门禁`、`代码评审` 或 `持续交付` 节点，可以在这里直接查看对应组件的上下文视图。
            </div>
          </div>
        );
    }
  }, [
    activeRepoCodebaseId,
    activeRepoPath,
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
    selectedGovernanceNodeId,
    selectedRepoLabel,
    selectedTier,
    specSourcesState.data,
    specSourcesState.error,
    specSourcesState.loading,
    designDecisionsState.data,
    designDecisionsState.error,
    designDecisionsState.loading,
    unsupportedRepoMessage,
    workspaceId,
  ]);

  return (
    <SettingsRouteShell
      title={t.settings.harness.title}
      description={t.settings.harness.shellDescription}
      badgeLabel="AI Health"
      contentClassName="flex min-h-full w-full flex-col px-3 py-4 md:px-4 md:py-5"
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
      icon={<HarnessMark className="h-5 w-5" />}
      summary={[
        { label: t.settings.harness.summaryOrderLabel, value: t.settings.harness.summaryOrderValue },
        { label: t.settings.harness.summaryFocusLabel, value: t.settings.harness.summaryFocusValue },
      ]}
    >
      <div className="space-y-4">
        <SettingsPageHeader
          title={t.settings.harness.title}
          description={t.settings.harness.pageDescription}
          metadata={[
            { label: "fitness", value: specsState.loading ? "..." : `${dimensionSpecs.length} dimensions` },
            { label: "dispatch", value: planState.loading ? "..." : `${planState.data?.metricCount ?? 0} metrics` },
          ]}
          extra={(
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px]">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">{t.settings.harness.repositoryLabel}</span>
                <RepoPicker
                  value={selectedRepo}
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
              </div>
            </div>
          )}
        />

        <div id="governance-loop">
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
            onSelectedNodeChange={setSelectedGovernanceNodeId}
            contextPanel={governanceContextPanel}
          />
        </div>

        <div id="spec-sources">
          <HarnessSpecSourcesPanel
            repoLabel={selectedRepoLabel}
            unsupportedMessage={unsupportedRepoMessage}
            data={specSourcesState.data}
            loading={specSourcesState.loading}
            error={specSourcesState.error}
          />
        </div>

        <div id="agent-instructions">
          <HarnessAgentInstructionsPanel
            workspaceId={workspaceId}
            codebaseId={activeRepoCodebaseId}
            repoPath={activeRepoPath}
            repoLabel={selectedRepoLabel}
            unsupportedMessage={unsupportedRepoMessage}
            data={instructionsState.data}
            loading={instructionsState.loading}
            error={instructionsState.error}
            onAuditRerun={reloadInstructions}
          />
        </div>

        <div id="repo-signals">
          <HarnessRepoSignalsPanel
            workspaceId={workspaceId}
            codebaseId={activeRepoCodebaseId}
            repoPath={activeRepoPath}
            repoLabel={selectedRepoLabel}
            mode="test"
            unsupportedMessage={unsupportedRepoMessage}
          />
        </div>

        <div id="hook-systems">
          <HarnessSectionCard
            title="Hook systems"
            description="Runtime hook and agent hook surfaces for repository lifecycle automation."
            variant="full"
          >
          <div className="space-y-4">
            <div className="min-w-0">
              <HarnessHookRuntimePanel
                workspaceId={workspaceId}
                codebaseId={activeRepoCodebaseId}
                repoPath={activeRepoPath}
                repoLabel={selectedRepoLabel}
                unsupportedMessage={unsupportedRepoMessage}
                data={hooksState.data}
                loading={hooksState.loading}
                error={hooksState.error}
                embedded
              />
            </div>

            <div className="min-w-0">
              <HarnessAgentHookPanel
                workspaceId={workspaceId}
                codebaseId={activeRepoCodebaseId}
                repoPath={activeRepoPath}
                repoLabel={selectedRepoLabel}
                unsupportedMessage={unsupportedRepoMessage}
                data={agentHooksState.data}
                loading={agentHooksState.loading}
                error={agentHooksState.error}
                embedded
              />
            </div>
          </div>
          </HarnessSectionCard>
        </div>

        <div id="review-triggers">
          <HarnessReviewTriggersPanel
            repoLabel={selectedRepoLabel}
            unsupportedMessage={unsupportedRepoMessage}
            data={hooksState.data}
            loading={hooksState.loading}
            error={hooksState.error}
          />
        </div>

        <div id="entrix-fitness">
          <HarnessSectionCard
            title="Entrix Fitness"
            description="Dimension specs and execution plan topology for repository quality enforcement."
            variant="full"
          >
          <div className="space-y-4">
            <HarnessFitnessFilesDashboard
              specFiles={specFiles}
              selectedSpec={visibleSpec}
              loading={specsState.loading}
              error={specsState.error}
              unsupportedMessage={unsupportedRepoMessage}
              embedded
            />

            <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-3 shadow-sm">
              <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                <div className="min-w-0 xl:border-r xl:border-desktop-border xl:pr-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Discovery</div>
                    </div>
                    <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                      {specFiles.length} items
                    </div>
                  </div>

                  <div className="mt-3 space-y-1.5">
                    {specsState.loading ? (
                      <div className="rounded-lg border border-desktop-border bg-desktop-bg-primary/80 px-3 py-3 text-[11px] text-desktop-text-secondary">
                        Loading fitness specs...
                      </div>
                    ) : null}

                    {unsupportedRepoMessage ? (
                      <HarnessUnsupportedState className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-[11px] text-amber-800" />
                    ) : null}

                    {specsState.error && !unsupportedRepoMessage ? (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-[11px] text-red-700">
                        {specsState.error}
                      </div>
                    ) : null}

                    {!specsState.loading && !specsState.error && !unsupportedRepoMessage && specFiles.length === 0 ? (
                      <div className="rounded-lg border border-desktop-border bg-desktop-bg-primary/80 px-3 py-3 text-[11px] text-desktop-text-secondary">
                        No fitness files found for this repository.
                      </div>
                    ) : null}

                    {!unsupportedRepoMessage ? primaryFiles.map((file) => (
                      <button
                        key={file.name}
                        type="button"
                        onClick={() => {
                          setSelectedSpecName(file.name);
                        }}
                        className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                          visibleSpec?.name === file.name
                            ? "border-desktop-accent bg-desktop-bg-primary text-desktop-text-primary"
                            : "border-desktop-border bg-desktop-bg-primary/80 text-desktop-text-secondary hover:bg-desktop-bg-primary"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[11px] font-semibold">{file.name}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-current/75">
                              <span>{file.kind === "dimension" ? (file.dimension ?? "dimension") : file.kind}</span>
                              <span className="font-mono">{file.language}</span>
                            </div>
                          </div>
                          {file.metricCount > 0 ? (
                            <div className="shrink-0 rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5 text-[10px]">
                              {file.metricCount}
                            </div>
                          ) : null}
                        </div>
                      </button>
                    )) : null}

                    {!unsupportedRepoMessage && auxiliaryFiles.length > 0 ? (
                      <details className="mt-3 rounded-lg border border-desktop-border bg-desktop-bg-primary/60 px-3 py-2">
                        <summary className="cursor-pointer list-none text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                          Auxiliary files
                        </summary>
                        <div className="mt-2 space-y-1.5">
                          {auxiliaryFiles.map((file) => (
                            <button
                              key={file.name}
                              type="button"
                              onClick={() => {
                                setSelectedSpecName(file.name);
                              }}
                              className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                                visibleSpec?.name === file.name
                                  ? "border-desktop-accent bg-desktop-bg-primary text-desktop-text-primary"
                                  : "border-desktop-border bg-desktop-bg-primary/80 text-desktop-text-secondary hover:bg-desktop-bg-primary"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-[11px] font-semibold">{file.name}</div>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-current/75">
                                    <span>{file.kind}</span>
                                    <span className="font-mono">{file.language}</span>
                                  </div>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                </div>

                <div className="min-w-0 px-1 xl:px-0 xl:pl-1">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Source view</div>
                      <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">{visibleSpec?.name ?? "Select a fitness file"}</h3>
                    </div>
                    {visibleSpec?.kind === "dimension" ? (
                      <div className="flex flex-wrap gap-2 text-[10px]">
                        <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-desktop-text-secondary">
                          weight {visibleSpec.weight ?? 0}
                        </span>
                        <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-desktop-text-secondary">
                          pass {visibleSpec.thresholdPass ?? 90}
                        </span>
                        <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-desktop-text-secondary">
                          warn {visibleSpec.thresholdWarn ?? 80}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {unsupportedRepoMessage ? (
                    <HarnessUnsupportedState />
                  ) : visibleSpec ? (
                    <div className="mt-4 space-y-3">
                      <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-desktop-text-secondary">
                          <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1">{visibleSpec.kind}</span>
                          <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1">{visibleSpec.language}</span>
                          <span className="font-mono text-desktop-text-primary">{visibleSpec.relativePath}</span>
                        </div>
                        {visibleSpec.kind === "rulebook" ? (
                          <div className="mt-3 text-[11px] leading-5 text-desktop-text-secondary">
                            This file stays narrative. Entrix loader skips README and does not turn it into executable dimensions.
                          </div>
                        ) : null}
                        {visibleSpec.kind === "manifest" ? (
                          <div className="mt-3 text-[11px] leading-5 text-desktop-text-secondary">
                            Manifest drives evidence ordering. Dimension specs should follow this file instead of raw directory order.
                          </div>
                        ) : null}
                        {visibleSpec.kind === "policy" ? (
                          <div className="mt-3 text-[11px] leading-5 text-desktop-text-secondary">
                            Policy file. This is adjacent to fitness execution, but it is not part of the dimension scoring pipeline.
                          </div>
                        ) : null}
                        {visibleSpec.kind === "narrative" ? (
                          <div className="mt-3 text-[11px] leading-5 text-desktop-text-secondary">
                            Markdown exists in the fitness directory, but without executable metrics frontmatter.
                          </div>
                        ) : null}
                      </div>

                      {visibleSpec.kind === "dimension" && visibleSpec.frontmatterSource ? (
                        <details className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 p-3">
                          <summary className="cursor-pointer list-none text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                            Frontmatter
                          </summary>
                          <div className="mt-3">
                            <CodeViewer
                              code={visibleSpec.frontmatterSource}
                              filename={`${visibleSpec.name}.frontmatter.yaml`}
                              language="yaml"
                              maxHeight="240px"
                              showHeader={false}
                              wordWrap
                            />
                          </div>
                        </details>
                      ) : null}

                      {visibleSpec.kind === "manifest" && visibleSpec.manifestEntries && visibleSpec.manifestEntries.length > 0 ? (
                        <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 p-3">
                          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Manifest order</div>
                          <div className="space-y-1.5">
                            {visibleSpec.manifestEntries.map((entry, index) => (
                              <div key={entry} className="flex items-center gap-2 text-[11px] text-desktop-text-secondary">
                                <span className="w-5 shrink-0 text-right text-[10px] text-desktop-text-secondary">{index + 1}</span>
                                <span className="font-mono text-desktop-text-primary">{entry}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {visibleSpec.language === "yaml" ? (
                        <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 p-3">
                          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">File source</div>
                          <CodeViewer
                            code={visibleSpec.source}
                            filename={visibleSpec.name}
                            language={visibleSpec.language === "yaml" ? "yaml" : undefined}
                            maxHeight="360px"
                            showHeader={false}
                            wordWrap
                          />
                        </div>
                      ) : null}

                      {visibleSpec.language === "markdown" && visibleSpec.kind !== "dimension" ? (
                        <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 p-3">
                          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Commands</div>
                          {visibleSpecCodeBlocks.length > 0 ? (
                            <div className="space-y-3">
                              {visibleSpecCodeBlocks.map((block) => (
                                <CodeViewer
                                  key={block.id}
                                  code={block.code}
                                  filename={`${visibleSpec.name}.${block.language || "txt"}`}
                                  maxHeight="220px"
                                  showHeader={false}
                                  wordWrap
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="text-[11px] text-desktop-text-secondary">
                              No command blocks found in this markdown file.
                            </div>
                          )}
                        </div>
                      ) : null}

                      {visibleSpec.kind === "dimension" ? (
                        <div className="overflow-hidden rounded-xl border border-desktop-border bg-desktop-bg-primary/80">
                          <div className="grid grid-cols-[minmax(0,1.5fr)_auto] gap-3 border-b border-desktop-border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                            <div>Metric</div>
                            <div>Dispatch</div>
                          </div>
                          {visibleSpec.metrics.map((metric) => (
                            <div key={metric.name} className="grid grid-cols-[minmax(0,1.5fr)_auto] gap-3 border-t border-desktop-border px-3 py-2.5 first:border-t-0">
                              <div className="min-w-0">
                                <div className="text-[11px] font-semibold text-desktop-text-primary">{metric.name}</div>
                                <div className="mt-1 break-all text-[10px] font-mono text-desktop-text-secondary">{metric.command || "No command"}</div>
                                {metric.description ? (
                                  <div className="mt-1 text-[10px] leading-4 text-desktop-text-secondary">{metric.description}</div>
                                ) : null}
                                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-desktop-text-secondary">
                                  {metric.evidenceType ? (
                                    <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5">
                                      evidence {metric.evidenceType}
                                    </span>
                                  ) : null}
                                  {metric.pattern ? (
                                    <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5">
                                      pattern
                                    </span>
                                  ) : null}
                                  {metric.scope.map((scope) => (
                                    <span key={scope} className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5">
                                      scope {scope}
                                    </span>
                                  ))}
                                  {metric.runWhenChanged.map((value) => (
                                    <span key={value} className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5">
                                      changed {value}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <div className="flex flex-wrap content-start justify-end gap-1.5 text-[10px]">
                                <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">{metric.runner}</span>
                                <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">{metric.tier}</span>
                                <span className={`rounded-full border px-2.5 py-1 ${metric.hardGate ? "border-red-200 bg-red-50 text-red-700" : "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary"}`}>
                                  {metric.gate}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-6 text-[11px] text-desktop-text-secondary">
                      Select a repository and a fitness file to inspect its frontmatter and metric mapping.
                    </div>
                  )}
                </div>
              </div>
            </div>

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
          </HarnessSectionCard>
        </div>

        <div id="ci-cd">
          <HarnessGitHubActionsFlowPanel
            workspaceId={workspaceId}
            codebaseId={activeRepoCodebaseId}
            repoPath={activeRepoPath}
            repoLabel={selectedRepoLabel}
            unsupportedMessage={unsupportedRepoMessage}
            data={githubActionsState.data}
            loading={githubActionsState.loading}
            error={githubActionsState.error}
          />
        </div>
      </div>

      {/* 浮动导航 */}
      <HarnessFloatingNav sections={navSections} />
    </SettingsRouteShell>
  );
}
