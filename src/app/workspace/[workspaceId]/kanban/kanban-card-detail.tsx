"use client";

import { useState } from "react";
import type { AcpProviderInfo } from "@/client/acp-client";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import type { TaskInfo, WorktreeInfo } from "../types";

interface SpecialistOption {
  id: string;
  name: string;
  role: string;
}

export interface KanbanCardDetailProps {
  task: TaskInfo;
  availableProviders: AcpProviderInfo[];
  specialists: SpecialistOption[];
  codebases: CodebaseData[];
  allCodebaseIds: string[];
  worktreeCache: Record<string, WorktreeInfo>;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onRetryTrigger: (taskId: string) => Promise<void>;
  onDelete: () => void;
  onRefresh: () => void;
}

const ROLE_OPTIONS = ["CRAFTER", "ROUTA", "GATE", "DEVELOPER"];

export function KanbanCardDetail({
  task,
  availableProviders,
  specialists,
  codebases,
  allCodebaseIds,
  worktreeCache,
  onPatchTask,
  onRetryTrigger,
  onDelete,
  onRefresh,
}: KanbanCardDetailProps) {
  // Inline edit state - component is keyed by task.id so state resets on task change
  const [editTitle, setEditTitle] = useState(task.title);
  const [editObjective, setEditObjective] = useState(task.objective ?? "");
  const [editPriority, setEditPriority] = useState(task.priority ?? "medium");
  const [updateError, setUpdateError] = useState<string | null>(null);

  return (
    <div className="w-1/3 border-r border-gray-200 dark:border-[#191c28] overflow-y-auto p-4">
      <div className="space-y-4">
        {/* Title */}
        <div>
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Title</div>
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={async () => {
              if (editTitle !== task.title) {
                await onPatchTask(task.id, { title: editTitle });
                onRefresh();
              }
            }}
            className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm font-semibold text-gray-900 focus:border-amber-400 focus:outline-none dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-100"
          />
        </div>

        {/* Objective */}
        <div>
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Objective</div>
          <textarea
            value={editObjective}
            onChange={(e) => setEditObjective(e.target.value)}
            onBlur={async () => {
              if (editObjective !== (task.objective ?? "")) {
                await onPatchTask(task.id, { objective: editObjective });
                onRefresh();
              }
            }}
            rows={6}
            className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-amber-400 focus:outline-none dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300"
          />
        </div>

        {/* Priority & Column */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Priority</div>
            <select
              value={editPriority}
              onChange={async (e) => {
                setEditPriority(e.target.value);
                await onPatchTask(task.id, { priority: e.target.value });
                onRefresh();
              }}
              className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-amber-400 focus:outline-none dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Column</div>
            <div className="text-sm text-gray-700 dark:text-gray-300">{task.columnId ?? "backlog"}</div>
          </div>
        </div>

        {/* Labels */}
        <LabelsSection labels={task.labels} />

        {/* Provider Assignment */}
        <ProviderSection
          task={task}
          availableProviders={availableProviders}
          specialists={specialists}
          onPatchTask={onPatchTask}
          onRetryTrigger={onRetryTrigger}
          onRefresh={onRefresh}
        />

        {/* GitHub Link */}
        <GitHubSection task={task} />

        {/* Repositories */}
        <RepositoriesSection
          task={task}
          codebases={codebases}
          allCodebaseIds={allCodebaseIds}
          updateError={updateError}
          setUpdateError={setUpdateError}
          onPatchTask={onPatchTask}
          onRefresh={onRefresh}
        />

        {/* Worktree */}
        <WorktreeSection task={task} worktreeCache={worktreeCache} />

        {/* Delete Button */}
        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onDelete}
            className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 hover:border-red-300 dark:border-red-900/50 dark:bg-red-900/10 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors"
          >
            Delete Task
          </button>
        </div>
      </div>
    </div>
  );
}

// Sub-components

