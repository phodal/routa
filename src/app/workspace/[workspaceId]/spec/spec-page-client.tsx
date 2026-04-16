"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";

// ─── Types ─────────────────────────────────────────────────────────────────

type SpecIssue = {
  filename: string;
  title: string;
  date: string;
  kind: string;
  status: string;
  severity: string;
  area: string;
  tags: string[];
  reportedBy: string;
  relatedIssues: string[];
  githubIssue: number | null;
  githubState: string | null;
  githubUrl: string | null;
  body: string;
};

type Filters = {
  kind: string;
  severity: string;
  area: string;
  search: string;
};

const STATUS_COLUMNS = ["open", "investigating", "resolved", "wontfix"] as const;

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-500 text-black",
  low: "bg-blue-400 text-white",
  info: "bg-gray-400 text-white",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  investigating: "Investigating",
  resolved: "Resolved",
  wontfix: "Won't Fix",
};

const STATUS_COLORS: Record<string, string> = {
  open: "border-red-400/50 bg-red-950/20",
  investigating: "border-yellow-400/50 bg-yellow-950/20",
  resolved: "border-green-400/50 bg-green-950/20",
  wontfix: "border-gray-400/50 bg-gray-950/20",
};

const STATUS_HEADER_COLORS: Record<string, string> = {
  open: "text-red-400",
  investigating: "text-yellow-400",
  resolved: "text-green-400",
  wontfix: "text-gray-400",
};

// ─── SpecFilterBar ─────────────────────────────────────────────────────────

function SpecFilterBar({
  filters,
  onFiltersChange,
  issues,
}: {
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  issues: SpecIssue[];
}) {
  const { t } = useTranslation();
  const kinds = useMemo(() => [...new Set(issues.map((i) => i.kind))].sort(), [issues]);
  const severities = useMemo(() => [...new Set(issues.map((i) => i.severity))].sort(), [issues]);
  const areas = useMemo(
    () => [...new Set(issues.map((i) => i.area).filter(Boolean))].sort(),
    [issues],
  );

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-desktop-border bg-desktop-bg-secondary/50">
      <input
        type="text"
        placeholder={t.common.search + "…"}
        value={filters.search}
        onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
        className="h-8 w-56 rounded-md border border-desktop-border bg-desktop-bg-primary px-3 text-sm text-desktop-text-primary placeholder:text-desktop-text-secondary focus:outline-none focus:ring-1 focus:ring-desktop-accent"
      />

      <select
        value={filters.kind}
        onChange={(e) => onFiltersChange({ ...filters, kind: e.target.value })}
        className="h-8 rounded-md border border-desktop-border bg-desktop-bg-primary px-2 text-sm text-desktop-text-primary"
      >
        <option value="">Kind: {t.common.all}</option>
        {kinds.map((k) => (
          <option key={k} value={k}>{k}</option>
        ))}
      </select>

      <select
        value={filters.severity}
        onChange={(e) => onFiltersChange({ ...filters, severity: e.target.value })}
        className="h-8 rounded-md border border-desktop-border bg-desktop-bg-primary px-2 text-sm text-desktop-text-primary"
      >
        <option value="">Severity: {t.common.all}</option>
        {severities.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      <select
        value={filters.area}
        onChange={(e) => onFiltersChange({ ...filters, area: e.target.value })}
        className="h-8 rounded-md border border-desktop-border bg-desktop-bg-primary px-2 text-sm text-desktop-text-primary"
      >
        <option value="">Area: {t.common.all}</option>
        {areas.map((a) => (
          <option key={a} value={a}>{a}</option>
        ))}
      </select>
    </div>
  );
}

// ─── SpecCard ──────────────────────────────────────────────────────────────

