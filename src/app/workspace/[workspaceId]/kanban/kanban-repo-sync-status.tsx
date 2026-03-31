"use client";

import type { TranslationDictionary } from "@/i18n";
import { useTranslation } from "@/i18n";

export interface RepoSyncState {
  status: "idle" | "syncing" | "done" | "error";
  total: number;
  completed: number;
  currentRepoLabel: string | null;
  message: string | null;
  error: string | null;
}

interface KanbanRepoSyncStatusProps {
  repoSync?: RepoSyncState;
}

function getPrimaryLabel(repoSync: RepoSyncState, t: TranslationDictionary): string {
  if (repoSync.status === "syncing") {
    return repoSync.total > 0
      ? `${t.kanban.syncingProgress} ${repoSync.completed}/${repoSync.total}`
      : t.kanban.syncingRepos;
  }

  if (repoSync.status === "done") {
    return `${repoSync.total} ${repoSync.total === 1 ? t.kanban.repoUpdated : t.kanban.reposUpdated}`;
  }

  return t.kanban.syncIssue;
}

function getSecondaryLabel(repoSync: RepoSyncState): string | null {
  if (repoSync.status === "syncing") {
    return repoSync.currentRepoLabel ?? repoSync.message;
  }

  if (repoSync.status === "error") {
    return repoSync.error ?? repoSync.message;
  }

  return repoSync.message;
}

export function KanbanRepoSyncStatus({ repoSync }: KanbanRepoSyncStatusProps) {
  const { t } = useTranslation();
  if (!repoSync || repoSync.status === "idle") {
    return null;
  }

  const progressPercent = repoSync.total > 0
    ? Math.round((repoSync.completed / repoSync.total) * 100)
    : 0;
  const primaryLabel = getPrimaryLabel(repoSync, t);
  const secondaryLabel = getSecondaryLabel(repoSync);
  const tooltip = [repoSync.message, repoSync.currentRepoLabel, repoSync.error]
    .filter((value): value is string => Boolean(value))
    .join("\n");

  return (
    <div
      className={`min-w-0 max-w-full rounded-xl border px-2.5 py-2 ${repoSync.status === "error"
        ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-100"
        : "border-sky-200 bg-sky-50 text-slate-900 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-slate-100"
        }`}
      data-testid="kanban-repo-sync-progress"
      title={tooltip || undefined}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span
          className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${repoSync.status === "error"
            ? "bg-rose-500"
            : repoSync.status === "done"
              ? "bg-emerald-500"
              : "animate-pulse bg-sky-500"
            }`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="truncate font-medium">{primaryLabel}</span>
            {repoSync.total > 0 && (
              <span className="shrink-0 font-mono text-[10px] opacity-75">
                {repoSync.completed}/{repoSync.total}
              </span>
            )}
          </div>
          {secondaryLabel && (
            <div
              className={`mt-0.5 text-[10px] leading-4 ${repoSync.status === "error" ? "break-words" : "truncate opacity-75"
                }`}
            >
              {secondaryLabel}
            </div>
          )}
        </div>
      </div>
      {repoSync.status !== "done" && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          <div
            className={`h-full rounded-full transition-all duration-300 ${repoSync.status === "error" ? "bg-rose-500" : "bg-sky-500"
              }`}
            style={{ width: `${Math.max(progressPercent, repoSync.status === "syncing" ? 6 : 0)}%` }}
          />
        </div>
      )}
    </div>
  );
}