function LabelsSection({ labels }: { labels?: string[] }) {
  if (!labels || labels.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Labels</div>
      <div className="flex flex-wrap gap-1">
        {labels.map((label) => (
          <span key={label} className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ProviderSection({
  task,
  availableProviders,
  specialists,
  onPatchTask,
  onRetryTrigger,
  onRefresh,
}: {
  task: TaskInfo;
  availableProviders: AcpProviderInfo[];
  specialists: SpecialistOption[];
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onRetryTrigger: (taskId: string) => Promise<void>;
  onRefresh: () => void;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Provider</div>
      <select
        value={task.assignedProvider ?? ""}
        onChange={async (e) => {
          if (e.target.value) {
            await onPatchTask(task.id, { assignedProvider: e.target.value, assignedRole: task.assignedRole ?? "DEVELOPER" });
          } else {
            await onPatchTask(task.id, { assignedProvider: undefined, assignedRole: undefined, assignedSpecialistId: undefined, assignedSpecialistName: undefined });
          }
          onRefresh();
        }}
        className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-amber-400 focus:outline-none dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300"
      >
        <option value="">Unassigned</option>
        {availableProviders.map((p) => (
          <option key={`${p.id}-${p.name}`} value={p.id}>{p.name}</option>
        ))}
      </select>
      {task.assignedProvider && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <select
            value={task.assignedRole ?? "DEVELOPER"}
            onChange={async (e) => {
              await onPatchTask(task.id, { assignedRole: e.target.value });
              onRefresh();
            }}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-amber-400 focus:outline-none dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300"
          >
            {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select
            value={task.assignedSpecialistId ?? ""}
            onChange={async (e) => {
              const sp = specialists.find((s) => s.id === e.target.value);
              await onPatchTask(task.id, { assignedSpecialistId: e.target.value || undefined, assignedSpecialistName: sp?.name, assignedRole: sp?.role ?? task.assignedRole });
              onRefresh();
            }}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-amber-400 focus:outline-none dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300"
          >
            <option value="">No specialist</option>
            {specialists.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}
      {task.assignedProvider && (
        <button
          onClick={async () => {
            await onRetryTrigger(task.id);
          }}
          className="mt-2 w-full rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600"
        >
          {task.triggerSessionId ? "Rerun" : "Run"}
        </button>
      )}
    </div>
  );
}

function GitHubSection({ task }: { task: TaskInfo }) {
  if (!task.githubNumber) return null;
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">GitHub</div>
      <a
        href={task.githubUrl}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-amber-600 dark:text-amber-400 hover:underline"
      >
        #{task.githubNumber}
      </a>
    </div>
  );
}

function RepositoriesSection({
  task,
  codebases,
  allCodebaseIds,
  updateError,
  setUpdateError,
  onPatchTask,
  onRefresh,
}: {
  task: TaskInfo;
  codebases: CodebaseData[];
  allCodebaseIds: string[];
  updateError: string | null;
  setUpdateError: (error: string | null) => void;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onRefresh: () => void;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Repositories</div>
      {((task.codebaseIds && task.codebaseIds.length > 0) || allCodebaseIds.length > 0) ? (
        <div className="space-y-1">
          {(task.codebaseIds && task.codebaseIds.length > 0 ? task.codebaseIds : allCodebaseIds).map((cbId) => {
            const cb = codebases.find((c) => c.id === cbId);
            return cb ? (
              <div key={cbId} className="flex items-center gap-2 text-sm">
                <span className={`w-2 h-2 rounded-full ${cb.sourceType === "github" ? "bg-violet-500" : "bg-emerald-500"}`} />
                <span className="text-gray-700 dark:text-gray-300">{cb.label ?? cb.repoPath.split("/").pop()}</span>
                {cb.branch && <span className="text-gray-400">@{cb.branch}</span>}
              </div>
            ) : (
              <div key={cbId} className="text-sm text-red-500">⚠ Repository no longer available</div>
            );
          })}
        </div>
      ) : (
        <div className="text-sm text-gray-400 dark:text-gray-500">No repositories linked</div>
      )}
      {codebases.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">Edit linked repositories</div>
          <div className="flex flex-wrap gap-2">
            {codebases.map((cb) => {
              const currentCodebaseIds = (task.codebaseIds && task.codebaseIds.length > 0)
                ? task.codebaseIds
                : allCodebaseIds;
              const selected = currentCodebaseIds.includes(cb.id);
              return (
                <button
                  key={cb.id}
                  type="button"
                  onClick={async () => {
                    setUpdateError(null);
                    try {
                      const nextCodebaseIds = selected
                        ? currentCodebaseIds.filter((id) => id !== cb.id)
                        : [...currentCodebaseIds, cb.id];
                      await onPatchTask(task.id, { codebaseIds: nextCodebaseIds });
                      onRefresh();
                    } catch (error) {
                      setUpdateError(
                        error instanceof Error ? error.message : "Failed to update repositories"
                      );
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                    selected
                      ? "border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-600 dark:bg-violet-900/20 dark:text-violet-300"
                      : "border-gray-200 bg-white text-gray-600 hover:border-violet-300 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-400"
                  }`}
                  data-testid="detail-repo-toggle"
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${cb.sourceType === "github" ? "bg-violet-500" : "bg-emerald-500"}`} />
                  {cb.label ?? cb.repoPath.split("/").pop() ?? cb.repoPath}
                </button>
              );
            })}
          </div>
          {updateError && (
            <div className="mt-2 text-xs text-rose-600 dark:text-rose-400">{updateError}</div>
          )}
        </div>
      )}
    </div>
  );
}

function WorktreeSection({ task, worktreeCache }: { task: TaskInfo; worktreeCache: Record<string, WorktreeInfo> }) {
  if (!task.worktreeId) return null;
  const wt = worktreeCache[task.worktreeId];
  return (
    <div data-testid="worktree-detail">
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Worktree</div>
      {wt ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 space-y-1 text-sm">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              wt.status === "active"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                : wt.status === "creating"
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                  : "bg-rose-100 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300"
            }`}>{wt.status}</span>
            <span className="text-gray-600 dark:text-gray-400 font-mono text-xs">{wt.branch}</span>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-500 font-mono truncate" title={wt.worktreePath}>
            {wt.worktreePath}
          </div>
          {wt.errorMessage && (
            <div className="text-xs text-red-600 dark:text-red-400">{wt.errorMessage}</div>
          )}
        </div>
      ) : (
        <div className="text-sm text-gray-400">Loading worktree info...</div>
      )}
    </div>
  );
}
