"use client";

import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import type { HooksResponse } from "@/client/hooks/use-harness-settings-data";

type ReviewTriggersPanelProps = {
  repoLabel: string;
  unsupportedMessage?: string | null;
  data?: HooksResponse | null;
  loading?: boolean;
  error?: string | null;
  variant?: "full" | "compact";
};

function formatTokenLabel(value: string): string {
  return value
    .split(/[-_]/u)
    .filter(Boolean)
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join(" ");
}

function severityTone(value: string): string {
  if (value === "high") return "border-rose-200 bg-rose-50 text-rose-700";
  if (value === "medium") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary";
}

export function HarnessReviewTriggersPanel({
  repoLabel,
  unsupportedMessage,
  data,
  loading = false,
  error = null,
  variant = "full",
}: ReviewTriggersPanelProps) {
  const reviewTriggerFile = data?.reviewTriggerFile ?? null;
  const profiles = data?.profiles ?? [];
  const reviewProfiles = profiles.filter((profile) => profile.phases.includes("review"));
  const reviewHooks = reviewProfiles.flatMap((profile) => profile.hooks);
  const compactMode = variant === "compact";

  return (
    <section className={compactMode
      ? "rounded-2xl border border-amber-200 bg-amber-50/55 p-4"
      : "rounded-2xl border border-amber-200 bg-amber-50/45 p-4 shadow-sm"}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-800">Review triggers</div>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="rounded-full border border-amber-200 bg-white/85 px-2.5 py-1 text-amber-800">
            {repoLabel}
          </span>
          <span className="rounded-full border border-amber-200 bg-white/85 px-2.5 py-1 text-amber-800">
            {reviewTriggerFile?.ruleCount ?? 0} rules
          </span>
          <span className="rounded-full border border-amber-200 bg-white/85 px-2.5 py-1 text-amber-800">
            {reviewProfiles.length} review profiles
          </span>
          <span className="rounded-full border border-amber-200 bg-white/85 px-2.5 py-1 text-amber-800">
            entrix review-trigger
          </span>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-white/80 px-4 py-5 text-[11px] text-amber-900/75">
          Loading review trigger policies...
        </div>
      ) : null}

      {unsupportedMessage ? (
        <HarnessUnsupportedState />
      ) : null}

      {error && !unsupportedMessage ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-[11px] text-red-700">
          {error}
        </div>
      ) : null}

      {!loading && !error && !unsupportedMessage && !reviewTriggerFile ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-white/80 px-4 py-5 text-[11px] text-amber-900/75">
          No `docs/fitness/review-triggers.yaml` file was found for the selected repository.
        </div>
      ) : null}

      {!loading && !error && !unsupportedMessage && reviewTriggerFile ? (
        <div className={`mt-4 grid gap-4 ${compactMode ? "grid-cols-1" : "xl:grid-cols-[300px_minmax(0,1fr)]"}`}>
          <div className="rounded-2xl border border-amber-200 bg-white/70 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">Policy scope</div>
                <h4 className="mt-1 text-sm font-semibold text-desktop-text-primary">Activation surface</h4>
              </div>
              <div className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] text-amber-800">
                {reviewHooks.length} hooks
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-3 text-[11px] text-desktop-text-secondary">
              <div className="font-mono text-desktop-text-primary">
                {reviewTriggerFile.relativePath}
              </div>
              <div className="mt-2">
                Runtime profiles enter this gate whenever their phase list includes `review`.
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">Profiles</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {reviewProfiles.length > 0 ? reviewProfiles.map((profile) => (
                    <span
                      key={profile.name}
                      className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[10px] text-amber-800"
                    >
                      {profile.name}
                    </span>
                  )) : (
                    <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                      No review phase configured
                    </span>
                  )}
                </div>
              </div>

              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">Hooks</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {reviewHooks.length > 0 ? [...new Set(reviewHooks)].map((hook) => (
                    <span
                      key={hook}
                      className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[10px] text-amber-800"
                    >
                      {hook}
                    </span>
                  )) : (
                    <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                      No hook binding
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-amber-200 bg-white/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">Rule catalog</div>
                <h4 className="mt-1 text-sm font-semibold text-desktop-text-primary">Diff-sensitive escalation rules</h4>
                <div className="mt-1 text-[11px] text-desktop-text-secondary">
                  These rules decide when a push requires explicit human review before continuing.
                </div>
              </div>
            </div>

            {reviewTriggerFile.rules.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {reviewTriggerFile.rules.map((rule) => (
                  <div key={rule.name} className="rounded-xl border border-amber-200 bg-white/85 px-3 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-desktop-text-primary">{rule.name}</div>
                        <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-desktop-text-secondary">
                          <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5">
                            {formatTokenLabel(rule.type)}
                          </span>
                          <span className={`rounded-full border px-2 py-0.5 ${severityTone(rule.severity)}`}>
                            {rule.severity}
                          </span>
                          <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5">
                            {formatTokenLabel(rule.action)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-desktop-text-secondary">
                      {rule.pathCount > 0 ? (
                        <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5">
                          {rule.pathCount} paths
                        </span>
                      ) : null}
                      {rule.evidencePathCount > 0 ? (
                        <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5">
                          {rule.evidencePathCount} evidence paths
                        </span>
                      ) : null}
                      {rule.boundaryCount > 0 ? (
                        <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5">
                          {rule.boundaryCount} boundaries
                        </span>
                      ) : null}
                      {rule.directoryCount > 0 ? (
                        <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5">
                          {rule.directoryCount} directories
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-white/80 px-3 py-3 text-[11px] text-desktop-text-secondary">
                The YAML file loaded successfully, but no `review_triggers` entries were parsed.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
