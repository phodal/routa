"use client";

import React from "react";
import {
  FileText,
  Plus,
  ArrowRightLeft,
  Trash2,
  Copy,
  Loader2,
  User,
  Clock,
  Hash,
  GitCommit as GitCommitIcon,
} from "lucide-react";
import type { GitCommitDetail, CommitFileChange, FileChangeKind } from "./types";

interface CommitDetailPanelProps {
  detail: GitCommitDetail | null;
  loading: boolean;
}

const STATUS_CONFIG: Record<
  FileChangeKind,
  { label: string; letter: string; className: string; icon: React.ElementType }
> = {
  added: {
    label: "Added",
    letter: "A",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    icon: Plus,
  },
  modified: {
    label: "Modified",
    letter: "M",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    icon: FileText,
  },
  deleted: {
    label: "Deleted",
    letter: "D",
    className:
      "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
    icon: Trash2,
  },
  renamed: {
    label: "Renamed",
    letter: "R",
    className:
      "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
    icon: ArrowRightLeft,
  },
  copied: {
    label: "Copied",
    letter: "C",
    className:
      "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
    icon: Copy,
  },
};

function FileChangeRow({ file }: { file: CommitFileChange }) {
  const config = STATUS_CONFIG[file.status] ?? STATUS_CONFIG.modified;
  const Icon = config.icon;
  const parts = file.path.split("/");
  const fileName = parts.pop() ?? file.path;
  const dirPath = parts.join("/");

  return (
    <div className="flex items-center gap-1.5 rounded px-2 py-[3px] text-[11px] hover:bg-slate-100 dark:hover:bg-[#1a1d29]">
      <span
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold ${config.className}`}
      >
        {config.letter}
      </span>
      <Icon className="h-3 w-3 shrink-0 text-slate-400" />
      <span className="min-w-0 truncate font-medium text-slate-700 dark:text-slate-200">
        {fileName}
      </span>
      {dirPath && (
        <span className="min-w-0 truncate text-[10px] text-slate-400 dark:text-slate-500">
          {dirPath}
        </span>
      )}
      {file.previousPath && (
        <span className="text-[10px] text-slate-400 dark:text-slate-500">
          ← {file.previousPath.split("/").pop()}
        </span>
      )}
      <span className="ml-auto shrink-0 tabular-nums">
        {file.additions > 0 && (
          <span className="text-emerald-600 dark:text-emerald-400">
            +{file.additions}
          </span>
        )}
        {file.additions > 0 && file.deletions > 0 && (
          <span className="mx-0.5 text-slate-300 dark:text-slate-600">/</span>
        )}
        {file.deletions > 0 && (
          <span className="text-rose-600 dark:text-rose-400">
            −{file.deletions}
          </span>
        )}
      </span>
    </div>
  );
}

export function CommitDetailPanel({ detail, loading }: CommitDetailPanelProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-slate-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        <span className="text-[11px]">Loading…</span>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 py-8 text-slate-400 dark:text-slate-500">
        <GitCommitIcon className="h-5 w-5" />
        <span className="text-[11px]">Select a commit to view details</span>
      </div>
    );
  }

  const { commit, files } = detail;
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="flex flex-col overflow-hidden">
      {/* Commit header */}
      <div className="space-y-1.5 border-b border-slate-200 px-3 py-2 dark:border-[#1c1f2e]">
        <p className="text-[12px] font-medium leading-snug text-slate-800 dark:text-slate-100">
          {commit.summary}
        </p>

        {commit.message && commit.message !== commit.summary && (
          <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            {commit.message.replace(commit.summary, "").trim()}
          </p>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1">
            <Hash className="h-2.5 w-2.5" />
            <span className="font-mono">{commit.shortSha}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <User className="h-2.5 w-2.5" />
            <span>{commit.authorName}</span>
            <span className="text-slate-400 dark:text-slate-500">
              &lt;{commit.authorEmail}&gt;
            </span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            <span>{new Date(commit.authoredAt).toLocaleString()}</span>
          </span>
        </div>

        {commit.parents.length > 0 && (
          <div className="text-[10px] text-slate-400 dark:text-slate-500">
            Parents:{" "}
            {commit.parents.map((p, i) => (
              <span key={p}>
                {i > 0 && ", "}
                <span className="font-mono">{p.slice(0, 7)}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Changed files */}
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1 dark:border-[#1c1f2e]">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Changed Files
        </span>
        <span className="text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
          {files.length} files{" "}
          <span className="text-emerald-600 dark:text-emerald-400">+{totalAdditions}</span>
          {" / "}
          <span className="text-rose-600 dark:text-rose-400">−{totalDeletions}</span>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto py-0.5">
        {files.map((file) => (
          <FileChangeRow key={file.path} file={file} />
        ))}
      </div>
    </div>
  );
}
