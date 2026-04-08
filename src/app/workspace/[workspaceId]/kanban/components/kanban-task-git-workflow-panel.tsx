"use client";

import React, { useState, useMemo, useCallback } from "react";
import { useTranslation } from "@/i18n";
import type { KanbanTaskChanges, KanbanFileChangeItem } from "../kanban-file-changes-types";
import { KanbanUnstagedSection } from "./kanban-unstaged-section";
import { KanbanStagedSection } from "./kanban-staged-section";
import { KanbanCommitsSection } from "./kanban-commits-section";
import { KanbanCommitModal } from "./kanban-commit-modal";
import { KanbanInlineDiffViewer } from "./kanban-inline-diff-viewer";
import { useGitOperations } from "../hooks/use-git-operations";
import type { KanbanCommitInfo } from "../kanban-file-changes-types";

interface KanbanTaskGitWorkflowPanelProps {
  workspaceId: string;
  taskId: string;
  changes: KanbanTaskChanges | null;
  loading?: boolean;
  compact?: boolean;
  onRefresh?: () => void;
}

/**
 * Git workflow panel for kanban card detail page
 * Shows unstaged/staged/commits sections with interactive operations
 */
export function KanbanTaskGitWorkflowPanel({
  workspaceId,
  taskId: _taskId,
  changes,
  loading = false,
  compact: _compact = false,
  onRefresh,
}: KanbanTaskGitWorkflowPanelProps) {
  const { t } = useTranslation();
  const [autoCommit, setAutoCommit] = useState(false);
  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [commits, setCommits] = useState<KanbanCommitInfo[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [activeDiffFile, setActiveDiffFile] = useState<{
    file: KanbanFileChangeItem;
    commitSha?: string;
  } | null>(null);
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const codebaseId = changes?.codebaseId || "";

  const { stageFiles, unstageFiles, createCommit, discardChanges, getCommits, getFileDiff, getCommitDiff, loading: gitLoading } = useGitOperations({
    workspaceId,
    codebaseId,
    onSuccess: () => {
      onRefresh?.();
      loadCommits();
    },
    onError: (error) => {
      console.error("Git operation failed:", error);
    },
  });

  // Load commits
  const loadCommits = useCallback(async () => {
    if (!codebaseId) return;
    setCommitsLoading(true);
    try {
      const commitsList = await getCommits(20);
      setCommits(commitsList);
    } catch (error) {
      console.error("Failed to load commits:", error);
    } finally {
      setCommitsLoading(false);
    }
  }, [codebaseId, getCommits]);

  React.useEffect(() => {
    if (changes && codebaseId) {
      loadCommits();
    }
  }, [changes, codebaseId, loadCommits]);

  // Separate files into unstaged and staged
  const { unstagedFiles, stagedFiles } = useMemo(() => {
    if (!changes || !changes.files) {
      return { unstagedFiles: [], stagedFiles: [] };
    }

    // For now, treat all local changes as unstaged
    // Backend should provide unstagedFiles/stagedFiles split
    return {
      unstagedFiles: changes.files || [],
      stagedFiles: [],
    };
  }, [changes]);

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

  const handleFileClick = useCallback(async (file: KanbanFileChangeItem, staged = false) => {
    setActiveDiffFile({ file, commitSha: undefined });
    setDiffLoading(true);
    setDiffError(null);

    try {
      const diff = await getFileDiff(file.path, staged);
      setDiffContent(diff);
    } catch (error) {
      setDiffError(error instanceof Error ? error.message : "Failed to load diff");
    } finally {
      setDiffLoading(false);
    }
  }, [getFileDiff]);

  const handleCommitFileClick = useCallback(async (file: KanbanFileChangeItem, commitSha: string) => {
    setActiveDiffFile({ file, commitSha });
    setDiffLoading(true);
    setDiffError(null);

    try {
      const diff = await getCommitDiff(commitSha, file.path);
      setDiffContent(diff);
    } catch (error) {
      setDiffError(error instanceof Error ? error.message : "Failed to load commit diff");
    } finally {
      setDiffLoading(false);
    }
  }, [getCommitDiff]);

  const handleCloseDiff = useCallback(() => {
    setActiveDiffFile(null);
    setDiffContent(null);
    setDiffError(null);
  }, []);

  if (loading) {
    return (
      <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
        {t.kanbanDetail.loadingChanges}
      </div>
    );
  }

  if (!changes) {
    return (
      <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
        {t.kanbanDetail.noRepoChanges}
      </div>
    );
  }

  return (
    <>
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

        {/* Inline Diff Viewer for Unstaged */}
        {activeDiffFile && !activeDiffFile.commitSha && (
          <KanbanInlineDiffViewer
            file={activeDiffFile.file}
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
          onExport={() => {
            console.log("Export changes");
          }}
          loading={gitLoading}
        />

        {/* Commits Section */}
        <KanbanCommitsSection
          commits={commits}
          onFileClick={handleCommitFileClick}
          onOpenCommit={(commit) => {
            console.log("Open commit", commit.sha);
          }}
          onRevertCommit={(commit) => {
            console.log("Revert commit", commit.sha);
          }}
          loading={commitsLoading}
        />

        {/* Inline Diff Viewer for Commits */}
        {activeDiffFile && activeDiffFile.commitSha && (
          <KanbanInlineDiffViewer
            file={activeDiffFile.file}
            diff={diffContent || undefined}
            loading={diffLoading}
            error={diffError || undefined}
            onClose={handleCloseDiff}
            commitSha={activeDiffFile.commitSha}
          />
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
