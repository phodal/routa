"use client";

import React from "react";
import { ChevronDown, Download, GitCommitHorizontal } from "lucide-react";
import { KanbanFileChangesSection } from "./kanban-file-changes-section";
import type { KanbanFileChangeItem } from "../kanban-file-changes-types";

interface KanbanStagedSectionProps {
  files: KanbanFileChangeItem[];
  onFileClick?: (file: KanbanFileChangeItem) => void;
  onFileSelect?: (file: KanbanFileChangeItem, selected: boolean) => void;
  onSelectAll?: (selected: boolean) => void;
  onUnstageSelected: () => void;
  onCommit: () => void;
  onExport: () => void;
  loading?: boolean;
}

export function KanbanStagedSection({
  files,
  onFileClick,
  onFileSelect,
  onSelectAll,
  onUnstageSelected,
  onCommit,
  onExport,
  loading = false,
}: KanbanStagedSectionProps) {
  const selectedCount = files.filter(f => f.selected).length;
  const hasSelection = selectedCount > 0;
  const hasFiles = files.length > 0;

  const badge = (
    <span className="text-[9px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
      APPROVED
    </span>
  );

  const actions = (
    <>
      <button
        type="button"
        onClick={onUnstageSelected}
        disabled={!hasSelection || loading}
        className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-[#12141c] dark:text-slate-300 dark:hover:bg-[#191c28]"
      >
        Unstage {hasSelection ? `(${selectedCount})` : "Selected"}
      </button>

      <button
        type="button"
        onClick={onCommit}
        disabled={!hasFiles || loading}
        className="flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
      >
        <GitCommitHorizontal className="h-3 w-3" />
        <ChevronDown className="h-3 w-3" />
        Commit
      </button>

      <button
        type="button"
        onClick={onExport}
        disabled={!hasFiles || loading}
        className="flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[10px] font-medium text-sky-700 transition hover:bg-sky-100 disabled:opacity-50 disabled:cursor-not-allowed dark:border-sky-900/40 dark:bg-sky-900/20 dark:text-sky-300 dark:hover:bg-sky-900/30"
      >
        <Download className="h-3 w-3" />
        Export
      </button>
    </>
  );

  return (
    <KanbanFileChangesSection
      title="STAGED"
      subtitle={files.length > 0 ? `${files.length} file${files.length === 1 ? '' : 's'} ready to commit` : undefined}
      files={files}
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
