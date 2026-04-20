"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "@/i18n";
import type { TranslationDictionary } from "@/i18n/types";

import {
  clampPercent,
  criterionShortLabel,
  criterionStatusTone,
  formatTime,
  humanizeToken,
  levelChangeTone,
  readinessBadgeTone,
  readinessBarTone,
  type CellResult,
  type CriterionResult,
  type FitnessRecommendation,
  type FitnessProfile,
  type FitnessReport,
  type ProfilePanelState,
  type ViewMode,
} from "./fitness-analysis-types";
import { buildBaselineModel } from "./fitness-analysis-view-model";
type FitnessAnalysisContentProps = {
  selectedProfile: FitnessProfile;
  viewMode: ViewMode;
  profileState: ProfilePanelState;
  report?: FitnessReport;
};

type FitnessTranslation = TranslationDictionary;

type DimensionGroup = {
  key: string;
  name: string;
  cells: CellResult[];
  failedCriteria: number;
  criticalFailures: number;
  averageScore: number;
};

type MeasureSpec = {
  title: string;
  subtitle: string;
  body: string;
  examples: string[];
  without: string;
};

type MeasureEntry = {
  key: string;
  title: string;
  subtitle: string;
  body: string;
  examples: string[];
  without: string;
  levelName: string;
  score: number;
  failedCriteria: CriterionResult[];
  recommendations: FitnessRecommendation[];
};

const MEASURE_ORDER = ["collaboration", "sdlc", "harness", "governance", "context"] as const;
type MeasureDimension = (typeof MEASURE_ORDER)[number];

function buildMeasureSpecs(t: {
  governance: MeasureSpec;
  harness: MeasureSpec;
  context: MeasureSpec;
  sdlc: MeasureSpec;
  collaboration: MeasureSpec;
}): Record<MeasureDimension, MeasureSpec> {
  return {
    governance: {
      title: t.governance.title,
      subtitle: t.governance.subtitle,
      body: t.governance.body,
      examples: t.governance.examples,
      without: t.governance.without,
    },
    harness: {
      title: t.harness.title,
      subtitle: t.harness.subtitle,
      body: t.harness.body,
      examples: t.harness.examples,
      without: t.harness.without,
    },
    context: {
      title: t.context.title,
      subtitle: t.context.subtitle,
      body: t.context.body,
      examples: t.context.examples,
      without: t.context.without,
    },
    sdlc: {
      title: t.sdlc.title,
      subtitle: t.sdlc.subtitle,
      body: t.sdlc.body,
      examples: t.sdlc.examples,
      without: t.sdlc.without,
    },
    collaboration: {
      title: t.collaboration.title,
      subtitle: t.collaboration.subtitle,
      body: t.collaboration.body,
      examples: t.collaboration.examples,
      without: t.collaboration.without,
    },
  };
}

function RecommendationCard({
  action,
  whyItMatters,
  evidenceHint,
  critical,
  criticalLabel,
  startFromLabel,
}: {
  action: string;
  whyItMatters: string;
  evidenceHint: string;
  critical: boolean;
  criticalLabel: string;
  startFromLabel: string;
}) {
  return (
    <article className="rounded-sm border border-desktop-border bg-desktop-bg-secondary/60 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-semibold text-desktop-text-primary">{action}</div>
        {critical ? (
          <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700">
            {criticalLabel}
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-[11px] leading-5 text-desktop-text-secondary">{whyItMatters}</div>
      <div className="mt-2 rounded-sm border border-desktop-border bg-desktop-bg-primary/80 px-3 py-2 text-[11px] text-desktop-text-secondary">
        {startFromLabel}{evidenceHint}
      </div>
    </article>
  );
}

function sortCells(left: CellResult, right: CellResult) {
  if (left.passed !== right.passed) {
    return left.passed ? 1 : -1;
  }

  return left.score - right.score;
}

function buildDimensionGroups(report: FitnessReport): DimensionGroup[] {
  const groups = new Map<string, DimensionGroup>();

  for (const cell of report.cells) {
    const current = groups.get(cell.dimension) ?? {
      key: cell.dimension,
      name: cell.dimensionName,
      cells: [],
      failedCriteria: 0,
      criticalFailures: 0,
      averageScore: 0,
    };

    current.cells.push(cell);
    current.failedCriteria += cell.criteria.filter((criterion) => criterion.status === "fail").length;
    current.criticalFailures += cell.criteria.filter((criterion) => criterion.critical && criterion.status === "fail").length;
    groups.set(cell.dimension, current);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      cells: group.cells.slice().sort(sortCells),
      averageScore: group.cells.reduce((sum, cell) => sum + cell.score, 0) / Math.max(group.cells.length, 1),
    }))
    .sort((left, right) => {
      if (left.criticalFailures !== right.criticalFailures) {
        return right.criticalFailures - left.criticalFailures;
      }
      if (left.failedCriteria !== right.failedCriteria) {
        return right.failedCriteria - left.failedCriteria;
      }
      return left.averageScore - right.averageScore;
    });
}

