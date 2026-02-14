"use client";

/**
 * RepoPicker - Inline repo selector and cloner
 *
 * Consistent with intent-source RepoSelector:
 *   - Tab-like modes: Existing repos, Clone from GitHub
 *   - Search/filter existing repos
 *   - GitHub URL input with clone progress (SSE)
 *   - Git error handling and user-friendly messages
 *   - Clone status: progress phases, percent
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { BranchSelector } from "./branch-selector";

// ─── Types ──────────────────────────────────────────────────────────────

interface RepoStatus {
  clean: boolean;
  ahead: number;
  behind: number;
  modified: number;
  untracked: number;
}

interface ClonedRepo {
  name: string;
  path: string;
  dirName: string;
  branch: string;
  branches: string[];
  status: RepoStatus;
}

export interface RepoSelection {
  name: string;
  path: string;
  branch: string;
}

interface RepoPickerProps {
  value: RepoSelection | null;
  onChange: (selection: RepoSelection | null) => void;
}

type PickerTab = "existing" | "clone";

interface CloneProgress {
  phase: string;
  percent: number;
  message: string;
}

// ─── Component ──────────────────────────────────────────────────────────

export function RepoPicker({ value, onChange }: RepoPickerProps) {
  const [repos, setRepos] = useState<ClonedRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeTab, setActiveTab] = useState<PickerTab>("existing");
  const [searchQuery, setSearchQuery] = useState("");

  // Clone state
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneProgress, setCloneProgress] = useState<CloneProgress | null>(null);
  const [cloneError, setCloneError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cloneInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch repos ────────────────────────────────────────────────────

  const fetchRepos = useCallback(async () => {
    setLoadingRepos(true);
    try {
      const res = await fetch("/api/clone");
      const data = await res.json();
      setRepos(data.repos || []);
    } catch {
      // ignore
    } finally {
      setLoadingRepos(false);
    }
  }, []);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

  // ── Click outside to close ─────────────────────────────────────────

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Auto-detect GitHub URL in search → switch to clone tab ─────────

  const isGitHubInput = (text: string): boolean => {
    const t = text.trim();
    return (
      /^https?:\/\/github\.com\//i.test(t) ||
      /^git@github\.com:/i.test(t) ||
      /^github\.com\//i.test(t) ||
      /^[a-zA-Z0-9\-_]+\/[a-zA-Z0-9\-_.]+$/.test(t)
    );
  };

  useEffect(() => {
    if (searchQuery && isGitHubInput(searchQuery)) {
      setActiveTab("clone");
      setCloneUrl(searchQuery);
    }
  }, [searchQuery]);

  // ── Clone with progress (SSE) ──────────────────────────────────────

  const handleClone = useCallback(
    async (url: string) => {
      if (!url.trim()) return;
      setCloning(true);
      setCloneError(null);
      setCloneProgress({ phase: "starting", percent: 0, message: "Starting clone..." });

      try {
        const res = await fetch("/api/clone/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim() }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: "Clone failed" }));
          throw new Error(errData.error || "Clone failed");
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6));

                if (event.phase === "done") {
                  // Clone successful
                  onChange({
                    name: event.name,
                    path: event.path,
                    branch: event.branch || "main",
                  });
                  setCloneUrl("");
                  setSearchQuery("");
                  setShowDropdown(false);
                  setCloneProgress(null);
                  fetchRepos();
                } else if (event.phase === "error") {
                  setCloneError(event.error || "Clone failed");
                  setCloneProgress(null);
                } else {
                  setCloneProgress({
                    phase: event.phase,
                    percent: event.percent || 0,
                    message: event.message || event.phase,
                  });
                }
              } catch {
                // parse error
              }
            }
          }
        }
      } catch (err) {
        setCloneError(
          err instanceof Error ? err.message : "Clone failed"
        );
        setCloneProgress(null);
      } finally {
        setCloning(false);
      }
    },
    [onChange, fetchRepos]
  );

  // ── Select repo handler ────────────────────────────────────────────

  const handleSelectRepo = useCallback(
    (repo: ClonedRepo) => {
      onChange({
        name: repo.name,
        path: repo.path,
        branch: repo.branch,
      });
      setShowDropdown(false);
      setSearchQuery("");
    },
    [onChange]
  );

  // ── Clear selection ────────────────────────────────────────────────

  const handleClear = useCallback(() => {
    onChange(null);
    setSearchQuery("");
  }, [onChange]);

  // ── Filtered repos ─────────────────────────────────────────────────

  const filteredRepos = searchQuery.trim()
    ? repos.filter((r) =>
        r.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : repos;

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} className="relative">
      {/* ── Selected state: show repo pill ── */}
      {value ? (
        <SelectedRepoPill
          value={value}
          repos={repos}
          onClickName={() => {
            setShowDropdown((v) => !v);
          }}
          onClear={handleClear}
          onBranchChange={(branch) => {
            onChange({ ...value, branch });
            fetchRepos();
          }}
        />
      ) : (
        /* ── No repo: show trigger ── */
        <button
          type="button"
          onClick={() => {
            setShowDropdown(true);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
          className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          <GitRepoIcon className="w-3.5 h-3.5" />
          <span>Select or clone a repository...</span>
        </button>
      )}

      {/* ── Dropdown panel ── */}
      {showDropdown && (
        <div className="absolute bottom-full left-0 mb-2 w-[420px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e2130] shadow-xl z-50 overflow-hidden">
          {/* ── Tabs ── */}
          <div className="flex border-b border-gray-100 dark:border-gray-800">
            <TabButton
              active={activeTab === "existing"}
              onClick={() => setActiveTab("existing")}
            >
              <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1h-8a1 1 0 00-1 1v6.708A2.486 2.486 0 014.5 9h8V1.5z" />
              </svg>
              Repositories
            </TabButton>
            <TabButton
              active={activeTab === "clone"}
              onClick={() => {
                setActiveTab("clone");
                setTimeout(() => cloneInputRef.current?.focus(), 50);
              }}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Clone from GitHub
            </TabButton>
          </div>

          {/* ── Existing repos tab ── */}
          {activeTab === "existing" && (
            <>
              {/* Search */}
              <div className="p-2 border-b border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-gray-50 dark:bg-[#161922] border border-gray-200 dark:border-gray-700">
                  <SearchIcon />
                  <input
                    ref={inputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search repositories or paste GitHub URL..."
                    className="flex-1 bg-transparent text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none"
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setShowDropdown(false);
                    }}
                    autoFocus
                  />
                </div>
              </div>

              {/* Repo list */}
              <div className="max-h-64 overflow-y-auto">
                {loadingRepos ? (
                  <EmptyState>Loading repositories...</EmptyState>
                ) : filteredRepos.length === 0 ? (
                  <EmptyState>
                    {repos.length === 0
                      ? 'No repositories yet. Switch to "Clone from GitHub" to add one.'
                      : "No matching repositories."}
                  </EmptyState>
                ) : (
                  <>
                    <SectionHeader>Cloned Repositories</SectionHeader>
                    {filteredRepos.map((repo) => (
                      <RepoListItem
                        key={repo.path}
                        repo={repo}
                        isSelected={value?.path === repo.path}
                        onClick={() => handleSelectRepo(repo)}
                      />
                    ))}
                  </>
                )}
              </div>
            </>
          )}

          {/* ── Clone tab ── */}
          {activeTab === "clone" && (
            <div className="p-3 space-y-3">
              {/* URL input */}
              <div>
                <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1 block">
                  Repository URL
                </label>
                <div className="flex items-center gap-1.5">
                  <div className="flex-1 flex items-center rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#161922] overflow-hidden">
                    <span className="pl-2.5 text-[10px] text-gray-400 dark:text-gray-500 font-mono whitespace-nowrap">
                      github.com/
                    </span>
                    <input
                      ref={cloneInputRef}
                      type="text"
                      value={cloneUrl.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")}
                      onChange={(e) => {
                        const v = e.target.value;
                        // Accept both "owner/repo" and full URL forms
                        setCloneUrl(
                          v.includes("github.com") ? v : v
                        );
                        setCloneError(null);
                      }}
                      placeholder="owner/repo"
                      className="flex-1 px-1.5 py-2 bg-transparent text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none font-mono"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && cloneUrl.trim()) {
                          handleClone(
                            cloneUrl.includes("github.com")
                              ? cloneUrl
                              : cloneUrl
                          );
                        }
                        if (e.key === "Escape") setShowDropdown(false);
                      }}
                      autoFocus
                    />
                  </div>
                </div>
              </div>

              {/* Clone progress */}
              {cloneProgress && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">
                      {cloneProgress.message}
                    </span>
                    <span className="text-[10px] font-mono text-gray-400">
                      {cloneProgress.percent}%
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-300"
                      style={{ width: `${Math.max(cloneProgress.percent, 2)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Clone error */}
              {cloneError && (
                <div className="rounded-md bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/50 px-3 py-2">
                  <div className="text-xs text-red-700 dark:text-red-400">
                    {cloneError}
                  </div>
                </div>
              )}

              {/* Clone button */}
              <button
                type="button"
                onClick={() =>
                  handleClone(
                    cloneUrl.includes("github.com")
                      ? cloneUrl
                      : cloneUrl
                  )
                }
                disabled={cloning || !cloneUrl.trim()}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {cloning ? (
                  <>
                    <Spinner />
                    Cloning...
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Clone Repository
                  </>
                )}
              </button>

              <div className="text-[10px] text-gray-400 dark:text-gray-500">
                The repo will be cloned and used as the agent working directory.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub Components ─────────────────────────────────────────────────────

function SelectedRepoPill({
  value,
  repos,
  onClickName,
  onClear,
  onBranchChange,
}: {
  value: RepoSelection;
  repos: ClonedRepo[];
  onClickName: () => void;
  onClear: () => void;
  onBranchChange: (branch: string) => void;
}) {
  const currentRepo = repos.find((r) => r.path === value.path);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <GitRepoIcon className="w-3.5 h-3.5 text-gray-400 shrink-0" />

      {/* Repo name */}
      <button
        type="button"
        onClick={onClickName}
        className="text-xs font-medium text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 transition-colors truncate max-w-[200px]"
        title={value.name}
      >
        {value.name}
      </button>

      {/* Branch selector */}
      <BranchSelector
        repoPath={value.path}
        currentBranch={value.branch}
        onBranchChange={onBranchChange}
      />

      {/* Status badges */}
      {currentRepo && !currentRepo.status.clean && (
        <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">
          {currentRepo.status.modified > 0 && `${currentRepo.status.modified}M`}
          {currentRepo.status.untracked > 0 && ` ${currentRepo.status.untracked}U`}
        </span>
      )}

      {/* Clear */}
      <button
        type="button"
        onClick={onClear}
        className="ml-0.5 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        title="Clear repo selection"
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-medium transition-colors ${
        active
          ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 bg-blue-50/50 dark:bg-blue-900/10"
          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50"
      }`}
    >
      {children}
    </button>
  );
}

function RepoListItem({
  repo,
  isSelected,
  onClick,
}: {
  repo: ClonedRepo;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full px-3 py-2 flex items-center gap-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${
        isSelected ? "bg-blue-50 dark:bg-blue-900/10" : ""
      }`}
    >
      <div className="w-7 h-7 rounded-md bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
        <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" viewBox="0 0 16 16" fill="currentColor">
          <path fillRule="evenodd" d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1h-8a1 1 0 00-1 1v6.708A2.486 2.486 0 014.5 9h8V1.5z" />
        </svg>
      </div>
      <div className="flex-1 text-left min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
            {repo.name}
          </span>
          {isSelected && <CheckIcon />}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-gray-500 dark:text-gray-400 font-mono flex items-center gap-0.5">
            <BranchIcon />
            {repo.branch}
          </span>
          {!repo.status.clean && (
            <span className="text-[9px] text-yellow-600 dark:text-yellow-400">modified</span>
          )}
          {repo.status.behind > 0 && (
            <span className="text-[9px] text-blue-600 dark:text-blue-400">
              {repo.status.behind} behind
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-1.5 text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
      {children}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-4 text-center text-xs text-gray-400">
      {children}
    </div>
  );
}

// ─── Icons ──────────────────────────────────────────────────────────────

function GitRepoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-3 h-3 text-blue-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
