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
import { createPortal } from "react-dom";
import { desktopAwareFetch } from "../utils/diagnostics";
import { Button } from "./button";
import { Check, ChevronDown, Download, RefreshCw, Search, GitBranch, Globe } from "lucide-react";
import { useTranslation } from "@/i18n";


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

function interpolateBranchSelectorLabel(
  template: string,
  values: Record<"count" | "plural", string>,
): string {
  return template
    .replace(/\{\{?count\}?\}/g, values.count)
    .replace(/\{\{?plural\}?\}/g, values.plural);
}

// ─── Component ──────────────────────────────────────────────────────────

export function BranchSelector({
  repoPath,
  currentBranch,
  onBranchChange,
  disabled = false,
}: BranchSelectorProps) {
  const { t } = useTranslation();
  const [showDropdown, setShowDropdown] = useState(false);
  const [branchData, setBranchData] = useState<BranchData | null>(null);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dropdownPos, setDropdownPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const positionDropdown = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownWidth = 256;
    const viewportPadding = 8;
    const estimatedHeight = 320;
    const openUp = window.innerHeight - rect.bottom < estimatedHeight && rect.top > estimatedHeight;
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      window.innerWidth - dropdownWidth - viewportPadding
    );

    setDropdownPos(
      openUp
        ? { left, bottom: window.innerHeight - rect.top + 6 }
        : { left, top: rect.bottom + 6 }
    );
  }, []);

  // ── Fetch branches ─────────────────────────────────────────────────

  const fetchBranches = useCallback(
    async (doFetch = false) => {
      if (!repoPath) return;
      setLoading(true);
      try {
        let res;
        if (doFetch) {
          // POST triggers git fetch then returns
          res = await desktopAwareFetch("/api/clone/branches", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ repoPath }),
          });
        } else {
          res = await desktopAwareFetch(
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
      const target = e.target as Node;
      const inDropdown = dropdownRef.current?.contains(target);
      const inTrigger = triggerRef.current?.contains(target);
      if (!inDropdown && !inTrigger) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!showDropdown) return;

    positionDropdown();
    const handleLayout = () => positionDropdown();

    window.addEventListener("resize", handleLayout);
    window.addEventListener("scroll", handleLayout, true);
    return () => {
      window.removeEventListener("resize", handleLayout);
      window.removeEventListener("scroll", handleLayout, true);
    };
  }, [showDropdown, positionDropdown]);

  // ── Switch branch ──────────────────────────────────────────────────

  const handleSwitch = useCallback(
    async (branch: string) => {
      if (branch === currentBranch) {
        setShowDropdown(false);
        return;
      }
      setSwitching(true);
      try {
        const res = await desktopAwareFetch("/api/clone/branches", {
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
      await desktopAwareFetch("/api/clone/branches", {
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
    <div className="relative">
      {/* Trigger */}
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          if (!disabled) {
            if (showDropdown) {
              setShowDropdown(false);
            } else {
              positionDropdown();
              setShowDropdown(true);
            }
            setTimeout(() => searchInputRef.current?.focus(), 50);
          }
        }}
        disabled={disabled || switching}
        className="flex max-w-[220px] items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
      >
        <BranchIcon />
        <span className="truncate">{switching ? "..." : currentBranch}</span>
        {/* Behind badge */}
        {status && status.behind > 0 && (
          <span className="ml-0.5 px-1 py-0 text-[8px] rounded bg-blue-200 dark:bg-blue-800 text-blue-700 dark:text-blue-300">
            {status.behind}↓
          </span>
        )}
        {/* Uncommitted changes dot */}
        {status?.hasUncommittedChanges && (
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 ml-0.5" title={t.branchSelector.uncommittedChanges} />
        )}
        <ChevronIcon />
      </Button>

      {/* Dropdown - opens upward since input is at the bottom */}
      {showDropdown && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: "fixed",
            left: dropdownPos.left,
            top: dropdownPos.top,
            bottom: dropdownPos.bottom,
            width: 256,
            zIndex: 10000,
          }}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2130] shadow-xl overflow-hidden"
        >
          {/* Header */}
          <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                {t.branchSelector.switchBranch}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => fetchBranches(true)}
                disabled={loading}
                className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                title={t.branchSelector.fetchRemote}
              >
                <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}/>
              </Button>
            </div>

            {/* Search */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-50 dark:bg-[#161922] border border-slate-200 dark:border-slate-700">
              <Search className="w-3 h-3 text-slate-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}/>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.branchSelector.filterBranches}
                className="flex-1 bg-transparent text-[11px] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setShowDropdown(false);
                }}
              />
            </div>
          </div>

          {/* Pull suggestion */}
          {status && status.behind > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={handlePull}
              disabled={loading}
              className="w-full px-3 py-2 flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/10 border-b border-slate-100 dark:border-slate-800 transition-colors"
            >
              <Download className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}/>
              {interpolateBranchSelectorLabel(t.branchSelector.pullNewCommits, {
                count: String(status.behind),
                plural: status.behind > 1 ? "s" : "",
              })}
            </Button>
          )}

          {/* Branch list */}
          <div className="max-h-56 overflow-y-auto">
            {loading && !branchData ? (
              <div className="px-3 py-3 text-xs text-slate-400 text-center">
                {t.branchSelector.loadingBranches}
              </div>
            ) : (
              <>
                {/* Local branches */}
                {localBranches.length > 0 && (
                  <>
                    <div className="px-3 py-1 text-[9px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                      {t.branchSelector.local}
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
                    <div className="px-3 py-1 mt-1 text-[9px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider border-t border-slate-50 dark:border-slate-800 pt-1.5">
                      {t.branchSelector.remote}
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
                  <div className="px-3 py-3 text-xs text-slate-400 text-center">
                    {searchQuery ? t.branchSelector.noMatchingBranches : t.branchSelector.noBranchesFound}
                  </div>
                )}
              </>
            )}
          </div>
        </div>,
        document.body
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
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={onClick}
      className={`w-full justify-start rounded-none text-left px-3 py-1.5 text-[11px] hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5 ${
        isCurrent
          ? "text-blue-600 dark:text-blue-400 font-medium"
          : "text-slate-700 dark:text-slate-300"
      }`}
    >
      {isCurrent && (
        <Check className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}/>
      )}
      {isRemote && (
        <Globe className="w-2.5 h-2.5 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}/>
      )}
      <span className="truncate font-mono">{branch}</span>
    </Button>
  );
}

// ─── Icons ──────────────────────────────────────────────────────────────

function BranchIcon() {
  return (
    <GitBranch className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor"/>
  );
}

function ChevronIcon() {
  return (
    <ChevronDown className="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}/>
  );
}
