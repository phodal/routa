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
import { useTranslation } from "@/i18n";
import { ChevronDown, ChevronRight } from "lucide-react";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { resolveApiPath } from "@/client/config/backend";


type SpecSourcesPanelProps = {
  repoLabel: string;
  unsupportedMessage?: string | null;
  data?: SpecDetectionResponse | null;
  loading?: boolean;
  error?: string | null;
  variant?: "full" | "compact";
  hideHeader?: boolean;
  workspaceId?: string;
  codebaseId?: string;
  repoPath?: string;
};

type SpecSourceI18nLabels = {
  kindLabels: Record<SpecSourceKind, string>;
  statusLabels: Record<SpecStatus, string>;
  typeLabels: Record<string, string>;
  docsCount: (count: number) => string;
  specCount: (count: number) => string;
  qoderIntegration: string;
  integrationDetected: (system: string) => string;
  previewFile: string;
  previewLoading: string;
  previewClose: string;
  previewError: string;
  previewNotFound: string;
};

type FilePreviewContext = {
  workspaceId?: string;
  codebaseId?: string;
  repoPath?: string;
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

function StatusBadge({ status, label }: { status: SpecStatus; label: string }) {
  const style = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${style.bg} ${style.text} ${style.border}`}>
      {label}
    </span>
  );
}

function KindBadge({ kind, label }: { kind: SpecSourceKind; label: string }) {
  const style = KIND_STYLES[kind];
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium ${style.bg} ${style.text}`}>
      {label}
    </span>
  );
}

function SpecTypeTag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded border border-desktop-border bg-desktop-bg-primary px-1.5 py-0.5 text-[9px] font-mono text-desktop-text-secondary">
      {label}
    </span>
  );
}

