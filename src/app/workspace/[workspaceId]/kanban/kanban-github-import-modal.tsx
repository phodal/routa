"use client";

import { useEffect, useMemo, useState } from "react";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";
import type { GitHubIssueListItemInfo, TaskInfo } from "../types";

interface GitHubIssuesResponse {
  repo: string;
  codebase?: {
    id: string;
    label: string;
  };
  issues: GitHubIssueListItemInfo[];
}

interface KanbanGitHubImportModalProps {
  show: boolean;
  workspaceId: string;
  codebases: CodebaseData[];
  tasks: TaskInfo[];
  onClose: () => void;
  onImport: (codebaseId: string, issues: GitHubIssueListItemInfo[], repo: string) => Promise<void>;
}

function formatIssueTimestamp(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

export function KanbanGitHubImportModal({
  show,
  workspaceId,
  codebases,
  tasks,
  onClose,
  onImport,
}: KanbanGitHubImportModalProps) {
  const { t } = useTranslation();
  const [selectedCodebaseId, setSelectedCodebaseId] = useState<string>("");
  const [payload, setPayload] = useState<GitHubIssuesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIssueIds, setSelectedIssueIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!show) return;
    const defaultCodebase = codebases.find((codebase) => codebase.isDefault) ?? codebases[0];
    setSelectedCodebaseId(defaultCodebase?.id ?? "");
    setSelectedIssueIds([]);
    setError(null);
  }, [codebases, show]);

  useEffect(() => {
    if (!show || !selectedCodebaseId) return;

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const response = await desktopAwareFetch(
          `/api/github/issues?workspaceId=${encodeURIComponent(workspaceId)}&codebaseId=${encodeURIComponent(selectedCodebaseId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!response.ok) {
          throw new Error(typeof data?.error === "string" ? data.error : t.kanbanImport.loadFailed);
        }
        setPayload({
          repo: typeof data?.repo === "string" ? data.repo : "",
          codebase: data?.codebase,
          issues: Array.isArray(data?.issues) ? data.issues as GitHubIssueListItemInfo[] : [],
        });
        setSelectedIssueIds([]);
      } catch (fetchError) {
        if (controller.signal.aborted) return;
        setPayload(null);
        setError(fetchError instanceof Error ? fetchError.message : t.kanbanImport.loadFailed);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [reloadNonce, selectedCodebaseId, show, t.kanbanImport.loadFailed, workspaceId]);

  const importedIssueKeys = useMemo(
    () => new Set(
      tasks
        .filter((task) => task.githubRepo && task.githubNumber !== undefined)
        .map((task) => `${task.githubRepo}#${task.githubNumber}`),
    ),
    [tasks],
  );

  const selectableIssues = useMemo(() => {
    const repo = payload?.repo ?? "";
    return (payload?.issues ?? []).map((issue) => ({
      issue,
      imported: importedIssueKeys.has(`${repo}#${issue.number}`),
    }));
  }, [importedIssueKeys, payload?.issues, payload?.repo]);

  const selectableIssueIds = useMemo(
    () => selectableIssues.filter((item) => !item.imported).map((item) => item.issue.id),
    [selectableIssues],
  );

  if (!show) return null;

  const canImport = Boolean(selectedIssueIds.length > 0 && selectedCodebaseId && payload?.repo);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c]">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t.kanbanImport.title}</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t.kanbanImport.description}</p>
          </div>
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            {t.common.close}
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t.kanbanImport.repository}
          </label>
          <select
            value={selectedCodebaseId}
            onChange={(event) => setSelectedCodebaseId(event.target.value)}
            className="min-w-[220px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-200"
          >
            {codebases.map((codebase) => (
              <option key={codebase.id} value={codebase.id}>
                {codebase.label ?? codebase.repoPath.split("/").pop() ?? codebase.repoPath}
              </option>
            ))}
          </select>
          {payload?.repo && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 dark:bg-[#191c28] dark:text-slate-300">
              {payload.repo}
            </span>
          )}
          <button
            type="button"
            onClick={() => setReloadNonce((current) => current + 1)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-[#191c28]"
          >
            {t.common.refresh}
          </button>
        </div>

        <div className="mb-3 flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <div>
            {selectableIssues.length > 0 ? `${selectableIssues.length} ${t.kanbanImport.issuesLoaded}` : t.kanbanImport.noIssues}
          </div>
          {selectableIssueIds.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedIssueIds(selectableIssueIds)}
                className="text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
              >
                {t.kanbanImport.selectAll}
              </button>
              <button
                type="button"
                onClick={() => setSelectedIssueIds([])}
                className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                {t.kanbanImport.clearSelection}
              </button>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              {t.kanbanImport.loading}
            </div>
          ) : error ? (
            <div className="flex h-40 items-center justify-center px-6 text-center text-sm text-rose-600 dark:text-rose-400">
              {error}
            </div>
          ) : selectableIssues.length === 0 ? (
            <div className="flex h-40 items-center justify-center px-6 text-center text-sm text-slate-500 dark:text-slate-400">
              {t.kanbanImport.noIssues}
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-700">
              {selectableIssues.map(({ issue, imported }) => {
                const checked = selectedIssueIds.includes(issue.id);
                const updatedAtLabel = formatIssueTimestamp(issue.updatedAt);
                return (
                  <label
                    key={issue.id}
                    className={`flex gap-3 px-4 py-3 transition-colors ${imported
                      ? "bg-slate-50/70 dark:bg-[#161925]"
                      : "hover:bg-slate-50 dark:hover:bg-[#161925]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={imported || submitting}
                      onChange={(event) => {
                        setSelectedIssueIds((current) => {
                          if (event.target.checked) {
                            return [...current, issue.id];
                          }
                          return current.filter((id) => id !== issue.id);
                        });
                      }}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <a
                          href={issue.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-medium text-slate-900 hover:text-amber-600 dark:text-slate-100 dark:hover:text-amber-300"
                        >
                          #{issue.number} {issue.title}
                        </a>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${issue.state === "open"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                          : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        }`}>
                          {issue.state === "open" ? t.kanbanImport.stateOpen : t.kanbanImport.stateClosed}
                        </span>
                        {imported && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                            {t.kanbanImport.alreadyImported}
                          </span>
                        )}
                      </div>
                      {issue.body && (
                        <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-400">
                          {issue.body}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        {issue.labels.map((label) => (
                          <span key={label} className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-[#191c28]">
                            {label}
                          </span>
                        ))}
                        {issue.assignees.length > 0 && <span>{issue.assignees.join(", ")}</span>}
                        {updatedAtLabel && <span>{t.kanbanImport.updatedAt} {updatedAtLabel}</span>}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"
          >
            {t.common.cancel}
          </button>
          <button
            onClick={async () => {
              if (!canImport || !payload?.repo) return;
              const issues = selectableIssues
                .filter(({ issue, imported }) => !imported && selectedIssueIds.includes(issue.id))
                .map(({ issue }) => issue);
              setSubmitting(true);
              setError(null);
              try {
                await onImport(selectedCodebaseId, issues, payload.repo);
                onClose();
              } catch (importError) {
                setError(importError instanceof Error ? importError.message : t.kanbanImport.importFailed);
              } finally {
                setSubmitting(false);
              }
            }}
            disabled={!canImport || submitting}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {submitting ? t.kanbanImport.importing : t.kanbanImport.importSelected}
          </button>
        </div>
      </div>
    </div>
  );
}
