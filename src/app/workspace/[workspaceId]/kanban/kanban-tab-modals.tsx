"use client";

import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import Link from "next/link";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import { RepoPicker, type RepoSelection } from "@/client/components/repo-picker";
import { useTranslation } from "@/i18n";
import type { KanbanRequiredTaskField } from "@/core/models/kanban";
import type { TaskInfo, WorktreeInfo } from "../types";
import { ExternalLink, Info, Pencil, Plus, RefreshCw, Trash2, TriangleAlert, X } from "lucide-react";


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
    () => codebases.filter((codebase) => getCodebaseSourceType(codebase) === "github").length,
    [codebases],
  );
  const localCodebaseCount = codebases.length - githubCodebaseCount;
  const healthIssuesCount = (repoHealth?.missingRepoTasks ?? 0) + (repoHealth?.cwdMismatchTasks ?? 0);
  const selectedCodebaseLabel = selectedCodebase ? getCodebaseDisplayName(selectedCodebase) : null;
  const showRepositoryRail = sortedCodebases.length > 1;
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
  const selectedCodebaseSourceType = selectedCodebase ? getCodebaseSourceType(selectedCodebase) : "local";
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 px-3 py-4">
      <div
        className="desktop-theme mx-auto flex h-full max-h-[92vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-sm border border-desktop-border bg-desktop-bg-primary shadow-2xl"
        data-testid="codebase-detail-modal"
      >
        <div className="border-b border-desktop-border bg-desktop-bg-primary px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[13px] font-semibold text-desktop-text-primary">
                  {t.kanbanModals.repositoriesOverview}
                </h3>
                {selectedCodebaseLabel ? (
                  <span className="truncate text-[11px] text-desktop-text-secondary">
                    {`${t.kanbanModals.currentRepository} ${selectedCodebaseLabel}`}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <CompactStat label={t.kanbanBoard.repos} value={String(codebases.length)} />
                <CompactStat
                  label={t.kanbanModals.defaultRepositoryLabel}
                  value={defaultCodebase ? getCodebaseDisplayName(defaultCodebase) : "—"}
                />
                <CompactStat label={t.kanbanModals.localSourcesLabel} value={String(localCodebaseCount)} />
                <CompactStat label={t.kanbanModals.githubSourcesLabel} value={String(githubCodebaseCount)} />
                <CompactStat
                  label={t.kanbanModals.healthIssuesLabel}
                  value={String(healthIssuesCount)}
                  tone={healthIssuesCount > 0 ? "warning" : "neutral"}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-sm border border-desktop-border bg-desktop-bg-secondary/80 p-1">
                {selectedCodebase && !editingCodebase ? (
                  <>
                    <Link
                      href={`/workspace/${selectedCodebase.workspaceId}/codebases/${selectedCodebase.id}/reposlide`}
                      aria-label={t.kanbanModals.openRepoSlide}
                      title={t.kanbanModals.openRepoSlide}
                      className={commandIconButtonClassName()}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                    <button
                      type="button"
                      onClick={onStartEditCodebase}
                      aria-label={t.common.edit}
                      title={t.common.edit}
                      className={commandIconButtonClassName()}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={onRequestRemoveCodebase}
                      aria-label={t.common.remove}
                      title={t.common.remove}
                      className={commandIconButtonClassName("danger")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedWorktreeIds([]);
                    onClose();
                  }}
                  aria-label={t.common.close}
                  title={t.common.close}
                  className={commandIconButtonClassName()}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="border-b border-desktop-border bg-desktop-bg-secondary/50 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
              {t.kanbanModals.addRepository}
            </div>
            <div className="min-w-[320px] flex-1 rounded-sm border border-desktop-border bg-desktop-bg-primary px-2.5 py-2">
              <RepoPicker
                value={addRepoSelection}
                onChange={setAddRepoSelection}
                additionalRepos={codebases.map((codebase) => ({
                  name: getCodebaseDisplayName(codebase),
                  path: codebase.repoPath,
                  branch: codebase.branch,
                }))}
              />
            </div>
            <button
              type="button"
              onClick={() => void onAddRepository(addRepoSelection)}
              disabled={!addRepoSelection || addSaving}
              className={toolbarButtonClassName("primary", "h-9 shrink-0")}
            >
              {addSaving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              <span>{addSaving ? t.kanbanModals.addingRepository : t.kanbanModals.addRepository}</span>
            </button>
          </div>
          {addError ? (
            <div className="mt-2 text-[11px] text-rose-500">{addError}</div>
          ) : null}
        </div>

        <div className={showRepositoryRail
          ? "grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[280px,minmax(0,1fr)]"
          : "grid min-h-0 flex-1 grid-cols-1"}>
          {showRepositoryRail ? (
            <aside className="flex min-h-0 flex-col border-b border-desktop-border bg-desktop-bg-secondary/60 xl:border-b-0 xl:border-r">
              {repoHealth && healthIssuesCount > 0 ? (
                <div className="border-b border-desktop-border px-3 py-2.5">
                  <div className="flex items-start gap-2 rounded-sm border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                    <div className="min-w-0">
                      <div className="font-medium text-amber-100">{t.kanbanModals.workspaceHealthTitle}</div>
                      <div className="mt-0.5 text-amber-200/80">
                        {`${repoHealth.missingRepoTasks} ${t.kanban.missing} · ${repoHealth.cwdMismatchTasks} ${t.kanban.sessionMismatch}`}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="flex items-center justify-between border-b border-desktop-border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                <span>{t.kanbanBoard.repos}</span>
                <span>{codebases.length}</span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {sortedCodebases.length === 0 ? (
                  <div className="m-3 rounded-sm border border-dashed border-desktop-border px-3 py-4 text-[11px] text-desktop-text-secondary">
                    {t.kanbanBoard.noReposLinked}
                  </div>
                ) : (
                  sortedCodebases.map((codebase) => {
                    const codebaseLabel = getCodebaseDisplayName(codebase);
                    const active = selectedCodebase?.id === codebase.id;
                    const sourceType = getCodebaseSourceType(codebase);

                    return (
                      <button
                        key={codebase.id}
                        type="button"
                        onClick={() => {
                          setSelectedWorktreeIds([]);
                          void onSelectCodebase(codebase);
                        }}
                        className={`w-full border-l-2 px-3 py-2.5 text-left transition ${
                          active
                            ? "border-desktop-accent bg-desktop-bg-active"
                            : "border-transparent hover:bg-desktop-bg-active/60"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12px] font-medium text-desktop-text-primary">
                              {codebaseLabel}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-desktop-text-secondary">
                              <span>{`${t.kanbanModals.branch} ${codebase.branch ?? "—"}`}</span>
                              <span>{`${t.kanbanModals.sourceType} ${sourceType}`}</span>
                            </div>
                          </div>
                          {codebase.isDefault ? (
                            <span className="rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                              {t.workspace.defaultLabel}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 truncate font-mono text-[10px] text-desktop-text-muted">
                          {codebase.repoPath}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>
          ) : null}

          <section className="min-h-0 overflow-y-auto bg-desktop-bg-primary">
            {!showRepositoryRail && repoHealth && healthIssuesCount > 0 ? (
              <div className="border-b border-desktop-border px-3 py-2.5">
                <div className="flex items-start gap-2 rounded-sm border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                  <div className="min-w-0">
                    <div className="font-medium text-amber-100">{t.kanbanModals.workspaceHealthTitle}</div>
                    <div className="mt-0.5 text-amber-200/80">
                      {`${repoHealth.missingRepoTasks} ${t.kanban.missing} · ${repoHealth.cwdMismatchTasks} ${t.kanban.sessionMismatch}`}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {!selectedCodebase ? (
              <div className="flex h-full min-h-[320px] items-center justify-center px-6 text-center">
                <div className="max-w-sm rounded-sm border border-dashed border-desktop-border px-6 py-8">
                  <div className="text-[13px] font-semibold text-desktop-text-primary">
                    {t.kanbanBoard.noReposLinked}
                  </div>
                  <div className="mt-2 text-[11px] text-desktop-text-secondary">
                    {t.kanbanModals.selectRepositoryHint}
                  </div>
                </div>
              </div>
            ) : editingCodebase ? (
              <div className="space-y-3 p-3">
                <InspectorSection
                  title={t.common.edit}
                  hint={t.kanbanModals.selectOrCloneRepo}
                >
                  <div className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-3 py-3">
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
                  {editError ? (
                    <div className="text-[11px] text-rose-500">{editError}</div>
                  ) : null}
                  {recloneError ? (
                    <div className="text-[11px] text-rose-500">{recloneError}</div>
                  ) : null}
                  {editSaving ? (
                    <div className="text-[11px] text-amber-400">{t.kanbanModals.updatingRepo}</div>
                  ) : null}

                  {codebases.length > 1 && editRepoSelection ? (
                    <div className="rounded-sm border border-amber-500/30 bg-amber-500/10 px-3 py-3">
                      <div className="flex items-start gap-2">
                        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"/>
                        <div className="flex-1">
                          <p className="text-[11px] text-amber-100/90">
                            {`${codebases.length} ${t.kanbanModals.replaceAllHint}`}
                          </p>
                          <button
                            type="button"
                            onClick={() => setShowReplaceAllConfirm(true)}
                            disabled={editSaving || replacingAll}
                            className="mt-2 inline-flex items-center rounded-sm border border-amber-500/30 px-2 py-1 text-[11px] font-medium text-amber-200 transition hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {t.kanbanModals.replaceAllRepos}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleCancelEditCodebase}
                      disabled={editSaving || replacingAll}
                      className={toolbarButtonClassName("default")}
                    >
                      {t.common.cancel}
                    </button>
                  </div>
                </InspectorSection>
              </div>
            ) : (
              <div className="space-y-3 p-3 text-sm">
                <InspectorSection
                  title={selectedCodebaseLabel ?? t.kanbanModals.currentRepository}
                  hint={selectedCodebase.repoPath}
                >
                  <div className="grid gap-px overflow-hidden rounded-sm border border-desktop-border bg-desktop-border lg:grid-cols-2 xl:grid-cols-4">
                    <InfoField label={t.kanbanModals.currentRepository} value={selectedCodebaseLabel ?? "—"} />
                    <InfoField label={t.kanbanModals.path} value={selectedCodebase.repoPath} mono />
                    <InfoField label={t.kanbanModals.branch} value={liveBranchInfo?.current ?? selectedCodebase.branch ?? "—"} />
                    <InfoField label={t.kanbanModals.sourceType} value={selectedCodebaseSourceType} />
                  </div>

                  {selectedCodebase.sourceUrl ? (
                    <div className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-3 py-3">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                        {t.kanbanModals.sourceUrl}
                      </div>
                      <a
                        href={selectedCodebase.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block truncate font-mono text-[11px] text-desktop-accent hover:underline"
                      >
                        {selectedCodebase.sourceUrl}
                      </a>
                    </div>
                  ) : null}
                </InspectorSection>

                <InspectorSection
                  title={`${t.kanbanModals.branches} (${sortedBranches.length})`}
                  hint={t.kanbanModals.branchesHint}
                >
                  {branchActionError ? (
                    <div className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
                      {branchActionError}
                    </div>
                  ) : null}

                  {sortedBranches.length === 0 ? (
                    <div className="rounded-sm border border-dashed border-desktop-border px-3 py-4 text-[11px] text-desktop-text-secondary">
                      {t.kanbanModals.noBranches}
                    </div>
                  ) : (
                    <div className="space-y-3 rounded-sm border border-desktop-border bg-desktop-bg-primary px-3 py-3">
                      {issueBranches.length > 0 ? (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-[11px] font-medium text-desktop-text-secondary">
                              {t.kanbanModals.issueBranches.replace("{count}", String(issueBranches.length))}
                            </div>
                            {removableIssueBranches.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => void handleDeleteIssueBranches(removableIssueBranches)}
                                disabled={removableIssueBranches.some((branch) => deletingBranchSet.has(branch))}
                                className="rounded-sm border border-rose-500/30 px-2 py-1 text-[10px] font-medium text-rose-300 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {removableIssueBranches.some((branch) => deletingBranchSet.has(branch))
                                  ? t.kanbanModals.removing
                                  : t.kanbanModals.clearIssueBranches.replace("{count}", String(removableIssueBranches.length))}
                              </button>
                            ) : null}
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
                      ) : null}

                      {otherBranches.length > 0 ? (
                        <div className="space-y-2">
                          <div className="text-[11px] font-medium text-desktop-text-secondary">
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
                      ) : null}
                    </div>
                  )}
                </InspectorSection>

                <InspectorSection
                  title={`${t.kanbanModals.worktrees} (${codebaseWorktrees.length})`}
                  hint={t.kanbanModals.worktreeHint}
                >
                  {worktreeActionError ? (
                    <div className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
                      {worktreeActionError}
                    </div>
                  ) : null}
                  {codebaseWorktrees.length === 0 ? (
                    <div className="rounded-sm border border-dashed border-desktop-border px-3 py-4 text-[11px] text-desktop-text-secondary">
                      {t.kanbanModals.noWorktrees}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-desktop-border bg-desktop-bg-primary px-3 py-2">
                        <div className="text-[11px] text-desktop-text-secondary">
                          {selectedWorktrees.length > 0
                            ? t.kanbanModals.selectedWorktrees.replace("{count}", String(selectedWorktrees.length))
                            : t.kanbanModals.selectWorktreesHint}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedWorktreeIds(allWorktreesSelected ? [] : sortedWorktrees.map((worktree) => worktree.id))}
                            className={toolbarButtonClassName("default")}
                          >
                            {allWorktreesSelected ? t.kanbanModals.clearSelection : t.tasks.selectAll}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteCodebaseWorktrees(selectedWorktrees)}
                            disabled={selectedWorktrees.length === 0 || bulkActionBusy}
                            className={toolbarButtonClassName("danger")}
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
                          <div key={worktree.id} className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-3 py-3">
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
                                    className="h-4 w-4 rounded border-desktop-border bg-desktop-bg-secondary text-desktop-accent focus:ring-desktop-accent"
                                  />
                                </label>
                                <div className="min-w-0 flex-1 space-y-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${getWorktreeStatusTone(worktree.status)}`}>
                                      {worktree.status}
                                    </span>
                                    <span className="font-mono text-[11px] text-desktop-text-primary">{worktree.branch}</span>
                                    <span className="text-[10px] text-desktop-text-secondary">{t.kanban.baseLabel} {worktree.baseBranch}</span>
                                    {linkedTasks.length > 0 ? (
                                      <span className="rounded-sm border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
                                        {linkedTasks.length} {t.kanbanModals.linkedTasks}{linkedTasks.length > 1 ? "s" : ""}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-desktop-text-secondary">
                                    <span>{t.kanbanModals.createdAtLabel} <time dateTime={worktree.createdAt}>{formatTimestamp(worktree.createdAt)}</time></span>
                                    <span>{t.kanbanModals.updatedAtLabel} <time dateTime={worktree.updatedAt}>{formatTimestamp(worktree.updatedAt)}</time></span>
                                    {worktree.label ? <span>{t.kanbanModals.labelLabel} {worktree.label}</span> : null}
                                  </div>
                                  <div className="break-all font-mono text-[10px] text-desktop-text-muted">{worktree.worktreePath}</div>
                                  {linkedTasks.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      {linkedTasks.slice(0, 4).map((task) => (
                                        <span key={task.id} className="rounded-sm border border-desktop-border px-2 py-0.5 text-[10px] text-desktop-text-secondary">
                                          {task.title}
                                        </span>
                                      ))}
                                      {linkedTasks.length > 4 ? (
                                        <span className="rounded-sm border border-desktop-border px-2 py-0.5 text-[10px] text-desktop-text-secondary">
                                          +{linkedTasks.length - 4} {t.kanbanModals.more}
                                        </span>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2 self-end lg:self-start">
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteCodebaseWorktrees([worktree])}
                                  disabled={worktreeDeleting || bulkActionBusy}
                                  className={toolbarButtonClassName("danger")}
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
                </InspectorSection>

                {selectedCodebaseSourceType === "github" && selectedCodebase.sourceUrl ? (
                  <InspectorSection
                    title={t.kanbanModals.recloneRepo}
                    hint={t.kanbanModals.recloneHint}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-desktop-border bg-desktop-bg-primary px-3 py-3">
                      <a
                        href={selectedCodebase.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 truncate font-mono text-[11px] text-desktop-accent hover:underline"
                      >
                        {selectedCodebase.sourceUrl}
                      </a>
                      <button
                        type="button"
                        onClick={() => void handleReclone()}
                        disabled={recloning}
                        className={toolbarButtonClassName("primary")}
                      >
                        {recloning ? t.kanbanModals.cloning : t.kanbanModals.reclone}
                      </button>
                    </div>
                    {recloneError ? (
                      <div className="text-[11px] text-rose-500">{recloneError}</div>
                    ) : null}
                    {recloneSuccess ? (
                      <div className="text-[11px] text-emerald-400">{recloneSuccess}</div>
                    ) : null}
                  </InspectorSection>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function CompactStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warning";
}) {
  const toneClassName = tone === "warning"
    ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
    : "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary";

  return (
    <div className={`rounded-sm border px-2.5 py-1.5 ${toneClassName}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em]">
        {label}
      </div>
      <div className="mt-1 truncate text-[12px] font-semibold text-desktop-text-primary">
        {value}
      </div>
    </div>
  );
}

function InspectorSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string | null;
  children: ReactNode;
}) {
  return (
    <section className="rounded-sm border border-desktop-border bg-desktop-bg-secondary/50">
      <div className="border-b border-desktop-border px-3 py-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
          {title}
        </div>
        {hint ? (
          <div className="mt-1 text-[11px] text-desktop-text-secondary">{hint}</div>
        ) : null}
      </div>
      <div className="space-y-3 p-3">{children}</div>
    </section>
  );
}

function InfoField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-desktop-bg-primary px-3 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
        {label}
      </div>
      <div className={`mt-1 break-all text-[12px] text-desktop-text-primary ${mono ? "font-mono" : "font-medium"}`}>
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

function getCodebaseSourceType(codebase: CodebaseData): "local" | "github" {
  if (codebase.sourceType === "github") return "github";
  if (codebase.sourceUrl?.includes("github.com")) return "github";
  if (looksLikeGitHubRepoLabel(codebase.label)) return "github";
  return "local";
}

function isIssueBranch(branch: string): boolean {
  return branch.startsWith("issue/");
}

function looksLikeGitHubRepoLabel(value?: string): boolean {
  const normalized = value?.trim();
  return normalized ? /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized) : false;
}

function toolbarButtonClassName(
  tone: "default" | "primary" | "danger",
  extraClassName = "",
): string {
  const baseClassName = "inline-flex items-center gap-2 rounded-sm border px-2.5 py-1.5 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50";

  const toneClassName = tone === "primary"
    ? "border-desktop-accent bg-desktop-accent text-white hover:brightness-110"
    : tone === "danger"
      ? "border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/15"
      : "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary hover:bg-desktop-bg-active hover:text-desktop-text-primary";

  return [baseClassName, toneClassName, extraClassName].filter(Boolean).join(" ");
}

function commandIconButtonClassName(tone: "default" | "danger" = "default"): string {
  const baseClassName = "inline-flex h-8 w-8 items-center justify-center rounded-sm transition";
  const toneClassName = tone === "danger"
    ? "text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
    : "text-desktop-text-secondary hover:bg-desktop-bg-active hover:text-desktop-text-primary";

  return `${baseClassName} ${toneClassName}`;
}

function getWorktreeStatusTone(status: WorktreeInfo["status"]): string {
  if (status === "active") return "bg-emerald-500/15 text-emerald-300";
  if (status === "creating") return "bg-amber-500/15 text-amber-300";
  return "bg-rose-500/15 text-rose-300";
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
  onDelegateFix,
  isDelegating = false,
}: {
  blocked: {
    message: string;
    storyReadiness?: TaskInfo["storyReadiness"];
    missingTaskFields?: string[];
  } | null;
  onClose: () => void;
  onOpenCard?: () => void;
  onDelegateFix?: () => void;
  isDelegating?: boolean;
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
            {onDelegateFix ? (
              <button
                onClick={onDelegateFix}
                disabled={isDelegating}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400 dark:disabled:bg-slate-700 dark:disabled:text-slate-300"
              >
                {isDelegating ? t.kanbanModals.moveBlockedDelegating : t.kanbanModals.moveBlockedDelegate}
              </button>
            ) : null}
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
