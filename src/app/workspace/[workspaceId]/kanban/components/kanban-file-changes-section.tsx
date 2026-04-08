"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { FileRow } from "../kanban-file-changes-panel";
import type { KanbanFileChangeItem } from "../kanban-file-changes-types";

interface KanbanFileChangesSectionProps {
  title: string;
  subtitle?: string;
  files: KanbanFileChangeItem[];
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
    <section className="rounded-2xl border border-slate-200/70 bg-slate-50/70 dark:border-[#202433] dark:bg-[#0d1018]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-3.5 py-3">
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
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {title}
              </span>
              {badge}
              <span className="text-xs text-slate-500 dark:text-slate-400">
                ({files.length})
              </span>
            </div>
            {subtitle && (
              <div className="text-[10px] text-slate-500 dark:text-slate-400">
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
        <div className="border-t border-slate-200/70 px-3.5 py-3 dark:border-[#202433]">
          {files.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white/70 px-3 py-4 text-center text-[11px] text-slate-400 dark:border-slate-700 dark:bg-[#12141c] dark:text-slate-500">
              No files in this section
            </div>
          ) : (
            <>
              <div className="space-y-2">
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
                <div className="mt-3 flex flex-wrap gap-2">
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
