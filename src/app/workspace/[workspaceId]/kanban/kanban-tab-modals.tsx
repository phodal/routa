"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import { RepoPicker, type RepoSelection } from "@/client/components/repo-picker";
import { useTranslation } from "@/i18n";
import type { KanbanRequiredTaskField } from "@/core/models/kanban";
import type { TaskInfo, WorktreeInfo } from "../types";
import { RefreshCw, TriangleAlert, Info, Trash2 } from "lucide-react";


export interface KanbanCodebaseModalProps {
  open: boolean;
  selectedCodebase: CodebaseData | null;
  editingCodebase: boolean;
  codebases: CodebaseData[];
  addRepoSelection: RepoSelection | null;
  setAddRepoSelection: Dispatch<SetStateAction<RepoSelection | null>>;
  addSaving: boolean;
  addError: string | null;
  onAddRepository: (selection: RepoSelection | null) => void | Promise<void>;
  editRepoSelection: RepoSelection | null;
  onRepoSelectionChange: (selection: RepoSelection | null) => void | Promise<void>;
  editError: string | null;
  recloneError: string | null;
  editSaving: boolean;
  replacingAll: boolean;
  setShowReplaceAllConfirm: Dispatch<SetStateAction<boolean>>;
  handleCancelEditCodebase: () => void;
  codebaseWorktrees: WorktreeInfo[];
  worktreeActionError: string | null;
  localTasks: TaskInfo[];
  handleDeleteCodebaseWorktrees: (worktrees: WorktreeInfo[]) => void | Promise<void>;
  deletingWorktreeIds: string[];
  liveBranchInfo: { current: string; branches: string[] } | null;
  branchActionError: string | null;
  repoHealth?: { missingRepoTasks: number; cwdMismatchTasks: number };
  onSelectCodebase: (codebase: CodebaseData) => void | Promise<void>;
  handleDeleteIssueBranch: (branch: string) => void | Promise<void>;
  handleDeleteIssueBranches: (branches: string[]) => void | Promise<void>;
  deletingBranchNames: string[];
  handleReclone: () => void | Promise<void>;
  recloning: boolean;
  recloneSuccess: string | null;
  onStartEditCodebase: () => void;
  onRequestRemoveCodebase: () => void;
  onClose: () => void;
}

