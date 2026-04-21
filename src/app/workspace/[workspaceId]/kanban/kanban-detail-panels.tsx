"use client";

import { useEffect, useMemo, useState } from "react";
import type { AcpTaskAdaptiveHarnessOptions } from "@/client/acp-client";
import { MarkdownViewer } from "@/client/components/markdown/markdown-viewer";
import { desktopAwareFetch, toErrorMessage } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";
import type { TaskAdaptiveHarnessPack } from "@/core/harness/task-adaptive";
import type { TaskInfo } from "../types";
import { buildKanbanTaskAdaptiveHarnessOptions } from "./kanban-task-adaptive";
import type { KanbanSpecialistLanguage } from "./kanban-specialist-language";

function formatTimestamp(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleString();
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

function formatVerificationVerdictLabel(
  verdict: string | undefined,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (verdict) {
    case "NOT_APPROVED":
      return t.kanbanDetail.reviewRequestedChanges;
    case "BLOCKED":
      return t.kanbanDetail.reviewBlockedVerdict;
    case "APPROVED":
      return t.kanbanDetail.reviewApprovedVerdict;
    default:
      return t.kanbanDetail.reviewFeedback;
  }
}

function hasTaskAdaptiveSearchHints(options: AcpTaskAdaptiveHarnessOptions): boolean {
  return Boolean(
    options.query?.trim()
    || options.featureId?.trim()
    || (options.featureIds?.length ?? 0) > 0
    || (options.filePaths?.length ?? 0) > 0
    || (options.routeCandidates?.length ?? 0) > 0
    || (options.apiCandidates?.length ?? 0) > 0
    || (options.historySessionIds?.length ?? 0) > 0
    || (options.moduleHints?.length ?? 0) > 0
    || (options.symptomHints?.length ?? 0) > 0
  );
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

export function StoryReadinessPanel({
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

export function EvidenceBundlePanel({
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
      <div className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-3"}`}>
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
      </div>
    </div>
  );
}

export function ReviewFeedbackPanel({
  task,
  compact = false,
}: {
  task: TaskInfo;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const report = task.verificationReport?.trim();
  const verdict = task.verificationVerdict;

  if (!report && !verdict) {
    return (
      <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
        {t.kanbanDetail.reportMissing}
      </div>
    );
  }

  const verdictLabel = formatVerificationVerdictLabel(verdict, t);
  const verdictTone = verdict === "BLOCKED"
    ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200"
    : verdict === "APPROVED"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200"
      : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200";

  return (
    <div className="space-y-3">
      <div className={`border-l-2 px-3 py-2.5 ${
        verdict === "APPROVED"
          ? "border-l-emerald-400/80 dark:border-l-emerald-500/70"
          : verdict === "BLOCKED"
            ? "border-l-rose-400/80 dark:border-l-rose-500/70"
            : "border-l-amber-400/80 dark:border-l-amber-500/70"
      }`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${verdictTone}`}>
            {task.columnId === "dev" && verdict !== "APPROVED"
              ? t.kanbanDetail.reviewReturnedToDev
              : verdictLabel}
          </span>
          {verdict && (
            <span className="text-xs text-slate-600 dark:text-slate-300">
              {t.kanbanDetail.verification}: {verdictLabel}
            </span>
          )}
        </div>
      </div>
      {report ? (
        <div className={`border-b border-slate-200/70 text-sm text-slate-700 dark:border-slate-700/70 dark:text-slate-200 ${compact ? "px-3 py-2.5" : "px-4 py-3"}`}>
          <MarkdownViewer
            content={report}
            className="prose prose-sm max-w-none text-slate-800 dark:prose-invert dark:text-slate-200"
          />
        </div>
      ) : (
        <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
          {t.kanbanDetail.reportMissing}
        </div>
      )}
    </div>
  );
}

export function JitContextPanel({
  task,
  workspaceId,
  repoPath,
  specialistLanguage,
  compact = false,
  showTitle = false,
}: {
  task: TaskInfo;
  workspaceId?: string;
  repoPath?: string | null;
  specialistLanguage: KanbanSpecialistLanguage;
  compact?: boolean;
  showTitle?: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pack, setPack] = useState<TaskAdaptiveHarnessPack | null>(null);
  const harnessOptions = useMemo(
    () => buildKanbanTaskAdaptiveHarnessOptions(task.title, {
      locale: specialistLanguage,
      role: task.assignedRole,
      task,
    }),
    [specialistLanguage, task],
  );
  const canLoadContext = hasTaskAdaptiveSearchHints(harnessOptions);
  const historicalIssueCount = (pack?.failures.length ?? 0) + (pack?.repeatedReadFiles.length ?? 0);
  const relatedSessionCount = pack?.sessions.length ?? 0;
  const matchedFileCount = pack?.selectedFiles.length ?? 0;
  const historySessionKey = (harnessOptions.historySessionIds ?? []).join("|");

  useEffect(() => {
    setExpanded(false);
    setLoading(false);
    setLoaded(false);
    setError(null);
    setPack(null);
  }, [historySessionKey, repoPath, specialistLanguage, task.id, workspaceId]);

  const loadContext = async () => {
    if (loading) {
      return;
    }

    if (!workspaceId && !repoPath) {
      setPack(null);
      setLoaded(true);
      setError(t.kanbanDetail.jitContextUnavailable);
      return;
    }

    if (!canLoadContext) {
      setPack(null);
      setLoaded(true);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await desktopAwareFetch("/api/harness/task-adaptive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          repoPath,
          taskAdaptiveHarness: harnessOptions,
        }),
      });
      const data = await response.json().catch(() => ({})) as TaskAdaptiveHarnessPack & { error?: string; details?: string };
      if (!response.ok) {
        throw new Error(data.details ?? data.error ?? t.kanbanDetail.jitContextSearchFailed);
      }
      setPack(data);
      setLoaded(true);
    } catch (fetchError) {
      setPack(null);
      setLoaded(true);
      setError(toErrorMessage(fetchError));
    } finally {
      setLoading(false);
    }
  };

  const toggleExpanded = () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && !loaded) {
      void loadContext();
    }
  };

  return (
    <div className="space-y-3">
      <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 ${compact ? "px-3 py-2" : "px-3.5 py-2.5"} dark:border-slate-700/70 dark:bg-slate-900/20`}>
        <div className="space-y-1">
          {showTitle ? (
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              {t.kanbanDetail.jitContext}
            </div>
          ) : null}
          <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {t.kanbanDetail.jitContextHint}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            {loaded && pack ? (
              <>
                <span>{t.kanbanDetail.historicalIssues}: {historicalIssueCount}</span>
                <span>{t.kanbanDetail.relatedSessions}: {relatedSessionCount}</span>
                <span>{t.kanbanDetail.matchedFiles}: {matchedFileCount}</span>
              </>
            ) : (
              <span>{canLoadContext ? t.kanbanDetail.jitContextHint : t.kanbanDetail.jitContextNoHistorySessions}</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {expanded && canLoadContext && loaded ? (
            <button
              type="button"
              onClick={() => {
                void loadContext();
              }}
              className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {t.kanbanDetail.refreshJitContext}
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleExpanded}
            className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-expanded={expanded}
          >
            {expanded ? t.kanbanDetail.hideJitContext : t.kanbanDetail.showJitContext}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-3">
          {loading ? (
            <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
              {t.kanbanDetail.loadingJitContext}
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200/80 bg-rose-50/80 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/10 dark:text-rose-200">
              {error}
            </div>
          ) : !canLoadContext ? (
            <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
              {t.kanbanDetail.jitContextNoHistorySessions}
            </div>
          ) : !pack || (pack.failures.length === 0 && pack.repeatedReadFiles.length === 0 && pack.sessions.length === 0 && pack.selectedFiles.length === 0) ? (
            <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
              {t.kanbanDetail.noJitContext}
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                  {t.kanbanDetail.historicalIssues}
                </div>
                {pack.failures.length > 0 ? (
                  <div className="space-y-2">
                    {pack.failures.map((failure) => (
                      <div
                        key={`${failure.sessionId}:${failure.toolName}:${failure.message}`}
                        className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-2.5 dark:border-amber-900/40 dark:bg-amber-900/10"
                      >
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {failure.message}
                        </div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {failure.sessionId} · {failure.toolName}
                        </div>
                        {failure.command ? (
                          <div className="mt-2 rounded-md bg-white/80 px-2 py-1 font-mono text-[11px] text-slate-600 dark:bg-slate-950/60 dark:text-slate-300">
                            {failure.command}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
                    {t.kanbanDetail.noHistoricalIssues}
                  </div>
                )}

                {pack.repeatedReadFiles.length > 0 ? (
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 dark:border-slate-700/70 dark:bg-slate-900/20">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                      {t.kanbanDetail.repeatedReadHotspots}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {pack.repeatedReadFiles.map((filePath) => (
                        <span
                          key={filePath}
                          className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300"
                        >
                          {filePath}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              {pack.selectedFiles.length > 0 ? (
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 dark:border-slate-700/70 dark:bg-slate-900/20">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                    {t.kanbanDetail.matchedFiles}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {pack.selectedFiles.map((filePath) => (
                      <span
                        key={filePath}
                        className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300"
                      >
                        {filePath}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {pack.sessions.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                    {t.kanbanDetail.relatedSessions}
                  </div>
                  <div className="space-y-2">
                    {pack.sessions.map((session) => (
                      <div
                        key={session.sessionId}
                        className="rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2.5 dark:border-slate-700/70 dark:bg-slate-900/20"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                          <span>{session.sessionId}</span>
                          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                            {session.provider}
                          </span>
                          {formatTimestamp(session.updatedAt) ? (
                            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                              {formatTimestamp(session.updatedAt)}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                          {session.promptSnippet}
                        </div>
                        {session.matchedFiles.length > 0 ? (
                          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                            {t.kanbanDetail.matchedFiles}: {session.matchedFiles.join(", ")}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
