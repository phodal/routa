"use client";

import React from "react";
import { Search, RefreshCw, Filter, X } from "lucide-react";

interface GitLogToolbarProps {
  searchText: string;
  onSearchChange: (text: string) => void;
  activeBranches: string[];
  onClearFilters: () => void;
  onRefresh: () => void;
  total: number;
  loading: boolean;
}

export function GitLogToolbar({
  searchText,
  onSearchChange,
  activeBranches,
  onClearFilters,
  onRefresh,
  total,
  loading,
}: GitLogToolbarProps) {
  return (
    <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50/80 px-2 py-1 dark:border-[#1c1f2e] dark:bg-[#0f1117]/80">
      {/* Search */}
      <div className="relative flex min-w-0 flex-1 items-center">
        <Search className="pointer-events-none absolute left-1.5 h-3 w-3 text-slate-400" />
        <input
          type="text"
          value={searchText}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Filter by message, hash, author…"
          className="h-6 w-full rounded border border-slate-200 bg-white pl-6 pr-2 text-[11px] text-slate-700 placeholder-slate-400 outline-none transition-colors focus:border-amber-400 dark:border-[#252837] dark:bg-[#12141c] dark:text-slate-200 dark:placeholder-slate-500 dark:focus:border-amber-500"
        />
        {searchText && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            className="absolute right-1 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Active branch filter indicator */}
      {activeBranches.length > 0 && (
        <button
          type="button"
          onClick={onClearFilters}
          className="inline-flex h-6 items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 text-[10px] font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/30"
          title="Clear branch filters"
        >
          <Filter className="h-2.5 w-2.5" />
          <span>{activeBranches.length}</span>
          <X className="h-2.5 w-2.5" />
        </button>
      )}

      {/* Commit count */}
      <span className="shrink-0 text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
        {total} commits
      </span>

      {/* Refresh */}
      <button
        type="button"
        onClick={onRefresh}
        className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-[#1a1d29] dark:hover:text-slate-300"
        title="Refresh"
        disabled={loading}
      >
        <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}
