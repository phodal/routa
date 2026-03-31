"use client";

import { useState, type DragEvent } from "react";
import { useTranslation } from "@/i18n";
import type { AcpProviderInfo } from "@/client/acp-client";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import { formatArtifactLabel, resolveKanbanTransitionArtifacts } from "@/core/kanban/transition-artifacts";
import type { KanbanColumnInfo, SessionInfo, TaskInfo, WorktreeInfo } from "../types";
import {
  findSpecialistById,
  getSpecialistDisplayName,
  getLanguageSpecificSpecialistId,
  KANBAN_SPECIALIST_LANGUAGE_LABELS,
  type KanbanSpecialistLanguage,
} from "./kanban-specialist-language";

interface SpecialistOption {
  id: string;
  name: string;
  role: string;
  displayName?: string;
}

export interface KanbanCardProps {
  task: TaskInfo;
  boardColumns: KanbanColumnInfo[];
  linkedSession?: SessionInfo;
  liveMessageTail?: string;
  availableProviders: AcpProviderInfo[];
  specialists: SpecialistOption[];
  specialistLanguage: KanbanSpecialistLanguage;
  codebases: CodebaseData[];
  allCodebaseIds: string[];
  worktreeCache: Record<string, WorktreeInfo>;
  queuePosition?: number;
  onDragStart: () => void;
  onOpenDetail: () => void;
  onDelete: () => void;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onRetryTrigger: (taskId: string) => Promise<void>;
  onRefresh: () => void;
}

const ROLE_OPTIONS = ["CRAFTER", "ROUTA", "GATE", "DEVELOPER"];

function getPriorityTone(priority?: string) {
  switch ((priority ?? "medium").toLowerCase()) {
    case "high":
    case "urgent":
      return "bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-900/20 dark:text-rose-300 dark:ring-rose-900/40";
    case "medium":
      return "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-900/40";
    case "low":
      return "bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:ring-emerald-900/40";
    default:
      return "bg-slate-200 text-slate-700 ring-1 ring-inset ring-slate-200 dark:bg-[#1c1f2e] dark:text-slate-300 dark:ring-white/5";
  }
}

function getSessionTone(sessionStatus?: "connecting" | "ready" | "error", queuePosition?: number) {
  if (queuePosition) {
    return "bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-900/40";
  }

  switch (sessionStatus) {
    case "ready":
      return "bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:ring-emerald-900/40";
    case "error":
      return "bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-900/20 dark:text-rose-300 dark:ring-rose-900/40";
    case "connecting":
      return "bg-sky-100 text-sky-700 ring-1 ring-inset ring-sky-200 dark:bg-sky-900/20 dark:text-sky-300 dark:ring-sky-900/40";
    default:
      return "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-[#181c28] dark:text-slate-300 dark:ring-white/5";
  }
}

function getStatusLabel(sessionStatus?: "connecting" | "ready" | "error", queuePosition?: number) {
  // Note: This returns English status keys; they will be overridden in the component
  if (queuePosition) return `queued`;
  if (sessionStatus === "connecting") return "starting";
  if (sessionStatus === "ready") return "live";
  if (sessionStatus === "error") return "failed";
  return "idle";
}

function getSyncTone(
  sessionStatus: "connecting" | "ready" | "error" | undefined,
  queuePosition: number | undefined,
  hasSyncError: boolean,
  githubSyncedAt?: string,
) {
  if (sessionStatus === "connecting" || queuePosition) {
    return "bg-sky-100 text-sky-700 ring-1 ring-inset ring-sky-200 dark:bg-sky-900/20 dark:text-sky-300 dark:ring-sky-900/40";
  }
  if (sessionStatus === "error" || hasSyncError) {
    return "bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-900/20 dark:text-rose-300 dark:ring-rose-900/40";
  }
  if (githubSyncedAt) {
    return "bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:ring-emerald-900/40";
  }
  return "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-[#181c28] dark:text-slate-300 dark:ring-white/5";
}

function getSyncLabel(
  sessionStatus: "connecting" | "ready" | "error" | undefined,
  queuePosition: number | undefined,
  hasSyncError: boolean,
  githubSyncedAt?: string,
) {
  if (sessionStatus === "connecting") return "starting";
  if (queuePosition) return `queued`;
  if (sessionStatus === "error" || hasSyncError) return "syncIssue";
  if (githubSyncedAt) return "synced";
  return "notSynced";
}

