"use client";

import { HarnessSectionCard, HarnessSectionStateFrame } from "@/client/components/harness-section-card";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import type { CodeownersResponse } from "@/core/harness/codeowners-types";

type HarnessCodeownersPanelProps = {
  repoLabel: string;
  unsupportedMessage?: string | null;
  data?: CodeownersResponse | null;
  loading?: boolean;
  error?: string | null;
  variant?: "full" | "compact";
};

function ListBlock({
  title,
  items,
  tone,
  rowLimit = 8,
}: {
  title: string;
  items: string[];
  tone: "neutral" | "amber" | "rose";
  rowLimit?: number;
}) {
  const border =
    tone === "rose"
      ? "border-rose-200 bg-rose-50/60"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50/60"
        : "border-desktop-border bg-desktop-bg-primary/80";
  if (items.length === 0) {
    return null;
  }
  const visibleRows = `${Math.min(items.length, rowLimit) * 1.5}rem`;
  return (
    <div className={`rounded-sm border px-3 py-2 ${border}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">{title}</div>
      <ul
        className="mt-1.5 list-inside list-disc space-y-0.5 overflow-y-auto font-mono text-[11px] text-desktop-text-primary"
        style={{ maxHeight: visibleRows }}
      >
        {items.map((path) => (
          <li key={path}>{path}</li>
        ))}
      </ul>
    </div>
  );
}

function formatTriggerLabel(value: string): string {
  return value
    .split(/[_-]/u)
    .filter(Boolean)
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function HarnessCodeownersPanel({
  repoLabel: _repoLabel,
  unsupportedMessage,
  data,
  loading = false,
  error = null,
  variant = "full",
}: HarnessCodeownersPanelProps) {
  const compactMode = variant === "compact";

  return (
    <HarnessSectionCard
      title="CODEOWNERS"
      variant={variant}
    >
      {loading ? (
        <HarnessSectionStateFrame tone="warning">Loading CODEOWNERS...</HarnessSectionStateFrame>
      ) : null}

      {unsupportedMessage ? (
        <HarnessUnsupportedState className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-5 text-[11px] text-amber-800" />
      ) : null}

      {error && !unsupportedMessage ? (
        <HarnessSectionStateFrame tone="error">{error}</HarnessSectionStateFrame>
      ) : null}

      {!loading && !error && !unsupportedMessage && data ? (
        <div className="space-y-4">
          {data.warnings.length > 0 ? (
            <div className="rounded-sm border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-900">
              <div className="font-semibold">Warnings</div>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {data.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.correlation?.triggerCorrelations.length ? (
            <div className="space-y-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">
                Trigger Correlation
              </div>
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-6">
                {data.correlation.triggerCorrelations.map((correlation) => (
                  <div
                    key={correlation.triggerName}
                    className="rounded-sm border border-desktop-border bg-desktop-bg-primary/80 px-3 py-2"
                  >
                    <div className="grid gap-1.5">
                      <span className="font-medium text-desktop-text-primary">
                        {formatTriggerLabel(correlation.triggerName)}
                      </span>
                      <div className="grid gap-1 text-[10px] text-desktop-text-secondary">
                        <span className="inline-flex items-center gap-2">
                          <span className="font-medium text-desktop-text-primary">Severity</span>
                          <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5">
                            {correlation.severity}
                          </span>
                        </span>
                        <span>{correlation.touchedFileCount} files</span>
                        <span>{correlation.ownerGroupCount} owner groups</span>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-desktop-text-secondary">
                      {correlation.hasOwnershipGap ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">
                          ownership gap
                        </span>
                      ) : null}
                      {correlation.spansMultipleOwnerGroups ? (
                        <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-700">
                          cross-owner
                        </span>
                      ) : null}
                    </div>
                    {correlation.ownerGroups.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {correlation.ownerGroups.map((owner) => (
                          <span
                            key={`${correlation.triggerName}-${owner}`}
                            className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5 text-[10px] text-desktop-text-primary"
                          >
                            {owner}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {data.correlation?.hotspots.length ? (
            <div className="rounded-sm border border-rose-200 bg-rose-50/60 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-800">Governance hotspots</div>
              <ul className="mt-1.5 space-y-1 text-[11px] text-rose-900">
                {data.correlation.hotspots.map((hotspot) => (
                  <li key={`${hotspot.triggerName}-${hotspot.reason}`}>
                    <span className="font-medium">{formatTriggerLabel(hotspot.triggerName)}</span>
                    {": "}
                    {hotspot.reason}
                    {hotspot.samplePaths.length ? ` (${hotspot.samplePaths.join(", ")})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.owners.length > 0 ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">Owner groups</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {data.owners.map((o) => (
                  <div
                    key={o.name}
                    className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-[11px] font-medium text-desktop-text-primary">{o.name}</span>
                      <span className="rounded bg-desktop-bg-secondary px-1.5 py-0.5 text-[10px] text-desktop-text-secondary">{o.kind}</span>
                    </div>
                    <div className="mt-1 text-[10px] text-desktop-text-secondary">{o.matchedFileCount} files</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {data.rules.length > 0 ? (
            <div className="max-h-56 overflow-x-auto overflow-y-auto rounded-sm border border-desktop-border">
              <table className="w-full min-w-[480px] border-collapse text-left text-[11px]">
                <thead>
                  <tr className="border-b border-desktop-border bg-desktop-bg-secondary/60">
                    <th className="px-3 py-2 font-semibold text-desktop-text-secondary">Pattern</th>
                    <th className="px-3 py-2 font-semibold text-desktop-text-secondary">Owners</th>
                    <th className="px-3 py-2 font-semibold text-desktop-text-secondary">Line</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rules.map((rule) => (
                    <tr key={`${rule.line}-${rule.pattern}`} className="border-b border-desktop-border/80">
                      <td className="px-3 py-2 font-mono text-desktop-text-primary">{rule.pattern}</td>
                      <td className="px-3 py-2 text-desktop-text-primary">{rule.owners.join(", ")}</td>
                      <td className="px-3 py-2 text-desktop-text-secondary">{rule.line}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <ListBlock title="Unowned files (sample)" items={data.coverage.unownedFiles} tone="amber" rowLimit={compactMode ? 5 : 8} />
            <ListBlock
              title="Overlapping matches (sample)"
              items={data.coverage.overlappingFiles}
              tone="neutral"
              rowLimit={compactMode ? 5 : 8}
            />
          </div>
          <ListBlock
            title="Sensitive paths without ownership"
            items={data.coverage.sensitiveUnownedFiles}
            tone="rose"
            rowLimit={compactMode ? 5 : 8}
          />
        </div>
      ) : null}
    </HarnessSectionCard>
  );
}
