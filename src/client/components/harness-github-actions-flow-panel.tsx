"use client";

import { useEffect, useMemo, useState } from "react";
import { CodeViewer } from "@/client/components/codemirror/code-viewer";

type WorkflowJobStatus = "ready" | "running" | "blocked";
type WorkflowJobKind = "job" | "approval" | "release";

type GitHubActionsJob = {
  id: string;
  name: string;
  runner: string;
  status: WorkflowJobStatus;
  kind: WorkflowJobKind;
  duration: string;
  summary: string;
  needs: string[];
};

type GitHubActionsFlow = {
  id: string;
  name: string;
  event: string;
  branch: string;
  cadence: string;
  yaml: string;
  jobs: GitHubActionsJob[];
};

type FlowState = {
  error: string | null;
  flows: GitHubActionsFlow[];
  loadedContextKey: string;
};

type HarnessGitHubActionsFlowPanelProps = {
  workspaceId: string;
  codebaseId?: string;
  repoPath?: string;
  repoLabel: string;
};

const STATUS_STYLES: Record<WorkflowJobStatus, string> = {
  ready: "border-sky-200 bg-sky-50 text-sky-700",
  running: "border-emerald-200 bg-emerald-50 text-emerald-700",
  blocked: "border-amber-200 bg-amber-50 text-amber-700",
};

const KIND_STYLES: Record<WorkflowJobKind, string> = {
  job: "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary",
  approval: "border-amber-200 bg-amber-50 text-amber-700",
  release: "border-violet-200 bg-violet-50 text-violet-700",
};

function toTitleCase(value: string) {
  return value
    .split(/[-_.]/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function buildDependencyLanes(jobs: GitHubActionsJob[]) {
  const jobMap = new Map(jobs.map((job) => [job.id, job]));
  const depthMap = new Map<string, number>();
  const visiting = new Set<string>();

  function resolveDepth(jobId: string): number {
    if (depthMap.has(jobId)) {
      return depthMap.get(jobId) ?? 0;
    }
    if (visiting.has(jobId)) {
      return 0;
    }

    visiting.add(jobId);
    const job = jobMap.get(jobId);
    const depth = !job || job.needs.length === 0
      ? 0
      : Math.max(...job.needs.map((need) => resolveDepth(need))) + 1;
    visiting.delete(jobId);
    depthMap.set(jobId, depth);
    return depth;
  }

  jobs.forEach((job) => {
    resolveDepth(job.id);
  });

  const lanes = new Map<number, GitHubActionsJob[]>();
  jobs.forEach((job) => {
    const depth = depthMap.get(job.id) ?? 0;
    const lane = lanes.get(depth);
    if (lane) {
      lane.push(job);
      return;
    }
    lanes.set(depth, [job]);
  });

  return [...lanes.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, laneJobs]) => laneJobs);
}

