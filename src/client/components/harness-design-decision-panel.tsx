"use client";
import { HarnessSectionCard, HarnessSectionStateFrame } from "@/client/components/harness-section-card";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import { useTranslation } from "@/i18n";
import type {
  DesignDecisionArtifact,
  DesignDecisionConfidence,
  DesignDecisionStatus,
  DesignDecisionResponse,
  DesignDecisionSource,
} from "@/core/harness/design-decision-types";

type HarnessDesignDecisionPanelProps = {
  repoLabel: string;
  unsupportedMessage?: string | null;
  data?: DesignDecisionResponse | null;
  loading?: boolean;
  error?: string | null;
  variant?: "full" | "compact";
  hideHeader?: boolean;
};

const CONFIDENCE_STYLES: Record<DesignDecisionConfidence, { bg: string; text: string }> = {
  high: { bg: "bg-emerald-100", text: "text-emerald-700" },
  medium: { bg: "bg-amber-100", text: "text-amber-700" },
  low: { bg: "bg-zinc-100", text: "text-zinc-500" },
};

const DECISION_STATUS_STYLES: Record<DesignDecisionStatus, { bg: string; text: string; label: string }> = {
  canonical: { bg: "bg-sky-100", text: "text-sky-700", label: "Canonical" },
  accepted: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Accepted" },
  superseded: { bg: "bg-amber-100", text: "text-amber-700", label: "Superseded" },
  deprecated: { bg: "bg-zinc-200", text: "text-zinc-700", label: "Deprecated" },
  unknown: { bg: "bg-zinc-100", text: "text-zinc-500", label: "Unknown" },
};

function ConfidenceBadge({ confidence }: { confidence: DesignDecisionConfidence }) {
  const { t } = useTranslation();
  const style = CONFIDENCE_STYLES[confidence];
  const confidenceLabels: Record<DesignDecisionConfidence, string> = {
    high: t.harness.designDecision.confidenceHigh,
    medium: t.harness.designDecision.confidenceMedium,
    low: t.harness.designDecision.confidenceLow,
  };
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${style.bg} ${style.text}`}>
      {confidenceLabels[confidence]}
    </span>
  );
}

function DecisionStatusBadge({ status }: { status: DesignDecisionStatus }) {
  const { t } = useTranslation();
  const style = DECISION_STATUS_STYLES[status];
  const statusLabelMap: Record<DesignDecisionStatus, string> = {
    canonical: t.harness.designDecision.statusCanonical,
    accepted: t.harness.designDecision.statusAccepted,
    superseded: t.harness.designDecision.statusSuperseded,
    deprecated: t.harness.designDecision.statusDeprecated,
    unknown: t.harness.designDecision.statusUnknown,
  };
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium ${style.bg} ${style.text}`}>
      {statusLabelMap[status]}
    </span>
  );
}

function DecisionArtifactListRow({ artifact }: { artifact: DesignDecisionArtifact }) {
  return (
    <div className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[11px] hover:bg-desktop-bg-secondary/60">
      <span className="min-w-0 flex-1 truncate text-desktop-text-primary" title={artifact.title}>
        {artifact.title}
      </span>
      {artifact.type === "adr" ? <DecisionStatusBadge status={artifact.status} /> : null}
      <span className="shrink-0 truncate font-mono text-[10px] text-desktop-text-secondary" title={artifact.path}>
        {artifact.path.split("/").pop() ?? artifact.path}
      </span>
    </div>
  );
}

function DecisionSourceCard({ source }: { source: DesignDecisionSource }) {
  if (source.kind === "canonical-doc" && source.artifacts.length === 1) {
    const artifact = source.artifacts[0];
    return (
      <div className="rounded-sm border border-desktop-border bg-desktop-bg-primary/80 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-desktop-text-primary">{artifact.title}</div>
            <div className="mt-1 text-[10px] text-desktop-text-secondary">{artifact.path}</div>
          </div>
          <ConfidenceBadge confidence={source.confidence} />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-sm border border-desktop-border bg-desktop-bg-primary/80">
      <div className="px-3 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] font-semibold text-desktop-text-primary">{source.label}</span>
            <ConfidenceBadge confidence={source.confidence} />
          </div>
          <div className="mt-1 text-[10px] text-desktop-text-secondary">{source.rootPath}</div>
        </div>
      </div>

      <div className="space-y-1 border-t border-desktop-border px-3 py-2">
        {source.artifacts.map((artifact) => <DecisionArtifactListRow key={artifact.id} artifact={artifact} />)}
      </div>
    </div>
  );
}

function groupSourcesByCategory(sources: DesignDecisionSource[]) {
  return {
    canonicalDocs: sources.filter((source) => source.kind === "canonical-doc"),
    decisionRecords: sources.filter((source) => source.kind === "decision-records"),
  };
}

function SourceGroup({
  title,
  sources,
}: {
  title: string;
  sources: DesignDecisionSource[];
}) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">{title}</div>
      <div className="space-y-3">
        {sources.map((source) => (
          <DecisionSourceCard
            key={source.label}
            source={source}
          />
        ))}
      </div>
    </div>
  );
}

export function HarnessDesignDecisionPanel({
  repoLabel: _repoLabel,
  unsupportedMessage,
  data,
  loading,
  error,
  variant = "full",
  hideHeader = false,
}: HarnessDesignDecisionPanelProps) {
  const { t } = useTranslation();
  const sources = data?.sources ?? [];
  const warnings = data?.warnings ?? [];

  if (unsupportedMessage) {
    return <HarnessUnsupportedState />;
  }

  const visibleSources = variant === "compact" ? sources.slice(0, 3) : sources;
  const groupedSources = groupSourcesByCategory(visibleSources);

  return (
    <HarnessSectionCard
      title={t.harness.designDecision.title}
      hideHeader={hideHeader}
      variant={variant}
      dataTestId="design-decision-panel"
    >
      {loading ? (
        <HarnessSectionStateFrame>{t.harness.designDecision.loadingAdrs}</HarnessSectionStateFrame>
      ) : error ? (
        <HarnessSectionStateFrame tone="error">{error}</HarnessSectionStateFrame>
      ) : !data || sources.length === 0 ? (
        <HarnessSectionStateFrame tone="warning">
          {t.harness.designDecision.noDecisionsAvailable}
        </HarnessSectionStateFrame>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="space-y-3">
            <SourceGroup
              title={t.harness.designDecision.canonicalDocs}
              sources={groupedSources.canonicalDocs}
            />
            <SourceGroup
              title={t.harness.designDecision.decisionRecords}
              sources={groupedSources.decisionRecords}
            />
          </div>

          {variant === "compact" && sources.length > visibleSources.length ? (
            <HarnessSectionStateFrame>
              {t.harness.designDecision.showingCompact.replace("{visible}", String(visibleSources.length)).replace("{total}", String(sources.length))}
            </HarnessSectionStateFrame>
          ) : null}

          {warnings.length > 0 ? (
            <HarnessSectionStateFrame tone="warning">
              {warnings.join(" ")}
            </HarnessSectionStateFrame>
          ) : null}
        </div>
      )}
    </HarnessSectionCard>
  );
}
