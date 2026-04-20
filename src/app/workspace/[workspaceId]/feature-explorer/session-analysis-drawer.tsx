"use client";

import { type ReactNode, useMemo, useState } from "react";
import { X } from "lucide-react";

import type { AcpProviderInfo } from "@/client/acp-client";
import { AcpProviderDropdown } from "@/client/components/acp-provider-dropdown";
import { useTranslation } from "@/i18n";

import { sanitizeChangedFiles } from "./session-analysis";
import type { AggregatedSelectionSession } from "./types";

function sessionKeyFor(session: Pick<AggregatedSelectionSession, "provider" | "sessionId">): string {
  return `${session.provider}:${session.sessionId}`;
}

function formatShortDate(iso: string): string {
  if (!iso || iso === "-") return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

function formatSignalProvider(provider: string): string {
  switch (provider) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude";
    case "qoder":
      return "Qoder";
    case "augment":
      return "Augment";
    default:
      return provider || "Session";
  }
}

function getSignalProviderBadgeClass(provider: string): string {
  switch (provider) {
    case "codex":
      return "border-sky-300/70 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/12 dark:text-sky-200";
    case "claude":
      return "border-orange-300/70 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/12 dark:text-orange-200";
    case "qoder":
      return "border-violet-300/70 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/12 dark:text-violet-200";
    case "augment":
      return "border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/12 dark:text-emerald-200";
    default:
      return "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary";
  }
}

function ContextSection({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-sm border border-desktop-border bg-desktop-bg-primary p-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
          {title}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function CompactFileList({ files }: { files: string[] }) {
  return (
    <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
      {files.map((sourceFile) => (
        <div
          key={sourceFile}
          className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1.5 text-[11px] text-desktop-text-secondary"
        >
          {sourceFile}
        </div>
      ))}
    </div>
  );
}

function SignalEmptyState({ message }: { message: string }) {
  return (
    <div className="mt-1 rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1.5 text-[11px] text-desktop-text-secondary">
      {message}
    </div>
  );
}

function InlineMetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1 text-[10px] text-desktop-text-secondary">
      <span className="font-medium text-desktop-text-primary">{value}</span>
      <span>{label}</span>
    </div>
  );
}

