"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { FileRow } from "../kanban-file-changes-panel";
import type { KanbanFileChangeItem } from "../kanban-file-changes-types";

interface KanbanFileChangesSectionProps {
  title: string;
  subtitle?: string;
  files: KanbanFileChangeItem[];
  embedded?: boolean;
  showCheckbox?: boolean;
  onFileClick?: (file: KanbanFileChangeItem) => void;
  onFileSelect?: (file: KanbanFileChangeItem, selected: boolean) => void;
  onSelectAll?: (selected: boolean) => void;
  actions?: React.ReactNode;
  defaultExpanded?: boolean;
  badge?: React.ReactNode;
}

export function KanbanFileChangesSection({
  title,
  subtitle,
  files,
  embedded = false,
  showCheckbox = false,
  onFileClick,
  onFileSelect,
  onSelectAll,
  actions,
  defaultExpanded = true,
  badge,
}: KanbanFileChangesSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  
  const selectedCount = files.filter(f => f.selected).length;
  const allSelected = files.length > 0 && selectedCount === files.length;
  const someSelected = selectedCount > 0 && selectedCount < files.length;

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSelectAll?.(e.target.checked);
  };

  return (
    <section className={embedded ? "py-1" : "rounded-xl border border-slate-200/70 bg-slate-50/50 dark:border-[#202433] dark:bg-[#0d1018]/50"}>
      {/* Header */}
      <div className={`flex items-center justify-between gap-2 ${embedded ? "px-0 py-1.5" : "px-3 py-2"}`}>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          )}
          
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                {title}
              </span>
              {badge}
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                ({files.length})
              </span>
            </div>
            {subtitle && (
              <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                {subtitle}
              </div>
            )}
          </div>
        </button>

        {showCheckbox && files.length > 0 && (
          <input
            type="checkbox"
            checked={allSelected}
            ref={(input) => {
              if (input) {
                input.indeterminate = someSelected;
              }
            }}
            onChange={handleSelectAll}
            className="h-3.5 w-3.5 rounded border-slate-300 text-amber-600 focus:ring-2 focus:ring-amber-500 dark:border-slate-600 dark:bg-slate-700"
            aria-label="Select all files"
            title="Select all files"
          />
        )}
      </div>

      {/* Content */}
      {expanded && (
        <div className={`${embedded ? "border-t border-slate-200/70 px-0 py-2 dark:border-slate-800/80" : "border-t border-slate-200/70 px-3 py-2 dark:border-[#202433]"}`}>
          {files.length === 0 ? (
            <div className={`${embedded ? "px-1 py-2 text-left" : "rounded-lg border border-dashed border-slate-200 bg-white/50 px-3 py-3 dark:border-slate-700 dark:bg-[#12141c]/50"} text-[10px] text-slate-400 dark:text-slate-500`}>
              No files in this section
            </div>
          ) : (
            <>
              <div className="space-y-1">
                {files.map((file) => (
                  <FileRow
                    key={`${file.path}-${file.status}`}
                    file={file}
                    selected={file.selected}
                    onClick={onFileClick}
                    onSelect={onFileSelect}
                    showCheckbox={showCheckbox}
                  />
                ))}
              </div>

              {actions && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {actions}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
