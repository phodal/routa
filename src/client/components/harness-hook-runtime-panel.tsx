"use client";

import { useEffect, useMemo, useState } from "react";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import type { HooksResponse } from "@/client/hooks/use-harness-settings-data";

type HooksPanelProps = {
  workspaceId: string;
  codebaseId?: string;
  repoPath?: string;
  repoLabel: string;
  unsupportedMessage?: string | null;
  data?: HooksResponse | null;
  loading?: boolean;
  error?: string | null;
  variant?: "full" | "compact";
};

type HooksState = {
  loading: boolean;
  error: string | null;
  data: HooksResponse | null;
};

const GIT_HOOK_CATALOG = [
  "pre-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "pre-rebase",
  "post-checkout",
  "post-merge",
  "pre-push",
  "post-rewrite",
] as const;

function formatTokenLabel(value: string): string {
  return value
    .split(/[-_]/u)
    .filter(Boolean)
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function HarnessHookRuntimePanel({
  workspaceId,
  codebaseId,
  repoPath,
  repoLabel,
  unsupportedMessage,
  data,
  loading,
  error,
  variant = "full",
}: HooksPanelProps) {
  const hasExternalState = loading !== undefined || error !== undefined || data !== undefined;
  const [hooksState, setHooksState] = useState<HooksState>({
    loading: false,
    error: null,
    data: null,
  });
  const [selectedHookName, setSelectedHookName] = useState<string | null>(null);

  useEffect(() => {
    if (hasExternalState) {
      return;
    }
    if (!workspaceId || !repoPath) {
      setHooksState({
        loading: false,
        error: null,
        data: null,
      });
      return;
    }

    let cancelled = false;
    const fetchHooks = async () => {
      setHooksState((current) => ({
        ...current,
        loading: true,
        error: null,
      }));

      try {
        const query = new URLSearchParams();
        query.set("workspaceId", workspaceId);
        if (codebaseId) {
          query.set("codebaseId", codebaseId);
        }
        query.set("repoPath", repoPath);

        const response = await fetch(`/api/harness/hooks?${query.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load hook runtime");
        }

        if (cancelled) {
          return;
        }

        setHooksState({
          loading: false,
          error: null,
          data: payload as HooksResponse,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setHooksState({
          loading: false,
          error: error instanceof Error ? error.message : String(error),
          data: null,
        });
      }
    };

    void fetchHooks();
    return () => {
      cancelled = true;
    };
  }, [codebaseId, hasExternalState, repoPath, workspaceId]);

  const resolvedHooksState = hasExternalState
    ? {
      loading: loading ?? false,
      error: error ?? null,
      data: data ?? null,
    }
    : hooksState;

  const orderedProfiles = useMemo(() => {
    const profiles = resolvedHooksState.data?.profiles ?? [];
    const hookOrder = new Map((resolvedHooksState.data?.hookFiles ?? []).map((hook, index) => [hook.name, index]));

    return profiles
      .map((profile, yamlIndex) => {
        const firstBoundHookIndex = profile.hooks
          .map((hookName) => hookOrder.get(hookName))
          .find((index): index is number => typeof index === "number");
        return { profile, yamlIndex, firstBoundHookIndex };
      })
      .sort((left, right) => {
        const leftIsBound = typeof left.firstBoundHookIndex === "number";
        const rightIsBound = typeof right.firstBoundHookIndex === "number";
        if (leftIsBound && rightIsBound) {
          const leftBoundIndex = left.firstBoundHookIndex ?? Number.MAX_SAFE_INTEGER;
          const rightBoundIndex = right.firstBoundHookIndex ?? Number.MAX_SAFE_INTEGER;
          return leftBoundIndex - rightBoundIndex;
        }
        if (leftIsBound) {
          return -1;
        }
        if (rightIsBound) {
          return 1;
        }
        return left.yamlIndex - right.yamlIndex;
      })
      .map(({ profile }) => profile);
  }, [resolvedHooksState.data?.hookFiles, resolvedHooksState.data?.profiles]);

  const hookEntries = useMemo(() => {
    const hookFilesByName = new Map((resolvedHooksState.data?.hookFiles ?? []).map((hook) => [hook.name, hook]));
    const profilesByName = new Map(orderedProfiles.map((profile) => [profile.name, profile]));

    return GIT_HOOK_CATALOG.map((hookName) => {
      const hookFile = hookFilesByName.get(hookName) ?? null;
      const runtimeProfile = hookFile?.runtimeProfileName
        ? profilesByName.get(hookFile.runtimeProfileName) ?? null
        : null;
      return {
        hookName,
        runtimeProfile,
        isConfigured: Boolean(hookFile && runtimeProfile),
      };
    });
  }, [orderedProfiles, resolvedHooksState.data?.hookFiles]);

  const defaultSelectableHook = useMemo(
    () => hookEntries.find((entry) => entry.isConfigured) ?? null,
    [hookEntries],
  );

  const activeHookName = useMemo(() => {
    if (!defaultSelectableHook) {
      return selectedHookName ?? "";
    }

    const selectedEntry = hookEntries.find((entry) => entry.hookName === selectedHookName && entry.isConfigured);
    if (selectedEntry) {
      return selectedEntry.hookName;
    }

    return defaultSelectableHook.hookName;
  }, [defaultSelectableHook, hookEntries, selectedHookName]);

  const activeHookEntry = useMemo(
    () => hookEntries.find((entry) => entry.hookName === activeHookName) ?? defaultSelectableHook ?? null,
    [activeHookName, defaultSelectableHook, hookEntries],
  );

  const runtimeProfile = activeHookEntry?.runtimeProfile ?? null;
  const compactMode = variant === "compact";

  const hookCount = resolvedHooksState.data?.hookFiles.length ?? 0;
  const profileCount = resolvedHooksState.data?.profiles.length ?? 0;
  const metricCount = resolvedHooksState.data?.profiles.reduce((sum, profile) => sum + profile.metrics.length, 0) ?? 0;

  return (
    <section className={variant === "compact"
      ? "rounded-2xl border border-desktop-border bg-desktop-bg-primary/60 p-4"
      : "rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm"}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Hook system</div>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-desktop-text-secondary">
            {repoLabel}
          </span>
          <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-desktop-text-secondary">
            {hookCount} hooks
          </span>
          <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-desktop-text-secondary">
            {profileCount} runtime profiles
          </span>
          <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-desktop-text-secondary">
            {metricCount} mapped metrics
          </span>
        </div>
      </div>

      {resolvedHooksState.loading ? (
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
          Loading hook runtime...
        </div>
      ) : null}

      {unsupportedMessage ? (
        <HarnessUnsupportedState />
      ) : null}

      {resolvedHooksState.error && !unsupportedMessage ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-[11px] text-red-700">
          {resolvedHooksState.error}
        </div>
      ) : null}

      {!unsupportedMessage && resolvedHooksState.data?.warnings.length ? (
        <div className="mt-4 space-y-2">
          {resolvedHooksState.data.warnings.map((warning) => (
            <div key={warning} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-[11px] text-amber-800">
              {warning}
            </div>
          ))}
        </div>
      ) : null}

      {!resolvedHooksState.loading && !resolvedHooksState.error && !unsupportedMessage && !resolvedHooksState.data?.profiles.length ? (
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
          No hook profiles found for the selected repository.
        </div>
      ) : null}

      {!unsupportedMessage && resolvedHooksState.data ? (
        <div className={`mt-4 grid gap-4 ${compactMode ? "grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(220px,0.95fr)]" : "xl:grid-cols-[300px_minmax(0,1fr)]"}`}>
          <div className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Git hooks</div>
                <h4 className="mt-1 text-sm font-semibold text-desktop-text-primary">Configured profiles</h4>
              </div>
              <div className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                {hookEntries.length} hooks
              </div>
            </div>

            <div className="mt-4 space-y-1.5">
              {hookEntries.map((entry) => {
                const isSelected = activeHookEntry?.hookName === entry.hookName;
                const profile = entry.runtimeProfile;
                return (
                  <button
                    key={entry.hookName}
                    type="button"
                    disabled={!entry.isConfigured}
                    onClick={() => {
                      if (!entry.isConfigured) {
                        return;
                      }
                      setSelectedHookName(entry.hookName);
                    }}
                    className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                      isSelected
                        ? "border-desktop-accent bg-desktop-bg-secondary text-desktop-text-primary"
                        : !entry.isConfigured
                          ? "cursor-not-allowed border-desktop-border bg-desktop-bg-primary/50 text-desktop-text-secondary/55"
                          : "border-desktop-border bg-desktop-bg-primary/80 text-desktop-text-secondary hover:bg-desktop-bg-secondary"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold">{entry.hookName}</div>
                        <div className="mt-1 text-[10px]">
                          {profile ? `${profile.name} · ${profile.metrics.length} metrics` : "Not configured"}
                        </div>
                      </div>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] ${
                        entry.isConfigured
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary/60"
                      }`}>
                        {entry.isConfigured ? "active" : "missing"}
                      </span>
                    </div>
                    {profile ? (
                      <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] text-desktop-text-secondary">
                        {profile.phases.slice(0, 2).map((phase) => (
                          <span
                            key={`${entry.hookName}-${phase}`}
                            className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5"
                          >
                            {formatTokenLabel(phase)}
                          </span>
                        ))}
                        {profile.phases.includes("review") ? (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">
                            review gate
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-1 text-[10px] text-desktop-text-secondary/55">
                        No runtime profile
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-desktop-border bg-desktop-bg-primary/60 p-4">
            {runtimeProfile ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Selected profile</div>
                    <h4 className="mt-1 text-sm font-semibold text-desktop-text-primary">{runtimeProfile.name}</h4>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[10px]">
                    {activeHookEntry ? (
                      <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">
                        {activeHookEntry.hookName}
                      </span>
                    ) : null}
                    <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">
                      {runtimeProfile.phases.length} phases
                    </span>
                    <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">
                      {runtimeProfile.fallbackMetrics.length} metrics
                    </span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Phase breakdown</div>
                      <div className="mt-1 text-[11px] text-desktop-text-secondary">
                        Runtime orchestration from `docs/fitness/runtime/hooks.yaml`
                      </div>
                    </div>
                    <div className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                      {runtimeProfile.phases.length} phases
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {runtimeProfile.phases.map((phase) => (
                      <span
                        key={`${runtimeProfile.name}-${phase}`}
                        className={`rounded-full border px-2.5 py-1 text-[10px] ${
                          phase === "review"
                            ? "border-amber-200 bg-amber-50 text-amber-800"
                            : "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary"
                        }`}
                      >
                        {formatTokenLabel(phase)}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Mapped metrics</div>
                      <div className="mt-1 text-[11px] text-desktop-text-secondary">
                        Configured metrics resolved from `docs/fitness/manifest.yaml`
                      </div>
                    </div>
                    <div className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                      {runtimeProfile.metrics.length} metrics
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {runtimeProfile.metrics.map((metric) => (
                      <div key={metric.name} className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[12px] font-semibold text-desktop-text-primary">{metric.name}</div>
                            {metric.command ? (
                              <div className="mt-1 break-all font-mono text-[11px] text-desktop-text-secondary">{metric.command}</div>
                            ) : null}
                            {metric.description ? (
                              <div className="mt-2 text-[11px] leading-5 text-desktop-text-secondary">{metric.description}</div>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2 text-[10px]">
                            <span className={`rounded-full border px-2.5 py-1 ${
                              metric.resolved
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-amber-200 bg-amber-50 text-amber-800"
                            }`}>
                              {metric.resolved ? "resolved" : "unresolved"}
                            </span>
                            {metric.hardGate ? (
                              <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-red-700">
                                hard gate
                              </span>
                            ) : null}
                          </div>
                        </div>
                        {metric.sourceFile ? (
                          <div className="mt-3 text-[10px] font-mono text-desktop-text-secondary">{metric.sourceFile}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
                No runtime profiles found for the selected repository.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
