"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowUpRight,
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

type ResolvedRelation = {
  raw: string;
  key: string;
  label: string;
  kind: "local" | "github" | "external";
  href: string | null;
  targetFilename: string | null;
};

type IssueRelations = {
  outgoing: ResolvedRelation[];
  incoming: SpecIssue[];
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
    column: string;
    header: string;
    badge: string;
  }
> = {
  open: {
    column:
      "border-rose-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,241,242,0.92))] dark:border-rose-500/20 dark:bg-[linear-gradient(180deg,rgba(18,18,24,0.96),rgba(60,14,20,0.88))]",
    header: "text-rose-700 dark:text-rose-200",
    badge: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200",
  },
  investigating: {
    column:
      "border-amber-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,251,235,0.94))] dark:border-amber-500/20 dark:bg-[linear-gradient(180deg,rgba(18,18,24,0.96),rgba(62,44,12,0.88))]",
    header: "text-amber-700 dark:text-amber-200",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200",
  },
  resolved: {
    column:
      "border-emerald-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(236,253,245,0.94))] dark:border-emerald-500/20 dark:bg-[linear-gradient(180deg,rgba(18,18,24,0.96),rgba(8,54,40,0.86))]",
    header: "text-emerald-700 dark:text-emerald-200",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
  },
  wontfix: {
    column:
      "border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(241,245,249,0.94))] dark:border-slate-500/20 dark:bg-[linear-gradient(180deg,rgba(18,18,24,0.96),rgba(30,41,59,0.84))]",
    header: "text-slate-700 dark:text-slate-200",
    badge: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200",
  },
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

function normalizeDocsIssueFilename(value: string): string | null {
  const normalized = value.trim().replace(/^\.?\//u, "");
  if (!normalized || /^https?:\/\//u.test(normalized)) {
    return null;
  }

  if (normalized.includes("docs/issues/")) {
    const parts = normalized.split("/");
    return parts[parts.length - 1] ?? null;
  }

  if (normalized.endsWith(".md")) {
    const parts = normalized.split("/");
    return parts[parts.length - 1] ?? null;
  }

  return null;
}

function normalizeGitHubIssueUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/u);
    if (!match) {
      return null;
    }
    return `https://github.com/${match[1]}/${match[2]}/issues/${match[3]}`;
  } catch {
    return null;
  }
}

