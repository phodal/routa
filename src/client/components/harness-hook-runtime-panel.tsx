"use client";

import { useEffect, useMemo, useState } from "react";
import { CodeViewer } from "@/client/components/codemirror/code-viewer";

type HookProfileName = string;
type RuntimePhase = string;

type HookMetricSummary = {
  name: string;
  command: string;
  description: string;
  hardGate: boolean;
  resolved: boolean;
  sourceFile?: string;
};

type HookRuntimeProfileSummary = {
  name: HookProfileName;
  phases: RuntimePhase[];
  fallbackMetrics: string[];
  metrics: HookMetricSummary[];
  hooks: string[];
};

type HookFileSummary = {
  name: string;
  relativePath: string;
  source: string;
  triggerCommand: string;
  kind: "runtime-profile" | "shell-command";
  runtimeProfileName?: HookProfileName;
  skipEnvVar?: string;
};

type HooksResponse = {
  generatedAt: string;
  repoRoot: string;
  hooksDir: string;
  configFile: {
    relativePath: string;
    source: string;
    schema?: string;
  } | null;
  hookFiles: HookFileSummary[];
  profiles: HookRuntimeProfileSummary[];
  warnings: string[];
};

type HooksPanelProps = {
  workspaceId: string;
  codebaseId?: string;
  repoPath?: string;
  repoLabel: string;
};

