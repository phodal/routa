import { useTranslation } from "@/i18n";
import { Select } from "@/client/components/select";
import { QueueStatusBadge } from "./kanban-tab-helpers";
import type { KanbanBoardInfo } from "../types";
import { Columns2, Download, RefreshCw } from "lucide-react";


interface KanbanTabHeaderProps {
  tasksCount: number;
  board: KanbanBoardInfo | null;
  boardQueue?: KanbanBoardInfo["queue"];
  repoHealth: { missingRepoTasks: number; cwdMismatchTasks: number };
  boards: KanbanBoardInfo[];
  selectedBoardId: string | null;
  onSelectBoard: (boardId: string) => void;
  githubImportEnabled: boolean;
  onOpenGitHubImport: () => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
}

export function KanbanTabHeader({
  tasksCount,
  board,
  boardQueue,
  repoHealth,
  boards,
  selectedBoardId,
  onSelectBoard,
  githubImportEnabled,
  onOpenGitHubImport,
  onOpenSettings,
  onRefresh,
}: KanbanTabHeaderProps) {
  const { t } = useTranslation();
  return (
    <div
      className="shrink-0 border-b border-slate-200/70 px-4 py-1 dark:border-[#1c1f2e]"
      data-testid="kanban-page-header"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-h-6 items-center gap-2">
          <Columns2 className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
          <h1 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{t.kanban.kanbanBoard}</h1>
          {tasksCount > 0 && (
            <span className="text-[11px] text-slate-500 dark:text-slate-400" data-testid="kanban-task-count">
              ({tasksCount} {t.kanban.tasksCount})
            </span>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {board && (
            <>
              <span className="inline-flex h-6 items-center rounded-full bg-slate-100 px-2 text-[11px] dark:bg-[#191c28]">
                {t.kanban.limit} {board.sessionConcurrencyLimit ?? 1}
              </span>
              <QueueStatusBadge
                label={t.kanban.runningLabel}
                count={boardQueue?.runningCount ?? 0}
                cards={boardQueue?.runningCards ?? []}
                className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
              />
              <QueueStatusBadge
                label={t.kanban.queuedLabel}
                count={boardQueue?.queuedCount ?? 0}
                cards={boardQueue?.queuedCards ?? []}
                className="bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
              />
            </>
          )}

          {(repoHealth.missingRepoTasks > 0 || repoHealth.cwdMismatchTasks > 0) && (
            <div className="inline-flex h-6 items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 text-[11px] text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-300">
              <span className="font-medium">{t.kanban.kanbanHealth}</span>
              {repoHealth.missingRepoTasks > 0 && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                  {repoHealth.missingRepoTasks} {t.kanban.missing}
                </span>
              )}
              {repoHealth.cwdMismatchTasks > 0 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  {repoHealth.cwdMismatchTasks} {t.kanban.sessionMismatch}
                </span>
              )}
            </div>
          )}

          {boards.length > 1 && (
            <Select
              value={selectedBoardId ?? ""}
              onChange={(event) => onSelectBoard(event.target.value)}
              className="h-6 min-h-6 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-700 dark:border-slate-700 dark:bg-[#12141c] dark:text-slate-200"
            >
              {boards.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </Select>
          )}
          <button
            onClick={onOpenGitHubImport}
            disabled={!githubImportEnabled}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-[#12141c] dark:text-slate-300 dark:hover:bg-[#191c28]"
            title={t.kanban.importGithubIssues}
          >
            <Download className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            {t.kanban.importGithubIssues}
          </button>
          <button
            onClick={onOpenSettings}
            className="inline-flex h-6 items-center rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-[#12141c] dark:text-slate-300 dark:hover:bg-[#191c28]"
            title={t.kanban.boardSettings}
          >
            {t.kanban.boardSettings}
          </button>
          <button
            onClick={onRefresh}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-[#1f232f] dark:hover:text-slate-200"
            title={t.common.refresh}
          >
            <RefreshCw className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          </button>
        </div>
      </div>
    </div>
  );
}
