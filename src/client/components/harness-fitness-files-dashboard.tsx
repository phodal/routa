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
import { HarnessSectionCard, HarnessSectionStateFrame } from "./harness-section-card";

type HarnessFitnessFilesDashboardProps = {
  specFiles: FitnessSpecSummary[];
  selectedSpec: FitnessSpecSummary | null;
  loading: boolean;
  error?: string | null;
  unsupportedMessage?: string | null;
  embedded?: boolean;
};

function DimensionDensityTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload?.length) {
    return null;
  }

  const datum = payload[0]?.payload as {
    label: string;
    fileName: string;
    score: number;
    metricCount: number;
    hardGateCount: number;
    weight: number;
    thresholdPass: number;
    thresholdWarn: number;
  };

  return (
    <div className="rounded-xl border border-desktop-border bg-white/95 px-3 py-2 text-[11px] shadow-lg dark:bg-slate-950/95">
      <div className="font-semibold text-desktop-text-primary">{datum.label}</div>
      <div className="mt-1 text-desktop-text-secondary">{datum.fileName}</div>
      <div className="mt-2 text-desktop-text-primary">score {datum.score}</div>
      <div className="text-desktop-text-secondary">{datum.metricCount} metrics</div>
      <div className="text-desktop-text-secondary">{datum.hardGateCount} hard gates</div>
      <div className="text-desktop-text-secondary">weight {datum.weight}</div>
      <div className="text-desktop-text-secondary">pass {datum.thresholdPass} · warn {datum.thresholdWarn}</div>
    </div>
  );
}

export function HarnessFitnessFilesDashboard({
  specFiles,
  selectedSpec,
  loading,
  error,
  unsupportedMessage,
  embedded = false,
}: HarnessFitnessFilesDashboardProps) {
  const model = useMemo(
    () => buildHarnessFitnessFilesDashboardModel(specFiles, selectedSpec),
    [selectedSpec, specFiles],
  );

  const content = (
    <>
      {unsupportedMessage ? (
        <HarnessUnsupportedState className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-[11px] text-amber-800" />
      ) : null}

      {loading ? (
        <HarnessSectionStateFrame>Loading fitness files...</HarnessSectionStateFrame>
      ) : null}

      {error ? <HarnessSectionStateFrame tone="error">{error}</HarnessSectionStateFrame> : null}

      {!unsupportedMessage && !loading && !error ? (
        <div className="mt-3" data-testid="harness-fitness-files-dashboard">
          <section className="rounded-2xl border border-desktop-border bg-white/80 p-4 shadow-sm dark:bg-white/6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Dimension radar</div>
                <p className="mt-1 text-[12px] leading-5 text-desktop-text-secondary">
                  Score blends `weight`, hard-gate coverage, and threshold strictness across manifest-linked dimension specs.
                </p>
              </div>
              {model.selectedDimension ? (
                <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
                  {model.selectedDimension.label} · score {model.selectedDimension.score}
                </div>
              ) : null}
            </div>

            {model.dimensions.length > 0 ? (
              <div className="mt-4 h-[360px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
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
                      name="Spec score"
                      dataKey="score"
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
    </>
  );

  if (embedded) {
    return <div className="space-y-3">{content}</div>;
  }

  return (
    <HarnessSectionCard
      title="Entrix Fitness"
      description="Entrix fitness manifest and dimension scoring surfaces."
      variant="full"
      actions={
        loading ? <span className="text-[10px] text-desktop-text-secondary">Loading...</span> : null
      }
    >
      {content}
    </HarnessSectionCard>
  );
}
