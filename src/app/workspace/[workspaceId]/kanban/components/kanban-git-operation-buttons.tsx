"use client";

import React from "react";
import { ArrowDown, RotateCcw } from "lucide-react";

interface KanbanGitOperationButtonsProps {
  targetBranch?: string;
  ahead?: number;
  behind?: number;
  onPull: () => void;
  onRebase: () => void;
  loading?: boolean;
}

export function KanbanGitOperationButtons({
  targetBranch = "main",
  behind = 0,
  onPull,
  onRebase,
  loading = false,
}: KanbanGitOperationButtonsProps) {
  return (
    <div className="flex items-center gap-2 border-t border-slate-200/70 px-3 py-2 dark:border-[#202433]">
      {/* Pull Button */}
      {behind > 0 && (
        <button
          type="button"
          onClick={onPull}
          disabled={loading}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-900/40 dark:bg-sky-900/20 dark:text-sky-300 dark:hover:bg-sky-900/30"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          Pull {behind} commit{behind === 1 ? "" : "s"} ↑
        </button>
      )}

      {/* Rebase Button */}
      <button
        type="button"
        onClick={onRebase}
        disabled={loading}
        className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 transition hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-purple-900/40 dark:bg-purple-900/20 dark:text-purple-300 dark:hover:bg-purple-900/30"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Rebase onto {targetBranch} ↻
      </button>
    </div>
  );
}