export function HarnessGitHubActionsFlowPanel({
  workspaceId,
  codebaseId,
  repoPath,
  repoLabel,
}: HarnessGitHubActionsFlowPanelProps) {
  const hasContext = Boolean(workspaceId && codebaseId && repoPath);
  const contextKey = hasContext ? `${workspaceId}:${codebaseId}:${repoPath}` : "";
  const [flowState, setFlowState] = useState<FlowState>({
    error: null,
    flows: [],
    loadedContextKey: "",
  });
  const [selectedFlowId, setSelectedFlowId] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");

  useEffect(() => {
    if (!hasContext) {
      return;
    }

    let cancelled = false;

    const timer = window.setTimeout(() => {
      if (cancelled) {
        return;
      }

      const query = new URLSearchParams();
      query.set("workspaceId", workspaceId);
      if (codebaseId) {
        query.set("codebaseId", codebaseId);
      }
      if (repoPath) {
        query.set("repoPath", repoPath);
      }

      void fetch(`/api/harness/github-actions?${query.toString()}`)
        .then(async (response) => {
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load GitHub Actions workflows");
          }
          if (cancelled) {
            return;
          }
          setFlowState({
            error: null,
            flows: Array.isArray(payload?.flows) ? payload.flows as GitHubActionsFlow[] : [],
            loadedContextKey: contextKey,
          });
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }
          setFlowState({
            error: error instanceof Error ? error.message : String(error),
            flows: [],
            loadedContextKey: contextKey,
          });
        });
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [codebaseId, contextKey, hasContext, repoPath, workspaceId]);

  const visibleFlows = useMemo(
    () => (hasContext && flowState.loadedContextKey === contextKey ? flowState.flows : []),
    [contextKey, flowState.flows, flowState.loadedContextKey, hasContext],
  );
  const isLoading = hasContext && flowState.loadedContextKey !== contextKey && !flowState.error;

  const activeFlow = useMemo(() => {
    if (visibleFlows.length === 0) {
      return null;
    }
    return visibleFlows.find((flow) => flow.id === selectedFlowId) ?? visibleFlows[0] ?? null;
  }, [selectedFlowId, visibleFlows]);

  const dependencyLanes = useMemo(() => {
    if (!activeFlow) {
      return [];
    }
    return buildDependencyLanes(activeFlow.jobs);
  }, [activeFlow]);

  const totalJobs = activeFlow?.jobs.length ?? 0;
  const readyJobs = activeFlow?.jobs.filter((job) => job.status === "ready").length ?? 0;

  return (
    <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">GitHub Actions flow</div>
          <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">Dependency-first harness view for repository GitHub Actions jobs</h3>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-desktop-text-secondary">
            {repoLabel}
          </span>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-700">
            Repository workflows
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-desktop-text-secondary">
        <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1">
          Trigger event -&gt; needs graph -&gt; gate
        </span>
        <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1">
          Read from .github/workflows
        </span>
      </div>

      {isLoading ? (
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
          Loading GitHub Actions workflows...
        </div>
      ) : null}

      {flowState.error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-[11px] text-red-700">
          {flowState.error}
        </div>
      ) : null}

      {!isLoading && !flowState.error && visibleFlows.length === 0 ? (
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
          Select a repository to inspect workflow flows.
        </div>
      ) : null}

      {visibleFlows.length > 0 && activeFlow ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Workflow tabs</div>
                <h4 className="mt-1 text-sm font-semibold text-desktop-text-primary">Repository workflow files</h4>
              </div>
              <div className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                {visibleFlows.length} flows
              </div>
            </div>

            <div className="mt-3 overflow-x-auto pb-1">
              <div className="flex min-w-max gap-2">
                {visibleFlows.map((flow) => (
                  <button
                    key={flow.id}
                    type="button"
                    onClick={() => {
                      setSelectedFlowId(flow.id);
                      setSelectedJobId("");
                    }}
                    className={`min-w-56 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      activeFlow.id === flow.id
                        ? "border-desktop-accent bg-desktop-bg-secondary text-desktop-text-primary"
                        : "border-desktop-border bg-desktop-bg-primary/80 text-desktop-text-secondary hover:bg-desktop-bg-secondary"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-semibold">{flow.name}</div>
                        <div className="mt-1 truncate text-[10px] uppercase tracking-[0.14em] text-desktop-text-secondary">{flow.event}</div>
                      </div>
                      <span className="shrink-0 rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5 text-[10px] text-desktop-text-secondary">
                        {flow.jobs.length}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                      <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5">{flow.id}</span>
                      <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5">{flow.cadence}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Flow graph</div>
                <h4 className="mt-1 text-sm font-semibold text-desktop-text-primary">{activeFlow.name}</h4>
                <p className="mt-1 text-[11px] text-desktop-text-secondary">
                  Triggered by <span className="font-medium text-desktop-text-primary">{activeFlow.event}</span> on <span className="font-medium text-desktop-text-primary">{activeFlow.branch}</span>.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-[10px]">
                <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">
                  {totalJobs} jobs
                </span>
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-sky-700">
                  {readyJobs} queued
                </span>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto pb-1">
              <div className="flex min-w-max items-start gap-3">
                <div className="w-56 shrink-0 rounded-2xl border border-desktop-border bg-[linear-gradient(135deg,rgba(59,130,246,0.15),transparent_55%)] p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Event</div>
                  <div className="mt-2 text-sm font-semibold text-desktop-text-primary">{toTitleCase(activeFlow.event)}</div>
                  <div className="mt-2 text-[11px] text-desktop-text-secondary">
                    Webhook or manual dispatch fans out by declared `needs`.
                  </div>
                </div>

                {dependencyLanes.map((laneJobs, laneIndex) => (
                  <div key={`lane-${laneIndex}`} className="flex items-start gap-3">
                    <div className="flex h-11 items-center text-desktop-text-secondary">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m0 0-4-4m4 4-4 4" />
                      </svg>
                    </div>
                    <div className="w-80 shrink-0 space-y-3">
                      {laneJobs.map((job) => {
                        const isActive = selectedJobId === job.id;
                        return (
                          <button
                            key={job.id}
                            type="button"
                            onClick={() => {
                              setSelectedJobId(job.id);
                            }}
                            className={`w-full rounded-xl border px-3 py-3 text-left transition-all ${
                              isActive
                                ? "border-desktop-accent bg-desktop-bg-secondary shadow-sm"
                                : "border-desktop-border bg-desktop-bg-primary/85 hover:bg-desktop-bg-secondary"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-[12px] font-semibold text-desktop-text-primary">{job.name}</div>
                                <div className="mt-1 text-[10px] font-mono text-desktop-text-secondary">{job.runner}</div>
                              </div>
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] ${STATUS_STYLES[job.status]}`}>
                                {job.status}
                              </span>
                            </div>
                            <div className="mt-2 text-[11px] text-desktop-text-secondary">
                              {job.summary}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
                              <span className={`rounded-full border px-2 py-0.5 ${KIND_STYLES[job.kind]}`}>
                                {job.kind}
                              </span>
                              <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5 text-desktop-text-secondary">
                                {job.duration}
                              </span>
                              {job.needs.length > 0 ? job.needs.map((need) => (
                                <span key={need} className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5 text-desktop-text-secondary">
                                  {need}
                                </span>
                              )) : (
                                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                                  root
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <details className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-secondary/55 p-3">
              <summary className="cursor-pointer list-none text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                Workflow YAML
              </summary>
              <div className="mt-3">
                <CodeViewer
                  code={activeFlow.yaml}
                  filename={`${activeFlow.id}.github-actions.yml`}
                  language="yaml"
                  maxHeight="280px"
                  showHeader={false}
                  wordWrap
                />
              </div>
            </details>
          </div>
        </div>
      ) : null}
    </section>
  );
}
