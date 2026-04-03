"use client";

import { useState } from "react";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import { HarnessSectionCard, HarnessSectionStateFrame } from "@/client/components/harness-section-card";
import { useTranslation } from "@/i18n";
import type {
  HookFileSummary,
  HooksResponse,
  ReviewTriggerBoundarySummary,
  ReviewTriggerRuleSummary,
} from "@/client/hooks/use-harness-settings-data";

type ReviewTriggersPanelProps = {
  repoLabel: string;
  unsupportedMessage?: string | null;
  data?: HooksResponse | null;
  loading?: boolean;
  error?: string | null;
  variant?: "full" | "compact";
  showDetailToggle?: boolean;
  defaultShowDetails?: boolean;
  hideHeader?: boolean;
};

type ReviewDimensionTone = "danger" | "warning" | "info" | "success";

type ReviewRoutingDetails = {
  actions: string[];
  profiles: HooksResponse["profiles"];
  hookFiles: HookFileSummary[];
};

type ReviewDimensionCard = {
  key: "risk" | "confidence" | "complexity" | "routing";
  title: string;
  value: string;
  subtitle: string;
  barValue: number;
  tone: ReviewDimensionTone;
  rules: ReviewTriggerRuleSummary[];
  routingDetails?: ReviewRoutingDetails;
};

const COMPLEXITY_RULE_TYPES = new Set([
  "cross_boundary_change",
  "directory_file_count",
  "diff_size",
]);

const TONE_STYLES: Record<
  ReviewDimensionTone,
  {
    pill: string;
    bar: string;
    border: string;
    accent: string;
    tag: string;
    detailSurface: string;
  }
> = {
  danger: {
    pill: "border-rose-200 bg-rose-50 text-rose-700",
    bar: "bg-rose-500/85",
    border: "border-desktop-border",
    accent: "bg-rose-100/80",
    tag: "border-rose-200 bg-rose-50/70 text-rose-700",
    detailSurface: "border-rose-100/80 bg-desktop-bg-primary/85",
  },
  warning: {
    pill: "border-amber-200 bg-amber-50 text-amber-800",
    bar: "bg-amber-500/85",
    border: "border-desktop-border",
    accent: "bg-amber-100/85",
    tag: "border-amber-200 bg-amber-50/70 text-amber-800",
    detailSurface: "border-amber-100/80 bg-desktop-bg-primary/85",
  },
  info: {
    pill: "border-sky-200 bg-sky-50 text-sky-700",
    bar: "bg-sky-500/85",
    border: "border-desktop-border",
    accent: "bg-sky-100/85",
    tag: "border-sky-200 bg-sky-50/70 text-sky-700",
    detailSurface: "border-sky-100/80 bg-desktop-bg-primary/85",
  },
  success: {
    pill: "border-emerald-200 bg-emerald-50 text-emerald-700",
    bar: "bg-emerald-500/85",
    border: "border-desktop-border",
    accent: "bg-emerald-100/85",
    tag: "border-emerald-200 bg-emerald-50/70 text-emerald-700",
    detailSurface: "border-emerald-100/80 bg-desktop-bg-primary/85",
  },
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(value, max));
}

