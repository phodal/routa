"use client";

/**
 * BranchSelector - Branch picker dropdown
 *
 * Consistent with intent-source BranchSelector:
 *   - Current branch display with status (behind count, uncommitted changes)
 *   - Local and remote branch lists with search
 *   - Refresh (fetch) button
 *   - Branch grouping: regular, remote-only
 *   - Checkout and optional pull
 */

import { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ──────────────────────────────────────────────────────────────

interface BranchStatus {
  ahead: number;
  behind: number;
  hasUncommittedChanges: boolean;
}

interface BranchData {
  current: string;
  local: string[];
  remote: string[];
  status: BranchStatus;
}

interface BranchSelectorProps {
  repoPath: string;
  currentBranch: string;
  onBranchChange: (branch: string) => void;
  disabled?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────

export function BranchSelector({
  repoPath,
  currentBranch,
  onBranchChange,
  disabled = false,
}: BranchSelectorProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [branchData, setBranchData] = useState<BranchData | null>(null);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch branches ─────────────────────────────────────────────────

  const fetchBranches = useCallback(
    async (doFetch = false) => {
      if (!repoPath) return;
      setLoading(true);
      try {
        let res;
        if (doFetch) {
          // POST triggers git fetch then returns
          res = await fetch("/api/clone/branches", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ repoPath }),
          });
        } else {
          res = await fetch(
            `/api/clone/branches?repoPath=${encodeURIComponent(repoPath)}`
          );
        }
        const data = await res.json();
        setBranchData(data);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    },
    [repoPath]
  );

  useEffect(() => {
    if (repoPath) fetchBranches();
  }, [repoPath, fetchBranches]);

  // ── Click outside ──────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Switch branch ──────────────────────────────────────────────────

  const handleSwitch = useCallback(
    async (branch: string) => {
      if (branch === currentBranch) {
        setShowDropdown(false);
        return;
      }
      setSwitching(true);
      try {
        const res = await fetch("/api/clone/branches", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoPath, branch, pull: true }),
        });
        const data = await res.json();
        if (data.success) {
          onBranchChange(data.branch);
          fetchBranches(); // refresh
        }
      } catch {
        // ignore
      } finally {
        setSwitching(false);
        setShowDropdown(false);
      }
    },
    [repoPath, currentBranch, onBranchChange, fetchBranches]
  );

  // ── Pull branch ────────────────────────────────────────────────────

  const handlePull = useCallback(async () => {
    if (!repoPath) return;
    setLoading(true);
    try {
      await fetch("/api/clone/branches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath, branch: currentBranch, pull: true }),
      });
      fetchBranches();
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [repoPath, currentBranch, fetchBranches]);

  // ── Filtered branches ──────────────────────────────────────────────

  const query = searchQuery.toLowerCase();
  const localBranches = (branchData?.local || []).filter((b) =>
    b.toLowerCase().includes(query)
  );
  // Remote-only: branches that exist on remote but not locally
  const localSet = new Set(branchData?.local || []);
  const remoteBranches = (branchData?.remote || []).filter(
    (b) => !localSet.has(b) && b.toLowerCase().includes(query)
  );

  const status = branchData?.status;

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => {
          if (!disabled) {
            setShowDropdown((v) => !v);
            setTimeout(() => searchInputRef.current?.focus(), 50);
          }
        }}
        disabled={disabled || switching}
        className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
      >
        <BranchIcon />
        {switching ? "..." : currentBranch}
        {/* Behind badge */}
        {status && status.behind > 0 && (
          <span className="ml-0.5 px-1 py-0 text-[8px] rounded bg-blue-200 dark:bg-blue-800 text-blue-700 dark:text-blue-300">
            {status.behind}↓
          </span>
        )}
        {/* Uncommitted changes dot */}
        {status?.hasUncommittedChanges && (
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 ml-0.5" title="Uncommitted changes" />
        )}
        <ChevronIcon />
      </button>

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute top-full left-0 mt-1 w-64 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e2130] shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Switch branch
              </span>
              <button
                type="button"
                onClick={() => fetchBranches(true)}
                disabled={loading}
                className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                title="Fetch remote branches"
              >
                <svg
                  className={`w-3 h-3 ${loading ? "animate-spin" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>

            {/* Search */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-50 dark:bg-[#161922] border border-gray-200 dark:border-gray-700">
              <svg className="w-3 h-3 text-gray-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter branches..."
                className="flex-1 bg-transparent text-[11px] text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setShowDropdown(false);
                }}
              />
            </div>
          </div>

          {/* Pull suggestion */}
          {status && status.behind > 0 && (
            <button
              type="button"
              onClick={handlePull}
              disabled={loading}
              className="w-full px-3 py-2 flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/10 border-b border-gray-100 dark:border-gray-800 transition-colors"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Pull {status.behind} new commit{status.behind > 1 ? "s" : ""}
            </button>
          )}

          {/* Branch list */}
          <div className="max-h-56 overflow-y-auto">
            {loading && !branchData ? (
              <div className="px-3 py-3 text-xs text-gray-400 text-center">
                Loading branches...
              </div>
            ) : (
              <>
                {/* Local branches */}
                {localBranches.length > 0 && (
                  <>
                    <div className="px-3 py-1 text-[9px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                      Local
                    </div>
                    {localBranches.map((b) => (
                      <BranchItem
                        key={`local-${b}`}
                        branch={b}
                        isCurrent={b === currentBranch}
                        onClick={() => handleSwitch(b)}
                      />
                    ))}
                  </>
                )}

                {/* Remote-only branches */}
                {remoteBranches.length > 0 && (
                  <>
                    <div className="px-3 py-1 mt-1 text-[9px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider border-t border-gray-50 dark:border-gray-800 pt-1.5">
                      Remote
                    </div>
                    {remoteBranches.map((b) => (
                      <BranchItem
                        key={`remote-${b}`}
                        branch={b}
                        isCurrent={false}
                        isRemote
                        onClick={() => handleSwitch(b)}
                      />
                    ))}
                  </>
                )}

                {localBranches.length === 0 && remoteBranches.length === 0 && (
                  <div className="px-3 py-3 text-xs text-gray-400 text-center">
                    {searchQuery ? "No matching branches." : "No branches found."}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub Components ─────────────────────────────────────────────────────

function BranchItem({
  branch,
  isCurrent,
  isRemote,
  onClick,
}: {
  branch: string;
  isCurrent: boolean;
  isRemote?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5 ${
        isCurrent
          ? "text-blue-600 dark:text-blue-400 font-medium"
          : "text-gray-700 dark:text-gray-300"
      }`}
    >
      {isCurrent && (
        <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
      {isRemote && (
        <svg className="w-2.5 h-2.5 shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )}
      <span className="truncate font-mono">{branch}</span>
    </button>
  );
}

// ─── Icons ──────────────────────────────────────────────────────────────

function BranchIcon() {
  return (
    <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}
