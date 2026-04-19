"use client";

import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Check, CircleHelp, Copy, LoaderCircle, OctagonX, X } from "lucide-react";
import { useTranslation } from "@/i18n";
import type { AcpProviderInfo } from "@/client/acp-client";
import { resolveEffectiveTaskAutomation } from "@/core/kanban/effective-task-automation";
import type { KanbanColumnInfo } from "../types";
import type { SessionInfo, TaskInfo, TaskRunInfo } from "../types";
import {
  buildSessionDisplayLabel,
  createKanbanSpecialistResolver,
  formatSessionTimestamp,
  getLaneSessionStepLabel,
  getOrderedSessionIds,
  getStableOrderedSessionIds,
  getSpecialistName,
  type KanbanSpecialistOption,
} from "./kanban-card-session-utils";
import type { KanbanSpecialistLanguage } from "./kanban-specialist-language";
import { getKanbanSessionCopy } from "./i18n/kanban-session-copy";
import { useTaskRuns } from "./use-task-runs";

type ActivityTabId = "runs" | "handoffs" | "github";

function formatTaskRunKind(kind: TaskRunInfo["kind"] | undefined): string {
  switch (kind) {
    case "a2a_task":
      return "A2A";
    case "runner_acp":
      return "Runner ACP";
    case "embedded_acp":
      return "ACP";
    default:
      return "Run";
  }
}

function formatTaskRunStatus(status: TaskRunInfo["status"] | undefined): string {
  switch (status) {
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "timed_out":
      return "Timed out";
    case "transitioned":
      return "Transitioned";
    default:
      return "Unknown";
  }
}

function getTaskRunStatusClasses(status: TaskRunInfo["status"] | undefined): string {
  switch (status) {
    case "completed":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200";
    case "failed":
    case "timed_out":
      return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200";
    case "running":
      return "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-200";
    case "transitioned":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200";
    default:
      return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  }
}

function renderTaskRunStatusIcon(status: TaskRunInfo["status"] | undefined) {
  switch (status) {
    case "completed":
      return <Check className="h-3.5 w-3.5" />;
    case "failed":
      return <X className="h-3.5 w-3.5" />;
    case "timed_out":
      return <OctagonX className="h-3.5 w-3.5" />;
    case "running":
      return <LoaderCircle className="h-3.5 w-3.5 animate-spin" />;
    case "transitioned":
      return <Check className="h-3.5 w-3.5" />;
    default:
      return <CircleHelp className="h-3.5 w-3.5" />;
  }
}