function formatArtifactGateBadgeLabel(
  nextColumnName: string | undefined,
  missingArtifacts: string[],
) {
  if (missingArtifacts.length === 0) {
    return `${nextColumnName ?? "Next"} ready`;
  }

  if (missingArtifacts.length === 1) {
    return `Needs ${formatArtifactLabel(missingArtifacts[0])}`;
  }

  return `Needs ${formatArtifactLabel(missingArtifacts[0])} +${missingArtifacts.length - 1}`;
}

function formatArtifactCountTooltip(task: TaskInfo): string {
  const summary = task.artifactSummary;
  if (!summary || summary.total === 0) {
    return "noArtifactsAttached";
  }

  const parts = Object.entries(summary.byType)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
    .map(([type, count]) => `${count} ${formatArtifactLabel(type)}${count === 1 ? "" : "s"}`);

  return parts.length > 0 ? parts.join(", ") : `${summary.total} artifacts`;
}

export function KanbanCard({
  task,
  boardColumns,
  linkedSession,
  liveMessageTail,
  availableProviders,
  specialists,
  specialistLanguage,
  codebases,
  allCodebaseIds,
  worktreeCache,
  queuePosition,
  onDragStart,
  onOpenDetail,
  onDelete,
  onPatchTask,
  onRetryTrigger,
  onRefresh,
}: KanbanCardProps) {
  const { t } = useTranslation();
  const sessionStatus = linkedSession?.acpStatus;
  const canRetry = Boolean(task.assignedProvider) && (
    sessionStatus === "error" || (!task.triggerSessionId && task.columnId === "dev")
  ) && !queuePosition;
  const canRun = Boolean(task.assignedProvider) && !task.triggerSessionId && task.columnId !== "done" && !queuePosition;
  const [showAssignment, setShowAssignment] = useState(false);

  const hasCardOverride = Boolean(task.assignedProvider || task.assignedRole || task.assignedSpecialistId || task.assignedSpecialistName);
  const priorityTone = getPriorityTone(task.priority);
  const sessionTone = getSessionTone(sessionStatus, queuePosition);
  const statusLabel = getStatusLabel(sessionStatus, queuePosition);
  const resolvedStatusLabel = queuePosition
    ? `${t.kanban.queued} #${queuePosition}`
    : (t.kanban as Record<string, string>)[statusLabel] ?? statusLabel;
  const automationSourceLabel = hasCardOverride ? t.kanban.cardOverride : t.kanban.laneDefault;
  const automationSourceTone = hasCardOverride
    ? "bg-blue-100 text-blue-700 ring-1 ring-inset ring-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:ring-blue-900/40"
    : "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-[#181c28] dark:text-slate-300 dark:ring-white/5";
  const visibleLabels = (task.labels ?? []).slice(0, 2);
  const remainingLabelCount = Math.max((task.labels?.length ?? 0) - visibleLabels.length, 0);
  const visibleCodebaseIds = (task.codebaseIds && task.codebaseIds.length > 0 ? task.codebaseIds : allCodebaseIds).slice(0, 1);
  const remainingCodebaseCount = Math.max(
    (task.codebaseIds && task.codebaseIds.length > 0 ? task.codebaseIds.length : allCodebaseIds.length) - visibleCodebaseIds.length,
    0,
  );
  const syncLabelKey = getSyncLabel(sessionStatus, queuePosition, Boolean(task.lastSyncError), task.githubSyncedAt);
  const resolvedSyncLabel = syncLabelKey === "queued"
    ? `${t.kanban.queued} #${queuePosition}`
    : (t.kanban as Record<string, string>)[syncLabelKey] ?? syncLabelKey;
  const syncTone = getSyncTone(sessionStatus, queuePosition, Boolean(task.lastSyncError), task.githubSyncedAt);
  const objectiveText = task.objective?.trim() || t.kanban.noObjective;
  const transitionArtifacts = resolveKanbanTransitionArtifacts(boardColumns, task.columnId);
  const missingNextArtifacts = transitionArtifacts.nextRequiredArtifacts.filter(
    (artifactType) => (task.artifactSummary?.byType?.[artifactType] ?? 0) === 0,
  );
  const artifactGateTone = missingNextArtifacts.length === 0
    ? "bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:ring-emerald-900/40"
    : "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-900/40";
  const artifactCount = task.artifactSummary?.total ?? 0;
  const artifactCountLabel = `${artifactCount} artifact${artifactCount === 1 ? "" : "s"}`;
  const artifactCountTooltip = formatArtifactCountTooltip(task);
  const artifactGateTooltip = transitionArtifacts.nextRequiredArtifacts.length > 0
    ? missingNextArtifacts.length === 0
      ? `Ready for ${transitionArtifacts.nextColumn?.name ?? "the next lane"}: ${transitionArtifacts.nextRequiredArtifacts.map((artifact) => formatArtifactLabel(artifact)).join(", ")} present.`
      : `Before ${transitionArtifacts.nextColumn?.name ?? "the next lane"}: missing ${missingNextArtifacts.map((artifact) => formatArtifactLabel(artifact)).join(", ")}.`
    : undefined;

  const stopCardInteraction = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };

  const handleProviderChange = async (providerId: string) => {
    if (providerId) {
      await onPatchTask(task.id, {
        assignedProvider: providerId,
        assignedRole: task.assignedRole ?? "DEVELOPER",
      });
    } else {
      await onPatchTask(task.id, {
        assignedProvider: undefined,
        assignedRole: undefined,
        assignedSpecialistId: undefined,
        assignedSpecialistName: undefined,
      });
    }
    onRefresh();
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData("text/plain", task.id);
    event.dataTransfer.effectAllowed = "move";
    onDragStart();
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={onOpenDetail}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenDetail();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${t.kanban.openCard} ${task.title}`}
      className="group relative flex cursor-grab flex-col gap-3 rounded-[1.35rem] border border-slate-200/80 bg-white/95 p-3.5 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.45)] transition duration-150 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_24px_48px_-28px_rgba(15,23,42,0.55)] active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-amber-400/50 dark:border-[#262938] dark:bg-[#0d1018] dark:shadow-[0_18px_40px_-28px_rgba(0,0,0,0.8)] dark:hover:border-[#34384a]"
      data-testid="kanban-card"
    >
      <div
        className="pointer-events-none absolute left-2.5 top-2.5 rounded-md p-1 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100 dark:text-slate-500"
        title={t.kanban.dragCard}
        aria-label={t.kanban.dragCard}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6h.01M14 6h.01M10 12h.01M14 12h.01M10 18h.01M14 18h.01" />
        </svg>
      </div>

      <button
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        className="absolute right-2.5 top-2.5 rounded-lg p-1 text-red-500 opacity-0 transition-all hover:bg-red-100 hover:text-red-600 group-hover:opacity-100 dark:text-red-400 dark:hover:bg-red-900/20"
        title={t.kanban.deleteTask}
        data-testid="kanban-card-delete"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>

      <div className="flex items-start justify-between gap-3 pr-6">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {task.githubNumber ? (
              <a
                href={task.githubUrl}
                target="_blank"
                rel="noreferrer"
                onClick={stopCardInteraction}
                className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-900/40"
              >
                Issue #{task.githubNumber}
              </a>
            ) : null}
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${sessionTone}`}>
              {resolvedStatusLabel}
            </span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${syncTone}`}>
              {resolvedSyncLabel}
            </span>
          </div>
          <div className="line-clamp-2 text-[15px] font-semibold leading-5 text-slate-900 dark:text-slate-100">
            {task.title}
          </div>
        </div>
        <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${priorityTone}`}>
          {task.priority ?? "medium"}
        </span>
      </div>

      {(transitionArtifacts.nextRequiredArtifacts.length > 0 || artifactCount > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {transitionArtifacts.nextRequiredArtifacts.length > 0 && (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${artifactGateTone}`}
              title={artifactGateTooltip}
              data-testid="kanban-card-artifact-gate"
            >
              {formatArtifactGateBadgeLabel(transitionArtifacts.nextColumn?.name, missingNextArtifacts)}
            </span>
          )}
          {artifactCount > 0 && (
            <span
              className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-[#181c28] dark:text-slate-300 dark:ring-white/5"
              title={artifactCountTooltip}
              data-testid="kanban-card-artifact-count"
            >
              {artifactCountLabel}
            </span>
          )}
        </div>
      )}

      <p className="line-clamp-3 text-[12px] leading-5 text-slate-600 dark:text-slate-400">{objectiveText}</p>
      {liveMessageTail && (
        <div className="rounded-xl border border-sky-200/80 bg-sky-50/70 px-3 py-2.5 dark:border-sky-900/50 dark:bg-sky-900/10">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-600 dark:text-sky-300">
            {t.kanban.liveSession}
          </div>
          <div
            className="mt-1 line-clamp-2 font-mono text-[12px] leading-5 text-sky-700 dark:text-sky-200"
            title={liveMessageTail}
            data-testid="kanban-card-live-tail"
          >
            {liveMessageTail}
          </div>
        </div>
      )}

      {visibleLabels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {visibleLabels.map((label) => (
            <span key={label} className="rounded-full bg-amber-100/80 px-2 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-900/40">
              {label}
            </span>
          ))}
          {remainingLabelCount > 0 && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-inset ring-slate-200 dark:bg-[#181c28] dark:text-slate-400 dark:ring-white/5">
              +{remainingLabelCount}
            </span>
          )}
        </div>
      )}

      {(((task.codebaseIds && task.codebaseIds.length > 0) || allCodebaseIds.length > 0) || task.worktreeId) && (
        <div className="flex flex-wrap gap-1.5">
          {visibleCodebaseIds.map((cbId) => {
            const cb = codebases.find((c) => c.id === cbId);
            return cb ? (
              <span
                key={cbId}
                className="inline-flex items-center gap-1 rounded-full bg-blue-100/90 px-2 py-0.5 text-[10px] font-medium text-blue-700 ring-1 ring-inset ring-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:ring-blue-900/40"
                data-testid="repo-badge"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                {cb.label ?? cb.repoPath.split("/").pop() ?? cb.repoPath}
              </span>
            ) : (
              <span key={cbId} className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600 ring-1 ring-inset ring-red-200 dark:bg-red-900/20 dark:text-red-400 dark:ring-red-900/40" title={t.kanban.repoMissing}>
                {t.kanban.repoMissing}
              </span>
            );
          })}
          {remainingCodebaseCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-inset ring-slate-200 dark:bg-[#181c28] dark:text-slate-400 dark:ring-white/5">
              +{remainingCodebaseCount} repo{remainingCodebaseCount > 1 ? "s" : ""}
            </span>
          )}
          <WorktreeBadge task={task} worktreeCache={worktreeCache} onOpenDetail={onOpenDetail} stopCardInteraction={stopCardInteraction} />
        </div>
      )}

      <div className="border-t border-slate-200/80 pt-2.5 dark:border-[#262938]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1" />
          {(canRun || canRetry) && (
            <button
              onClick={() => void onRetryTrigger(task.id)}
              onClickCapture={stopCardInteraction}
              className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-medium ${canRetry
                ? "border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800/50 dark:bg-amber-900/10 dark:text-amber-300"
                : "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/50 dark:bg-emerald-900/10 dark:text-emerald-300"
                }`}
            >
              {canRetry ? t.kanban.rerun : t.kanban.run}
            </button>
          )}
        </div>

        <div className="mt-2 pt-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                  {t.kanban.automation}
                </div>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${automationSourceTone}`}>
                  {automationSourceLabel}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setShowAssignment((current) => !current);
              }}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-medium text-slate-600 transition hover:bg-slate-100 dark:border-gray-700 dark:bg-[#151826] dark:text-slate-300 dark:hover:bg-[#1b1e2b]"
            >
              {showAssignment ? t.kanban.done : t.common.edit}
            </button>
          </div>
          {showAssignment && (
            <div className="mt-1.5 flex items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-gray-700 dark:bg-[#12141c]">
                <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                  {t.kanban.providerLabel}
                </span>
                <select
                  value={task.assignedProvider ?? ""}
                  disabled={availableProviders.length === 0}
                  onMouseDown={stopCardInteraction}
                  onClick={stopCardInteraction}
                  onChange={(event) => {
                    void handleProviderChange(event.target.value);
                  }}
                  className="min-w-0 flex-1 truncate bg-transparent text-[11px] font-medium text-slate-700 outline-none disabled:opacity-50 dark:text-slate-200"
                  aria-label={`ACP provider for ${task.title}`}
                  data-testid="kanban-card-acp-select"
                >
                  <option value="">{t.kanban.useLaneDefault}</option>
                  {availableProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        {showAssignment && (
          <AssignmentSection
            task={task}
            specialists={specialists}
            specialistLanguage={specialistLanguage}
            stopCardInteraction={stopCardInteraction}
            onPatchTask={onPatchTask}
            onRefresh={onRefresh}
          />
        )}
      </div>
    </div>
  );
}

interface WorktreeBadgeProps {
  task: TaskInfo;
  worktreeCache: Record<string, WorktreeInfo>;
  onOpenDetail: () => void;
  stopCardInteraction: (event: { stopPropagation: () => void }) => void;
}

function WorktreeBadge({ task, worktreeCache, onOpenDetail, stopCardInteraction }: WorktreeBadgeProps) {
  const { t } = useTranslation();
  if (!task.worktreeId) return null;

  const wt = worktreeCache[task.worktreeId];
  if (!wt) {
    return (
      <div className="inline-flex items-center text-[10px] text-slate-500 dark:text-slate-400">
        worktree {t.common.loading}...
      </div>
    );
  }

  const wtDotColor = wt.status === "active"
    ? "bg-emerald-500"
    : wt.status === "creating"
      ? "bg-amber-500"
      : "bg-rose-500";

  return (
    <button
      onClick={onOpenDetail}
      onClickCapture={stopCardInteraction}
      className="inline-flex max-w-full items-center gap-1 text-[10px] text-slate-500 transition hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      title={t.kanban.worktreeLoading}
      data-testid="worktree-badge"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${wtDotColor}`} />
      <span className="truncate">
        worktree {wt.status} · {wt.branch}
      </span>
    </button>
  );
}

