"use client";

import { useMemo } from "react";
import { CodeViewer } from "@/client/components/codemirror/code-viewer";
import { HarnessSectionCard, HarnessSectionStateFrame } from "@/client/components/harness-section-card";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import type {
  HarnessAutomationDefinitionSummary,
  HarnessAutomationPendingSignal,
  HarnessAutomationRecentRun,
  HarnessAutomationResponse,
  HarnessAutomationRuntimeStatus,
} from "@/core/harness/automation-types";

type HarnessAutomationPanelProps = {
  data: HarnessAutomationResponse | null;
  loading: boolean;
  error: string | null;
  repoLabel: string;
  unsupportedMessage?: string | null;
  variant?: "full" | "compact";
  hideHeader?: boolean;
};

function statusBadgeClass(status: HarnessAutomationRuntimeStatus) {
  switch (status) {
    case "active":
      return "border-emerald-300 bg-emerald-50 text-emerald-800";
    case "paused":
      return "border-amber-300 bg-amber-50 text-amber-900";
    case "pending":
      return "border-sky-300 bg-sky-50 text-sky-800";
    case "definition-only":
      return "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800";
    case "idle":
      return "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary";
    case "clear":
      return "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary";
  }
}

function severityBadgeClass(severity: HarnessAutomationPendingSignal["severity"]) {
  switch (severity) {
    case "high":
      return "border-red-300 bg-red-50 text-red-800";
    case "medium":
      return "border-amber-300 bg-amber-50 text-amber-900";
    case "low":
      return "border-sky-300 bg-sky-50 text-sky-800";
  }
}

function formatStatus(status: HarnessAutomationRuntimeStatus) {
  switch (status) {
    case "definition-only":
      return "Configured only";
    case "active":
      return "Active";
    case "paused":
      return "Paused";
    case "pending":
      return "Pending";
    case "idle":
      return "Idle";
    case "clear":
      return "Clear";
  }
}

function formatSourceType(value: HarnessAutomationDefinitionSummary["sourceType"]) {
  switch (value) {
    case "finding":
      return "Finding-driven";
    case "schedule":
      return "Scheduled";
    case "review-signal":
      return "Review signal";
    case "external-event":
      return "External event";
  }
}

function formatTargetType(value: HarnessAutomationDefinitionSummary["targetType"]) {
  switch (value) {
    case "specialist":
      return "Specialist";
    case "workflow":
      return "Workflow";
    case "background-task":
      return "Background task";
  }
}

function formatTimestamp(value?: string) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function SummaryStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-sm border border-desktop-border bg-desktop-bg-primary/80 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-desktop-text-secondary">{label}</div>
      <div className="mt-1 break-all text-[13px] font-semibold text-desktop-text-primary">{value}</div>
    </div>
  );
}

