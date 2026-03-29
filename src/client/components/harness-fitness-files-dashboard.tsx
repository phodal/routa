"use client";

import { useMemo } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
} from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";

import type { FitnessSpecSummary } from "@/client/hooks/use-harness-settings-data";

import { buildHarnessFitnessFilesDashboardModel } from "./harness-fitness-files-dashboard-model";
import { HarnessUnsupportedState } from "./harness-support-state";

type HarnessFitnessFilesDashboardProps = {
  specFiles: FitnessSpecSummary[];
  selectedSpec: FitnessSpecSummary | null;
  loading: boolean;
  error?: string | null;
  unsupportedMessage?: string | null;
};

function DimensionDensityTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload?.length) {
    return null;
  }

  const datum = payload[0]?.payload as {
    label: string;
    fileName: string;
    densityScore: number;
    metricCount: number;
    hardGateCount: number;
  };

  return (
    <div className="rounded-xl border border-desktop-border bg-white/95 px-3 py-2 text-[11px] shadow-lg dark:bg-slate-950/95">
      <div className="font-semibold text-desktop-text-primary">{datum.label}</div>
      <div className="mt-1 text-desktop-text-secondary">{datum.fileName}</div>
      <div className="mt-2 text-desktop-text-primary">score {datum.densityScore}</div>
      <div className="text-desktop-text-secondary">{datum.metricCount} metrics</div>
      <div className="text-desktop-text-secondary">{datum.hardGateCount} hard gates</div>
    </div>
  );
}

export function HarnessFitnessFilesDashboard({
  specFiles,
  selectedSpec,
  loading,
  error,
  unsupportedMessage,
}: HarnessFitnessFilesDashboardProps) {
  const model = useMemo(
    () => buildHarnessFitnessFilesDashboardModel(specFiles, selectedSpec),
    [selectedSpec, specFiles],
  );

  return (
    <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Discovery</div>
          <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">Fitness files</h3>
          <p className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">
            Spec-derived dimension density score from `docs/fitness`.
          </p>
        </div>
      </div>

      {unsupportedMessage ? (
        <div className="mt-4">
          <HarnessUnsupportedState className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-[11px] text-amber-800" />
        </div>
      ) : null}

      {!unsupportedMessage && loading ? (
        <div className="mt-4 rounded-2xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-8 text-sm text-desktop-text-secondary">
          Loading fitness files...
        </div>
      ) : null}

      {!unsupportedMessage && error ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-[11px] leading-5 text-rose-700">
          {error}
        </div>
      ) : null}

      {!unsupportedMessage && !loading && !error ? (
        <div className="mt-4" data-testid="harness-fitness-files-dashboard">
          <section className="rounded-2xl border border-desktop-border bg-white/80 p-4 shadow-sm dark:bg-white/6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Dimension radar</div>
                <p className="mt-1 text-[12px] leading-5 text-desktop-text-secondary">
                  Score is normalized from `metricCount`, with the densest dimension fixed at 100.
                </p>
              </div>
              {model.selectedDimension ? (
                <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
                  {model.selectedDimension.label} · score {model.selectedDimension.densityScore}
                </div>
              ) : null}
            </div>

            {model.dimensions.length > 0 ? (
              <div className="mt-4 h-[360px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={model.dimensions} outerRadius="70%">
                    <PolarGrid stroke="#d8dee8" />
                    <PolarAngleAxis dataKey="label" tick={{ fontSize: 11, fill: "#1f2937" }} />
                    <PolarRadiusAxis
                      angle={90}
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: "#68707f" }}
                      tickCount={6}
                    />
                    <Tooltip content={(props) => <DimensionDensityTooltip {...props} />} />
                    <Radar
                      name="Density score"
                      dataKey="densityScore"
                      stroke="#2563eb"
                      fill="#2563eb"
                      fillOpacity={0.28}
                      isAnimationActive={false}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-desktop-border px-3 py-5 text-sm text-desktop-text-secondary">
                No dimension files found.
              </div>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
