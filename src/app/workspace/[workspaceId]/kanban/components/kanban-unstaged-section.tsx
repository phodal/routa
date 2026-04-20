"use client";

import React from "react";
import { GitCommitHorizontal, Trash2 } from "lucide-react";
import { KanbanFileChangesSection } from "./kanban-file-changes-section";
import type { KanbanFileChangeItem } from "../kanban-file-changes-types";

interface KanbanUnstagedSectionProps {
  files: KanbanFileChangeItem[];
  autoCommit: boolean;
  onAutoCommitToggle: (enabled: boolean) => void;
  embedded?: boolean;
  onFileClick?: (file: KanbanFileChangeItem) => void;
  onFileSelect?: (file: KanbanFileChangeItem, selected: boolean) => void;
  onSelectAll?: (selected: boolean) => void;
  onStageSelected: () => void;
  onDiscardSelected: () => void;
  loading?: boolean;
}

export function KanbanUnstagedSection({
  files,
  autoCommit,
  onAutoCommitToggle,
  embedded = false,
  onFileClick,
  onFileSelect,
  onSelectAll,
  onStageSelected,
  onDiscardSelected,
  loading = false,
}: KanbanUnstagedSectionProps) {
  const selectedCount = files.filter(f => f.selected).length;
  const hasSelection = selectedCount > 0;

  const badge = autoCommit ? (
    <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
      Auto-commit
    </span>
  ) : (
    <span className="text-[9px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
      NEW
    </span>
  );

  const actions = (
    <>
      <button
        type="button"
        onClick={onStageSelected}
        disabled={!hasSelection || loading}
        className="flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 transition hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/30"
      >
        <GitCommitHorizontal className="h-3 w-3" />
        Stage {hasSelection ? `(${selectedCount})` : "Selected"}
      </button>

      <button
        type="button"
        onClick={onDiscardSelected}
        disabled={!hasSelection || loading}
        className="flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-300 dark:hover:bg-rose-900/30"
      >
        <Trash2 className="h-3 w-3" />
        Discard {hasSelection ? `(${selectedCount})` : "Selected"}
      </button>

      <label className="ml-auto flex items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-400">
        <input
          type="checkbox"
          checked={autoCommit}
          disabled={true}
          onChange={(e) => onAutoCommitToggle(e.target.checked)}
          className="h-3 w-3 rounded border-slate-300 text-emerald-600 opacity-50 focus:ring-1 focus:ring-emerald-500 disabled:cursor-not-allowed dark:border-slate-600 dark:bg-slate-700"
        />
        <span className="opacity-50">Auto-commit</span>
      </label>
    </>
  );

  return (
    <KanbanFileChangesSection
      title="UNSTAGED"
      subtitle={files.length > 0 ? `${files.length} file${files.length === 1 ? '' : 's'} with changes` : undefined}
      files={files}
      embedded={embedded}
      showCheckbox={true}
      onFileClick={onFileClick}
      onFileSelect={onFileSelect}
      onSelectAll={onSelectAll}
      actions={actions}
      badge={badge}
      defaultExpanded={true}
    />
  );
}
