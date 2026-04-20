"use client";

import type { ReactNode } from "react";
import type { CanonicalStoryParseResult } from "@/core/kanban/canonical-story";
import { useTranslation } from "@/i18n";

interface CanonicalStoryRendererProps {
  parseResult: CanonicalStoryParseResult;
  compact?: boolean;
  className?: string;
  hideTitle?: boolean;
  hideInvestSummary?: boolean;
}

type InvestStatus = "pass" | "warning" | "fail";

function joinClasses(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function SummaryBlock({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 border-t border-slate-200/70 py-3 dark:border-slate-700">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </div>
      <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-slate-200">
        {value}
      </div>
    </div>
  );
}

function ListBlock({
  label,
  items,
  emptyLabel,
}: {
  label: string;
  items: string[];
  emptyLabel: string;
}) {
  return (
    <div className="min-w-0 border-t border-slate-200/70 py-3 dark:border-slate-700">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </div>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-700 dark:text-slate-200">
          {items.map((item) => (
            <li key={item} className="break-words">
              - {item}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">{emptyLabel}</div>
      )}
    </div>
  );
}

function formatStatus(status: InvestStatus, t: ReturnType<typeof useTranslation>["t"]): string {
  switch (status) {
    case "pass":
      return t.kanbanDetail.pass;
    case "warning":
      return t.kanbanDetail.warning;
    case "fail":
      return t.kanbanDetail.fail;
  }
}

function CompactField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="grid min-w-0 gap-0 border-b border-slate-200/70 pb-1 pt-1.5 last:border-b-0 dark:border-slate-700">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
        {label}
      </div>
      <div className="whitespace-pre-wrap break-words text-[12px] leading-4 text-slate-700 dark:text-slate-200">
        {value}
      </div>
    </div>
  );
}