function buildMeasureEntries(
  report: FitnessReport,
  measures: {
    governance: MeasureSpec;
    harness: MeasureSpec;
    context: MeasureSpec;
    sdlc: MeasureSpec;
    collaboration: MeasureSpec;
  },
  notReachedText: string,
): MeasureEntry[] {
  const measureSpecs = buildMeasureSpecs(measures);
  const fallbackSpec: MeasureSpec = {
    title: humanizeToken(report.overallLevel),
    subtitle: humanizeToken(report.overallLevel),
    body: humanizeToken("unknown"),
    examples: [],
    without: "",
  };

  return MEASURE_ORDER.map((dimension) => {
    const spec = measureSpecs[dimension] ?? fallbackSpec;
    const dimensionInfo = report.dimensions[dimension];
    const failedCriteria = report.criteria.filter((criterion) => criterion.dimension === dimension && criterion.status === "fail");
    const recommendations = report.recommendations.filter((item) => item.criterionId.startsWith(`${dimension}.`));

    return {
      key: dimension,
      title: spec.title,
      subtitle: spec.subtitle,
      body: spec.body,
      examples: spec.examples,
      without: spec.without,
      levelName: dimensionInfo?.levelName ?? notReachedText,
      score: dimensionInfo?.score ?? 0,
      failedCriteria,
      recommendations,
    };
  });
}

