"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { AcpProviderInfo } from "@/client/acp-client";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import { resolveEffectiveTaskAutomation } from "@/core/kanban/effective-task-automation";
import type { KanbanColumnInfo, SessionInfo, TaskInfo, WorktreeInfo } from "../types";
import { KanbanDescriptionEditor } from "./kanban-description-editor";

interface SpecialistOption {
  id: string;
  name: string;
  role: string;
}

export interface KanbanCardDetailProps {
  task: TaskInfo;
  boardColumns?: KanbanColumnInfo[];
  availableProviders: AcpProviderInfo[];
  specialists: SpecialistOption[];
  codebases: CodebaseData[];
  allCodebaseIds: string[];
  worktreeCache: Record<string, WorktreeInfo>;
  sessionInfo?: SessionInfo | null;
  sessions?: SessionInfo[];
  fullWidth?: boolean;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onRetryTrigger: (taskId: string) => Promise<void>;
  onDelete: () => void;
  onRefresh: () => void;
  onProviderChange?: (providerId: string | null) => void;
  onRepositoryChange?: (codebaseIds: string[]) => void;
  onSelectSession?: (sessionId: string) => void;
}

const ROLE_OPTIONS = ["CRAFTER", "ROUTA", "GATE", "DEVELOPER"];

function getProviderName(providerId: string | undefined, availableProviders: AcpProviderInfo[]): string {
  if (!providerId) return "Workspace default";
  return availableProviders.find((provider) => provider.id === providerId)?.name ?? providerId;
}

function getSpecialistName(
  specialistId: string | undefined,
  specialistName: string | undefined,
  specialists: SpecialistOption[],
): string {
  if (!specialistId && !specialistName) return "None";
  return specialists.find((specialist) => specialist.id === specialistId)?.name ?? specialistName ?? specialistId ?? "None";
}

function formatSessionTimestamp(value: string | undefined): string {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return date.toLocaleString();
}

function resolveTimelineColumns(boardColumns: KanbanColumnInfo[], currentColumnId: string | undefined, runCount: number): KanbanColumnInfo[] {
  if (runCount === 0 || boardColumns.length === 0) return [];
  const orderedColumns = boardColumns.slice().sort((left, right) => left.position - right.position);
  const currentIndex = orderedColumns.findIndex((column) => column.id === (currentColumnId ?? "backlog"));
  if (currentIndex === -1) {
    return orderedColumns.slice(Math.max(0, orderedColumns.length - runCount));
  }
  const startIndex = Math.max(0, currentIndex + 1 - runCount);
  return orderedColumns.slice(startIndex, currentIndex + 1);
}