interface AssignmentSectionProps {
  task: TaskInfo;
  specialists: SpecialistOption[];
  specialistLanguage: KanbanSpecialistLanguage;
  stopCardInteraction: (event: { stopPropagation: () => void }) => void;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onRefresh: () => void;
}

function AssignmentSection({
  task,
  specialists,
  specialistLanguage,
  stopCardInteraction,
  onPatchTask,
  onRefresh,
}: AssignmentSectionProps) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 space-y-2 border-t border-slate-200/80 pt-2 dark:border-[#262938]">
      {!task.assignedProvider && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white/80 px-3 py-2 text-[11px] text-slate-500 dark:border-gray-700 dark:bg-[#10131a] dark:text-gray-400">
          {t.kanban.selectProviderHint}
        </div>
      )}

      {task.assignedProvider && (
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[10px] font-medium text-slate-500 dark:text-gray-400">{t.kanban.role}</span>
          <select
            value={task.assignedRole ?? "DEVELOPER"}
            onClick={stopCardInteraction}
            onChange={async (event) => {
              await onPatchTask(task.id, { assignedRole: event.target.value });
              onRefresh();
            }}
            className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700 dark:border-gray-700 dark:bg-[#12141c] dark:text-slate-200"
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
        </div>
      )}

      {task.assignedProvider && (
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[10px] font-medium text-slate-500 dark:text-gray-400">{t.kanban.specialist}</span>
          <select
            value={getLanguageSpecificSpecialistId(task.assignedSpecialistId, specialistLanguage) ?? ""}
            onClick={stopCardInteraction}
            onChange={async (event) => {
              const specialist = findSpecialistById(specialists, event.target.value);
              await onPatchTask(task.id, {
                assignedSpecialistId: event.target.value || undefined,
                assignedSpecialistName: specialist?.name ?? undefined,
                assignedRole: specialist?.role ?? task.assignedRole,
              });
              onRefresh();
            }}
            className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700 dark:border-gray-700 dark:bg-[#12141c] dark:text-slate-200"
          >
            <option value="">{KANBAN_SPECIALIST_LANGUAGE_LABELS[specialistLanguage].none}</option>
            {specialists.map((specialist) => (
              <option key={specialist.id} value={specialist.id}>
                {getSpecialistDisplayName(specialist)}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
