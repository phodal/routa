"use client";

import { MarkdownViewer } from "@/client/components/markdown/markdown-viewer";
import { useTranslation } from "@/i18n";
import type { TaskInfo } from "../types";

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
