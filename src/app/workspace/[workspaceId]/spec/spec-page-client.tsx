"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { MarkdownViewer } from "@/client/components/markdown/markdown-viewer";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";

const STATUS_COLUMNS = ["open", "investigating", "resolved", "wontfix"] as const;

type SpecStatus = typeof STATUS_COLUMNS[number];
type TranslationT = ReturnType<typeof useTranslation>["t"];

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

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-500 text-black",
  low: "bg-blue-400 text-white",
  info: "bg-gray-400 text-white",
};

const STATUS_COLORS: Record<SpecStatus, string> = {
  open: "border-red-400/50 bg-red-950/20",
  investigating: "border-yellow-400/50 bg-yellow-950/20",
  resolved: "border-green-400/50 bg-green-950/20",
  wontfix: "border-gray-400/50 bg-gray-950/20",
};

const STATUS_HEADER_COLORS: Record<SpecStatus, string> = {
  open: "text-red-400",
  investigating: "text-yellow-400",
  resolved: "text-green-400",
  wontfix: "text-gray-400",
};

function normalizeSpecStatus(value: string): SpecStatus {
  const normalized = value.trim().toLowerCase();
  if (normalized === "closed") return "resolved";
  return STATUS_COLUMNS.includes(normalized as SpecStatus) ? normalized as SpecStatus : "open";
}

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

