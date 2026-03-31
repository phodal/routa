"use client";

import { useEffect, useMemo, useState } from "react";
import { CodeViewer } from "@/client/components/codemirror/code-viewer";
import type { GitHubActionsFlow, GitHubActionsJob } from "@/client/hooks/use-harness-settings-data";
import {
  classifyGitHubWorkflowCategory,
  normalizeGitHubWorkflowEventTokens,
  type GitHubWorkflowCategory,
} from "@/core/github/workflow-classifier";

type HarnessGitHubActionsFlowGalleryProps = {
  flows: GitHubActionsFlow[];
  variant?: "full" | "compact";
  initialCategory?: WorkflowCategoryKey;
};

export type WorkflowCategoryKey = GitHubWorkflowCategory;
type WorkflowJobKind = GitHubActionsJob["kind"];

type WorkflowCategoryDefinition = {
  key: WorkflowCategoryKey;
  emptyHint: string;
};

type WorkflowCategoryEntry = WorkflowCategoryDefinition & {
  flows: GitHubActionsFlow[];
};

const CATEGORY_DEFINITIONS: WorkflowCategoryDefinition[] = [
  {
    key: "Validation",
    emptyHint: "No validation workflows detected.",
  },
  {
    key: "Release",
    emptyHint: "No release workflows detected.",
  },
  {
    key: "Automation",
    emptyHint: "No automation workflows detected.",
  },
  {
    key: "Maintenance",
    emptyHint: "No maintenance workflows detected.",
  },
];