function SpecCard({
  issue,
  onClick,
}: {
  issue: SpecIssue;
  onClick: () => void;
}) {
  const severityClass = SEVERITY_COLORS[issue.severity] ?? SEVERITY_COLORS.info;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-lg border border-desktop-border bg-desktop-bg-primary p-3 shadow-sm transition-colors hover:border-desktop-accent/40 hover:shadow-md cursor-pointer"
    >
      <div className="mb-2 text-sm font-medium text-desktop-text-primary line-clamp-2 leading-snug">
        {issue.title || issue.filename}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${severityClass}`}>
          {issue.severity}
        </span>
        {issue.kind !== "issue" && (
          <span className="inline-block rounded bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 text-[10px] font-medium">
            {issue.kind}
          </span>
        )}
        {issue.githubIssue != null && (
          <span className="inline-block rounded bg-purple-500/20 text-purple-300 px-1.5 py-0.5 text-[10px] font-medium">
            #{issue.githubIssue}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 text-[11px] text-desktop-text-secondary">
        {issue.area && <span className="truncate">{issue.area}</span>}
        {issue.date && <span className="shrink-0">{issue.date}</span>}
      </div>

      {issue.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {issue.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="inline-block rounded bg-desktop-bg-active px-1.5 py-0.5 text-[10px] text-desktop-text-secondary"
            >
              {tag}
            </span>
          ))}
          {issue.tags.length > 3 && (
            <span className="text-[10px] text-desktop-text-secondary">+{issue.tags.length - 3}</span>
          )}
        </div>
      )}
    </button>
  );
}

// ─── SpecCardDetail ────────────────────────────────────────────────────────

function SpecCardDetail({
  issue,
  onClose,
}: {
  issue: SpecIssue;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const severityClass = SEVERITY_COLORS[issue.severity] ?? SEVERITY_COLORS.info;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto h-full w-full max-w-2xl border-l border-desktop-border bg-desktop-bg-primary shadow-2xl overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-desktop-border bg-desktop-bg-secondary px-6 py-4">
          <h2 className="text-lg font-semibold text-desktop-text-primary truncate pr-4">
            {issue.title || issue.filename}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md px-3 py-1 text-sm text-desktop-text-secondary hover:bg-desktop-bg-active"
          >
            {t.common.closeEsc}
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Metadata */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${severityClass}`}>
              {issue.severity}
            </span>
            <span className="rounded bg-desktop-bg-active px-2 py-0.5 text-xs text-desktop-text-secondary">
              {issue.status}
            </span>
            <span className="rounded bg-desktop-bg-active px-2 py-0.5 text-xs text-desktop-text-secondary">
              {issue.kind}
            </span>
            {issue.area && (
              <span className="rounded bg-desktop-bg-active px-2 py-0.5 text-xs text-desktop-text-secondary">
                {issue.area}
              </span>
            )}
          </div>

          {/* Info rows */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {issue.date && (
              <>
                <dt className="text-desktop-text-secondary">Date</dt>
                <dd className="text-desktop-text-primary">{issue.date}</dd>
              </>
            )}
            {issue.reportedBy && (
              <>
                <dt className="text-desktop-text-secondary">Reported by</dt>
                <dd className="text-desktop-text-primary">{issue.reportedBy}</dd>
              </>
            )}
            {issue.githubIssue != null && (
              <>
                <dt className="text-desktop-text-secondary">GitHub</dt>
                <dd>
                  {issue.githubUrl ? (
                    <a
                      href={issue.githubUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-desktop-accent hover:underline"
                    >
                      #{issue.githubIssue} ({issue.githubState ?? "unknown"})
                    </a>
                  ) : (
                    <span className="text-desktop-text-primary">#{issue.githubIssue}</span>
                  )}
                </dd>
              </>
            )}
            <dt className="text-desktop-text-secondary">File</dt>
            <dd className="text-desktop-text-primary font-mono text-xs">{issue.filename}</dd>
          </dl>

          {/* Tags */}
          {issue.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {issue.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-desktop-bg-active px-2 py-0.5 text-xs text-desktop-text-secondary"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Body */}
          <div className="border-t border-desktop-border pt-4">
            <pre className="whitespace-pre-wrap break-words text-sm text-desktop-text-primary font-sans leading-relaxed">
              {issue.body}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SpecBoard ─────────────────────────────────────────────────────────────

function SpecBoard({
  issues,
  onSelectIssue,
}: {
  issues: SpecIssue[];
  onSelectIssue: (issue: SpecIssue) => void;
}) {
  const grouped = useMemo(() => {
    const map: Record<string, SpecIssue[]> = {};
    for (const status of STATUS_COLUMNS) {
      map[status] = [];
    }
    for (const issue of issues) {
      const col = STATUS_COLUMNS.includes(issue.status as typeof STATUS_COLUMNS[number])
        ? issue.status
        : "open";
      map[col]?.push(issue);
    }
    return map;
  }, [issues]);

  return (
    <div className="flex-1 flex gap-4 overflow-x-auto p-4">
      {STATUS_COLUMNS.map((status) => {
        const columnIssues = grouped[status] ?? [];
        return (
          <div
            key={status}
            className={`flex w-72 shrink-0 flex-col rounded-xl border ${STATUS_COLORS[status]} overflow-hidden`}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-desktop-border/30">
              <span className={`text-sm font-semibold ${STATUS_HEADER_COLORS[status]}`}>
                {STATUS_LABELS[status] ?? status}
              </span>
              <span className="rounded-full bg-desktop-bg-active px-2 py-0.5 text-xs text-desktop-text-secondary">
                {columnIssues.length}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {columnIssues.map((issue) => (
                <SpecCard
                  key={issue.filename}
                  issue={issue}
                  onClick={() => onSelectIssue(issue)}
                />
              ))}
              {columnIssues.length === 0 && (
                <div className="py-8 text-center text-xs text-desktop-text-secondary opacity-60">
                  No issues
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── SpecPageClient ────────────────────────────────────────────────────────

export function SpecPageClient() {
  const params = useParams();
  const workspaceId = (params?.workspaceId as string) || "default";
  const { t } = useTranslation();

  const [allIssues, setAllIssues] = useState<SpecIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<SpecIssue | null>(null);
  const [filters, setFilters] = useState<Filters>({
    kind: "",
    severity: "",
    area: "",
    search: "",
  });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const res = await desktopAwareFetch(
          `/api/spec/issues?workspaceId=${encodeURIComponent(workspaceId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = await res.json();
        if (controller.signal.aborted) return;
        setAllIssues(Array.isArray(data?.issues) ? data.issues : []);
        setError(null);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [workspaceId]);

  const filteredIssues = useMemo(() => {
    return allIssues.filter((issue) => {
      if (filters.kind && issue.kind !== filters.kind) return false;
      if (filters.severity && issue.severity !== filters.severity) return false;
      if (filters.area && issue.area !== filters.area) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const haystack = `${issue.title} ${issue.filename} ${issue.area} ${issue.tags.join(" ")}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [allIssues, filters]);

  const handleClose = useCallback(() => setSelectedIssue(null), []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-desktop-text-secondary">
        <span className="animate-pulse">{t.common.loading}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-red-400">
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-desktop-bg-primary">
      <div className="flex items-center justify-between px-4 py-3 border-b border-desktop-border">
        <h1 className="text-lg font-semibold text-desktop-text-primary">{t.nav.spec}</h1>
        <span className="text-sm text-desktop-text-secondary">
          {filteredIssues.length} / {allIssues.length} issues
        </span>
      </div>

      <SpecFilterBar filters={filters} onFiltersChange={setFilters} issues={allIssues} />

      <SpecBoard issues={filteredIssues} onSelectIssue={setSelectedIssue} />

      {selectedIssue && (
        <SpecCardDetail issue={selectedIssue} onClose={handleClose} />
      )}
    </div>
  );
}