function SpecFilterBar({
  filters,
  onFiltersChange,
  issues,
}: {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  issues: SpecIssue[];
}) {
  const { t } = useTranslation();
  const kinds = useMemo(() => [...new Set(issues.map((issue) => issue.kind))].sort(), [issues]);
  const severities = useMemo(
    () => [...new Set(issues.map((issue) => issue.severity))].sort(),
    [issues],
  );
  const areas = useMemo(
    () => [...new Set(issues.map((issue) => issue.area).filter(Boolean))].sort(),
    [issues],
  );

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-desktop-border bg-desktop-bg-secondary/50 px-4 py-3">
      <input
        aria-label={t.common.search}
        type="text"
        placeholder={`${t.common.search}…`}
        value={filters.search}
        onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
        className="h-8 w-56 rounded-md border border-desktop-border bg-desktop-bg-primary px-3 text-sm text-desktop-text-primary placeholder:text-desktop-text-secondary focus:outline-none focus:ring-1 focus:ring-desktop-accent"
      />

      <select
        aria-label={t.specBoard.kind}
        value={filters.kind}
        onChange={(event) => onFiltersChange({ ...filters, kind: event.target.value })}
        className="h-8 rounded-md border border-desktop-border bg-desktop-bg-primary px-2 text-sm text-desktop-text-primary"
      >
        <option value="">{`${t.specBoard.kind}: ${t.common.all}`}</option>
        {kinds.map((kind) => (
          <option key={kind} value={kind}>{kind}</option>
        ))}
      </select>

      <select
        aria-label={t.specBoard.severity}
        value={filters.severity}
        onChange={(event) => onFiltersChange({ ...filters, severity: event.target.value })}
        className="h-8 rounded-md border border-desktop-border bg-desktop-bg-primary px-2 text-sm text-desktop-text-primary"
      >
        <option value="">{`${t.specBoard.severity}: ${t.common.all}`}</option>
        {severities.map((severity) => (
          <option key={severity} value={severity}>{severity}</option>
        ))}
      </select>

      <select
        aria-label={t.specBoard.area}
        value={filters.area}
        onChange={(event) => onFiltersChange({ ...filters, area: event.target.value })}
        className="h-8 rounded-md border border-desktop-border bg-desktop-bg-primary px-2 text-sm text-desktop-text-primary"
      >
        <option value="">{`${t.specBoard.area}: ${t.common.all}`}</option>
        {areas.map((area) => (
          <option key={area} value={area}>{area}</option>
        ))}
      </select>
    </div>
  );
}

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
      className="w-full cursor-pointer rounded-lg border border-desktop-border bg-desktop-bg-primary p-3 text-left shadow-sm transition-colors hover:border-desktop-accent/40 hover:shadow-md"
    >
      <div className="mb-2 line-clamp-2 text-sm font-medium leading-snug text-desktop-text-primary">
        {issue.title || issue.filename}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${severityClass}`}>
          {issue.severity}
        </span>
        {issue.kind !== "issue" ? (
          <span className="inline-block rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300">
            {issue.kind}
          </span>
        ) : null}
        {issue.githubIssue != null ? (
          <span className="inline-block rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
            #{issue.githubIssue}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2 text-[11px] text-desktop-text-secondary">
        {issue.area ? <span className="truncate">{issue.area}</span> : null}
        {issue.date ? <span className="shrink-0">{issue.date}</span> : null}
      </div>

      {issue.tags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {issue.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="inline-block rounded bg-desktop-bg-active px-1.5 py-0.5 text-[10px] text-desktop-text-secondary"
            >
              {tag}
            </span>
          ))}
          {issue.tags.length > 3 ? (
            <span className="text-[10px] text-desktop-text-secondary">+{issue.tags.length - 3}</span>
          ) : null}
        </div>
      ) : null}
    </button>
  );
}

function SpecCardDetail({
  issue,
  onClose,
}: {
  issue: SpecIssue;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const severityClass = SEVERITY_COLORS[issue.severity] ?? SEVERITY_COLORS.info;
  const statusLabels = getStatusLabels(t);
  const normalizedStatus = normalizeSpecStatus(issue.status);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={issue.title || issue.filename}
        className="relative ml-auto h-full w-full max-w-2xl overflow-y-auto border-l border-desktop-border bg-desktop-bg-primary shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-desktop-border bg-desktop-bg-secondary px-6 py-4">
          <h2 className="truncate pr-4 text-lg font-semibold text-desktop-text-primary">
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

        <div className="space-y-4 px-6 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${severityClass}`}>
              {issue.severity}
            </span>
            <span className="rounded bg-desktop-bg-active px-2 py-0.5 text-xs text-desktop-text-secondary">
              {statusLabels[normalizedStatus]}
            </span>
            <span className="rounded bg-desktop-bg-active px-2 py-0.5 text-xs text-desktop-text-secondary">
              {issue.kind}
            </span>
            {issue.area ? (
              <span className="rounded bg-desktop-bg-active px-2 py-0.5 text-xs text-desktop-text-secondary">
                {issue.area}
              </span>
            ) : null}
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {issue.date ? (
              <>
                <dt className="text-desktop-text-secondary">{t.specBoard.date}</dt>
                <dd className="text-desktop-text-primary">{issue.date}</dd>
              </>
            ) : null}
            {issue.reportedBy ? (
              <>
                <dt className="text-desktop-text-secondary">{t.specBoard.reportedBy}</dt>
                <dd className="text-desktop-text-primary">{issue.reportedBy}</dd>
              </>
            ) : null}
            {issue.githubIssue != null ? (
              <>
                <dt className="text-desktop-text-secondary">{t.specBoard.github}</dt>
                <dd>
                  {issue.githubUrl ? (
                    <a
                      href={issue.githubUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-desktop-accent hover:underline"
                    >
                      #{issue.githubIssue} ({issue.githubState ?? t.specBoard.githubStateUnknown})
                    </a>
                  ) : (
                    <span className="text-desktop-text-primary">#{issue.githubIssue}</span>
                  )}
                </dd>
              </>
            ) : null}
            <dt className="text-desktop-text-secondary">{t.specBoard.file}</dt>
            <dd className="font-mono text-xs text-desktop-text-primary">{issue.filename}</dd>
          </dl>

          {issue.tags.length > 0 ? (
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
          ) : null}

          <div className="border-t border-desktop-border pt-4">
            <MarkdownViewer content={issue.body} className="text-sm text-desktop-text-primary" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SpecBoard({
  issues,
  onSelectIssue,
}: {
  issues: SpecIssue[];
  onSelectIssue: (issue: SpecIssue) => void;
}) {
  const { t } = useTranslation();
  const statusLabels = getStatusLabels(t);
  const grouped = useMemo(() => {
    const map: Record<SpecStatus, SpecIssue[]> = {
      open: [],
      investigating: [],
      resolved: [],
      wontfix: [],
    };

    for (const issue of issues) {
      map[normalizeSpecStatus(issue.status)].push(issue);
    }

    return map;
  }, [issues]);

  return (
    <div className="flex flex-1 gap-4 overflow-x-auto p-4">
      {STATUS_COLUMNS.map((status) => {
        const columnIssues = grouped[status];
        return (
          <div
            key={status}
            className={`flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border ${STATUS_COLORS[status]}`}
          >
            <div className="flex items-center justify-between border-b border-desktop-border/30 px-4 py-3">
              <span className={`text-sm font-semibold ${STATUS_HEADER_COLORS[status]}`}>
                {statusLabels[status]}
              </span>
              <span className="rounded-full bg-desktop-bg-active px-2 py-0.5 text-xs text-desktop-text-secondary">
                {columnIssues.length}
              </span>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto p-2">
              {columnIssues.map((issue) => (
                <SpecCard
                  key={issue.filename}
                  issue={issue}
                  onClick={() => onSelectIssue(issue)}
                />
              ))}
              {columnIssues.length === 0 ? (
                <div className="py-8 text-center text-xs text-desktop-text-secondary opacity-60">
                  {t.specBoard.noIssues}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

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
    setError(null);

    void (async () => {
      try {
        const response = await desktopAwareFetch(
          `/api/spec/issues?workspaceId=${encodeURIComponent(workspaceId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(extractErrorMessage(payload, t.specBoard.failedToLoad));
        }

        if (controller.signal.aborted) {
          return;
        }

        const issues = Array.isArray(payload?.issues) ? payload.issues as SpecIssue[] : [];
        setAllIssues(issues);
        setSelectedIssue((current) => current
          ? issues.find((issue) => issue.filename === current.filename) ?? null
          : null);
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          return;
        }

        setError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [t.specBoard.failedToLoad, workspaceId]);

  const filteredIssues = useMemo(() => {
    return allIssues.filter((issue) => {
      if (filters.kind && issue.kind !== filters.kind) return false;
      if (filters.severity && issue.severity !== filters.severity) return false;
      if (filters.area && issue.area !== filters.area) return false;

      if (filters.search) {
        const query = filters.search.toLowerCase();
        const haystack = [
          issue.title,
          issue.filename,
          issue.area,
          issue.body,
          issue.tags.join(" "),
          issue.relatedIssues.join(" "),
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(query)) {
          return false;
        }
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
      <div className="flex h-full items-center justify-center px-6 text-red-400">
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-desktop-bg-primary">
      <div className="flex items-center justify-between border-b border-desktop-border px-4 py-3">
        <h1 className="text-lg font-semibold text-desktop-text-primary">{t.nav.spec}</h1>
        <span className="text-sm text-desktop-text-secondary">
          {filteredIssues.length} / {allIssues.length}
        </span>
      </div>

      <SpecFilterBar filters={filters} onFiltersChange={setFilters} issues={allIssues} />
      <SpecBoard issues={filteredIssues} onSelectIssue={setSelectedIssue} />

      {selectedIssue ? (
        <SpecCardDetail issue={selectedIssue} onClose={handleClose} />
      ) : null}
    </div>
  );
}