const JOB_KIND_STYLES: Record<WorkflowJobKind, string> = {
  job: "border-slate-200 bg-white/90 text-slate-600",
  approval: "border-amber-200 bg-amber-50 text-amber-700",
  release: "border-violet-200 bg-violet-50 text-violet-700",
};

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function humanizeToken(value: string) {
  return value
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatStageLabel(index: number) {
  return `Stage ${String(index + 1).padStart(2, "0")}`;
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

function summarizeFlows(flows: GitHubActionsFlow[]) {
  const triggerSet = new Set<string>();
  let totalJobs = 0;

  flows.forEach((flow) => {
    normalizeGitHubWorkflowEventTokens(flow.event).forEach((token) => triggerSet.add(token));
    totalJobs += flow.jobs.length;
  });

  return {
    workflowCount: flows.length,
    triggerTypeCount: triggerSet.size,
    jobCount: totalJobs,
  };
}

function countDependencies(flow: GitHubActionsFlow) {
  return flow.jobs.reduce((sum, job) => sum + job.needs.length, 0);
}

function summarizeStageCount(flow: GitHubActionsFlow) {
  return buildDependencyLanes(flow.jobs).length;
}

function createCategoryEntries(flows: GitHubActionsFlow[]): WorkflowCategoryEntry[] {
  return CATEGORY_DEFINITIONS.map((definition) => ({
    ...definition,
    flows: flows.filter((flow) => classifyGitHubWorkflowCategory(flow) === definition.key),
  }));
}

function CategoryIcon({ category }: { category: WorkflowCategoryKey }) {
  const commonProps = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    viewBox: "0 0 24 24",
    className: "h-4 w-4",
  };

  switch (category) {
    case "Validation":
      return (
        <svg {...commonProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12.5 9.25 17 19 7.5" />
        </svg>
      );
    case "Release":
      return (
        <svg {...commonProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14" />
        </svg>
      );
    case "Automation":
      return (
        <svg {...commonProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v4M15 17v4M5.5 6.5l2.8 2.8M15.7 14.7l2.8 2.8M3 12h4m10 0h4M5.5 17.5l2.8-2.8m7.4-5.4 2.8-2.8M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm0 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
        </svg>
      );
    case "Maintenance":
      return (
        <svg {...commonProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6.5 8 4l2.5-2.5M13.5 17.5 16 20l-2.5 2.5M6 7.5A7 7 0 0 1 18 12M18 16.5A7 7 0 0 1 6 12" />
        </svg>
      );
  }
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[10px] shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <span className="font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <span className="text-[12px] font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function CategoryTabs({
  categories,
  selectedCategory,
  onSelect,
}: {
  categories: WorkflowCategoryEntry[];
  selectedCategory: WorkflowCategoryKey;
  onSelect: (category: WorkflowCategoryKey) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {categories.map((category) => {
        const selected = selectedCategory === category.key;
        const disabled = category.flows.length === 0;

        return (
          <button
            key={category.key}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(category.key)}
            className={cx(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-medium transition-colors",
              disabled
                ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                : selected
                ? "border-sky-300 bg-sky-50 text-sky-700"
                : "border-slate-200 bg-white/90 text-slate-600",
            )}
          >
            <CategoryIcon category={category.key} />
            <span>{category.key}</span>
            <span className="rounded-full border border-current/15 px-1.5 py-0.5 text-[10px]">{category.flows.length}</span>
          </button>
        );
      })}
    </div>
  );
}

function MiniDagPreview({ flow }: { flow: GitHubActionsFlow }) {
  const lanes = buildDependencyLanes(flow.jobs);
  const visibleLanes = lanes.slice(0, 3);
  const hiddenLaneCount = Math.max(lanes.length - visibleLanes.length, 0);

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max items-start gap-2">
        <div className="w-[4.5rem] shrink-0 rounded-[14px] border border-sky-200/80 bg-sky-50/80 px-2 py-1.5">
          <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-sky-700">Trigger</div>
          <div className="mt-0.5 text-[10px] font-semibold leading-4 text-slate-900">
            {humanizeToken(normalizeGitHubWorkflowEventTokens(flow.event)[0] ?? flow.event)}
          </div>
        </div>

        {visibleLanes.map((laneJobs, laneIndex) => (
          <div key={`${flow.id}:lane:${laneIndex}`} className="flex items-start gap-1.5">
            <div className="flex h-7 items-center text-slate-300">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m0 0-4-4m4 4-4 4" />
              </svg>
            </div>
            <div className="w-24 shrink-0 space-y-0.5">
              {laneJobs.slice(0, 1).map((job) => (
                <div key={job.id} className="rounded-[14px] border border-slate-200/80 bg-slate-50/75 px-2 py-1">
                  <div className="truncate text-[10px] font-semibold text-slate-900">{job.name}</div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-[9px] text-slate-500">{job.runner}</span>
                    <span className={cx("rounded-full border px-1.5 py-0.5 text-[8px]", JOB_KIND_STYLES[job.kind])}>{job.kind}</span>
                  </div>
                </div>
              ))}
              {laneJobs.length > 1 ? (
                <div className="rounded-[14px] border border-dashed border-slate-200/80 bg-white/70 px-2 py-1 text-[9px] text-slate-500">
                  +{laneJobs.length - 1} more jobs
                </div>
              ) : null}
            </div>
          </div>
        ))}

        {hiddenLaneCount > 0 ? (
          <div className="flex items-start gap-1.5">
            <div className="flex h-7 items-center text-slate-300">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m0 0-4-4m4 4-4 4" />
              </svg>
            </div>
            <div className="w-[4.5rem] shrink-0 rounded-[14px] border border-dashed border-slate-200/80 bg-white/70 px-2 py-1.5 text-[9px] text-slate-500">
              +{hiddenLaneCount} more stages
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WorkflowCard({
  flow,
  selected,
  onSelect,
}: {
  flow: GitHubActionsFlow;
  selected: boolean;
  onSelect: () => void;
}) {
  const eventTokens = normalizeGitHubWorkflowEventTokens(flow.event);
  const visibleTokens = eventTokens.slice(0, 3);
  const hiddenTokenCount = Math.max(eventTokens.length - visibleTokens.length, 0);
  const stageCount = summarizeStageCount(flow);
  const metaPills = [
    { label: `${flow.jobs.length} jobs`, className: "border-slate-200 bg-slate-50/90 text-slate-600" },
    { label: `${stageCount} stages`, className: "border-sky-200 bg-sky-50 text-sky-700" },
    { label: `${countDependencies(flow)} dependencies`, className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  ];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cx(
        "w-full rounded-[22px] border px-3 py-2.5 text-left transition-all",
        selected
          ? "border-sky-300 bg-[linear-gradient(180deg,rgba(250,252,255,0.98),rgba(238,246,255,0.98))] shadow-[0_18px_44px_rgba(59,130,246,0.08)]"
          : "border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(245,248,252,0.95))] shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 hover:shadow-[0_16px_40px_rgba(15,23,42,0.06)]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h4 className="min-w-0 truncate pr-2 text-[15px] font-semibold tracking-[-0.02em] text-slate-900">{flow.name}</h4>
        {flow.relativePath ? (
          <div className="shrink-0 truncate rounded-full border border-slate-200 bg-white/90 px-2 py-0.5 font-mono text-[9px] text-slate-500">
            {flow.relativePath.split("/").pop()}
          </div>
        ) : null}
      </div>

      <div className="mt-1.5 overflow-x-auto">
        <div className="flex min-w-max items-center gap-1.5 whitespace-nowrap pr-1">
          {visibleTokens.map((token) => (
            <span key={`${flow.id}:${token}`} className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[10px] font-medium text-violet-700">
              {token}
            </span>
          ))}
          {hiddenTokenCount > 0 ? (
            <span className="rounded-full border border-slate-200 bg-white/90 px-2 py-1 text-[10px] text-slate-500">
              +{hiddenTokenCount}
            </span>
          ) : null}
          {metaPills.map((pill) => (
            <span key={`${flow.id}:${pill.label}`} className={cx("rounded-full border px-2.5 py-1 text-[10px]", pill.className)}>
              {pill.label}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-2 rounded-[16px] bg-white/55 px-2 py-1.5">
        <MiniDagPreview flow={flow} />
      </div>
    </button>
  );
}

function FlowCanvas({
  flow,
  activeJobId,
  onJobSelect,
  compactMode,
}: {
  flow: GitHubActionsFlow;
  activeJobId: string;
  onJobSelect: (jobId: string) => void;
  compactMode: boolean;
}) {
  const lanes = buildDependencyLanes(flow.jobs);
  const eventTokens = normalizeGitHubWorkflowEventTokens(flow.event);

  return (
    <section className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(245,248,252,0.95))] p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Pipeline</div>
          <h3 className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-slate-900">{flow.name}</h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {eventTokens.map((token) => (
              <span key={`${flow.id}:detail:${token}`} className="rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-[10px] text-slate-600">
                {token}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-slate-600">
            {flow.jobs.length} jobs
          </span>
          <span className="rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-slate-600">
            {lanes.length} stages
          </span>
          <span className="rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-slate-600">
            {countDependencies(flow)} edges
          </span>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto pb-1">
        <div className="flex min-w-max items-start gap-3">
          <div className={cx(
            "shrink-0 rounded-[20px] border border-sky-200/80 bg-[linear-gradient(135deg,rgba(239,246,255,0.92),rgba(255,255,255,0.98))] p-3.5",
            compactMode ? "w-44" : "w-52",
          )}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">Trigger source</div>
            <div className="mt-2.5 space-y-1.5">
              {eventTokens.map((token) => (
                <div key={`${flow.id}:trigger:${token}`} className="rounded-[16px] border border-white/70 bg-white/90 px-2.5 py-1.5 text-[10px] font-medium text-slate-700">
                  {humanizeToken(token)}
                </div>
              ))}
            </div>
          </div>

          {lanes.map((laneJobs, laneIndex) => (
            <div key={`${flow.id}:canvas-lane:${laneIndex}`} className="flex items-start gap-3">
              <div className="flex h-10 items-center text-slate-300">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m0 0-4-4m4 4-4 4" />
                </svg>
              </div>
              <div className={cx("shrink-0 space-y-2.5", compactMode ? "w-60" : "w-64")}>
                <div className="pl-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{formatStageLabel(laneIndex)}</div>
                {laneJobs.map((job) => {
                  const selected = activeJobId === job.id;
                  return (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => onJobSelect(job.id)}
                      className={cx(
                        "w-full rounded-[20px] border px-3 py-2.5 text-left transition-all",
                        selected
                          ? "border-sky-300 bg-[linear-gradient(180deg,rgba(250,252,255,0.98),rgba(239,246,255,0.98))] shadow-[0_16px_36px_rgba(59,130,246,0.08)]"
                          : "border-slate-200 bg-white/92 hover:border-slate-300",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[12px] font-semibold text-slate-900">{job.name}</div>
                          <div className="mt-0.5 text-[10px] font-mono text-slate-500">{job.runner}</div>
                        </div>
                        <span className={cx("rounded-full border px-2 py-0.5 text-[10px]", JOB_KIND_STYLES[job.kind])}>
                          {job.kind}
                        </span>
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {job.stepCount !== null ? (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500">
                            {job.stepCount} steps
                          </span>
                        ) : null}
                        {job.needs.length > 0 ? job.needs.map((need) => (
                          <span key={`${job.id}:${need}`} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500">
                            {need}
                          </span>
                        )) : (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
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
    </section>
  );
}

function JobInspector({
  flow,
  activeJob,
  compactMode,
}: {
  flow: GitHubActionsFlow;
  activeJob: GitHubActionsJob | null;
  compactMode: boolean;
}) {
  return (
    <aside className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(243,247,252,0.95))] p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Inspector</div>
          <h3 className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-slate-900">
            {activeJob?.name ?? flow.name}
          </h3>
          <div className="mt-1 text-[11px] leading-5 text-slate-500">
            {activeJob
              ? "Selected job metadata, upstream dependencies, and execution context."
              : "Workflow-level metadata and source definition."}
          </div>
        </div>
        <span className="rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-[10px] text-slate-500">
          {activeJob ? "Job detail" : "Workflow detail"}
        </span>
      </div>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-1">
        <div className="rounded-[18px] border border-slate-200 bg-white/90 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Runner</div>
          <div className="mt-2 break-all font-mono text-[11px] text-slate-700">{activeJob?.runner ?? "n/a"}</div>
        </div>
        <div className="rounded-[18px] border border-slate-200 bg-white/90 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Step count</div>
          <div className="mt-2 text-[14px] font-semibold text-slate-900">
            {activeJob?.stepCount ?? "Unknown"}
          </div>
        </div>
        <div className="rounded-[18px] border border-slate-200 bg-white/90 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Dependencies</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {activeJob?.needs.length ? activeJob.needs.map((need) => (
              <span key={`${activeJob.id}:${need}`} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600">
                {need}
              </span>
            )) : (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
                root
              </span>
            )}
          </div>
        </div>
        <div className="rounded-[18px] border border-slate-200 bg-white/90 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Source path</div>
          <div className="mt-2 break-all font-mono text-[11px] text-slate-700">{flow.relativePath ?? "n/a"}</div>
        </div>
      </div>

      <div className="mt-3 rounded-[20px] border border-slate-200 bg-white/90 px-3 py-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Trigger set</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {normalizeGitHubWorkflowEventTokens(flow.event).map((token) => (
            <span key={`${flow.id}:inspector:${token}`} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] text-slate-600">
              {token}
            </span>
          ))}
        </div>
      </div>

      {!compactMode ? (
        <details className="mt-3 rounded-[20px] border border-slate-200 bg-white/90 p-3">
          <summary className="cursor-pointer list-none text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Workflow YAML
          </summary>
          <div className="mt-3">
            <CodeViewer
              code={flow.yaml}
              filename={`${flow.id}.github-actions.yml`}
              language="yaml"
              maxHeight="320px"
              showHeader={false}
              wordWrap
            />
          </div>
        </details>
      ) : null}
    </aside>
  );
}

function WorkflowDetailDialog({
  flow,
  activeJob,
  activeJobId,
  open,
  onClose,
  onJobSelect,
}: {
  flow: GitHubActionsFlow | null;
  activeJob: GitHubActionsJob | null;
  activeJobId: string;
  open: boolean;
  onClose: () => void;
  onJobSelect: (jobId: string) => void;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open || !flow) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close workflow detail"
        className="absolute inset-0 bg-slate-950/28 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${flow.name} pipeline detail`}
        className="relative z-10 flex max-h-[88vh] w-full max-w-[1360px] flex-col overflow-hidden rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(244,248,252,0.97))] shadow-[0_32px_96px_rgba(15,23,42,0.16)]"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/80 px-4 py-3.5">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Pipeline detail</div>
            <h3 className="mt-1 truncate text-[20px] font-semibold tracking-[-0.03em] text-slate-950">{flow.name}</h3>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {normalizeGitHubWorkflowEventTokens(flow.event).map((token) => (
                <span key={`${flow.id}:dialog:${token}`} className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[10px] text-slate-600">
                  {token}
                </span>
              ))}
              {flow.relativePath ? (
                <span className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 font-mono text-[10px] text-slate-500">
                  {flow.relativePath}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[10px] text-slate-600">
              {flow.jobs.length} jobs
            </span>
            <span className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[10px] text-slate-600">
              {summarizeStageCount(flow)} stages
            </span>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="overflow-auto px-4 py-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_340px]">
            <FlowCanvas
              flow={flow}
              activeJobId={activeJobId}
              onJobSelect={onJobSelect}
              compactMode={false}
            />
            <JobInspector flow={flow} activeJob={activeJob} compactMode={false} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function HarnessGitHubActionsFlowGallery({
  flows,
  variant = "full",
  initialCategory,
}: HarnessGitHubActionsFlowGalleryProps) {
  const compactMode = variant === "compact";
  const summary = useMemo(() => summarizeFlows(flows), [flows]);
  const categories = useMemo(() => createCategoryEntries(flows), [flows]);
  const firstCategory = useMemo(
    () => categories.find((category) => category.flows.length > 0)?.key ?? "Validation",
    [categories],
  );

  const [selectedCategory, setSelectedCategory] = useState<WorkflowCategoryKey>(initialCategory ?? "Validation");
  const [selectedFlowId, setSelectedFlowId] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const effectiveCategory = categories.find((category) => category.key === selectedCategory && category.flows.length > 0)?.key ?? firstCategory;
  const activeCategory = categories.find((category) => category.key === effectiveCategory) ?? categories[0];
  const activeFlow = activeCategory?.flows.find((flow) => flow.id === selectedFlowId) ?? activeCategory?.flows[0] ?? null;
  const activeJob = activeFlow?.jobs.find((job) => job.id === selectedJobId) ?? activeFlow?.jobs[0] ?? null;

  const cardsSection = (
    <>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <div className="flex flex-wrap gap-1.5">
          <MetricCard label="Workflows" value={summary.workflowCount} />
          <MetricCard label="Triggers" value={summary.triggerTypeCount} />
          <MetricCard label="Jobs" value={summary.jobCount} />
        </div>
      </div>

      <div className="mt-2.5">
        <CategoryTabs
          categories={categories}
          selectedCategory={effectiveCategory}
          onSelect={(category) => {
            setSelectedCategory(category);
            setSelectedFlowId("");
            setSelectedJobId("");
          }}
        />
      </div>

      {(activeCategory?.flows.length ?? 0) > 0 ? (
        <div className={cx("mt-2.5 grid gap-2", compactMode ? "grid-cols-1" : "xl:grid-cols-2")}>
          {activeCategory?.flows.map((flow) => (
            <WorkflowCard
              key={flow.id}
              flow={flow}
              selected={activeFlow?.id === flow.id}
              onSelect={() => {
                setSelectedFlowId(flow.id);
                setSelectedJobId("");
                setIsDetailOpen(true);
              }}
            />
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-[24px] border border-dashed border-slate-200 bg-white/70 px-4 py-10 text-center text-[12px] text-slate-500">
          {activeCategory?.emptyHint}
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-3">
      {cardsSection}
      <WorkflowDetailDialog
        flow={activeFlow}
        activeJob={activeJob}
        activeJobId={activeJob?.id ?? ""}
        open={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        onJobSelect={setSelectedJobId}
      />
    </div>
  );
}
