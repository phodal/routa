"use client";

import { useMemo, useState } from "react";
import type {
  SpecConfidence,
  SpecDetectionResponse,
  SpecFeature,
  SpecSource,
  SpecSourceKind,
  SpecStatus,
} from "@/core/harness/spec-detector-types";
import { HarnessSectionCard, HarnessSectionStateFrame } from "@/client/components/harness-section-card";

type SpecSourcesPanelProps = {
  repoLabel: string;
  unsupportedMessage?: string | null;
  data?: SpecDetectionResponse | null;
  loading?: boolean;
  error?: string | null;
  variant?: "full" | "compact";
};

const KIND_LABELS: Record<SpecSourceKind, string> = {
  "native-tool": "Native Tool",
  framework: "Framework",
  "tool-integration": "Integration",
};

const STATUS_LABELS: Record<SpecStatus, string> = {
  "artifacts-present": "Has Specs",
  "installed-only": "Installed Only",
  archived: "Archived",
  legacy: "Legacy",
};

const CONFIDENCE_STYLES: Record<SpecConfidence, { bg: string; text: string }> = {
  high: { bg: "bg-emerald-100", text: "text-emerald-700" },
  medium: { bg: "bg-amber-100", text: "text-amber-700" },
  low: { bg: "bg-zinc-100", text: "text-zinc-500" },
};

const STATUS_STYLES: Record<SpecStatus, { bg: string; text: string; border: string }> = {
  "artifacts-present": { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  "installed-only": { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-200" },
  archived: { bg: "bg-zinc-50", text: "text-zinc-500", border: "border-zinc-200" },
  legacy: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
};

const KIND_STYLES: Record<SpecSourceKind, { bg: string; text: string }> = {
  "native-tool": { bg: "bg-violet-100", text: "text-violet-700" },
  framework: { bg: "bg-sky-100", text: "text-sky-700" },
  "tool-integration": { bg: "bg-zinc-100", text: "text-zinc-600" },
};

const SYSTEM_ICONS: Record<string, string> = {
  kiro: "K",
  qoder: "Q",
  openspec: "OS",
  "spec-kit": "SK",
  bmad: "B",
};

const _TYPE_LABELS: Record<string, string> = {
  requirements: "Requirements",
  design: "Design",
  tasks: "Tasks",
  bugfix: "Bugfix",
  spec: "Spec",
  proposal: "Proposal",
  plan: "Plan",
  prd: "PRD",
  architecture: "Architecture",
  epic: "Epic",
  story: "Story",
  context: "Context",
  config: "Config",
  other: "Other",
};

function groupSourcesByCategory(sources: SpecSource[]) {
  const legacy = sources.filter((s) => s.status === "legacy");
  const activeSources = sources.filter((s) => s.status !== "legacy");
  const nativeTools = activeSources.filter((s) => s.kind === "native-tool");
  const frameworks = activeSources.filter((s) => s.kind === "framework");
  const integrations = activeSources.filter((s) => s.kind === "tool-integration");
  return { nativeTools, frameworks, integrations, legacy };
}

function ConfidenceBadge({ confidence }: { confidence: SpecConfidence }) {
  const style = CONFIDENCE_STYLES[confidence];
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${style.bg} ${style.text}`}>
      {confidence}
    </span>
  );
}

function StatusBadge({ status }: { status: SpecStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${style.bg} ${style.text} ${style.border}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function KindBadge({ kind }: { kind: SpecSourceKind }) {
  const style = KIND_STYLES[kind];
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium ${style.bg} ${style.text}`}>
      {KIND_LABELS[kind]}
    </span>
  );
}

function SpecTypeTag({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center rounded border border-desktop-border bg-desktop-bg-primary px-1.5 py-0.5 text-[9px] font-mono text-desktop-text-secondary">
      {type}
    </span>
  );
}

