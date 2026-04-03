"use client";

import React from "react";
import { useTranslation } from "@/i18n";
import type { KanbanRepoChanges, KanbanFileChangeItem, KanbanFileChangeStatus } from "./kanban-file-changes-types";
import { ChevronRight } from "lucide-react";


interface KanbanFileChangesPanelProps {
  repos: KanbanRepoChanges[];
  loading?: boolean;
  open: boolean;
  onClose: () => void;
}

const PREVIEW_FILE_LIMIT = 4;

const STATUS_BADGE: Record<KanbanFileChangeStatus, { short: string; className: string }> = {
  modified: { short: "M", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  added: { short: "A", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  deleted: { short: "D", className: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" },
  renamed: { short: "R", className: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300" },
  copied: { short: "C", className: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300" },
  untracked: { short: "??", className: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" },
  typechange: { short: "T", className: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300" },
  conflicted: { short: "U", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
};

function formatChangeSummary(repo: KanbanRepoChanges, t: Record<string, string>): string {
  if (repo.error) return t.unavailable;
  if (repo.status.clean) return t.clean;
  const segments: string[] = [];
  if (repo.status.modified > 0) segments.push(t.modifiedCount.replace("{count}", String(repo.status.modified)));
  if (repo.status.untracked > 0) segments.push(t.untrackedCount.replace("{count}", String(repo.status.untracked)));
  return segments.join(" · ");
}

export function getKanbanFileChangesSummary(repos: KanbanRepoChanges[]) {
  const changedRepos = repos.filter((repo) => !repo.error && !repo.status.clean).length;
  const changedFiles = repos.reduce((count, repo) => count + repo.files.length, 0);
  return { changedRepos, changedFiles };
}

function FileRow({ file }: { file: KanbanFileChangeItem }) {
  const badge = STATUS_BADGE[file.status];

  return (
    <div className="flex items-start gap-2 rounded-xl border border-slate-200/70 bg-slate-50/80 px-2.5 py-2 dark:border-[#202433] dark:bg-[#11141d]">
      <span className={`inline-flex min-w-7 justify-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${badge.className}`}>
        {badge.short}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium text-slate-700 dark:text-slate-200" title={file.path}>
          {file.path}
        </div>
        {file.previousPath && (
          <div className="truncate text-[10px] text-slate-400 dark:text-slate-500" title={file.previousPath}>
            from {file.previousPath}
          </div>
        )}
      </div>
    </div>
  );
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
                  Hide
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
