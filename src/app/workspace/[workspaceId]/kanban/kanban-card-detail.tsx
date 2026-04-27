"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import type { AcpProviderInfo } from "@/client/acp-client";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import { Select } from "@/client/components/select";
import {
  type EffectiveTaskAutomation,
  resolveEffectiveTaskAutomation,
  resolveKanbanAutomationStep,
} from "@/core/kanban/effective-task-automation";
import { formatArtifactSummary, resolveKanbanTransitionArtifacts } from "@/core/kanban/transition-artifacts";
import { getKanbanAutomationSteps, type KanbanAutomationStep } from "@/core/models/kanban";
import type { KanbanColumnInfo, SessionInfo, TaskInfo, WorktreeInfo } from "../types";
import { KanbanCardActivityPanel } from "./kanban-card-activity";
import { KanbanDescriptionEditor } from "./kanban-description-editor";
import { KanbanTaskChangesTab } from "./components/kanban-task-changes-tab";
import { MarkdownViewer } from "@/client/components/markdown/markdown-viewer";
import { splitLegacyTaskComment } from "@/core/models/task";
import type { FallbackAgent } from "@/core/models/task";
import {
  createKanbanSpecialistResolver,
  getOrderedSessionIds,
  getSpecialistName,
  type KanbanSpecialistOption as SpecialistOption,
} from "./kanban-card-session-utils";
export { KanbanCardActivityBar } from "./kanban-card-activity";
import { KanbanCardArtifacts } from "./kanban-card-artifacts";
import { KanbanCardProviderOverrideDropdown } from "./kanban-card-provider-override-dropdown";
// Legacy imports - removed, functionality replaced by KanbanTaskGitWorkflowPanel
// import { TaskFileDiffPreview, TaskCommitDiffPreview, CommitRow } from "./kanban-diff-preview";
import { StoryReadinessPanel, EvidenceBundlePanel, JitContextPanel, ReviewFeedbackPanel } from "./kanban-detail-panels";
import { getKanbanSessionCopy } from "./i18n/kanban-session-copy";
import {
  findSpecialistById,
  getSpecialistDisplayName,
  getLanguageSpecificSpecialistId,
  KANBAN_SPECIALIST_LANGUAGE_LABELS,
  type KanbanSpecialistLanguage,
} from "./kanban-specialist-language";
import { useTranslation } from "@/i18n";

export interface KanbanCardDetailProps {
  task: TaskInfo;
  refreshSignal?: number;
  boardColumns?: KanbanColumnInfo[];
  availableProviders: AcpProviderInfo[];
  specialists: SpecialistOption[];
  specialistLanguage: KanbanSpecialistLanguage;
  codebases: CodebaseData[];
  allCodebaseIds: string[];
  worktreeCache: Record<string, WorktreeInfo>;
  sessionInfo?: SessionInfo | null;
  sessions?: SessionInfo[];
  fullWidth?: boolean;
  selectedProvider?: string | null;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onRetryTrigger: (taskId: string) => Promise<void>;
  onRunPullRequest?: (taskId: string) => Promise<string | null>;
  onDelete: () => void;
  onRefresh: () => void;
  onProviderChange?: (providerId: string | null) => void;
  onRepositoryChange?: (codebaseIds: string[]) => void;
  onSelectSession?: (sessionId: string) => void;
  jitContextSessionId?: string | null;
  onLoadJitContextIntoSession?: (sessionId: string, prompt: string) => Promise<void>;
  onOpenJitContextHistoryAnalysis?: (prompt: string, targetWindow: Window | null) => Promise<void>;
  isFullscreen?: boolean;
  onToggleFullscreen?: (next: boolean) => void;
  onClose?: () => void;
  canShowSessionPane?: boolean;
  isSessionPaneVisible?: boolean;
  onShowSessionPane?: () => void;
}

const ROLE_OPTIONS = ["CRAFTER", "ROUTA", "GATE", "DEVELOPER"];
type KanbanDetailTabId = "overview" | "readiness" | "execution" | "jitContext" | "changes" | "evidence" | "runs";

const persistedKanbanDetailTabs = new Map<string, KanbanDetailTabId>();

function getProviderName(providerId: string | undefined, availableProviders: AcpProviderInfo[]): string {
  if (!providerId) return "Workspace default";
  return availableProviders.find((provider) => provider.id === providerId)?.name ?? providerId;
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

function resolveTaskCommentEntries(task: TaskInfo): Array<{
  id: string;
  body: string;
  createdAt?: string;
  source?: "legacy_import" | "update_card";
  agentId?: string;
  sessionId?: string;
}> {
  if ((task.comments?.length ?? 0) > 0) {
    return task.comments ?? [];
  }

  return splitLegacyTaskComment(task.comment);
}

function formatCommentTimestamp(value?: string): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleString();
}

function formatCommentSource(
  source: "legacy_import" | "update_card" | undefined,
  t: ReturnType<typeof useTranslation>["t"],
): string | null {
  if (source === "legacy_import") {
    return t.kanbanDetail.progressNoteSourceLegacy;
  }
  if (source === "update_card") {
    return t.kanbanDetail.progressNoteSourceUpdateCard;
  }
  return null;
}

function formatCommentActor(entry: {
  agentId?: string;
  sessionId?: string;
}): string | null {
  if (entry.agentId && entry.sessionId) {
    return `${entry.agentId} · ${entry.sessionId}`;
  }
  if (entry.agentId) {
    return entry.agentId;
  }
  if (entry.sessionId) {
    return entry.sessionId;
  }
  return null;
}

function formatEffectiveAutomationTarget(
  automation: EffectiveTaskAutomation,
  availableProviders: AcpProviderInfo[],
  specialists: SpecialistOption[],
): string {
  if (automation.transport === "a2a") {
    const specialist = getSpecialistName(
      automation.specialistId,
      automation.specialistName,
      specialists,
    );
    return [
      "A2A",
      automation.role ?? "DEVELOPER",
      specialist,
      formatAgentCardTarget(automation.agentCardUrl),
      automation.skillId ? `skill:${automation.skillId}` : undefined,
    ].filter(Boolean).join(" · ");
  }

  return [
    getProviderName(automation.providerId, availableProviders),
    automation.role ?? "DEVELOPER",
    getSpecialistName(automation.specialistId, automation.specialistName, specialists),
  ].join(" · ");
}

function getPromptFailureMessage(task: TaskInfo, sessionInfo: SessionInfo | null | undefined): string | null {
  if (sessionInfo?.acpStatus === "error" && sessionInfo.acpError) {
    return sessionInfo.acpError;
  }
  return task.lastSyncError ?? null;
}

function isExpiredEmbeddedSessionFailure(message: string | null | undefined): boolean {
  if (!message) return false;
  return message.includes("embedded ACP processes cannot be resumed on a different instance");
}