function ChevronIcon({ expanded, className }: { expanded: boolean; className?: string }) {
  return (
    <svg
      className={`h-3 w-3 text-desktop-text-secondary transition-transform ${expanded ? "rotate-90" : ""} ${className ?? ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function KiroFeatureTree({ features }: { features: SpecFeature[] }) {
  const [expandedFeatures, setExpandedFeatures] = useState<Set<string> | null>(null);
  const activeExpandedFeatures = expandedFeatures ?? new Set<string>();

  const toggle = (name: string) => {
    setExpandedFeatures((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  return (
    <div className="space-y-1">
      {features.map((feature) => {
        const isExpanded = activeExpandedFeatures.has(feature.name);

        return (
          <div key={feature.name}>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[10px] hover:bg-desktop-bg-secondary/60"
              onClick={() => toggle(feature.name)}
            >
              <ChevronIcon expanded={isExpanded} />
              <span className="font-medium text-desktop-text-primary">{feature.name}</span>
              <span className="ml-auto text-[9px] text-desktop-text-secondary">
                {feature.documents.length} doc{feature.documents.length !== 1 ? "s" : ""}
              </span>
            </button>

            {isExpanded && feature.documents.map((doc) => (
              <div key={doc.path} className="ml-5 flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px]">
                <SpecTypeTag type={doc.type} />
                <span className="min-w-0 truncate font-mono text-desktop-text-primary">{doc.path}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function FlatSpecList({ specs }: { specs: SpecSource["children"] }) {
  return (
    <div className="space-y-0.5">
      {specs.map((spec) => (
        <div key={spec.path} className="flex items-center gap-2 rounded px-1.5 py-0.5 text-[10px] hover:bg-desktop-bg-secondary/60">
          <SpecTypeTag type={spec.type} />
          <span className="min-w-0 truncate font-mono text-desktop-text-primary">{spec.path}</span>
        </div>
      ))}
    </div>
  );
}

function SpecSourceCard({ source, expanded, onToggle }: { source: SpecSource; expanded: boolean; onToggle: () => void }) {
  const icon = SYSTEM_ICONS[source.system] ?? source.system.charAt(0).toUpperCase();
  const hasFeatures = source.features && source.features.length > 0;
  const specCount = hasFeatures ? source.features!.length : source.children.length;

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
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold capitalize text-desktop-text-primary">{source.system}</span>
            <KindBadge kind={source.kind} />
            <ConfidenceBadge confidence={source.confidence} />
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <StatusBadge status={source.status} />
            <span className="text-[10px] text-desktop-text-secondary">
              {source.rootPath}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {specCount > 0 && (
            <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5 text-[10px] text-desktop-text-secondary">
              {specCount} spec{specCount !== 1 ? "s" : ""}
            </span>
          )}
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

      {expanded && (
        <div className="max-h-80 overflow-y-auto border-t border-desktop-border px-3 py-2">
          {hasFeatures ? (
            <KiroFeatureTree features={source.features!} />
          ) : source.children.length > 0 ? (
            <FlatSpecList specs={source.children} />
          ) : source.status === "installed-only" ? (
            <div className="rounded-lg border border-sky-200 bg-sky-50/50 px-2.5 py-2 text-[10px] text-sky-700">
              {source.system === "qoder"
                ? "Qoder integration detected. No spec documents found."
                : `${source.system} integration detected, but no spec documents found.`}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SourceGroup({ title, sources, expandedKeys, onToggle }: {
  title: string;
  sources: SpecSource[];
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
}) {
  if (sources.length === 0) return null;

  return (
    <div>
      <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
        {title}
      </div>
      <div className="space-y-1.5">
        {sources.map((source) => {
          const key = `${source.system}-${source.kind}-${source.rootPath}`;
          return (
            <SpecSourceCard
              key={key}
              source={source}
              expanded={expandedKeys.has(key)}
              onToggle={() => onToggle(key)}
            />
          );
        })}
      </div>
    </div>
  );
}

export function HarnessSpecSourcesPanel({
  repoLabel,
  unsupportedMessage,
  data,
  loading,
  error,
  variant = "full",
}: SpecSourcesPanelProps) {
  const sources = useMemo(
    () => data?.sources ?? [],
    [data?.sources],
  );
  const defaultExpandedKeys = useMemo(
    () => new Set(sources.map((source) => `${source.system}-${source.kind}-${source.rootPath}`)),
    [sources],
  );
  const [expandedKeys, setExpandedKeys] = useState<Set<string> | null>(null);
  const activeExpandedKeys = expandedKeys ?? defaultExpandedKeys;

  const toggleKey = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev ?? defaultExpandedKeys);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const { nativeTools, frameworks, integrations, legacy } = groupSourcesByCategory(sources);

  const totalSpecs = sources.reduce((sum, s) => {
    if (s.features && s.features.length > 0) {
      // For Kiro features, count total documents across all features
      return sum + s.features.reduce((docSum, f) => docSum + f.documents.length, 0);
    }
    return sum + s.children.length;
  }, 0);
  const highConfidenceCount = sources.filter((s) => s.confidence === "high").length;

  const isCompact = variant === "compact";

  if (isCompact) {
    const showUnsupportedMessage = Boolean(unsupportedMessage);
    const showLoading = Boolean(loading);
    const showEmptyState = !showLoading && !error && !showUnsupportedMessage && sources.length === 0;
    const showSourceCards = !showLoading && !showUnsupportedMessage;
    const compactHeaderActions = showLoading ? (
      <span className="text-[10px] text-desktop-text-secondary">Loading...</span>
    ) : (
      <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5 text-[10px] text-desktop-text-secondary">
        {sources.length} source{sources.length !== 1 ? "s" : ""} · {totalSpecs} spec{totalSpecs !== 1 ? "s" : ""}
      </span>
    );

    return (
      <HarnessSectionCard
        title="Spec Sources"
        description="Detected AI coding spec sources in this repository."
        actions={compactHeaderActions}
        variant="compact"
        dataTestId="spec-sources-compact"
      >
        {error && !unsupportedMessage ? (
          <HarnessSectionStateFrame tone="error">{error}</HarnessSectionStateFrame>
        ) : null}

        {unsupportedMessage ? <HarnessSectionStateFrame tone="warning">{unsupportedMessage}</HarnessSectionStateFrame> : null}

        {showEmptyState ? (
          <HarnessSectionStateFrame>No spec sources detected in this repository.</HarnessSectionStateFrame>
        ) : null}

        {showSourceCards ? sources.map((source) => {
          const key = `${source.system}-${source.kind}-${source.rootPath}`;

          return (
            <SpecSourceCard
              key={key}
              source={source}
              expanded={activeExpandedKeys.has(key)}
              onToggle={() => toggleKey(key)}
            />
          );
        }) : null}
      </HarnessSectionCard>
    );
  }

  // Full variant
  return (
    <HarnessSectionCard
      title="Spec Sources"
      description={`Detected AI Coding spec tools, methodology frameworks, and tool integrations for ${repoLabel}`}
      variant="full"
      actions={
        !loading ? (
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
              {sources.length} source{sources.length !== 1 ? "s" : ""}
            </span>
            <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
              {totalSpecs} spec{totalSpecs !== 1 ? "s" : ""}
            </span>
            {highConfidenceCount > 0 ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] text-emerald-700">
                {highConfidenceCount} high confidence
              </span>
            ) : null}
          </div>
        ) : null
      }
    >
      {loading ? (
        <HarnessSectionStateFrame>Scanning for spec sources...</HarnessSectionStateFrame>
      ) : null}

      {unsupportedMessage ? <HarnessSectionStateFrame tone="warning">{unsupportedMessage}</HarnessSectionStateFrame> : null}

      {error && !unsupportedMessage ? (
        <HarnessSectionStateFrame tone="error">{error}</HarnessSectionStateFrame>
      ) : null}

      {!loading && !error && !unsupportedMessage && sources.length === 0 ? (
        <HarnessSectionStateFrame>
          No spec sources detected in this repository. Supported frameworks: Kiro, Qoder, OpenSpec, Spec Kit, BMAD.
        </HarnessSectionStateFrame>
      ) : null}

      {!loading && !unsupportedMessage && sources.length > 0 ? (
        <div className="mt-3 space-y-3" data-testid="spec-sources-full">
          <SourceGroup title="Native Tools" sources={nativeTools} expandedKeys={activeExpandedKeys} onToggle={toggleKey} />
          <SourceGroup title="Frameworks" sources={frameworks} expandedKeys={activeExpandedKeys} onToggle={toggleKey} />
          <SourceGroup title="Integrations" sources={integrations} expandedKeys={activeExpandedKeys} onToggle={toggleKey} />
          <SourceGroup title="Legacy" sources={legacy} expandedKeys={activeExpandedKeys} onToggle={toggleKey} />
        </div>
      ) : null}

      {data?.warnings && data.warnings.length > 0 ? (
        <div className="mt-3 space-y-1">
          {data.warnings.map((warning, index) => (
            <HarnessSectionStateFrame key={`warning-${index}`} tone="warning">
              {warning}
            </HarnessSectionStateFrame>
          ))}
        </div>
      ) : null}
    </HarnessSectionCard>
  );
}
