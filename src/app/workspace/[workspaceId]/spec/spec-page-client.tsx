"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  GitBranch,
  Link2,
  PieChart,
} from "lucide-react";
import { resolveApiPath } from "@/client/config/backend";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { MarkdownViewer } from "@/client/components/markdown/markdown-viewer";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";
import {
  buildSpecBoardModel,
  type FeatureSurfaceIndexResponse,
  type IssueFamily,
  type IssueRelations,
  normalizeSpecStatus,
  type ResolvedRelation,
  type SpecIssue,
  type SpecStatus,
  type SurfaceHit,
} from "./spec-board-model";

type TranslationT = ReturnType<typeof useTranslation>["t"];

type Filters = {
  status: string;
  kind: string;
  severity: string;
  area: string;
};

const SEVERITY_STYLES: Record<string, string> = {
  critical: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200",
  high: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/15 dark:text-orange-200",
  medium: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200",
  low: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200",
  info: "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/15 dark:text-slate-200",
};

const STATUS_THEMES: Record<
  SpecStatus,
  {
    badge: string;
    dot: string;
    selected: string;
  }
> = {
  open: {
    badge: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200",
    dot: "bg-rose-500",
    selected: "border-rose-300 bg-rose-50/95 dark:border-rose-500/30 dark:bg-rose-500/10",
  },
  investigating: {
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200",
    dot: "bg-amber-500",
    selected: "border-amber-300 bg-amber-50/95 dark:border-amber-500/30 dark:bg-amber-500/10",
  },
  resolved: {
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
    dot: "bg-emerald-500",
    selected: "border-emerald-300 bg-emerald-50/95 dark:border-emerald-500/30 dark:bg-emerald-500/10",
  },
  wontfix: {
    badge: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200",
    dot: "bg-slate-500",
    selected: "border-slate-300 bg-slate-100/90 dark:border-slate-500/30 dark:bg-slate-500/10",
  },
};

const SURFACE_CONFIDENCE_STYLES: Record<SurfaceHit["confidence"], string> = {
  high: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
  medium: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200",
  low: "bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200",
};

function getStatusLabels(t: TranslationT): Record<SpecStatus, string> {
  return {
    open: t.specBoard.statusOpen,
    investigating: t.specBoard.statusInvestigating,
    resolved: t.specBoard.statusResolved,
    wontfix: t.specBoard.statusWontfix,
  };
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const maybeError = "error" in payload && typeof payload.error === "string" ? payload.error : "";
  const maybeDetails = "details" in payload && typeof payload.details === "string" ? payload.details : "";
  return maybeDetails || maybeError || fallback;
}

function emptySurfaceIndexResponse(warnings: string[] = []): FeatureSurfaceIndexResponse {
  return {
    generatedAt: "",
    pages: [],
    apis: [],
    metadata: null,
    repoRoot: "",
    warnings,
  };
}

function normalizeSurfaceIndexPayload(
  payload: unknown,
  fallbackWarning: string,
): FeatureSurfaceIndexResponse {
  if (!payload || typeof payload !== "object") {
    return emptySurfaceIndexResponse([fallbackWarning]);
  }

  return {
    generatedAt: typeof (payload as { generatedAt?: unknown }).generatedAt === "string"
      ? (payload as { generatedAt: string }).generatedAt
      : "",
    pages: Array.isArray((payload as { pages?: unknown }).pages)
      ? (payload as { pages: FeatureSurfaceIndexResponse["pages"] }).pages
      : [],
    apis: Array.isArray((payload as { apis?: unknown }).apis)
      ? (payload as { apis: FeatureSurfaceIndexResponse["apis"] }).apis
      : [],
    metadata: typeof (payload as { metadata?: unknown }).metadata === "object"
      ? (payload as { metadata: FeatureSurfaceIndexResponse["metadata"] }).metadata
      : null,
    repoRoot: typeof (payload as { repoRoot?: unknown }).repoRoot === "string"
      ? (payload as { repoRoot: string }).repoRoot
      : "",
    warnings: Array.isArray((payload as { warnings?: unknown }).warnings)
      ? (payload as { warnings: unknown[] }).warnings.filter((warning): warning is string => typeof warning === "string")
      : [],
  };
}

