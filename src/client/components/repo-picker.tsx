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
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { desktopAwareFetch } from "../utils/diagnostics";
import { createPortal } from "react-dom";
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
  /** How to render the selected repo path when a repo is chosen */
  pathDisplay?: "inline" | "below-muted" | "hidden";
  /** Limit existing repo list to additionalRepos only */
  sourceMode?: "all" | "additional-only";
  /** Whether clone UI should be shown */
  allowClone?: boolean;
  /** Additional repos to show (e.g., workspace codebases) */
  additionalRepos?: Array<{
    name: string;
    path: string;
    branch?: string;
  }>;
}

type PickerTab = "existing" | "clone" | "local";

interface CloneProgress {
  phase: string;
  percent: number;
  message: string;
}

interface RepoActionResult {
  success?: boolean;
  branch?: string;
}

function isGitHubInput(text: string): boolean {
  const t = text.trim();
  return (
    /^https?:\/\/github\.com\//i.test(t) ||
    /^git@github\.com:/i.test(t) ||
    /^github\.com\//i.test(t) ||
    /^[a-zA-Z0-9\-_]+\/[a-zA-Z0-9\-_.]+$/.test(t)
  );
}

function isLikelyLocalPath(text: string): boolean {
  const t = text.trim();
  return (
    t.startsWith("/") ||
    t.startsWith("~/") ||
    t.startsWith("./") ||
    t.startsWith("../") ||
    /^[a-zA-Z]:[\\/]/.test(t)
  );
}
// ─── Component ──────────────────────────────────────────────────────────
export function RepoPicker({
  value,
  onChange,
  pathDisplay = "inline",
  sourceMode = "all",
  allowClone = true,
  additionalRepos,
}: RepoPickerProps) {
  const [repos, setRepos] = useState<ClonedRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeTab, setActiveTab] = useState<PickerTab>("existing");
  const [searchQuery, setSearchQuery] = useState("");
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneProgress, setCloneProgress] = useState<CloneProgress | null>(null);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [localPath, setLocalPath] = useState("");
  const [loadingLocalRepo, setLoadingLocalRepo] = useState(false);
  const [localRepoError, setLocalRepoError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cloneInputRef = useRef<HTMLInputElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
  } | null>(null);

  // ── Fetch repos ────────────────────────────────────────────────────

  const fetchRepos = useCallback(async () => {
    setLoadingRepos(true);
    try {
      const res = await desktopAwareFetch("/api/clone");
      const data = await res.json();
      setRepos(data.repos || []);
    } catch {
      // ignore
    } finally {
      setLoadingRepos(false);
    }
  }, []);

  useEffect(() => {
    if (sourceMode === "all") {
      fetchRepos();
    }
  }, [fetchRepos, sourceMode]);

  // ── Click outside to close ─────────────────────────────────────────

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inDropdown = containerRef.current?.contains(target);
      const inTrigger = triggerRef.current?.contains(target);
      if (!inDropdown && !inTrigger) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Recalculate dropdown position on scroll/resize ─────────────────

  const openDropdown = useCallback((ref: HTMLElement | null) => {
    if (!ref) return;
    const rect = ref.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const preferredHeight = 360;
    const spaceBelow = viewportHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openDownward = spaceBelow >= preferredHeight || spaceBelow >= spaceAbove;
    setDropdownPos({
      left: rect.left,
      ...(openDownward
        ? { top: rect.bottom + 6 }
        : { bottom: viewportHeight - rect.top + 6 }),
      width: Math.max(rect.width, 420),
      maxHeight: Math.max(220, Math.min(preferredHeight, openDownward ? spaceBelow : spaceAbove)),
    });
    setShowDropdown(true);
  }, []);

  // ── Auto-detect GitHub URL in search → switch to clone tab ─────────

  useEffect(() => {
    if (allowClone && searchQuery && isGitHubInput(searchQuery)) {
      setActiveTab("clone");
      setCloneUrl(searchQuery);
    } else if (searchQuery && isLikelyLocalPath(searchQuery)) {
      setActiveTab("local");
      setLocalPath(searchQuery);
    }
  }, [allowClone, searchQuery]);

  // ── Clone with progress (SSE) ──────────────────────────────────────

  const handleClone = useCallback(
    async (url: string) => {
      if (!url.trim()) return;
      setCloning(true);
      setCloneError(null);
      setCloneProgress({ phase: "starting", percent: 0, message: "Starting clone..." });

      try {
        const res = await desktopAwareFetch("/api/clone/progress", {
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

  const handleSelectLocalRepo = useCallback(
    async (repoPath: string) => {
      if (!repoPath.trim()) return;

      setLoadingLocalRepo(true);
      setLocalRepoError(null);

      try {
        const res = await desktopAwareFetch("/api/clone/local", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: repoPath.trim() }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "Failed to load local repository"
          );
        }

        onChange({
          name:
            typeof data?.name === "string"
              ? data.name
              : repoPath.trim().split("/").pop() || repoPath.trim(),
          path: typeof data?.path === "string" ? data.path : repoPath.trim(),
          branch: typeof data?.branch === "string" ? data.branch : "",
        });
        setLocalPath("");
        setSearchQuery("");
        setShowDropdown(false);
      } catch (err) {
        setLocalRepoError(
          err instanceof Error ? err.message : "Failed to load local repository"
        );
      } finally {
        setLoadingLocalRepo(false);
      }
    },
    [onChange]
  );

  // ── Clear selection ────────────────────────────────────────────────

  const handleClear = useCallback(() => {
    onChange(null);
    setSearchQuery("");
  }, [onChange]);

  const handleBranchChange = useCallback(
    async (repo: ClonedRepo, branch: string) => {
      await fetchRepos();
      if (value?.path === repo.path) {
        onChange({ ...value, branch });
      }
    },
    [fetchRepos, onChange, value]
  );

  const handleResetRepo = useCallback(
    async (repo: ClonedRepo) => {
      const confirmed = window.confirm(
        `Discard all local changes in ${repo.name} (${repo.branch})? This will run git reset --hard HEAD and git clean -fd.`
      );
      if (!confirmed) return;

      const res = await desktopAwareFetch("/api/clone/branches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath: repo.path, action: "reset" }),
      });
      const data = (await res.json().catch(() => ({}))) as RepoActionResult & { error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Failed to reset ${repo.name}`);
      }

      await fetchRepos();
      if (value?.path === repo.path && data.branch) {
        onChange({ ...value, branch: data.branch });
      }
    },
    [fetchRepos, onChange, value]
  );

  const handleLocalPathKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && localPath.trim()) {
        void handleSelectLocalRepo(localPath);
        return;
      }
      if (e.key === "Escape") {
        setShowDropdown(false);
      }
    },
    [handleSelectLocalRepo, localPath]
  );

  // ── Filtered repos ─────────────────────────────────────────────────

  // Merge cloned repos with additional repos (workspace codebases)
  const allRepos = useMemo(() => {
    const merged: ClonedRepo[] = sourceMode === "additional-only" ? [] : [...repos];
    const existingPaths = new Set(merged.map((r) => r.path));

    // Add additional repos that aren't already in the cloned repos list
    if (additionalRepos) {
      for (const ar of additionalRepos) {
        if (!existingPaths.has(ar.path)) {
          merged.push({
            name: ar.name,
            path: ar.path,
            dirName: ar.path.split("/").pop() || ar.name,
            branch: ar.branch || "",
            branches: ar.branch ? [ar.branch] : [],
            status: { clean: true, ahead: 0, behind: 0, modified: 0, untracked: 0 },
          });
        }
      }
    }

    if (value && !existingPaths.has(value.path)) {
      merged.push({
        name: value.name,
        path: value.path,
        dirName: value.path.split("/").pop() || value.name,
        branch: value.branch || "",
        branches: value.branch ? [value.branch] : [],
        status: { clean: true, ahead: 0, behind: 0, modified: 0, untracked: 0 },
      });
    }
    return merged;
  }, [additionalRepos, repos, sourceMode, value]);

  const filteredRepos = searchQuery.trim()
    ? allRepos.filter((r) =>
        r.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allRepos;

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="relative">
      {/* ── Selected state: show repo pill ── */}
      {value ? (
        <SelectedRepoPill
          value={value}
          repos={repos}
          pathDisplay={pathDisplay}
          triggerRef={triggerRef}
          onClickName={() => {
            if (showDropdown) {
              setShowDropdown(false);
            } else {
              openDropdown(triggerRef.current);
              setTimeout(() => inputRef.current?.focus(), 50);
            }
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
          ref={triggerRef}
          type="button"
          onClick={() => {
            openDropdown(triggerRef.current);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
          className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          <GitRepoIcon className="w-3.5 h-3.5" />
          <span>Select, clone, or load a repository...</span>
        </button>
      )}

      {/* ── Dropdown panel (portal to escape overflow-hidden) ── */}
      {showDropdown && dropdownPos && createPortal(
        <div
          ref={containerRef}
          style={{
            position: "fixed",
            left: dropdownPos.left,
            top: dropdownPos.top,
            bottom: dropdownPos.bottom,
            width: 420,
            maxHeight: dropdownPos.maxHeight,
            zIndex: 9999,
          }}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2130] shadow-xl overflow-hidden flex max-h-[80vh] flex-col"
        >
          {/* ── Tabs ── */}
          <div className="flex border-b border-slate-100 dark:border-slate-800">
            <TabButton
              active={activeTab === "existing"}
              onClick={() => setActiveTab("existing")}
            >
              <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1h-8a1 1 0 00-1 1v6.708A2.486 2.486 0 014.5 9h8V1.5z" />
              </svg>
              Repositories
            </TabButton>
            {allowClone ? (
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
            ) : null}
            <TabButton
              active={activeTab === "local"}
              onClick={() => setActiveTab("local")}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5A1.5 1.5 0 014.5 6h4.379a1.5 1.5 0 011.06.44l1.12 1.12a1.5 1.5 0 001.06.44H19.5A1.5 1.5 0 0121 9.5v8A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5v-10z" />
              </svg>
              Local Project
            </TabButton>
          </div>

          {/* ── Existing repos tab ── */}
          {activeTab === "existing" && (
            <>
              {/* Search */}
              <div className="p-2 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-slate-50 dark:bg-[#161922] border border-slate-200 dark:border-slate-700">
                  <SearchIcon />
                  <input
                    ref={inputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search repositories, paste GitHub URL, or enter local path..."
                    className="flex-1 bg-transparent text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 outline-none"
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setShowDropdown(false);
                    }}
                    autoFocus
                  />
                </div>
              </div>

              {/* Repo list */}
              <div className="overflow-y-auto">
                {loadingRepos ? (
                  <EmptyState>Loading repositories...</EmptyState>
                ) : filteredRepos.length === 0 ? (
                  <EmptyState>
                    {allRepos.length === 0
                      ? 'No repositories yet. Switch to "Clone from GitHub" or "Local Project" to add one.'
                      : "No matching repositories."}
                  </EmptyState>
                ) : (
                  <>
                    <SectionHeader>Available Repositories</SectionHeader>
                    {filteredRepos.map((repo) => (
                      <RepoListItem
                        key={repo.path}
                        repo={repo}
                        isSelected={value?.path === repo.path}
                        onClick={() => handleSelectRepo(repo)}
                        onBranchChange={(branch) => handleBranchChange(repo, branch)}
                        onReset={() => handleResetRepo(repo)}
                      />
                    ))}
                  </>
                )}
              </div>
            </>
          )}

          {/* ── Clone tab ── */}
          {allowClone && activeTab === "clone" && (
            <div className="p-3 space-y-3">
              {/* URL input */}
              <div>
                <label className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 block">
                  Repository URL
                </label>
                <div className="flex items-center gap-1.5">
                  <div className="flex-1 flex items-center rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#161922] overflow-hidden">
                    <span className="pl-2.5 text-[10px] text-slate-400 dark:text-slate-500 font-mono whitespace-nowrap">
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
                      className="flex-1 px-1.5 py-2 bg-transparent text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 outline-none font-mono"
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
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                      {cloneProgress.message}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      {cloneProgress.percent}%
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
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

              <div className="text-[10px] text-slate-400 dark:text-slate-500">
                The repo will be cloned and used as the agent working directory.
              </div>
            </div>
          )}

          {activeTab === "local" && (
            <div className="p-3 space-y-3">
              <div>
                <label className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 block">
                  Local Repository Path
                </label>
                <input
                  type="text"
                  value={localPath}
                  onChange={(e) => {
                    setLocalPath(e.target.value);
                    setLocalRepoError(null);
                  }}
                  placeholder="/Users/you/project or ~/project"
                  className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#161922] px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 outline-none"
                  onKeyDown={handleLocalPathKeyDown}
                  autoFocus
                />
              </div>

              {localRepoError && (
                <div className="rounded-md bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/50 px-3 py-2">
                  <div className="text-xs text-red-700 dark:text-red-400">
                    {localRepoError}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => void handleSelectLocalRepo(localPath)}
                disabled={loadingLocalRepo || !localPath.trim()}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loadingLocalRepo ? (
                  <>
                    <Spinner />
                    Loading Project...
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5A1.5 1.5 0 014.5 6h4.379a1.5 1.5 0 011.06.44l1.12 1.12a1.5 1.5 0 001.06.44H19.5A1.5 1.5 0 0121 9.5v8A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5v-10z" />
                    </svg>
                    Use Local Project
                  </>
                )}
              </button>

              <div className="text-[10px] text-slate-400 dark:text-slate-500">
                The path must exist locally and already be a git repository.
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Sub Components ─────────────────────────────────────────────────────

function SelectedRepoPill({
  value,
  repos,
  pathDisplay,
  triggerRef,
  onClickName,
  onClear,
  onBranchChange,
}: {
  value: RepoSelection;
  repos: ClonedRepo[];
  pathDisplay: "inline" | "below-muted" | "hidden";
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClickName: () => void;
  onClear: () => void;
  onBranchChange: (branch: string) => void;
}) {
  const currentRepo = repos.find((r) => r.path === value.path);
  const showInlinePath = pathDisplay === "inline";
  const showMutedPath = pathDisplay === "below-muted";

  return (
    <div className={`min-w-0 ${showMutedPath ? "flex flex-col gap-0.5" : "flex items-center gap-1.5 overflow-hidden"}`}>
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <GitRepoIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />

        <button
          ref={triggerRef}
          type="button"
          onClick={onClickName}
          className="text-xs font-medium text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 transition-colors truncate max-w-[200px]"
          title={value.name}
        >
          {value.name}
        </button>

        <div className="shrink-0">
          <BranchSelector
            repoPath={value.path}
            currentBranch={value.branch}
            onBranchChange={onBranchChange}
          />
        </div>

        {showInlinePath && (
          <span
            className="max-w-[200px] truncate text-[10px] font-mono text-slate-500 dark:text-slate-400"
            title={value.path}
          >
            {value.path}
          </span>
        )}

        {currentRepo && !currentRepo.status.clean && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
            {currentRepo.status.modified > 0 && `${currentRepo.status.modified}M`}
            {currentRepo.status.untracked > 0 && ` ${currentRepo.status.untracked}U`}
          </span>
        )}

        <button
          type="button"
          onClick={onClear}
          className="ml-0.5 p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          title="Clear repo selection"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {showMutedPath && (
        <div className="pl-5 text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate" title={value.path}>
          {value.path}
        </div>
      )}
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
          : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50"
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
  onBranchChange,
  onReset,
}: {
  repo: ClonedRepo;
  isSelected: boolean;
  onClick: () => void;
  onBranchChange: (branch: string) => void | Promise<void>;
  onReset: () => void | Promise<void>;
}) {
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    if (resetting) return;
    setResetting(true);
    try {
      await onReset();
    } finally {
      setResetting(false);
    }
  };

  return (
    <div
      className={`w-full px-3 py-2 flex items-center gap-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
        isSelected ? "bg-blue-50 dark:bg-blue-900/10" : ""
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
          <svg className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1h-8a1 1 0 00-1 1v6.708A2.486 2.486 0 014.5 9h8V1.5z" />
          </svg>
        </div>
        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
              {repo.name}
            </span>
            {isSelected && <CheckIcon />}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono flex items-center gap-0.5">
              <BranchIcon />
              {repo.branch}
            </span>
            {!repo.status.clean && (
              <span className="text-[9px] text-amber-600 dark:text-amber-400">modified</span>
            )}
            {repo.status.behind > 0 && (
              <span className="text-[9px] text-blue-600 dark:text-blue-400">
                {repo.status.behind} behind
              </span>
            )}
          </div>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
        <BranchSelector
          repoPath={repo.path}
          currentBranch={repo.branch}
          onBranchChange={onBranchChange}
        />
        {!repo.status.clean && (
          <button
            type="button"
            onClick={handleReset}
            disabled={resetting}
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-900/20"
            title="Discard local changes"
          >
            <ResetIcon />
            {resetting ? "Resetting..." : "Reset"}
          </button>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-1.5 text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
      {children}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-4 text-center text-xs text-slate-400">
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
    <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v5h5" />
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
