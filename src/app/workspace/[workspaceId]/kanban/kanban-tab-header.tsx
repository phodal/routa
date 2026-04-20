import { useTranslation } from "@/i18n";
import { Select } from "@/client/components/select";
import type { KanbanBoardInfo } from "../types";
import type { ReactNode } from "react";
import { Columns2, Download, RefreshCw, Settings } from "lucide-react";


interface KanbanTabHeaderProps {
  tasksCount: number;
  board: KanbanBoardInfo | null;
  boardQueue?: KanbanBoardInfo["queue"];
  boards: KanbanBoardInfo[];
  selectedBoardId: string | null;
  onSelectBoard: (boardId: string) => void;
  githubImportVisible?: boolean;
  onOpenGitHubImport: () => void;
  onRefresh: () => void;
  onOpenSettings?: () => void;
  actionSlot?: ReactNode;
}

export function KanbanTabHeader({
  tasksCount,
  board,
  boardQueue: _boardQueue,
  boards,
  selectedBoardId,
  onSelectBoard,
  githubImportVisible = false,
  onOpenGitHubImport,
  onRefresh,
  onOpenSettings,
  actionSlot,
}: KanbanTabHeaderProps) {
  const { t } = useTranslation();
  return (
    <div
      className="shrink-0 border-b border-slate-200/70 px-4 py-1.5 dark:border-[#1c1f2e]"
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
          {board && (
            <span className="inline-flex h-6 items-center rounded-full bg-slate-100 px-2 text-[11px] text-slate-500 dark:bg-[#191c28] dark:text-slate-400">
              {t.kanban.limit} {board.sessionConcurrencyLimit ?? 1}
            </span>
          )}
          {boards.length > 1 && (
            <Select
              value={selectedBoardId ?? ""}
              onChange={(event) => onSelectBoard(event.target.value)}
              className="h-6 min-h-6 max-w-[220px] rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-700 dark:border-slate-700 dark:bg-[#12141c] dark:text-slate-200"
            >
              {boards.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </Select>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
          {actionSlot}
          {githubImportVisible ? (
            <button
              onClick={onOpenGitHubImport}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-[#12141c] dark:text-slate-300 dark:hover:bg-[#191c28]"
              title={t.kanban.importGithubIssues}
            >
              <Download className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
              {t.kanban.importGithubIssues}
            </button>
          ) : null}
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-[#12141c] dark:text-slate-300 dark:hover:bg-[#191c28]"
              title={t.kanban.boardSettings}
            >
              <Settings className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
              {t.kanban.boardSettings}
            </button>
          )}
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