function formatAutomationStepSummary(
  step: KanbanAutomationStep,
  availableProviders: AcpProviderInfo[],
  specialists: SpecialistOption[],
  autoProviderId?: string | null,
): string {
  const resolvedStep = resolveKanbanAutomationStep(
    step,
    createKanbanSpecialistResolver(specialists),
    { autoProviderId: autoProviderId ?? undefined },
  ) ?? step;
  if ((resolvedStep.transport ?? "acp") === "a2a") {
    return [
      "A2A",
      resolvedStep.role ?? "DEVELOPER",
      getSpecialistName(resolvedStep.specialistId, resolvedStep.specialistName, specialists),
      formatAgentCardTarget(resolvedStep.agentCardUrl),
      resolvedStep.skillId ? `skill:${resolvedStep.skillId}` : undefined,
    ].filter(Boolean).join(" · ");
  }

  return [
    getProviderName(resolvedStep.providerId, availableProviders),
    resolvedStep.role ?? "DEVELOPER",
    getSpecialistName(resolvedStep.specialistId, resolvedStep.specialistName, specialists),
  ].join(" · ");
}

function getEvidenceStatus(task: TaskInfo, t: ReturnType<typeof useTranslation>["t"]): string | null {
  const evidence = task.evidenceSummary;
  if (!evidence) return null;
  const reviewable = evidence.artifact.requiredSatisfied
    && (evidence.verification.hasReport || evidence.verification.hasVerdict || evidence.completion.hasSummary);
  return reviewable ? t.kanbanDetail.reviewable : t.kanbanDetail.reviewBlocked;
}

