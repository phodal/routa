"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useTranslation } from "@/i18n";
import type { KanbanRepoChanges, KanbanFileChangeItem, KanbanTaskChanges, KanbanCommitInfo } from "../kanban-file-changes-types";
import { KanbanUnstagedSection } from "./kanban-unstaged-section";
import { KanbanStagedSection } from "./kanban-staged-section";
import { KanbanCommitsSection } from "./kanban-commits-section";
import { KanbanCommitModal } from "./kanban-commit-modal";
import { KanbanInlineDiffViewer } from "./kanban-inline-diff-viewer";
import { KanbanGitOperationButtons } from "./kanban-git-operation-buttons";
import { KanbanWorkflowActions } from "./kanban-workflow-actions";
import { loadKanbanFileDiff } from "./kanban-file-diff-loader";
import { useGitOperations } from "../hooks/use-git-operations";
import { useKeyboardShortcuts } from "../hooks/use-keyboard-shortcuts";

interface KanbanEnhancedFileChangesPanelProps {
  taskId?: string;
  workspaceId: string;
  repos?: KanbanRepoChanges[];
  changes?: KanbanTaskChanges | null;
  loading?: boolean;
  open?: boolean;
  onClose?: () => void;
  onRefresh?: () => void;
  embedded?: boolean; // true when used in card detail, false when used as sidebar
}

