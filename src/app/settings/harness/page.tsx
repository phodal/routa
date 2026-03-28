"use client";

import { useEffect, useMemo, useState } from "react";
import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { CodeViewer } from "@/client/components/codemirror/code-viewer";
import {
  HarnessExecutionPlanFlow,
  type PlanResponse,
  type TierValue,
} from "@/client/components/harness-execution-plan-flow";
import { HarnessGitHubActionsFlowPanel } from "@/client/components/harness-github-actions-flow-panel";
import { HarnessHookRuntimePanel } from "@/client/components/harness-hook-runtime-panel";
import { useCodebases, useWorkspaces } from "@/client/hooks/use-workspaces";

type RunnerKind = "shell" | "graph" | "sarif";
type SpecKind = "rulebook" | "manifest" | "dimension" | "narrative" | "policy";

type MetricSummary = {
  name: string;
  command: string;
  description: string;
  tier: string;
  hardGate: boolean;
  gate: string;
  runner: RunnerKind;
  pattern?: string;
  evidenceType?: string;
  scope: string[];
  runWhenChanged: string[];
};

type FitnessSpecSummary = {
  name: string;
  relativePath: string;
  kind: SpecKind;
  language: "markdown" | "yaml";
  dimension?: string;
  weight?: number;
  thresholdPass?: number;
  thresholdWarn?: number;
  metricCount: number;
  metrics: MetricSummary[];
  source: string;
  frontmatterSource?: string;
  manifestEntries?: string[];
};

type SpecsResponse = {
  generatedAt: string;
  repoRoot: string;
  fitnessDir: string;
  files: FitnessSpecSummary[];
};

function extractMarkdownCodeBlocks(source: string) {
  const matches = [...source.matchAll(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g)];
  return matches.map((match, index) => ({
    id: `${match[1] || "text"}-${index}`,
    language: match[1] || "text",
    code: match[2]?.trim() ?? "",
  })).filter((block) => block.code.length > 0);
}

