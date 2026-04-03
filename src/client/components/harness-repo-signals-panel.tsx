"use client";

import { useEffect, useMemo, useState } from "react";
import { HarnessSectionCard, HarnessSectionStateFrame } from "@/client/components/harness-section-card";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import { useTranslation } from "@/i18n";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import type {
  HarnessRepoSignalsResponse,
  HarnessScriptSignal,
  HarnessSignalsMode,
} from "@/core/harness/repo-signals-types";

type HarnessRepoSignalsPanelProps = {
  workspaceId: string;
  codebaseId?: string;
  repoPath?: string;
  repoLabel: string;
  mode: HarnessSignalsMode;
  unsupportedMessage?: string | null;
  variant?: "full" | "compact";
  hideHeader?: boolean;
};

type QueryState = {
  loading: boolean;
  error: string | null;
  data: HarnessRepoSignalsResponse | null;
};

function categoryTone(mode: HarnessSignalsMode) {
  return mode === "build"
    ? {
      badge: "border-sky-200 bg-sky-50 text-sky-800",
      title: "text-sky-800",
    }
    : {
      badge: "border-emerald-200 bg-emerald-50 text-emerald-800",
      title: "text-emerald-800",
    };
}

function summarizeItems(items: string[], limit = 4, moreLabel?: string) {
  if (items.length <= limit) {
    return items;
  }
  const suffix = moreLabel ?? `+${items.length - limit} more`;
  return [...items.slice(0, limit), suffix];
}

function summarizeScripts(items: HarnessScriptSignal[], limit = 2, moreLabel?: string) {
  return summarizeItems(items.map((item) => item.name), limit, moreLabel);
}