function DefinitionTable({ definitions }: { definitions: HarnessAutomationDefinitionSummary[] }) {
  return (
    <div className="overflow-hidden rounded-sm border border-desktop-border bg-desktop-bg-primary/80">
      <div className="border-b border-desktop-border/70 px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Configured Mechanisms</div>
      </div>
      {definitions.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left">
            <thead className="bg-white/60">
              <tr className="text-[10px] uppercase tracking-[0.12em] text-desktop-text-secondary">
                <th className="px-4 py-2.5 font-semibold">Mechanism</th>
                <th className="px-4 py-2.5 font-semibold">Trigger</th>
                <th className="px-4 py-2.5 font-semibold">Execution Target</th>
                <th className="px-4 py-2.5 font-semibold">Runtime State</th>
                <th className="px-4 py-2.5 font-semibold">Pending</th>
              </tr>
            </thead>
            <tbody>
              {definitions.map((definition) => (
                <tr key={definition.id} className="border-t border-desktop-border/60 first:border-t-0">
                  <td className="px-4 py-3 align-top">
                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold text-desktop-text-primary">{definition.name}</div>
                      <div className="text-[10px] font-mono text-desktop-text-secondary">{definition.id}</div>
                      {definition.description ? (
                        <div className="max-w-[320px] text-[11px] text-desktop-text-secondary">{definition.description}</div>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="space-y-1">
                      <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                        {formatSourceType(definition.sourceType)}
                      </span>
                      <div className="max-w-[240px] text-[11px] text-desktop-text-primary">{definition.sourceLabel}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="space-y-1">
                      <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                        {formatTargetType(definition.targetType)}
                      </span>
                      <div className="max-w-[260px] text-[11px] text-desktop-text-primary">{definition.targetLabel}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="space-y-1.5">
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] ${statusBadgeClass(definition.runtimeStatus)}`}>
                        {formatStatus(definition.runtimeStatus)}
                      </span>
                      <div className="text-[11px] text-desktop-text-secondary">
                        {definition.runtimeBinding ? `binding: ${definition.runtimeBinding}` : "No runtime binding"}
                      </div>
                      {definition.nextRunAt ? <div className="text-[10px] text-desktop-text-secondary">next: {formatTimestamp(definition.nextRunAt)}</div> : null}
                      {definition.lastRunAt ? <div className="text-[10px] text-desktop-text-secondary">last: {formatTimestamp(definition.lastRunAt)}</div> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top text-[11px] text-desktop-text-primary">{definition.pendingCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-5 text-[11px] text-desktop-text-secondary">No cleanup/correction mechanisms are configured yet.</div>
      )}
    </div>
  );
}

function PendingSignalsTable({ pendingSignals }: { pendingSignals: HarnessAutomationPendingSignal[] }) {
  return (
    <div className="overflow-hidden rounded-sm border border-desktop-border bg-desktop-bg-primary/80">
      <div className="border-b border-desktop-border/70 px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Pending Cleanup / Correction</div>
      </div>
      {pendingSignals.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left">
            <thead className="bg-white/60">
              <tr className="text-[10px] uppercase tracking-[0.12em] text-desktop-text-secondary">
                <th className="px-4 py-2.5 font-semibold">Signal</th>
                <th className="px-4 py-2.5 font-semibold">Configured Mechanism</th>
                <th className="px-4 py-2.5 font-semibold">Severity</th>
                <th className="px-4 py-2.5 font-semibold">Window</th>
              </tr>
            </thead>
            <tbody>
              {pendingSignals.map((signal) => (
                <tr key={signal.id} className="border-t border-desktop-border/60 first:border-t-0">
                  <td className="px-4 py-3 align-top">
                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold text-desktop-text-primary">{signal.title}</div>
                      <div className="text-[11px] text-desktop-text-secondary">{signal.summary}</div>
                      {signal.relativePath ? <div className="font-mono text-[10px] text-desktop-text-secondary">{signal.relativePath}</div> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="text-[11px] text-desktop-text-primary">{signal.automationName}</div>
                    <div className="text-[10px] font-mono text-desktop-text-secondary">{signal.signalType}</div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] ${severityBadgeClass(signal.severity)}`}>
                      {signal.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top text-[11px] text-desktop-text-secondary">
                    {signal.deferUntilCron ?? "Immediate"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-5 text-[11px] text-desktop-text-secondary">No cleanup or correction signals are waiting for follow-up.</div>
      )}
    </div>
  );
}

function RecentRunsTable({ recentRuns }: { recentRuns: HarnessAutomationRecentRun[] }) {
  return (
    <div className="overflow-hidden rounded-sm border border-desktop-border bg-desktop-bg-primary/80">
      <div className="border-b border-desktop-border/70 px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Recent Execution State</div>
      </div>
      {recentRuns.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left">
            <thead className="bg-white/60">
              <tr className="text-[10px] uppercase tracking-[0.12em] text-desktop-text-secondary">
                <th className="px-4 py-2.5 font-semibold">Configured Mechanism</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Last Run</th>
                <th className="px-4 py-2.5 font-semibold">Next Run</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((run) => (
                <tr key={`${run.automationId}:${run.runtimeBinding}`} className="border-t border-desktop-border/60 first:border-t-0">
                  <td className="px-4 py-3 align-top">
                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold text-desktop-text-primary">{run.automationName}</div>
                      <div className="text-[10px] font-mono text-desktop-text-secondary">{run.runtimeBinding}</div>
                      {run.cronExpr ? <div className="text-[10px] text-desktop-text-secondary">{run.cronExpr}</div> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] ${statusBadgeClass(run.status)}`}>
                      {formatStatus(run.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top text-[11px] text-desktop-text-secondary">{formatTimestamp(run.lastRunAt)}</td>
                  <td className="px-4 py-3 align-top text-[11px] text-desktop-text-secondary">{formatTimestamp(run.nextRunAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-5 text-[11px] text-desktop-text-secondary">No runtime records matched these repo-defined mechanisms.</div>
      )}
    </div>
  );
}

export function HarnessAutomationPanel({
  data,
  loading,
  error,
  repoLabel,
  unsupportedMessage,
  variant = "full",
  hideHeader = false,
}: HarnessAutomationPanelProps) {
  const dataTestId = variant === "compact" ? "automations-compact" : "automations-full";
  const showData = !loading && !error && !unsupportedMessage && Boolean(data);
  const visibleData = showData ? data : null;
  const showMissingContext = !loading && !error && !unsupportedMessage && !data;
  const summary = useMemo(() => ({
    definitions: data?.definitions.length ?? 0,
    pendingSignals: data?.pendingSignals.length ?? 0,
    recentRuns: data?.recentRuns.length ?? 0,
  }), [data]);
  const configSummary = useMemo(() => ({
    sourceOfTruth: data?.configFile?.relativePath ?? "No checked-in config file",
    findingDriven: data?.definitions.filter((definition) => definition.sourceType === "finding").length ?? 0,
    scheduledRuns: data?.definitions.filter((definition) => definition.sourceType === "schedule").length ?? 0,
    runtimeBindings: data?.definitions.filter((definition) => Boolean(definition.runtimeBinding)).length ?? 0,
  }), [data]);
  const repoContextLabel = repoLabel.trim() || "This repository";

  return (
    <HarnessSectionCard
      eyebrow="Repo-defined Governance"
      title="Cleanup & Correction Loop"
      description="Checked-in configuration for recurring cleanup, correction, and follow-up execution."
      hideHeader={hideHeader}
      variant={variant}
      dataTestId={dataTestId}
    >
      {loading ? (
        <HarnessSectionStateFrame>
          Loading repo-defined cleanup/correction configuration...
        </HarnessSectionStateFrame>
      ) : null}

      {unsupportedMessage ? <HarnessUnsupportedState /> : null}

      {error && !unsupportedMessage ? (
        <HarnessSectionStateFrame tone="error">{error}</HarnessSectionStateFrame>
      ) : null}

      {showMissingContext ? (
        <HarnessSectionStateFrame>
          Select a repo or provide Harness context to load the checked-in cleanup/correction configuration.
        </HarnessSectionStateFrame>
      ) : null}

      {visibleData ? (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-sm border border-desktop-border bg-desktop-bg-primary/80">
            <div className="border-b border-desktop-border/70 px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Configuration Surface</div>
              <div className="mt-1 text-[12px] font-semibold text-desktop-text-primary">Repo-defined source of truth</div>
              <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">
                {repoContextLabel} keeps this mechanism in versioned YAML. The runtime rows below are for tracking and recovery, not for authoring the primary configuration.
              </div>
            </div>

            <div className="grid gap-2 border-b border-desktop-border/70 p-3 md:grid-cols-4">
              <SummaryStat label="Source of Truth" value={configSummary.sourceOfTruth} />
              <SummaryStat label="Finding Rules" value={configSummary.findingDriven} />
              <SummaryStat label="Scheduled Runs" value={configSummary.scheduledRuns} />
              <SummaryStat label="Runtime Bindings" value={configSummary.runtimeBindings} />
            </div>

            <div className="p-3">
              {visibleData.configFile ? (
                <CodeViewer
                  code={visibleData.configFile.source}
                  filename={visibleData.configFile.relativePath}
                  language="yaml"
                  maxHeight="320px"
                  showHeader={false}
                  wordWrap
                />
              ) : (
                <HarnessSectionStateFrame>
                  No checked-in cleanup/correction config file was found for this repository yet.
                </HarnessSectionStateFrame>
              )}
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            <SummaryStat label="Configured Rules" value={summary.definitions} />
            <SummaryStat label="Pending Signals" value={summary.pendingSignals} />
            <SummaryStat label="Recent Executions" value={summary.recentRuns} />
          </div>

          <DefinitionTable definitions={visibleData.definitions} />
          <PendingSignalsTable pendingSignals={visibleData.pendingSignals} />
          <RecentRunsTable recentRuns={visibleData.recentRuns} />

          {visibleData.warnings.length > 0 ? (
            <HarnessSectionStateFrame tone="warning">
              {visibleData.warnings.join(" ")}
            </HarnessSectionStateFrame>
          ) : null}
        </div>
      ) : null}
    </HarnessSectionCard>
  );
}
