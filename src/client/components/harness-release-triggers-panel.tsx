"use client";

import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import { HarnessSectionCard, HarnessSectionStateFrame } from "@/client/components/harness-section-card";
import type {
  HooksResponse,
  ReleaseTriggerRuleSummary,
} from "@/client/hooks/use-harness-settings-data";

type ReleaseTriggersPanel = {
  repoLabel: string;
  unsupportedMessage?: string | null;
  data?: HooksResponse | null;
  loading?: boolean;
  error?: string | null;
  variant?: "full" | "compact";
};

type ReleaseDimensionTone = "danger" | "warning" | "info" | "success";

type ReleaseDimensionCard = {
  key: "exposure" | "drift" | "boundary" | "capability";
  title: string;
  value: string;
  subtitle: string;
  barValue: number;
  tone: ReleaseDimensionTone;
  rules: ReleaseTriggerRuleSummary[];
};

const TONE_STYLES: Record<
  ReleaseDimensionTone,
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

const ACTION_STYLES: Record<string, string> = {
  block_release: "border-rose-200 bg-rose-50 text-rose-700",
  require_human_review: "border-amber-200 bg-amber-50 text-amber-800",
  warn: "border-sky-200 bg-sky-50 text-sky-700",
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

function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(0)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${bytes} B`;
}

function scoreSeverity(severity: string): number {
  if (severity === "critical") return 4;
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

function toneFromScore(score: number): ReleaseDimensionTone {
  if (score >= 0.75) return "danger";
  if (score >= 0.45) return "warning";
  return "info";
}

function isExposureRule(rule: ReleaseTriggerRuleSummary): boolean {
  return rule.type === "unexpected_file";
}

function isDriftRule(rule: ReleaseTriggerRuleSummary): boolean {
  return rule.type === "artifact_size_delta";
}

function isBoundaryRule(rule: ReleaseTriggerRuleSummary): boolean {
  return rule.type === "release_boundary_change";
}

function isCapabilityRule(rule: ReleaseTriggerRuleSummary): boolean {
  return rule.type === "capability_change";
}

function calculateDimensionScore(rules: ReleaseTriggerRuleSummary[], maxSeverity: number): number {
  return rules.length
    ? clamp(rules.reduce((sum, rule) => sum + scoreSeverity(rule.severity), 0) / (rules.length * maxSeverity))
    : 0;
}

function buildReleaseDimensionCards(rules: ReleaseTriggerRuleSummary[]): ReleaseDimensionCard[] {
  const exposureRules = rules.filter(isExposureRule);
  const driftRules = rules.filter(isDriftRule);
  const boundaryRules = rules.filter(isBoundaryRule);
  const capabilityRules = rules.filter(isCapabilityRule);

  const exposureScore = calculateDimensionScore(exposureRules, 4);
  const driftScore = calculateDimensionScore(driftRules, 3);
  const boundaryScore = calculateDimensionScore(boundaryRules, 3);
  const capabilityScore = calculateDimensionScore(capabilityRules, 3);

  return [
    {
      key: "exposure",
      title: "Layer 1: Exposure",
      value: exposureRules.length ? formatCount(exposureRules.length, "rule") : "No rules",
      subtitle: exposureRules.length
        ? "Blocks forbidden files (e.g. *.map) from appearing in release artifacts."
        : "No release exposure rules are configured.",
      barValue: exposureScore,
      tone: exposureRules.length ? toneFromScore(exposureScore) : "info",
      rules: exposureRules,
    },
    {
      key: "drift",
      title: "Layer 2: Artifact Drift",
      value: driftRules.length ? formatCount(driftRules.length, "rule") : "No rules",
      subtitle: driftRules.length
        ? "Detects abnormal binary, tarball, or bundle size growth against the baseline."
        : "No artifact size-delta rules are configured.",
      barValue: driftScore,
      tone: driftRules.length ? toneFromScore(driftScore) : "info",
      rules: driftRules,
    },
    {
      key: "boundary",
      title: "Layer 3: Boundary Drift",
      value: boundaryRules.length ? formatCount(boundaryRules.length, "rule") : "No rules",
      subtitle: boundaryRules.length
        ? "Flags packaging config changes that may silently widen the release surface."
        : "No packaging boundary rules are configured.",
      barValue: boundaryScore,
      tone: boundaryRules.length ? toneFromScore(boundaryScore) : "info",
      rules: boundaryRules,
    },
    {
      key: "capability",
      title: "Layer 4: Capability Drift",
      value: capabilityRules.length ? formatCount(capabilityRules.length, "rule") : "No rules",
      subtitle: capabilityRules.length
        ? "Monitors supply-chain, Tauri capabilities, and workflow permission changes."
        : "No supply-chain or capability rules are configured.",
      barValue: capabilityScore,
      tone: capabilityRules.length ? toneFromScore(capabilityScore) : "info",
      rules: capabilityRules,
    },
  ];
}

function ActionBadge({ action }: { action: string }) {
  const style = ACTION_STYLES[action] ?? "border-desktop-border text-desktop-text-secondary";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${style}`}>
      {formatTokenLabel(action)}
    </span>
  );
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
  tone: ReleaseDimensionTone;
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
  tone: ReleaseDimensionTone;
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