export default function HarnessSettingsPage() {
  const workspacesHook = useWorkspaces();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const workspaceId = selectedWorkspaceId || workspacesHook.workspaces[0]?.id || "";
  const { codebases } = useCodebases(workspaceId);
  const [selectedCodebaseId, setSelectedCodebaseId] = useState("");
  const [selectedTier, setSelectedTier] = useState<TierValue>("normal");
  const [specsState, setSpecsState] = useState<{
    loading: boolean;
    error: string | null;
    files: FitnessSpecSummary[];
    repoRoot: string | null;
    fitnessDir: string | null;
  }>({
    loading: false,
    error: null,
    files: [],
    repoRoot: null,
    fitnessDir: null,
  });
  const [planState, setPlanState] = useState<{
    loading: boolean;
    error: string | null;
    plan: PlanResponse | null;
  }>({
    loading: false,
    error: null,
    plan: null,
  });
  const [selectedSpecName, setSelectedSpecName] = useState("");

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

  useEffect(() => {
    if (!activeCodebase?.id) {
      setSpecsState({
        loading: false,
        error: null,
        files: [],
        repoRoot: null,
        fitnessDir: null,
      });
      setSelectedSpecName("");
      return;
    }

    let cancelled = false;
    const fetchSpecs = async () => {
      setSpecsState((current) => ({
        ...current,
        loading: true,
        error: null,
      }));

      try {
        const query = new URLSearchParams();
        query.set("workspaceId", workspaceId);
        query.set("codebaseId", activeCodebase.id);
        query.set("repoPath", activeCodebase.repoPath);

        const response = await fetch(`/api/fitness/specs?${query.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load fitness specs");
        }

        if (cancelled) {
          return;
        }

        const data = payload as SpecsResponse;
        setSpecsState({
          loading: false,
          error: null,
          files: Array.isArray(data.files) ? data.files : [],
          repoRoot: data.repoRoot ?? null,
          fitnessDir: data.fitnessDir ?? null,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setSpecsState({
          loading: false,
          error: error instanceof Error ? error.message : String(error),
          files: [],
          repoRoot: null,
          fitnessDir: null,
        });
      }
    };

    void fetchSpecs();

    return () => {
      cancelled = true;
    };
  }, [activeCodebase?.id, activeCodebase?.repoPath, workspaceId]);

  useEffect(() => {
    if (!activeCodebase?.id) {
      setPlanState({
        loading: false,
        error: null,
        plan: null,
      });
      return;
    }

    let cancelled = false;
    const fetchPlan = async () => {
      setPlanState({
        loading: true,
        error: null,
        plan: null,
      });

      try {
        const query = new URLSearchParams();
        query.set("workspaceId", workspaceId);
        query.set("codebaseId", activeCodebase.id);
        query.set("repoPath", activeCodebase.repoPath);
        query.set("tier", selectedTier);
        query.set("scope", "local");

        const response = await fetch(`/api/fitness/plan?${query.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load fitness plan");
        }

        if (cancelled) {
          return;
        }

        setPlanState({
          loading: false,
          error: null,
          plan: payload as PlanResponse,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setPlanState({
          loading: false,
          error: error instanceof Error ? error.message : String(error),
          plan: null,
        });
      }
    };

    void fetchPlan();

    return () => {
      cancelled = true;
    };
  }, [activeCodebase?.id, activeCodebase?.repoPath, selectedTier, workspaceId]);

  const visibleSpec = useMemo(() => {
    if (specsState.files.length === 0) {
      return null;
    }
    return specsState.files.find((file) => file.name === selectedSpecName)
      ?? specsState.files.find((file) => file.kind === "dimension")
      ?? specsState.files[0]
      ?? null;
  }, [selectedSpecName, specsState.files]);

  useEffect(() => {
    if (!visibleSpec) {
      if (selectedSpecName) {
        setSelectedSpecName("");
      }
      return;
    }

    if (visibleSpec.name !== selectedSpecName) {
      setSelectedSpecName(visibleSpec.name);
    }
  }, [selectedSpecName, visibleSpec]);

  const dimensionSpecs = specsState.files.filter((file) => file.kind === "dimension");
  const primaryFiles = specsState.files.filter((file) => file.kind === "rulebook" || file.kind === "manifest" || file.kind === "dimension");
  const auxiliaryFiles = specsState.files.filter((file) => !primaryFiles.includes(file));
  const selectedRepoLabel = activeCodebase?.label ?? activeCodebase?.repoPath?.split("/").pop() ?? "None";
  const visibleSpecCodeBlocks = useMemo(
    () => (visibleSpec && visibleSpec.language === "markdown" ? extractMarkdownCodeBlocks(visibleSpec.source) : []),
    [visibleSpec],
  );

  return (
    <SettingsRouteShell
      title="Harness"
      description="Governance feedback loops for local gates, fitness evidence, and remote automation."
      badgeLabel="AI Health"
      workspaceId={workspaceId}
      workspaceTitle={activeWorkspaceTitle}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspacesHook.workspaces}
          activeWorkspaceId={workspaceId || null}
          activeWorkspaceTitle={activeWorkspaceTitle}
          onSelect={setSelectedWorkspaceId}
          onCreate={async (title) => {
            const workspace = await workspacesHook.createWorkspace(title);
            if (workspace) {
              setSelectedWorkspaceId(workspace.id);
            }
          }}
          loading={workspacesHook.loading}
          compact
          desktop
        />
      )}
      icon={(
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75v10.5m5.25-5.25H6.75m10.35-3.3L12 3.75m-5.25 10.95L3 12m18 0l-3.75-2.1M7.5 17.25L3 12m18 0-4.5 2.25M8.25 7.5a3.75 3.75 0 117.5 0 3.75 3.75 0 01-7.5 0z" />
        </svg>
      )}
      summary={[
        { label: "Order", value: "Hook -> fitness -> GitHub Actions" },
        { label: "Focus", value: "Feedback loops and governance" },
      ]}
    >
      <div className="space-y-6">
        <SettingsPageHeader
          title="Harness"
          description="Follow the governance loop in user order: local hook runtime, fitness evidence, then remote GitHub Actions automation."
          metadata={[
            { label: "fitness", value: specsState.loading ? "..." : `${dimensionSpecs.length} dimensions` },
            { label: "dispatch", value: planState.loading ? "..." : `${planState.plan?.metricCount ?? 0} metrics` },
          ]}
          extra={(
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px]">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Repository</span>
                <select
                  value={activeCodebase?.id ?? ""}
                  onChange={(event) => {
                    setSelectedCodebaseId(event.target.value);
                  }}
                  className="min-w-44 rounded-md border border-desktop-border bg-desktop-bg-secondary px-2 py-1 text-[11px] text-desktop-text-primary"
                  disabled={codebases.length === 0 || !workspaceId || workspacesHook.loading}
                >
                  <option value="">Select repository</option>
                  {codebases.map((codebase) => (
                    <option key={codebase.id} value={codebase.id}>
                      {codebase.label ?? codebase.repoPath.split("/").pop() ?? codebase.repoPath}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0 truncate text-desktop-text-secondary">
                <span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.14em]">Path</span>
                <span className="font-mono text-desktop-text-primary">{activeCodebase?.repoPath ?? "No repository selected"}</span>
              </div>
            </div>
          )}
        />

        <HarnessHookRuntimePanel
          workspaceId={workspaceId}
          codebaseId={activeCodebase?.id}
          repoPath={activeCodebase?.repoPath}
          repoLabel={selectedRepoLabel}
        />

        <section className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Discovery</div>
                <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">Fitness files</h3>
              </div>
              <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                {specsState.files.length} items
              </div>
            </div>

            <div className="mt-3 space-y-1.5">
              {specsState.loading ? (
                <div className="rounded-lg border border-desktop-border bg-desktop-bg-primary/80 px-3 py-3 text-[11px] text-desktop-text-secondary">
                  Loading fitness specs...
                </div>
              ) : null}

              {specsState.error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-[11px] text-red-700">
                  {specsState.error}
                </div>
              ) : null}

              {!specsState.loading && !specsState.error && specsState.files.length === 0 ? (
                <div className="rounded-lg border border-desktop-border bg-desktop-bg-primary/80 px-3 py-3 text-[11px] text-desktop-text-secondary">
                  No fitness files found for this repository.
                </div>
              ) : null}

              {primaryFiles.map((file) => (
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
              ))}

              {auxiliaryFiles.length > 0 ? (
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

          <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm">
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

            {visibleSpec ? (
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
        </section>

        <HarnessExecutionPlanFlow
          loading={planState.loading}
          error={planState.error}
          plan={planState.plan}
          repoLabel={selectedRepoLabel}
          selectedTier={selectedTier}
          onTierChange={setSelectedTier}
        />

        <HarnessGitHubActionsFlowPanel
          workspaceId={workspaceId}
          codebaseId={activeCodebase?.id}
          repoPath={activeCodebase?.repoPath}
          repoLabel={selectedRepoLabel}
        />
      </div>
    </SettingsRouteShell>
  );
}