function CompactListField({
  label,
  items,
  emptyLabel,
}: {
  label: string;
  items: string[];
  emptyLabel: string;
}) {
  return (
    <div className="grid min-w-0 gap-0 border-b border-slate-200/70 py-1.5 last:border-b-0 dark:border-slate-700">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
        {label}
      </div>
      {items.length > 0 ? (
        <ul className="space-y-0 text-[12px] leading-4 text-slate-700 dark:text-slate-200">
          {items.map((item) => (
            <li key={item} className="break-words">
              - {item}
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-[12px] leading-4 text-slate-500 dark:text-slate-400">{emptyLabel}</div>
      )}
    </div>
  );
}

function CompactDisclosure({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen || undefined}
      className="group border-t border-slate-200/70 pt-1 dark:border-slate-700"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-0.5 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
            {title}
          </div>
          {summary && (
            <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
              {summary}
            </div>
          )}
        </div>
        <span className="shrink-0 text-[10px] font-medium text-slate-400 transition-colors group-hover:text-slate-600 dark:group-hover:text-slate-300">
          +
        </span>
      </summary>
      <div className="py-1">
        {children}
      </div>
    </details>
  );
}

function AcceptanceCriteriaList({
  criteria,
  compact = false,
  testableLabel,
  failLabel,
}: {
  criteria: Array<{ id: string; text: string; testable: boolean }>;
  compact?: boolean;
  testableLabel: string;
  failLabel: string;
}) {
  return (
    <ul className={joinClasses("list-none", compact ? "mt-0.5 space-y-0" : "mt-3 space-y-2")}>
      {criteria.map((criterion) => (
        <li
          key={criterion.id}
          className={joinClasses(
            "border-b border-slate-200/70 last:border-b-0 dark:border-slate-700",
            compact ? "pb-0.5 pt-1" : "py-2",
          )}
        >
          <div className={joinClasses("flex items-start gap-2", compact ? "text-[12px] leading-4" : "text-sm leading-6")}>
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
              {criterion.id}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">
              {criterion.text}
            </span>
            <span
              className={joinClasses(
                "shrink-0 text-[9px] font-semibold uppercase tracking-[0.12em]",
                criterion.testable
                  ? "text-emerald-600 dark:text-emerald-300"
                  : "text-rose-600 dark:text-rose-300",
              )}
            >
              {criterion.testable ? testableLabel : failLabel}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CanonicalStoryRenderer({
  parseResult,
  compact = false,
  className = "",
  hideTitle = false,
  hideInvestSummary = false,
}: CanonicalStoryRendererProps) {
  const { t } = useTranslation();

  if (parseResult.story == null) {
    return (
      <div
        className={joinClasses(
          "canonical-story-renderer not-prose rounded-2xl border border-rose-200 bg-rose-50/80 p-3 dark:border-rose-900/40 dark:bg-rose-900/10",
          className,
        )}
        data-testid="canonical-story-renderer-invalid"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-900/40 dark:text-rose-200">
            {t.kanbanDetail.invalidYaml}
          </span>
          <span className="text-xs text-rose-700 dark:text-rose-200">
            {t.kanbanDetail.invalidYamlHint}
          </span>
        </div>
        <ul className="mt-3 space-y-1 text-sm text-rose-800 dark:text-rose-100">
          {parseResult.issues.map((issue) => (
            <li key={issue} className="whitespace-pre-wrap">
              - {issue}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const { story } = parseResult.story;
  const investItems = [
    { label: t.kanbanDetail.investIndependent, check: story.invest.independent },
    { label: t.kanbanDetail.investNegotiable, check: story.invest.negotiable },
    { label: t.kanbanDetail.investValuable, check: story.invest.valuable },
    { label: t.kanbanDetail.investEstimable, check: story.invest.estimable },
    { label: t.kanbanDetail.investSmall, check: story.invest.small },
    { label: t.kanbanDetail.investTestable, check: story.invest.testable },
  ] as const;

  if (compact) {
    return (
      <div
        className={joinClasses(
          "canonical-story-renderer not-prose space-y-1.5",
          className,
        )}
        data-testid="canonical-story-renderer"
      >
        <div className="border-b border-slate-200/70 pb-1 dark:border-slate-700">
          {!hideTitle && (
            <div className="pb-1 text-[13px] font-semibold leading-5 text-slate-950 dark:text-slate-50">
              {story.title}
            </div>
          )}
          <div className="flex flex-wrap gap-x-2 gap-y-0 text-[10px] leading-4 text-slate-500 dark:text-slate-400">
            <span>{t.kanbanDetail.version} {story.version}</span>
            <span>{t.settings.language}: {story.language}</span>
            <span>{t.kanbanDetail.acceptanceCriteria}: {story.acceptance_criteria.length}</span>
            <span>
              {t.kanbanDetail.independentStoryCheck}: {formatStatus(story.dependencies_and_sequencing.independent_story_check, t)}
            </span>
          </div>
        </div>

        <div className="grid gap-0">
          <CompactField label={t.kanbanDetail.problemStatement} value={story.problem_statement} />
          <CompactField label={t.kanbanDetail.userValue} value={story.user_value} />
        </div>

        <CompactDisclosure
          title={t.kanbanDetail.acceptanceCriteria}
          summary={`#${story.acceptance_criteria.length}`}
          defaultOpen
        >
          <AcceptanceCriteriaList
            criteria={story.acceptance_criteria}
            compact
            testableLabel={t.kanbanDetail.investTestable}
            failLabel={t.kanbanDetail.fail}
          />
        </CompactDisclosure>

        {!hideInvestSummary && (
          <CompactDisclosure
            title={t.kanbanDetail.investSummary}
            summary={investItems.map(({ label, check }) => `${label}: ${formatStatus(check.status, t)}`).join(" · ")}
          >
            <div className="space-y-0">
              {investItems.map(({ label, check }) => (
                <div
                  key={label}
                  className="border-b border-slate-200/70 py-1 last:border-b-0 dark:border-slate-700"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                      {label}
                    </div>
                    <span className={joinClasses(
                      "text-[9px] font-semibold uppercase tracking-[0.12em]",
                      check.status === "pass"
                        ? "text-emerald-600 dark:text-emerald-300"
                        : check.status === "warning"
                          ? "text-amber-600 dark:text-amber-300"
                          : "text-rose-600 dark:text-rose-300",
                    )}>
                      {formatStatus(check.status, t)}
                    </span>
                  </div>
                  <div className="mt-0.5 whitespace-pre-wrap break-words text-[12px] leading-4 text-slate-700 dark:text-slate-200">
                    {check.reason}
                  </div>
                </div>
              ))}
            </div>
          </CompactDisclosure>
        )}

        <CompactDisclosure
          title={`${t.kanbanDetail.affectedAreas} / ${t.kanbanDetail.dependsOn}`}
          summary={`${story.constraints_and_affected_areas.length} · ${story.dependencies_and_sequencing.depends_on.length}`}
        >
          <div className="space-y-0">
            <CompactListField
              label={t.kanbanDetail.affectedAreas}
              items={story.constraints_and_affected_areas}
              emptyLabel={t.kanbanDetail.none}
            />
            <CompactListField
              label={t.kanbanDetail.dependsOn}
              items={story.dependencies_and_sequencing.depends_on}
              emptyLabel={t.kanbanDetail.none}
            />
            <CompactField
              label={t.kanbanDetail.unblockCondition}
              value={story.dependencies_and_sequencing.unblock_condition || t.kanbanDetail.none}
            />
            <CompactListField
              label={t.kanbanDetail.outOfScope}
              items={story.out_of_scope}
              emptyLabel={t.kanbanDetail.none}
            />
          </div>
        </CompactDisclosure>
      </div>
    );
  }

  return (
    <div
      className={joinClasses(
        "canonical-story-renderer not-prose space-y-4",
        className,
      )}
      data-testid="canonical-story-renderer"
    >
      <div className="flex flex-col gap-4">
        <div className="space-y-3 border-b border-slate-200/70 pb-3 dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
              {t.kanbanDetail.validYaml}
            </span>
            <span className="text-xs text-slate-600 dark:text-slate-300">
              {t.kanbanDetail.structuredStory}
            </span>
          </div>
          {!hideTitle && (
            <div className="text-lg font-semibold leading-8 text-slate-950 dark:text-slate-50">
              {story.title}
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs leading-6 text-slate-500 dark:text-slate-400">
            <span>{t.kanbanDetail.version} {story.version}</span>
            <span>{t.settings.language}: {story.language}</span>
            <span>{t.kanbanDetail.acceptanceCriteria}: {story.acceptance_criteria.length}</span>
            <span>
              {t.kanbanDetail.independentStoryCheck}: {formatStatus(story.dependencies_and_sequencing.independent_story_check, t)}
            </span>
          </div>
        </div>

        <div className="grid gap-3">
          <SummaryBlock label={t.kanbanDetail.problemStatement} value={story.problem_statement} />
          <SummaryBlock label={t.kanbanDetail.userValue} value={story.user_value} />
        </div>

        <div className="border-t border-slate-200/70 pt-3 dark:border-slate-700">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {t.kanbanDetail.acceptanceCriteria}
          </div>
          <AcceptanceCriteriaList
            criteria={story.acceptance_criteria}
            testableLabel={t.kanbanDetail.investTestable}
            failLabel={t.kanbanDetail.fail}
          />
        </div>

        {!hideInvestSummary && (
          <div className="border-t border-slate-200/70 pt-3 dark:border-slate-700">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {t.kanbanDetail.investSummary}
            </div>
            <div className="mt-2 grid gap-3">
              {investItems.map(({ label, check }) => (
                <div
                  key={label}
                  className="border-b border-slate-200/70 py-3 last:border-b-0 dark:border-slate-700"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      {label}
                    </div>
                    <span className={joinClasses(
                      "text-[11px] font-semibold uppercase tracking-wide",
                      check.status === "pass"
                        ? "text-emerald-600 dark:text-emerald-300"
                        : check.status === "warning"
                          ? "text-amber-600 dark:text-amber-300"
                          : "text-rose-600 dark:text-rose-300",
                    )}>
                      {formatStatus(check.status, t)}
                    </span>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-slate-200">
                    {check.reason}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className={joinClasses("grid gap-3", compact ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2")}>
          <ListBlock
            label={t.kanbanDetail.affectedAreas}
            items={story.constraints_and_affected_areas}
            emptyLabel={t.kanbanDetail.none}
          />
          <ListBlock
            label={t.kanbanDetail.dependsOn}
            items={story.dependencies_and_sequencing.depends_on}
            emptyLabel={t.kanbanDetail.none}
          />
          <SummaryBlock
            label={t.kanbanDetail.unblockCondition}
            value={story.dependencies_and_sequencing.unblock_condition || t.kanbanDetail.none}
          />
          <ListBlock
            label={t.kanbanDetail.outOfScope}
            items={story.out_of_scope}
            emptyLabel={t.kanbanDetail.none}
          />
        </div>
      </div>
    </div>
  );
}