function formatFilenameLabel(value: string): string {
  return value.replace(/^docs\/issues\//u, "").replace(/\.md$/u, "");
}

function formatGitHubIssueLabel(value: string): string {
  const normalizedUrl = normalizeGitHubIssueUrl(value);
  if (!normalizedUrl) {
    return value;
  }

  const match = normalizedUrl.match(/\/issues\/(\d+)$/u);
  return match ? `#${match[1]}` : normalizedUrl;
}

function formatExternalLabel(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.hostname}${parsed.pathname}`.replace(/\/$/u, "");
  } catch {
    return value;
  }
}

function resolveIssueRelation(
  rawValue: string,
  issueByFilename: Map<string, SpecIssue>,
  issueByGitHubUrl: Map<string, SpecIssue>,
): ResolvedRelation | null {
  const raw = rawValue.trim();
  if (!raw) {
    return null;
  }

  const localFilename = normalizeDocsIssueFilename(raw);
  if (localFilename) {
    const targetIssue = issueByFilename.get(localFilename);
    return {
      raw,
      key: targetIssue ? `local:${targetIssue.filename}` : `local:${localFilename}`,
      label: targetIssue?.title || formatFilenameLabel(localFilename),
      kind: "local",
      href: null,
      targetFilename: targetIssue?.filename ?? null,
    };
  }

  const githubUrl = normalizeGitHubIssueUrl(raw);
  if (githubUrl) {
    const targetIssue = issueByGitHubUrl.get(githubUrl);
    return {
      raw,
      key: targetIssue ? `local:${targetIssue.filename}` : `github:${githubUrl}`,
      label: targetIssue?.title || formatGitHubIssueLabel(githubUrl),
      kind: "github",
      href: githubUrl,
      targetFilename: targetIssue?.filename ?? null,
    };
  }

  return {
    raw,
    key: `external:${raw}`,
    label: formatExternalLabel(raw),
    kind: "external",
    href: (() => {
      try {
        return new URL(raw).toString();
      } catch {
        return null;
      }
    })(),
    targetFilename: null,
  };
}

function dedupeRelations(relations: ResolvedRelation[]): ResolvedRelation[] {
  const seen = new Set<string>();
  const deduped: ResolvedRelation[] = [];

  for (const relation of relations) {
    if (seen.has(relation.key)) {
      continue;
    }
    seen.add(relation.key);
    deduped.push(relation);
  }

  return deduped;
}

function dedupeIncomingIssues(issues: SpecIssue[]): SpecIssue[] {
  const seen = new Set<string>();
  const deduped: SpecIssue[] = [];

  for (const issue of issues) {
    if (seen.has(issue.filename)) {
      continue;
    }
    seen.add(issue.filename);
    deduped.push(issue);
  }

  return deduped;
}

function SpecSummaryMetric({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-black/6 bg-white/78 px-4 py-4 shadow-[0_12px_30px_rgba(15,23,42,0.08)] backdrop-blur dark:border-white/10 dark:bg-white/6 dark:shadow-none">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-900 dark:text-slate-50">
        {value}
      </div>
    </div>
  );
}

function SpecFilterBar({
  filters,
  filteredCount,
  totalCount,
  onFiltersChange,
  issues,
}: {
  filters: Filters;
  filteredCount: number;
  totalCount: number;
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
    <div className="rounded-[24px] border border-black/6 bg-white/84 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.06)] backdrop-blur dark:border-white/10 dark:bg-white/6 dark:shadow-none">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,0.8fr))_auto]">
        <input
          aria-label={t.common.search}
          type="text"
          placeholder={`${t.common.search}…`}
          value={filters.search}
          onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
          className="h-11 rounded-2xl border border-black/8 bg-[#fcfbf8] px-4 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-300 dark:border-white/10 dark:bg-[#111923] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-white/20"
        />

        <select
          aria-label={t.specBoard.kind}
          value={filters.kind}
          onChange={(event) => onFiltersChange({ ...filters, kind: event.target.value })}
          className="h-11 rounded-2xl border border-black/8 bg-[#fcfbf8] px-3 text-sm text-slate-700 outline-none transition-colors focus:border-slate-300 dark:border-white/10 dark:bg-[#111923] dark:text-slate-100 dark:focus:border-white/20"
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
          className="h-11 rounded-2xl border border-black/8 bg-[#fcfbf8] px-3 text-sm text-slate-700 outline-none transition-colors focus:border-slate-300 dark:border-white/10 dark:bg-[#111923] dark:text-slate-100 dark:focus:border-white/20"
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
          className="h-11 rounded-2xl border border-black/8 bg-[#fcfbf8] px-3 text-sm text-slate-700 outline-none transition-colors focus:border-slate-300 dark:border-white/10 dark:bg-[#111923] dark:text-slate-100 dark:focus:border-white/20"
        >
          <option value="">{`${t.specBoard.area}: ${t.common.all}`}</option>
          {areas.map((area) => (
            <option key={area} value={area}>{area}</option>
          ))}
        </select>

        <div className="flex items-center justify-end rounded-2xl border border-dashed border-black/8 px-4 text-sm text-slate-500 dark:border-white/10 dark:text-slate-300">
          {filteredCount} / {totalCount}
        </div>
      </div>
    </div>
  );
}

function SpecRelationPill({
  relation,
  onSelectLocalIssue,
}: {
  relation: ResolvedRelation;
  onSelectLocalIssue: (filename: string) => void;
}) {
  const baseClassName =
    "inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors";

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

function SpecCard({
  issue,
  relations,
  statusLabel,
  onClick,
}: {
  issue: SpecIssue;
  relations: IssueRelations;
  statusLabel: string;
  onClick: () => void;
}) {
  const severityClass = SEVERITY_STYLES[issue.severity] ?? SEVERITY_STYLES.info;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-[20px] border border-black/7 bg-white/88 p-4 text-left shadow-[0_12px_30px_rgba(15,23,42,0.06)] transition-all hover:-translate-y-0.5 hover:border-black/12 hover:shadow-[0_16px_36px_rgba(15,23,42,0.1)] dark:border-white/10 dark:bg-[#111923]/92 dark:shadow-none dark:hover:border-white/20 dark:hover:bg-[#141d28]"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-sm font-semibold leading-6 text-slate-900 dark:text-slate-50">
            {issue.title || issue.filename}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {statusLabel}
          </div>
        </div>
        <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase ${severityClass}`}>
          {issue.severity}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        {issue.kind !== "issue" ? (
          <span className="rounded-full bg-indigo-50 px-2 py-1 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200">
            {issue.kind}
          </span>
        ) : null}
        {issue.area ? (
          <span className="rounded-full bg-black/[0.04] px-2 py-1 text-slate-600 dark:bg-white/6 dark:text-slate-200">
            {issue.area}
          </span>
        ) : null}
        {issue.date ? <span>{issue.date}</span> : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        {issue.githubIssue != null ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200">
            <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.8} />
            #{issue.githubIssue}
          </span>
        ) : null}
        {relations.outgoing.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.04] px-2.5 py-1 text-slate-600 dark:bg-white/6 dark:text-slate-200">
            <Link2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            {relations.outgoing.length}
          </span>
        ) : null}
        {relations.incoming.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.04] px-2.5 py-1 text-slate-600 dark:bg-white/6 dark:text-slate-200">
            <GitBranch className="h-3.5 w-3.5" strokeWidth={1.8} />
            {relations.incoming.length}
          </span>
        ) : null}
      </div>

      {issue.tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {issue.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-black/6 bg-[#f6f3ee] px-2 py-1 text-[11px] text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
            >
              {tag}
            </span>
          ))}
          {issue.tags.length > 3 ? (
            <span className="self-center text-[11px] text-slate-500 dark:text-slate-400">
              +{issue.tags.length - 3}
            </span>
          ) : null}
        </div>
      ) : null}
    </button>
  );
}