export function KanbanCardDetail({
  task,
  refreshSignal,
  boardColumns,
  availableProviders,
  specialists,
  specialistLanguage,
  codebases,
  allCodebaseIds,
  worktreeCache,
  sessionInfo,
  sessions,
  fullWidth,
  selectedProvider,
  onPatchTask,
  onRetryTrigger,
  onRunPullRequest,
  onDelete,
  onRefresh,
  onProviderChange,
  onRepositoryChange,
  onSelectSession,
  jitContextSessionId,
  onLoadJitContextIntoSession,
  onOpenJitContextHistoryAnalysis,
  isFullscreen = false,
  onToggleFullscreen,
  onClose,
  canShowSessionPane = false,
  isSessionPaneVisible = false,
  onShowSessionPane,
}: KanbanCardDetailProps) {
  const { t } = useTranslation();
  const progressNotes = useMemo(() => resolveTaskCommentEntries(task), [task]);
  const sessionCopy = getKanbanSessionCopy(specialistLanguage);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editObjective, setEditObjective] = useState(task.objective ?? "");
  const [editTestCases, setEditTestCases] = useState((task.testCases ?? []).join("\n"));
  const [editPriority, setEditPriority] = useState(task.priority ?? "medium");
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [isTitleEditing, setIsTitleEditing] = useState(false);
  const [isDescriptionEditing, setIsDescriptionEditing] = useState(false);
  const [isTestCasesEditing, setIsTestCasesEditing] = useState(false);
  const titleInputRef = useRef<HTMLTextAreaElement | null>(null);
  const testCasesInputRef = useRef<HTMLTextAreaElement | null>(null);
  const displayedTitle = isTitleEditing ? editTitle : task.title;
  const displayedObjective = isDescriptionEditing ? editObjective : (task.objective ?? "");
  const displayedTestCases = isTestCasesEditing ? editTestCases : (task.testCases ?? []).join("\n");
  const displayedPriority = task.priority ?? editPriority;
  const resolvedWorkspaceId = codebases[0]?.workspaceId ?? "";

  const getTaskRepositoryPath = (): string | null => {
    const worktreePath = task.worktreeId ? worktreeCache[task.worktreeId]?.worktreePath : null;
    if (worktreePath) return worktreePath;
    const taskCodebaseIds = task.codebaseIds && task.codebaseIds.length > 0 ? task.codebaseIds : allCodebaseIds;
    if (taskCodebaseIds.length === 0) return null;
    const primaryCodebase = codebases.find((codebase) => codebase.id === taskCodebaseIds[0]);
    return primaryCodebase?.repoPath ?? null;
  };

  const getTaskHistoryRepositoryPath = (): string | null => {
    const taskCodebaseIds = task.codebaseIds && task.codebaseIds.length > 0 ? task.codebaseIds : allCodebaseIds;
    if (taskCodebaseIds.length === 0) {
      return getTaskRepositoryPath();
    }
    const primaryCodebase = codebases.find((codebase) => codebase.id === taskCodebaseIds[0]);
    return primaryCodebase?.repoPath ?? getTaskRepositoryPath();
  };

  const currentLane = useMemo(
    () => boardColumns?.find((column) => column.id === (task.columnId ?? "backlog")),
    [boardColumns, task.columnId],
  );
  const nextTransitionArtifacts = useMemo(
    () => resolveKanbanTransitionArtifacts(boardColumns ?? [], task.columnId),
    [boardColumns, task.columnId],
  );
  const orderedSessionIds = useMemo(() => getOrderedSessionIds(task), [task]);
  const activeRunSessionId = task.triggerSessionId
    ?? (orderedSessionIds.length > 0 ? orderedSessionIds[orderedSessionIds.length - 1] : undefined);
  const sessionCwdMismatch = sessionInfo && activeRunSessionId ? (() => {
    const taskRepoPath = getTaskRepositoryPath();
    if (!taskRepoPath) return false;
    return sessionInfo.cwd !== taskRepoPath;
  })() : undefined;
  const splitMode = !fullWidth;
  const compactMode = splitMode;
  const tabStateKey = `${task.id}:${splitMode ? "split" : "full"}`;
  const [tabSelection, setTabSelection] = useState<{
    key: string;
    tab: KanbanDetailTabId;
  } | null>(null);
  const activeTab = tabSelection?.key === tabStateKey
    ? tabSelection.tab
    : persistedKanbanDetailTabs.get(tabStateKey) ?? "overview";
  const tabListId = `kanban-detail-tabs-${task.id}`;
  const storyReadinessValue = task.storyReadiness
    ? (task.storyReadiness.ready ? t.kanbanDetail.readyForDev : t.kanbanDetail.blockedForDev)
    : null;
  const evidenceValue = getEvidenceStatus(task, t);
  const detailTabs = [
    { id: "overview" as const, label: t.kanbanDetail.overview },
    { id: "readiness" as const, label: t.kanbanDetail.storyReadiness },
    { id: "execution" as const, label: t.kanbanDetail.execution },
    { id: "jitContext" as const, label: t.kanbanDetail.jitContext },
    { id: "changes" as const, label: t.kanbanDetail.changes },
    { id: "evidence" as const, label: t.kanbanDetail.evidenceBundle },
    { id: "runs" as const, label: t.kanbanDetail.runs },
  ];

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className={`mx-auto flex min-h-full max-w-6xl flex-col ${compactMode ? "gap-2 p-3" : "gap-3 p-4"}`}>
        <section className={`border-b border-slate-200/80 pb-2 dark:border-[#232736] ${compactMode ? "pt-0" : "pt-0.5"}`}>
          <div className={`flex items-center justify-between gap-3 ${compactMode ? "mb-1" : "mb-1.5"}`}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              {t.kanbanDetail.cardDetail}
            </div>
            <div className="flex items-center gap-1.5">
              {onClose ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-300 dark:hover:border-amber-700 dark:hover:bg-amber-900/20 dark:hover:text-amber-200"
                  aria-label={t.kanbanDetail.closeCardDetail}
                  title={t.kanbanDetail.closeCardDetail}
                >
                  <X className="h-3 w-3" />
                  <span>{t.kanbanDetail.closeCardDetail}</span>
                </button>
              ) : null}
              {canShowSessionPane && !isSessionPaneVisible && onShowSessionPane ? (
                <button
                  type="button"
                  onClick={onShowSessionPane}
                  className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-300 dark:hover:border-amber-700 dark:hover:bg-amber-900/20 dark:hover:text-amber-200"
                >
                  {sessionCopy.showSessionPane}
                </button>
              ) : null}
              {onToggleFullscreen ? (
                <button
                  type="button"
                  onClick={() => onToggleFullscreen(!isFullscreen)}
                  className="inline-flex h-6 w-6 items-center justify-center border border-slate-300/80 text-slate-500 transition-colors hover:border-amber-400 hover:text-amber-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-amber-700 dark:hover:text-amber-200"
                  aria-label={isFullscreen ? t.kanbanDetail.exitFullscreen : t.kanbanDetail.enterFullscreen}
                  title={isFullscreen ? t.kanbanDetail.exitFullscreen : t.kanbanDetail.enterFullscreen}
                >
                  {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-300 dark:hover:border-amber-700 dark:hover:bg-amber-900/20 dark:hover:text-amber-200"
              >
                {t.common.refresh}
              </button>
            </div>
          </div>
          <textarea
            ref={titleInputRef}
            value={displayedTitle}
            readOnly={!isTitleEditing}
            onFocus={() => {
              if (!isTitleEditing) {
                setEditTitle(task.title);
                setIsTitleEditing(true);
              }
            }}
            onChange={(event) => setEditTitle(event.target.value)}
            onKeyDown={async (event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setEditTitle(task.title);
                setIsTitleEditing(false);
                titleInputRef.current?.blur();
                return;
              }
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                if (editTitle !== task.title) {
                  await onPatchTask(task.id, { title: editTitle });
                  onRefresh();
                }
                setIsTitleEditing(false);
                titleInputRef.current?.blur();
              }
            }}
            rows={isTitleEditing ? 2 : 1}
            className={`w-full resize-none border-0 bg-transparent px-0 py-0 font-semibold leading-tight text-slate-950 outline-none focus:border-transparent focus:ring-0 dark:text-slate-50 ${compactMode ? "text-lg" : "text-xl"} ${isTitleEditing ? "" : "cursor-text"}`}
          />
          {isTitleEditing && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  if (editTitle !== task.title) {
                    await onPatchTask(task.id, { title: editTitle });
                    onRefresh();
                  }
                  setIsTitleEditing(false);
                }}
                className="rounded-md bg-amber-500 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-amber-600"
              >
                {t.common.save}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditTitle(task.title);
                  setIsTitleEditing(false);
                }}
                className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {t.common.cancel}
              </button>
            </div>
          )}
          <div className={`flex flex-wrap items-center ${compactMode ? "mt-1.5 gap-1.5" : "mt-2 gap-2"}`}>
            <MetaSelect
              label={t.kanbanDetail.priority}
              value={displayedPriority}
              compact={compactMode}
              options={[
                { value: "low", label: t.kanbanDetail.low },
                { value: "medium", label: t.kanbanDetail.medium },
                { value: "high", label: t.kanbanDetail.high },
                { value: "urgent", label: t.kanbanDetail.urgent },
              ]}
              onChange={async (value) => {
                setEditPriority(value);
                await onPatchTask(task.id, { priority: value });
                onRefresh();
              }}
            />
            <MetaBadge label="Column" value={task.columnId ?? "backlog"} compact={compactMode} />
            {orderedSessionIds.length > 0 && (
              <MetaBadge label="Runs" value={String(orderedSessionIds.length)} compact={compactMode} />
            )}
            {storyReadinessValue && (
              <MetaBadge label={t.kanbanDetail.storyReadiness} value={storyReadinessValue} compact={compactMode} />
            )}
            {evidenceValue && (
              <MetaBadge label={t.kanbanDetail.evidenceBundle} value={evidenceValue} compact={compactMode} />
            )}
            {task.githubNumber && (
              <MetaBadge label="GitHub" value={`#${task.githubNumber}`} compact={compactMode} />
            )}
            {task.deliveryReadiness?.hasCommitsSinceBase && task.deliveryReadiness.commitsSinceBase > 0 && (
              <MetaBadge
                label={t.kanbanDetail.commits}
                value={String(task.deliveryReadiness.commitsSinceBase)}
                compact={compactMode}
              />
            )}
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

        <div className="border-b border-slate-200/80 dark:border-[#232736]">
          <div
            className="flex min-w-0 gap-1 overflow-x-auto"
            role="tablist"
            aria-label={t.kanbanDetail.cardDetail}
            id={tabListId}
          >
            {detailTabs.map((tab) => {
              const active = tab.id === activeTab;
              const tabId = `kanban-detail-tab-${task.id}-${tab.id}`;
              const panelId = `kanban-detail-panel-${task.id}-${tab.id}`;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    persistedKanbanDetailTabs.set(tabStateKey, tab.id);
                    setTabSelection({ key: tabStateKey, tab: tab.id });
                  }}
                  id={tabId}
                  role="tab"
                  aria-selected={active}
                  aria-controls={panelId}
                  tabIndex={active ? 0 : -1}
                  className={`shrink-0 border-b-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                    active
                      ? "border-b-amber-600 text-slate-900 dark:border-b-amber-400 dark:text-slate-100"
                      : "border-b-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                  aria-pressed={active}
                  data-testid={`kanban-detail-tab-${tab.id}`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div
          className={compactMode ? "space-y-2" : "space-y-3"}
          id={`kanban-detail-panel-${task.id}-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`kanban-detail-tab-${task.id}-${activeTab}`}
          data-testid={`kanban-detail-panel-${activeTab}`}
        >
          {activeTab === "overview" && (
            <>
              <section className={compactMode ? "space-y-1.5 border-b border-slate-200/80 py-1.5 dark:border-[#232736]" : "space-y-2 border-b border-slate-200/70 py-2 dark:border-[#232736]"}>
                <KanbanDescriptionEditor
                  value={displayedObjective}
                  compact={compactMode}
                  onEditingChange={(nextEditing) => {
                    if (nextEditing) {
                      setEditObjective(task.objective ?? "");
                    }
                    setIsDescriptionEditing(nextEditing);
                  }}
                  onSave={async (nextObjective) => {
                    if (nextObjective !== (task.objective ?? "")) {
                      setEditObjective(nextObjective);
                      await onPatchTask(task.id, { objective: nextObjective });
                      onRefresh();
                    }
                  }}
                />
              </section>

              <DetailSection
                title={t.kanbanDetail.reviewFeedback}
                description={compactMode ? undefined : t.kanbanDetail.evidenceBundleHint}
                compact={compactMode}
              >
                <ReviewFeedbackPanel task={task} compact={compactMode} />
              </DetailSection>

              <DetailSection
                title={t.kanbanDetail.progressNotes}
                description={compactMode ? undefined : t.kanbanDetail.progressNotesHint}
                compact={compactMode}
              >
                <div className={`border-b border-slate-200/70 py-2 dark:border-slate-700 ${compactMode ? "px-3" : "px-4"}`}>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    {t.kanbanDetail.appendedComments}
                  </div>
                  {progressNotes.length > 0 ? (
                    <div className={`space-y-3 ${compactMode ? "mt-2 px-3 py-2.5" : "mt-2 px-4 py-2.5"}`}>
                      {progressNotes.map((entry, index) => {
                        const timestamp = formatCommentTimestamp(entry.createdAt);
                        const sourceLabel = formatCommentSource(entry.source, t);
                        const actorLabel = formatCommentActor(entry);
                        return (
                          <div key={entry.id} className="rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2.5 dark:border-slate-700/70 dark:bg-slate-900/30">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                              <div className="flex flex-wrap items-center gap-2">
                                <span>{`Note ${index + 1}`}</span>
                                {sourceLabel ? (
                                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
                                    {sourceLabel}
                                  </span>
                                ) : null}
                                {actorLabel ? (
                                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
                                    {actorLabel}
                                  </span>
                                ) : null}
                              </div>
                              {timestamp ? <span>{timestamp}</span> : null}
                            </div>
                            <div className="mt-2">
                              <MarkdownViewer
                                content={entry.body}
                                className="prose prose-sm max-w-none text-slate-800 dark:prose-invert dark:text-slate-200"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className={`text-sm text-slate-500 dark:text-slate-400 ${compactMode ? "mt-2 px-3 py-2.5" : "mt-2 px-4 py-2.5"}`}>
                      {t.kanbanDetail.noProgressNotesYet}
                    </div>
                  )}
                </div>
              </DetailSection>

              <DetailSection
                title={t.kanbanDetail.testCases}
                description={compactMode ? undefined : t.kanbanDetail.testCasesHint}
                compact={compactMode}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-end gap-2">
                    {isTestCasesEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={async () => {
                            const normalizedCurrent = (task.testCases ?? []).join("\n");
                            if (editTestCases !== normalizedCurrent) {
                              await onPatchTask(task.id, {
                                testCases: editTestCases.split("\n").map((item) => item.trim()).filter(Boolean),
                              });
                              onRefresh();
                            }
                            setIsTestCasesEditing(false);
                          }}
                          className="rounded-md bg-amber-500 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-amber-600"
                        >
                          {t.common.save}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditTestCases((task.testCases ?? []).join("\n"));
                            setIsTestCasesEditing(false);
                          }}
                          className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          {t.common.cancel}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditTestCases((task.testCases ?? []).join("\n"));
                          setIsTestCasesEditing(true);
                        }}
                        className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        {t.common.edit}
                      </button>
                    )}
                  </div>
                  {isTestCasesEditing ? (
                    <textarea
                      ref={testCasesInputRef}
                      value={displayedTestCases}
                      onChange={(event) => setEditTestCases(event.target.value)}
                      rows={compactMode ? 4 : 5}
                      placeholder={t.kanbanDetail.testCasesPlaceholder}
                      className="focus:ring-offset-0 w-full border border-slate-200/80 bg-transparent px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-700 dark:bg-transparent dark:text-slate-100"
                    />
                  ) : displayedTestCases.trim() ? (
                    <div className="border-b border-slate-200/70 px-3 py-2.5 text-sm text-slate-700 dark:border-slate-700/70 dark:text-slate-200">
                      {displayedTestCases.split("\n").filter(Boolean).map((item) => (
                        <div key={item} className="leading-6">
                          - {item}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="border-b border-slate-200/70 px-3 py-2.5 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
                      {t.kanbanDetail.testCasesPlaceholder}
                    </div>
                  )}
                </div>
              </DetailSection>
            </>
          )}

          {activeTab === "readiness" && (
            <DetailSection
              title={t.kanbanDetail.storyReadiness}
              description={compactMode ? undefined : t.kanbanDetail.storyReadinessHint}
              compact={compactMode}
            >
              <StoryReadinessPanel task={task} compact={compactMode} />
            </DetailSection>
          )}

          {activeTab === "changes" && (
            <DetailSection
              title={t.kanbanDetail.changes}
              description={compactMode ? undefined : t.kanbanDetail.changesHint}
              compact={compactMode}
            >
              <KanbanTaskChangesTab
                task={task}
                codebases={codebases}
                taskId={task.id}
                workspaceId={resolvedWorkspaceId}
                refreshSignal={refreshSignal}
                onRefresh={onRefresh}
                onRunPullRequest={onRunPullRequest}
                onSelectSession={onSelectSession}
              />
            </DetailSection>
          )}

          {activeTab === "evidence" && (
            <>
              <DetailSection
                title={t.kanbanDetail.evidenceBundle}
                description={compactMode ? undefined : t.kanbanDetail.evidenceBundleHint}
                compact={compactMode}
              >
                <EvidenceBundlePanel task={task} compact={compactMode} />
              </DetailSection>

              <KanbanCardArtifacts
                taskId={task.id}
                compact={compactMode}
                requiredArtifacts={nextTransitionArtifacts.nextRequiredArtifacts}
                refreshSignal={refreshSignal}
              />
            </>
          )}

          {activeTab === "execution" && (
            <>
              <ExecutionSection
                task={task}
                lane={currentLane}
                boardColumns={boardColumns ?? []}
                availableProviders={availableProviders}
                sessionInfo={sessionInfo}
                specialists={specialists}
                specialistLanguage={specialistLanguage}
                selectedProvider={selectedProvider}
                onPatchTask={onPatchTask}
                onRetryTrigger={onRetryTrigger}
                onProviderChange={onProviderChange}
                compact={compactMode}
              />

              <RepositoriesWorktreeRow
                task={task}
                codebases={codebases}
                allCodebaseIds={allCodebaseIds}
                worktreeCache={worktreeCache}
                sessionInfo={sessionInfo}
                sessionCwdMismatch={sessionCwdMismatch}
                updateError={updateError}
                setUpdateError={setUpdateError}
                onPatchTask={onPatchTask}
                onRefresh={onRefresh}
                onRepositoryChange={onRepositoryChange}
                onSelectSession={onSelectSession}
                compact={compactMode}
              />
            </>
          )}

          {activeTab === "jitContext" && (
            <JitContextPanel
              task={task}
              workspaceId={resolvedWorkspaceId || undefined}
              repoPath={getTaskHistoryRepositoryPath()}
              specialistLanguage={specialistLanguage}
              activeSessionId={jitContextSessionId}
              onPatchTask={onPatchTask}
              onLoadIntoSession={onLoadJitContextIntoSession}
              onOpenHistoryAnalysis={onOpenJitContextHistoryAnalysis}
              compact={compactMode}
            />
          )}

          {activeTab === "runs" && (
            <KanbanCardActivityPanel
              task={task}
              refreshSignal={refreshSignal}
              sessions={sessions ?? []}
              specialists={specialists}
              specialistLanguage={specialistLanguage}
              autoProviderId={selectedProvider ?? undefined}
              currentSessionId={activeRunSessionId}
              onSelectSession={onSelectSession}
              compact={compactMode}
            />
          )}
        </div>

        <div className={`mt-auto border-t border-slate-200 dark:border-slate-700 ${compactMode ? "pt-2" : "pt-3"}`}>
          <button
            onClick={onDelete}
            className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:border-red-300 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-900/10 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            {t.kanbanModals.deleteTaskTitle}
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
    <section className={compact ? "space-y-1.5 border-b border-slate-200/80 py-1.5 dark:border-[#232736]" : "space-y-2 border-b border-slate-200/70 py-2 dark:border-[#232736]"}>
      <div className={compact ? "mb-1.5" : "mb-2"}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">{title}</div>
        {description && (
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</div>
        )}
      </div>
      {children}
    </section>
  );
}

function MetaBadge({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 font-medium text-slate-700 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-300 ${compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"}`}>
      <span className="uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</span>
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
    <label className={`inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 font-medium text-slate-700 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-300 ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"}`}>
      <span className="uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</span>
      <Select
        value={value}
        onChange={(event) => {
          void onChange(event.target.value);
        }}
        className={`rounded-full bg-transparent font-medium text-slate-700 outline-none dark:text-slate-300 ${compact ? "pr-3 text-[10px]" : "pr-4 text-[11px]"}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </Select>
    </label>
  );
}

function InlineSummary({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-3 border-b border-slate-200/70 px-1 ${compact ? "py-2" : "py-2.5"} dark:border-slate-700/60`}>
      <div className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
        {label}
      </div>
      <div className={`min-w-0 text-right font-medium text-slate-800 dark:text-slate-100 ${compact ? "text-[12px] leading-[1.1rem]" : "text-sm"}`}>
        {value}
      </div>
    </div>
  );
}

function ExecutionSection({
  task,
  lane,
  boardColumns,
  availableProviders,
  sessionInfo,
  specialists,
  specialistLanguage,
  selectedProvider,
  onPatchTask,
  onRetryTrigger,
  onProviderChange,
  compact = false,
}: {
  task: TaskInfo;
  lane?: KanbanColumnInfo;
  boardColumns: KanbanColumnInfo[];
  availableProviders: AcpProviderInfo[];
  sessionInfo?: SessionInfo | null;
  specialists: SpecialistOption[];
  specialistLanguage: KanbanSpecialistLanguage;
  selectedProvider?: string | null;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onRetryTrigger: (taskId: string) => Promise<void>;
  onProviderChange?: (providerId: string | null) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const sessionCopy = getKanbanSessionCopy(specialistLanguage);
  const resolveSpecialist = useMemo(
    () => createKanbanSpecialistResolver(specialists),
    [specialists],
  );
  const effectiveAutomation = resolveEffectiveTaskAutomation(task, boardColumns, resolveSpecialist, {
    autoProviderId: selectedProvider ?? undefined,
  });
  const canRunTask = effectiveAutomation.canRun && task.columnId !== "done";
  const hasCardOverride = effectiveAutomation.source === "card";
  const overrideProviderValue = hasCardOverride ? task.assignedProvider ?? "" : "";
  const overrideRoleValue = hasCardOverride ? task.assignedRole ?? "DEVELOPER" : "DEVELOPER";
  const overrideSpecialistValue = hasCardOverride
    ? getLanguageSpecificSpecialistId(task.assignedSpecialistId, specialistLanguage) ?? ""
    : "";
  const usesSelectedProvider = Boolean(
    !hasCardOverride
    && selectedProvider
    && effectiveAutomation.transport !== "a2a"
    && effectiveAutomation.providerSource === "auto",
  );
  const manualRunTarget = usesSelectedProvider
    ? formatEffectiveAutomationTarget(
        {
          ...effectiveAutomation,
          providerId: selectedProvider ?? undefined,
        },
        availableProviders,
        specialists,
      )
    : formatEffectiveAutomationTarget(effectiveAutomation, availableProviders, specialists);
  const manualRunSourceLabel = hasCardOverride
    ? usesSelectedProvider
      ? "the current ACP provider with this card override"
      : "this card override"
    : usesSelectedProvider
      ? "the current ACP provider with this lane's role and specialist"
      : "the current lane default";
  const laneName = lane?.name ?? task.columnId ?? "backlog";
  const laneSteps = lane?.automation ? getKanbanAutomationSteps(lane.automation) : [];
  const cardSpecialist = getSpecialistName(task.assignedSpecialistId, task.assignedSpecialistName, specialists);
  const failureMessage = getPromptFailureMessage(task, sessionInfo);
  const activeRunSessionId = task.triggerSessionId
    ?? (task.laneSessions && task.laneSessions.length > 0 ? task.laneSessions[task.laneSessions.length - 1]?.sessionId : undefined);
  const activeLaneSession = activeRunSessionId
    ? task.laneSessions?.find((entry) => entry.sessionId === activeRunSessionId)
    : undefined;
  const failedRunProviderId = task.triggerSessionId
    ? sessionInfo?.sessionId === task.triggerSessionId
      ? sessionInfo.provider
      : activeLaneSession?.provider ?? (hasCardOverride ? task.assignedProvider : undefined) ?? (usesSelectedProvider ? selectedProvider ?? undefined : effectiveAutomation.providerId)
    : (hasCardOverride ? task.assignedProvider : undefined) ?? (usesSelectedProvider ? selectedProvider ?? undefined : effectiveAutomation.providerId);
  const failedRunLabel = activeLaneSession?.transport === "a2a" || effectiveAutomation.transport === "a2a"
    ? "current A2A run"
    : getProviderName(
      failedRunProviderId,
      availableProviders,
    );
  const effectiveRunTarget = activeLaneSession
    ? formatEffectiveAutomationTarget(
        {
          ...effectiveAutomation,
          transport: activeLaneSession.transport === "a2a" ? "a2a" : "acp",
          providerId: activeLaneSession.provider ?? effectiveAutomation.providerId,
          role: activeLaneSession.role ?? effectiveAutomation.role,
          specialistId: activeLaneSession.specialistId ?? effectiveAutomation.specialistId,
          specialistName: activeLaneSession.specialistName ?? effectiveAutomation.specialistName,
        },
        availableProviders,
        specialists,
      )
    : manualRunTarget;
  const lanePipeline = laneSteps.length > 0
    ? laneSteps.map((step) => formatAutomationStepSummary(
      step,
      availableProviders,
      specialists,
      selectedProvider,
    )).join(" -> ")
    : t.kanbanDetail.noLaneAutomation;
  const hasRecordedRuns = getOrderedSessionIds(task).length > 0;
  const transitionArtifacts = resolveKanbanTransitionArtifacts(boardColumns, task.columnId);
  const overrideKey = `${task.id}:${task.assignedProvider ?? ""}:${task.assignedRole ?? ""}:${task.assignedSpecialistId ?? ""}:${task.assignedSpecialistName ?? ""}`;
  const needsLiveRunRecovery = isExpiredEmbeddedSessionFailure(failureMessage);
  const runActionLabel = needsLiveRunRecovery
    ? t.kanbanDetail.recoverLiveRun
    : hasRecordedRuns ? t.kanban.rerun : t.kanban.run;
  // Only show "Current Run" separately if it differs from the lane pipeline (multi-step or has override)
  const showCurrentRunSeparately = laneSteps.length > 1 || hasCardOverride || effectiveRunTarget !== lanePipeline;

  return (
    <DetailSection
      title={t.kanbanDetail.execution}
      description={compact ? undefined : t.kanbanDetail.executionHint}
      compact={compact}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{laneName}</div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {lane ? t.kanbanDetail.inheritedFromLane : t.kanbanDetail.laneMetadataUnavailable}
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${lane?.automation?.enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"}`}>
          {lane?.automation?.enabled ? t.kanbanDetail.automationOn : t.kanbanDetail.manual}
        </span>
      </div>
      <div className="mt-2.5 space-y-1.5">
        <InlineSummary
          label={t.kanbanDetail.lanePipeline}
          value={lanePipeline}
          compact={compact}
        />
        {showCurrentRunSeparately && (
          <InlineSummary
            label={t.kanbanDetail.currentRun}
            value={effectiveRunTarget}
            compact={compact}
          />
        )}
      </div>
      {canRunTask && !hasRecordedRuns && (
        <div className={`mt-2 border-l-2 border-sky-300/70 px-3 py-2 text-xs text-sky-800 dark:border-sky-700/70 dark:text-sky-200 ${compact ? "leading-[1.125rem]" : "leading-5"}`}>
          {sessionCopy.emptyPaneDescription}
          {" "}
          {sessionCopy.emptyPaneHint}
          {effectiveRunTarget !== lanePipeline && (
            <>
              {" "}
              {sessionCopy.expectedTarget(effectiveRunTarget)}
            </>
          )}
        </div>
      )}
      {transitionArtifacts.currentRequiredArtifacts.length > 0 && (
        <div className="mt-1.5">
          <InlineSummary
            label={`Enter ${laneName}`}
            value={formatArtifactSummary(transitionArtifacts.currentRequiredArtifacts)}
            compact={compact}
          />
        </div>
      )}
      {transitionArtifacts.nextRequiredArtifacts.length > 0 && (
        <div className="mt-1.5">
          <InlineSummary
            label={transitionArtifacts.nextColumn?.name ? `Before ${transitionArtifacts.nextColumn.name}` : "Next move"}
            value={formatArtifactSummary(transitionArtifacts.nextRequiredArtifacts)}
            compact={compact}
          />
        </div>
      )}
      <details
        key={overrideKey}
        open={hasCardOverride || undefined}
        className={`mt-2.5 border border-slate-200/70 dark:border-slate-700/70 ${compact ? "px-2.5 py-2.5" : "px-3 py-2.5"}`}
      >
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              {t.kanbanDetail.cardSessionOverride}
            </div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {t.kanbanDetail.keepCardSessionOverride}
            </div>
          </div>
          <span className="rounded border border-slate-300 px-3 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-amber-300 hover:text-amber-700 dark:border-slate-600 dark:text-slate-300 dark:hover:border-amber-600 dark:hover:text-amber-200">
            {hasCardOverride ? t.kanbanDetail.editOverride : t.kanbanDetail.overrideCard}
          </span>
        </summary>
        {hasCardOverride && (
          <div className={`mt-2 border-l-2 border-amber-300/80 px-2.5 py-2 text-xs text-amber-800 dark:border-amber-700/70 dark:text-amber-300 ${compact ? "leading-[1.125rem]" : "leading-5"}`}>
            {overrideProviderValue
              ? `${t.kanbanDetail.cardHasExplicitOverride} ${getProviderName(task.assignedProvider, availableProviders)} · ${task.assignedRole ?? "DEVELOPER"} · ${cardSpecialist}`
              : t.kanbanDetail.noCardOverride}
          </div>
        )}
        <div className="mt-3 space-y-2.5">
          <KanbanCardProviderOverrideDropdown
            task={task}
            hasCardOverride={hasCardOverride}
            availableProviders={availableProviders}
            overrideProviderValue={overrideProviderValue}
            compact={compact}
            onPatchTask={onPatchTask}
            onProviderChange={onProviderChange}
          />
          {hasCardOverride && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Select
                value={overrideRoleValue}
                onChange={async (event) => {
                  await onPatchTask(task.id, { assignedRole: event.target.value });
                }}
                className={`w-full border border-slate-200/80 bg-transparent text-sm text-slate-700 outline-none focus:border-amber-400 dark:border-slate-700 dark:bg-transparent dark:text-slate-300 ${compact ? "px-2.5 py-2" : "px-3 py-2"}`}
              >
                {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
              </Select>
              <Select
                value={overrideSpecialistValue}
                onChange={async (event) => {
                  const specialist = findSpecialistById(specialists, event.target.value);
                  await onPatchTask(task.id, {
                    assignedSpecialistId: event.target.value || undefined,
                    assignedSpecialistName: specialist?.name,
                    assignedRole: specialist?.role ?? (hasCardOverride ? task.assignedRole : undefined),
                  });
                }}
                className={`w-full border border-slate-200/80 bg-transparent text-sm text-slate-700 outline-none focus:border-amber-400 dark:border-slate-700 dark:bg-transparent dark:text-slate-300 ${compact ? "px-2.5 py-2" : "px-3 py-2"}`}
              >
                <option value="">{KANBAN_SPECIALIST_LANGUAGE_LABELS[specialistLanguage].noSpecialist}</option>
                {specialists.map((specialist) => <option key={specialist.id} value={specialist.id}>{getSpecialistDisplayName(specialist)}</option>)}
              </Select>
            </div>
          )}
        </div>
      </details>
      {hasCardOverride && (
        <FallbackAgentChainEditor
          task={task}
          specialists={specialists}
          availableProviders={availableProviders}
          specialistLanguage={specialistLanguage}
          compact={compact}
          onPatchTask={onPatchTask}
        />
      )}
      {canRunTask && (usesSelectedProvider || manualRunTarget !== lanePipeline || hasCardOverride) && (
        <div className={`mt-2 border-l-2 border-sky-300/80 px-3 py-2 text-xs text-sky-800 dark:border-sky-700/70 dark:text-sky-200 ${compact ? "leading-[1.125rem]" : "leading-[1.2rem]"}`}>
          Manual {hasRecordedRuns ? "reruns" : "runs"} use {manualRunSourceLabel}:
          {" "}
          {manualRunTarget}
        </div>
      )}
      {failureMessage && (
        <div className={`mt-2 border-l-2 border-rose-300/80 px-3 py-2 text-xs text-rose-800 dark:border-rose-700/70 dark:text-rose-200 ${compact ? "leading-[1.125rem]" : "leading-[1.2rem]"}`}>
          Current run failed on {failedRunLabel}: {failureMessage}
          {" "}
          {effectiveAutomation.transport === "a2a"
            ? "Check the remote agent card URL, auth config, or A2A task status before rerunning."
            : needsLiveRunRecovery
              ? t.kanbanDetail.recoverLiveRunHint
              : "Reset the override or switch providers before rerunning if this looks like a provider authorization or runtime issue."}
        </div>
      )}
      {transitionArtifacts.nextRequiredArtifacts.length > 0 && (
        <div className={`mt-2 border-l-2 border-amber-300/80 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/70 dark:text-amber-300 ${compact ? "leading-[1.125rem]" : "leading-5"}`}>
          Moving this card to {transitionArtifacts.nextColumn?.name ?? "the next stage"} requires {formatArtifactSummary(transitionArtifacts.nextRequiredArtifacts)}.
          {" "}This gate is injected into the ACP prompt, but the agent still needs to create those artifacts before calling <code>move_card</code>.
        </div>
      )}
      <div className={`flex flex-wrap items-center gap-2 ${compact ? "mt-2.5" : "mt-3"}`}>
        {hasCardOverride && (
          <button
            type="button"
            onClick={async () => {
              await onPatchTask(task.id, {
                assignedProvider: undefined,
                assignedRole: undefined,
                assignedSpecialistId: undefined,
                assignedSpecialistName: undefined,
              });
              onProviderChange?.(null);
            }}
            className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-amber-300 hover:text-amber-700 dark:border-slate-600 dark:text-slate-300 dark:hover:border-amber-600 dark:hover:text-amber-200"
          >
            {t.kanbanDetail.resetOverride}
          </button>
        )}
        {canRunTask && (
          <button
            onClick={async () => {
              await onRetryTrigger(task.id);
            }}
            data-testid="kanban-detail-run"
            className={`rounded border border-emerald-500 bg-emerald-500/10 px-4 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-500/20 ${hasCardOverride ? "ml-auto" : ""} ${compact ? "py-2" : "py-2.5"}`}
          >
            {runActionLabel}
          </button>
        )}
      </div>
    </DetailSection>
  );
}

function FallbackAgentChainEditor({
  task,
  specialists,
  availableProviders,
  specialistLanguage,
  compact,
  onPatchTask,
}: {
  task: TaskInfo;
  specialists: SpecialistOption[];
  availableProviders: AcpProviderInfo[];
  specialistLanguage: KanbanSpecialistLanguage;
  compact?: boolean;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
}) {
  const { t } = useTranslation();
  const chain: FallbackAgent[] = (task as TaskInfo & { fallbackAgentChain?: FallbackAgent[] }).fallbackAgentChain ?? [];
  const enableFallback = (task as TaskInfo & { enableAutomaticFallback?: boolean }).enableAutomaticFallback ?? false;

  const addFallbackAgent = async () => {
    const next = [...chain, { providerId: undefined, role: "DEVELOPER", specialistId: undefined }];
    await onPatchTask(task.id, { fallbackAgentChain: next, enableAutomaticFallback: true });
  };

  const removeFallbackAgent = async (index: number) => {
    const next = chain.filter((_, i) => i !== index);
    await onPatchTask(task.id, {
      fallbackAgentChain: next.length > 0 ? next : undefined,
      enableAutomaticFallback: next.length > 0,
    });
  };

  const updateFallbackAgent = async (index: number, patch: Partial<FallbackAgent>) => {
    const next = chain.map((agent, i) => (i === index ? { ...agent, ...patch } : agent));
    await onPatchTask(task.id, { fallbackAgentChain: next });
  };

  const toggleFallback = async () => {
    await onPatchTask(task.id, { enableAutomaticFallback: !enableFallback });
  };

  return (
    <details className={`mt-2 border border-slate-200/70 dark:border-slate-700/70 ${compact ? "px-2.5 py-2.5" : "px-3 py-2.5"}`}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            {t.kanbanDetail.fallbackAgentChain}
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {t.kanbanDetail.fallbackAgentChainHint}
          </div>
        </div>
        <span className="rounded border border-slate-300 px-3 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-amber-300 hover:text-amber-700 dark:border-slate-600 dark:text-slate-300 dark:hover:border-amber-600 dark:hover:text-amber-200">
          {chain.length > 0 ? `${chain.length} ${t.kanbanDetail.fallbackAgentsConfigured}` : t.kanbanDetail.addFallbackAgent}
        </span>
      </summary>
      <div className="mt-2.5 space-y-2">
        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={enableFallback}
            onChange={toggleFallback}
            className="rounded border-slate-300 dark:border-slate-600"
          />
          {t.kanbanDetail.enableAutomaticFallback}
        </label>
        {chain.map((agent, index) => (
          <div key={index} className="flex items-center gap-2 rounded border border-slate-200/60 p-2 dark:border-slate-700/60">
            <span className="shrink-0 text-[10px] font-semibold text-slate-400 dark:text-slate-500">#{index + 1}</span>
            <Select
              value={agent.providerId ?? ""}
              onChange={async (event) => {
                await updateFallbackAgent(index, { providerId: event.target.value || undefined });
              }}
              className="min-w-0 flex-1 border border-slate-200/80 bg-transparent text-xs text-slate-700 outline-none focus:border-amber-400 dark:border-slate-700 dark:bg-transparent dark:text-slate-300 px-2 py-1.5"
            >
              <option value="">{t.kanbanDetail.fallbackProviderDefault}</option>
              {availableProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.name ?? provider.id}</option>
              ))}
            </Select>
            <Select
              value={agent.role ?? "DEVELOPER"}
              onChange={async (event) => {
                await updateFallbackAgent(index, { role: event.target.value });
              }}
              className="min-w-0 flex-1 border border-slate-200/80 bg-transparent text-xs text-slate-700 outline-none focus:border-amber-400 dark:border-slate-700 dark:bg-transparent dark:text-slate-300 px-2 py-1.5"
            >
              {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
            </Select>
            <Select
              value={agent.specialistId ?? ""}
              onChange={async (event) => {
                const specialist = findSpecialistById(specialists, event.target.value);
                await updateFallbackAgent(index, {
                  specialistId: event.target.value || undefined,
                  specialistName: specialist?.name,
                });
              }}
              className="min-w-0 flex-1 border border-slate-200/80 bg-transparent text-xs text-slate-700 outline-none focus:border-amber-400 dark:border-slate-700 dark:bg-transparent dark:text-slate-300 px-2 py-1.5"
            >
              <option value="">{KANBAN_SPECIALIST_LANGUAGE_LABELS[specialistLanguage].noSpecialist}</option>
              {specialists.map((specialist) => (
                <option key={specialist.id} value={specialist.id}>{getSpecialistDisplayName(specialist)}</option>
              ))}
            </Select>
            <button
              type="button"
              onClick={() => removeFallbackAgent(index)}
              className="shrink-0 rounded px-1.5 py-1 text-xs text-rose-500 transition-colors hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-900/30"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addFallbackAgent}
          className="rounded border border-dashed border-slate-300 px-3 py-1.5 text-xs text-slate-500 transition-colors hover:border-amber-300 hover:text-amber-700 dark:border-slate-600 dark:text-slate-400 dark:hover:border-amber-600 dark:hover:text-amber-200"
        >
          + {t.kanbanDetail.addFallbackAgent}
        </button>
      </div>
    </details>
  );
}

function RepositoriesWorktreeRow({
  task,
  codebases,
  allCodebaseIds,
  worktreeCache,
  sessionInfo,
  sessionCwdMismatch,
  updateError,
  setUpdateError,
  onPatchTask,
  onRefresh,
  onRepositoryChange,
  onSelectSession,
  compact = false,
}: {
  task: TaskInfo;
  codebases: CodebaseData[];
  allCodebaseIds: string[];
  worktreeCache: Record<string, WorktreeInfo>;
  sessionInfo?: SessionInfo | null;
  sessionCwdMismatch?: boolean;
  updateError: string | null;
  setUpdateError: (error: string | null) => void;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onRefresh: () => void;
  onRepositoryChange?: (codebaseIds: string[]) => void;
  onSelectSession?: (sessionId: string) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const currentCodebaseIds = task.codebaseIds && task.codebaseIds.length > 0 ? task.codebaseIds : allCodebaseIds;
  const primaryCodebase = codebases.find((codebase) => codebase.id === currentCodebaseIds[0]);
  const worktree = task.worktreeId ? worktreeCache[task.worktreeId] : null;
  const expectedPath = worktree?.worktreePath ?? primaryCodebase?.repoPath ?? null;
  const effectiveBranch = sessionInfo?.branch ?? worktree?.branch ?? primaryCodebase?.branch ?? null;
  const sessionRepoCodebase = sessionInfo ? codebases.find((codebase) => codebase.repoPath === sessionInfo.cwd) : undefined;
  const canAdoptSessionRepo = Boolean(
    sessionCwdMismatch
      && sessionRepoCodebase
      && currentCodebaseIds[0] !== sessionRepoCodebase.id,
  );
  const repoSummary = primaryCodebase
    ? `${primaryCodebase.label ?? primaryCodebase.repoPath.split("/").pop()}${currentCodebaseIds.length > 1 ? ` +${currentCodebaseIds.length - 1}` : ""}`
    : t.kanbanDetail.noRepoLinked;

  return (
    <DetailSection
      title={t.kanbanDetail.repositories}
      description={compact ? undefined : t.kanbanDetail.repositoriesHint}
      compact={compact}
    >
      <details className="group">
        <summary className={`flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden ${compact ? "text-[13px]" : "text-sm"}`}>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{t.kanbanDetail.repo}</div>
          {primaryCodebase ? (
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${primaryCodebase.sourceType === "github" ? "bg-blue-500" : "bg-emerald-500"}`} />
              <span className="truncate text-slate-700 dark:text-slate-300">
                {repoSummary}
              </span>
            </div>
          ) : (
            <span className="min-w-0 flex-1 truncate text-xs text-slate-400 dark:text-slate-500">{repoSummary}</span>
          )}
          {worktree && (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              worktree.status === "active"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                : worktree.status === "creating"
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                  : "bg-rose-100 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300"
            }`}>{effectiveBranch ?? worktree.branch}</span>
          )}
          <span className="ml-auto text-xs text-slate-400 transition-colors group-hover:text-slate-600 dark:group-hover:text-slate-300">
            Edit
          </span>
        </summary>
        <div className={`space-y-3 border-l-2 border-slate-200 dark:border-slate-700 ${compact ? "mt-2.5 pl-2.5" : "mt-3 pl-3"}`}>
          {sessionInfo && (
            <div className={`border-l-2 px-3 py-2 ${sessionCwdMismatch
              ? "border-l-amber-400/80 dark:border-l-amber-600/70"
              : "border-l-emerald-400/80 dark:border-l-emerald-600/70"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                    Repo Health
                  </div>
                  <div className={`mt-1 text-xs ${sessionCwdMismatch ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>
                    {sessionCwdMismatch
                      ? "Active session is running in a different directory than this card."
                      : "Active session matches this card repo."}
                  </div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  sessionCwdMismatch
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                }`}>
                  {sessionCwdMismatch ? "Session mismatch" : "Aligned"}
                </span>
              </div>
              <div className="mt-2 space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                {expectedPath && (
                  <div>
                    Expected: <span className="font-mono">{expectedPath}</span>
                  </div>
                )}
                <div>
                  Active session: <span className="font-mono">{sessionInfo.cwd}</span>
                </div>
                {effectiveBranch && (
                  <div>
                    Active branch: <span className="font-mono">{effectiveBranch}</span>
                    {worktree?.branch && sessionInfo?.branch && worktree.branch !== sessionInfo.branch && (
                      <span className="ml-2 text-amber-600 dark:text-amber-300">
                        worktree stored: {worktree.branch}
                      </span>
                    )}
                  </div>
                )}
              </div>
              {sessionCwdMismatch && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {(sessionInfo?.sessionId ?? task.triggerSessionId) && onSelectSession && (
                    <button
                      type="button"
                      onClick={() => onSelectSession((sessionInfo?.sessionId ?? task.triggerSessionId)!)}
                      className="rounded border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:border-amber-400 hover:text-amber-800"
                    >
                      Open active session
                    </button>
                  )}
                  {canAdoptSessionRepo && sessionRepoCodebase && (
                    <button
                      type="button"
                      onClick={async () => {
                        setUpdateError(null);
                        try {
                          const nextCodebaseIds = [
                            sessionRepoCodebase.id,
                            ...currentCodebaseIds.filter((id) => id !== sessionRepoCodebase.id),
                          ];
                          await onPatchTask(task.id, { codebaseIds: nextCodebaseIds });
                          onRepositoryChange?.(nextCodebaseIds);
                          onRefresh();
                        } catch (error) {
                          setUpdateError(error instanceof Error ? error.message : "Failed to switch to the active session repo");
                        }
                      }}
                      className="rounded border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:border-amber-400 hover:text-amber-800"
                    >
                      Use session repo
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {codebases.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">Edit linked repositories</div>
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
                            ? "border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-600 dark:bg-blue-900/20 dark:text-blue-300"
                            : "border-slate-300 text-slate-600 hover:border-blue-300 dark:border-slate-600 dark:text-slate-400"
                        }`}
                      data-testid="detail-repo-toggle"
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${codebase.sourceType === "github" ? "bg-blue-500" : "bg-emerald-500"}`} />
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
            <div data-testid="worktree-detail" className="truncate font-mono text-xs text-slate-500 dark:text-slate-500" title={worktree.worktreePath}>
              {worktree.worktreePath}
              {worktree.errorMessage && (
                <div className="mt-0.5 text-red-600 dark:text-red-400">{worktree.errorMessage}</div>
              )}
            </div>
          )}
        </div>
      </details>
    </DetailSection>
  );
}
