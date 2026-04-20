"use client";

import React, { useState } from "react";
import { GitCommit, ChevronDown, ChevronRight, ExternalLink, RotateCcw } from "lucide-react";
import { FileRow } from "../kanban-file-changes-panel";
import type { KanbanCommitInfo, KanbanFileChangeItem } from "../kanban-file-changes-types";

interface KanbanCommitsSectionProps {
  commits: KanbanCommitInfo[];
  onFileClick?: (file: KanbanFileChangeItem, commitSha: string) => void;
  onOpenCommit?: (commit: KanbanCommitInfo) => void;
  onRevertCommit?: (commit: KanbanCommitInfo) => void;
  expanded?: boolean;
  onToggle?: () => void;
  loading?: boolean;
}

export function KanbanCommitsSection({
  commits,
  onFileClick,
  onOpenCommit,
  onRevertCommit,
  expanded = false,
  onToggle,
  loading = false,
}: KanbanCommitsSectionProps) {
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());

  const toggleCommit = (sha: string) => {
    setExpandedCommits((prev) => {
      const next = new Set(prev);
      if (next.has(sha)) {
        next.delete(sha);
      } else {
        next.add(sha);
      }
      return next;
    });
  };

  return (
    <section className="rounded-2xl border border-slate-200/70 bg-slate-50/70 dark:border-[#202433] dark:bg-[#0d1018]">
      {/* Header */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <GitCommit className="h-4 w-4 text-slate-400" />
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            COMMITS
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            ({commits.length})
          </span>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-400" />
        )}
      </button>

      {/* Content */}
      {expanded && (
      <div className="border-t border-slate-200/70 px-3.5 py-3 dark:border-[#202433]">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-slate-400 dark:text-slate-500">
            Loading commits...
          </div>
        ) : commits.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white/70 px-3 py-4 text-center text-[11px] text-slate-400 dark:border-slate-700 dark:bg-[#12141c] dark:text-slate-500">
            No commits yet
          </div>
        ) : (
          <div className="space-y-2">
            {commits.map((commit) => {
              const isExpanded = expandedCommits.has(commit.sha);
              const hasFiles = commit.files && commit.files.length > 0;

              return (
                <div
                  key={commit.sha}
                  className="rounded-lg border border-slate-200/70 bg-white/70 dark:border-slate-700 dark:bg-[#12141c]"
                >
                  {/* Commit Header */}
                  <div className="flex items-start gap-2 p-2">
                    {hasFiles && (
                      <button
                        type="button"
                        onClick={() => toggleCommit(commit.sha)}
                        className="mt-0.5 shrink-0"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                        )}
                      </button>
                    )}
                    
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <GitCommit className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium text-slate-900 dark:text-slate-100">
                            {commit.summary}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                            <span className="font-mono">{commit.shortSha}</span>
                            <span>·</span>
                            <span>{commit.authorName}</span>
                            {commit.additions > 0 && (
                              <>
                                <span>·</span>
                                <span className="text-emerald-600 dark:text-emerald-400">
                                  +{commit.additions}
                                </span>
                              </>
                            )}
                            {commit.deletions > 0 && (
                              <>
                                <span className="text-rose-600 dark:text-rose-400">
                                  -{commit.deletions}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      {onOpenCommit && (
                        <button
                          type="button"
                          onClick={() => onOpenCommit(commit)}
                          className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                          title="Open in editor"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      )}
                      {onRevertCommit && (
                        <button
                          type="button"
                          onClick={() => onRevertCommit(commit)}
                          className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-slate-800 dark:hover:text-rose-400"
                          title="Revert commit"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded Files */}
                  {isExpanded && hasFiles && (
                    <div className="border-t border-slate-200/70 bg-slate-50/50 px-2 py-2 dark:border-slate-700 dark:bg-[#0d1018]/50">
                      <div className="space-y-1">
                        {commit.files!.map((file) => (
                          <FileRow
                            key={file.path}
                            file={file}
                            onClick={() => onFileClick?.(file, commit.sha)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}
    </section>
  );
}
