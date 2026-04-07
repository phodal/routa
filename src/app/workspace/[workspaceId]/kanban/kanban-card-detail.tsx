"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import type { AcpProviderInfo } from "@/client/acp-client";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
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
import { FileRow, formatChangeSummary, STATUS_BADGE } from "./kanban-file-changes-panel";
import type {
  KanbanCommitChangeItem,
  KanbanCommitDiffPreview,
  KanbanFileChangeItem,
  KanbanFileDiffPreview,
  KanbanTaskChanges,
} from "./kanban-file-changes-types";
import { MarkdownViewer } from "@/client/components/markdown/markdown-viewer";
import {
  createKanbanSpecialistResolver,
  getOrderedSessionIds,
  getSpecialistName,
  type KanbanSpecialistOption as SpecialistOption,
} from "./kanban-card-session-utils";
export { KanbanCardActivityBar } from "./kanban-card-activity";
import { KanbanCardArtifacts } from "./kanban-card-artifacts";
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
  onDelete: () => void;
  onRefresh: () => void;
  onProviderChange?: (providerId: string | null) => void;
  onRepositoryChange?: (codebaseIds: string[]) => void;
  onSelectSession?: (sessionId: string) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: (next: boolean) => void;
}

const ROLE_OPTIONS = ["CRAFTER", "ROUTA", "GATE", "DEVELOPER"];
type KanbanDetailTabId = "description" | "readiness" | "execution" | "changes" | "evidence" | "runs";

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
  onDelete,
  onRefresh,
  onProviderChange,
  onRepositoryChange,
  onSelectSession,
  isFullscreen = false,
  onToggleFullscreen,
}: KanbanCardDetailProps) {
  const { t } = useTranslation();
  const [editTitle, setEditTitle] = useState(task.title);
  const [editObjective, setEditObjective] = useState(task.objective ?? "");
  const [editTestCases, setEditTestCases] = useState((task.testCases ?? []).join("\n"));
  const [editPriority, setEditPriority] = useState(task.priority ?? "medium");
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [isTitleEditing, setIsTitleEditing] = useState(false);
  const [isDescriptionEditing, setIsDescriptionEditing] = useState(false);
  const [isTestCasesEditing, setIsTestCasesEditing] = useState(false);
  const [tabSelections, setTabSelections] = useState<Partial<Record<string, KanbanDetailTabId>>>({});
  const [taskChanges, setTaskChanges] = useState<KanbanTaskChanges | null>(null);
  const [taskChangesLoading, setTaskChangesLoading] = useState(false);
  const titleInputRef = useRef<HTMLTextAreaElement | null>(null);
  const testCasesInputRef = useRef<HTMLTextAreaElement | null>(null);
  const displayedTitle = isTitleEditing ? editTitle : task.title;
  const displayedObjective = isDescriptionEditing ? editObjective : (task.objective ?? "");
  const displayedTestCases = isTestCasesEditing ? editTestCases : (task.testCases ?? []).join("\n");
  const displayedPriority = task.priority ?? editPriority;

  const getTaskRepositoryPath = (): string | null => {
    const worktreePath = task.worktreeId ? worktreeCache[task.worktreeId]?.worktreePath : null;
    if (worktreePath) return worktreePath;
    const taskCodebaseIds = task.codebaseIds && task.codebaseIds.length > 0 ? task.codebaseIds : allCodebaseIds;
    if (taskCodebaseIds.length === 0) return null;
    const primaryCodebase = codebases.find((codebase) => codebase.id === taskCodebaseIds[0]);
    return primaryCodebase?.repoPath ?? null;
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
  const storedTab = tabSelections[tabStateKey];
  const activeTab = storedTab === "execution" ? "description" : (storedTab ?? "description");
  const detailTabs = [
    { id: "description" as const, label: t.kanbanDetail.description },
    { id: "readiness" as const, label: t.kanbanDetail.storyReadiness },
    { id: "changes" as const, label: t.kanbanDetail.changes },
    { id: "evidence" as const, label: t.kanbanDetail.evidenceBundle },
    ...(!splitMode ? [{ id: "runs" as const, label: t.kanbanDetail.runs }] : []),
  ];

  useEffect(() => {
    setTaskChanges(null);
    setTaskChangesLoading(false);
  }, [task.id]);

  // Fetch changes when the tab becomes active OR when refreshSignal changes
  useEffect(() => {
    if (activeTab !== "changes") {
      return;
    }

    let cancelled = false;
    setTaskChangesLoading(true);

    void (async () => {
      try {
        const response = await desktopAwareFetch(`/api/tasks/${encodeURIComponent(task.id)}/changes`, {
          cache: "no-store",
        });
        const payload = await response.json() as { changes?: KanbanTaskChanges; error?: string };
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          throw new Error(payload.error ?? t.common.unavailable);
        }
        setTaskChanges(payload.changes ?? null);
      } catch (error) {
        if (!cancelled) {
          setTaskChanges({
            codebaseId: "",
            repoPath: "",
            label: t.kanbanDetail.repo,
            branch: "unknown",
            status: { clean: true, ahead: 0, behind: 0, modified: 0, untracked: 0 },
            files: [],
            source: "repo",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        if (!cancelled) {
          setTaskChangesLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, task.id, refreshSignal, t.common.unavailable, t.kanbanDetail.repo]);

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className={`mx-auto flex min-h-full max-w-6xl flex-col ${compactMode ? "gap-3 p-3" : "gap-4 p-5"}`}>
        <section className={`border-b border-slate-200/80 pb-3 dark:border-[#232736] ${compactMode ? "pt-0.5" : "pt-1"}`}>
          <div className={`flex items-center justify-between gap-3 ${compactMode ? "mb-1.5" : "mb-2"}`}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              {t.kanbanDetail.cardDetail}
            </div>
            <div className="flex items-center gap-1.5">
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
            onFocus={() => {
              setEditTitle(task.title);
              setIsTitleEditing(true);
            }}
            onChange={(event) => setEditTitle(event.target.value)}
            onBlur={async () => {
              setIsTitleEditing(false);
              if (editTitle !== task.title) {
                await onPatchTask(task.id, { title: editTitle });
                onRefresh();
              }
            }}
            rows={isTitleEditing ? 2 : 1}
            className={`w-full resize-none border-0 bg-transparent px-0 py-0 font-semibold leading-tight text-slate-950 outline-none focus:border-transparent focus:ring-0 dark:text-slate-50 ${compactMode ? "text-lg" : "text-xl"}`}
          />
          <div className={`flex flex-wrap items-center ${compactMode ? "mt-2 gap-1.5" : "mt-3 gap-2"}`}>
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
          <div className="flex min-w-0 gap-1 overflow-x-auto pb-1">
            {detailTabs.map((tab) => {
              const active = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setTabSelections((current) => ({ ...current, [tabStateKey]: tab.id }));
                  }}
                  className={`shrink-0 border-b-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                    active
                      ? "border-b-amber-600 text-slate-900 dark:border-b-amber-400 dark:text-slate-100"
                      : "border-b-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                  aria-pressed={active}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className={compactMode ? "space-y-3" : "space-y-4"}>
          {activeTab === "description" && (
            <>
              <section className={compactMode ? "space-y-2 border-b border-slate-200/80 py-2 dark:border-[#232736]" : "space-y-2 border-b border-slate-200/70 py-2.5 dark:border-[#232736]"}>
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
                title={t.kanbanDetail.progressNotes}
                description={compactMode ? undefined : t.kanbanDetail.progressNotesHint}
                compact={compactMode}
              >
                <div className={`border-b border-slate-200/70 py-2 dark:border-slate-700 ${compactMode ? "px-3" : "px-4"}`}>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    {t.kanbanDetail.appendedComments}
                  </div>
                  {task.comment?.trim() ? (
                    <div className={compactMode ? "mt-2 px-3 py-2.5" : "mt-2 px-4 py-2.5"}>
                      <MarkdownViewer
                        content={task.comment}
                        className="prose prose-sm max-w-none text-slate-800 dark:prose-invert dark:text-slate-200"
                      />
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
                <textarea
                  ref={testCasesInputRef}
                  value={displayedTestCases}
                  onFocus={() => {
                    setEditTestCases((task.testCases ?? []).join("\n"));
                    setIsTestCasesEditing(true);
                  }}
                  onChange={(event) => setEditTestCases(event.target.value)}
                  onBlur={async () => {
                    setIsTestCasesEditing(false);
                    const normalizedCurrent = (task.testCases ?? []).join("\n");
                    if (editTestCases !== normalizedCurrent) {
                      await onPatchTask(task.id, {
                        testCases: editTestCases.split("\n").map((item) => item.trim()).filter(Boolean),
                      });
                      onRefresh();
                    }
                  }}
                  rows={compactMode ? 4 : 5}
                  placeholder={t.kanbanDetail.testCasesPlaceholder}
                  className="focus:ring-offset-0 w-full border border-slate-200/80 bg-transparent px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-700 dark:bg-transparent dark:text-slate-100"
                />
              </DetailSection>

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
              <TaskChangesPanel
                taskId={task.id}
                changes={taskChanges}
                loading={taskChangesLoading}
                compact={compactMode}
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

          {activeTab === "runs" && !splitMode && (
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

        <div className={`mt-auto border-t border-slate-200 dark:border-slate-700 ${compactMode ? "pt-3" : "pt-4"}`}>
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

function formatReadinessFieldLabel(field: string, t: ReturnType<typeof useTranslation>["t"]): string {
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
}

function formatCheckStatus(value: boolean, t: ReturnType<typeof useTranslation>["t"]): string {
  return value ? t.kanbanDetail.present : t.kanbanDetail.missing;
}

function formatAnalysisStatus(value: string, t: ReturnType<typeof useTranslation>["t"]): string {
  switch (value) {
    case "pass":
      return t.kanbanDetail.pass;
    case "warning":
      return t.kanbanDetail.warning;
    case "fail":
      return t.kanbanDetail.fail;
    default:
      return value.toUpperCase();
  }
}

function SummaryGridItem({
  label,
  value,
  detail,
  compact = false,
}: {
  label: string;
  value: string;
  detail?: string;
  compact?: boolean;
}) {
  return (
    <div className="space-y-0.5 border-b border-slate-200/70 px-1.5 py-1.5 text-sm dark:border-slate-700/60">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </div>
      <div className="font-medium text-slate-900 dark:text-slate-100">{value}</div>
      {detail && !compact && (
        <div className="text-xs leading-5 text-slate-500 dark:text-slate-400">{detail}</div>
      )}
    </div>
  );
}

function StoryReadinessPanel({
  task,
  compact = false,
}: {
  task: TaskInfo;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const readiness = task.storyReadiness;
  const investValidation = task.investValidation;
  const readinessChecks = readiness?.checks;
  const investChecks = investValidation?.checks;
  const requiredLabels = readiness?.requiredTaskFields.map((field) => formatReadinessFieldLabel(field, t)) ?? [];
  const missingLabels = readiness?.missing.map((field) => formatReadinessFieldLabel(field, t)) ?? [];

  return (
    <div className="space-y-3">
      <div className={`border-l-2 px-3 py-2.5 ${
        readiness?.ready
          ? "border-l-emerald-400/80 dark:border-l-emerald-500/70"
          : "border-l-amber-400/80 dark:border-l-amber-500/70"
      }`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            readiness?.ready
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
              : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
          }`}>
            {readiness?.ready ? t.kanbanDetail.readyForDev : t.kanbanDetail.blockedForDev}
          </span>
          <span className="text-xs text-slate-600 dark:text-slate-300">
            {requiredLabels.length > 0
              ? `${t.kanbanDetail.requiredForNextMove}: ${requiredLabels.join(", ")}`
              : t.kanbanDetail.gateNotConfigured}
          </span>
        </div>
        <div className="mt-2 text-sm text-slate-700 dark:text-slate-200">
          {missingLabels.length > 0
            ? `${t.kanbanDetail.missingFields}: ${missingLabels.join(", ")}`
            : t.kanbanDetail.allRequiredFields}
        </div>
      </div>

      {readinessChecks && (
        <div className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-3"}`}>
          <SummaryGridItem
            label={t.kanbanDetail.scope}
            value={formatCheckStatus(readinessChecks.scope, t)}
            compact={compact}
          />
          <SummaryGridItem
            label={t.kanbanDetail.acceptanceCriteria}
            value={formatCheckStatus(readinessChecks.acceptanceCriteria, t)}
            compact={compact}
          />
          <SummaryGridItem
            label={t.kanbanDetail.verificationCommands}
            value={formatCheckStatus(readinessChecks.verificationCommands, t)}
            compact={compact}
          />
          <SummaryGridItem
            label={t.kanbanDetail.testCases}
            value={formatCheckStatus(readinessChecks.testCases, t)}
            compact={compact}
          />
          <SummaryGridItem
            label={t.kanbanDetail.verificationPlan}
            value={formatCheckStatus(readinessChecks.verificationPlan, t)}
            compact={compact}
          />
          <SummaryGridItem
            label={t.kanbanDetail.dependenciesDeclared}
            value={formatCheckStatus(readinessChecks.dependenciesDeclared, t)}
            compact={compact}
          />
        </div>
      )}

      {investValidation && investChecks && (
        <div className="space-y-2 border-t border-slate-200/70 pt-2 dark:border-slate-700/70">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              {t.kanbanDetail.investSummary}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t.kanbanDetail.source}: {investValidation.source === "canonical_story"
                ? t.kanbanDetail.sourceCanonicalStory
                : t.kanbanDetail.sourceHeuristic}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t.kanbanDetail.overall}: {formatAnalysisStatus(investValidation.overallStatus, t)}
            </span>
          </div>
          <div className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-3"}`}>
            <SummaryGridItem
              label={t.kanbanDetail.investIndependent}
              value={formatAnalysisStatus(investChecks.independent.status, t)}
              detail={investChecks.independent.reason}
              compact={compact}
            />
            <SummaryGridItem
              label={t.kanbanDetail.investNegotiable}
              value={formatAnalysisStatus(investChecks.negotiable.status, t)}
              detail={investChecks.negotiable.reason}
              compact={compact}
            />
            <SummaryGridItem
              label={t.kanbanDetail.investValuable}
              value={formatAnalysisStatus(investChecks.valuable.status, t)}
              detail={investChecks.valuable.reason}
              compact={compact}
            />
            <SummaryGridItem
              label={t.kanbanDetail.investEstimable}
              value={formatAnalysisStatus(investChecks.estimable.status, t)}
              detail={investChecks.estimable.reason}
              compact={compact}
            />
            <SummaryGridItem
              label={t.kanbanDetail.investSmall}
              value={formatAnalysisStatus(investChecks.small.status, t)}
              detail={investChecks.small.reason}
              compact={compact}
            />
            <SummaryGridItem
              label={t.kanbanDetail.investTestable}
              value={formatAnalysisStatus(investChecks.testable.status, t)}
              detail={investChecks.testable.reason}
              compact={compact}
            />
          </div>
          {investValidation.issues.length > 0 && (
            <div className="mt-2 border-t border-amber-200/70 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/50 dark:text-amber-300">
              {investValidation.issues.join(" ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EvidenceBundlePanel({
  task,
  compact = false,
}: {
  task: TaskInfo;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const evidence = task.evidenceSummary;
  if (!evidence) {
    return (
      <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
        {t.kanbanDetail.noEvidenceSummary}
      </div>
    );
  }

  const reviewable = evidence.artifact.requiredSatisfied
    && (evidence.verification.hasReport || evidence.verification.hasVerdict || evidence.completion.hasSummary);
  const missingRequiredArtifacts = evidence.artifact.missingRequired ?? [];
  const missingRequired = missingRequiredArtifacts.length > 0
    ? missingRequiredArtifacts.join(", ")
    : t.kanbanDetail.none;
  const artifactBreakdown = Object.entries(evidence.artifact.byType)
    .map(([type, count]) => `${type}: ${count}`)
    .join(", ") || t.kanbanDetail.none;

  return (
    <div className="space-y-3">
      <div className={`border-l-2 px-3 py-2.5 ${
        reviewable
          ? "border-l-emerald-400/80 dark:border-l-emerald-500/70"
          : "border-l-amber-400/80 dark:border-l-amber-500/70"
      }`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            reviewable
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
              : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
          }`}>
            {reviewable ? t.kanbanDetail.reviewable : t.kanbanDetail.reviewBlocked}
          </span>
          <span className="text-xs text-slate-600 dark:text-slate-300">
            {t.kanbanDetail.requiredArtifacts}: {missingRequired}
          </span>
        </div>
      </div>
      <div className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-4"}`}>
        <SummaryGridItem
          label={t.kanbanDetail.requiredArtifacts}
          value={`${evidence.artifact.total}`}
          detail={artifactBreakdown}
          compact={compact}
        />
        <SummaryGridItem
          label={t.kanbanDetail.verification}
          value={evidence.verification.verdict ?? formatCheckStatus(evidence.verification.hasVerdict, t)}
          detail={evidence.verification.hasReport ? t.kanbanDetail.reportPresent : t.kanbanDetail.reportMissing}
          compact={compact}
        />
        <SummaryGridItem
          label={t.kanbanDetail.completion}
          value={evidence.completion.hasSummary ? t.kanbanDetail.summaryPresent : t.kanbanDetail.summaryMissing}
          compact={compact}
        />
        <SummaryGridItem
          label={t.kanbanDetail.latestRun}
          value={evidence.runs.latestStatus}
          detail={`${t.kanbanDetail.runs}: ${evidence.runs.total}`}
          compact={compact}
        />
      </div>
    </div>
  );
}

function TaskChangesPanel({
  taskId,
  changes,
  loading = false,
  compact = false,
}: {
  taskId: string;
  changes: KanbanTaskChanges | null;
  loading?: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [pinnedFileKey, setPinnedFileKey] = useState<string | null>(null);
  const [pinnedCommitSha, setPinnedCommitSha] = useState<string | null>(null);
  const [diffCache, setDiffCache] = useState<Record<string, KanbanFileDiffPreview>>({});
  const [commitDiffCache, setCommitDiffCache] = useState<Record<string, KanbanCommitDiffPreview>>({});
  const [diffErrors, setDiffErrors] = useState<Record<string, string>>({});
  const [commitDiffErrors, setCommitDiffErrors] = useState<Record<string, string>>({});
  const [loadingFileKey, setLoadingFileKey] = useState<string | null>(null);
  const [loadingCommitSha, setLoadingCommitSha] = useState<string | null>(null);
  const hasCommittedChanges = (changes?.commits?.length ?? 0) > 0;
  const hasLocalFileChanges = (changes?.files.length ?? 0) > 0;

  const fileKey = (file: KanbanFileChangeItem) => `${file.status}:${file.previousPath ?? ""}:${file.path}`;
  const commitKey = (commit: KanbanCommitChangeItem) => commit.sha;
  const activeFile = useMemo(() => {
    const preferredKey = pinnedFileKey;
    if (!changes?.files.length || !preferredKey) return null;
    return changes.files.find((file) => fileKey(file) === preferredKey) ?? null;
  }, [changes?.files, pinnedFileKey]);
  const activeCommit = useMemo(() => {
    const preferredSha = pinnedCommitSha;
    if (!changes?.commits?.length || !preferredSha) return null;
    return changes.commits.find((commit) => commit.sha === preferredSha) ?? null;
  }, [changes?.commits, pinnedCommitSha]);
  const activeFileKey = activeFile ? fileKey(activeFile) : null;
  const activeCommitKey = activeCommit ? commitKey(activeCommit) : null;
  const activeDiff = activeFileKey ? diffCache[activeFileKey] : undefined;
  const activeDiffError = activeFileKey ? diffErrors[activeFileKey] : undefined;
  const activeCommitDiff = activeCommitKey ? commitDiffCache[activeCommitKey] : undefined;
  const activeCommitDiffError = activeCommitKey ? commitDiffErrors[activeCommitKey] : undefined;

  useEffect(() => {
    if (!changes?.files.length) {
      setPinnedFileKey(null);
      return;
    }

    const availableKeys = new Set(changes.files.map((file) => fileKey(file)));
    if (pinnedFileKey && !availableKeys.has(pinnedFileKey)) {
      setPinnedFileKey(null);
    }
  }, [changes?.files, pinnedFileKey]);

  useEffect(() => {
    if (!changes?.commits?.length) {
      setPinnedCommitSha(null);
      return;
    }

    const availableShas = new Set(changes.commits.map((commit) => commit.sha));
    if (pinnedCommitSha && !availableShas.has(pinnedCommitSha)) {
      setPinnedCommitSha(null);
    }
  }, [changes?.commits, pinnedCommitSha]);

  useEffect(() => {
    if (!taskId || !changes || changes.error || !activeFile || !activeFileKey || diffCache[activeFileKey]) {
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      path: activeFile.path,
      status: activeFile.status,
    });
    if (activeFile.previousPath) {
      params.set("previousPath", activeFile.previousPath);
    }

    const loadDiff = async () => {
      setLoadingFileKey(activeFileKey);
      setDiffErrors((current) => {
        if (!(activeFileKey in current)) return current;
        const next = { ...current };
        delete next[activeFileKey];
        return next;
      });

      try {
        const response = await desktopAwareFetch(
          `/api/tasks/${encodeURIComponent(taskId)}/changes/file?${params.toString()}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!response.ok) {
          throw new Error(data.error ?? t.kanbanDetail.failedToLoadFileDiff);
        }

        const diff = (data.diff ?? {
          path: activeFile.path,
          previousPath: activeFile.previousPath,
          status: activeFile.status,
          patch: "",
        }) as KanbanFileDiffPreview;
        setDiffCache((current) => ({ ...current, [activeFileKey]: diff }));
      } catch (error) {
        if (controller.signal.aborted) return;
        setDiffErrors((current) => ({
          ...current,
          [activeFileKey]: error instanceof Error ? error.message : t.kanbanDetail.failedToLoadFileDiff,
        }));
      } finally {
        if (!controller.signal.aborted) {
          setLoadingFileKey((current) => (current === activeFileKey ? null : current));
        }
      }
    };

    void loadDiff();
    return () => controller.abort();
  }, [activeFile, activeFileKey, changes, diffCache, t.kanbanDetail.failedToLoadFileDiff, taskId]);

  useEffect(() => {
    if (!taskId || !changes || changes.error || !activeCommit || !activeCommitKey || commitDiffCache[activeCommitKey]) {
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ sha: activeCommit.sha });

    const loadDiff = async () => {
      setLoadingCommitSha(activeCommitKey);
      setCommitDiffErrors((current) => {
        if (!(activeCommitKey in current)) return current;
        const next = { ...current };
        delete next[activeCommitKey];
        return next;
      });

      try {
        const response = await desktopAwareFetch(
          `/api/tasks/${encodeURIComponent(taskId)}/changes/commit?${params.toString()}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!response.ok) {
          throw new Error(data.error ?? t.kanbanDetail.failedToLoadCommitDiff);
        }

        const diff = (data.diff ?? {
          ...activeCommit,
          patch: "",
        }) as KanbanCommitDiffPreview;
        setCommitDiffCache((current) => ({ ...current, [activeCommitKey]: diff }));
      } catch (error) {
        if (controller.signal.aborted) return;
        setCommitDiffErrors((current) => ({
          ...current,
          [activeCommitKey]: error instanceof Error ? error.message : t.kanbanDetail.failedToLoadCommitDiff,
        }));
      } finally {
        if (!controller.signal.aborted) {
          setLoadingCommitSha((current) => (current === activeCommitKey ? null : current));
        }
      }
    };

    void loadDiff();
    return () => controller.abort();
  }, [activeCommit, activeCommitKey, changes, commitDiffCache, taskId, t.kanbanDetail.failedToLoadCommitDiff]);

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

  const sourceLabel = changes.source === "worktree" ? t.kanbanDetail.worktreeSource : t.kanbanDetail.repoSource;
  const stateLabel = changes.error
    ? t.common.unavailable
    : changes.status.clean
      ? t.kanbanDetail.clean
      : t.kanbanDetail.dirty;
  const scopePath = changes.worktreePath ?? changes.repoPath;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            {changes.label}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-700">
              {sourceLabel}
            </span>
            <span className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-700">
              @{changes.branch}
            </span>
            <span>{formatChangeSummary(changes, t.kanban)}</span>
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
          changes.error
            ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
            : changes.status.clean
              ? "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
        }`}>
          {stateLabel}
        </span>
      </div>

      {scopePath && (
        <InlineSummary
          label={sourceLabel}
          value={scopePath}
          compact={compact}
        />
      )}

      {changes.error ? (
        <div className="border-l-2 border-rose-400/80 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/70 dark:text-rose-300">
          {changes.error}
        </div>
      ) : hasCommittedChanges || hasLocalFileChanges ? (
        <div className="space-y-3">
          {hasCommittedChanges && (
            <div className="space-y-3">
              <div className="px-1">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                  {t.kanbanDetail.committedChanges}
                </div>
                {changes.baseRef && (
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {t.kanbanDetail.baseComparison.replace("{baseRef}", changes.baseRef)}
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-1 dark:border-[#202433] dark:bg-[#0d1018]">
                <div className="space-y-0.5">
                  {changes.commits?.map((commit) => (
                    <CommitRow
                      key={`${changes.codebaseId}-${commit.sha}`}
                      commit={commit}
                      selected={commit.sha === activeCommitKey}
                      onClick={() => setPinnedCommitSha(commit.sha)}
                    />
                  ))}
                </div>
              </div>
              <TaskCommitDiffPreview
                commit={activeCommit}
                diff={activeCommitDiff}
                loading={loadingCommitSha === activeCommitKey && !activeCommitDiff}
                error={activeCommitDiffError}
                compact={compact}
              />
            </div>
          )}

          {hasLocalFileChanges && (
            <div className="space-y-3">
              <div className="px-1">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                  {t.kanbanDetail.localChanges}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-1 dark:border-[#202433] dark:bg-[#0d1018]">
                <div className="space-y-0.5">
                  {changes.files.map((file) => {
                    const key = fileKey(file);
                    return (
                      <FileRow
                        key={`${changes.codebaseId}-${key}`}
                        file={file}
                        selected={key === activeFileKey}
                        onClick={() => setPinnedFileKey(key)}
                      />
                    );
                  })}
                </div>
              </div>
              <TaskFileDiffPreview
                file={activeFile}
                diff={activeDiff}
                loading={loadingFileKey === activeFileKey && !activeDiff}
                error={activeDiffError}
                compact={compact}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
          {changes.repoPath ? t.kanbanDetail.noChanges : t.kanbanDetail.noRepoChanges}
        </div>
      )}
    </div>
  );
}

interface ParsedDiffPreview {
  additions: number;
  deletions: number;
  lines: Array<{
    kind: "meta" | "hunk" | "add" | "remove" | "context";
    text: string;
    oldLineNumber?: number;
    newLineNumber?: number;
  }>;
}

function parseUnifiedDiffPreview(diff: { patch: string; additions?: number; deletions?: number }): ParsedDiffPreview {
  const lines = diff.patch.split("\n");
  let additions = diff.additions ?? 0;
  let deletions = diff.deletions ?? 0;
  let oldLineNumber = 0;
  let newLineNumber = 0;
  let countedBodyLines = false;

  const parsedLines = lines.map((line) => {
    if (line.startsWith("+++ b/")) return { kind: "meta" as const, text: line };
    if (line.startsWith("+") && !line.startsWith("+++")) {
      if (diff.additions == null) additions += 1;
      countedBodyLines = true;
      const parsedLine = { kind: "add" as const, text: line, newLineNumber };
      newLineNumber += 1;
      return parsedLine;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      if (diff.deletions == null) deletions += 1;
      countedBodyLines = true;
      const parsedLine = { kind: "remove" as const, text: line, oldLineNumber };
      oldLineNumber += 1;
      return parsedLine;
    }
    if (line.startsWith("@@")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match) {
        oldLineNumber = Number.parseInt(match[1] ?? "0", 10);
        newLineNumber = Number.parseInt(match[2] ?? "0", 10);
      }
      return { kind: "hunk" as const, text: line };
    }
    if (
      line.startsWith("diff --git ")
      || line.startsWith("index ")
      || line.startsWith("--- ")
      || line.startsWith("new file mode ")
      || line.startsWith("deleted file mode ")
      || line.startsWith("similarity index ")
      || line.startsWith("rename from ")
      || line.startsWith("rename to ")
    ) {
      return { kind: "meta" as const, text: line };
    }
    if (line.startsWith(" ")) {
      countedBodyLines = true;
      const parsedLine = { kind: "context" as const, text: line, oldLineNumber, newLineNumber };
      oldLineNumber += 1;
      newLineNumber += 1;
      return parsedLine;
    }
    return { kind: "context" as const, text: line };
  });

  return {
    additions: countedBodyLines ? additions : diff.additions ?? additions,
    deletions: countedBodyLines ? deletions : diff.deletions ?? deletions,
    lines: parsedLines,
  };
}

function renderUnifiedDiffLines(parsedDiff: ParsedDiffPreview) {
  return parsedDiff.lines.map((line, index) => (
    <div
      key={`${line.text}-${index}`}
      className={
        line.kind === "add"
          ? "grid grid-cols-[3rem_3rem_1.5rem_minmax(0,1fr)] bg-emerald-950/70 px-3 text-emerald-100"
          : line.kind === "remove"
            ? "grid grid-cols-[3rem_3rem_1.5rem_minmax(0,1fr)] bg-rose-950/60 px-3 text-rose-100"
            : line.kind === "hunk"
              ? "bg-sky-950/60 px-3 text-sky-100"
              : line.kind === "meta"
                ? "bg-slate-900 px-3 text-slate-400"
                : "grid grid-cols-[3rem_3rem_1.5rem_minmax(0,1fr)] px-3 text-slate-200"
      }
    >
      {line.kind === "add" || line.kind === "remove" || line.kind === "context" ? (
        <>
          <span className="select-none pr-2 text-right text-slate-500">
            {typeof line.oldLineNumber === "number" ? (
              <span data-testid={`kanban-diff-old-line-${index}`}>{line.oldLineNumber}</span>
            ) : ""}
          </span>
          <span className="select-none pr-2 text-right text-slate-500">
            {typeof line.newLineNumber === "number" ? (
              <span data-testid={`kanban-diff-new-line-${index}`}>{line.newLineNumber}</span>
            ) : ""}
          </span>
          <span className="select-none text-center">
            {line.text[0] ?? " "}
          </span>
          <span>{line.text.slice(1) || " "}</span>
        </>
      ) : (
        line.text || " "
      )}
    </div>
  ));
}

function TaskFileDiffPreview({
  file,
  diff,
  loading,
  error,
  compact = false,
}: {
  file: KanbanFileChangeItem | null;
  diff?: KanbanFileDiffPreview;
  loading: boolean;
  error?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();

  if (!file) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200/80 px-3 py-4 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
        {t.kanbanDetail.clickFileToInspectDiff}
      </div>
    );
  }

  const badge = STATUS_BADGE[file.status];
  const parsedDiff = diff ? parseUnifiedDiffPreview(diff) : null;
  const previewPath = diff?.path ?? file.path;
  const lastSlash = previewPath.lastIndexOf("/");
  const fileName = lastSlash === -1 ? previewPath : previewPath.slice(lastSlash + 1);
  const fileDirectory = lastSlash === -1 ? null : previewPath.slice(0, lastSlash);
  const additions = parsedDiff?.additions ?? diff?.additions ?? file.additions ?? 0;
  const deletions = parsedDiff?.deletions ?? diff?.deletions ?? file.deletions ?? 0;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white dark:border-[#202433] dark:bg-[#0d1018]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 px-3 py-2 dark:border-[#202433]">
        <div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
          <span className={`inline-flex rounded-sm px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${badge.className}`}>
            {badge.short}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100" title={fileName}>
              {fileName}
            </div>
            {fileDirectory && (
              <div className="truncate text-[11px] text-slate-500 dark:text-slate-400" title={fileDirectory}>
                {fileDirectory}
              </div>
            )}
          </div>
          {file.previousPath && (
            <>
              <span />
              <div className="truncate text-[11px] text-slate-500 dark:text-slate-400" title={file.previousPath}>
                {t.kanban.fromPath} {file.previousPath}
              </div>
            </>
          )}
        </div>
        <div className="shrink-0 text-[11px] font-mono">
          <span className="text-emerald-600 dark:text-emerald-300">+{additions}</span>
          {" "}
          <span className="text-rose-600 dark:text-rose-300">-{deletions}</span>
        </div>
      </div>

      {loading ? (
        <div className={`px-3 py-3 text-sm text-slate-500 dark:text-slate-400 ${compact ? "leading-5" : "leading-6"}`}>
          {t.kanbanDetail.loadingFileDiff}
        </div>
      ) : error ? (
        <div className={`border-l-2 border-rose-400/80 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/70 dark:text-rose-300 ${compact ? "leading-5" : "leading-6"}`}>
          {error}
        </div>
      ) : !diff?.patch.trim() || !parsedDiff ? (
        <div className={`px-3 py-3 text-sm text-slate-500 dark:text-slate-400 ${compact ? "leading-5" : "leading-6"}`}>
          {t.kanbanDetail.noDiffAvailable}
        </div>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <pre className="min-w-full bg-slate-950/95 px-0 py-0 text-[11px] leading-5 text-slate-100">
            {renderUnifiedDiffLines(parsedDiff)}
          </pre>
        </div>
      )}
    </div>
  );
}

function CommitRow({
  commit,
  selected = false,
  onClick,
}: {
  commit: KanbanCommitChangeItem;
  selected?: boolean;
  onClick?: () => void;
}) {
  const timestamp = new Date(commit.authoredAt);
  const renderedTimestamp = Number.isNaN(timestamp.getTime()) ? commit.authoredAt : timestamp.toLocaleString();
  return (
    <button
      type="button"
      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 rounded-md px-2 py-1.5 text-left transition-colors ${
        selected ? "bg-amber-50/80 dark:bg-amber-900/10" : "hover:bg-slate-100/80 dark:hover:bg-[#171b27]"
      }`}
      onClick={onClick}
      aria-pressed={selected}
      data-testid={`kanban-commit-row-${commit.sha}`}
    >
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium leading-4 text-slate-800 dark:text-slate-100" title={commit.summary}>
          {commit.summary}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[9px] leading-3.5 text-slate-500 dark:text-slate-400">
          <span className="rounded-sm border border-slate-200 px-1 py-0 dark:border-slate-700">{commit.shortSha}</span>
          <span>{commit.authorName}</span>
          <span>{renderedTimestamp}</span>
        </div>
      </div>
      <div className="mt-0.5 flex min-w-[3.25rem] shrink-0 items-center justify-end gap-1 self-start text-[10px] font-mono leading-4">
        <span className="text-emerald-600 dark:text-emerald-300">+{commit.additions}</span>
        <span className="text-rose-600 dark:text-rose-300">-{commit.deletions}</span>
      </div>
    </button>
  );
}

function TaskCommitDiffPreview({
  commit,
  diff,
  loading,
  error,
  compact = false,
}: {
  commit: KanbanCommitChangeItem | null;
  diff?: KanbanCommitDiffPreview;
  loading: boolean;
  error?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();

  if (!commit) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200/80 px-3 py-4 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
        {t.kanbanDetail.clickCommitToInspectDiff}
      </div>
    );
  }

  const preview = diff ?? { ...commit, patch: "" };
  const parsedDiff = preview.patch ? parseUnifiedDiffPreview(preview) : null;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white dark:border-[#202433] dark:bg-[#0d1018]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 px-3 py-2 dark:border-[#202433]">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100" title={preview.summary}>
            {preview.summary}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-700">{preview.shortSha}</span>
            <span>{preview.authorName}</span>
            <span>{new Date(preview.authoredAt).toLocaleString()}</span>
          </div>
        </div>
        <div className="shrink-0 text-[11px] font-mono">
          <span className="text-emerald-600 dark:text-emerald-300">+{preview.additions}</span>
          {" "}
          <span className="text-rose-600 dark:text-rose-300">-{preview.deletions}</span>
        </div>
      </div>

      {loading ? (
        <div className={`px-3 py-3 text-sm text-slate-500 dark:text-slate-400 ${compact ? "leading-5" : "leading-6"}`}>
          {t.kanbanDetail.loadingCommitDiff}
        </div>
      ) : error ? (
        <div className={`border-l-2 border-rose-400/80 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/70 dark:text-rose-300 ${compact ? "leading-5" : "leading-6"}`}>
          {error}
        </div>
      ) : !parsedDiff ? (
        <div className={`px-3 py-3 text-sm text-slate-500 dark:text-slate-400 ${compact ? "leading-5" : "leading-6"}`}>
          {t.kanbanDetail.noDiffAvailable}
        </div>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <pre className="min-w-full bg-slate-950/95 px-0 py-0 text-[11px] leading-5 text-slate-100">
            {renderUnifiedDiffLines(parsedDiff)}
          </pre>
        </div>
      )}
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
    <section className={compact ? "space-y-2 border-b border-slate-200/80 py-2 dark:border-[#232736]" : "space-y-2 border-b border-slate-200/70 py-2.5 dark:border-[#232736]"}>
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
        <InlineSummary
          label={t.kanbanDetail.currentRun}
          value={effectiveRunTarget}
          compact={compact}
        />
      </div>
      {canRunTask && !hasRecordedRuns && (
        <div className={`mt-2 border-l-2 border-sky-300/70 px-3 py-2 text-xs text-sky-800 dark:border-sky-700/70 dark:text-sky-200 ${compact ? "leading-[1.125rem]" : "leading-5"}`}>
          {sessionCopy.emptyPaneDescription}
          {" "}
          {sessionCopy.emptyPaneHint}
          {" "}
          {sessionCopy.expectedTarget(effectiveRunTarget)}
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
          <Select
            value={overrideProviderValue}
            onChange={async (event) => {
              const newProvider = event.target.value || null;
              if (newProvider) {
                await onPatchTask(task.id, {
                  assignedProvider: newProvider,
                  assignedRole: hasCardOverride ? task.assignedRole ?? "DEVELOPER" : "DEVELOPER",
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
            className={`w-full border border-slate-200/80 bg-transparent text-sm text-slate-700 outline-none focus:border-amber-400 dark:border-slate-700 dark:bg-transparent dark:text-slate-300 ${compact ? "px-2.5 py-2" : "px-3 py-2"}`}
          >
            <option value="">{t.kanban.useLaneDefault}</option>
            {availableProviders.map((provider) => (
              <option key={`${provider.id}-${provider.name}`} value={provider.id}>{provider.name}</option>
            ))}
          </Select>
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
      {canRunTask && (
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