export function HarnessRepoSignalsPanel({
  workspaceId,
  codebaseId,
  repoPath,
  repoLabel: _repoLabel,
  mode,
  unsupportedMessage,
  variant = "full",
  hideHeader = false,
}: HarnessRepoSignalsPanelProps) {
  const { t } = useTranslation();
  const hasContext = Boolean(workspaceId && repoPath);
  const [state, setState] = useState<QueryState>({
    loading: false,
    error: null,
    data: null,
  });

  useEffect(() => {
    if (!hasContext) {
      setState({ loading: false, error: null, data: null });
      return;
    }

    let cancelled = false;
    const query = new URLSearchParams();
    query.set("workspaceId", workspaceId);
    if (codebaseId) {
      query.set("codebaseId", codebaseId);
    }
    if (repoPath) {
      query.set("repoPath", repoPath);
    }

    const fetchSignals = async () => {
      setState((current) => ({ ...current, loading: true, error: null }));
      try {
        const response = await desktopAwareFetch(`/api/harness/repo-signals?${query.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load repository signals");
        }
        if (!cancelled) {
          setState({
            loading: false,
            error: null,
            data: payload as HarnessRepoSignalsResponse,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            data: null,
          });
        }
      }
    };

    void fetchSignals();
    return () => {
      cancelled = true;
    };
  }, [codebaseId, hasContext, repoPath, workspaceId]);

  const tone = categoryTone(mode);
  const focus = state.data?.[mode];
  const scriptGroups = useMemo(() => focus?.entrypointGroups ?? [], [focus]);
  const warnings = useMemo(() => state.data?.warnings ?? [], [state.data?.warnings]);
  const title = mode === "build" ? "Build Feedback" : "Test Feedback";
  const summaryRows = useMemo(() => {
    return (focus?.overviewRows ?? []).map((row) => ({
      label: row.label,
      values: row.items ?? [],
    })) ?? [];
  }, [focus]);

  return (
    <HarnessSectionCard
      title={title}
      hideHeader={hideHeader}
      variant={variant}
      dataTestId="repo-signals-panel"
    >
      {state.loading ? (
        <HarnessSectionStateFrame>
          {t.harness.repoSignals.loadingSignals}
        </HarnessSectionStateFrame>
      ) : null}

      {unsupportedMessage ? <HarnessUnsupportedState /> : null}

      {state.error && !unsupportedMessage ? (
        <HarnessSectionStateFrame tone="error">{state.error}</HarnessSectionStateFrame>
      ) : null}

      {!state.loading && !state.error && !unsupportedMessage && state.data ? (
        <div className={`mt-4 ${mode === "test" ? "grid gap-3 md:grid-cols-2" : "space-y-4"}`}>
          {mode === "build" ? (
            <div className="overflow-hidden rounded-sm border border-desktop-border bg-desktop-bg-primary/80">
              <div className="border-b border-desktop-border/70 px-4 py-3">
                <div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${tone.title}`}>{t.harness.repoSignals.overview}</div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-left">
                  <tbody>
                    {summaryRows.map((row) => (
                      <tr key={row.label} className="border-t border-desktop-border/60 first:border-t-0">
                        <th className="w-28 px-4 py-3 align-top text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">
                          {row.label}
                        </th>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            {row.values.length > 0 ? row.values.map((value) => (
                              <span key={`${row.label}-${value}`} className={`rounded-full border px-2.5 py-1 text-[10px] ${tone.badge}`}>
                                {value}
                              </span>
                            )) : (
                              <span className="text-[11px] text-desktop-text-secondary">{t.harness.repoSignals.noSignal}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className={`overflow-hidden rounded-sm border border-desktop-border bg-desktop-bg-primary/80 ${mode === "test" ? "md:col-span-2" : ""}`}>
            <div className="border-b border-desktop-border/70 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${tone.title}`}>{t.harness.repoSignals.entrypoints}</div>
                </div>
              </div>
            </div>

            {mode === "test" && summaryRows.length > 0 ? (
              <div className="border-b border-desktop-border/70 px-4 py-2.5">
                <div className="grid gap-2 md:grid-cols-2">
                  {summaryRows.map((row) => (
                    <div key={row.label} className="space-y-1">
                      <div className="text-[11px] font-semibold text-desktop-text-primary">{row.label}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {row.values.length > 0 ? row.values.map((value) => (
                          <span key={`${row.label}-${value}`} className={`rounded-full border px-2.5 py-1 text-[10px] ${tone.badge}`}>
                            {value}
                          </span>
                        )) : (
                          <span className="text-[11px] text-desktop-text-secondary">{t.harness.repoSignals.noSignal}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {scriptGroups.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-left">
                  <thead className="bg-white/60">
                    <tr className="text-[10px] uppercase tracking-[0.12em] text-desktop-text-secondary">
                      <th className="px-4 py-2.5 font-semibold">Group</th>
                      <th className="px-4 py-2.5 font-semibold">Primary</th>
                      <th className="px-4 py-2.5 font-semibold">Command</th>
                      <th className="px-4 py-2.5 font-semibold">Variants</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scriptGroups.map((group) => {
                      const primary = group.scripts[0];
                      const variants = group.scripts.slice(1);
                      return (
                        <tr key={group.category} className="border-t border-desktop-border/60 first:border-t-0">
                          <td className="px-4 py-3 align-top">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-semibold text-desktop-text-primary">{group.label}</span>
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] ${tone.badge}`}>{group.scripts.length}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top text-[11px] font-semibold text-desktop-text-primary">
                            {primary?.name ?? "—"}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div className="max-w-full break-all font-mono text-[10px] leading-5 text-desktop-text-secondary">
                              {primary?.command ?? "—"}
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div className="flex flex-wrap gap-2">
                              {variants.length > 0 ? summarizeScripts(variants, 3, t.harness.repoSignals.moreSuffix.replace('{count}', `${variants.length - 3}`)).map((value) => (
                                <span key={`${group.category}-${value}`} className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                                  {value}
                                </span>
                              )) : (
                                <span className="text-[11px] text-desktop-text-secondary">{t.harness.repoSignals.noVariants}</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 py-5 text-[11px] text-desktop-text-secondary">
                {t.harness.repoSignals.noMatchingScripts}
              </div>
            )}
          </div>

          {warnings.length > 0 ? (
            <div className={`space-y-2 ${mode === "test" ? "md:col-span-2" : ""}`}>
              {warnings.map((warning) => (
                <div key={warning} className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-3 text-[11px] text-amber-800">
                  {warning}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </HarnessSectionCard>
  );
}
