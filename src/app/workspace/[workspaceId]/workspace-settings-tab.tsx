"use client";

import React, { useState } from "react";
import { useTranslation } from "@/i18n";
import { RepoPicker } from "@/client/components/repo-picker";
import type { RepoSelection } from "@/client/components/repo-picker";
import { desktopAwareFetch } from "@/client/utils/diagnostics";

interface CodebaseInfo {
  id: string;
  label?: string;
  repoPath: string;
  isDefault?: boolean;
}

interface WorkspaceSettingsTabProps {
  workspaceId: string;
  codebases: CodebaseInfo[];
  fetchCodebases: () => Promise<void>;
  worktreeRootDraft: string;
  setWorktreeRootDraft: (v: string) => void;
  worktreeRootState: { saving: boolean; message: string | null; error: string | null };
  displayedWorktreeRoot: string;
  defaultWorktreeRootHint: string;
  onSaveWorktreeRoot: () => Promise<void>;
}

export function WorkspaceSettingsTab({
  workspaceId,
  codebases,
  fetchCodebases,
  worktreeRootDraft,
  setWorktreeRootDraft,
  worktreeRootState,
  displayedWorktreeRoot,
  defaultWorktreeRootHint,
  onSaveWorktreeRoot,
}: WorkspaceSettingsTabProps) {
  const { t } = useTranslation();
  const [repoPickerValue, setRepoPickerValue] = useState<RepoSelection | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  // Edit state - use RepoPicker for re-selecting/cloning
  const [editingCodebase, setEditingCodebase] = useState<CodebaseInfo | null>(null);
  const [editRepoSelection, setEditRepoSelection] = useState<RepoSelection | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const handlePickerChange = async (selection: RepoSelection | null) => {
    if (!selection) return;
    setAddError(null);
    try {
      const res = await desktopAwareFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/codebases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath: selection.path, branch: selection.branch, label: selection.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t.errors.loadFailed);
      await fetchCodebases();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : t.errors.loadFailed);
    }
    // Always reset so the picker returns to "Add" state
    setRepoPickerValue(null);
  };

  const handleRemove = async (codebaseId: string) => {
    try {
      await desktopAwareFetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/codebases/${encodeURIComponent(codebaseId)}`,
        { method: "DELETE" }
      );
      await fetchCodebases();
    } catch {
      // ignore
    }
  };

  const handleEdit = (cb: CodebaseInfo) => {
    setEditingCodebase(cb);
    // Initialize with current selection
    setEditRepoSelection({
      path: cb.repoPath,
      branch: "",
      name: cb.label ?? cb.repoPath.split("/").pop() ?? "",
    });
    setEditError(null);
  };

  const handleEditRepoChange = async (selection: RepoSelection | null) => {
    if (!selection || !editingCodebase) return;
    setEditRepoSelection(selection);
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await desktopAwareFetch(`/api/codebases/${encodeURIComponent(editingCodebase.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: selection.name, repoPath: selection.path, branch: selection.branch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t.errors.saveFailed);
      await fetchCodebases();
      setEditingCodebase(null);
      setEditRepoSelection(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : t.errors.saveFailed);
    } finally {
      setEditSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingCodebase(null);
    setEditRepoSelection(null);
    setEditError(null);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* ── Linked Repositories ─────────────────────────────────── */}
      <section>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
          {t.workspace.linkedRepositories}
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          {t.workspace.linkedReposDescription}
        </p>

        {codebases.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {codebases.map((cb) => (
              <span
                key={cb.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0d1018] px-2.5 py-1 text-xs text-slate-700 dark:text-slate-300"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span className="max-w-50 truncate">{cb.label ?? cb.repoPath.split("/").pop() ?? cb.repoPath}</span>
                <span className="text-[10px] text-slate-400 truncate max-w-40">{cb.repoPath}</span>
                {cb.isDefault && (
                  <span className="text-[10px] text-amber-500 font-medium">{t.workspace.defaultLabel}</span>
                )}
                <button
                  onClick={() => handleEdit(cb)}
                  className="ml-0.5 w-4 h-4 flex items-center justify-center rounded text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                  title={`Edit ${cb.label ?? cb.repoPath}`}
                >
                  ✎
                </button>
                <button
                  onClick={() => void handleRemove(cb.id)}
                  className="w-4 h-4 flex items-center justify-center rounded text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                  title={`Remove ${cb.label ?? cb.repoPath}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {codebases.length === 0 && (
          <div className="mb-3 text-xs text-slate-400 dark:text-slate-500 italic">
            {t.workspace.noReposLinked}
          </div>
        )}

        {/* RepoPicker for selecting / cloning a repo to link */}
        <div className="flex items-center gap-2">
          <div className="text-xs text-slate-500 dark:text-slate-400 shrink-0">{t.workspace.addLabel}</div>
          <RepoPicker value={repoPickerValue} onChange={(sel) => void handlePickerChange(sel)} />
        </div>
        {addError && (
          <div className="mt-2 text-xs text-rose-600 dark:text-rose-400">{addError}</div>
        )}
      </section>

      <hr className="border-slate-100 dark:border-[#1c1f2e]" />

      {/* ── Worktree Root Override ───────────────────────────────── */}
      <section data-testid="workspace-worktree-settings">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
          {t.workspace.worktreeRootOverride}
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          {t.workspace.worktreeRootDescription}{" "}
          <code className="font-mono text-slate-600 dark:text-slate-300">{defaultWorktreeRootHint}</code>
        </p>
        <div className="flex gap-2 items-start">
          <div className="flex-1">
            <input
              value={worktreeRootDraft}
              onChange={(e) => setWorktreeRootDraft(e.target.value)}
              placeholder={defaultWorktreeRootHint}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 outline-none focus:border-amber-400 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-200 font-mono text-xs"
              data-testid="worktree-root-input"
            />
            <div className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
              {t.workspace.effectivePath}{" "}
              <code className="font-mono">{displayedWorktreeRoot}</code>
            </div>
            {worktreeRootState.error && (
              <div className="mt-1.5 text-xs text-rose-600 dark:text-rose-400" data-testid="worktree-root-error">
                {worktreeRootState.error}
              </div>
            )}
            {worktreeRootState.message && (
              <div className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                {worktreeRootState.message}
              </div>
            )}
          </div>
          <button
            onClick={() => void onSaveWorktreeRoot()}
            disabled={worktreeRootState.saving}
            className="shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="save-worktree-root"
          >
            {worktreeRootState.saving ? t.workspace.saving : t.common.save}
          </button>
        </div>
      </section>

      {/* ── Edit Codebase Modal ───────────────────────────────────── */}
      {editingCodebase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c]">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">
              {t.workspace.editRepository}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                  {t.workspace.selectOrCloneRepo}
                </label>
                <RepoPicker
                  value={editRepoSelection}
                  onChange={handleEditRepoChange}
                />
              </div>
              {editError && (
                <div className="text-xs text-rose-600 dark:text-rose-400">{editError}</div>
              )}
              {editSaving && (
                <div className="text-xs text-amber-600 dark:text-amber-400">{t.workspace.updatingRepository}</div>
              )}
            </div>
            <div className="mt-5 flex gap-2 justify-end">
              <button
                onClick={handleCancelEdit}
                disabled={editSaving}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-[#191c28]"
              >
                {t.common.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