type HooksState = {
  loading: boolean;
  error: string | null;
  data: HooksResponse | null;
};

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
}: HooksPanelProps) {
  const [hooksState, setHooksState] = useState<HooksState>({
    loading: false,
    error: null,
    data: null,
  });
  const [selectedProfileName, setSelectedProfileName] = useState<HookProfileName | null>(null);

  useEffect(() => {
    if (!workspaceId || !codebaseId || !repoPath) {
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
        query.set("codebaseId", codebaseId);
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
  }, [workspaceId, codebaseId, repoPath]);

  const orderedProfiles = useMemo(() => {
    const profiles = hooksState.data?.profiles ?? [];
    const hookOrder = new Map((hooksState.data?.hookFiles ?? []).map((hook, index) => [hook.name, index]));

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
  }, [hooksState.data?.hookFiles, hooksState.data?.profiles]);

  const defaultSelectableProfile = useMemo(
    () => orderedProfiles.find((profile) => profile.hooks.length > 0) ?? orderedProfiles[0] ?? null,
    [orderedProfiles],
  );

  const activeProfileName = useMemo(() => {
    if (!defaultSelectableProfile) {
      return selectedProfileName ?? "";
    }

    const selectedProfile = orderedProfiles.find((profile) => profile.name === selectedProfileName);
    if (selectedProfile?.hooks.length) {
      return selectedProfile.name;
    }

    return defaultSelectableProfile.name;
  }, [defaultSelectableProfile, orderedProfiles, selectedProfileName]);

  const runtimeProfile = useMemo(
    () => orderedProfiles.find((profile) => profile.name === activeProfileName) ?? orderedProfiles[0] ?? null,
    [activeProfileName, orderedProfiles],
  );

  const boundHooks = useMemo(() => {
    if (!runtimeProfile) {
      return [];
    }
    return (hooksState.data?.hookFiles ?? []).filter((hook) => hook.runtimeProfileName === runtimeProfile.name);
  }, [hooksState.data?.hookFiles, runtimeProfile]);

  const hookCount = hooksState.data?.hookFiles.length ?? 0;
  const profileCount = hooksState.data?.profiles.length ?? 0;
  const metricCount = hooksState.data?.profiles.reduce((sum, profile) => sum + profile.metrics.length, 0) ?? 0;
  const configFile = hooksState.data?.configFile ?? null;

  return (
    <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Hook system</div>
          <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">hooks.yaml driven local gate profiles</h3>
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

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-desktop-text-secondary">
        <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1">
          hooks.yaml = source of truth
        </span>
        <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1">
          Git hook files = trigger bindings
        </span>
      </div>

      {hooksState.loading ? (
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
          Loading hook runtime...
        </div>
      ) : null}

      {hooksState.error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-[11px] text-red-700">
          {hooksState.error}
        </div>
      ) : null}

      {hooksState.data?.warnings.length ? (
        <div className="mt-4 space-y-2">
          {hooksState.data.warnings.map((warning) => (
            <div key={warning} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-[11px] text-amber-800">
              {warning}
            </div>
          ))}
        </div>
      ) : null}

      {configFile ? (
        <div className="mt-4 rounded-2xl border border-desktop-border bg-desktop-bg-primary/60 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Config source</div>
              <h4 className="mt-1 text-sm font-semibold text-desktop-text-primary">{configFile.relativePath}</h4>
              <div className="mt-2 text-[11px] leading-5 text-desktop-text-secondary">
                Hook runtime profiles are now assembled from checked-in YAML, then resolved into phases and fitness metrics.
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-[10px]">
              {configFile.schema ? (
                <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">
                  {configFile.schema}
                </span>
              ) : null}
              <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">
                {profileCount} profiles
              </span>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="rounded-xl border border-desktop-border bg-desktop-bg-secondary/55 p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">YAML source</div>
              <CodeViewer
                code={configFile.source}
                filename="hooks.yaml"
                language="yaml"
                maxHeight="320px"
                showHeader={false}
                wordWrap
              />
            </div>

            <div className="rounded-xl border border-desktop-border bg-desktop-bg-secondary/55 p-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Resolved profiles</div>
              <div className="mt-3 space-y-3">
                {orderedProfiles.map((profile) => (
                  <div key={`config-${profile.name}`} className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[12px] font-semibold text-desktop-text-primary">{profile.name}</div>
                      <div className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                        {profile.fallbackMetrics.length} metrics
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-desktop-text-secondary">
                      {profile.phases.map((phase, index) => (
                        <span key={`${profile.name}-${phase}`} className="flex items-center gap-2">
                          {index > 0 ? <span>{"->"}</span> : null}
                          <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1">
                            {formatTokenLabel(phase)}
                          </span>
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-desktop-text-secondary">
                      {profile.fallbackMetrics.map((metric) => (
                        <span key={`${profile.name}-${metric}`} className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5">
                          {metric}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {!hooksState.loading && !hooksState.error && !hooksState.data?.profiles.length ? (
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
          No hook profiles found for the selected repository.
        </div>
      ) : null}

      {hooksState.data?.profiles.length ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
          <div className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Profiles</div>
                <h4 className="mt-1 text-sm font-semibold text-desktop-text-primary">Configured profiles</h4>
              </div>
              <div className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                {hooksState.data.profiles.length} profiles
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {orderedProfiles.map((profile) => {
                const isUnbound = profile.hooks.length === 0;
                return (
                  <button
                    key={profile.name}
                    type="button"
                    disabled={isUnbound}
                    onClick={() => {
                      setSelectedProfileName(profile.name);
                    }}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                      runtimeProfile?.name === profile.name
                        ? "border-desktop-accent bg-desktop-bg-secondary text-desktop-text-primary"
                        : isUnbound
                          ? "cursor-not-allowed border-desktop-border bg-desktop-bg-primary/45 text-desktop-text-secondary/55"
                          : "border-desktop-border bg-desktop-bg-primary/80 text-desktop-text-secondary hover:bg-desktop-bg-secondary"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold">{profile.name}</div>
                        <div className="mt-1 text-[10px]">{profile.phases.length} phases · {profile.fallbackMetrics.length} metrics</div>
                      </div>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] ${
                        isUnbound
                          ? "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary/60"
                          : "border-emerald-200 bg-emerald-50 text-emerald-700"
                      }`}>
                        {isUnbound ? "unbound" : `${profile.hooks.length} hooks`}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-desktop-text-secondary">
                      {profile.phases.map((phase) => (
                        <span
                          key={`${profile.name}-${phase}`}
                          className={`rounded-full border px-2 py-0.5 ${
                            isUnbound
                              ? "border-desktop-border bg-desktop-bg-primary/60 text-desktop-text-secondary/60"
                              : "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary"
                          }`}
                        >
                          {formatTokenLabel(phase)}
                        </span>
                      ))}
                    </div>
                    {isUnbound ? (
                      <div className="mt-2 text-[10px] text-desktop-text-secondary/60">
                        Configured in `hooks.yaml`, but not wired by any checked-in git hook file.
                      </div>
                    ) : null}
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
                    <div className="mt-2 text-[11px] leading-5 text-desktop-text-secondary">
                      Profile assembly comes from `hooks.yaml`, while metrics resolve from fitness docs and git hooks stay as thin trigger bindings.
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[10px]">
                    <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">
                      {runtimeProfile.phases.length} phases
                    </span>
                    <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">
                      {runtimeProfile.fallbackMetrics.length} metrics
                    </span>
                  </div>
                </div>

                <div className="rounded-xl border border-desktop-border bg-desktop-bg-secondary/55 p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Git bindings</div>
                  <div className="mt-3 space-y-2">
                    {boundHooks.length > 0 ? boundHooks.map((hook) => (
                      <div key={`${runtimeProfile.name}-${hook.name}`} className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-[12px] font-semibold text-desktop-text-primary">{hook.name}</div>
                            <div className="mt-1 font-mono text-[10px] text-desktop-text-secondary">{hook.relativePath}</div>
                            <div className="mt-2 break-all font-mono text-[10px] text-desktop-text-secondary">{hook.triggerCommand}</div>
                          </div>
                          {hook.skipEnvVar ? (
                            <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                              skip {hook.skipEnvVar}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-4 text-[11px] text-desktop-text-secondary">
                        No checked-in git hook file currently binds to this profile.
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                  <div className="rounded-xl border border-desktop-border bg-desktop-bg-secondary/55 p-4">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Phase contract</div>
                      <div className="mt-3 space-y-2">
                        {runtimeProfile.phases.map((phase, index) => (
                          <div key={phase} className="flex items-center gap-3 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-3 py-2 text-[11px]">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full border border-desktop-border bg-desktop-bg-secondary text-[10px] text-desktop-text-primary">
                              {index + 1}
                            </div>
                            <div>
                              <div className="font-semibold text-desktop-text-primary">{formatTokenLabel(phase)}</div>
                              <div className="text-desktop-text-secondary">{phase}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                  <div className="rounded-xl border border-desktop-border bg-desktop-bg-secondary/55 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Mapped metrics</div>
                          <div className="mt-1 text-[11px] text-desktop-text-secondary">
                            Configured metrics resolved from `docs/fitness/manifest.yaml`
                          </div>
                        </div>
                        <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
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
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