export function KanbanEnhancedFileChangesPanel({
  taskId,
  workspaceId,
  repos = [],
  changes,
  loading = false,
  open = true,
  onClose,
  onRefresh,
  embedded = false,
}: KanbanEnhancedFileChangesPanelProps) {
  const { t } = useTranslation();
  const [autoCommit, setAutoCommit] = useState(false);
  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [activeDiffFile, setActiveDiffFile] = useState<KanbanFileChangeItem | null>(null);
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [commits, setCommits] = useState<KanbanCommitInfo[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [commitsRefreshToken, setCommitsRefreshToken] = useState(0);
  const [commitsOpen, setCommitsOpen] = useState(false);
  const [commitsLoaded, setCommitsLoaded] = useState(false);
  const [lastLoadedCommitsRefreshToken, setLastLoadedCommitsRefreshToken] = useState(0);

  // Support both sidebar mode (repos) and embedded mode (changes)
  const activeRepo = repos && repos.length > 0 ? repos[0] : null;
  const codebaseId = changes?.codebaseId || activeRepo?.codebaseId || "";

  const handleGitSuccess = useCallback(() => {
    onRefresh?.();
    setCommitsRefreshToken((token) => token + 1);
  }, [onRefresh]);

  const handleGitError = useCallback((error: string) => {
    // Silently log Git operation errors - they're expected when codebase is not a valid git repo
    if (error.includes("work tree") || error.includes("git repository")) {
      // Expected: codebase may not be a git repository or may be in a special state
      return;
    }
    console.error("Git operation failed:", error);
  }, []);

  const {
    stageFiles,
    unstageFiles,
    createCommit,
    discardChanges,
    getCommits,
    getCommitDiff,
    exportChanges,
    pullCommits,
    rebaseBranch,
    resetBranch,
    loading: gitLoading
  } = useGitOperations({
    workspaceId,
    codebaseId,
    onSuccess: handleGitSuccess,
    onError: handleGitError,
  });

  // Separate files into unstaged and staged
  const { unstagedFiles, stagedFiles } = useMemo(() => {
    // Embedded mode (card detail): use changes
    if (embedded && changes) {
      return {
        unstagedFiles: changes.files || [],
        stagedFiles: [],
      };
    }

    // Sidebar mode: use repos
    if (!activeRepo) {
      return { unstagedFiles: [], stagedFiles: [] };
    }

    // If repo already has unstagedFiles/stagedFiles, use them
    if (activeRepo.unstagedFiles || activeRepo.stagedFiles) {
      return {
        unstagedFiles: activeRepo.unstagedFiles || [],
        stagedFiles: activeRepo.stagedFiles || [],
      };
    }

    // Otherwise, treat all files as unstaged (backward compatibility)
    return {
      unstagedFiles: activeRepo.files || [],
      stagedFiles: [],
    };
  }, [embedded, changes, activeRepo]);

  // State for file selection
  const [fileSelections, setFileSelections] = useState<Record<string, boolean>>({});

  const handleFileSelect = useCallback((file: KanbanFileChangeItem, selected: boolean) => {
    setFileSelections((prev) => ({
      ...prev,
      [file.path]: selected,
    }));
  }, []);

  const handleSelectAll = useCallback((files: KanbanFileChangeItem[], selected: boolean) => {
    setFileSelections((prev) => {
      const next = { ...prev };
      files.forEach((file) => {
        next[file.path] = selected;
      });
      return next;
    });
  }, []);

  // Add selection state to files
  const unstagedWithSelection = useMemo(
    () => unstagedFiles.map((f) => ({ ...f, selected: fileSelections[f.path] || false })),
    [unstagedFiles, fileSelections]
  );

  const stagedWithSelection = useMemo(
    () => stagedFiles.map((f) => ({ ...f, selected: fileSelections[f.path] || false })),
    [stagedFiles, fileSelections]
  );

  // Handlers
  const handleStageSelected = useCallback(async () => {
    const selectedFiles = unstagedWithSelection.filter((f) => f.selected).map((f) => f.path);
    if (selectedFiles.length === 0) return;

    await stageFiles(selectedFiles);
    setFileSelections({});
  }, [unstagedWithSelection, stageFiles]);

  const handleUnstageSelected = useCallback(async () => {
    const selectedFiles = stagedWithSelection.filter((f) => f.selected).map((f) => f.path);
    if (selectedFiles.length === 0) return;

    await unstageFiles(selectedFiles);
    setFileSelections({});
  }, [stagedWithSelection, unstageFiles]);

  const handleDiscardSelected = useCallback(async () => {
    const selectedFiles = unstagedWithSelection.filter((f) => f.selected).map((f) => f.path);
    if (selectedFiles.length === 0) return;

    // TODO: Add confirmation dialog
    const confirmed = window.confirm(
      `Are you sure you want to discard changes to ${selectedFiles.length} file(s)? This cannot be undone.`
    );
    if (!confirmed) return;

    await discardChanges(selectedFiles);
    setFileSelections({});
  }, [unstagedWithSelection, discardChanges]);

  const handleCommit = useCallback(async (message: string) => {
    await createCommit(message);
    setCommitModalOpen(false);
  }, [createCommit]);

  // Load commits
  const loadCommits = useCallback(async () => {
    if (!codebaseId || embedded) return; // Only load commits in sidebar mode

    setCommitsLoading(true);
    try {
      const fetchedCommits = await getCommits(20); // Get last 20 commits
      setCommits(fetchedCommits);
      setCommitsLoaded(true);
      setLastLoadedCommitsRefreshToken(commitsRefreshToken);
    } catch (error) {
      // Silently fail if not a git repository - this is expected
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes("work tree") && !errorMessage.includes("git repository")) {
        console.error("Failed to load commits:", error);
      }
      setCommits([]); // Set empty commits array
      setCommitsLoaded(true);
      setLastLoadedCommitsRefreshToken(commitsRefreshToken);
    } finally {
      setCommitsLoading(false);
    }
  }, [codebaseId, embedded, getCommits, commitsRefreshToken]);

  useEffect(() => {
    setCommits([]);
    setCommitsLoaded(false);
    setCommitsOpen(false);
    setLastLoadedCommitsRefreshToken(0);
  }, [codebaseId]);

  // Load commits only when the section is expanded, and after successful git operations
  useEffect(() => {
    if (!commitsOpen) return;
    if (commitsLoaded && commitsRefreshToken === lastLoadedCommitsRefreshToken) return;
    loadCommits();
  }, [loadCommits, commitsOpen, commitsLoaded, commitsRefreshToken, lastLoadedCommitsRefreshToken]);

  const handleFileClick = useCallback(async (file: KanbanFileChangeItem, staged = false) => {
    setActiveDiffFile(file);
    setDiffError(null);

    setDiffLoading(true);

    try {
      const diff = await loadKanbanFileDiff({
        file,
        taskId: embedded ? taskId : undefined,
        workspaceId,
        codebaseId,
        staged,
      });
      setDiffContent(diff);
    } catch (error) {
      setDiffError(error instanceof Error ? error.message : "Failed to load diff");
    } finally {
      setDiffLoading(false);
    }
  }, [embedded, taskId, workspaceId, codebaseId]);

  const handleCloseDiff = useCallback(() => {
    setActiveDiffFile(null);
    setDiffContent(null);
    setDiffError(null);
  }, []);

  const handleCommitFileClick = useCallback(async (file: KanbanFileChangeItem, commitSha: string) => {
    setActiveDiffFile(file);
    setDiffError(null);
    setDiffLoading(true);

    try {
      const diff = await getCommitDiff(commitSha, file.path);
      setDiffContent(diff);
    } catch (error) {
      setDiffError(error instanceof Error ? error.message : "Failed to load commit diff");
    } finally {
      setDiffLoading(false);
    }
  }, [getCommitDiff]);

  const handleOpenCommit = useCallback((commit: KanbanCommitInfo) => {
    // TODO: Open commit in external viewer or GitHub
    console.log("Open commit:", commit.sha);
  }, []);

  const handleRevertCommit = useCallback((commit: KanbanCommitInfo) => {
    // TODO: Implement revert functionality
    console.log("Revert commit:", commit.sha);
  }, []);

  const handleExport = useCallback(async () => {
    const result = await exportChanges();
    if (result.success && result.patch && result.filename) {
      // Create a download link
      const blob = new Blob([result.patch], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [exportChanges]);

  const handlePull = useCallback(async () => {
    const confirmed = window.confirm(
      `Pull commits from remote? This will update your local branch.`
    );
    if (!confirmed) return;

    await pullCommits();
  }, [pullCommits]);

  const handleRebase = useCallback(async () => {
    const targetBranch = activeRepo?.targetBranch || "main";
    const confirmed = window.confirm(
      `Rebase current branch onto ${targetBranch}? This will rewrite commit history.`
    );
    if (!confirmed) return;

    await rebaseBranch(targetBranch);
  }, [rebaseBranch, activeRepo?.targetBranch]);

  const handleReset = useCallback(async () => {
    const targetBranch = activeRepo?.targetBranch || "main";
    const confirmed = window.confirm(
      `Reset to a clean ${targetBranch}? This will discard all local commits and working directory changes.`
    );
    if (!confirmed) return;

    await resetBranch(targetBranch, "hard", true);
  }, [resetBranch, activeRepo?.targetBranch]);

  const handleArchive = useCallback(() => {
    // TODO: Implement archive and create new workspace
    alert("Archive functionality will create a new workspace from fresh checkout. Coming soon!");
  }, []);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    enabled: open,
    callbacks: {
      onTogglePanel: onClose,
      onEscape: activeDiffFile ? handleCloseDiff : onClose,
      onStageSelected: () => {
        const selected = unstagedWithSelection.filter((f) => f.selected);
        if (selected.length > 0) {
          handleStageSelected();
        }
      },
      onUnstageSelected: () => {
        const selected = stagedWithSelection.filter((f) => f.selected);
        if (selected.length > 0) {
          handleUnstageSelected();
        }
      },
      onOpenCommit: () => {
        if (stagedFiles.length > 0) {
          setCommitModalOpen(true);
        }
      },
      onSelectAll: () => {
        // Select all unstaged files (could be improved to be context-aware)
        handleSelectAll(unstagedWithSelection, true);
      },
      onShowDiff: () => {
        // Show diff for first selected file
        const selected = [...unstagedWithSelection, ...stagedWithSelection].find(
          (f) => f.selected
        );
        if (selected) {
          const isStaged = stagedWithSelection.includes(selected);
          handleFileClick(selected, isStaged);
        }
      },
    },
  });

  const summary = {
    changedRepos: repos ? repos.filter((r) => !r.error && !r.status.clean).length : 0,
    changedFiles: repos ? repos.reduce((count, repo) => count + (repo.files?.length || 0), 0) : (changes?.files?.length || 0),
  };

  // Embedded mode: always show
  if (!embedded && !open) return null;

  // Embedded mode (card detail): render without backdrop/panel wrapper
  if (embedded) {
    return (
      <>
        <div className="divide-y divide-slate-200/70 dark:divide-slate-800/80">
          {loading ? (
            <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
              {t.kanbanDetail.loadingChanges}
            </div>
          ) : !changes && !activeRepo ? (
            <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
              {t.kanbanDetail.noRepoChanges}
            </div>
          ) : (
            <>
              {/* Unstaged Section */}
              <KanbanUnstagedSection
                files={unstagedWithSelection}
                autoCommit={autoCommit}
                onAutoCommitToggle={setAutoCommit}
                embedded={true}
                onFileClick={(file) => handleFileClick(file, false)}
                onFileSelect={handleFileSelect}
                onSelectAll={(selected) => handleSelectAll(unstagedWithSelection, selected)}
                onStageSelected={handleStageSelected}
                onDiscardSelected={handleDiscardSelected}
                loading={gitLoading}
              />

              {/* Inline Diff Viewer */}
              {activeDiffFile && (
                <KanbanInlineDiffViewer
                  file={activeDiffFile}
                  diff={diffContent || undefined}
                  loading={diffLoading}
                  error={diffError || undefined}
                  embedded={true}
                  onClose={handleCloseDiff}
                />
              )}

              {/* Staged Section */}
              <KanbanStagedSection
                files={stagedWithSelection}
                onFileClick={(file) => handleFileClick(file, true)}
                onFileSelect={handleFileSelect}
                onSelectAll={(selected) => handleSelectAll(stagedWithSelection, selected)}
                onUnstageSelected={handleUnstageSelected}
                onCommit={() => setCommitModalOpen(true)}
                onExport={handleExport}
                loading={gitLoading}
              />
            </>
          )}
        </div>

        {/* Commit Modal */}
        <KanbanCommitModal
          open={commitModalOpen}
          onClose={() => setCommitModalOpen(false)}
          onCommit={handleCommit}
          fileCount={stagedFiles.length}
        />
      </>
    );
  }

  // Sidebar mode: render with backdrop and panel wrapper
  return (
    <>
      {/* Backdrop */}
      <div
        className="absolute inset-0 z-20 bg-slate-900/10 backdrop-blur-[1px] dark:bg-black/20"
        onClick={onClose}
        data-testid="kanban-file-changes-backdrop"
      />

      {/* Panel */}
      <aside
        className="absolute inset-y-0 right-0 z-30 flex h-full w-[22rem] flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c]"
        data-testid="kanban-file-changes-panel"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-[#191c28]">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t.kanban.fileChanges}
            </div>
            <div className="text-[11px] text-slate-400 dark:text-slate-500">
              {activeRepo?.label || "No repository"} @ {activeRepo?.branch || "—"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {summary.changedRepos > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                {summary.changedRepos} dirty
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-[#191c28]"
            >
              {t.kanban.hide}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-slate-400 dark:text-slate-500">
              Loading repository changes...
            </div>
          ) : !activeRepo ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-500">
              No repositories linked to this workspace
            </div>
          ) : (
            <div className="space-y-3">
              {/* Unstaged Section */}
              <KanbanUnstagedSection
                files={unstagedWithSelection}
                autoCommit={autoCommit}
                onAutoCommitToggle={setAutoCommit}
                onFileClick={(file) => handleFileClick(file, false)}
                onFileSelect={handleFileSelect}
                onSelectAll={(selected) => handleSelectAll(unstagedWithSelection, selected)}
                onStageSelected={handleStageSelected}
                onDiscardSelected={handleDiscardSelected}
                loading={gitLoading}
              />

              {/* Inline Diff Viewer */}
              {activeDiffFile && (
                <KanbanInlineDiffViewer
                  file={activeDiffFile}
                  diff={diffContent || undefined}
                  loading={diffLoading}
                  error={diffError || undefined}
                  onClose={handleCloseDiff}
                />
              )}

              {/* Staged Section */}
              <KanbanStagedSection
                files={stagedWithSelection}
                onFileClick={(file) => handleFileClick(file, true)}
                onFileSelect={handleFileSelect}
                onSelectAll={(selected) => handleSelectAll(stagedWithSelection, selected)}
                onUnstageSelected={handleUnstageSelected}
                onCommit={() => setCommitModalOpen(true)}
                onExport={handleExport}
                loading={gitLoading}
              />

              {/* Commits Section */}
              <KanbanCommitsSection
                commits={commits}
                onFileClick={handleCommitFileClick}
                onOpenCommit={handleOpenCommit}
                onRevertCommit={handleRevertCommit}
                expanded={commitsOpen}
                onToggle={() => setCommitsOpen((open) => !open)}
                loading={commitsLoading}
              />

              {/* Git Operation Buttons */}
              {commits.length > 0 && (
                <KanbanGitOperationButtons
                  targetBranch={activeRepo?.targetBranch}
                  ahead={activeRepo?.ahead}
                  behind={activeRepo?.behind}
                  onPull={handlePull}
                  onRebase={handleRebase}
                  loading={gitLoading}
                />
              )}

              {/* Workflow Actions */}
              <KanbanWorkflowActions
                targetBranch={activeRepo?.targetBranch}
                onReset={handleReset}
                onArchive={handleArchive}
                loading={gitLoading}
              />
            </div>
          )}
        </div>
      </aside>

      {/* Commit Modal */}
      <KanbanCommitModal
        open={commitModalOpen}
        onClose={() => setCommitModalOpen(false)}
        onCommit={handleCommit}
        fileCount={stagedFiles.length}
      />
    </>
  );
}