function CapabilityCellCard({ cell }: { cell: CellResult }) {
  const { t } = useTranslation();
  const score = clampPercent(cell.score);
  const failedCriteria = cell.criteria.filter((criterion) => criterion.status === "fail");
  const criticalFailures = failedCriteria.filter((criterion) => criterion.critical);

  return (
    <article className="rounded-sm border border-desktop-border bg-desktop-bg-secondary/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">
            {cell.dimensionName}
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">
            {humanizeToken(cell.level)}
          </div>
          <h4 className="mt-1 text-sm font-semibold text-desktop-text-primary">{cell.levelName}</h4>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${readinessBadgeTone(cell.score)}`}>
          {score}%
        </span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-desktop-bg-primary">
        <div className={`h-full rounded-full ${readinessBarTone(cell.score)}`} style={{ width: `${score}%` }} />
      </div>

      <div className="mt-3 grid gap-2 text-[11px] text-desktop-text-secondary sm:grid-cols-3">
        <div>{cell.passedWeight}/{cell.applicableWeight} {t.fitness.overview.weightedChecks}</div>
        <div>{failedCriteria.length} {t.fitness.overview.failingCriteriaLabel}</div>
        <div>{criticalFailures.length} {t.fitness.overview.criticalBlockersLabel}</div>
      </div>

      {failedCriteria.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {failedCriteria.slice(0, 4).map((criterion) => (
            <span
              key={criterion.id}
              className={`rounded-full border px-2 py-0.5 text-[10px] ${criterionStatusTone(criterion.status)}`}
            >
              {criterionShortLabel(criterion.id)}
            </span>
          ))}
          {failedCriteria.length > 4 ? (
            <span className="rounded-full border border-desktop-border px-2 py-0.5 text-[10px] text-desktop-text-secondary">
              +{failedCriteria.length - 4}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 rounded-sm border border-dashed border-desktop-border px-3 py-3 text-[11px] text-desktop-text-secondary">
          {t.fitness.overview.noFailures}
        </div>
      )}
    </article>
  );
}

function OverviewView({
  report,
  t,
}: {
  report: FitnessReport;
  t: FitnessTranslation;
}) {
  const measureEntries = useMemo(() => buildMeasureEntries(report, t.fitness.measures, t.fitness.overview.notReached), [report, t.fitness.measures, t.fitness.overview.notReached]);
  const baselineModel = useMemo(() => buildBaselineModel(report), [report]);
  const [selectedMeasure, setSelectedMeasure] = useState(measureEntries[0]?.key ?? "governance");
  const activeMeasure = measureEntries.find((entry) => entry.key === selectedMeasure) ?? measureEntries[0];

  if (!activeMeasure) {
    return (
      <div className="rounded-sm border border-dashed border-desktop-border px-4 py-8 text-sm text-desktop-text-secondary">
        {t.fitness.overview.noDimensionData}
      </div>
    );
  }

  return (
    <section className="my-2 overflow-hidden rounded-sm border border-desktop-border bg-desktop-bg-secondary/60">
      {baselineModel ? (
        <div className="border-b border-desktop-border/70 bg-desktop-bg-primary/60 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-sm border border-desktop-border bg-desktop-bg-primary/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">
              {baselineModel.framing}
            </span>
            <span className="text-[13px] font-semibold text-desktop-text-primary">{baselineModel.summary}</span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-sm border border-desktop-border bg-desktop-bg-primary/80 px-3 py-1.5 text-[11px] text-desktop-text-secondary">
              {t.fitness.overview.levelLabel}
              <span className="ml-1 font-semibold text-desktop-text-primary">{baselineModel.overallLevelName}</span>
            </span>
            <span className="rounded-sm border border-desktop-border bg-desktop-bg-primary/80 px-3 py-1.5 text-[11px] text-desktop-text-secondary">
              {t.fitness.overview.scoreLabel}
              <span className="ml-1 font-semibold text-desktop-text-primary">{baselineModel.scoreLabel}</span>
            </span>
            {baselineModel.autonomyBand ? (
              <span className="rounded-sm border border-desktop-border bg-desktop-bg-primary/80 px-3 py-1.5 text-[11px] text-desktop-text-secondary">
                {baselineModel.autonomyBand}
              </span>
            ) : null}
            {baselineModel.nextLevelName ? (
              <span className="rounded-sm border border-desktop-border bg-desktop-bg-primary/80 px-3 py-1.5 text-[11px] text-desktop-text-secondary">
                {baselineModel.nextLevelName}
              </span>
            ) : null}
          </div>

          {baselineModel.autonomyRationale ? (
            <p className="mt-3 text-[12px] leading-6 text-desktop-text-secondary">{baselineModel.autonomyRationale}</p>
          ) : null}

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-sm border border-desktop-border bg-desktop-bg-primary/80 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-desktop-text-secondary">
                {t.fitness.overview.currentFindings}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {baselineModel.dominantGaps.length > 0 ? (
                  baselineModel.dominantGaps.slice(0, 3).map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200"
                    >
                      {item}
                    </span>
                  ))
                ) : (
                  <span className="text-[11px] text-desktop-text-secondary">{t.fitness.overview.noActiveBlockers}</span>
                )}
              </div>
            </div>
            <div className="rounded-sm border border-desktop-border bg-desktop-bg-primary/80 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-desktop-text-secondary">
                {t.fitness.overview.recommendedActions}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {baselineModel.topActions.length > 0 ? (
                  baselineModel.topActions.slice(0, 3).map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
                    >
                      {item}
                    </span>
                  ))
                ) : (
                  <span className="text-[11px] text-desktop-text-secondary">{t.fitness.overview.noActions}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <div className="flex flex-col lg:flex-row">
        <div className="border-desktop-border flex w-full shrink-0 flex-col border-b lg:w-60 lg:border-r lg:border-b-0">
          {measureEntries.map((entry) => {
            const active = entry.key === activeMeasure.key;
            return (
              <button
                key={entry.key}
                type="button"
                onClick={() => setSelectedMeasure(entry.key)}
                className={`border-desktop-border flex w-full items-center gap-3 border-b px-3 py-3 text-left transition-colors last:border-b-0 ${
                  active ? "bg-desktop-accent/8" : "hover:bg-desktop-bg-primary/80"
                }`}
              >
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${entry.failedCriteria.length > 0 ? "bg-amber-400" : "bg-emerald-400"}`} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-desktop-text-primary">{entry.title}</span>
              </button>
            );
          })}
        </div>

        <div className="min-w-0 flex-1 p-5">
          <div className="mb-4 flex items-start gap-3">
            <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${activeMeasure.failedCriteria.length > 0 ? "bg-amber-400" : "bg-emerald-400"}`} />
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-desktop-text-primary">{activeMeasure.title}</div>
              <div className="mt-1 text-[12px] text-desktop-text-secondary">{activeMeasure.subtitle}</div>
            </div>
          </div>

          <p className="text-[13px] leading-6 text-desktop-text-secondary">{activeMeasure.body}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            <div className="rounded-sm border border-desktop-border bg-desktop-bg-primary/80 px-3 py-2 text-[11px] text-desktop-text-secondary">
              {t.fitness.overview.levelLabel}
              <span className="ml-1 font-semibold text-desktop-text-primary">{activeMeasure.levelName}</span>
            </div>
            <div className="rounded-sm border border-desktop-border bg-desktop-bg-primary/80 px-3 py-2 text-[11px] text-desktop-text-secondary">
              {t.fitness.overview.scoreLabel}
              <span className="ml-1 font-semibold text-desktop-text-primary">{clampPercent(activeMeasure.score)}%</span>
            </div>
            <div className="rounded-sm border border-desktop-border bg-desktop-bg-primary/80 px-3 py-2 text-[11px] text-desktop-text-secondary">
              {t.fitness.overview.failsLabel}
              <span className="ml-1 font-semibold text-desktop-text-primary">{activeMeasure.failedCriteria.length}</span>
            </div>
          </div>

          <div className="mt-5">
            <p className="mb-2 font-mono text-[12px] uppercase tracking-[0.04em] text-desktop-text-secondary">{t.fitness.overview.examplesLabel}</p>
            <ul className="flex flex-col gap-1">
              {activeMeasure.examples.map((example) => (
                <li key={example} className="flex items-baseline gap-2">
                  <span className="text-[10px] leading-none text-desktop-text-secondary">•</span>
                  <span className="font-mono text-[12px] text-desktop-text-primary">{example}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
            <div>
              <div className="text-[12px] font-semibold text-desktop-text-primary">{t.fitness.overview.currentFindings}</div>
              <div className="mt-3 space-y-3">
                {activeMeasure.failedCriteria.length > 0 ? (
                  activeMeasure.failedCriteria.slice(0, 4).map((criterion) => (
                    <article key={criterion.id} className="rounded-sm border border-desktop-border bg-desktop-bg-primary/80 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-desktop-text-primary">{criterionShortLabel(criterion.id)}</div>
                          <div className="mt-1 font-mono text-[10px] text-desktop-text-secondary">{criterion.id}</div>
                        </div>
                        {criterion.critical ? (
                          <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700">
                            {t.fitness.overview.critical}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 text-[11px] leading-5 text-desktop-text-secondary">{criterion.whyItMatters}</div>
                      <div className="mt-2 text-[11px] leading-5 text-desktop-text-secondary">
                        {t.fitness.overview.startFromLabel} {criterion.evidenceHint}
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="rounded-sm border border-dashed border-desktop-border px-4 py-6 text-sm text-desktop-text-secondary">
                    {t.fitness.overview.noActiveBlockers}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-sm border border-desktop-border bg-desktop-bg-primary/80 p-4">
                <div className="text-[12px] font-semibold text-desktop-text-primary">{t.fitness.overview.recommendedActions}</div>
                <div className="mt-3 space-y-2">
                  {activeMeasure.recommendations.length > 0 ? (
                    activeMeasure.recommendations.slice(0, 3).map((item) => (
                      <article key={item.criterionId} className="rounded-sm border border-desktop-border bg-desktop-bg-primary/80 p-3">
                        <div className="text-sm font-semibold text-desktop-text-primary">{item.action}</div>
                        <div className="mt-2 text-[11px] leading-5 text-desktop-text-secondary">{item.evidenceHint}</div>
                      </article>
                    ))
                  ) : (
                    <div className="rounded-sm border border-dashed border-desktop-border px-3 py-4 text-[11px] text-desktop-text-secondary">
                      {t.fitness.overview.noActions}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-sm border border-desktop-border bg-desktop-bg-primary/80 p-4">
                <div className="text-[12px] font-semibold text-desktop-text-primary">{t.fitness.overview.withoutThis}</div>
                <p className="mt-2 text-[12px] leading-6 text-desktop-text-secondary">{activeMeasure.without}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CapabilitiesView({ report, t }: { report: FitnessReport; t: FitnessTranslation }) {
  const groups = useMemo(() => buildDimensionGroups(report), [report]);

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.key} className="rounded-sm border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                {group.name}
              </div>
              <p className="mt-1 text-[11px] text-desktop-text-secondary">
                {group.cells.length} {t.fitness.overview.cellsDivider} · {group.failedCriteria} {t.fitness.overview.failingCriteriaLabel} · {group.criticalFailures} {t.fitness.overview.criticalBlockersLabel}
              </p>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${readinessBadgeTone(group.averageScore)}`}>
              {clampPercent(group.averageScore)}%
            </span>
          </div>
          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {group.cells.map((cell) => (
              <CapabilityCellCard key={cell.id} cell={cell} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function RecommendationsView({ report, t }: { report: FitnessReport; t: FitnessTranslation }) {
  if (report.recommendations.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-desktop-border px-4 py-6 text-sm text-desktop-text-secondary">
        {t.fitness.overview.noProfileRecommendations}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {report.recommendations.map((item) => (
        <RecommendationCard
          key={item.criterionId}
          action={item.action}
          whyItMatters={item.whyItMatters}
          evidenceHint={item.evidenceHint}
          critical={item.critical}
          criticalLabel={t.fitness.overview.critical}
          startFromLabel={t.fitness.overview.startFromLabel}
        />
      ))}
    </div>
  );
}

function ChangesView({ report, t }: { report: FitnessReport; t: FitnessTranslation }) {
  if (!report.comparison) {
    return (
      <div className="rounded-sm border border-dashed border-desktop-border p-4 text-sm text-desktop-text-secondary">
        {t.fitness.overview.noComparisonHint}
      </div>
    );
  }

  const comp = report.comparison;

  return (
    <div className="space-y-4">
      <article className="rounded-sm border border-desktop-border bg-desktop-bg-secondary/60 p-4">
        <div className="text-sm text-desktop-text-primary">
          {t.fitness.overview.fromLast}: {formatTime(comp.previousGeneratedAt)}
        </div>
        <div className="mt-2 text-xs text-desktop-text-secondary">
          {t.fitness.overview.lastOverall}: {comp.previousOverallLevel} {t.fitness.overview.directionSame} {t.fitness.overview.currentOverall}: {report.overallLevel}
          <span className={`ml-2 font-semibold ${levelChangeTone(comp.overallChange)}`}>
            {comp.overallChange === "up" ? t.fitness.overview.directionUp : comp.overallChange === "down" ? t.fitness.overview.directionDown : t.fitness.overview.directionSame}
          </span>
        </div>
      </article>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-sm border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
            {t.fitness.overview.dimensionChangesTitle}
          </div>
          {comp.dimensionChanges.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {comp.dimensionChanges.map((item) => (
                <li key={`${item.dimension}-${item.currentLevel}`} className="flex items-center justify-between text-sm">
                  <span className="text-desktop-text-secondary">{humanizeToken(item.dimension)}</span>
                  <span className="font-semibold text-desktop-text-primary">
                    {item.previousLevel}
                    <span className="px-1 text-desktop-text-secondary">→</span>
                    {item.currentLevel}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-desktop-text-secondary">{t.fitness.overview.noDimensionChanges}</p>
          )}
        </div>
        <div className="rounded-sm border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
            {t.fitness.overview.criteriaChangesTitle}
          </div>
          {comp.criteriaChanges.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm">
              {comp.criteriaChanges.slice(0, 8).map((item) => (
                <li key={item.id} className="rounded-sm border border-desktop-border bg-desktop-bg-primary/80 p-3">
                  <div className="font-mono text-[11px] text-desktop-text-secondary">{item.id}</div>
                    <div className="mt-1 text-xs text-desktop-text-secondary">
                    {item.previousStatus ?? t.fitness.status.noData} {t.fitness.panel.to} {item.currentStatus ?? t.fitness.status.noData}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-desktop-text-secondary">{t.fitness.overview.noCriteriaChanges}</p>
          )}
        </div>
      </section>
    </div>
  );
}

export function FitnessAnalysisContent({
  selectedProfile,
  viewMode,
  profileState,
  report,
}: FitnessAnalysisContentProps) {
  const { t } = useTranslation();
  const selectedProfileLabel = selectedProfile === "generic" ? t.fitness.panel.genericProfile : t.fitness.panel.orchestratorProfile;
  const profileMissingText = t.fitness.overview.noProfileErrorText.replace("{profile}", selectedProfileLabel);

  if (!report) {
    return (
      <div className="rounded-sm border border-dashed border-desktop-border px-4 py-8 text-sm text-desktop-text-secondary">
        {profileState.state === "loading"
          ? t.fitness.overview.noReportTextLoading
          : profileState.error ?? profileMissingText}
      </div>
    );
  }

  if (viewMode === "capabilities") {
    return <CapabilitiesView report={report} t={t} />;
  }

  if (viewMode === "recommendations") {
    return <RecommendationsView report={report} t={t} />;
  }

  if (viewMode === "changes") {
    return <ChangesView report={report} t={t} />;
  }

  return <OverviewView report={report} t={t} />;
}