function TaskRunStatusIcon({ status }: { status: TaskRunInfo["status"] | undefined }) {
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded-md ${getTaskRunStatusClasses(status)}`}
      aria-label={formatTaskRunStatus(status)}
      title={formatTaskRunStatus(status)}
    >
      {renderTaskRunStatusIcon(status)}
    </span>
  );
}

function formatAgentCardTarget(agentCardUrl?: string): string | undefined {
  const trimmed = agentCardUrl?.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = new URL(trimmed);
    return `${parsed.hostname}${parsed.pathname !== "/" ? parsed.pathname : ""}`;
  } catch {
    return trimmed.replace(/^https?:\/\//, "");
  }
}

function formatExpectedRunTarget(
  task: TaskInfo,
  boardColumns: KanbanColumnInfo[],
  availableProviders: AcpProviderInfo[],
  specialists: KanbanSpecialistOption[],
  workspaceDefaultLabel: string,
  autoProviderId?: string,
): string {
  const resolveSpecialist = createKanbanSpecialistResolver(specialists);
  const effectiveAutomation = resolveEffectiveTaskAutomation(task, boardColumns, resolveSpecialist, {
    autoProviderId,
  });
  const specialistName = getSpecialistName(
    effectiveAutomation.specialistId,
    effectiveAutomation.specialistName,
    specialists,
  );

  if (effectiveAutomation.transport === "a2a") {
    return [
      "A2A",
      effectiveAutomation.role ?? "DEVELOPER",
      specialistName,
      formatAgentCardTarget(effectiveAutomation.agentCardUrl),
      effectiveAutomation.skillId ? `skill:${effectiveAutomation.skillId}` : undefined,
    ].filter(Boolean).join(" · ");
  }

  const providerName = effectiveAutomation.providerId
    ? availableProviders.find((provider) => provider.id === effectiveAutomation.providerId)?.name ?? effectiveAutomation.providerId
    : workspaceDefaultLabel;
  return [providerName, effectiveAutomation.role ?? "DEVELOPER", specialistName].join(" · ");
}

function formatLaneSessionHeading(
  laneSession: NonNullable<TaskInfo["laneSessions"]>[number] | undefined,
  session: SessionInfo | undefined,
): string {
  if (laneSession?.transport === "a2a") {
    return laneSession.externalTaskId
      ? `A2A Task · ${laneSession.externalTaskId}`
      : laneSession.contextId
        ? `A2A Context · ${laneSession.contextId}`
        : "A2A Task";
  }

  return session?.name ?? session?.provider ?? "Automation Run";
}

function ActivitySection({
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
    <section className="space-y-2 border-b border-slate-200/80 py-2 dark:border-[#232736]">
      <div className={compact ? "mb-2" : "mb-3"}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">{title}</div>
        {description && (
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</div>
        )}
      </div>
      {children}
    </section>
  );
}

function handleSessionRowKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  onSelectSession: ((sessionId: string) => void) | undefined,
  sessionId: string,
) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  onSelectSession?.(sessionId);
}

function SessionIdChip({
  sessionId,
  compact = false,
}: {
  sessionId: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    navigator.clipboard.writeText(sessionId).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      setCopied(false);
    });
  };

  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${compact ? "max-w-[13rem]" : "max-w-[18rem]"}`}>
      <span
        className={`min-w-0 break-all rounded-lg bg-slate-100 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300 ${compact ? "px-1.5 py-0.5" : "px-2 py-1"}`}
        title={sessionId}
      >
        {sessionId}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        title={t.common.copyToClipboard}
        aria-label={t.common.copyToClipboard}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  );
}