function RuleDetailCard({
  rule,
  tone,
}: {
  rule: ReleaseTriggerRuleSummary;
  tone: ReleaseDimensionTone;
}) {
  const styles = TONE_STYLES[tone];

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${styles.detailSurface}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-[11px] font-semibold text-desktop-text-primary">{formatTokenLabel(rule.name)}</div>
        <div className="flex flex-wrap gap-1">
          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${styles.pill}`}>
            {rule.severity}
          </span>
          <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5 text-[9px] text-desktop-text-secondary">
            {formatTokenLabel(rule.type)}
          </span>
          <ActionBadge action={rule.action} />
        </div>
      </div>

      {rule.patterns.length > 0 && (
        <DetailGroup label="Patterns" items={rule.patterns} tone={tone} />
      )}
      {rule.applyTo.length > 0 && (
        <DetailGroup label="Apply to" items={rule.applyTo} tone={tone} />
      )}
      {rule.paths.length > 0 && (
        <DetailGroup label="Watch paths" items={rule.paths} tone={tone} />
      )}
      {(rule.maxGrowthPercent !== null || rule.minGrowthBytes !== null || rule.baseline) && (
        <div className="mt-2">
          <DetailLabel>Thresholds</DetailLabel>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {rule.maxGrowthPercent !== null && (
              <span className={`rounded-md border px-2 py-1 font-mono text-[10px] leading-4 ${styles.tag}`}>
                {`max +${rule.maxGrowthPercent}%`}
              </span>
            )}
            {rule.minGrowthBytes !== null && (
              <span className={`rounded-md border px-2 py-1 font-mono text-[10px] leading-4 ${styles.tag}`}>
                {`>${formatBytes(rule.minGrowthBytes)}`}
              </span>
            )}
            {rule.baseline && (
              <span className={`rounded-md border px-2 py-1 font-mono text-[10px] leading-4 ${styles.tag}`}>
                {`baseline: ${rule.baseline}`}
              </span>
            )}
          </div>
        </div>
      )}
      {rule.groupBy.length > 0 && (
        <DetailGroup label="Group by" items={rule.groupBy} tone={tone} />
      )}
    </div>
  );
}

function DimensionCard({
  card,
  showDetails,
}: {
  card: ReleaseDimensionCard;
  showDetails: boolean;
}) {
  const styles = TONE_STYLES[card.tone];

  return (
    <div className={`rounded-2xl border p-3 ${styles.border} bg-desktop-bg-secondary/70`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
            {card.title}
          </div>
          <div className="mt-1 text-[13px] font-semibold text-desktop-text-primary">
            {card.value}
          </div>
          <div className="mt-1 text-[10px] leading-relaxed text-desktop-text-secondary">
            {card.subtitle}
          </div>
        </div>
      </div>

      <div className={`mt-2.5 h-1 w-full overflow-hidden rounded-full ${styles.accent}`}>
        <div
          className={`h-full rounded-full ${styles.bar} transition-all`}
          style={{ width: `${Math.round(card.barValue * 100)}%` }}
        />
      </div>

      {showDetails && card.rules.length > 0 && (
        <div className="mt-2.5 space-y-2">
          {card.rules.map((rule) => (
            <RuleDetailCard key={rule.name} rule={rule} tone={card.tone} />
          ))}
        </div>
      )}

      {!showDetails && card.rules.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.rules.slice(0, 3).map((rule) => (
            <span
              key={rule.name}
              className={`rounded-md border px-2 py-1 font-mono text-[10px] leading-4 ${styles.tag}`}
            >
              {formatTokenLabel(rule.name)}
            </span>
          ))}
          {card.rules.length > 3 && (
            <span className="rounded-md border border-desktop-border px-2 py-1 text-[10px] text-desktop-text-secondary">
              +{card.rules.length - 3} more
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function HarnessReleaseTriggersPanel({
  repoLabel,
  unsupportedMessage,
  data,
  loading,
  error,
  variant = "full",
}: ReleaseTriggersPanel) {
  const releaseTriggerFile = data?.releaseTriggerFile ?? null;
  const showDetails = variant === "full";

  const cards = releaseTriggerFile
    ? buildReleaseDimensionCards(releaseTriggerFile.rules)
    : [];

  const blockReleaseCount = releaseTriggerFile?.rules.filter((rule) => rule.action === "block_release").length ?? 0;
  const requireReviewCount = releaseTriggerFile?.rules.filter((rule) => rule.action === "require_human_review").length ?? 0;
  const warnCount = releaseTriggerFile?.rules.filter((rule) => rule.action === "warn").length ?? 0;

  return (
    <HarnessSectionCard
      title="Release Surface Governance"
      description="Layered triggers that guard what goes into each release: exposure surface, artifact drift, packaging boundary changes, and supply-chain capability drift."
      variant={variant}
      badge={releaseTriggerFile ? `${releaseTriggerFile.ruleCount} rules` : undefined}
    >
      <HarnessSectionStateFrame
        loading={!!loading}
        error={error ?? null}
        unsupportedMessage={unsupportedMessage ?? null}
        repoLabel={repoLabel}
      >
        {!loading && !error && !unsupportedMessage && !releaseTriggerFile ? (
          <div className="rounded-lg border border-desktop-border bg-desktop-bg-primary/80 px-3 py-3 text-[11px] text-desktop-text-secondary">
            No <code className="font-mono">docs/fitness/release-triggers.yaml</code> found for this repository.
          </div>
        ) : null}

        {!loading && !error && !unsupportedMessage && releaseTriggerFile && !releaseTriggerFile.rules.length ? (
          <div className="rounded-lg border border-desktop-border bg-desktop-bg-primary/80 px-3 py-3 text-[11px] text-desktop-text-secondary">
            <code className="font-mono">release-triggers.yaml</code> exists but defines no rules.
          </div>
        ) : null}

        {!loading && !error && !unsupportedMessage && releaseTriggerFile && releaseTriggerFile.rules.length ? (
          <div>
            <div className="flex flex-wrap gap-2 mb-2.5">
              {blockReleaseCount > 0 && (
                <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-semibold text-rose-700">
                  {formatCount(blockReleaseCount, "block")} release
                </span>
              )}
              {requireReviewCount > 0 && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-800">
                  {formatCount(requireReviewCount, "human review")}
                </span>
              )}
              {warnCount > 0 && (
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-semibold text-sky-700">
                  {formatCount(warnCount, "warn")}
                </span>
              )}
            </div>

            <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
              {cards.map((card) => (
                <DimensionCard key={card.key} card={card} showDetails={showDetails} />
              ))}
            </div>
          </div>
        ) : null}

        {unsupportedMessage ? <HarnessUnsupportedState /> : null}
      </HarnessSectionStateFrame>
    </HarnessSectionCard>
  );
}
