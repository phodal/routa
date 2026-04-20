"use client";

import React from "react";
import { X } from "lucide-react";
import type { KanbanFileChangeItem } from "../kanban-file-changes-types";
import { parseUnifiedDiffPreview } from "../kanban-diff-preview";

interface KanbanInlineDiffViewerProps {
  file: KanbanFileChangeItem | null;
  diff?: string;
  loading?: boolean;
  error?: string;
  onClose: () => void;
  commitSha?: string;
  embedded?: boolean;
}

export function KanbanInlineDiffViewer({
  file,
  diff,
  loading = false,
  error,
  onClose,
  commitSha,
  embedded = false,
}: KanbanInlineDiffViewerProps) {
  if (!file) return null;
  const parsedDiff = diff ? parseUnifiedDiffPreview({ patch: diff }) : null;

  return (
    <div className={embedded ? "border-t border-slate-200/70 pt-2 dark:border-slate-800/80" : "rounded-lg border border-slate-200/70 bg-white dark:border-slate-700 dark:bg-[#12141c]"}>
      {/* Header */}
      <div className={`flex items-center justify-between gap-3 ${embedded ? "border-b border-slate-200/70 px-0 pb-2 dark:border-slate-800/80" : "border-b border-slate-200/70 px-3 py-2 dark:border-slate-700"}`}>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
            {file.path}
          </div>
          {commitSha && (
            <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
              Commit: {commitSha.substring(0, 7)}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="max-h-96 overflow-auto">
        {loading ? (
          <div className={`flex items-center justify-center text-xs text-slate-400 dark:text-slate-500 ${embedded ? "px-1 py-6" : "py-8"}`}>
            Loading diff...
          </div>
        ) : error ? (
          <div className={`${embedded ? "px-0 py-3" : "px-3 py-4"} text-xs text-rose-600 dark:text-rose-400`}>
            {error}
          </div>
        ) : !diff ? (
          <div className={`${embedded ? "px-0 py-3" : "px-3 py-4"} text-xs text-slate-400 dark:text-slate-500`}>
            No diff available
          </div>
        ) : (
          <div className="font-mono text-[10px]">
            {parsedDiff?.lines.map((line, i) => {
              const getStyles = () => {
                const prefix = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";

                if (line.kind === "add") {
                  return {
                    bgClass: "bg-emerald-50 dark:bg-emerald-900/20",
                    textClass: "text-emerald-900 dark:text-emerald-300",
                    prefix,
                  };
                }
                if (line.kind === "remove") {
                  return {
                    bgClass: "bg-rose-50 dark:bg-rose-900/20",
                    textClass: "text-rose-900 dark:text-rose-300",
                    prefix,
                  };
                }
                if (line.kind === "meta" || line.kind === "hunk") {
                  return {
                    bgClass: "bg-sky-50 dark:bg-sky-900/20",
                    textClass: "text-sky-900 dark:text-sky-300",
                    prefix: "",
                  };
                }
                return {
                  bgClass: "",
                  textClass: "text-slate-600 dark:text-slate-400",
                  prefix,
                };
              };

              const { bgClass, textClass, prefix } = getStyles();

              return (
                <div
                  key={i}
                  className={`${embedded ? "px-0" : "px-3"} py-0.5 ${bgClass} ${textClass}`}
                >
                  {line.kind === "add" || line.kind === "remove" || line.kind === "context" ? (
                    <div className="grid grid-cols-[2rem_2rem_1rem_minmax(0,1fr)]">
                      <span className="select-none pr-1 text-right opacity-50">
                        {typeof line.oldLineNumber === "number" ? (
                          <span data-testid={`kanban-diff-old-line-${i}`}>{line.oldLineNumber}</span>
                        ) : ""}
                      </span>
                      <span className="select-none pr-1 text-right opacity-50">
                        {typeof line.newLineNumber === "number" ? (
                          <span data-testid={`kanban-diff-new-line-${i}`}>{line.newLineNumber}</span>
                        ) : ""}
                      </span>
                      <span className="select-none opacity-50">{prefix}</span>
                      <span className="whitespace-pre">{line.text.slice(1) || " "}</span>
                    </div>
                  ) : (
                    <span className="whitespace-pre">{line.text}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