export function KanbanCardActivityPanel({
  task,
  sessions,
  specialists,
  specialistLanguage = "en",
  autoProviderId: _autoProviderId,
  currentSessionId,
  onSelectSession,
  refreshSignal,
  compact = false,
}: {
  task: TaskInfo;
  sessions: SessionInfo[];
  specialists: KanbanSpecialistOption[];
  specialistLanguage?: KanbanSpecialistLanguage;
  autoProviderId?: string;
  currentSessionId?: string;
  onSelectSession?: (sessionId: string) => void;
  refreshSignal?: number;
  compact?: boolean;
}) {
  const copy = getKanbanSessionCopy(specialistLanguage);
  const { runs, error } = useTaskRuns(
    task.id,
    `${refreshSignal ?? ""}:${task.updatedAt ?? ""}:${task.triggerSessionId ?? ""}:${task.laneSessions?.length ?? 0}`,
  );
  const tabs: Array<{ id: ActivityTabId; label: string; count?: number }> = [
    { id: "runs", label: copy.runs, count: runs?.length ?? getOrderedSessionIds(task).length },
    ...((task.laneHandoffs?.length ?? 0) > 0 ? [{ id: "handoffs" as const, label: copy.handoffs, count: task.laneHandoffs?.length }] : []),
    ...(task.githubNumber ? [{ id: "github" as const, label: "GitHub" }] : []),
  ];
  const [activeTab, setActiveTab] = useState<ActivityTabId>(tabs[0]?.id ?? "runs");
  const visibleTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : (tabs[0]?.id ?? "runs");

  return (
    <ActivitySection
      title={copy.activityTitle}
      description={compact ? undefined : copy.activityDescription}
      compact={compact}
    >
      <div>
        {error && (
          <div className="mb-2 border-l-2 border-amber-300 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/80 dark:text-amber-200">
            Run ledger unavailable, showing local run history. {error}
          </div>
        )}
        <div className="flex flex-wrap border-b border-slate-200/70 dark:border-[#232736]">
          {tabs.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center justify-between gap-1 border-b-2 border-transparent px-3 py-2 text-[11px] font-medium transition-colors ${
                  active
                    ? "border-b-[#b45309] text-amber-800 dark:border-b-[#f59e0b] dark:text-amber-200"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                <span>{tab.label}</span>
                {typeof tab.count === "number" && (
                  <span className={`rounded-none border px-1 py-0.5 text-[10px] ${active ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/50 dark:bg-amber-900/10 dark:text-amber-100" : "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className={compact ? "mt-3" : "mt-4"}>
          {visibleTab === "runs" && (
            <SessionHistoryPanel
              task={task}
              runs={runs ?? undefined}
              specialists={specialists}
              sessions={sessions}
              specialistLanguage={specialistLanguage}
              currentSessionId={currentSessionId}
              onSelectSession={onSelectSession}
              compact={compact}
            />
          )}
          {visibleTab === "handoffs" && (
            <HandoffPanel
              task={task}
              compact={compact}
            />
          )}
          {visibleTab === "github" && (
            <GitHubPanel task={task} compact={compact} />
          )}
        </div>
      </div>
    </ActivitySection>
  );
}

export function KanbanCardActivityBar({
  task,
  sessions = [],
  specialistLanguage = "en",
  currentSessionId,
  onSelectSession,
  onCloseSession,
}: {
  task: TaskInfo;
  sessions?: SessionInfo[];
  specialistLanguage?: KanbanSpecialistLanguage;
  currentSessionId?: string;
  onSelectSession?: (sessionId: string) => void;
  onCloseSession?: () => void;
}) {
  const { t } = useTranslation();
  const copy = getKanbanSessionCopy(specialistLanguage);
  const { runs, error } = useTaskRuns(
    task.id,
    `${task.updatedAt ?? ""}:${task.triggerSessionId ?? ""}:${task.laneSessions?.length ?? 0}`,
  );
  const orderedSessionIds = getStableOrderedSessionIds(task, runs);
  const laneSessions = task.laneSessions ?? [];
  const laneSessionMap = new Map(laneSessions.map((entry) => [entry.sessionId, entry]));
  const sessionMap = new Map(sessions.map((session) => [session.sessionId, session]));
  const runMap = new Map((runs ?? []).map((run) => [run.sessionId ?? run.id, run]));
  const selectedRunId = currentSessionId && orderedSessionIds.includes(currentSessionId)
    ? currentSessionId
    : orderedSessionIds[orderedSessionIds.length - 1];
  const selectedLaneSession = selectedRunId ? laneSessionMap.get(selectedRunId) : undefined;
  const selectedRun = selectedRunId ? runMap.get(selectedRunId) : undefined;
  const selectedStepLabel = getLaneSessionStepLabel(selectedLaneSession);

  if (orderedSessionIds.length === 0) {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-dashed border-slate-300 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
        <span>{copy.noRunsInline}</span>
        {onCloseSession && (
          <button
            type="button"
            onClick={onCloseSession}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center border border-slate-200 text-sm font-semibold text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200"
            aria-label={copy.closeSessionPane}
            title={copy.closeSessionPane}
          >
            ×
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 px-1 py-1">
      {error && (
        <div className="border-l-2 border-amber-300 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-700/80 dark:text-amber-200">
          Run ledger unavailable, using cached task history.
        </div>
      )}
      <div className="flex items-start gap-2 border-b border-slate-200/70 pb-2 dark:border-[#232736]">
        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-1 border-slate-200/70">
          {orderedSessionIds.map((sessionId, index) => {
            const active = sessionId === selectedRunId;
            const laneSession = laneSessionMap.get(sessionId);
            const run = runMap.get(sessionId);
            const laneLabel = laneSession?.columnName ?? laneSession?.columnId ?? t.kanban.runLabel;
            const runLabel = buildSessionDisplayLabel(sessionId, index, sessionMap);
            const tabLabel = laneSession?.stepName?.trim() || runLabel;

            return (
              <button
                key={sessionId}
                type="button"
                onClick={() => onSelectSession?.(sessionId)}
                className={`inline-flex max-w-full items-center gap-1.5 border-b-2 px-3 py-1.5 text-[11px] font-medium transition-colors ${
                  active
                    ? "border-b-[#b45309] text-slate-900 dark:border-b-[#f59e0b] dark:text-slate-100"
                    : "border-b-transparent text-slate-600 hover:border-b-slate-300 dark:border-b-transparent dark:text-slate-400 dark:hover:border-b-slate-600"
                }`}
                aria-pressed={active}
                title={`${tabLabel} · ${laneLabel} · Run ${index + 1}`}
              >
                <span className="truncate font-semibold">{tabLabel}</span>
                {run && (
                  <TaskRunStatusIcon status={run.status} />
                )}
                <span className={`rounded-none border border-slate-200 px-1.5 py-0.5 text-[10px] ${
                  active
                    ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    : "bg-transparent text-slate-500 dark:text-slate-400"
                }`}>
                  #{index + 1}
                </span>
              </button>
            );
          })}
        </div>
        {onCloseSession && (
          <button
            type="button"
            onClick={onCloseSession}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center border border-slate-200 text-sm font-semibold text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200"
            aria-label={copy.closeSessionPane}
            title={copy.closeSessionPane}
          >
            ×
          </button>
        )}
      </div>
      {(selectedLaneSession?.columnName || selectedStepLabel || selectedLaneSession?.status) && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200/80 pb-1 text-[10px] dark:border-[#232736]">
          {selectedLaneSession?.columnName && (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold uppercase tracking-wide text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
              {selectedLaneSession.columnName}
            </span>
          )}
          {selectedLaneSession?.transport && (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
              {selectedLaneSession.transport}
            </span>
          )}
          {selectedRun && (
            <span className={`rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide ${getTaskRunStatusClasses(selectedRun.status)}`}>
              {formatTaskRunStatus(selectedRun.status)}
            </span>
          )}
          {selectedStepLabel && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 font-semibold uppercase tracking-wide text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              {selectedStepLabel}
            </span>
          )}
          {selectedLaneSession?.status && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
              {selectedLaneSession.status}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function SessionHistoryPanel({
  task,
  runs,
  specialists,
  sessions,
  specialistLanguage = "en",
  currentSessionId,
  onSelectSession,
  compact = false,
}: {
  task: TaskInfo;
  runs?: TaskRunInfo[];
  specialists: KanbanSpecialistOption[];
  sessions: SessionInfo[];
  specialistLanguage?: KanbanSpecialistLanguage;
  currentSessionId?: string;
  onSelectSession?: (sessionId: string) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const copy = getKanbanSessionCopy(specialistLanguage);
  const laneSessions = task.laneSessions ?? [];
  const orderedSessionIds = getStableOrderedSessionIds(task, runs);

  if (orderedSessionIds.length === 0) {
    return (
      <div className={`border-b border-dashed border-slate-300 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400 ${compact ? "px-3 py-3" : "px-4 py-4"}`}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">{copy.runHistoryTitle}</div>
        <div className="mt-2">{copy.noRunsHistory} {copy.noRunsHistoryHint}</div>
      </div>
    );
  }

  const sessionMap = new Map(sessions.map((session) => [session.sessionId, session]));
  const laneSessionMap = new Map(laneSessions.map((entry) => [entry.sessionId, entry]));
  const runMap = new Map((runs ?? []).map((run) => [run.sessionId ?? run.id, run]));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">{copy.runHistoryTitle}</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {copy.runHistoryCount(orderedSessionIds.length)}
          </div>
        </div>
        <div className="border border-slate-200 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:text-slate-300">
          {t.kanban.currentLane}: {task.columnId ?? t.kanban.backlog}
        </div>
      </div>
      <div className={`overflow-y-auto pr-1 ${compact ? "mt-3 max-h-80 space-y-1.5" : "mt-4 max-h-[34rem] space-y-2"}`}>
        {orderedSessionIds.map((sessionId, index) => {
          const session = sessionMap.get(sessionId);
          const isCurrent = sessionId === currentSessionId;
          const laneSession = laneSessionMap.get(sessionId);
          const run = runMap.get(sessionId);
          const selectedSessionId = run?.sessionId ?? sessionId;
          const laneSpecialist = getSpecialistName(
            laneSession?.specialistId,
            run?.specialistName ?? laneSession?.specialistName,
            specialists,
          );
          const stepLabel = getLaneSessionStepLabel(laneSession);
          const isA2ARun = laneSession?.transport === "a2a";
          const reconnectLabel = run?.resumeTarget?.type === "external_task" ? t.kanban.inspectLabel : t.kanban.openLabel;

          return (
            <div
              key={sessionId}
              role="button"
              tabIndex={0}
              onClick={() => onSelectSession?.(selectedSessionId)}
              onKeyDown={(event) => handleSessionRowKeyDown(event, onSelectSession, selectedSessionId)}
              className={`w-full border-b border-slate-200/70 text-left transition-colors last:border-b-0 ${compact ? "px-2.5 py-2" : "px-3 py-2.5"} ${
                isCurrent
                  ? "text-amber-900 dark:text-amber-200"
                  : "text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300"
              } focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950`}
              aria-pressed={isCurrent}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {t.kanban.runLabel} {index + 1}
                </span>
                {run && (
                  <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-700 dark:text-slate-200">
                    {formatTaskRunKind(run.kind)}
                  </span>
                )}
                {laneSession?.columnName && (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                    {laneSession.columnName}
                  </span>
                )}
                {laneSession?.transport && (
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                    {laneSession.transport}
                  </span>
                )}
                {stepLabel && (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                    {stepLabel}
                  </span>
                )}
                {isCurrent && (
                  <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-800/40 dark:text-amber-200">
                    {t.common.active}
                  </span>
                )}
                {(run?.status ?? laneSession?.status) && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${getTaskRunStatusClasses(run?.status ?? laneSession?.status)}`}>
                    {formatTaskRunStatus(run?.status ?? laneSession?.status)}
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className={`truncate font-medium text-slate-900 dark:text-slate-100 ${compact ? "text-[13px]" : "text-sm"}`}>
                    {laneSession ? formatLaneSessionHeading(laneSession, session) : (session?.name ?? session?.provider ?? t.kanban.acpSession)}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {isA2ARun
                      ? [
                        "Remote task",
                        laneSession?.role ?? t.kanban.unknownRole,
                        laneSpecialist,
                      ].filter(Boolean).join(" · ")
                      : [
                        laneSession?.provider ?? session?.provider ?? t.kanban.unknownProvider,
                        laneSession?.role ?? session?.role ?? t.kanban.unknownRole,
                        laneSpecialist,
                      ].filter(Boolean).join(" · ")}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                    {formatSessionTimestamp(run?.startedAt ?? session?.createdAt ?? laneSession?.startedAt)}
                  </div>
                </div>
                <SessionIdChip
                  sessionId={run?.externalTaskId ?? laneSession?.externalTaskId ?? sessionId}
                  compact={compact}
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="truncate">
                  {isA2ARun
                    ? (run?.contextId ?? laneSession?.contextId) ? `Context ${run?.contextId ?? laneSession?.contextId}` : "Remote task metadata available"
                    : session?.cwd ?? t.kanban.workingDirUnavailable}
                </span>
                <span className="font-medium text-amber-600 dark:text-amber-300">{reconnectLabel}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function KanbanEmptySessionPane({
  task,
  boardColumns,
  availableProviders,
  specialists,
  specialistLanguage = "en",
  autoProviderId,
  onCloseSession,
}: {
  task: TaskInfo;
  boardColumns: KanbanColumnInfo[];
  availableProviders: AcpProviderInfo[];
  specialists: KanbanSpecialistOption[];
  specialistLanguage?: KanbanSpecialistLanguage;
  autoProviderId?: string;
  onCloseSession?: () => void;
}) {
  const { t } = useTranslation();
  const copy = getKanbanSessionCopy(specialistLanguage);
  const target = formatExpectedRunTarget(
    task,
    boardColumns,
    availableProviders,
    specialists,
    t.kanban.workspaceDefault,
    autoProviderId,
  );

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-slate-200/80 p-2 dark:border-[#202433]">
        <KanbanCardActivityBar
          task={task}
          specialistLanguage={specialistLanguage}
          onCloseSession={onCloseSession}
        />
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <div className="w-full max-w-lg border border-slate-200/80 p-4 dark:border-[#232736]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-600 dark:text-sky-300">{copy.emptyPaneEyebrow}</div>
          <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-slate-50">{copy.emptyPaneTitle}</div>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{copy.emptyPaneDescription}</p>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{copy.emptyPaneHint}</p>
          <div className="mt-3 border-l-2 border-sky-300 bg-sky-50/50 px-3 py-2.5 text-sm font-medium text-sky-900 dark:border-sky-800/60 dark:bg-sky-900/20 dark:text-sky-100">
            {copy.expectedTarget(target)}
          </div>
        </div>
      </div>
    </div>
  );
}

function HandoffPanel({ task, compact = false }: { task: TaskInfo; compact?: boolean }) {
  const { t } = useTranslation();
  const handoffs = task.laneHandoffs ?? [];
  if (handoffs.length === 0) {
    return (
      <div className={`border-b border-dashed border-slate-300 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400 ${compact ? "px-3 py-3" : "px-4 py-4"}`}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">{t.kanban.laneHandoffs}</div>
        <div className="mt-2">{t.kanban.noLaneHandoffsYet}</div>
      </div>
    );
  }

  const orderedHandoffs = handoffs.slice().sort((left, right) => (
    new Date(right.requestedAt).getTime() - new Date(left.requestedAt).getTime()
  ));

  return (
    <>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">{t.kanban.laneHandoffs}</div>
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {t.kanban.laneHandoffsDescription}
        </div>
      </div>
      <div className={`space-y-2 ${compact ? "mt-3" : "mt-4"}`}>
        {orderedHandoffs.map((handoff) => (
          <div
            key={handoff.id}
            className="border-b border-slate-200/70 px-3 py-2 dark:border-slate-700/70"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                {handoff.requestType.replace(/_/g, " ")}
              </span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                {handoff.status}
              </span>
            </div>
            <div className="mt-2 text-sm text-slate-800 dark:text-slate-200">{handoff.request}</div>
            {handoff.responseSummary && (
              <div className="mt-2 border-l-2 border-emerald-200 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900/30 dark:text-emerald-200">
                {handoff.responseSummary}
              </div>
            )}
            <div className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
              {t.kanban.requested} {formatSessionTimestamp(handoff.requestedAt)}{handoff.respondedAt ? ` · ${t.kanban.responded} ${formatSessionTimestamp(handoff.respondedAt)}` : ""}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function GitHubPanel({ task, compact = false }: { task: TaskInfo; compact?: boolean }) {
  const { t } = useTranslation();
  if (!task.githubNumber) {
    return null;
  }

  return (
    <div className={`border-b border-slate-200/70 dark:border-slate-700/70 ${compact ? "px-3 py-3" : "px-4 py-4"}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">GitHub</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
          {task.githubState ?? t.kanban.linkedLabel}
        </span>
        {task.githubRepo && (
          <span className="text-xs text-slate-500 dark:text-slate-400">{task.githubRepo}</span>
        )}
      </div>
      <a
        href={task.githubUrl}
        target="_blank"
        rel="noreferrer"
        className={`mt-3 inline-flex text-amber-600 hover:underline dark:text-amber-400 ${compact ? "text-[13px]" : "text-sm"}`}
      >
        #{task.githubNumber}
      </a>
      {task.githubSyncedAt && (
        <div className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
          {t.kanban.syncedAt} {formatSessionTimestamp(task.githubSyncedAt)}
        </div>
      )}
    </div>
  );
}