export function KanbanCodebaseModal({
  open,
  selectedCodebase,
  editingCodebase,
  codebases,
  addRepoSelection,
  setAddRepoSelection,
  addSaving,
  addError,
  onAddRepository,
  editRepoSelection,
  onRepoSelectionChange,
  editError,
  recloneError,
  editSaving,
  replacingAll,
  setShowReplaceAllConfirm,
  handleCancelEditCodebase,
  codebaseWorktrees,
  worktreeActionError,
  localTasks,
  handleDeleteCodebaseWorktrees,
  deletingWorktreeIds,
  liveBranchInfo,
  branchActionError,
  repoHealth,
  onSelectCodebase,
  handleDeleteIssueBranch,
  handleDeleteIssueBranches,
  deletingBranchNames,
  handleReclone,
  recloning,
  recloneSuccess,
  onStartEditCodebase,
  onRequestRemoveCodebase,
  onClose,
}: KanbanCodebaseModalProps) {
  const { t } = useTranslation();
  const [selectedWorktreeIds, setSelectedWorktreeIds] = useState<string[]>([]);
  const sortedCodebases = useMemo(
    () => [...codebases].sort((left, right) => {
      if (left.isDefault !== right.isDefault) {
        return left.isDefault ? -1 : 1;
      }
      return getCodebaseDisplayName(left).localeCompare(getCodebaseDisplayName(right));
    }),
    [codebases],
  );
  const githubCodebaseCount = useMemo(
    () => codebases.filter((codebase) => isGitHubCodebase(codebase)).length,
    [codebases],
  );
  const localCodebaseCount = codebases.length - githubCodebaseCount;
  const healthIssuesCount = (repoHealth?.missingRepoTasks ?? 0) + (repoHealth?.cwdMismatchTasks ?? 0);
  const selectedCodebaseLabel = selectedCodebase ? getCodebaseDisplayName(selectedCodebase) : null;
  const defaultCodebase = useMemo(
    () => codebases.find((codebase) => codebase.isDefault) ?? codebases[0] ?? null,
    [codebases],
  );

  const sortedWorktrees = useMemo(
    () => [...codebaseWorktrees].sort((left, right) => {
      const rightTs = new Date(right.createdAt).getTime();
      const leftTs = new Date(left.createdAt).getTime();
      return rightTs - leftTs;
    }),
    [codebaseWorktrees]
  );
  const deletingWorktreeIdSet = useMemo(() => new Set(deletingWorktreeIds), [deletingWorktreeIds]);
  const deletingBranchSet = useMemo(() => new Set(deletingBranchNames), [deletingBranchNames]);
  const worktreeBranchSet = useMemo(
    () => new Set(codebaseWorktrees.map((worktree) => worktree.branch).filter(Boolean)),
    [codebaseWorktrees],
  );
  const currentBranch = liveBranchInfo?.current?.trim() ?? selectedCodebase?.branch ?? "";
  const repoBranches = liveBranchInfo?.branches ?? [];
  const fallbackBranches = selectedCodebase?.branch ? [selectedCodebase.branch] : [];
  const sortedBranches = Array.from(new Set([...repoBranches, ...fallbackBranches].filter(Boolean)))
    .sort((left, right) => compareBranches(left, right, currentBranch, worktreeBranchSet));
  const issueBranches = sortedBranches.filter((branch) => isIssueBranch(branch));
  const removableIssueBranches = issueBranches.filter(
    (branch) => branch !== currentBranch && !worktreeBranchSet.has(branch),
  );
  const otherBranches = sortedBranches.filter((branch) => !isIssueBranch(branch));
  const selectedWorktrees = useMemo(
    () => sortedWorktrees.filter((worktree) => selectedWorktreeIds.includes(worktree.id)),
    [selectedWorktreeIds, sortedWorktrees]
  );
  const allWorktreesSelected = sortedWorktrees.length > 0 && selectedWorktrees.length === sortedWorktrees.length;
  const bulkActionBusy = deletingWorktreeIds.length > 0;

  useEffect(() => {
    setSelectedWorktreeIds([]);
  }, [open, selectedCodebase?.id]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c]" data-testid="codebase-detail-modal">
        <div className="mb-4 flex flex-col gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {t.kanbanModals.repositoriesOverview}
              </h3>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                <span>{`${codebases.length} ${t.kanbanBoard.repos}`}</span>
                <span>
                  {`${t.kanbanModals.currentRepository} ${selectedCodebaseLabel ?? t.kanbanBoard.noReposLinked}`}
                </span>
                <span>
                  {`${t.kanbanModals.healthIssuesLabel} ${healthIssuesCount}`}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selectedCodebase && !editingCodebase && (
                <>
                  <Link
                    href={`/workspace/${selectedCodebase.workspaceId}/codebases/${selectedCodebase.id}/reposlide`}
                    className="text-sm text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    {t.kanbanModals.openRepoSlide}
                  </Link>
                  <button
                    onClick={onRequestRemoveCodebase}
                    className="text-sm text-rose-500 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-300"
                  >
                    {t.common.remove}
                  </button>
                  <button
                    onClick={onStartEditCodebase}
                    className="text-sm text-amber-500 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300"
                  >
                    {t.common.edit}
                  </button>
                </>
              )}
              <button
                onClick={onClose}
                className="text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                {t.common.close}
              </button>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[320px,minmax(0,1fr)]">
          <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <SummaryCard label={t.kanbanBoard.repos} value={String(codebases.length)} />
              <SummaryCard
                label={t.kanbanModals.defaultRepositoryLabel}
                value={defaultCodebase ? getCodebaseDisplayName(defaultCodebase) : "—"}
              />
              <SummaryCard label={t.kanbanModals.localSourcesLabel} value={String(localCodebaseCount)} />
              <SummaryCard label={t.kanbanModals.githubSourcesLabel} value={String(githubCodebaseCount)} />
            </div>

            {repoHealth && healthIssuesCount > 0 && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-900/40 dark:bg-amber-900/10">
                <div className="flex items-start gap-3">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-amber-900 dark:text-amber-200">
                      {t.kanbanModals.workspaceHealthTitle}
                    </div>
                    <div className="text-xs text-amber-700 dark:text-amber-300">
                      {`${repoHealth.missingRepoTasks} ${t.kanban.missing} · ${repoHealth.cwdMismatchTasks} ${t.kanban.sessionMismatch}`}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-[#171922]">
              <div className="mb-3">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {t.kanbanModals.addRepository}
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {t.kanbanModals.selectOrCloneRepo}
                </div>
              </div>
              <RepoPicker
                value={addRepoSelection}
                onChange={setAddRepoSelection}
                additionalRepos={codebases.map((codebase) => ({
                  name: getCodebaseDisplayName(codebase),
                  path: codebase.repoPath,
                  branch: codebase.branch,
                }))}
              />
              {addError && (
                <div className="mt-2 text-xs text-rose-600 dark:text-rose-400">{addError}</div>
              )}
              <button
                type="button"
                onClick={() => void onAddRepository(addRepoSelection)}
                disabled={!addRepoSelection || addSaving}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                {addSaving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
                <span>{addSaving ? t.kanbanModals.addingRepository : t.kanbanModals.addRepository}</span>
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-[#12141c]">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {t.kanbanBoard.repos}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{codebases.length}</div>
              </div>
              {sortedCodebases.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  {t.kanbanBoard.noReposLinked}
                </div>
              ) : (
                <div className="space-y-2">
                  {sortedCodebases.map((codebase) => {
                    const codebaseLabel = getCodebaseDisplayName(codebase);
                    const active = selectedCodebase?.id === codebase.id;
                    return (
                      <button
                        key={codebase.id}
                        type="button"
                        onClick={() => void onSelectCodebase(codebase)}
                        className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                          active
                            ? "border-blue-200 bg-blue-50/90 shadow-sm dark:border-blue-900/40 dark:bg-blue-900/10"
                            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#12141c] dark:hover:bg-[#171922]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                              {codebaseLabel}
                            </div>
                            <div className="mt-1 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {codebase.repoPath}
                            </div>
                          </div>
                          {codebase.isDefault && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                              {t.workspace.defaultLabel}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                          <span>{`${t.kanbanModals.branch} ${codebase.branch ?? "—"}`}</span>
                          <span>{`${t.kanbanModals.sourceType} ${codebase.sourceType ?? "local"}`}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto pr-1">
            {!selectedCodebase ? (
              <div className="flex h-full min-h-[360px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-6 text-center dark:border-slate-700 dark:bg-[#171922]">
                <div className="max-w-sm space-y-2">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {t.kanbanBoard.noReposLinked}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {t.kanbanModals.selectRepositoryHint}
                  </div>
                </div>
              </div>
            ) : editingCodebase ? (
              <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#12141c]">
                <div>
                  <label className="mb-2 block text-xs font-medium text-slate-500 dark:text-slate-400">
                    {t.kanbanModals.selectOrCloneRepo}
                  </label>
                  <RepoPicker
                    value={editRepoSelection}
                    onChange={onRepoSelectionChange}
                    additionalRepos={codebases.map((codebase) => ({
                      name: getCodebaseDisplayName(codebase),
                      path: codebase.repoPath,
                      branch: codebase.branch,
                    }))}
                  />
                </div>
                {editError && (
                  <div className="text-xs text-rose-600 dark:text-rose-400">{editError}</div>
                )}
                {recloneError && (
                  <div className="text-xs text-rose-600 dark:text-rose-400">{recloneError}</div>
                )}
                {editSaving && (
                  <div className="text-xs text-amber-600 dark:text-amber-400">{t.kanbanModals.updatingRepo}</div>
                )}

                {codebases.length > 1 && editRepoSelection && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-900/10">
                    <div className="flex items-start gap-2">
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"/>
                      <div className="flex-1">
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          {`${codebases.length} ${t.kanbanModals.replaceAllHint}`}
                        </p>
                        <button
                          onClick={() => setShowReplaceAllConfirm(true)}
                          disabled={editSaving || replacingAll}
                          className="mt-2 text-xs font-medium text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                        >
                          {t.kanbanModals.replaceAllRepos}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    onClick={handleCancelEditCodebase}
                    disabled={editSaving || replacingAll}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-[#191c28]"
                  >
                    {t.common.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <div className="min-h-0 space-y-4 text-sm">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <SummaryCard label={t.kanbanModals.currentRepository} value={selectedCodebaseLabel ?? "—"} />
                  <SummaryCard label={t.kanbanModals.path} value={selectedCodebase.repoPath} mono />
                  <SummaryCard label={t.kanbanModals.branch} value={liveBranchInfo?.current ?? selectedCodebase.branch ?? "—"} />
                  <SummaryCard label={t.kanbanModals.sourceType} value={selectedCodebase.sourceType ?? "local"} />
                </div>

                {selectedCodebase.sourceUrl && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#12141c]">
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {t.kanbanModals.sourceUrl}
                    </div>
                    <a
                      href={selectedCodebase.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-xs text-amber-600 hover:underline dark:text-amber-400"
                    >
                      {selectedCodebase.sourceUrl}
                    </a>
                  </div>
                )}

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-[#171922]">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {t.kanbanModals.branches} ({sortedBranches.length})
                    </div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">{t.kanbanModals.branchesHint}</div>
                  </div>
                  {branchActionError && (
                    <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:border-rose-900/40 dark:bg-rose-900/10 dark:text-rose-300">
                      {branchActionError}
                    </div>
                  )}

                  {sortedBranches.length === 0 ? (
                    <div className="text-xs text-slate-400 dark:text-slate-500">{t.kanbanModals.noBranches}</div>
                  ) : (
                    <div className="space-y-3">
                      {issueBranches.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                              {t.kanbanModals.issueBranches.replace("{count}", String(issueBranches.length))}
                            </div>
                            {removableIssueBranches.length > 0 && (
                              <button
                                type="button"
                                onClick={() => void handleDeleteIssueBranches(removableIssueBranches)}
                                disabled={removableIssueBranches.some((branch) => deletingBranchSet.has(branch))}
                                className="rounded-lg border border-rose-200 px-2.5 py-1 text-[10px] font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/40 dark:text-rose-300 dark:hover:bg-rose-900/10"
                              >
                                {removableIssueBranches.some((branch) => deletingBranchSet.has(branch))
                                  ? t.kanbanModals.removing
                                  : t.kanbanModals.clearIssueBranches.replace("{count}", String(removableIssueBranches.length))}
                              </button>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {issueBranches.map((branch) => (
                              <BranchChip
                                key={branch}
                                branch={branch}
                                currentBranch={currentBranch}
                                hasWorktree={worktreeBranchSet.has(branch)}
                                issueBranch
                                deleting={deletingBranchSet.has(branch)}
                                onDelete={
                                  branch !== currentBranch && !worktreeBranchSet.has(branch)
                                    ? () => void handleDeleteIssueBranch(branch)
                                    : undefined
                                }
                                labels={t.kanbanModals}
                              />
                            ))}
                          </div>
                        </div>
                      )}

                      {otherBranches.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            {t.kanbanModals.otherBranches.replace("{count}", String(otherBranches.length))}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {otherBranches.map((branch) => (
                              <BranchChip
                                key={branch}
                                branch={branch}
                                currentBranch={currentBranch}
                                hasWorktree={worktreeBranchSet.has(branch)}
                                labels={t.kanbanModals}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {t.kanbanModals.worktrees} ({codebaseWorktrees.length})
                    </div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">{t.kanbanModals.worktreeHint}</div>
                  </div>
                  {worktreeActionError && (
                    <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:border-rose-900/40 dark:bg-rose-900/10 dark:text-rose-300">
                      {worktreeActionError}
                    </div>
                  )}
                  {codebaseWorktrees.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
                      {t.kanbanModals.noWorktrees}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 dark:border-slate-800 dark:bg-[#171922]">
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {selectedWorktrees.length > 0
                            ? t.kanbanModals.selectedWorktrees.replace("{count}", String(selectedWorktrees.length))
                            : t.kanbanModals.selectWorktreesHint}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedWorktreeIds(allWorktreesSelected ? [] : sortedWorktrees.map((worktree) => worktree.id))}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-[#191c28]"
                          >
                            {allWorktreesSelected ? t.kanbanModals.clearSelection : t.tasks.selectAll}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteCodebaseWorktrees(selectedWorktrees)}
                            disabled={selectedWorktrees.length === 0 || bulkActionBusy}
                            className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/40 dark:text-rose-300 dark:hover:bg-rose-900/10"
                          >
                            {bulkActionBusy
                              ? t.kanbanModals.removing
                              : t.kanbanModals.removeSelected.replace("{count}", String(selectedWorktrees.length))}
                          </button>
                        </div>
                      </div>
                      {sortedWorktrees.map((worktree) => {
                        const linkedTasks = localTasks.filter((task) => task.worktreeId === worktree.id);
                        const worktreeDeleting = deletingWorktreeIdSet.has(worktree.id);
                        return (
                          <div key={worktree.id} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-[#12141c]">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div className="flex min-w-0 flex-1 gap-3">
                                <label className="pt-0.5">
                                  <input
                                    type="checkbox"
                                    aria-label={`${t.tasks.selectAll} ${worktree.branch}`}
                                    checked={selectedWorktreeIds.includes(worktree.id)}
                                    disabled={bulkActionBusy}
                                    onChange={(event) => {
                                      setSelectedWorktreeIds((current) => {
                                        if (event.target.checked) {
                                          return [...current, worktree.id];
                                        }
                                        return current.filter((id) => id !== worktree.id);
                                      });
                                    }}
                                    className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500 dark:border-slate-600 dark:bg-[#0f1117]"
                                  />
                                </label>
                                <div className="min-w-0 flex-1 space-y-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${worktree.status === "active"
                                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                                        : worktree.status === "creating"
                                          ? "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                                          : "bg-rose-100 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300"
                                      }`}>{worktree.status}</span>
                                    <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{worktree.branch}</span>
                                    <span className="text-[11px] text-slate-400 dark:text-slate-500">{t.kanban.baseLabel} {worktree.baseBranch}</span>
                                    {linkedTasks.length > 0 && (
                                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-900/20 dark:text-sky-300">
                                        {linkedTasks.length} {t.kanbanModals.linkedTasks}{linkedTasks.length > 1 ? "s" : ""}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                                    <span>{t.kanbanModals.createdAtLabel} <time dateTime={worktree.createdAt}>{formatTimestamp(worktree.createdAt)}</time></span>
                                    <span>{t.kanbanModals.updatedAtLabel} <time dateTime={worktree.updatedAt}>{formatTimestamp(worktree.updatedAt)}</time></span>
                                    {worktree.label ? <span>{t.kanbanModals.labelLabel} {worktree.label}</span> : null}
                                  </div>
                                  <div className="break-all font-mono text-xs text-slate-400 dark:text-slate-500">{worktree.worktreePath}</div>
                                  {linkedTasks.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                      {linkedTasks.slice(0, 4).map((task) => (
                                        <span key={task.id} className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                                          {task.title}
                                        </span>
                                      ))}
                                      {linkedTasks.length > 4 && (
                                        <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                                          +{linkedTasks.length - 4} {t.kanbanModals.more}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2 self-end lg:self-start">
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteCodebaseWorktrees([worktree])}
                                  disabled={worktreeDeleting || bulkActionBusy}
                                  className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/40 dark:text-rose-300 dark:hover:bg-rose-900/10"
                                >
                                  {worktreeDeleting ? t.kanbanModals.removing : t.common.remove}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {selectedCodebase.sourceType === "github" && selectedCodebase.sourceUrl && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#12141c]">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-medium text-slate-700 dark:text-slate-300">{t.kanbanModals.recloneRepo}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{t.kanbanModals.recloneHint}</div>
                      </div>
                      <button
                        onClick={() => void handleReclone()}
                        disabled={recloning}
                        className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
                      >
                        {recloning ? t.kanbanModals.cloning : t.kanbanModals.reclone}
                      </button>
                    </div>
                    {recloneError && (
                      <div className="mt-2 text-xs text-rose-600 dark:text-rose-400">{recloneError}</div>
                    )}
                    {recloneSuccess && (
                      <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{recloneSuccess}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#12141c]">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className={`mt-2 truncate text-sm font-semibold text-slate-900 dark:text-slate-100 ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function getCodebaseDisplayName(codebase: CodebaseData): string {
  return codebase.label ?? codebase.repoPath.split("/").pop() ?? codebase.repoPath;
}

function isGitHubCodebase(codebase: CodebaseData): boolean {
  return codebase.sourceType === "github" || Boolean(codebase.sourceUrl?.includes("github.com"));
}

function isIssueBranch(branch: string): boolean {
  return branch.startsWith("issue/");
}

function compareBranches(
  left: string,
  right: string,
  currentBranch: string,
  worktreeBranchSet: Set<string>,
): number {
  const leftScore = getBranchPriority(left, currentBranch, worktreeBranchSet);
  const rightScore = getBranchPriority(right, currentBranch, worktreeBranchSet);

  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }

  return left.localeCompare(right);
}

function getBranchPriority(
  branch: string,
  currentBranch: string,
  worktreeBranchSet: Set<string>,
): number {
  let score = 0;
  if (branch === currentBranch) score += 100;
  if (worktreeBranchSet.has(branch)) score += 20;
  if (isIssueBranch(branch)) score += 10;
  return score;
}

function BranchChip({
  branch,
  currentBranch,
  hasWorktree,
  issueBranch = false,
  deleting = false,
  onDelete,
  labels,
}: {
  branch: string;
  currentBranch: string;
  hasWorktree: boolean;
  issueBranch?: boolean;
  deleting?: boolean;
  onDelete?: () => void;
  labels: {
    currentBranchLabel: string;
    worktreeBranchLabel: string;
    removeBranchLabel: string;
  };
}) {
  const isCurrent = branch === currentBranch;

  return (
    <div
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
        issueBranch
          ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-300"
          : "border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-[#12141c] dark:text-slate-300"
      }`}
    >
      <span className="truncate font-mono">{branch}</span>
      {isCurrent && (
        <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
          {labels.currentBranchLabel}
        </span>
      )}
      {hasWorktree && (
        <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
          {labels.worktreeBranchLabel}
        </span>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="rounded-full p-0.5 text-rose-500 transition hover:bg-rose-100 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-rose-900/20 dark:hover:text-rose-300"
          aria-label={labels.removeBranchLabel.replace("{branch}", branch)}
          title={labels.removeBranchLabel.replace("{branch}", branch)}
        >
          <Trash2 className={`h-3 w-3 ${deleting ? "animate-pulse" : ""}`} />
        </button>
      )}
    </div>
  );
}

export function KanbanDeleteCodebaseModal({
  selectedCodebase,
  editError,
  deletingCodebase,
  onCancel,
  onConfirm,
}: {
  selectedCodebase: CodebaseData | null;
  editError: string | null;
  deletingCodebase: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const { t } = useTranslation();

  if (!selectedCodebase) return null;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 px-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c] animate-in zoom-in-95 duration-150">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20">
              <TriangleAlert className="h-6 w-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"/>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t.kanbanModals.removeRepoTitle}</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                {t.kanbanModals.removeRepoConfirm} <span className="font-medium text-slate-900 dark:text-slate-100">&quot;{selectedCodebase.label ?? selectedCodebase.repoPath.split("/").pop()}&quot;</span>?
              </p>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-500">
                {t.kanbanModals.removeRepoHint}
              </p>
            </div>
          </div>
          {editError && (
            <div className="mt-3 text-xs text-rose-600 dark:text-rose-400">{editError}</div>
          )}
          <div className="mt-6 flex gap-3">
            <button
              onClick={onCancel}
              disabled={deletingCodebase}
              className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-300 dark:hover:bg-[#191c28]"
            >
              {t.common.cancel}
            </button>
            <button
              onClick={() => void onConfirm()}
              disabled={deletingCodebase}
              className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 dark:bg-red-500 dark:hover:bg-red-600"
            >
              {deletingCodebase ? t.kanbanModals.removing : t.common.remove}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function KanbanReplaceAllReposModal({
  editRepoSelection,
  codebasesCount,
  recloneError,
  replacingAll,
  onCancel,
  onConfirm,
}: {
  editRepoSelection: RepoSelection | null;
  codebasesCount: number;
  recloneError: string | null;
  replacingAll: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const { t } = useTranslation();

  if (!editRepoSelection) return null;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 px-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c] animate-in zoom-in-95 duration-150">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/20">
              <RefreshCw className="h-6 w-6 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"/>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t.kanbanModals.replaceAllTitle}</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                This will update all <span className="font-medium text-slate-900 dark:text-slate-100">{codebasesCount} {t.kanbanModals.replaceAllDesc}</span> in this workspace to use:
              </p>
              <div className="mt-2 rounded-lg bg-slate-50 p-2 dark:bg-[#0d1018]">
                <div className="text-sm font-medium text-slate-700 dark:text-slate-300">{editRepoSelection.name}</div>
                <div className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">{editRepoSelection.path}</div>
              </div>
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                {t.kanbanModals.replaceAllUseful}
              </p>
            </div>
          </div>
          {recloneError && (
            <div className="mt-3 text-xs text-rose-600 dark:text-rose-400">{recloneError}</div>
          )}
          <div className="mt-6 flex gap-3">
            <button
              onClick={onCancel}
              disabled={replacingAll}
              className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-300 dark:hover:bg-[#191c28]"
            >
              {t.common.cancel}
            </button>
            <button
              onClick={() => void onConfirm()}
              disabled={replacingAll}
              className="flex-1 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {replacingAll ? t.kanbanModals.replacing : t.kanbanModals.replaceAll}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function KanbanDeleteTaskModal({
  deleteConfirmTask,
  isDeleting,
  onCancel,
  onConfirm,
}: {
  deleteConfirmTask: TaskInfo | null;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const { t } = useTranslation();

  if (!deleteConfirmTask) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c] animate-in zoom-in-95 duration-150">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20">
              <TriangleAlert className="h-6 w-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"/>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t.kanbanModals.deleteTaskTitle}</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                {t.kanbanModals.deleteTaskConfirm} <span className="font-medium text-slate-900 dark:text-slate-100">&quot;{deleteConfirmTask.title}&quot;</span>?
              </p>
              {deleteConfirmTask.githubNumber && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  {t.kanbanModals.deleteTaskGithubNote} #{deleteConfirmTask.githubNumber} will remain unchanged.
                </p>
              )}
            </div>
          </div>
          <div className="mt-6 flex gap-3">
            <button
              onClick={onCancel}
              disabled={isDeleting}
              className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-300 dark:hover:bg-[#191c28]"
            >
              {t.common.cancel}
            </button>
            <button
              onClick={() => void onConfirm()}
              disabled={isDeleting}
              className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 dark:bg-red-500 dark:hover:bg-red-600"
            >
              {isDeleting ? t.kanbanModals.deleting : t.common.delete}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function KanbanMoveBlockedModal({
  blocked,
  onClose,
  onOpenCard,
}: {
  blocked: {
    message: string;
    storyReadiness?: TaskInfo["storyReadiness"];
    missingTaskFields?: string[];
  } | null;
  onClose: () => void;
  onOpenCard?: () => void;
}) {
  const { t } = useTranslation();

  if (!blocked) return null;

  const formatFieldLabel = (field: KanbanRequiredTaskField): string => {
    switch (field) {
      case "scope":
        return t.kanbanDetail.scope;
      case "acceptance_criteria":
        return t.kanbanDetail.acceptanceCriteria;
      case "verification_commands":
        return t.kanbanDetail.verificationCommands;
      case "test_cases":
        return t.kanbanDetail.testCases;
      case "verification_plan":
        return t.kanbanDetail.verificationPlan;
      case "dependencies_declared":
        return t.kanbanDetail.dependenciesDeclared;
      default:
        return field;
    }
  };

  const requiredLabels = blocked.storyReadiness?.requiredTaskFields.map((field) => formatFieldLabel(field)) ?? [];
  const missingLabels = blocked.storyReadiness?.missing.map((field) => formatFieldLabel(field)) ?? [];
  const fallbackMissingLabels = missingLabels.length > 0
    ? missingLabels
    : (blocked.missingTaskFields ?? []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c] animate-in zoom-in-95 duration-150"
      >
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/20">
              <TriangleAlert className="h-6 w-6 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"/>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t.kanbanModals.moveBlockedTitle}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{blocked.message}</p>
              {blocked.storyReadiness ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/10 dark:text-amber-100">
                  <div className="font-medium">
                    {t.kanbanModals.moveBlockedStoryReadinessHint}
                  </div>
                  <div className="mt-2 text-xs leading-5 text-amber-800 dark:text-amber-200">
                    {requiredLabels.length > 0
                      ? `${t.kanbanDetail.requiredForNextMove}: ${requiredLabels.join(", ")}`
                      : t.kanbanDetail.gateNotConfigured}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-200">
                    {fallbackMissingLabels.length > 0
                      ? `${t.kanbanDetail.missingFields}: ${fallbackMissingLabels.join(", ")}`
                      : t.kanbanDetail.allRequiredFields}
                  </div>
                </div>
              ) : null}
              <p className="mt-3 text-xs leading-5 text-amber-700 dark:text-amber-300">{t.kanbanModals.moveBlockedToolHint}</p>
              <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300">{t.kanbanModals.moveBlockedHint}</p>
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            {onOpenCard ? (
              <button
                onClick={onOpenCard}
                className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200 dark:hover:bg-amber-900/30"
              >
                {t.kanban.openCard}
              </button>
            ) : null}
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-300 dark:hover:bg-[#191c28]"
            >
              {t.common.dismiss}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
