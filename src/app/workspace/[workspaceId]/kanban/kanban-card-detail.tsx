"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
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
import { parseCanonicalStory } from "@/core/kanban/canonical-story";
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

function formatAutomationStepSummary(
  step: KanbanAutomationStep,
  availableProviders: AcpProviderInfo[],
  specialists: SpecialistOption[],
): string {
  const resolvedStep = resolveKanbanAutomationStep(step, createKanbanSpecialistResolver(specialists)) ?? step;
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
  onPatchTask,
  onRetryTrigger,
  onDelete,
  onRefresh,
  onProviderChange,
  onRepositoryChange,
  onSelectSession,
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
  const canonicalStory = useMemo(() => parseCanonicalStory(task.objective ?? ""), [task.objective]);
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

  return (
    <div className="h-full w-full overflow-y-auto bg-slate-50/80 dark:bg-[#10131a]">
      <div className={`mx-auto flex min-h-full max-w-6xl flex-col ${compactMode ? "gap-3 p-3" : "gap-4 p-5"}`}>
        <section className={`border border-slate-200/80 bg-white shadow-sm dark:border-[#232736] dark:bg-[#121620] ${compactMode ? "rounded-2xl p-3" : "rounded-3xl p-4"}`}>
          <div className={`flex items-center justify-between gap-3 ${compactMode ? "mb-1.5" : "mb-2"}`}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              Card Detail
            </div>
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-300 dark:hover:border-amber-700 dark:hover:bg-amber-900/20 dark:hover:text-amber-200"
            >
              Refresh
            </button>
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
            rows={compactMode ? 3 : 2}
            className={`w-full resize-none rounded-2xl border border-transparent bg-transparent px-0 py-0 font-semibold leading-tight text-slate-950 outline-none focus:border-transparent focus:ring-0 dark:text-slate-50 ${compactMode ? "text-lg" : "text-xl"}`}
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

        <div className={compactMode ? "space-y-3" : "space-y-4"}>
          <DetailSection
            title="Description"
            description={compactMode ? undefined : "Capture the context, constraints, and acceptance notes for this card."}
            compact={compactMode}
          >
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
          </DetailSection>

          {canonicalStory.hasYamlBlock && (
            <DetailSection
              title={t.kanbanDetail.structuredStory}
              description={compactMode ? undefined : t.kanbanDetail.structuredStoryHint}
              compact={compactMode}
            >
              <CanonicalStoryPanel parseResult={canonicalStory} compact={compactMode} />
            </DetailSection>
          )}

          <DetailSection
            title={t.kanbanDetail.storyReadiness}
            description={compactMode ? undefined : t.kanbanDetail.storyReadinessHint}
            compact={compactMode}
          >
            <StoryReadinessPanel task={task} compact={compactMode} />
          </DetailSection>

          <DetailSection
            title="Progress Notes"
            description={compactMode ? undefined : "Read-only notes appended by downstream stages after the story description is frozen."}
            compact={compactMode}
          >
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-[#0d1018]">
              <div className={`border-b border-slate-200/70 dark:border-slate-700 ${compactMode ? "px-3 py-2" : "px-4 py-2.5"}`}>
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Appended comments
                </div>
              </div>
              {task.comment?.trim() ? (
                <div className={compactMode ? "px-3 py-2.5" : "px-4 py-3"}>
                  <MarkdownViewer
                    content={task.comment}
                    className="prose prose-sm max-w-none text-slate-800 dark:prose-invert dark:text-slate-200"
                  />
                </div>
              ) : (
                <div className={`text-sm text-slate-500 dark:text-slate-400 ${compactMode ? "px-3 py-2.5" : "px-4 py-3"}`}>
                  No progress notes yet.
                </div>
              )}
            </div>
          </DetailSection>

          <DetailSection
            title="Test Cases"
            description={compactMode ? undefined : "Keep one human-readable test scenario per line."}
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
              placeholder={"One test case per line\nExample: User can reopen the session from the run history"}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-700 dark:bg-[#0f141d] dark:text-slate-100"
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
            onPatchTask={onPatchTask}
            onRetryTrigger={onRetryTrigger}
            onProviderChange={onProviderChange}
            compact={compactMode}
          />

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

          {!splitMode && (
            <KanbanCardActivityPanel
              task={task}
              refreshSignal={refreshSignal}
              sessions={sessions ?? []}
              specialists={specialists}
              specialistLanguage={specialistLanguage}
              currentSessionId={activeRunSessionId}
              onSelectSession={onSelectSession}
              compact={compactMode}
            />
          )}

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

function CanonicalStoryPanel({
  parseResult,
  compact = false,
}: {
  parseResult: ReturnType<typeof parseCanonicalStory>;
  compact?: boolean;
}) {
  if (parseResult.story == null) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-3 dark:border-rose-900/40 dark:bg-rose-900/10">
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-900/40 dark:text-rose-200">
            Invalid YAML
          </span>
          <span className="text-xs text-rose-700 dark:text-rose-200">Todo should reject this card back to backlog.</span>
        </div>
        <ul className="space-y-1 text-sm text-rose-800 dark:text-rose-100">
          {parseResult.issues.map((issue) => (
            <li key={issue}>- {issue}</li>
          ))}
        </ul>
      </div>
    );
  }

  const { story } = parseResult.story;
  const investItems = [
    ["Independent", story.invest.independent.status],
    ["Negotiable", story.invest.negotiable.status],
    ["Valuable", story.invest.valuable.status],
    ["Estimable", story.invest.estimable.status],
    ["Small", story.invest.small.status],
    ["Testable", story.invest.testable.status],
  ] as const;

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900/40 dark:bg-emerald-900/10">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
          Valid YAML
        </span>
        <span className="text-xs text-slate-600 dark:text-slate-300">v{story.version}</span>
        <span className="text-xs text-slate-600 dark:text-slate-300">AC {story.acceptance_criteria.length}</span>
        <span className="text-xs text-slate-600 dark:text-slate-300">
          Independent {story.dependencies_and_sequencing.independent_story_check.toUpperCase()}
        </span>
      </div>
      <div className={`mt-3 grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-3"}`}>
        {investItems.map(([label, status]) => (
          <div
            key={label}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#0f141d]"
          >
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {label}
            </div>
            <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">{status.toUpperCase()}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-200">
        <div>
          <span className="font-medium">User value:</span> {story.user_value}
        </div>
        <div>
          <span className="font-medium">Affected areas:</span> {story.constraints_and_affected_areas.join(", ")}
        </div>
        <div>
          <span className="font-medium">Depends on:</span> {story.dependencies_and_sequencing.depends_on.join(", ")}
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
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#0f141d]">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </div>
      <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">{value}</div>
      {detail && (
        <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{detail}</div>
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
      <div className={`rounded-2xl border px-3 py-3 ${
        readiness?.ready
          ? "border-emerald-200 bg-emerald-50/80 dark:border-emerald-900/40 dark:bg-emerald-900/10"
          : "border-amber-200 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-900/10"
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
          <SummaryGridItem label={t.kanbanDetail.scope} value={formatCheckStatus(readinessChecks.scope, t)} />
          <SummaryGridItem
            label={t.kanbanDetail.acceptanceCriteria}
            value={formatCheckStatus(readinessChecks.acceptanceCriteria, t)}
          />
          <SummaryGridItem
            label={t.kanbanDetail.verificationCommands}
            value={formatCheckStatus(readinessChecks.verificationCommands, t)}
          />
          <SummaryGridItem label={t.kanbanDetail.testCases} value={formatCheckStatus(readinessChecks.testCases, t)} />
          <SummaryGridItem
            label={t.kanbanDetail.verificationPlan}
            value={formatCheckStatus(readinessChecks.verificationPlan, t)}
          />
          <SummaryGridItem
            label={t.kanbanDetail.dependenciesDeclared}
            value={formatCheckStatus(readinessChecks.dependenciesDeclared, t)}
          />
        </div>
      )}

      {investValidation && investChecks && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-[#0d1018]">
          <div className="mb-2 flex flex-wrap items-center gap-2">
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
              label="Independent"
              value={formatAnalysisStatus(investChecks.independent.status, t)}
              detail={investChecks.independent.reason}
            />
            <SummaryGridItem
              label="Negotiable"
              value={formatAnalysisStatus(investChecks.negotiable.status, t)}
              detail={investChecks.negotiable.reason}
            />
            <SummaryGridItem
              label="Valuable"
              value={formatAnalysisStatus(investChecks.valuable.status, t)}
              detail={investChecks.valuable.reason}
            />
            <SummaryGridItem
              label="Estimable"
              value={formatAnalysisStatus(investChecks.estimable.status, t)}
              detail={investChecks.estimable.reason}
            />
            <SummaryGridItem
              label="Small"
              value={formatAnalysisStatus(investChecks.small.status, t)}
              detail={investChecks.small.reason}
            />
            <SummaryGridItem
              label="Testable"
              value={formatAnalysisStatus(investChecks.testable.status, t)}
              detail={investChecks.testable.reason}
            />
          </div>
          {investValidation.issues.length > 0 && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-300">
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
      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-400">
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
      <div className={`rounded-2xl border px-3 py-3 ${
        reviewable
          ? "border-emerald-200 bg-emerald-50/80 dark:border-emerald-900/40 dark:bg-emerald-900/10"
          : "border-amber-200 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-900/10"
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
        />
        <SummaryGridItem
          label={t.kanbanDetail.verification}
          value={evidence.verification.verdict ?? formatCheckStatus(evidence.verification.hasVerdict, t)}
          detail={evidence.verification.hasReport ? t.kanbanDetail.reportPresent : t.kanbanDetail.reportMissing}
        />
        <SummaryGridItem
          label={t.kanbanDetail.completion}
          value={evidence.completion.hasSummary ? t.kanbanDetail.summaryPresent : t.kanbanDetail.summaryMissing}
        />
        <SummaryGridItem
          label={t.kanbanDetail.latestRun}
          value={evidence.runs.latestStatus}
          detail={`${t.kanbanDetail.runs}: ${evidence.runs.total}`}
        />
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
    <section className={`border border-slate-200/80 bg-white shadow-sm dark:border-[#232736] dark:bg-[#121620] ${compact ? "rounded-2xl p-3" : "rounded-3xl p-4"}`}>
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
    <div className={`flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-[#0d1018] ${compact ? "px-2.5 py-2" : "px-3 py-2.5"}`}>
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
  const effectiveAutomation = resolveEffectiveTaskAutomation(task, boardColumns, resolveSpecialist);
  const canRunTask = effectiveAutomation.canRun && task.columnId !== "done";
  const hasCardOverride = Boolean(task.assignedProvider || task.assignedRole || task.assignedSpecialistId || task.assignedSpecialistName);
  const laneName = lane?.name ?? task.columnId ?? "backlog";
  const laneSteps = lane?.automation ? getKanbanAutomationSteps(lane.automation) : [];
  const cardSpecialist = getSpecialistName(task.assignedSpecialistId, task.assignedSpecialistName, specialists);
  const effectiveRunTarget = formatEffectiveAutomationTarget(effectiveAutomation, availableProviders, specialists);
  const failureMessage = getPromptFailureMessage(task, sessionInfo);
  const activeRunSessionId = task.triggerSessionId
    ?? (task.laneSessions && task.laneSessions.length > 0 ? task.laneSessions[task.laneSessions.length - 1]?.sessionId : undefined);
  const activeLaneSession = activeRunSessionId
    ? task.laneSessions?.find((entry) => entry.sessionId === activeRunSessionId)
    : undefined;
  const failedRunLabel = activeLaneSession?.transport === "a2a" || effectiveAutomation.transport === "a2a"
    ? "current A2A run"
    : getProviderName(
      sessionInfo?.provider ?? task.assignedProvider ?? effectiveAutomation.providerId,
      availableProviders,
    );
  const lanePipeline = laneSteps.length > 0
    ? laneSteps.map((step) => formatAutomationStepSummary(step, availableProviders, specialists)).join(" -> ")
    : "No lane automation configured";
  const hasRecordedRuns = getOrderedSessionIds(task).length > 0;
  const transitionArtifacts = resolveKanbanTransitionArtifacts(boardColumns, task.columnId);
  const overrideKey = `${task.id}:${task.assignedProvider ?? ""}:${task.assignedRole ?? ""}:${task.assignedSpecialistId ?? ""}:${task.assignedSpecialistName ?? ""}`;

  return (
    <DetailSection
      title="Execution"
      description={compact ? undefined : "Lane defaults and the effective run target."}
      compact={compact}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{laneName}</div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {lane ? "Inherited from the current lane." : "Lane metadata unavailable, using task-level defaults."}
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${lane?.automation?.enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"}`}>
          {lane?.automation?.enabled ? "Automation on" : "Manual"}
        </span>
      </div>
      <div className="mt-2.5 space-y-1.5">
        <InlineSummary
          label="Lane pipeline"
          value={lanePipeline}
          compact={compact}
        />
        <InlineSummary
          label="Current run"
          value={effectiveRunTarget}
          compact={compact}
        />
      </div>
      {canRunTask && !hasRecordedRuns && (
        <div className={`mt-2 rounded-2xl border border-dashed border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-800/50 dark:bg-sky-900/10 dark:text-sky-200 ${compact ? "leading-[1.125rem]" : "leading-5"}`}>
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
        className={`mt-2.5 rounded-2xl border border-slate-200/80 bg-slate-50/80 dark:border-slate-700 dark:bg-[#0d1018] ${compact ? "px-2.5 py-2.5" : "px-3 py-2.5"}`}
      >
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Card Session Override
            </div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Keep collapsed to inherit the lane default.
            </div>
          </div>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-amber-300 hover:text-amber-700 dark:border-slate-700 dark:bg-[#121620] dark:text-slate-300 dark:hover:border-amber-600 dark:hover:text-amber-200">
            {hasCardOverride ? "Edit override" : "Override this card"}
          </span>
        </summary>
        {hasCardOverride && (
          <div className={`rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-300 ${compact ? "mt-2 leading-[1.125rem]" : "mt-3 leading-5"}`}>
            This card currently carries an explicit override: {getProviderName(task.assignedProvider, availableProviders)} · {task.assignedRole ?? "DEVELOPER"} · {cardSpecialist}
          </div>
        )}
        <div className="mt-3 space-y-2.5">
          <Select
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
            className={`w-full rounded-2xl border border-slate-200 bg-white text-sm text-slate-700 outline-none focus:border-amber-400 dark:border-slate-700 dark:bg-[#121620] dark:text-slate-300 ${compact ? "px-2.5 py-2" : "px-3 py-2"}`}
          >
            <option value="">{t.kanban.useLaneDefault}</option>
            {availableProviders.map((provider) => (
              <option key={`${provider.id}-${provider.name}`} value={provider.id}>{provider.name}</option>
            ))}
          </Select>
          {task.assignedProvider && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Select
                value={task.assignedRole ?? "DEVELOPER"}
                onChange={async (event) => {
                  await onPatchTask(task.id, { assignedRole: event.target.value });
                }}
                className={`rounded-2xl border border-slate-200 bg-white text-sm text-slate-700 outline-none focus:border-amber-400 dark:border-slate-700 dark:bg-[#121620] dark:text-slate-300 ${compact ? "px-2.5 py-2" : "px-3 py-2"}`}
              >
                {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
              </Select>
              <Select
                value={getLanguageSpecificSpecialistId(task.assignedSpecialistId, specialistLanguage) ?? ""}
                onChange={async (event) => {
                  const specialist = findSpecialistById(specialists, event.target.value);
                  await onPatchTask(task.id, {
                    assignedSpecialistId: event.target.value || undefined,
                    assignedSpecialistName: specialist?.name,
                    assignedRole: specialist?.role ?? task.assignedRole,
                  });
                }}
                className={`rounded-2xl border border-slate-200 bg-white text-sm text-slate-700 outline-none focus:border-amber-400 dark:border-slate-700 dark:bg-[#121620] dark:text-slate-300 ${compact ? "px-2.5 py-2" : "px-3 py-2"}`}
              >
                <option value="">{KANBAN_SPECIALIST_LANGUAGE_LABELS[specialistLanguage].noSpecialist}</option>
                {specialists.map((specialist) => <option key={specialist.id} value={specialist.id}>{getSpecialistDisplayName(specialist)}</option>)}
              </Select>
            </div>
          )}
        </div>
      </details>
      {canRunTask && (
        <div className={`mt-2 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-900/40 dark:bg-sky-900/10 dark:text-sky-200 ${compact ? "leading-[1.125rem]" : "leading-[1.2rem]"}`}>
          Manual {hasRecordedRuns ? "reruns" : "runs"} use {effectiveAutomation.source === "card" ? "this card override" : "the current lane default"}:
          {" "}
          {effectiveRunTarget}
        </div>
      )}
      {failureMessage && (
        <div className={`mt-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/40 dark:bg-rose-900/10 dark:text-rose-200 ${compact ? "leading-[1.125rem]" : "leading-[1.2rem]"}`}>
          Current run failed on {failedRunLabel}: {failureMessage}
          {" "}
          {effectiveAutomation.transport === "a2a"
            ? "Check the remote agent card URL, auth config, or A2A task status before rerunning."
            : "Reset the override or switch providers before rerunning if this looks like a provider authorization or runtime issue."}
        </div>
      )}
      {transitionArtifacts.nextRequiredArtifacts.length > 0 && (
        <div className={`mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-300 ${compact ? "leading-[1.125rem]" : "leading-5"}`}>
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
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-amber-300 hover:text-amber-700 dark:border-slate-700 dark:bg-[#121620] dark:text-slate-300 dark:hover:border-amber-600 dark:hover:text-amber-200"
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
            className={`rounded-xl bg-emerald-500 px-4 text-sm font-medium text-white transition-colors hover:bg-emerald-600 ${hasCardOverride ? "ml-auto" : ""} ${compact ? "py-2" : "py-2.5"}`}
          >
            {hasRecordedRuns ? t.kanban.rerun : t.kanban.run}
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
    : "No repository linked";

  return (
    <DetailSection
      title="Repositories"
      description={compact ? undefined : "Repository context and attached worktree for this card."}
      compact={compact}
    >
      <details className="group">
        <summary className={`flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden ${compact ? "text-[13px]" : "text-sm"}`}>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Repo</div>
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
            <div className={`rounded-2xl border px-3 py-2 ${sessionCwdMismatch
              ? "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/10"
              : "border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-900/10"}`}>
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
                      className="rounded-xl border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:border-amber-300 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-[#121620] dark:text-amber-300 dark:hover:bg-amber-900/20"
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
                      className="rounded-xl border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:border-amber-300 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-[#121620] dark:text-amber-300 dark:hover:bg-amber-900/20"
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
                          : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-400"
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