function ChevronIcon({ expanded, className }: { expanded: boolean; className?: string }) {
  return (
    <ChevronRight className={`h-3 w-3 text-desktop-text-secondary transition-transform ${expanded ? "rotate-90" : ""} ${className ?? ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
  );
}

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; content: string }
  | { status: "error"; message: string };

function SpecFilePreviewButton({
  filePath,
  context,
  labels,
}: {
  filePath: string;
  context: FilePreviewContext;
  labels: Pick<SpecSourceI18nLabels, "previewFile" | "previewLoading" | "previewClose" | "previewError" | "previewNotFound">;
}) {
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });

  const togglePreview = async () => {
    if (preview.status === "ready" || preview.status === "error") {
      setPreview({ status: "idle" });
      return;
    }

    setPreview({ status: "loading" });
    try {
      const params = new URLSearchParams({ filePath });
      if (context.workspaceId) params.set("workspaceId", context.workspaceId);
      if (context.codebaseId) params.set("codebaseId", context.codebaseId);
      if (context.repoPath) params.set("repoPath", context.repoPath);

      const response = await desktopAwareFetch(resolveApiPath(`/api/harness/spec-sources/file?${params.toString()}`));
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errorMsg = typeof payload?.error === "string" ? payload.error : labels.previewError;
        if (response.status === 404) {
          setPreview({ status: "error", message: labels.previewNotFound });
        } else {
          setPreview({ status: "error", message: errorMsg });
        }
        return;
      }
      setPreview({ status: "ready", content: typeof payload.content === "string" ? payload.content : "" });
    } catch {
      setPreview({ status: "error", message: labels.previewError });
    }
  };

  const isOpen = preview.status === "ready" || preview.status === "error";
  const buttonLabel = isOpen ? labels.previewClose : labels.previewFile;

  return (
    <div>
      <button
        type="button"
        aria-label={buttonLabel}
        className="ml-1 rounded px-1.5 py-0.5 text-[9px] font-medium text-desktop-text-secondary hover:bg-desktop-bg-secondary hover:text-desktop-text-primary"
        onClick={togglePreview}
      >
        {preview.status === "loading" ? labels.previewLoading : buttonLabel}
      </button>

      {preview.status === "ready" && (
        <pre className="mt-1 max-h-48 overflow-y-auto rounded border border-desktop-border bg-desktop-bg-secondary px-2 py-1.5 text-[9px] font-mono text-desktop-text-primary whitespace-pre-wrap break-all">
          {preview.content}
        </pre>
      )}

      {preview.status === "error" && (
        <div className="mt-1 rounded border border-red-200 bg-red-50/50 px-2 py-1 text-[9px] text-red-600">
          {preview.message}
        </div>
      )}
    </div>
  );
}

function KiroFeatureTree({ features, labels, context }: { features: SpecFeature[]; labels: SpecSourceI18nLabels; context?: FilePreviewContext }) {
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
                {labels.docsCount(feature.documents.length)}
              </span>
            </button>

            {isExpanded && feature.documents.map((doc) => (
              <div key={doc.path} className="ml-5 rounded px-1.5 py-0.5 text-[10px]">
                <div className="flex items-center gap-1.5">
                  <SpecTypeTag label={labels.typeLabels[doc.type] ?? doc.type} />
                  <span className="min-w-0 truncate font-mono text-desktop-text-primary">{doc.path}</span>
                  {context && (
                    <SpecFilePreviewButton filePath={doc.path} context={context} labels={labels} />
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function FlatSpecList({ specs, labels, context }: { specs: SpecSource["children"]; labels: SpecSourceI18nLabels; context?: FilePreviewContext }) {
  return (
    <div className="space-y-0.5">
      {specs.map((spec) => (
        <div key={spec.path} className="rounded px-1.5 py-0.5 text-[10px] hover:bg-desktop-bg-secondary/60">
          <div className="flex items-center gap-2">
            <SpecTypeTag label={labels.typeLabels[spec.type] ?? spec.type} />
            <span className="min-w-0 truncate font-mono text-desktop-text-primary">{spec.path}</span>
            {context && (
              <SpecFilePreviewButton filePath={spec.path} context={context} labels={labels} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function SpecSourceCard({ source, expanded, onToggle, labels, context }: { source: SpecSource; expanded: boolean; onToggle: () => void; labels: SpecSourceI18nLabels; context?: FilePreviewContext }) {
  const icon = SYSTEM_ICONS[source.system] ?? source.system.charAt(0).toUpperCase();
  const hasFeatures = source.features && source.features.length > 0;
  const specCount = hasFeatures ? source.features!.length : source.children.length;

  return (
    <div className={`rounded-sm border transition-colors ${
      expanded ? "border-desktop-accent bg-desktop-bg-primary" : "border-desktop-border bg-desktop-bg-primary/80 hover:bg-desktop-bg-primary"
    }`}>
      <button
        type="button"
        className="flex w-full items-start gap-3 px-3 py-2 text-left"
        onClick={onToggle}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-desktop-border bg-desktop-bg-secondary text-[10px] font-bold text-desktop-text-primary">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold capitalize text-desktop-text-primary">{source.system}</span>
            <KindBadge kind={source.kind} label={labels.kindLabels[source.kind]} />
            <ConfidenceBadge confidence={source.confidence} />
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <StatusBadge status={source.status} label={labels.statusLabels[source.status]} />
            <span className="text-[10px] text-desktop-text-secondary">
              {source.rootPath}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {specCount > 0 && (
            <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5 text-[10px] text-desktop-text-secondary">
              {labels.specCount(specCount)}
            </span>
          )}
          <ChevronDown className={`h-3.5 w-3.5 text-desktop-text-secondary transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
        </div>
      </button>

      {expanded && (
        <div className="max-h-80 overflow-y-auto border-t border-desktop-border px-3 py-2">
          {hasFeatures ? (
            <KiroFeatureTree features={source.features!} labels={labels} context={context} />
          ) : source.children.length > 0 ? (
            <FlatSpecList specs={source.children} labels={labels} context={context} />
          ) : source.status === "installed-only" ? (
            <div className="rounded-sm border border-sky-200 bg-sky-50/50 px-2.5 py-2 text-[10px] text-sky-700">
              {source.system === "qoder"
                ? labels.qoderIntegration
                : labels.integrationDetected(source.system)}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SourceGroup({ title, sources, expandedKeys, onToggle, labels, context }: {
  title: string;
  sources: SpecSource[];
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
  labels: SpecSourceI18nLabels;
  context?: FilePreviewContext;
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
              labels={labels}
              context={context}
            />
          );
        })}
      </div>
    </div>
  );
}

export function HarnessSpecSourcesPanel({
  repoLabel: _repoLabel,
  unsupportedMessage,
  data,
  loading,
  error,
  variant = "full",
  hideHeader = false,
  workspaceId,
  codebaseId,
  repoPath,
}: SpecSourcesPanelProps) {
  const { t } = useTranslation();
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

  const labels: SpecSourceI18nLabels = useMemo(() => ({
    kindLabels: {
      "native-tool": t.harness.specSources.kindNativeTool,
      framework: t.harness.specSources.kindFramework,
      "tool-integration": t.harness.specSources.kindIntegration,
    },
    statusLabels: {
      "artifacts-present": t.harness.specSources.statusHasSpecs,
      "installed-only": t.harness.specSources.statusInstalledOnly,
      archived: t.harness.specSources.statusArchived,
      legacy: t.harness.specSources.statusLegacyLabel,
    },
    typeLabels: {
      requirements: t.harness.specSources.typeRequirements,
      design: t.harness.specSources.typeDesign,
      tasks: t.harness.specSources.typeTasks,
      bugfix: t.harness.specSources.typeBugfix,
      spec: t.harness.specSources.typeSpec,
      proposal: t.harness.specSources.typeProposal,
      plan: t.harness.specSources.typePlan,
      prd: t.harness.specSources.typePrd,
      architecture: t.harness.specSources.typeArchitecture,
      epic: t.harness.specSources.typeEpic,
      story: t.harness.specSources.typeStory,
      context: t.harness.specSources.typeContext,
      config: t.harness.specSources.typeConfig,
      other: t.harness.specSources.typeOther,
    },
    docsCount: (count: number) => count === 1
      ? t.harness.specSources.docsSingular.replace('{count}', `${count}`)
      : t.harness.specSources.docsCount.replace('{count}', `${count}`),
    specCount: (count: number) => count === 1
      ? t.harness.specSources.specSingular.replace('{count}', `${count}`)
      : t.harness.specSources.specCount.replace('{count}', `${count}`),
    qoderIntegration: t.harness.specSources.qoderIntegration,
    integrationDetected: (system: string) => t.harness.specSources.integrationDetected.replace('{system}', system),
    previewFile: t.harness.specSources.previewFile,
    previewLoading: t.harness.specSources.previewLoading,
    previewClose: t.harness.specSources.previewClose,
    previewError: t.harness.specSources.previewError,
    previewNotFound: t.harness.specSources.previewNotFound,
  }), [t]);

  // Only provide file preview context when at least one context param is available
  const filePreviewContext: FilePreviewContext | undefined = (workspaceId || codebaseId || repoPath)
    ? { workspaceId, codebaseId, repoPath }
    : undefined;

  const isCompact = variant === "compact";

  if (isCompact) {
    const showUnsupportedMessage = Boolean(unsupportedMessage);
    const showLoading = Boolean(loading);
    const showEmptyState = !showLoading && !error && !showUnsupportedMessage && sources.length === 0;
    const showSourceCards = !showLoading && !showUnsupportedMessage;
    return (
      <HarnessSectionCard
        title={t.harness.specSources.title}
        hideHeader={hideHeader}
        variant="compact"
        dataTestId="spec-sources-compact"
      >
        {error && !unsupportedMessage ? (
          <HarnessSectionStateFrame tone="error">{error}</HarnessSectionStateFrame>
        ) : null}

        {showLoading && !unsupportedMessage && !error ? (
          <HarnessSectionStateFrame>{t.harness.specSources.scanningSources}</HarnessSectionStateFrame>
        ) : null}

        {unsupportedMessage ? <HarnessSectionStateFrame tone="warning">{unsupportedMessage}</HarnessSectionStateFrame> : null}

        {showEmptyState ? (
          <HarnessSectionStateFrame>{t.harness.specSources.noSourcesDetected}</HarnessSectionStateFrame>
        ) : null}

        {showSourceCards ? sources.map((source) => {
          const key = `${source.system}-${source.kind}-${source.rootPath}`;

          return (
            <SpecSourceCard
              key={key}
              source={source}
              expanded={activeExpandedKeys.has(key)}
              onToggle={() => toggleKey(key)}
              labels={labels}
              context={filePreviewContext}
            />
          );
        }) : null}
      </HarnessSectionCard>
    );
  }

  // Full variant
  return (
    <HarnessSectionCard
      title={t.harness.specSources.title}
      hideHeader={hideHeader}
      variant="full"
    >
      {loading ? (
        <HarnessSectionStateFrame>{t.harness.specSources.scanningSources}</HarnessSectionStateFrame>
      ) : null}

      {unsupportedMessage ? <HarnessSectionStateFrame tone="warning">{unsupportedMessage}</HarnessSectionStateFrame> : null}

      {error && !unsupportedMessage ? (
        <HarnessSectionStateFrame tone="error">{error}</HarnessSectionStateFrame>
      ) : null}

      {!loading && !error && !unsupportedMessage && sources.length === 0 ? (
        <HarnessSectionStateFrame>
          {t.harness.specSources.noSourcesWithFrameworks}
        </HarnessSectionStateFrame>
      ) : null}

      {!loading && !unsupportedMessage && sources.length > 0 ? (
        <div className="mt-3 space-y-3" data-testid="spec-sources-full">
          <SourceGroup title={t.harness.specSources.nativeTools} sources={nativeTools} expandedKeys={activeExpandedKeys} onToggle={toggleKey} labels={labels} context={filePreviewContext} />
          <SourceGroup title={t.harness.specSources.frameworks} sources={frameworks} expandedKeys={activeExpandedKeys} onToggle={toggleKey} labels={labels} context={filePreviewContext} />
          <SourceGroup title={t.harness.specSources.integrations} sources={integrations} expandedKeys={activeExpandedKeys} onToggle={toggleKey} labels={labels} context={filePreviewContext} />
          <SourceGroup title={t.harness.specSources.legacy} sources={legacy} expandedKeys={activeExpandedKeys} onToggle={toggleKey} labels={labels} context={filePreviewContext} />
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