function SpecCardDetail({
  issue,
  relations,
  onClose,
  onSelectLinkedIssue,
}: {
  issue: SpecIssue;
  relations: IssueRelations;
  onClose: () => void;
  onSelectLinkedIssue: (filename: string) => void;
}) {
  const { t } = useTranslation();
  const statusLabels = getStatusLabels(t);
  const severityClass = SEVERITY_STYLES[issue.severity] ?? SEVERITY_STYLES.info;
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
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label={t.common.close}
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={issue.title || issue.filename}
        className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-black/7 bg-[#f8f6f1] text-slate-900 shadow-2xl dark:border-white/10 dark:bg-[#0d141d] dark:text-slate-50"
      >
        <div className="border-b border-black/6 px-6 py-5 dark:border-white/10">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                {t.nav.spec}
              </div>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-slate-900 dark:text-slate-50">
                {issue.title || issue.filename}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-black/8 bg-white/80 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
            >
              {t.common.closeEsc}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase ${severityClass}`}>
              {issue.severity}
            </span>
            <span className="inline-flex rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] text-slate-600 dark:bg-white/6 dark:text-slate-200">
              {statusLabels[normalizedStatus]}
            </span>
            <span className="inline-flex rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] text-slate-600 dark:bg-white/6 dark:text-slate-200">
              {issue.kind}
            </span>
            {issue.area ? (
              <span className="inline-flex rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] text-slate-600 dark:bg-white/6 dark:text-slate-200">
                {issue.area}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-5">
            <section className="rounded-[22px] border border-black/6 bg-white/80 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/5 dark:shadow-none">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                {issue.date ? (
                  <>
                    <dt className="text-slate-500 dark:text-slate-400">{t.specBoard.date}</dt>
                    <dd className="text-slate-900 dark:text-slate-50">{issue.date}</dd>
                  </>
                ) : null}
                {issue.reportedBy ? (
                  <>
                    <dt className="text-slate-500 dark:text-slate-400">{t.specBoard.reportedBy}</dt>
                    <dd className="text-slate-900 dark:text-slate-50">{issue.reportedBy}</dd>
                  </>
                ) : null}
                {issue.githubIssue != null ? (
                  <>
                    <dt className="text-slate-500 dark:text-slate-400">{t.specBoard.github}</dt>
                    <dd>
                      {issue.githubUrl ? (
                        <a
                          href={issue.githubUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sky-700 hover:underline dark:text-sky-200"
                        >
                          <span>#{issue.githubIssue} ({issue.githubState ?? t.specBoard.githubStateUnknown})</span>
                          <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.8} />
                        </a>
                      ) : (
                        <span className="text-slate-900 dark:text-slate-50">#{issue.githubIssue}</span>
                      )}
                    </dd>
                  </>
                ) : null}
                <dt className="text-slate-500 dark:text-slate-400">{t.specBoard.file}</dt>
                <dd className="font-mono text-xs text-slate-700 dark:text-slate-200">{issue.filename}</dd>
              </dl>
            </section>

            <section className="rounded-[22px] border border-black/6 bg-white/80 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/5 dark:shadow-none">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                {t.specBoard.issueLinks}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {relations.outgoing.length > 0 ? (
                  relations.outgoing.map((relation) => (
                    <SpecRelationPill
                      key={relation.key}
                      relation={relation}
                      onSelectLocalIssue={onSelectLinkedIssue}
                    />
                  ))
                ) : (
                  <div className="text-sm text-slate-500 dark:text-slate-400">
                    {t.specBoard.noLinkedIssues}
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-[22px] border border-black/6 bg-white/80 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/5 dark:shadow-none">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                {t.specBoard.linkedFrom}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {relations.incoming.length > 0 ? (
                  relations.incoming.map((incomingIssue) => (
                    <button
                      key={incomingIssue.filename}
                      type="button"
                      onClick={() => onSelectLinkedIssue(incomingIssue.filename)}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-black/8 bg-black/[0.03] px-3 py-1 text-xs text-slate-700 transition-colors hover:bg-black/[0.05] dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10"
                    >
                      <GitBranch className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                      <span className="truncate">{incomingIssue.title || incomingIssue.filename}</span>
                    </button>
                  ))
                ) : (
                  <div className="text-sm text-slate-500 dark:text-slate-400">
                    {t.specBoard.noBacklinks}
                  </div>
                )}
              </div>
            </section>

            {issue.tags.length > 0 ? (
              <section className="rounded-[22px] border border-black/6 bg-white/80 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/5 dark:shadow-none">
                <div className="flex flex-wrap gap-2">
                  {issue.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-black/6 bg-[#f6f3ee] px-2.5 py-1 text-xs text-slate-600 dark:border-white/10 dark:bg-white/6 dark:text-slate-200"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="rounded-[22px] border border-black/6 bg-white/80 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/5 dark:shadow-none">
              <MarkdownViewer content={issue.body} className="text-sm text-slate-700 dark:text-slate-100" />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function SpecBoard({
  issues,
  relationsByFilename,
  onSelectIssue,
}: {
  issues: SpecIssue[];
  relationsByFilename: Map<string, IssueRelations>;
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
    <div className="grid gap-4 xl:grid-cols-4 md:grid-cols-2">
      {STATUS_COLUMNS.map((status) => {
        const columnIssues = grouped[status];
        const theme = STATUS_THEMES[status];
        return (
          <div
            key={status}
            className={`flex min-h-[24rem] flex-col overflow-hidden rounded-[24px] border shadow-[0_18px_40px_rgba(15,23,42,0.06)] ${theme.column} dark:shadow-none`}
          >
            <div className="flex items-center justify-between border-b border-black/6 px-4 py-4 dark:border-white/10">
              <span className={`text-sm font-semibold ${theme.header}`}>
                {statusLabels[status]}
              </span>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${theme.badge}`}>
                {columnIssues.length}
              </span>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-3">
              {columnIssues.map((issue) => (
                <SpecCard
                  key={issue.filename}
                  issue={issue}
                  relations={relationsByFilename.get(issue.filename) ?? { outgoing: [], incoming: [] }}
                  statusLabel={statusLabels[normalizeSpecStatus(issue.status)]}
                  onClick={() => onSelectIssue(issue)}
                />
              ))}

              {columnIssues.length === 0 ? (
                <div className="flex h-full min-h-40 items-center justify-center rounded-[20px] border border-dashed border-black/8 bg-white/55 px-5 text-center text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400">
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
  const { t } = useTranslation();
  const params = useParams();
  const router = useRouter();
  const rawWorkspaceId = params.workspaceId as string;
  const workspaceId =
    rawWorkspaceId === "__placeholder__" && typeof window !== "undefined"
      ? (window.location.pathname.match(/^\/workspace\/([^/]+)/)?.[1] ?? rawWorkspaceId)
      : rawWorkspaceId;

  const workspacesHook = useWorkspaces();
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
        const requestPath = resolveApiPath(`/spec/issues?workspaceId=${encodeURIComponent(workspaceId)}`);
        const response = await desktopAwareFetch(requestPath, {
          cache: "no-store",
          signal: controller.signal,
        });
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
  }, [t.specBoard.failedToLoad, workspaceId]);

  const issueByFilename = useMemo(() => {
    return new Map(allIssues.map((issue) => [issue.filename, issue]));
  }, [allIssues]);

  const issueByGitHubUrl = useMemo(() => {
    const map = new Map<string, SpecIssue>();
    for (const issue of allIssues) {
      const normalizedUrl = issue.githubUrl ? normalizeGitHubIssueUrl(issue.githubUrl) : null;
      if (normalizedUrl) {
        map.set(normalizedUrl, issue);
      }
    }
    return map;
  }, [allIssues]);

  const relationsByFilename = useMemo(() => {
    const outgoingMap = new Map<string, ResolvedRelation[]>();
    const incomingMap = new Map<string, SpecIssue[]>();

    for (const issue of allIssues) {
      const outgoing = dedupeRelations(
        issue.relatedIssues
          .map((rawRelation) => resolveIssueRelation(rawRelation, issueByFilename, issueByGitHubUrl))
          .filter((relation): relation is ResolvedRelation => Boolean(relation))
          .filter((relation) => relation.targetFilename !== issue.filename),
      );

      outgoingMap.set(issue.filename, outgoing);

      for (const relation of outgoing) {
        if (!relation.targetFilename || relation.targetFilename === issue.filename) {
          continue;
        }

        const existing = incomingMap.get(relation.targetFilename) ?? [];
        existing.push(issue);
        incomingMap.set(relation.targetFilename, existing);
      }
    }

    const relationMap = new Map<string, IssueRelations>();
    for (const issue of allIssues) {
      relationMap.set(issue.filename, {
        outgoing: outgoingMap.get(issue.filename) ?? [],
        incoming: dedupeIncomingIssues(incomingMap.get(issue.filename) ?? []),
      });
    }

    return relationMap;
  }, [allIssues, issueByFilename, issueByGitHubUrl]);

  const filteredIssues = useMemo(() => {
    return allIssues.filter((issue) => {
      if (filters.kind && issue.kind !== filters.kind) return false;
      if (filters.severity && issue.severity !== filters.severity) return false;
      if (filters.area && issue.area !== filters.area) return false;

      if (filters.search) {
        const query = filters.search.toLowerCase();
        const relations = relationsByFilename.get(issue.filename) ?? { outgoing: [], incoming: [] };
        const haystack = [
          issue.title,
          issue.filename,
          issue.area,
          issue.body,
          issue.tags.join(" "),
          issue.relatedIssues.join(" "),
          relations.outgoing.map((relation) => relation.label).join(" "),
          relations.incoming.map((incomingIssue) => incomingIssue.title || incomingIssue.filename).join(" "),
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [allIssues, filters, relationsByFilename]);

  const metrics = useMemo(() => {
    const openCount = allIssues.filter((issue) => normalizeSpecStatus(issue.status) === "open").length;
    const githubLinkedCount = allIssues.filter((issue) => issue.githubIssue != null || issue.githubUrl != null).length;
    const connectedIssueCount = allIssues.filter((issue) => {
      const relations = relationsByFilename.get(issue.filename);
      return Boolean(relations && (relations.outgoing.length > 0 || relations.incoming.length > 0));
    }).length;

    return {
      total: allIssues.length,
      open: openCount,
      githubLinked: githubLinkedCount,
      connected: connectedIssueCount,
    };
  }, [allIssues, relationsByFilename]);

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

  const handleCloseDetail = useCallback(() => {
    setSelectedIssue(null);
  }, []);

  const handleSelectLinkedIssue = useCallback((filename: string) => {
    const issue = issueByFilename.get(filename);
    if (issue) {
      setSelectedIssue(issue);
    }
  }, [issueByFilename]);

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
      <div className="flex h-full min-h-0 bg-[#f6f4ef] text-slate-900 dark:bg-[#0c1118] dark:text-slate-50">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-6 py-6 lg:px-8 lg:py-8">
              <section className="overflow-hidden rounded-[32px] border border-black/6 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(247,241,231,0.92))] px-6 py-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-[linear-gradient(135deg,rgba(16,23,32,0.96),rgba(13,20,29,0.92))] dark:shadow-none lg:px-8 lg:py-7">
                <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
                  <div className="max-w-3xl">
                    <div className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-white/70 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                      <ClipboardList className="h-3.5 w-3.5" strokeWidth={1.8} />
                      {t.nav.spec}
                    </div>
                    <h1 className="mt-4 font-['Avenir_Next_Condensed','Avenir_Next','Segoe_UI','Helvetica_Neue',sans-serif] text-4xl font-semibold tracking-[-0.05em] text-slate-900 dark:text-slate-50 sm:text-5xl">
                      {t.nav.spec}
                    </h1>
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300">
                      {t.specBoard.description}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <SpecSummaryMetric label={t.common.total} value={metrics.total} />
                    <SpecSummaryMetric label={t.specBoard.statusOpen} value={metrics.open} />
                    <SpecSummaryMetric label={t.specBoard.githubLinked} value={metrics.githubLinked} />
                    <SpecSummaryMetric label={t.specBoard.connectedIssues} value={metrics.connected} />
                  </div>
                </div>
              </section>

              <SpecFilterBar
                filters={filters}
                filteredCount={filteredIssues.length}
                totalCount={allIssues.length}
                onFiltersChange={setFilters}
                issues={allIssues}
              />

              {loading ? (
                <div className="flex min-h-[28rem] items-center justify-center rounded-[28px] border border-black/6 bg-white/75 text-slate-500 shadow-[0_18px_40px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/6 dark:text-slate-300 dark:shadow-none">
                  <span className="animate-pulse">{t.common.loading}</span>
                </div>
              ) : null}

              {!loading && error ? (
                <div className="flex min-h-[20rem] items-center justify-center rounded-[28px] border border-rose-200 bg-rose-50/90 px-6 text-rose-700 shadow-[0_18px_40px_rgba(251,113,133,0.12)] dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200 dark:shadow-none">
                  <span>{error}</span>
                </div>
              ) : null}

              {!loading && !error ? (
                <section className="rounded-[28px] border border-black/6 bg-white/64 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.06)] backdrop-blur dark:border-white/10 dark:bg-white/4 dark:shadow-none">
                  <SpecBoard
                    issues={filteredIssues}
                    relationsByFilename={relationsByFilename}
                    onSelectIssue={setSelectedIssue}
                  />
                </section>
              ) : null}
            </div>
          </div>
        </main>
      </div>

      {selectedIssue ? (
        <SpecCardDetail
          issue={selectedIssue}
          relations={relationsByFilename.get(selectedIssue.filename) ?? { outgoing: [], incoming: [] }}
          onClose={handleCloseDetail}
          onSelectLinkedIssue={handleSelectLinkedIssue}
        />
      ) : null}
    </DesktopAppShell>
  );
}
