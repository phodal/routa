"use client";

import { useMemo } from "react";
import type { PlanResponse, PlannedDimension } from "@/client/components/harness-execution-plan-flow";

type HarnessFitnessChartPanelProps = {
  loading: boolean;
  error: string | null;
  plan: PlanResponse | null;
  unsupportedMessage?: string | null;
};

// ─── Colour palette (matches desktop theme tokens as close as possible) ──────
const CHART_COLORS = [
  "#6366f1", // indigo
  "#22d3ee", // cyan
  "#f59e0b", // amber
  "#10b981", // emerald
  "#f43f5e", // rose
  "#8b5cf6", // violet
  "#14b8a6", // teal
  "#fb923c", // orange
];

const RUNNER_COLORS: Record<string, string> = {
  shell: "#6366f1",
  graph: "#10b981",
  sarif: "#f59e0b",
};

// ─── Weight Bar Chart (vertical) ─────────────────────────────────────────────

function DimensionWeightBarChart({ dimensions }: { dimensions: PlannedDimension[] }) {
  const visibleDims = dimensions.filter((d) => d.weight > 0);
  const maxWeight = Math.max(...visibleDims.map((d) => d.weight), 1);

  const barWidth = 28;
  const barGap = 14;
  const chartHeight = 120;
  const labelHeight = 36;
  const svgWidth = visibleDims.length * (barWidth + barGap) + barGap;
  const svgHeight = chartHeight + labelHeight;

  if (visibleDims.length === 0) {
    return (
      <div className="flex h-[156px] items-center justify-center text-[11px] text-desktop-text-secondary">
        No weighted dimensions
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      width="100%"
      className="overflow-visible"
      aria-label="Dimension weight bar chart"
    >
      {/* Horizontal reference lines */}
      {[0.25, 0.5, 0.75, 1].map((fraction) => {
        const y = chartHeight * (1 - fraction);
        return (
          <line
            key={fraction}
            x1={0}
            y1={y}
            x2={svgWidth}
            y2={y}
            stroke="currentColor"
            strokeOpacity={0.08}
            strokeWidth={1}
          />
        );
      })}

      {visibleDims.map((dim, index) => {
        const barH = Math.max(4, (dim.weight / maxWeight) * chartHeight);
        const x = barGap + index * (barWidth + barGap);
        const y = chartHeight - barH;
        const color = CHART_COLORS[index % CHART_COLORS.length] ?? "#6366f1";
        const shortName = dim.name.length > 9 ? `${dim.name.slice(0, 8)}…` : dim.name;

        return (
          <g key={dim.name}>
            {/* Bar */}
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barH}
              rx={4}
              fill={color}
              fillOpacity={0.85}
            />
            {/* Weight label on top */}
            <text
              x={x + barWidth / 2}
              y={y - 4}
              textAnchor="middle"
              fontSize={9}
              fill={color}
              fontWeight={600}
            >
              {dim.weight}
            </text>
            {/* Dimension name label */}
            <text
              x={x + barWidth / 2}
              y={chartHeight + 14}
              textAnchor="middle"
              fontSize={8.5}
              fill="currentColor"
              fillOpacity={0.55}
              transform={`rotate(-35, ${x + barWidth / 2}, ${chartHeight + 14})`}
            >
              {shortName}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Metrics per Dimension Horizontal Bar Chart ───────────────────────────────

function MetricsPerDimensionChart({ dimensions }: { dimensions: PlannedDimension[] }) {
  const sorted = [...dimensions].sort((a, b) => b.metrics.length - a.metrics.length);
  const maxMetrics = Math.max(...sorted.map((d) => d.metrics.length), 1);
  const rowHeight = 22;
  const labelWidth = 88;
  const barAreaWidth = 200;
  const svgHeight = sorted.length * rowHeight + 8;
  const svgWidth = labelWidth + barAreaWidth + 32;

  if (sorted.length === 0) {
    return (
      <div className="flex h-[160px] items-center justify-center text-[11px] text-desktop-text-secondary">
        No dimensions
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      width="100%"
      className="overflow-visible"
      aria-label="Metrics per dimension horizontal bar chart"
    >
      {sorted.map((dim, index) => {
        const barW = Math.max(4, (dim.metrics.length / maxMetrics) * barAreaWidth);
        const y = 4 + index * rowHeight;
        const color = CHART_COLORS[index % CHART_COLORS.length] ?? "#6366f1";
        const hardCount = dim.metrics.filter((m) => m.hardGate).length;
        const shortName = dim.name.length > 12 ? `${dim.name.slice(0, 11)}…` : dim.name;

        return (
          <g key={dim.name}>
            {/* Dimension label */}
            <text
              x={labelWidth - 4}
              y={y + rowHeight / 2 + 4}
              textAnchor="end"
              fontSize={9}
              fill="currentColor"
              fillOpacity={0.6}
            >
              {shortName}
            </text>
            {/* Background track */}
            <rect
              x={labelWidth}
              y={y + 4}
              width={barAreaWidth}
              height={rowHeight - 10}
              rx={3}
              fill="currentColor"
              fillOpacity={0.05}
            />
            {/* Metric count bar */}
            <rect
              x={labelWidth}
              y={y + 4}
              width={barW}
              height={rowHeight - 10}
              rx={3}
              fill={color}
              fillOpacity={0.75}
            />
            {/* Hard gate sub-bar */}
            {hardCount > 0 ? (
              <rect
                x={labelWidth}
                y={y + 4}
                width={Math.max(2, (hardCount / maxMetrics) * barAreaWidth)}
                height={rowHeight - 10}
                rx={3}
                fill={color}
                fillOpacity={1}
              />
            ) : null}
            {/* Count label */}
            <text
              x={labelWidth + barW + 4}
              y={y + rowHeight / 2 + 4}
              fontSize={9}
              fill={color}
              fontWeight={600}
            >
              {dim.metrics.length}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Runner Distribution Donut Chart ─────────────────────────────────────────

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const x1 = cx + r * Math.cos(toRad(startAngle));
  const y1 = cy + r * Math.sin(toRad(startAngle));
  const x2 = cx + r * Math.cos(toRad(endAngle));
  const y2 = cy + r * Math.sin(toRad(endAngle));
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

function RunnerDistributionDonut({ runnerCounts }: { runnerCounts: Record<string, number> }) {
  const cx = 72;
  const cy = 72;
  const outerR = 56;
  const innerR = 34;
  const total = Object.values(runnerCounts).reduce((sum, v) => sum + v, 0);

  const slices = useMemo(() => {
    if (total === 0) return [];
    let angle = -90;
    return Object.entries(runnerCounts)
      .filter(([, count]) => count > 0)
      .map(([runner, count]) => {
        const sweep = (count / total) * 360;
        const start = angle;
        angle += sweep;
        return { runner, count, start, sweep };
      });
  }, [runnerCounts, total]);

  if (total === 0) {
    return (
      <div className="flex h-[144px] items-center justify-center text-[11px] text-desktop-text-secondary">
        No runner data
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <svg
        viewBox="0 0 144 144"
        width={144}
        height={144}
        aria-label="Runner distribution donut chart"
        className="shrink-0"
      >
        {slices.map(({ runner, start, sweep }) => {
          const color = RUNNER_COLORS[runner] ?? "#94a3b8";
          if (sweep >= 360) {
            // full circle
            return (
              <circle
                key={runner}
                cx={cx}
                cy={cy}
                r={(outerR + innerR) / 2}
                fill="none"
                stroke={color}
                strokeWidth={outerR - innerR}
              />
            );
          }
          const endAngle = start + sweep;
          const outerPath = describeArc(cx, cy, outerR, start, endAngle);
          const innerPath = describeArc(cx, cy, innerR, endAngle, start);
          const toRad = (deg: number) => (deg * Math.PI) / 180;
          const x1 = cx + outerR * Math.cos(toRad(endAngle));
          const y1 = cy + outerR * Math.sin(toRad(endAngle));
          const x2 = cx + innerR * Math.cos(toRad(start));
          const y2 = cy + innerR * Math.sin(toRad(start));
          return (
            <path
              key={runner}
              d={`${outerPath} L ${x1} ${y1} ${innerPath} L ${x2} ${y2} Z`}
              fill={color}
              fillOpacity={0.85}
            />
          );
        })}
        {/* Center label */}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize={20} fontWeight={700} fill="currentColor" fillOpacity={0.8}>
          {total}
        </text>
        <text x={cx} y={cy + 13} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.45}>
          metrics
        </text>
      </svg>

      {/* Legend */}
      <div className="flex flex-col gap-2">
        {Object.entries(runnerCounts).map(([runner, count]) => {
          const color = RUNNER_COLORS[runner] ?? "#94a3b8";
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <div key={runner} className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: color }}
              />
              <span className="text-[11px] text-desktop-text-secondary">
                {runner}
                <span className="ml-1 font-semibold text-desktop-text-primary">{count}</span>
                <span className="ml-1 text-desktop-text-secondary/60">({pct}%)</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function HarnessFitnessChartPanel({
  loading,
  error,
  plan,
  unsupportedMessage,
}: HarnessFitnessChartPanelProps) {
  const hasData = !loading && !error && !unsupportedMessage && plan !== null;

  return (
    <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
            Analytics
          </div>
          <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">Fitness Function Charts</h3>
        </div>
        {hasData ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
              {plan.dimensionCount} dimensions
            </span>
            <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
              {plan.metricCount} metrics
            </span>
            <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] text-red-700">
              {plan.hardGateCount} hard gates
            </span>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-6 text-[11px] text-desktop-text-secondary">
          Loading fitness plan…
        </div>
      ) : unsupportedMessage ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-[11px] text-amber-800">
          {unsupportedMessage}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-[11px] text-red-700">
          {error}
        </div>
      ) : !plan ? (
        <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-6 text-[11px] text-desktop-text-secondary">
          Select a repository to view fitness charts.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Chart 1: Dimension weights */}
          <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
              Dimension Weights
            </div>
            <div className="text-[10px] text-desktop-text-secondary/70 mb-3">
              Relative importance of each dimension (%)
            </div>
            <DimensionWeightBarChart dimensions={plan.dimensions} />
          </div>

          {/* Chart 2: Metrics per dimension */}
          <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
              Metrics per Dimension
            </div>
            <div className="text-[10px] text-desktop-text-secondary/70 mb-3">
              Total (light) vs hard-gate (solid)
            </div>
            <MetricsPerDimensionChart dimensions={plan.dimensions} />
          </div>

          {/* Chart 3: Runner distribution */}
          <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
              Runner Distribution
            </div>
            <div className="text-[10px] text-desktop-text-secondary/70 mb-3">
              Breakdown by execution backend
            </div>
            <RunnerDistributionDonut runnerCounts={plan.runnerCounts} />
          </div>
        </div>
      )}
    </section>
  );
}
