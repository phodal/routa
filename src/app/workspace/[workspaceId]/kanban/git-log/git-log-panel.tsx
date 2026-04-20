"use client";

import React, { useState } from "react";
import { GitBranch, PanelLeftClose, PanelLeft } from "lucide-react";
import { CodebasePicker } from "@/client/components/codebase-picker";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import { useTranslation } from "@/i18n";
import type { GitLogAdapter } from "./types";
import { useGitLog } from "./use-git-log";
import { RefsTree } from "./refs-tree";
import { GitLogToolbar } from "./git-log-toolbar";
import { CommitList } from "./commit-list";
import { CommitDetailPanel } from "./commit-detail-panel";

interface GitLogPanelProps {
  adapter: GitLogAdapter;
  repoPath: string;
  codebases?: CodebaseData[];
  onSelectRepoPath?: (repoPath: string) => void;
  /** Panel title — defaults to "Git Log" */
  title?: string;
  className?: string;
}

export function GitLogPanel({
  adapter,
  repoPath,
  codebases = [],
  onSelectRepoPath,
  title = "Git Log",
  className = "",
}: GitLogPanelProps) {
  const { t } = useTranslation();
  const git = useGitLog(adapter, repoPath);
  const [refsOpen, setRefsOpen] = useState(true);
  const [detailOpen, setDetailOpen] = useState(true);

  // Debounce search: update on Enter or after 300ms idle
  const [searchInput, setSearchInput] = useState("");
  const searchTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = (text: string) => {
    setSearchInput(text);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      git.setSearch(text);
    }, 300);
  };

  // Sync searchInput when git.searchText resets
  React.useEffect(() => {
    if (git.searchText === "" && searchInput !== "") {
      setSearchInput("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [git.searchText]);

  // When a commit is selected, open the detail panel
  const handleSelectCommit = (sha: string) => {
    git.selectCommit(sha);
    setDetailOpen(true);
  };

  return (
    <div
      className={`flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-700 dark:border-[#1c1f2e] dark:bg-[#0f1117] dark:text-slate-200 ${className}`}
      data-testid="git-log-panel"
    >
      {/* Panel header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-2 py-1 dark:border-[#1c1f2e] dark:bg-[#0d1018]">
        <GitBranch className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-[11px] font-semibold tracking-wide text-slate-600 dark:text-slate-300">
          {title}
        </span>
        <span className="text-[10px] text-slate-400 dark:text-slate-500">
          {repoPath.split("/").pop()}
        </span>

        {codebases.length > 0 && onSelectRepoPath && (
          <div className="min-w-0 max-w-[16rem]">
            <CodebasePicker
              codebases={codebases}
              selectedRepoPath={repoPath}
              onSelect={onSelectRepoPath}
            />
          </div>
        )}

        <div className="flex-1" />

        {/* Toggle refs sidebar */}
        <button
          type="button"
          onClick={() => setRefsOpen(!refsOpen)}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-[#1a1d29] dark:hover:text-slate-300"
          title={refsOpen ? t.gitLog.hideRefs : t.gitLog.showRefs}
        >
          {refsOpen ? (
            <PanelLeftClose className="h-3.5 w-3.5" />
          ) : (
            <PanelLeft className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* Left: Refs tree */}
        {refsOpen && (
          <div className="flex w-[180px] shrink-0 flex-col border-r border-slate-200 dark:border-[#1c1f2e]">
            <div className="flex-1 overflow-y-auto">
              <RefsTree
                refs={git.refs}
                activeBranches={git.activeBranches}
                onToggleBranch={git.toggleBranch}
              />
            </div>
          </div>
        )}

        {/* Center: Toolbar + commit list */}
        <div className="flex min-w-0 flex-1 flex-col">
          <GitLogToolbar
            searchText={searchInput}
            onSearchChange={handleSearchChange}
            activeBranches={git.activeBranches}
            onClearFilters={() => {
              git.setActiveBranches([]);
              handleSearchChange("");
              git.setSearch("");
            }}
            onRefresh={git.refresh}
            total={git.total}
            loading={git.loading}
          />
          <CommitList
            commits={git.commits}
            selectedSha={git.selectedSha}
            onSelect={handleSelectCommit}
            hasMore={git.hasMore}
            loadingMore={git.loadingMore}
            onLoadMore={git.loadMore}
            loading={git.loading}
          />
        </div>

        {/* Right: Commit detail */}
        {detailOpen && git.selectedSha && (
          <div className="flex w-[300px] shrink-0 flex-col border-l border-slate-200 dark:border-[#1c1f2e]">
            <CommitDetailPanel
              detail={git.detail}
              loading={git.detailLoading}
            />
          </div>
        )}
      </div>

      {/* Error bar */}
      {git.error && (
        <div className="shrink-0 border-t border-rose-200 bg-rose-50 px-3 py-1 text-[11px] text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/10 dark:text-rose-300">
          {git.error}
        </div>
      )}
    </div>
  );
}
