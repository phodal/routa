"use client";

import { useState } from "react";
import { HarnessSectionCard, HarnessSectionStateFrame } from "@/client/components/harness-section-card";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import type {
  DesignDecisionArtifact,
  DesignDecisionConfidence,
  DesignDecisionResponse,
  DesignDecisionSource,
  DesignDecisionSourceKind,
  DesignDecisionSourceStatus,
  DesignDecisionStatus,
} from "@/core/harness/design-decision-types";

type HarnessDesignDecisionPanelProps = {
  repoLabel: string;
  unsupportedMessage?: string | null;
  data?: DesignDecisionResponse | null;
  loading?: boolean;
  error?: string | null;
  variant?: "full" | "compact";
};

const STATUS_LABELS: Record<DesignDecisionStatus, string> = {
  canonical: "Canonical",
  accepted: "Accepted",
  superseded: "Superseded",
  deprecated: "Deprecated",
  unknown: "Unknown",
};

const SOURCE_KIND_LABELS: Record<DesignDecisionSourceKind, string> = {
  "canonical-doc": "Canonical Doc",
  "decision-records": "Decision Records",
};

const SOURCE_STATUS_LABELS: Record<DesignDecisionSourceStatus, string> = {
  "documents-present": "Has Documents",
  missing: "Missing",
};

const CONFIDENCE_STYLES: Record<DesignDecisionConfidence, { bg: string; text: string }> = {
  high: { bg: "bg-emerald-100", text: "text-emerald-700" },
  medium: { bg: "bg-amber-100", text: "text-amber-700" },
  low: { bg: "bg-zinc-100", text: "text-zinc-500" },
};

function DecisionStatusBadge({ status }: { status: DesignDecisionStatus }) {
  const className = status === "canonical" || status === "accepted"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : status === "superseded" || status === "deprecated"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-zinc-200 bg-zinc-50 text-zinc-600";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-medium ${className}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

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

function DecisionArtifactCard({ artifact }: { artifact: DesignDecisionArtifact }) {
  return (
    <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-desktop-text-primary">{artifact.title}</div>
          <div className="mt-0.5 text-[10px] font-mono text-desktop-text-secondary">{artifact.path}</div>
        </div>
        <DecisionStatusBadge status={artifact.status} />
      </div>

      {artifact.summary ? (
        <p className="mt-2 text-[11px] leading-5 text-desktop-text-secondary">{artifact.summary}</p>
      ) : null}

      {artifact.codeRefs.length > 0 ? (
        <div className="mt-3 rounded-lg border border-desktop-border bg-desktop-bg-secondary/50 px-2.5 py-2">
          <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Code references</div>
          <div className="mt-1 space-y-1">
            {artifact.codeRefs.slice(0, 3).map((codeRef) => (
              <div key={codeRef} className="text-[10px] font-mono text-desktop-text-primary">{codeRef}</div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DecisionSourceCard({ source, expanded, onToggle }: {
  source: DesignDecisionSource;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`rounded-xl border transition-colors ${
      expanded ? "border-desktop-accent bg-desktop-bg-primary" : "border-desktop-border bg-desktop-bg-primary/80 hover:bg-desktop-bg-primary"
    }`}>
      <button
        type="button"
        className="flex w-full items-start gap-3 px-3 py-2 text-left"
        onClick={onToggle}
      >
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
          <svg
            className={`h-3.5 w-3.5 text-desktop-text-secondary transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded ? (
        <div className="space-y-3 border-t border-desktop-border px-3 py-3">
          {source.artifacts.map((artifact) => <DecisionArtifactCard key={artifact.id} artifact={artifact} />)}
        </div>
      ) : null}
    </div>
  );
}

export function HarnessDesignDecisionPanel({
  repoLabel,
  unsupportedMessage,
  data,
  loading,
  error,
  variant = "full",
}: HarnessDesignDecisionPanelProps) {
  const sources = data?.sources ?? [];
  const [expandedSourceIds, setExpandedSourceIds] = useState<Set<string> | null>(null);
  const activeExpandedSourceIds = expandedSourceIds ?? new Set<string>(sources.slice(0, 1).map((source) => source.label));

  const toggleSource = (sourceId: string) => {
    setExpandedSourceIds((prev) => {
      const next = new Set(prev ?? activeExpandedSourceIds);
      if (next.has(sourceId)) next.delete(sourceId); else next.add(sourceId);
      return next;
    });
  };

  if (unsupportedMessage) {
    return <HarnessUnsupportedState />;
  }

  const artifactCount = sources.reduce((sum, source) => sum + source.artifacts.length, 0);
  const activeArtifactCount = sources.reduce((sum, source) => (
    sum + source.artifacts.filter((artifact) => artifact.status === "canonical" || artifact.status === "accepted").length
  ), 0);
  const visibleSources = variant === "compact" ? sources.slice(0, 3) : sources;

  return (
    <HarnessSectionCard
      title="Design Decisions"
      eyebrow="Governance"
      description={`Architecture and ADR sources discovered for ${repoLabel}.`}
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
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-3 py-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-desktop-text-secondary">Sources</div>
              <div className="mt-2 text-2xl font-semibold text-desktop-text-primary">{sources.length}</div>
            </div>
            <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-3 py-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-desktop-text-secondary">Documents</div>
              <div className="mt-2 text-2xl font-semibold text-desktop-text-primary">{artifactCount}</div>
            </div>
            <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-3 py-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-desktop-text-secondary">Active decisions</div>
              <div className="mt-2 text-2xl font-semibold text-desktop-text-primary">{activeArtifactCount}</div>
            </div>
          </div>

          <div className="space-y-3">
            {visibleSources.map((source) => (
              <DecisionSourceCard
                key={source.label}
                source={source}
                expanded={activeExpandedSourceIds.has(source.label)}
                onToggle={() => toggleSource(source.label)}
              />
            ))}
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