export function SessionAnalysisDrawer({
  open,
  selectedFilePaths,
  selectedScopeSessions,
  providers,
  selectedProvider,
  onProviderChange,
  isStartingSessionAnalysis = false,
  sessionAnalysisError,
  onClose,
  onStartSessionAnalysis,
  t,
}: {
  open: boolean;
  selectedFilePaths: string[];
  selectedScopeSessions: AggregatedSelectionSession[];
  providers: AcpProviderInfo[];
  selectedProvider: string;
  onProviderChange: (provider: string) => void;
  isStartingSessionAnalysis?: boolean;
  sessionAnalysisError?: string | null;
  onClose: () => void;
  onStartSessionAnalysis: (sessions: AggregatedSelectionSession[]) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const allSessionKeys = useMemo(
    () => selectedScopeSessions.map((session) => sessionKeyFor(session)),
    [selectedScopeSessions],
  );
  const [selectedSessionKey, setSelectedSessionKey] = useState(() => allSessionKeys[0] ?? "");
  const [selectedSessionKeys, setSelectedSessionKeys] = useState<string[]>(() => allSessionKeys);

  const selectedSessionKeySet = useMemo(() => new Set(selectedSessionKeys), [selectedSessionKeys]);
  const selectedSessions = useMemo(
    () => selectedScopeSessions.filter((session) => selectedSessionKeySet.has(sessionKeyFor(session))),
    [selectedScopeSessions, selectedSessionKeySet],
  );

  const activeSession = selectedScopeSessions.find(
    (session) => sessionKeyFor(session) === selectedSessionKey,
  ) ?? selectedScopeSessions[0] ?? null;
  const activeSessionDiagnostics = activeSession?.diagnostics;
  const activeSessionPrompts = activeSession
    ? (activeSession.promptHistory.length > 0
      ? activeSession.promptHistory
      : activeSession.promptSnippet
        ? [activeSession.promptSnippet]
        : [])
    : [];
  const activeSessionChangedFiles = activeSession ? sanitizeChangedFiles(activeSession.changedFiles) : [];
  const activeSessionKey = activeSession ? sessionKeyFor(activeSession) : "";

  const handleToggleSession = (sessionKey: string) => {
    setSelectedSessionKeys((current) => (
      current.includes(sessionKey)
        ? current.filter((key) => key !== sessionKey)
        : [...current, sessionKey]
    ));
  };

  if (!open) {
    return null;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
        data-testid="feature-explorer-session-analysis-backdrop"
      />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-[88rem] flex-col overflow-hidden border-l border-desktop-border bg-desktop-bg-primary shadow-2xl 2xl:max-w-[100rem]"
        role="dialog"
        aria-modal="true"
        aria-label={t.featureExplorer.sessionAnalysisTitle}
        data-testid="feature-explorer-session-analysis-drawer"
      >
        <div className="flex items-start justify-between gap-3 border-b border-desktop-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-desktop-text-primary">
              {t.featureExplorer.sessionAnalysisTitle}
            </div>
            <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">
              {t.featureExplorer.sessionAnalysisDescription}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.close}
            title={t.common.close}
            className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1 text-desktop-text-secondary hover:text-desktop-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-desktop-border bg-desktop-bg-secondary/40 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <InlineMetricPill label={t.featureExplorer.filesLabel} value={String(selectedFilePaths.length)} />
            <InlineMetricPill label={t.featureExplorer.sessionsLabel} value={String(selectedScopeSessions.length)} />
            <InlineMetricPill label={t.featureExplorer.selectedSessionsLabel} value={String(selectedSessions.length)} />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0 flex-col xl:flex-row">
            <div className="flex min-h-0 w-full shrink-0 flex-col border-b border-desktop-border xl:w-[30rem] xl:border-b-0 xl:border-r 2xl:w-[34rem]">
              <div className="space-y-3 overflow-y-auto p-4">
                <ContextSection title={t.featureExplorer.selectedFiles}>
                  <CompactFileList files={selectedFilePaths} />
                </ContextSection>

                <ContextSection
                  title={t.featureExplorer.selectedFileSignals}
                  actions={(
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSelectedSessionKeys(selectedScopeSessions.map((session) => sessionKeyFor(session)))}
                        className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1 text-[10px] text-desktop-text-secondary hover:text-desktop-text-primary"
                      >
                        {t.featureExplorer.selectAllSessions}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedSessionKeys([])}
                        className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1 text-[10px] text-desktop-text-secondary hover:text-desktop-text-primary"
                      >
                        {t.featureExplorer.clearSessionSelection}
                      </button>
                    </div>
                  )}
                >
                  <div className="space-y-2">
                    {selectedScopeSessions.map((session) => {
                      const sessionKey = sessionKeyFor(session);
                      const diagnostics = session.diagnostics;
                      const isActive = sessionKey === activeSessionKey;
                      const isSelected = selectedSessionKeySet.has(sessionKey);

                      return (
                        <div
                          key={sessionKey}
                          className={`w-full rounded-sm border px-3 py-2 text-left transition-colors ${
                            isActive
                              ? "border-desktop-accent bg-desktop-bg-active"
                              : isSelected
                                ? "border-desktop-border bg-desktop-bg-primary"
                                : "border-desktop-border bg-desktop-bg-secondary"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleSession(sessionKey)}
                              className="mt-1 h-3.5 w-3.5 rounded border-desktop-border bg-desktop-bg-secondary accent-[var(--desktop-accent)]"
                              data-testid={`feature-explorer-session-analysis-toggle-${session.sessionId}`}
                            />
                            <button
                              type="button"
                              onClick={() => setSelectedSessionKey(sessionKey)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span
                                      className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold ${getSignalProviderBadgeClass(session.provider)}`}
                                    >
                                      {formatSignalProvider(session.provider)}
                                    </span>
                                    <code className="min-w-0 flex-1 break-all text-[10px] text-desktop-text-primary">
                                      {session.sessionId}
                                    </code>
                                  </div>
                                  <div className="mt-1 line-clamp-3 text-[11px] leading-5 text-desktop-text-secondary">
                                    {session.promptSnippet || t.featureExplorer.noPromptHistory}
                                  </div>
                                </div>
                                <span className="shrink-0 text-[10px] text-desktop-text-secondary">
                                  {formatShortDate(session.updatedAt)}
                                </span>
                              </div>

                              <div className="mt-2 flex flex-wrap gap-1.5">
                                <InlineMetricPill
                                  label={t.featureExplorer.toolCallsLabel}
                                  value={String(diagnostics?.toolCallCount ?? session.toolNames.length)}
                                />
                                <InlineMetricPill
                                  label={t.featureExplorer.failedToolCallsLabel}
                                  value={String(diagnostics?.failedToolCallCount ?? 0)}
                                />
                                <InlineMetricPill
                                  label={t.featureExplorer.readFilesLabel}
                                  value={String(diagnostics?.readFiles.length ?? 0)}
                                />
                              </div>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ContextSection>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {activeSession ? (
                <div className="space-y-3">
                  <ContextSection title={t.featureExplorer.sessionDiagnosticsLabel}>
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold ${getSignalProviderBadgeClass(activeSession.provider)}`}
                            >
                              {formatSignalProvider(activeSession.provider)}
                            </span>
                            <code className="break-all text-[10px] text-desktop-text-primary">
                              {activeSession.sessionId}
                            </code>
                          </div>
                          <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">
                            {activeSession.promptSnippet || t.featureExplorer.noPromptHistory}
                          </div>
                        </div>
                        <span className="shrink-0 text-[10px] text-desktop-text-secondary">
                          {formatShortDate(activeSession.updatedAt)}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        <InlineMetricPill
                          label={t.featureExplorer.toolCallsLabel}
                          value={String(activeSessionDiagnostics?.toolCallCount ?? activeSession.toolNames.length)}
                        />
                        <InlineMetricPill
                          label={t.featureExplorer.failedToolCallsLabel}
                          value={String(activeSessionDiagnostics?.failedToolCallCount ?? 0)}
                        />
                        <InlineMetricPill
                          label={t.featureExplorer.readFilesLabel}
                          value={String(activeSessionDiagnostics?.readFiles.length ?? 0)}
                        />
                        <InlineMetricPill
                          label={t.featureExplorer.relatedFiles}
                          value={String(activeSessionChangedFiles.length)}
                        />
                      </div>
                    </div>
                  </ContextSection>

                  <div className="grid gap-3 xl:grid-cols-2">
                    <ContextSection title={t.featureExplorer.promptHistory}>
                      {activeSessionPrompts.length > 0 ? (
                        <div className="space-y-1.5">
                          {activeSessionPrompts.map((prompt, index) => (
                            <div
                              key={`${activeSessionKey}:prompt:${index}`}
                              className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1.5 text-[11px] leading-5 text-desktop-text-secondary"
                            >
                              {prompt}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <SignalEmptyState message={t.featureExplorer.noPromptHistory} />
                      )}
                    </ContextSection>

                    <ContextSection title={t.featureExplorer.toolCallBreakdownLabel}>
                      {activeSessionDiagnostics && Object.keys(activeSessionDiagnostics.toolCallsByName).length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(activeSessionDiagnostics.toolCallsByName)
                            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
                            .map(([toolName, count]) => (
                              <div
                                key={`${activeSessionKey}:tool:${toolName}`}
                                className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1 text-[11px] text-desktop-text-secondary"
                              >
                                <span className="font-medium text-desktop-text-primary">{count}</span>
                                {" "}
                                {toolName}
                              </div>
                            ))}
                        </div>
                      ) : (
                        <SignalEmptyState message={t.featureExplorer.noToolHistory} />
                      )}
                    </ContextSection>

                    <ContextSection title={t.featureExplorer.readFilesLabel}>
                      {activeSessionDiagnostics?.readFiles.length ? (
                        <CompactFileList files={activeSessionDiagnostics.readFiles} />
                      ) : (
                        <SignalEmptyState message={t.featureExplorer.noReadFiles} />
                      )}
                    </ContextSection>

                    <ContextSection title={t.featureExplorer.writtenFilesLabel}>
                      {activeSessionChangedFiles.length > 0 ? (
                        <CompactFileList files={activeSessionChangedFiles} />
                      ) : (
                        <SignalEmptyState message={t.featureExplorer.noSessionEvidence} />
                      )}
                    </ContextSection>

                    <ContextSection title={t.featureExplorer.repeatedReadsLabel}>
                      {activeSessionDiagnostics?.repeatedReadFiles.length ? (
                        <div className="space-y-1">
                          {activeSessionDiagnostics.repeatedReadFiles.map((entry) => (
                            <div
                              key={`${activeSessionKey}:repeat-read:${entry}`}
                              className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1.5 text-[11px] text-desktop-text-secondary"
                            >
                              {entry}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <SignalEmptyState message={t.featureExplorer.noRepeatedReads} />
                      )}
                    </ContextSection>

                    <ContextSection title={t.featureExplorer.repeatedCommandsLabel}>
                      {activeSessionDiagnostics?.repeatedCommands.length ? (
                        <div className="space-y-1">
                          {activeSessionDiagnostics.repeatedCommands.map((entry) => (
                            <div
                              key={`${activeSessionKey}:repeat-command:${entry}`}
                              className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1.5 text-[11px] text-desktop-text-secondary"
                            >
                              {entry}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <SignalEmptyState message={t.featureExplorer.noRepeatedCommands} />
                      )}
                    </ContextSection>
                  </div>

                  <ContextSection title={t.featureExplorer.failedToolsLabel}>
                    {activeSessionDiagnostics?.failedTools.length ? (
                      <div className="space-y-2">
                        {activeSessionDiagnostics.failedTools.map((failure, index) => (
                          <div
                            key={`${activeSessionKey}:failure:${index}`}
                            className="rounded-sm border border-red-400/30 bg-red-500/8 px-3 py-2"
                          >
                            <div className="text-[11px] font-medium text-red-500">
                              {failure.toolName}
                            </div>
                            {failure.command ? (
                              <div className="mt-1 break-all text-[10px] text-desktop-text-secondary">
                                {failure.command}
                              </div>
                            ) : null}
                            <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">
                              {failure.message}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <SignalEmptyState message={t.featureExplorer.noFailedToolCalls} />
                    )}
                  </ContextSection>
                </div>
              ) : (
                <SignalEmptyState message={t.featureExplorer.sessionDetailEmpty} />
              )}

              {sessionAnalysisError ? (
                <div className="mt-3 rounded-sm border border-red-400/40 bg-red-500/8 px-3 py-2 text-[11px] text-red-500">
                  {sessionAnalysisError}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="border-t border-desktop-border bg-desktop-bg-secondary/40 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] text-desktop-text-secondary">
              {selectedSessions.length > 0
                ? `${selectedSessions.length} ${t.featureExplorer.selectedSessionsLabel}`
                : t.featureExplorer.noSessionsSelected}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-3 py-1.5 text-[11px] text-desktop-text-secondary hover:text-desktop-text-primary"
              >
                {t.common.close}
              </button>
              <div className="inline-flex items-center gap-2 rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
                  {t.settings.provider}
                </span>
                <AcpProviderDropdown
                  providers={providers}
                  selectedProvider={selectedProvider}
                  onProviderChange={onProviderChange}
                  dataTestId="feature-explorer-session-analysis-provider"
                />
              </div>
              <button
                type="button"
                onClick={() => onStartSessionAnalysis(selectedSessions)}
                disabled={isStartingSessionAnalysis || selectedSessions.length === 0}
                className={`rounded-sm border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                  isStartingSessionAnalysis || selectedSessions.length === 0
                    ? "cursor-wait border-desktop-border bg-desktop-bg-primary/40 text-desktop-text-secondary/60"
                    : "border-desktop-accent bg-desktop-bg-active text-desktop-text-primary hover:bg-desktop-bg-primary"
                }`}
              >
                {isStartingSessionAnalysis
                  ? t.featureExplorer.sessionAnalysisStarting
                  : t.featureExplorer.sessionAnalysisAction}
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

export function AnalysisSessionDrawer({
  open,
  title,
  subtitle,
  detailHref,
  onClose,
  children,
  t,
}: {
  open: boolean;
  title: string;
  subtitle: string;
  detailHref?: string;
  onClose: () => void;
  children: ReactNode;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  if (!open) {
    return null;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
        data-testid="feature-explorer-analysis-session-backdrop"
      />
      <aside
        className="fixed inset-y-0 right-0 z-[60] flex h-full w-full max-w-[56rem] flex-col overflow-hidden border-l border-desktop-border bg-desktop-bg-primary shadow-2xl 2xl:max-w-[64rem]"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="feature-explorer-analysis-session-drawer"
      >
        <div className="flex items-center justify-between gap-3 border-b border-desktop-border px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-desktop-text-primary">{title}</div>
            <div
              className="mt-0.5 overflow-x-auto whitespace-nowrap text-[11px] text-desktop-text-secondary"
              title={subtitle}
            >
              {subtitle}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {detailHref ? (
              <a
                href={detailHref}
                target="_blank"
                rel="noreferrer"
                className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-2 py-1 text-[11px] text-desktop-text-secondary hover:text-desktop-text-primary"
              >
                {t.common.openInNewTab}
              </a>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-2 py-1 text-[11px] text-desktop-text-secondary hover:text-desktop-text-primary"
            >
              {t.common.close}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          {children}
        </div>
      </aside>
    </>
  );
}