function CompactBadge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${className}`}>
      {children}
    </span>
  );
}

type IssueAreaGroup = {
  id: string;
  label: string;
  issueCount: number;
  unresolvedCount: number;
  families: IssueFamily[];
};

function pickLeadIssue(family: IssueFamily): SpecIssue {
  return family.issues.find((issue) => {
    const status = normalizeSpecStatus(issue.status);
    return status === "open" || status === "investigating";
  }) ?? family.issues[0] as SpecIssue;
}

function getCompletionStats(totalCount: number, unresolvedCount: number) {
  const resolvedCount = Math.max(0, totalCount - unresolvedCount);
  const ratio = totalCount > 0 ? resolvedCount / totalCount : 0;
  return {
    resolvedCount,
    unresolvedCount,
    totalCount,
    ratio,
    progressPercent: `${Math.round(ratio * 100)}%`,
  };
}

function getProgressBarClass(ratio: number) {
  if (ratio >= 1) {
    return "bg-emerald-500/20 dark:bg-emerald-400/20";
  }
  if (ratio >= 0.5) {
    return "bg-sky-500/18 dark:bg-sky-400/20";
  }
  if (ratio > 0) {
    return "bg-amber-500/18 dark:bg-amber-400/18";
  }
  return "bg-rose-500/14 dark:bg-rose-400/14";
}

function getAreaLabel(family: IssueFamily): string {
  return family.dominantAreas[0]
    ?? family.issues.find((issue) => issue.area.trim().length > 0)?.area
    ?? family.label;
}

function getClusterLabel(family: IssueFamily): string {
  const leadIssue = pickLeadIssue(family);
  return leadIssue.title || leadIssue.filename || family.label;
}

function SpecToolbar({
  filters,
  filteredCount,
  totalCount,
  issues,
  surfaceWarnings,
  onFiltersChange,
}: {
  filters: Filters;
  filteredCount: number;
  totalCount: number;
  issues: SpecIssue[];
  surfaceWarnings: string[];
  onFiltersChange: (filters: Filters) => void;
}) {
  const { t } = useTranslation();
  const statusLabels = getStatusLabels(t);
  const statuses = useMemo(
    () => [...new Set(issues.map((issue) => normalizeSpecStatus(issue.status)))],
    [issues],
  );
  const areas = useMemo(
    () => [...new Set(issues.map((issue) => issue.area).filter(Boolean))].sort(),
    [issues],
  );

  const selectClassName =
    "h-8 rounded-md border border-black/8 bg-[#f8fafc] px-2.5 text-xs text-slate-700 outline-none transition-colors focus:border-slate-300 dark:border-white/10 dark:bg-[#111923] dark:text-slate-100 dark:focus:border-white/20";

  return (
    <section className="flex flex-wrap items-center gap-2 rounded-xl border border-black/6 bg-white/88 px-3 py-2 shadow-[0_8px_20px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-[#0f1722]/88 dark:shadow-none">
      <div className="mr-1 inline-flex items-center gap-1.5 rounded-md border border-black/8 bg-white/80 px-2 py-1 text-[11px] font-medium text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-100">
        <ClipboardList className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" strokeWidth={1.8} />
        <span>{t.specBoard.families}</span>
      </div>

      <select
        aria-label={t.specBoard.status}
        value={filters.status}
        onChange={(event) => onFiltersChange({ ...filters, status: event.target.value })}
        className={selectClassName}
      >
        <option value="">{`${t.specBoard.status}: ${t.common.all}`}</option>
        {statuses.map((status) => (
          <option key={status} value={status}>{statusLabels[status]}</option>
        ))}
      </select>

      <select
        aria-label={t.specBoard.area}
        value={filters.area}
        onChange={(event) => onFiltersChange({ ...filters, area: event.target.value })}
        className={selectClassName}
      >
        <option value="">{`${t.specBoard.area}: ${t.common.all}`}</option>
        {areas.map((area) => (
          <option key={area} value={area}>{area}</option>
        ))}
      </select>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {surfaceWarnings.length > 0 ? (
          <CompactBadge className="bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
            {t.specBoard.surfaceMapUnavailable}
          </CompactBadge>
        ) : null}

        <CompactBadge className="bg-black/[0.04] text-slate-600 dark:bg-white/8 dark:text-slate-200">
          {filteredCount} / {totalCount}
        </CompactBadge>
      </div>
    </section>
  );
}

function SpecFamilyExplorer({
  families,
  relationsByFilename,
  selectedIssue,
  onSelectIssue,
}: {
  families: IssueFamily[];
  relationsByFilename: Map<string, IssueRelations>;
  selectedIssue: SpecIssue | null;
  onSelectIssue: (issue: SpecIssue) => void;
}) {
  const { t } = useTranslation();
  const statusLabels = getStatusLabels(t);
  const [expandedAreaIds, setExpandedAreaIds] = useState<Set<string>>(
    () => new Set(families.slice(0, 4).map((family) => getAreaLabel(family))),
  );
  const [expandedClusterIds, setExpandedClusterIds] = useState<Set<string>>(
    () => new Set(families.slice(0, 3).map((family) => family.id)),
  );
  const [collapsedSelectedAreaIds, setCollapsedSelectedAreaIds] = useState<Set<string>>(() => new Set());
  const [collapsedSelectedClusterIds, setCollapsedSelectedClusterIds] = useState<Set<string>>(() => new Set());

  const selectedFamilyId = selectedIssue
    ? (relationsByFilename.get(selectedIssue.filename)?.familyId ?? selectedIssue.filename)
    : null;
  const selectedAreaId = selectedFamilyId
    ? getAreaLabel(families.find((family) => family.id === selectedFamilyId) ?? {
      id: "",
      label: "",
      issues: selectedIssue ? [selectedIssue] : [],
      unresolvedCount: 0,
      relationCount: 0,
      surfaces: [],
      dominantAreas: selectedIssue?.area ? [selectedIssue.area] : [],
    } satisfies IssueFamily)
    : null;

  const areaGroups = useMemo((): IssueAreaGroup[] => {
    const grouped = new Map<string, IssueAreaGroup>();

    for (const family of families) {
      const areaLabel = getAreaLabel(family);
      const existing = grouped.get(areaLabel);
      if (existing) {
        existing.issueCount += family.issues.length;
        existing.unresolvedCount += family.unresolvedCount;
        existing.families.push(family);
        continue;
      }

      grouped.set(areaLabel, {
        id: areaLabel,
        label: areaLabel,
        issueCount: family.issues.length,
        unresolvedCount: family.unresolvedCount,
        families: [family],
      });
    }

    return [...grouped.values()]
      .map((group) => ({
        ...group,
        families: [...group.families].sort((a, b) => {
          const unresolvedDiff = b.unresolvedCount - a.unresolvedCount;
          if (unresolvedDiff !== 0) {
            return unresolvedDiff;
          }
          const relationDiff = b.relationCount - a.relationCount;
          if (relationDiff !== 0) {
            return relationDiff;
          }
          return getClusterLabel(a).localeCompare(getClusterLabel(b));
        }),
      }))
      .sort((a, b) => {
        const unresolvedDiff = b.unresolvedCount - a.unresolvedCount;
        if (unresolvedDiff !== 0) {
          return unresolvedDiff;
        }
        const sizeDiff = b.issueCount - a.issueCount;
        if (sizeDiff !== 0) {
          return sizeDiff;
        }
        return a.label.localeCompare(b.label);
      });
  }, [families]);

  const toggleArea = useCallback((areaId: string, isExpanded: boolean, isSelectedArea: boolean) => {
    setExpandedAreaIds((current) => {
      const next = new Set(current);
      if (isExpanded) {
        next.delete(areaId);
      } else {
        next.add(areaId);
      }
      return next;
    });
    if (isSelectedArea) {
      setCollapsedSelectedAreaIds((current) => {
        const next = new Set(current);
        if (isExpanded) {
          next.add(areaId);
        } else {
          next.delete(areaId);
        }
        return next;
      });
    }
  }, []);

  const toggleCluster = useCallback((familyId: string, isExpanded: boolean, isSelectedFamily: boolean) => {
    setExpandedClusterIds((current) => {
      const next = new Set(current);
      if (isExpanded) {
        next.delete(familyId);
      } else {
        next.add(familyId);
      }
      return next;
    });
    if (isSelectedFamily) {
      setCollapsedSelectedClusterIds((current) => {
        const next = new Set(current);
        if (isExpanded) {
          next.add(familyId);
        } else {
          next.delete(familyId);
        }
        return next;
      });
    }
  }, []);

  return (
    <section className="flex min-h-[28rem] flex-col overflow-hidden rounded-2xl border border-black/6 bg-white/84 dark:border-white/10 dark:bg-[#0f1722]/84">
      <div className="border-b border-black/6 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:border-white/10 dark:text-slate-400">
        {t.specBoard.families}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2.5">
        {areaGroups.length === 0 ? (
          <div className="flex h-full min-h-40 items-center justify-center rounded-xl border border-dashed border-black/8 bg-white/60 px-4 text-center text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
            {t.specBoard.noIssues}
          </div>
        ) : null}

        <div className="space-y-1.5">
          {areaGroups.map((area) => {
            const isSelectedArea = selectedAreaId === area.id;
            const isAreaExpanded = expandedAreaIds.has(area.id)
              || (isSelectedArea && !collapsedSelectedAreaIds.has(area.id));
            const areaProgress = getCompletionStats(area.issueCount, area.unresolvedCount);
            return (
              <section key={area.id} className="rounded-lg border border-black/6 bg-[#f8fafc] dark:border-white/10 dark:bg-white/[0.02]">
                <button
                  type="button"
                  onClick={() => toggleArea(area.id, isAreaExpanded, isSelectedArea)}
                  className="relative flex w-full items-center gap-2 overflow-hidden px-2.5 py-2 text-left"
                >
                  <span
                    aria-hidden="true"
                    className={`absolute inset-y-0 left-0 rounded-r-full ${getProgressBarClass(areaProgress.ratio)}`}
                    style={{ width: areaProgress.progressPercent }}
                  />
                  {isAreaExpanded ? (
                    <ChevronDown className="relative z-10 h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={1.8} />
                  ) : (
                    <ChevronRight className="relative z-10 h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={1.8} />
                  )}
                  <span className="relative z-10 min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-900 dark:text-slate-50">
                    {area.label}
                  </span>
                  <div className="relative z-10 flex shrink-0 items-center gap-1">
                    <CompactBadge className="bg-white/85 text-slate-700 dark:bg-black/20 dark:text-slate-100">
                      {areaProgress.resolvedCount}/{areaProgress.totalCount}
                    </CompactBadge>
                    <CompactBadge className="bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200">
                      {areaProgress.unresolvedCount}
                    </CompactBadge>
                  </div>
                </button>

                {isAreaExpanded ? (
                  <div className="mx-2.5 mb-2.5 border-l border-black/8 pl-2.5 dark:border-white/10">
                    <div className="space-y-1">
                      {area.families.map((family) => {
                        const leadIssue = pickLeadIssue(family);
                        const clusterLabel = getClusterLabel(family);
                        const isSelectedFamily = selectedFamilyId === family.id;
                        const isClusterExpanded = expandedClusterIds.has(family.id)
                          || (isSelectedFamily && !collapsedSelectedClusterIds.has(family.id));

                        return (
                          <div key={family.id} className="space-y-1">
                            <button
                              type="button"
                              onClick={() => {
                                const shouldSelectLead = !isClusterExpanded || !isSelectedFamily;
                                toggleCluster(family.id, isClusterExpanded, isSelectedFamily);
                                if (shouldSelectLead) {
                                  onSelectIssue(leadIssue);
                                }
                              }}
                              className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left ${
                                isSelectedFamily
                                  ? "bg-slate-100 text-slate-950 dark:bg-white/[0.08] dark:text-slate-50"
                                  : "hover:bg-white/70 dark:hover:bg-white/[0.04]"
                              }`}
                            >
                              {isClusterExpanded ? (
                                <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" strokeWidth={1.8} />
                              ) : (
                                <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" strokeWidth={1.8} />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[12px] font-medium text-slate-900 dark:text-slate-50">
                                  {clusterLabel}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                  <CompactBadge className="bg-black/[0.04] text-slate-500 dark:bg-white/6 dark:text-slate-300">
                                    {family.issues.length} {t.specBoard.members}
                                  </CompactBadge>
                                  <CompactBadge className="bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200">
                                    {family.unresolvedCount}
                                  </CompactBadge>
                                  {family.relationCount > 0 ? (
                                    <CompactBadge className="bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200">
                                      {family.relationCount} {t.specBoard.relations}
                                    </CompactBadge>
                                  ) : null}
                                </div>
                              </div>
                            </button>

                            {isClusterExpanded ? (
                              <div className="ml-4 border-l border-black/8 pl-2 dark:border-white/10">
                                <div className="space-y-0.5">
                                  {family.issues.map((issue) => {
                                    const normalizedStatus = normalizeSpecStatus(issue.status);
                                    const isSelected = selectedIssue?.filename === issue.filename;
                                    const metaParts = [
                                      statusLabels[normalizedStatus],
                                      issue.severity,
                                      issue.githubIssue != null ? `#${issue.githubIssue}` : null,
                                    ].filter(Boolean);

                                    return (
                                      <button
                                        key={issue.filename}
                                        type="button"
                                        onClick={() => onSelectIssue(issue)}
                                        className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left ${
                                          isSelected
                                            ? "bg-white text-slate-950 shadow-sm dark:bg-white/[0.06] dark:text-slate-50"
                                            : "hover:bg-white/70 dark:hover:bg-white/[0.03]"
                                        }`}
                                      >
                                        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_THEMES[normalizedStatus].dot}`} />
                                        <div className="min-w-0 flex-1">
                                          <div className="truncate text-[12px] text-slate-800 dark:text-slate-100">
                                            {issue.title || issue.filename}
                                          </div>
                                          <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                                            {metaParts.join(" · ")}
                                          </div>
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function RelationPill({
  relation,
  onSelectLocalIssue,
}: {
  relation: ResolvedRelation;
  onSelectLocalIssue: (filename: string) => void;
}) {
  const baseClassName =
    "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors";

  if (relation.targetFilename) {
    return (
      <button
        type="button"
        onClick={() => onSelectLocalIssue(relation.targetFilename as string)}
        className={`${baseClassName} border-black/8 bg-black/[0.03] text-slate-700 hover:bg-black/[0.05] dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10`}
      >
        <Link2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        <span className="truncate">{relation.label}</span>
      </button>
    );
  }

  if (relation.href) {
    return (
      <a
        href={relation.href}
        target="_blank"
        rel="noopener noreferrer"
        className={`${baseClassName} border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200 dark:hover:bg-sky-500/20`}
      >
        <span className="truncate">{relation.label}</span>
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
      </a>
    );
  }

  return (
    <span className={`${baseClassName} border-black/8 bg-black/[0.03] text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-200`}>
      {relation.label}
    </span>
  );
}

function IssueButton({
  issue,
  onSelectIssue,
}: {
  issue: SpecIssue;
  onSelectIssue: (filename: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelectIssue(issue.filename)}
      className="flex w-full items-start gap-2 rounded-lg border border-black/8 bg-white/80 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10"
    >
      <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={1.8} />
      <span className="line-clamp-2">{issue.title || issue.filename}</span>
    </button>
  );
}

function DetailSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-black/6 bg-[#f8fafc] p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
          {title}
        </div>
        <CompactBadge className="bg-black/[0.04] text-slate-500 dark:bg-white/6 dark:text-slate-300">
          {count}
        </CompactBadge>
      </div>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

function SurfaceHitCard({ hit }: { hit: SurfaceHit }) {
  return (
    <article className="rounded-lg border border-black/6 bg-white/80 p-2.5 dark:border-white/10 dark:bg-white/5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">
            {hit.label}
          </div>
          <div className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
            {hit.secondaryLabel}
          </div>
        </div>
        <CompactBadge className={SURFACE_CONFIDENCE_STYLES[hit.confidence]}>
          {hit.confidence}
        </CompactBadge>
      </div>

      {hit.description ? (
        <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{hit.description}</div>
      ) : null}

      {hit.evidence.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {hit.evidence.map((evidence) => (
            <CompactBadge
              key={evidence}
              className="bg-black/[0.04] text-slate-600 dark:bg-white/8 dark:text-slate-200"
            >
              {evidence}
            </CompactBadge>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function SpecDetailPane({
  issue,
  relations,
  surfaceHits,
  surfaceWarnings,
  onSelectLinkedIssue,
}: {
  issue: SpecIssue | null;
  relations: IssueRelations;
  surfaceHits: SurfaceHit[];
  surfaceWarnings: string[];
  onSelectLinkedIssue: (filename: string) => void;
}) {
  const { t } = useTranslation();
  const statusLabels = getStatusLabels(t);

  if (!issue) {
    return (
      <section
        role="region"
        aria-label={t.specBoard.selectIssue}
        className="flex min-h-[28rem] items-center justify-center rounded-2xl border border-dashed border-black/8 bg-white/70 p-6 text-center dark:border-white/10 dark:bg-[#0f1722]/70"
      >
        <div className="max-w-md">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            {t.specBoard.selectIssue}
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            {t.specBoard.selectIssueBody}
          </p>
        </div>
      </section>
    );
  }

  const severityClass = SEVERITY_STYLES[issue.severity] ?? SEVERITY_STYLES.info;
  const normalizedStatus = normalizeSpecStatus(issue.status);
  const visibleSurfaceHits = surfaceHits
    .filter((hit) => hit.explicit || hit.confidence !== "low")
    .slice(0, 4);
  const pages = visibleSurfaceHits.filter((hit) => hit.kind === "page");
  const apis = visibleSurfaceHits.filter((hit) => hit.kind === "api");

  return (
    <section
      role="region"
      aria-label={issue.title || issue.filename}
      className="flex min-h-[28rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-black/6 bg-white/88 dark:border-white/10 dark:bg-[#0f1722]/88"
    >
      <div className="border-b border-black/6 px-3.5 py-3 dark:border-white/10">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              {t.nav.spec}
            </div>
            <h2 className="mt-1 text-[17px] font-semibold leading-6 text-slate-900 dark:text-slate-50">
              {issue.title || issue.filename}
            </h2>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[11px]">
            <CompactBadge className={`border font-semibold uppercase ${severityClass}`}>
              {issue.severity}
            </CompactBadge>
            <CompactBadge className={STATUS_THEMES[normalizedStatus].badge}>
              {statusLabels[normalizedStatus]}
            </CompactBadge>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
          <CompactBadge className="bg-black/[0.04] text-slate-600 dark:bg-white/6 dark:text-slate-200">
            {issue.kind}
          </CompactBadge>
          {issue.area ? (
            <CompactBadge className="bg-black/[0.04] text-slate-600 dark:bg-white/6 dark:text-slate-200">
              {issue.area}
            </CompactBadge>
          ) : null}
          {issue.date ? (
            <CompactBadge className="bg-black/[0.04] text-slate-600 dark:bg-white/6 dark:text-slate-200">
              {`${t.specBoard.date}: ${issue.date}`}
            </CompactBadge>
          ) : null}
          {issue.reportedBy ? (
            <CompactBadge className="bg-black/[0.04] text-slate-600 dark:bg-white/6 dark:text-slate-200">
              {`${t.specBoard.reportedBy}: ${issue.reportedBy}`}
            </CompactBadge>
          ) : null}
          <CompactBadge className="bg-black/[0.04] font-mono text-slate-600 dark:bg-white/6 dark:text-slate-200">
            {issue.filename}
          </CompactBadge>
          {issue.githubIssue != null ? (
            issue.githubUrl ? (
              <a
                href={issue.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] text-sky-700 hover:bg-sky-100 dark:bg-sky-500/15 dark:text-sky-200 dark:hover:bg-sky-500/20"
              >
                <span>#{issue.githubIssue} ({issue.githubState ?? t.specBoard.githubStateUnknown})</span>
                <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.8} />
              </a>
            ) : (
              <CompactBadge className="bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200">
                #{issue.githubIssue}
              </CompactBadge>
            )
          ) : null}
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3.5">
        <div className="grid gap-3 xl:grid-cols-3">
          <DetailSection title={t.specBoard.linkedFrom} count={relations.incoming.length}>
            {relations.incoming.length > 0 ? (
              relations.incoming.map((incomingIssue) => (
                <IssueButton
                  key={incomingIssue.filename}
                  issue={incomingIssue}
                  onSelectIssue={onSelectLinkedIssue}
                />
              ))
            ) : (
              <div className="text-sm text-slate-500 dark:text-slate-400">{t.specBoard.noBacklinks}</div>
            )}
          </DetailSection>

          <DetailSection title={t.specBoard.sameFamily} count={relations.familyIssues.length}>
            {relations.familyIssues.length > 0 ? (
              relations.familyIssues.map((familyIssue) => (
                <IssueButton
                  key={familyIssue.filename}
                  issue={familyIssue}
                  onSelectIssue={onSelectLinkedIssue}
                />
              ))
            ) : (
              <div className="text-sm text-slate-500 dark:text-slate-400">{t.specBoard.noLinkedIssues}</div>
            )}
          </DetailSection>

          <DetailSection title={t.specBoard.issueLinks} count={relations.outgoing.length}>
            {relations.outgoing.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {relations.outgoing.map((relation) => (
                  <RelationPill
                    key={relation.key}
                    relation={relation}
                    onSelectLocalIssue={onSelectLinkedIssue}
                  />
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-500 dark:text-slate-400">{t.specBoard.noLinkedIssues}</div>
            )}
          </DetailSection>
        </div>

        <section className="rounded-xl border border-black/6 bg-[#f8fafc] p-3 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              {t.specBoard.featureFootprint}
            </div>
            <div className="flex items-center gap-1">
              <CompactBadge className="bg-black/[0.04] text-slate-500 dark:bg-white/6 dark:text-slate-300">
                {pages.length} {t.specBoard.pages}
              </CompactBadge>
              <CompactBadge className="bg-black/[0.04] text-slate-500 dark:bg-white/6 dark:text-slate-300">
                {apis.length} {t.specBoard.apis}
              </CompactBadge>
            </div>
          </div>

          {visibleSurfaceHits.length > 0 ? (
            <div className="mt-2 grid gap-2 xl:grid-cols-2">
              {visibleSurfaceHits.map((hit) => (
                <SurfaceHitCard key={hit.key} hit={hit} />
              ))}
            </div>
          ) : (
            <div className="mt-2 rounded-lg border border-dashed border-black/8 bg-white/70 px-3 py-4 text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
              {surfaceWarnings.length > 0 ? t.specBoard.surfaceMapUnavailable : t.specBoard.noSurfaceHits}
            </div>
          )}
        </section>

        {issue.tags.length > 0 ? (
          <section className="rounded-xl border border-black/6 bg-white/80 p-3 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex flex-wrap gap-1.5">
              {issue.tags.map((tag) => (
                <CompactBadge
                  key={tag}
                  className="border border-black/6 bg-[#f6f3ee] text-slate-600 dark:border-white/10 dark:bg-white/6 dark:text-slate-200"
                >
                  {tag}
                </CompactBadge>
              ))}
            </div>
          </section>
        ) : null}

        <details className="rounded-xl border border-black/6 bg-[#fdfdfd] p-3 dark:border-white/10 dark:bg-[#0c121b]">
          <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            {t.specBoard.body}
          </summary>
          <div className="mt-3">
            <MarkdownViewer content={issue.body} className="text-sm text-slate-700 dark:text-slate-100" />
          </div>
        </details>
      </div>
    </section>
  );
}

export function SpecBoardPanel({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const [allIssues, setAllIssues] = useState<SpecIssue[]>([]);
  const [surfaceIndex, setSurfaceIndex] = useState<FeatureSurfaceIndexResponse>(emptySurfaceIndexResponse());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<SpecIssue | null>(null);
  const [filters, setFilters] = useState<Filters>({
    status: "",
    kind: "",
    severity: "",
    area: "",
  });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const issuesPath = resolveApiPath(`/spec/issues?workspaceId=${encodeURIComponent(workspaceId)}`);
        const surfacePath = resolveApiPath(`/spec/surface-index?workspaceId=${encodeURIComponent(workspaceId)}`);

        const [issuesResponse, surfaceResponse] = await Promise.all([
          desktopAwareFetch(issuesPath, {
            cache: "no-store",
            signal: controller.signal,
          }),
          desktopAwareFetch(surfacePath, {
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);

        const issuesPayload = await issuesResponse.json().catch(() => null);
        const surfacePayload = await surfaceResponse.json().catch(() => null);

        if (!issuesResponse.ok) {
          throw new Error(extractErrorMessage(issuesPayload, t.specBoard.failedToLoad));
        }

        if (controller.signal.aborted) {
          return;
        }

        const issues = Array.isArray(issuesPayload?.issues) ? issuesPayload.issues as SpecIssue[] : [];
        const surfaces = surfaceResponse.ok
          ? normalizeSurfaceIndexPayload(surfacePayload, t.specBoard.surfaceMapUnavailable)
          : emptySurfaceIndexResponse([extractErrorMessage(surfacePayload, t.specBoard.surfaceMapUnavailable)]);

        setAllIssues(issues);
        setSurfaceIndex(surfaces);
        setSelectedIssue((current) => current
          ? issues.find((issue) => issue.filename === current.filename) ?? null
          : null);
      } catch (issueError) {
        if (controller.signal.aborted || (issueError instanceof Error && issueError.name === "AbortError")) {
          return;
        }

        setError(issueError instanceof Error ? issueError.message : String(issueError));
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [t.specBoard.failedToLoad, t.specBoard.surfaceMapUnavailable, workspaceId]);

  const boardModel = useMemo(() => buildSpecBoardModel(allIssues, surfaceIndex), [allIssues, surfaceIndex]);

  const filteredIssues = useMemo(() => {
    return allIssues.filter((issue) => {
      if (filters.status && normalizeSpecStatus(issue.status) !== filters.status) return false;
      if (filters.kind && issue.kind !== filters.kind) return false;
      if (filters.severity && issue.severity !== filters.severity) return false;
      if (filters.area && issue.area !== filters.area) return false;
      return true;
    });
  }, [allIssues, filters]);

  const filteredIssueSet = useMemo(() => new Set(filteredIssues.map((issue) => issue.filename)), [filteredIssues]);

  const visibleFamilies = useMemo(() => {
    return boardModel.families
      .map((family) => ({
        ...family,
        issues: family.issues.filter((issue) => filteredIssueSet.has(issue.filename)),
        unresolvedCount: family.issues.filter((issue) => filteredIssueSet.has(issue.filename))
          .filter((issue) => {
            const status = normalizeSpecStatus(issue.status);
            return status === "open" || status === "investigating";
          }).length,
        relationCount: family.issues
          .filter((issue) => filteredIssueSet.has(issue.filename))
          .reduce((total, issue) => {
            const relations = boardModel.relationsByFilename.get(issue.filename);
            return total + (relations?.localOutgoing.filter((linked) => filteredIssueSet.has(linked.filename)).length ?? 0);
          }, 0),
      }))
      .filter((family) => family.issues.length > 0);
  }, [boardModel.families, boardModel.relationsByFilename, filteredIssueSet]);

  useEffect(() => {
    setSelectedIssue((current) => {
      if (filteredIssues.length === 0) {
        return null;
      }

      if (!current) {
        return filteredIssues[0] ?? null;
      }

      return filteredIssues.find((issue) => issue.filename === current.filename) ?? filteredIssues[0] ?? null;
    });
  }, [filteredIssues]);

  const handleSelectLinkedIssue = useCallback((filename: string) => {
    const issue = boardModel.issueByFilename.get(filename);
    if (issue) {
      setSelectedIssue(issue);
    }
  }, [boardModel.issueByFilename]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      <SpecToolbar
        filters={filters}
        filteredCount={filteredIssues.length}
        totalCount={allIssues.length}
        issues={allIssues}
        surfaceWarnings={surfaceIndex.warnings}
        onFiltersChange={setFilters}
      />

      {loading ? (
        <div className="flex min-h-[28rem] flex-1 items-center justify-center rounded-2xl border border-black/6 bg-white/75 text-slate-500 dark:border-white/10 dark:bg-white/6 dark:text-slate-300">
          <span className="animate-pulse">{t.common.loading}</span>
        </div>
      ) : null}

      {!loading && error ? (
        <div className="flex min-h-[20rem] flex-1 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50/90 px-6 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
          <span>{error}</span>
        </div>
      ) : null}

      {!loading && !error ? (
        <section className="grid min-h-0 flex-1 gap-2.5 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
          <SpecFamilyExplorer
            families={visibleFamilies}
            relationsByFilename={boardModel.relationsByFilename}
            selectedIssue={selectedIssue}
            onSelectIssue={setSelectedIssue}
          />

          <SpecDetailPane
            issue={selectedIssue}
            relations={selectedIssue
              ? boardModel.relationsByFilename.get(selectedIssue.filename) ?? {
                outgoing: [],
                incoming: [],
                localOutgoing: [],
                familyId: selectedIssue.filename,
                familyIssues: [],
              }
              : {
                outgoing: [],
                incoming: [],
                localOutgoing: [],
                familyId: "",
                familyIssues: [],
              }}
            surfaceHits={selectedIssue ? boardModel.surfaceHitsByFilename.get(selectedIssue.filename) ?? [] : []}
            surfaceWarnings={surfaceIndex.warnings}
            onSelectLinkedIssue={handleSelectLinkedIssue}
          />
        </section>
      ) : null}
    </div>
  );
}

export function SpecPageClient() {
  const { t } = useTranslation();
  const params = useParams();
  const router = useRouter();
  const rawWorkspaceId = params.workspaceId as string;
  const workspaceId =
    rawWorkspaceId === "__placeholder__" && typeof window !== "undefined"
      ? (window.location.pathname.match(/^\/workspace\/([^/]+)/)?.[1] ?? rawWorkspaceId)
      : rawWorkspaceId;

  const workspacesHook = useWorkspaces();
  const workspace = workspacesHook.workspaces.find((item) => item.id === workspaceId);

  const handleWorkspaceSelect = useCallback((nextWorkspaceId: string) => {
    router.push(`/workspace/${nextWorkspaceId}/spec`);
  }, [router]);

  const handleWorkspaceCreate = useCallback(async (title: string) => {
    const workspaceResult = await workspacesHook.createWorkspace(title);
    if (workspaceResult) {
      router.push(`/workspace/${workspaceResult.id}/spec`);
    }
  }, [router, workspacesHook]);

  if (workspacesHook.loading && workspaceId !== "default") {
    return (
      <div className="desktop-theme flex h-screen items-center justify-center bg-desktop-bg-primary">
        <div className="flex items-center gap-3 text-desktop-text-secondary">
          <PieChart className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24" />
          {t.workspace.loadingWorkspace}
        </div>
      </div>
    );
  }

  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceTitle={workspace?.title ?? (workspaceId === "default" ? t.workspace.defaultWorkspace : workspaceId)}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspacesHook.workspaces}
          activeWorkspaceId={workspaceId}
          activeWorkspaceTitle={workspace?.title ?? (workspaceId === "default" ? t.workspace.defaultWorkspace : workspaceId)}
          onSelect={handleWorkspaceSelect}
          onCreate={handleWorkspaceCreate}
          loading={workspacesHook.loading}
          compact
          desktop
        />
      )}
    >
      <div className="flex h-full min-h-0 bg-[#f3f5f8] text-slate-900 dark:bg-[#0a0f16] dark:text-slate-50">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-hidden p-3">
            <SpecBoardPanel workspaceId={workspaceId} />
          </div>
        </main>
      </div>
    </DesktopAppShell>
  );
}
