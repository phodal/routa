"use client";

import { useEffect, useMemo, useState } from "react";
import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { useCodebases, useWorkspaces } from "@/client/hooks/use-workspaces";

type RunnerKind = "shell" | "graph" | "sarif";
type SpecKind = "rulebook" | "dimension" | "narrative" | "policy";

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
  dimension?: string;
  weight?: number;
  thresholdPass?: number;
  thresholdWarn?: number;
  metricCount: number;
  metrics: MetricSummary[];
};

type SpecsResponse = {
  generatedAt: string;
  repoRoot: string;
  fitnessDir: string;
  files: FitnessSpecSummary[];
};

const FLOW_LABELS = [
  "README rulebook",
  "fitness specs",
  "loader mapping",
  "runner dispatch",
  "score + report",
] as const;

export default function HarnessSettingsPage() {
  const workspacesHook = useWorkspaces();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const workspaceId = selectedWorkspaceId || workspacesHook.workspaces[0]?.id || "";
  const { codebases } = useCodebases(workspaceId);
  const [selectedCodebaseId, setSelectedCodebaseId] = useState("");
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
  const rulebookFile = specsState.files.find((file) => file.kind === "rulebook") ?? null;

  return (
    <SettingsRouteShell
      title="Harness"
      description="Harness visualization placeholder."
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
        { label: "Status", value: "Placeholder only" },
        { label: "Next", value: "Visualize entrix fitness" },
      ]}
    >
      <div className="space-y-6">
        <SettingsPageHeader
          title="Harness"
          description="Entrix fitness specs for the selected repository."
          metadata={[
            { label: "Specs", value: specsState.loading ? "Loading" : `${dimensionSpecs.length} dimensions` },
            { label: "Rulebook", value: rulebookFile ? "README detected" : "Missing" },
          ]}
          extra={(
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0">
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Repository</label>
                <select
                  value={activeCodebase?.id ?? ""}
                  onChange={(event) => {
                    setSelectedCodebaseId(event.target.value);
                  }}
                  className="min-w-56 rounded-md border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1.5 text-[11px] text-desktop-text-primary"
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

              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Path</div>
                <div className="mt-1 max-w-[420px] truncate text-[11px] font-mono text-desktop-text-primary">
                  {activeCodebase?.repoPath ?? "No repository selected"}
                </div>
              </div>
            </div>
          )}
        />

        <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/45 px-4 py-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            {FLOW_LABELS.map((label, index) => (
              <div key={label} className="flex items-center gap-2">
                <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                  <span className="mr-1 text-desktop-text-primary">{index + 1}.</span>
                  {label}
                </div>
                {index < FLOW_LABELS.length - 1 ? <div className="h-px w-3 bg-desktop-border" /> : null}
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-desktop-text-secondary">
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-700">README = narrative only</span>
            <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1">frontmatter metrics = executable dimensions</span>
            {specsState.fitnessDir ? (
              <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 font-mono">
                {specsState.fitnessDir}
              </span>
            ) : null}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Discovery</div>
                <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">Fitness files</h3>
              </div>
              <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                {specsState.files.length} items
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {specsState.loading ? (
                <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-3 py-4 text-[11px] text-desktop-text-secondary">
                  Loading fitness specs...
                </div>
              ) : null}

              {specsState.error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-4 text-[11px] text-red-700">
                  {specsState.error}
                </div>
              ) : null}

              {!specsState.loading && !specsState.error && specsState.files.length === 0 ? (
                <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-3 py-4 text-[11px] text-desktop-text-secondary">
                  No fitness files found for this repository.
                </div>
              ) : null}

              {specsState.files.map((file) => (
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
                      <div className="text-[12px] font-semibold">{file.name}</div>
                      <div className="mt-1 text-[11px]">{file.kind === "dimension" ? (file.dimension ?? "dimension") : file.kind}</div>
                    </div>
                    <div className="shrink-0 rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5 text-[10px]">
                      {file.metricCount} metrics
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Frontmatter</div>
                <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">
                  {visibleSpec?.name ?? "Select a fitness file"}
                </h3>
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
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-desktop-text-secondary">
                    <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1">{visibleSpec.kind}</span>
                    <span className="font-mono">{visibleSpec.relativePath}</span>
                    {specsState.repoRoot ? <span className="font-mono">{specsState.repoRoot}</span> : null}
                  </div>
                  {visibleSpec.kind === "rulebook" ? (
                    <div className="mt-3 text-[11px] leading-5 text-desktop-text-secondary">
                      This file stays narrative. Entrix loader skips README and does not turn it into executable dimensions.
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

                {visibleSpec.kind === "dimension" ? (
                  <div className="space-y-3">
                    {visibleSpec.metrics.map((metric) => (
                      <div key={metric.name} className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[12px] font-semibold text-desktop-text-primary">{metric.name}</div>
                            <div className="mt-1 break-all text-[11px] font-mono text-desktop-text-secondary">{metric.command || "No command"}</div>
                            {metric.description ? (
                              <div className="mt-2 text-[11px] leading-5 text-desktop-text-secondary">{metric.description}</div>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2 text-[10px]">
                            <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">{metric.runner}</span>
                            <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">{metric.tier}</span>
                            <span className={`rounded-full border px-2.5 py-1 ${metric.hardGate ? "border-red-200 bg-red-50 text-red-700" : "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary"}`}>
                              {metric.gate}
                            </span>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-desktop-text-secondary">
                          {metric.evidenceType ? (
                            <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1">
                              evidence {metric.evidenceType}
                            </span>
                          ) : null}
                          {metric.pattern ? (
                            <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1">
                              pattern match
                            </span>
                          ) : null}
                          {metric.scope.map((scope) => (
                            <span key={scope} className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1">
                              scope {scope}
                            </span>
                          ))}
                          {metric.runWhenChanged.map((value) => (
                            <span key={value} className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1">
                              changed {value}
                            </span>
                          ))}
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
      </div>
    </SettingsRouteShell>
  );
}