export function KanbanCardDetail({
  task,
  boardColumns,
  availableProviders,
  specialists,
  codebases,
  allCodebaseIds,
  worktreeCache,
  sessionInfo,
  sessions,
  fullWidth,
  onPatchTask,
  onRetryTrigger,
  onDelete,
  onRefresh,
  onProviderChange,
  onRepositoryChange,
  onSelectSession,
}: KanbanCardDetailProps) {
  const [editTitle, setEditTitle] = useState(task.title);
  const [editObjective, setEditObjective] = useState(task.objective ?? "");
  const [editPriority, setEditPriority] = useState(task.priority ?? "medium");
  const [updateError, setUpdateError] = useState<string | null>(null);

  const getTaskRepositoryPath = (): string | null => {
    const taskCodebaseIds = task.codebaseIds && task.codebaseIds.length > 0 ? task.codebaseIds : allCodebaseIds;
    if (taskCodebaseIds.length === 0) return null;
    const primaryCodebase = codebases.find((codebase) => codebase.id === taskCodebaseIds[0]);
    return primaryCodebase?.repoPath ?? null;
  };

  const sessionCwdMismatch = sessionInfo && task.triggerSessionId ? (() => {
    const taskRepoPath = getTaskRepositoryPath();
    if (!taskRepoPath) return false;
    return sessionInfo.cwd !== taskRepoPath;
  })() : undefined;

  const currentLane = useMemo(
    () => boardColumns?.find((column) => column.id === (task.columnId ?? "backlog")),
    [boardColumns, task.columnId],
  );
  const compactMode = !fullWidth;

  return (
    <div className={`${fullWidth ? "w-full" : "w-full"} h-full overflow-y-auto bg-gray-50/80 dark:bg-[#10131a]`}>
      <div className={`mx-auto flex min-h-full max-w-5xl flex-col ${compactMode ? "gap-3 p-3" : "gap-4 p-5"}`}>
        <section className={`border border-gray-200/80 bg-white shadow-sm dark:border-[#232736] dark:bg-[#121620] ${compactMode ? "rounded-2xl p-3" : "rounded-3xl p-4"}`}>
          <div className={`${compactMode ? "mb-1.5" : "mb-2"} text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500`}>
            Card Detail
          </div>
          <textarea
            value={editTitle}
            onChange={(event) => setEditTitle(event.target.value)}
            onBlur={async () => {
              if (editTitle !== task.title) {
                await onPatchTask(task.id, { title: editTitle });
                onRefresh();
              }
            }}
            rows={compactMode ? 3 : 2}
            className={`w-full resize-none rounded-2xl border border-transparent bg-transparent px-0 py-0 font-semibold leading-tight text-gray-950 outline-none focus:border-transparent focus:ring-0 dark:text-gray-50 ${compactMode ? "text-lg" : "text-xl"}`}
          />
          <div className={`flex flex-wrap items-center ${compactMode ? "mt-2 gap-1.5" : "mt-3 gap-2"}`}>
            <MetaSelect
              label="Priority"
              value={editPriority}
              compact={compactMode}
              options={[
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
                { value: "urgent", label: "Urgent" },
              ]}
              onChange={async (value) => {
                setEditPriority(value);
                await onPatchTask(task.id, { priority: value });
                onRefresh();
              }}
            />
            <MetaBadge label="Column" value={task.columnId ?? "backlog"} compact={compactMode} />
            {(task.labels ?? []).map((label) => (
              <span
                key={label}
                className={`inline-flex items-center rounded-full border border-amber-200 bg-amber-50 font-medium text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-200 ${compactMode ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"}`}
              >
                {label}
              </span>
            ))}
          </div>
        </section>

        <DetailSection
          title="Description"
          description={compactMode ? undefined : "Capture the context, constraints, and acceptance notes for this card."}
          compact={compactMode}
        >
          <KanbanDescriptionEditor
            value={editObjective}
            compact={compactMode}
            onSave={async (nextObjective) => {
              if (nextObjective !== (task.objective ?? "")) {
                setEditObjective(nextObjective);
                await onPatchTask(task.id, { objective: nextObjective });
                onRefresh();
              }
            }}
          />
        </DetailSection>

        <LaneAutomationSection
          task={task}
          lane={currentLane}
          availableProviders={availableProviders}
          specialists={specialists}
          compact={compactMode}
        />

        <ProviderSection
          task={task}
          boardColumns={boardColumns ?? []}
          availableProviders={availableProviders}
          specialists={specialists}
          sessionCwdMismatch={sessionCwdMismatch}
          onPatchTask={onPatchTask}
          onRetryTrigger={onRetryTrigger}
          onProviderChange={onProviderChange}
          compact={compactMode}
        />

        <SessionHistorySection
          task={task}
          boardColumns={boardColumns ?? []}
          specialists={specialists}
          sessions={sessions ?? []}
          currentSessionId={task.triggerSessionId}
          onSelectSession={onSelectSession}
          compact={compactMode}
        />

        <GitHubSection task={task} compact={compactMode} />

        <RepositoriesWorktreeRow
          task={task}
          codebases={codebases}
          allCodebaseIds={allCodebaseIds}
          worktreeCache={worktreeCache}
          updateError={updateError}
          setUpdateError={setUpdateError}
          onPatchTask={onPatchTask}
          onRefresh={onRefresh}
          onRepositoryChange={onRepositoryChange}
          compact={compactMode}
        />

        <div className={`mt-auto border-t border-gray-200 dark:border-gray-700 ${compactMode ? "pt-3" : "pt-4"}`}>
          <button
            onClick={onDelete}
            className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:border-red-300 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-900/10 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            Delete Task
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailSection({
  title,
  description,
  children,
  compact = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <section className={`border border-gray-200/80 bg-white shadow-sm dark:border-[#232736] dark:bg-[#121620] ${compact ? "rounded-2xl p-3" : "rounded-3xl p-4"}`}>
      <div className={compact ? "mb-2" : "mb-3"}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">{title}</div>
        {description && (
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{description}</div>
        )}
      </div>
      {children}
    </section>
  );
}

function MetaBadge({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 font-medium text-gray-700 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300 ${compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"}`}>
      <span className="uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</span>
      <span>{value}</span>
    </span>
  );
}

function MetaSelect({
  label,
  value,
  options,
  onChange,
  compact = false,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => Promise<void>;
  compact?: boolean;
}) {
  return (
    <label className={`inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 font-medium text-gray-700 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300 ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"}`}>
      <span className="uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</span>
      <select
        value={value}
        onChange={(event) => {
          void onChange(event.target.value);
        }}
        className={`rounded-full bg-transparent font-medium text-gray-700 outline-none dark:text-gray-300 ${compact ? "pr-3 text-[10px]" : "pr-4 text-[11px]"}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function CompactInfo({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={`rounded-2xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-[#0d1018] ${compact ? "px-2.5 py-2" : "px-3 py-2"}`}>
      <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</div>
      <div className={`mt-1 truncate font-medium text-gray-800 dark:text-gray-100 ${compact ? "text-[13px]" : "text-sm"}`}>{value}</div>
    </div>
  );
}

function LaneAutomationSection({
  task,
  lane,
  availableProviders,
  specialists,
  compact = false,
}: {
  task: TaskInfo;
  lane?: KanbanColumnInfo;
  availableProviders: AcpProviderInfo[];
  specialists: SpecialistOption[];
  compact?: boolean;
}) {
  if (!lane) return null;

  const laneProvider = getProviderName(lane.automation?.providerId, availableProviders);
  const laneSpecialist = getSpecialistName(lane.automation?.specialistId, lane.automation?.specialistName, specialists);
  const cardSpecialist = getSpecialistName(task.assignedSpecialistId, task.assignedSpecialistName, specialists);
  const hasCardOverride = Boolean(task.assignedProvider || task.assignedRole || task.assignedSpecialistId || task.assignedSpecialistName);

  return (
    <DetailSection
      title="Lane Automation"
      description={compact ? undefined : "Inherited defaults from the current lane."}
      compact={compact}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{lane.name}</div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${lane.automation?.enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400"}`}>
          {lane.automation?.enabled ? "Automation on" : "Manual"}
        </span>
      </div>
      <div className={`grid gap-2 ${compact ? "mt-2 grid-cols-1" : "mt-3 sm:grid-cols-3"}`}>
        <CompactInfo label="Provider" value={laneProvider} compact={compact} />
        <CompactInfo label="Specialist" value={laneSpecialist} compact={compact} />
        <CompactInfo label="Card override" value={hasCardOverride ? "Applied" : "None"} compact={compact} />
      </div>
      {hasCardOverride && (
        <div className={`rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-300 ${compact ? "mt-2 leading-[1.125rem]" : "mt-3 leading-5"}`}>
          This card currently carries an explicit override: {getProviderName(task.assignedProvider, availableProviders)} · {task.assignedRole ?? "DEVELOPER"} · {cardSpecialist}
        </div>
      )}
    </DetailSection>
  );
}

function SessionHistorySection({
  task,
  boardColumns,
  specialists,
  sessions,
  currentSessionId,
  onSelectSession,
  compact = false,
}: {
  task: TaskInfo;
  boardColumns: KanbanColumnInfo[];
  specialists: SpecialistOption[];
  sessions: SessionInfo[];
  currentSessionId?: string;
  onSelectSession?: (sessionId: string) => void;
  compact?: boolean;
}) {
  const orderedSessionIds = Array.from(new Set([
    ...(task.sessionIds ?? []),
    ...(currentSessionId ? [currentSessionId] : []),
  ]));

  if (orderedSessionIds.length === 0) {
    return (
      <div className={`border border-dashed border-gray-300 bg-white text-sm text-gray-500 shadow-sm dark:border-gray-700 dark:bg-[#121620] dark:text-gray-400 ${compact ? "rounded-2xl px-3 py-4" : "rounded-3xl px-4 py-5"}`}>
        No ACP runs yet. Once this card enters an automated lane, each run will show up here.
      </div>
    );
  }

  const sessionMap = new Map(sessions.map((session) => [session.sessionId, session]));
  const timelineColumns = resolveTimelineColumns(boardColumns, task.columnId, orderedSessionIds.length);

  return (
    <DetailSection
      title="Run History"
      description={compact ? undefined : `${orderedSessionIds.length} recorded automation runs for this card.`}
      compact={compact}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-600 shadow-sm dark:bg-[#0d1018] dark:text-gray-300">
          Current lane: {task.columnId ?? "backlog"}
        </div>
      </div>
      <div className={`overflow-y-auto pr-1 ${compact ? "mt-2 max-h-72 space-y-1.5" : "mt-3 max-h-80 space-y-2"}`}>
        {orderedSessionIds.map((sessionId, index) => {
          const session = sessionMap.get(sessionId);
          const isCurrent = sessionId === currentSessionId;
          const timelineColumn = timelineColumns[index];
          const laneSpecialist = timelineColumn
            ? getSpecialistName(timelineColumn.automation?.specialistId, timelineColumn.automation?.specialistName, specialists)
            : "Unknown";

          return (
            <button
              key={sessionId}
              onClick={() => onSelectSession?.(sessionId)}
              className={`w-full rounded-xl border text-left transition-colors ${compact ? "px-2.5 py-2" : "px-3 py-2"} ${
                isCurrent
                  ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200"
                  : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300 dark:hover:bg-[#191c28]"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  Run {index + 1}
                </span>
                {timelineColumn && (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                    {timelineColumn.name}
                  </span>
                )}
                {isCurrent && (
                  <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-800/40 dark:text-amber-200">
                    Active
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className={`truncate font-medium text-gray-900 dark:text-gray-100 ${compact ? "text-[13px]" : "text-sm"}`}>
                    {session?.name ?? session?.provider ?? "ACP Session"}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {(session?.provider ?? "Unknown provider")} · {(session?.role ?? "Unknown role")} · {laneSpecialist}
                  </div>
                  <div className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                    {formatSessionTimestamp(session?.createdAt)}
                  </div>
                </div>
                <span className={`shrink-0 rounded-lg bg-gray-100 font-mono text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-300 ${compact ? "px-1.5 py-0.5" : "px-2 py-1"}`}>
                  {sessionId.slice(0, 8)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-gray-500 dark:text-gray-400">
                <span className="truncate">{session?.cwd ?? "Working directory unavailable"}</span>
                <span className="font-medium text-amber-600 dark:text-amber-300">Open</span>
              </div>
            </button>
          );
        })}
      </div>
    </DetailSection>
  );
}

function ProviderSection({
  task,
  boardColumns,
  availableProviders,
  specialists,
  sessionCwdMismatch,
  onPatchTask,
  onRetryTrigger,
  onProviderChange,
  compact = false,
}: {
  task: TaskInfo;
  boardColumns: KanbanColumnInfo[];
  availableProviders: AcpProviderInfo[];
  specialists: SpecialistOption[];
  sessionCwdMismatch?: boolean;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onRetryTrigger: (taskId: string) => Promise<void>;
  onProviderChange?: (providerId: string | null) => void;
  compact?: boolean;
}) {
  const effectiveAutomation = resolveEffectiveTaskAutomation(task, boardColumns);
  const canRunTask = effectiveAutomation.canRun && task.columnId !== "done";
  const effectiveProvider = getProviderName(effectiveAutomation.providerId, availableProviders);
  const effectiveSpecialist = getSpecialistName(
    effectiveAutomation.specialistId,
    effectiveAutomation.specialistName,
    specialists,
  );

  return (
    <DetailSection
      title="Card Session Override"
      description={compact ? undefined : "Override the lane default provider, role, or specialist for this card only."}
      compact={compact}
    >
      <select
        value={task.assignedProvider ?? ""}
        onChange={async (event) => {
          const newProvider = event.target.value || null;
          if (newProvider) {
            await onPatchTask(task.id, {
              assignedProvider: newProvider,
              assignedRole: task.assignedRole ?? "DEVELOPER",
            });
            onProviderChange?.(newProvider);
          } else {
            await onPatchTask(task.id, {
              assignedProvider: undefined,
              assignedRole: undefined,
              assignedSpecialistId: undefined,
              assignedSpecialistName: undefined,
            });
            onProviderChange?.(null);
          }
        }}
        className={`w-full rounded-2xl border border-gray-200 bg-gray-50/80 text-sm text-gray-700 outline-none focus:border-amber-400 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300 ${compact ? "px-2.5 py-2" : "px-3 py-2"}`}
      >
        <option value="">Use lane default</option>
        {availableProviders.map((provider) => (
          <option key={`${provider.id}-${provider.name}`} value={provider.id}>{provider.name}</option>
        ))}
      </select>
      <div className={`text-[11px] text-gray-500 dark:text-gray-400 ${compact ? "mt-1" : "mt-1"}`}>
        Leave this empty to inherit the current lane&apos;s default provider, role, and specialist.
      </div>
      {canRunTask && (
        <div className={`mt-2 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-900/40 dark:bg-sky-900/10 dark:text-sky-200 ${compact ? "leading-[1.125rem]" : "leading-5"}`}>
          Manual {task.triggerSessionId ? "reruns" : "runs"} use {effectiveAutomation.source === "card" ? "this card override" : "the current lane default"}:
          {" "}
          {effectiveProvider} · {effectiveAutomation.role ?? "DEVELOPER"} · {effectiveSpecialist}
        </div>
      )}
      {task.assignedProvider && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <select
            value={task.assignedRole ?? "DEVELOPER"}
            onChange={async (event) => {
              await onPatchTask(task.id, { assignedRole: event.target.value });
            }}
            className={`rounded-2xl border border-gray-200 bg-gray-50/80 text-sm text-gray-700 outline-none focus:border-amber-400 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300 ${compact ? "px-2.5 py-2" : "px-3 py-2"}`}
          >
            {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
          <select
            value={task.assignedSpecialistId ?? ""}
            onChange={async (event) => {
              const specialist = specialists.find((item) => item.id === event.target.value);
              await onPatchTask(task.id, {
                assignedSpecialistId: event.target.value || undefined,
                assignedSpecialistName: specialist?.name,
                assignedRole: specialist?.role ?? task.assignedRole,
              });
            }}
            className={`rounded-2xl border border-gray-200 bg-gray-50/80 text-sm text-gray-700 outline-none focus:border-amber-400 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-300 ${compact ? "px-2.5 py-2" : "px-3 py-2"}`}
          >
            <option value="">No specialist</option>
            {specialists.map((specialist) => <option key={specialist.id} value={specialist.id}>{specialist.name}</option>)}
          </select>
        </div>
      )}
      {sessionCwdMismatch && (
        <div className={`mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/10 dark:text-amber-400 ${compact ? "leading-[1.125rem]" : "leading-5"}`}>
          Repository changed. The active session is still running in an older directory. Rerun to apply the new repo selection.
        </div>
      )}
      {canRunTask && (
        <button
          onClick={async () => {
            await onRetryTrigger(task.id);
          }}
          data-testid="kanban-detail-run"
          className={`w-full rounded-xl bg-emerald-500 px-3 text-sm font-medium text-white transition-colors hover:bg-emerald-600 ${compact ? "mt-2.5 py-2" : "mt-3 py-2"}`}
        >
          {task.triggerSessionId ? "Rerun" : "Run"}
        </button>
      )}
    </DetailSection>
  );
}

function GitHubSection({ task, compact = false }: { task: TaskInfo; compact?: boolean }) {
  if (!task.githubNumber) return null;
  return (
    <DetailSection title="GitHub" compact={compact}>
      <a
        href={task.githubUrl}
        target="_blank"
        rel="noreferrer"
        className={`text-amber-600 hover:underline dark:text-amber-400 ${compact ? "text-[13px]" : "text-sm"}`}
      >
        #{task.githubNumber}
      </a>
    </DetailSection>
  );
}

function RepositoriesWorktreeRow({
  task,
  codebases,
  allCodebaseIds,
  worktreeCache,
  updateError,
  setUpdateError,
  onPatchTask,
  onRefresh,
  onRepositoryChange,
  compact = false,
}: {
  task: TaskInfo;
  codebases: CodebaseData[];
  allCodebaseIds: string[];
  worktreeCache: Record<string, WorktreeInfo>;
  updateError: string | null;
  setUpdateError: (error: string | null) => void;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onRefresh: () => void;
  onRepositoryChange?: (codebaseIds: string[]) => void;
  compact?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const currentCodebaseIds = task.codebaseIds && task.codebaseIds.length > 0 ? task.codebaseIds : allCodebaseIds;
  const primaryCodebase = codebases.find((codebase) => codebase.id === currentCodebaseIds[0]);
  const worktree = task.worktreeId ? worktreeCache[task.worktreeId] : null;

  return (
    <DetailSection
      title="Repositories"
      description={compact ? undefined : "Control the repository context and attached worktree for this card."}
      compact={compact}
    >
      <div className={`flex items-center gap-2 ${compact ? "text-[13px]" : "text-sm"}`}>
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Repo</div>
        {primaryCodebase ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${primaryCodebase.sourceType === "github" ? "bg-violet-500" : "bg-emerald-500"}`} />
            <span className="truncate text-gray-700 dark:text-gray-300">
              {primaryCodebase.label ?? primaryCodebase.repoPath.split("/").pop()}
            </span>
            {currentCodebaseIds.length > 1 && (
              <span className="text-xs text-gray-400">+{currentCodebaseIds.length - 1}</span>
            )}
          </div>
        ) : (
          <span className="text-xs text-gray-400 dark:text-gray-500">None</span>
        )}
        {worktree && (
          <>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              worktree.status === "active"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                : worktree.status === "creating"
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                  : "bg-rose-100 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300"
            }`}>{worktree.branch}</span>
          </>
        )}
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="ml-auto text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          {isExpanded ? "Hide" : "Edit"}
        </button>
      </div>

      {isExpanded && (
        <div className={`space-y-3 border-l-2 border-gray-200 dark:border-gray-700 ${compact ? "mt-2.5 pl-2.5" : "mt-3 pl-3"}`}>
          {codebases.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">Edit linked repositories</div>
              <div className="flex flex-wrap gap-1.5">
                {codebases.map((codebase) => {
                  const selected = currentCodebaseIds.includes(codebase.id);
                  return (
                    <button
                      key={codebase.id}
                      type="button"
                      onClick={async () => {
                        setUpdateError(null);
                        try {
                          const nextCodebaseIds = selected
                            ? currentCodebaseIds.filter((id) => id !== codebase.id)
                            : [...currentCodebaseIds, codebase.id];
                          await onPatchTask(task.id, { codebaseIds: nextCodebaseIds });
                          onRepositoryChange?.(nextCodebaseIds);
                          onRefresh();
                        } catch (error) {
                          setUpdateError(error instanceof Error ? error.message : "Failed to update repositories");
                        }
                      }}
                      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors ${
                        selected
                          ? "border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-600 dark:bg-violet-900/20 dark:text-violet-300"
                          : "border-gray-200 bg-white text-gray-600 hover:border-violet-300 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-400"
                      }`}
                      data-testid="detail-repo-toggle"
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${codebase.sourceType === "github" ? "bg-violet-500" : "bg-emerald-500"}`} />
                      {codebase.label ?? codebase.repoPath.split("/").pop() ?? codebase.repoPath}
                    </button>
                  );
                })}
              </div>
              {updateError && (
                <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">{updateError}</div>
              )}
            </div>
          )}
          {worktree && (
            <div data-testid="worktree-detail" className="truncate font-mono text-xs text-gray-500 dark:text-gray-500" title={worktree.worktreePath}>
              {worktree.worktreePath}
              {worktree.errorMessage && (
                <div className="mt-0.5 text-red-600 dark:text-red-400">{worktree.errorMessage}</div>
              )}
            </div>
          )}
        </div>
      )}
    </DetailSection>
  );
}
