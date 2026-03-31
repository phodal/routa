"use client";
import { HarnessSectionCard, HarnessSectionStateFrame } from "@/client/components/harness-section-card";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import type {
  DesignDecisionArtifact,
  DesignDecisionConfidence,
  DesignDecisionResponse,
  DesignDecisionSource,
  DesignDecisionSourceKind,
  DesignDecisionSourceStatus,
} from "@/core/harness/design-decision-types";

type HarnessDesignDecisionPanelProps = {
  repoLabel: string;
  unsupportedMessage?: string | null;
  data?: DesignDecisionResponse | null;
  loading?: boolean;
  error?: string | null;
  variant?: "full" | "compact";
};

const SOURCE_KIND_LABELS: Record<DesignDecisionSourceKind, string> = {
  "canonical-doc": "Canonical Doc",
  "decision-records": "Decision Records",
};

const SOURCE_STATUS_LABELS: Record<DesignDecisionSourceStatus, string> = {
  "documents-present": "Has Documents",
  missing: "Missing",
};

const ARTIFACT_TYPE_LABELS: Record<DesignDecisionArtifact["type"], string> = {
  architecture: "Architecture",
  adr: "ADR",
};

const CONFIDENCE_STYLES: Record<DesignDecisionConfidence, { bg: string; text: string }> = {
  high: { bg: "bg-emerald-100", text: "text-emerald-700" },
  medium: { bg: "bg-amber-100", text: "text-amber-700" },
  low: { bg: "bg-zinc-100", text: "text-zinc-500" },
};

function ConfidenceBadge({ confidence }: { confidence: DesignDecisionConfidence }) {
  const style = CONFIDENCE_STYLES[confidence];
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${style.bg} ${style.text}`}>
      {confidence}
    </span>
  );
}

function SourceKindBadge({ kind }: { kind: DesignDecisionSourceKind }) {
  return (
    <span className="inline-flex items-center rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-medium text-sky-700">
      {SOURCE_KIND_LABELS[kind]}
    </span>
  );
}

function SourceStatusBadge({ status }: { status: DesignDecisionSourceStatus }) {
  return (
    <span className="inline-flex items-center rounded-full border border-desktop-border bg-desktop-bg-secondary px-1.5 py-0.5 text-[9px] font-medium text-desktop-text-secondary">
      {SOURCE_STATUS_LABELS[status]}
    </span>
  );
}

function ArtifactTypeTag({ type }: { type: DesignDecisionArtifact["type"] }) {
  return (
    <span className="inline-flex items-center rounded border border-desktop-border bg-desktop-bg-primary px-1.5 py-0.5 text-[9px] font-mono text-desktop-text-secondary">
      {ARTIFACT_TYPE_LABELS[type]}
    </span>
  );
}

function DecisionArtifactListRow({ artifact }: { artifact: DesignDecisionArtifact }) {
  return (
    <div className="flex items-center gap-2 rounded px-1.5 py-1 text-[10px] hover:bg-desktop-bg-secondary/60">
      <ArtifactTypeTag type={artifact.type} />
      <span className="min-w-0 flex-1 truncate text-desktop-text-primary" title={artifact.title}>
        {artifact.title}
      </span>
      <span className="truncate font-mono text-desktop-text-secondary" title={artifact.path}>
        {artifact.path.split("/").pop() ?? artifact.path}
      </span>
    </div>
  );
}

function DecisionSourceCard({ source }: { source: DesignDecisionSource }) {
  return (
    <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80">
      <div className="flex items-start gap-3 px-3 py-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-desktop-border bg-desktop-bg-secondary text-[10px] font-bold text-desktop-text-primary">
          {source.kind === "canonical-doc" ? "A" : "ADR"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold text-desktop-text-primary">{source.label}</span>
            <SourceKindBadge kind={source.kind} />
            <ConfidenceBadge confidence={source.confidence} />
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <SourceStatusBadge status={source.status} />
            <span className="text-[10px] text-desktop-text-secondary">{source.rootPath}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5 text-[10px] text-desktop-text-secondary">
            {source.artifacts.length} doc{source.artifacts.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <div className="space-y-1 border-t border-desktop-border px-3 py-3">
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
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">{title}</div>
        <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5 text-[10px] text-desktop-text-secondary">
          {sources.length}
        </span>
      </div>
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
}: HarnessDesignDecisionPanelProps) {
  const sources = data?.sources ?? [];

  if (unsupportedMessage) {
    return <HarnessUnsupportedState />;
  }

  const visibleSources = variant === "compact" ? sources.slice(0, 3) : sources;
  const groupedSources = groupSourcesByCategory(visibleSources);

  return (
    <HarnessSectionCard
      title="Design Decisions"
      eyebrow="Governance"
      variant={variant}
      dataTestId="design-decision-panel"
    >
      {loading ? (
        <HarnessSectionStateFrame>Loading architecture contract and ADRs…</HarnessSectionStateFrame>
      ) : error ? (
        <HarnessSectionStateFrame tone="error">{error}</HarnessSectionStateFrame>
      ) : !data || data.sources.length === 0 ? (
        <HarnessSectionStateFrame tone="warning">
          No architecture contract or ADR decisions are currently available for this repository.
        </HarnessSectionStateFrame>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="space-y-3">
            <SourceGroup
              title="Canonical docs"
              sources={groupedSources.canonicalDocs}
            />
            <SourceGroup
              title="Decision records"
              sources={groupedSources.decisionRecords}
            />
          </div>

          {variant === "compact" && sources.length > visibleSources.length ? (
            <HarnessSectionStateFrame>
              Showing {visibleSources.length} of {sources.length} architecture decision sources in compact mode.
            </HarnessSectionStateFrame>
          ) : null}

          {data.warnings.length > 0 ? (
            <HarnessSectionStateFrame tone="warning">
              {data.warnings.join(" ")}
            </HarnessSectionStateFrame>
          ) : null}
        </div>
      )}
    </HarnessSectionCard>
  );
}