function formatTokenLabel(value: string): string {
  return value
    .split(/[-_]/u)
    .filter(Boolean)
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatRuleLabel(ruleName: string): string {
  return formatTokenLabel(ruleName);
}

function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function scoreSeverity(severity: string): number {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

function toneFromScore(score: number): ReviewDimensionTone {
  if (score >= 0.75) return "danger";
  if (score >= 0.45) return "warning";
  return "info";
}

function confidenceTone(score: number): ReviewDimensionTone {
  if (score >= 0.75) return "success";
  if (score >= 0.45) return "warning";
  return "danger";
}

function uniqueLabels(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function takeLabels(values: string[], limit: number): string[] {
  return uniqueLabels(values).slice(0, limit);
}

function cardGridClass(compactMode: boolean): string {
  return compactMode
    ? "mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2"
    : "mt-2.5 grid gap-2.5 md:grid-cols-2 xl:grid-cols-4";
}

function isRiskRule(rule: ReviewTriggerRuleSummary): boolean {
  if (rule.type === "sensitive_file_change") {
    return true;
  }
  if (rule.type === "changed_paths" && rule.severity === "high") {
    return true;
  }
  return rule.severity === "high" && rule.paths.length > 0 && rule.evidencePaths.length === 0;
}

function isConfidenceRule(rule: ReviewTriggerRuleSummary): boolean {
  if (rule.type === "evidence_gap") {
    return true;
  }
  if (rule.evidencePaths.length > 0) {
    return true;
  }
  return /evidence/i.test(rule.name);
}

function isComplexityRule(rule: ReviewTriggerRuleSummary): boolean {
  if (isRiskRule(rule) || isConfidenceRule(rule)) {
    return false;
  }
  if (COMPLEXITY_RULE_TYPES.has(rule.type)) {
    return true;
  }
  return /boundary|oversized|diff|file_count/i.test(rule.name);
}

function buildThresholdTokens(rule: ReviewTriggerRuleSummary): string[] {
  return [
    rule.minBoundaries ? `min ${rule.minBoundaries} boundaries` : "",
    rule.maxFiles ? `max ${rule.maxFiles} files` : "",
    rule.maxAddedLines ? `+${rule.maxAddedLines} lines` : "",
    rule.maxDeletedLines ? `-${rule.maxDeletedLines} lines` : "",
  ].filter(Boolean);
}

type ReviewTriggerTranslations = {
  risk: string;
  confidence: string;
  complexity: string;
  routing: string;
  noRules: string;
  coreEnginePaths: string;
  noHighRiskTriggers: string;
  evidenceGap: string;
  noEvidenceTriggers: string;
  changeSize: string;
  noBoundaryTriggers: string;
  routeAvailable: string;
  routeIncomplete: string;
};

function buildReviewDimensionCards(
  rules: ReviewTriggerRuleSummary[],
  reviewProfiles: HooksResponse["profiles"],
  reviewHooks: string[],
  hookFiles: HookFileSummary[],
  tr: ReviewTriggerTranslations,
): ReviewDimensionCard[] {
  const riskRules = rules.filter(isRiskRule);
  const confidenceRules = rules.filter(isConfidenceRule);
  const complexityRules = rules.filter(isComplexityRule);

  const riskScore = riskRules.length
    ? clamp(riskRules.reduce((sum, rule) => sum + scoreSeverity(rule.severity), 0) / (riskRules.length * 3))
    : 0;

  const evidencePathCount = confidenceRules.reduce((sum, rule) => sum + rule.evidencePathCount, 0);
  const confidenceScore = confidenceRules.length
    ? clamp((confidenceRules.length * 2 + Math.min(evidencePathCount, 8)) / 10)
    : 0;

  const complexityBoundaryCount = complexityRules.reduce((sum, rule) => sum + rule.boundaryCount, 0);
  const complexityDirectoryCount = complexityRules.reduce((sum, rule) => sum + rule.directoryCount, 0);
  const complexityScore = complexityRules.length
    ? clamp(
        (
          complexityRules.reduce((sum, rule) => sum + scoreSeverity(rule.severity), 0) +
          complexityBoundaryCount +
          complexityDirectoryCount
        ) / Math.max(complexityRules.length * 3 + 2, 5),
      )
    : 0;

  const actionLabels = uniqueLabels(rules.map((rule) => formatTokenLabel(rule.action)));
  const routingProfiles = reviewProfiles.filter((profile) => profile.phases.includes("review"));
  const routingHooks = uniqueLabels(reviewHooks);
  const routingHookFiles = hookFiles.filter((file) => routingHooks.includes(file.name));
  const routingReady = actionLabels.length > 0 && routingProfiles.length > 0;
  const routingScore = clamp(
    (actionLabels.length > 0 ? 0.4 : 0) +
      (routingProfiles.length > 0 ? 0.35 : 0) +
      Math.min(routingHooks.length, 2) * 0.125,
  );

  return [
    {
      key: "risk",
      title: tr.risk,
      value: riskRules.length ? formatCount(riskRules.length, "rule") : tr.noRules,
      subtitle: riskRules.length
        ? tr.coreEnginePaths
        : tr.noHighRiskTriggers,
      barValue: riskScore,
      tone: toneFromScore(riskScore),
      rules: riskRules,
    },
    {
      key: "confidence",
      title: tr.confidence,
      value: confidenceRules.length ? formatCount(confidenceRules.length, "rule") : tr.noRules,
      subtitle: confidenceRules.length
        ? tr.evidenceGap
        : tr.noEvidenceTriggers,
      barValue: confidenceScore,
      tone: confidenceTone(confidenceScore),
      rules: confidenceRules,
    },
    {
      key: "complexity",
      title: tr.complexity,
      value: complexityRules.length ? formatCount(complexityRules.length, "rule") : tr.noRules,
      subtitle: complexityRules.length
        ? tr.changeSize
        : tr.noBoundaryTriggers,
      barValue: complexityScore,
      tone: toneFromScore(complexityScore),
      rules: complexityRules,
    },
    {
      key: "routing",
      title: tr.routing,
      value: routingProfiles.length ? formatCount(routingProfiles.length, "profile") : tr.noRules,
      subtitle: routingReady
        ? tr.routeAvailable
        : tr.routeIncomplete,
      barValue: routingScore,
      tone: routingReady ? "success" : "warning",
      rules: [],
      routingDetails: {
        actions: actionLabels,
        profiles: routingProfiles,
        hookFiles: routingHookFiles,
      },
    },
  ];
}

type CompactPreviewSection = {
  label: string;
  items: string[];
};

function buildCompactPreviewSections(card: ReviewDimensionCard, labels: { hooks: string; routing: string; watchPaths: string; evidencePaths: string; boundaries: string; thresholds: string; directories: string }): CompactPreviewSection[] {
  if (card.key === "routing" && card.routingDetails) {
    const hookFiles = takeLabels(card.routingDetails.hookFiles.map((file) => file.relativePath), 2);
    const profiles = takeLabels(card.routingDetails.profiles.map((profile) => formatTokenLabel(profile.name)), 2);
    const actions = takeLabels(card.routingDetails.actions, 2);

    return [
      { label: labels.hooks, items: hookFiles },
      { label: labels.routing, items: profiles.length ? profiles : actions },
    ].filter((section) => section.items.length > 0);
  }

  if (card.key === "risk") {
    return [{ label: labels.watchPaths, items: takeLabels(card.rules.flatMap((rule) => rule.paths), 3) }]
      .filter((section) => section.items.length > 0);
  }

  if (card.key === "confidence") {
    return [
      { label: labels.watchPaths, items: takeLabels(card.rules.flatMap((rule) => rule.paths), 2) },
      { label: labels.evidencePaths, items: takeLabels(card.rules.flatMap((rule) => rule.evidencePaths), 2) },
    ].filter((section) => section.items.length > 0);
  }

  const thresholds = takeLabels(card.rules.flatMap(buildThresholdTokens), 3);
  const boundaries = takeLabels(card.rules.flatMap((rule) => rule.boundaries.map((boundary) => formatTokenLabel(boundary.name))), 2);
  const directories = takeLabels(card.rules.flatMap((rule) => rule.directories), 2);

  return [
    { label: labels.boundaries, items: boundaries },
    { label: labels.thresholds, items: thresholds.length ? thresholds : directories },
  ].filter((section) => section.items.length > 0);
}

function DetailLabel({ children }: { children: string }) {
  return (
    <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
      {children}
    </div>
  );
}

function CodeTokens({
  items,
  tone,
}: {
  items: string[];
  tone: ReviewDimensionTone;
}) {
  if (!items.length) {
    return null;
  }

  const styles = TONE_STYLES[tone];
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className={`rounded-md border px-2 py-1 font-mono text-[10px] leading-4 break-all ${styles.tag}`}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function DetailGroup({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: ReviewDimensionTone;
}) {
  if (!items.length) {
    return null;
  }

  return (
    <div className="mt-2">
      <DetailLabel>{label}</DetailLabel>
      <CodeTokens items={items} tone={tone} />
    </div>
  );
}

function BoundaryGroup({
  boundaries,
  tone,
  label,
}: {
  boundaries: ReviewTriggerBoundarySummary[];
  tone: ReviewDimensionTone;
  label: string;
}) {
  if (!boundaries.length) {
    return null;
  }

  return (
    <div className="mt-2">
      <DetailLabel>{label}</DetailLabel>
      <div className="mt-1.5 grid gap-1.5">
        {boundaries.map((boundary) => (
          <div key={boundary.name} className="rounded-sm border border-desktop-border bg-desktop-bg-primary/80 px-2.5 py-2">
            <div className="text-[10px] font-medium text-desktop-text-primary">
              {formatTokenLabel(boundary.name)}
            </div>
            <CodeTokens items={boundary.paths} tone={tone} />
          </div>
        ))}
      </div>
    </div>
  );
}

function RuleDetailCard({
  rule,
  tone,
  labels,
}: {
  rule: ReviewTriggerRuleSummary;
  tone: ReviewDimensionTone;
  labels: { watchPaths: string; evidencePaths: string; boundaries: string; directories: string; thresholds: string };
}) {
  const styles = TONE_STYLES[tone];
  const thresholdTokens = buildThresholdTokens(rule);

  return (
    <div className={`rounded-sm border px-3 py-2.5 ${styles.detailSurface}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-[11px] font-semibold text-desktop-text-primary">{formatRuleLabel(rule.name)}</div>
        <div className="flex flex-wrap gap-1">
          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${styles.pill}`}>
            {rule.severity}
          </span>
          <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5 text-[9px] text-desktop-text-secondary">
            {formatTokenLabel(rule.type)}
          </span>
        </div>
      </div>

      <DetailGroup label={labels.watchPaths} items={rule.paths} tone={tone} />
      <DetailGroup label={labels.evidencePaths} items={rule.evidencePaths} tone={tone} />
      <BoundaryGroup boundaries={rule.boundaries} tone={tone} label={labels.boundaries} />
      <DetailGroup label={labels.directories} items={rule.directories} tone={tone} />
      <DetailGroup label={labels.thresholds} items={thresholdTokens} tone={tone} />
    </div>
  );
}

function RoutingDetailCard({
  details,
  tone,
  labels,
}: {
  details: ReviewRoutingDetails;
  tone: ReviewDimensionTone;
  labels: { hooks: string; fallbackMetrics: string; triggerCommand: string };
}) {
  return (
    <div className="grid gap-2">
      <DetailGroup label="Review actions" items={details.actions} tone={tone} />

      {details.profiles.length ? (
        <div className="grid gap-2">
          {details.profiles.map((profile) => (
            <div key={profile.name} className={`rounded-sm border px-3 py-2.5 ${TONE_STYLES[tone].detailSurface}`}>
              <div className="text-[11px] font-semibold text-desktop-text-primary">
                {formatTokenLabel(profile.name)}
              </div>
              <DetailGroup label="Phases" items={profile.phases.map(formatTokenLabel)} tone={tone} />
              <DetailGroup label={labels.hooks} items={profile.hooks} tone={tone} />
              <DetailGroup
                label={labels.fallbackMetrics}
                items={profile.fallbackMetrics}
                tone={tone}
              />
            </div>
          ))}
        </div>
      ) : null}

      {details.hookFiles.length ? (
        <div className="grid gap-2">
          {details.hookFiles.map((file) => (
            <div key={file.relativePath} className={`rounded-sm border px-3 py-2.5 ${TONE_STYLES[tone].detailSurface}`}>
              <div className="text-[11px] font-semibold text-desktop-text-primary">{file.relativePath}</div>
              <DetailGroup label={labels.triggerCommand} items={[file.triggerCommand]} tone={tone} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CompactPreview({
  card,
  labels,
}: {
  card: ReviewDimensionCard;
  labels: { hooks: string; routing: string; watchPaths: string; evidencePaths: string; boundaries: string; thresholds: string; directories: string };
}) {
  const sections = buildCompactPreviewSections(card, labels);
  if (!sections.length) {
    return null;
  }

  return (
    <div className="mt-2.5 border-t border-black/8 pt-2.5">
      <div className="grid gap-2">
        {sections.map((section) => (
          <div key={`${card.key}-${section.label}`}>
            <DetailLabel>{section.label}</DetailLabel>
            <CodeTokens items={section.items} tone={card.tone} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function HarnessReviewTriggersPanel({
  repoLabel: _repoLabel,
  unsupportedMessage,
  data,
  loading = false,
  error = null,
  variant = "full",
  showDetailToggle = false,
  defaultShowDetails = true,
  hideHeader = false,
}: ReviewTriggersPanelProps) {
  const { t } = useTranslation();
  const reviewTriggerFile = data?.reviewTriggerFile ?? null;
  const profiles = data?.profiles ?? [];
  const hookFiles = data?.hookFiles ?? [];
  const reviewProfiles = profiles.filter((profile) => profile.phases.includes("review"));
  const reviewHooks = uniqueLabels(reviewProfiles.flatMap((profile) => profile.hooks));
  const compactMode = variant === "compact";
  const canToggleDetails = compactMode && showDetailToggle;
  const [showDetails, setShowDetails] = useState(defaultShowDetails);
  const cards = reviewTriggerFile
    ? buildReviewDimensionCards(reviewTriggerFile.rules, reviewProfiles, reviewHooks, hookFiles, t.harness.reviewTriggers)
    : [];
  const detailsVisible = canToggleDetails ? showDetails : true;

  return (
    <HarnessSectionCard
      title={t.harness.reviewTriggers.title}
      hideHeader={hideHeader}
      variant={variant}
      actions={
        canToggleDetails && reviewTriggerFile && reviewTriggerFile.rules.length ? (
          <button
            type="button"
            className="rounded-sm border border-desktop-border bg-desktop-bg-primary/65 px-2.5 py-1 text-[10px] font-semibold text-desktop-text-primary transition-colors hover:bg-desktop-bg-primary"
            onClick={() => setShowDetails((current) => !current)}
          >
            {detailsVisible ? t.harness.reviewTriggers.hideDetails : t.harness.reviewTriggers.showDetails}
          </button>
        ) : null
      }
    >
      {loading ? (
        <HarnessSectionStateFrame tone="warning">{t.harness.reviewTriggers.loadingPolicies}</HarnessSectionStateFrame>
      ) : null}

      {unsupportedMessage ? (
        <HarnessUnsupportedState className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-5 text-[11px] text-amber-800" />
      ) : null}

      {error && !unsupportedMessage ? (
        <HarnessSectionStateFrame tone="error">{error}</HarnessSectionStateFrame>
      ) : null}

      {!loading && !error && !unsupportedMessage && !reviewTriggerFile ? (
        <HarnessSectionStateFrame tone="warning">
          {t.harness.reviewTriggers.noYamlFile}
        </HarnessSectionStateFrame>
      ) : null}

      {!loading && !error && !unsupportedMessage && reviewTriggerFile && !reviewTriggerFile.rules.length ? (
        <HarnessSectionStateFrame tone="warning">
          {t.harness.reviewTriggers.yamlLoadedNoEntries}
        </HarnessSectionStateFrame>
      ) : null}

      {!loading && !error && !unsupportedMessage && reviewTriggerFile && reviewTriggerFile.rules.length ? (
        <div className={cardGridClass(compactMode)}>
          {cards.map((card) => {
            const styles = TONE_STYLES[card.tone];
            return (
              <article
                key={card.key}
                className={`rounded-sm border bg-desktop-bg-primary/80 px-3.5 py-3 ${styles.border}`}
              >
                <div className={`mb-3 h-1 rounded-sm ${styles.accent}`} aria-hidden="true">
                  <div
                    className={`h-full rounded-sm transition-[width] duration-300 ${styles.bar}`}
                    style={{ width: `${Math.max(12, card.barValue * 100)}%` }}
                  />
                </div>

                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-[14px] font-semibold text-desktop-text-primary">{card.title}</h4>
                  <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${styles.pill}`}>
                    {card.value}
                  </span>
                </div>

                <p className="mt-1.5 text-[11px] leading-4 text-desktop-text-secondary">{card.subtitle}</p>

                {detailsVisible ? (
                  <div className="mt-2.5 border-t border-desktop-border pt-2.5">
                    {card.key === "routing" && card.routingDetails ? (
                      <RoutingDetailCard details={card.routingDetails} tone={card.tone} labels={{
                        hooks: t.harness.reviewTriggers.compactHooks,
                        fallbackMetrics: t.harness.reviewTriggers.detailFallbackMetrics,
                        triggerCommand: t.harness.reviewTriggers.detailTriggerCommand,
                      }} />
                    ) : (
                      <div className="grid gap-2">
                        {card.rules.map((rule) => (
                          <RuleDetailCard key={`${card.key}-${rule.name}`} rule={rule} tone={card.tone} labels={{
                            watchPaths: t.harness.reviewTriggers.compactWatchPaths,
                            evidencePaths: t.harness.reviewTriggers.compactEvidencePaths,
                            boundaries: t.harness.reviewTriggers.compactBoundaries,
                            directories: t.harness.reviewTriggers.compactDirectories,
                            thresholds: t.harness.reviewTriggers.compactThresholds,
                          }} />
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <CompactPreview card={card} labels={{
                    hooks: t.harness.reviewTriggers.compactHooks,
                    routing: t.harness.reviewTriggers.compactRouting,
                    watchPaths: t.harness.reviewTriggers.compactWatchPaths,
                    evidencePaths: t.harness.reviewTriggers.compactEvidencePaths,
                    boundaries: t.harness.reviewTriggers.compactBoundaries,
                    thresholds: t.harness.reviewTriggers.compactThresholds,
                    directories: t.harness.reviewTriggers.compactDirectories,
                  }} />
                )}
              </article>
            );
          })}
        </div>
      ) : null}
    </HarnessSectionCard>
  );
}
