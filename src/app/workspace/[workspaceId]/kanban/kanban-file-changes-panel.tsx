"use client";

import React from "react";
import { useTranslation } from "@/i18n";
import type { KanbanRepoChanges, KanbanFileChangeItem, KanbanFileChangeStatus } from "./kanban-file-changes-types";
import {
  AlertTriangle,
  ArrowRightLeft,
  ChevronRight,
  Copy,
  FilePlus2,
  Pencil,
  Plus,
  Trash2,
  Type,
  type LucideIcon,
} from "lucide-react";


interface KanbanFileChangesPanelProps {
  repos: KanbanRepoChanges[];
  loading?: boolean;
  open: boolean;
  onClose: () => void;
}

const PREVIEW_FILE_LIMIT = 4;
type ChangeSummaryCopy = Pick<
  Record<"unavailable" | "clean" | "modifiedCount" | "untrackedCount", string>,
  "unavailable" | "clean" | "modifiedCount" | "untrackedCount"
>;
const DEFAULT_CHANGE_SUMMARY_COPY: ChangeSummaryCopy = {
  unavailable: "Unavailable",
  clean: "Clean",
  modifiedCount: "{count} modified",
  untrackedCount: "{count} untracked",
};

export const STATUS_BADGE: Record<KanbanFileChangeStatus, { short: string; className: string; icon: LucideIcon }> = {
  modified: { short: "M", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", icon: Pencil },
  added: { short: "A", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", icon: Plus },
  deleted: { short: "D", className: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", icon: Trash2 },
  renamed: { short: "R", className: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300", icon: ArrowRightLeft },
  copied: { short: "C", className: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300", icon: Copy },
  untracked: { short: "??", className: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", icon: FilePlus2 },
  typechange: { short: "T", className: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300", icon: Type },
  conflicted: { short: "U", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300", icon: AlertTriangle },
};

export function formatChangeSummary(
  repo: KanbanRepoChanges,
  copy: ChangeSummaryCopy = DEFAULT_CHANGE_SUMMARY_COPY,
): string {
  if (repo.error) return copy.unavailable;
  if (repo.status.clean) return copy.clean;
  const segments: string[] = [];
  if (repo.status.modified > 0) segments.push(copy.modifiedCount.replace("{count}", String(repo.status.modified)));
  if (repo.status.untracked > 0) segments.push(copy.untrackedCount.replace("{count}", String(repo.status.untracked)));
  return segments.join(" · ");
}

export function getKanbanFileChangesSummary(repos: KanbanRepoChanges[]) {
  const changedRepos = repos.filter((repo) => !repo.error && !repo.status.clean).length;
  const changedFiles = repos.reduce((count, repo) => count + repo.files.length, 0);
  const totalAdditions = repos.reduce((sum, repo) => {
    return sum + repo.files.reduce((fileSum, file) => fileSum + (file.additions ?? 0), 0);
  }, 0);
  const totalDeletions = repos.reduce((sum, repo) => {
    return sum + repo.files.reduce((fileSum, file) => fileSum + (file.deletions ?? 0), 0);
  }, 0);
  return { changedRepos, changedFiles, totalAdditions, totalDeletions };
}

export function splitFilePath(path: string): { name: string; directory: string | null } {
  const normalized = path.trim();
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return { name: normalized, directory: null };
  }

  return {
    name: normalized.slice(lastSlash + 1) || normalized,
    directory: normalized.slice(0, lastSlash),
  };
}

function formatFileLineDelta(file: KanbanFileChangeItem): { additions: number; deletions: number } | null {
  if (typeof file.additions !== "number" && typeof file.deletions !== "number") return null;
  return {
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
  };
}

interface FileRowProps {
  file: KanbanFileChangeItem;
  selected?: boolean;
  onClick?: (file: KanbanFileChangeItem) => void;
  onSelect?: (file: KanbanFileChangeItem, selected: boolean) => void;
  showCheckbox?: boolean;
}

export function FileRow({
  file,
  selected = false,
  onClick,
  onSelect,
  showCheckbox = false,
}: FileRowProps) {
  const { t } = useTranslation();
  const badge = STATUS_BADGE[file.status];
  const StatusIcon = badge.icon;
  const { name, directory } = splitFilePath(file.path);
  const previous = file.previousPath ? splitFilePath(file.previousPath) : null;
  const lineDelta = formatFileLineDelta(file);
  const interactive = typeof onClick === "function";
  const gridCols = showCheckbox ? "grid-cols-[20px_16px_minmax(0,1fr)_auto]" : "grid-cols-[16px_minmax(0,1fr)_auto]";
  const containerClassName = `grid w-full ${gridCols} items-start gap-x-2 gap-y-0 rounded-md px-1 py-1 text-left transition-colors ${
    selected
      ? "bg-amber-50/80 dark:bg-amber-900/10"
      : "hover:bg-slate-100/80 dark:hover:bg-[#171b27]"
  }`;

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    onSelect?.(file, e.target.checked);
  };

  const content = (
    <>
      {showCheckbox && (
        <input
          type="checkbox"
          checked={file.selected ?? false}
          onChange={handleCheckboxChange}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-amber-600 focus:ring-2 focus:ring-amber-500 dark:border-slate-600 dark:bg-slate-700"
          aria-label={`Select ${file.path}`}
        />
      )}
      <span
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center self-start rounded-sm ${badge.className}`}
        title={file.status}
        aria-label={file.status}
      >
        <StatusIcon className="h-2.5 w-2.5" />
      </span>
      <div className="min-w-0 overflow-hidden">
        <div className="block truncate text-[11px] font-medium leading-4 text-slate-800 dark:text-slate-100" title={name}>
          {name}
        </div>
        {directory && (
          <div className="block truncate text-[9px] leading-3.5 text-slate-500 dark:text-slate-400" title={directory}>
            {directory}
          </div>
        )}
        {previous && (
          <div className="mt-0.5 flex items-center gap-1 text-[9px] leading-3.5 text-slate-400 dark:text-slate-500">
            <ArrowRightLeft className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate" title={previous.name}>
              {previous.name}
            </span>
            {previous.directory && (
              <span className="truncate text-slate-400/90 dark:text-slate-500" title={previous.directory}>
                {t.kanban.fromPath} {previous.directory}
              </span>
            )}
            {!previous.directory && (
              <span className="truncate" title={file.previousPath}>
                {t.kanban.fromPath}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="mt-0.5 flex min-w-[3.25rem] shrink-0 items-center justify-end gap-1 self-start text-[10px] font-mono leading-4">
        {lineDelta ? (
          <>
            <span className="text-emerald-600 dark:text-emerald-300">+{lineDelta.additions}</span>
            <span className="text-rose-600 dark:text-rose-300">-{lineDelta.deletions}</span>
          </>
        ) : (
          <span className={`rounded-sm px-1 py-0 text-[7px] font-semibold tracking-wide ${badge.className}`}>
            {badge.short}
          </span>
        )}
      </div>
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        className={containerClassName}
        onClick={() => onClick?.(file)}
        data-testid={`kanban-file-row-${file.path}`}
        aria-pressed={selected}
      >
        {content}
      </button>
    );
  }

  return <div className={containerClassName}>{content}</div>;
}

export function KanbanFileChangesPanel({
  repos,
  loading = false,
  open,
  onClose,
}: KanbanFileChangesPanelProps) {
  const { t } = useTranslation();
  const [expandedRepos, setExpandedRepos] = React.useState<Record<string, boolean>>({});
  const [showAllRepos, setShowAllRepos] = React.useState<Record<string, boolean>>({});
  const summary = getKanbanFileChangesSummary(repos);

  return (
    <>
      {open && (
        <>
          <div
            className="absolute inset-0 z-20 bg-slate-900/10 backdrop-blur-[1px] dark:bg-black/20"
            onClick={onClose}
            data-testid="kanban-file-changes-backdrop"
          />
          <aside
            className="absolute inset-y-0 right-0 z-30 flex h-full w-[22rem] flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c]"
            data-testid="kanban-file-changes-panel"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-[#191c28]">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.kanban.fileChanges}</div>
                <div className="text-[11px] text-slate-400 dark:text-slate-500">
                  {t.kanban.reposChangedFiles.replace("{repos}", String(repos.length)).replace("{files}", String(summary.changedFiles))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {summary.changedRepos > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    {summary.changedRepos} {t.kanban.dirty}
                  </span>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-[#191c28]"
                >
                  {t.kanban.hide}
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {loading ? (
                <div className="flex items-center justify-center py-10 text-sm text-slate-400 dark:text-slate-500">
                  {t.kanban.loadingRepoChanges}
                </div>
              ) : repos.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-500">
                  {t.kanban.noReposLinkedPanel}
                </div>
              ) : (
                <div className="space-y-3">
                  {repos.map((repo) => {
                    const expanded = expandedRepos[repo.codebaseId] ?? true;
                    const showAll = showAllRepos[repo.codebaseId] ?? false;
                    const visibleFiles = showAll ? repo.files : repo.files.slice(0, PREVIEW_FILE_LIMIT);

                    return (
                      <section
                        key={repo.codebaseId}
                        className="rounded-2xl border border-slate-200/70 bg-slate-50/70 dark:border-[#202433] dark:bg-[#0d1018]"
                      >
                        <button
                          type="button"
                          onClick={() => setExpandedRepos((current) => ({ ...current, [repo.codebaseId]: !expanded }))}
                          className="flex w-full items-start justify-between gap-3 px-3.5 py-3 text-left"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                              {repo.label}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                              <span className="rounded-full bg-slate-200 px-2 py-0.5 font-medium text-slate-600 dark:bg-[#191c28] dark:text-slate-300">
                                @{repo.branch}
                              </span>
                              {repo.status.ahead > 0 && <span>{t.kanban.aheadCount.replace("{count}", String(repo.status.ahead))}</span>}
                              {repo.status.behind > 0 && <span>{t.kanban.behindCount.replace("{count}", String(repo.status.behind))}</span>}
                              <span>{formatChangeSummary(repo, t.kanban)}</span>
                            </div>
                          </div>
                          <ChevronRight className={`mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}/>
                        </button>

                        {expanded && (
                          <div className="border-t border-slate-200/70 px-3.5 py-3 dark:border-[#202433]">
                            {repo.error ? (
                              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/10 dark:text-rose-300">
                                {repo.error}
                              </div>
                            ) : repo.files.length === 0 ? (
                              <div className="rounded-xl border border-dashed border-slate-200 bg-white/70 px-3 py-4 text-center text-[11px] text-slate-400 dark:border-slate-700 dark:bg-[#12141c] dark:text-slate-500">
                                {t.kanban.noLocalChanges}
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {visibleFiles.map((file) => (
                                  <FileRow key={`${repo.codebaseId}-${file.path}-${file.status}`} file={file} />
                                ))}
                                {repo.files.length > PREVIEW_FILE_LIMIT && (
                                  <button
                                    type="button"
                                    onClick={() => setShowAllRepos((current) => ({ ...current, [repo.codebaseId]: !showAll }))}
                                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-medium text-slate-600 transition hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-[#12141c]"
                                  >
                                    {showAll ? t.kanban.showLess : t.kanban.showAllFiles.replace('{count}', String(repo.files.length))}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        </>
      )}
    </>
  );
}
