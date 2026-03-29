"use client";

import { Fragment, useMemo, type ReactNode } from "react";

import { useTranslation } from "@/i18n";

import {
  buildFitnessDashboardModel,
  toDashboardGateState,
  type DashboardGateState,
} from "./fitness-analysis-dashboard-model";
import {
  formatTime,
  humanizeToken,
  type FitnessReport,
} from "./fitness-analysis-types";

type FitnessAnalysisDashboardProps = {
  report?: FitnessReport;
};

function statusTone(status: DashboardGateState) {
  if (status === "pass") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (status === "warn") return "border-amber-300 bg-amber-50 text-amber-700";
  return "border-rose-300 bg-rose-50 text-rose-700";
}

function gridTone(score: number) {
  if (score >= 90) return "rgba(16, 185, 129, 0.22)";
  if (score >= 75) return "rgba(59, 130, 246, 0.18)";
  if (score >= 60) return "rgba(245, 158, 11, 0.18)";
  return "rgba(244, 63, 94, 0.18)";
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const angle = (angleDeg - 90) * (Math.PI / 180);
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

function MetricCard({
  label,
  value,
  hint,
  status,
}: {
  label: string;
  value: string;
  hint: string;
  status: DashboardGateState;
}) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${statusTone(status)}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em]">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-[11px] leading-5 opacity-80">{hint}</div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-desktop-border bg-white/80 p-4 shadow-sm dark:bg-white/6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">{title}</div>
          <p className="mt-1 text-[12px] leading-5 text-desktop-text-secondary">{subtitle}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function TargetRadar({
  data,
  currentLabel,
  targetLabel,
  emptyText,
}: {
  data: Array<{ key: string; label: string; current: number; target: number }>;
  currentLabel: string;
  targetLabel: string;
  emptyText: string;
}) {
  if (data.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-desktop-border px-4 py-8 text-sm text-desktop-text-secondary">
        {emptyText}
      </div>
    );
  }

  const size = 320;
  const center = size / 2;
  const radius = 102;
  const currentPoints = data.map((item, index) => {
    const angle = (360 / data.length) * index;
    const point = polarToCartesian(center, center, (radius * item.current) / 100, angle);
    const targetPoint = polarToCartesian(center, center, (radius * item.target) / 100, angle);
    const labelPoint = polarToCartesian(center, center, radius + 24, angle);
    return {
      ...item,
      angle,
      point,
      targetPoint,
      labelPoint,
    };
  });
  const currentPolygon = currentPoints.map(({ point }) => `${point.x},${point.y}`).join(" ");
  const targetPolygon = currentPoints.map(({ targetPoint }) => `${targetPoint.x},${targetPoint.y}`).join(" ");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-desktop-text-secondary">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
          {currentLabel}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full border border-slate-400 bg-slate-200" />
          {targetLabel}
        </span>
      </div>
      <div className="flex justify-center">
        <svg viewBox={`0 0 ${size} ${size}`} className="h-[320px] w-full max-w-[320px] overflow-visible">
          {[25, 50, 75, 100].map((ring) => (
            <polygon
              key={ring}
              points={currentPoints.map((_, index) => {
                const ringPoint = polarToCartesian(center, center, (radius * ring) / 100, (360 / data.length) * index);
                return `${ringPoint.x},${ringPoint.y}`;
              }).join(" ")}
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.14"
              strokeWidth="1"
            />
          ))}

          {currentPoints.map(({ angle, labelPoint, label, key }) => {
            const axisEnd = polarToCartesian(center, center, radius, angle);
            return (
              <g key={key}>
                <line x1={center} y1={center} x2={axisEnd.x} y2={axisEnd.y} stroke="currentColor" strokeOpacity="0.16" strokeWidth="1" />
                <text
                  x={labelPoint.x}
                  y={labelPoint.y}
                  textAnchor={labelPoint.x < center - 8 ? "end" : labelPoint.x > center + 8 ? "start" : "middle"}
                  className="fill-current text-[11px] text-desktop-text-secondary"
                >
                  {label}
                </text>
              </g>
            );
          })}

          <polygon
            points={targetPolygon}
            fill="rgba(148, 163, 184, 0.08)"
            stroke="rgba(148, 163, 184, 0.92)"
            strokeDasharray="5 6"
            strokeWidth="2"
          />
          <polygon
            points={currentPolygon}
            fill="rgba(14, 165, 233, 0.18)"
            stroke="rgba(14, 165, 233, 0.92)"
            strokeWidth="2.5"
          />

          {currentPoints.map(({ point, current, key }) => (
            <g key={`${key}-current`}>
              <circle cx={point.x} cy={point.y} r="4.5" fill="rgba(14, 165, 233, 1)" />
              <title>{`${current}%`}</title>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

function UnlockRunway({
  currentLabel,
  nextLabel,
  currentValue,
  nextValue,
  noNextLevel,
}: {
  currentLabel: string;
  nextLabel: string;
  currentValue: number;
  nextValue: number | null;
  noNextLevel: string;
}) {
  const rows = [
    { label: currentLabel, value: currentValue, accent: "bg-sky-500" },
    { label: nextLabel, value: nextValue, accent: "bg-violet-500" },
  ];

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className="font-medium text-desktop-text-primary">{row.label}</span>
            <span className="text-desktop-text-secondary">
              {row.value == null ? noNextLevel : `${row.value}%`}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-desktop-bg-primary">
            <div
              className={`h-full rounded-full ${row.accent}`}
              style={{ width: `${row.value ?? 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function GateSummaryBars({
  pass,
  warn,
  fail,
  passLabel,
  warnLabel,
  failLabel,
}: {
  pass: number;
  warn: number;
  fail: number;
  passLabel: string;
  warnLabel: string;
  failLabel: string;
}) {
  const items = [
    { label: passLabel, count: pass, accent: "bg-emerald-500" },
    { label: warnLabel, count: warn, accent: "bg-amber-500" },
    { label: failLabel, count: fail, accent: "bg-rose-500" },
  ];
  const max = Math.max(...items.map((item) => item.count), 1);

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className="font-medium text-desktop-text-primary">{item.label}</span>
            <span className="text-desktop-text-secondary">{item.count}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-desktop-bg-primary">
            <div
              className={`h-full rounded-full ${item.accent}`}
              style={{ width: `${(item.count / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function BlockerHotspots({
  items,
  emptyText,
}: {
  items: Array<{ dimension: string; label: string; count: number; leadingCriterion: string }>;
  emptyText: string;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-desktop-border px-4 py-6 text-sm text-desktop-text-secondary">
        {emptyText}
      </div>
    );
  }

  const max = Math.max(...items.map((item) => item.count), 1);

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.dimension} className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/70 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-desktop-text-primary">{item.label}</div>
              <div className="text-[11px] text-desktop-text-secondary">{item.leadingCriterion}</div>
            </div>
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              {item.count}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-desktop-bg-primary">
            <div className="h-full rounded-full bg-amber-400" style={{ width: `${(item.count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Heatmap({
  levels,
  dimensions,
  cells,
  emptyText,
}: {
  levels: string[];
  dimensions: string[];
  cells: Array<{
    id: string;
    dimension: string;
    dimensionLabel: string;
    level: string;
    levelLabel: string;
    score: number;
    passedWeight: number;
    applicableWeight: number;
  }>;
  emptyText: string;
}) {
  if (levels.length === 0 || dimensions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-desktop-border px-4 py-8 text-sm text-desktop-text-secondary">
        {emptyText}
      </div>
    );
  }

  const cellMap = new Map(cells.map((cell) => [`${cell.dimension}:${cell.level}`, cell]));

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `minmax(180px, 1.3fr) repeat(${levels.length}, minmax(96px, 1fr))` }}
        >
          <div />
          {levels.map((level) => (
            <div key={level} className="px-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">
              {humanizeToken(level)}
            </div>
          ))}

          {dimensions.map((dimension) => {
            const rowLabel = cells.find((cell) => cell.dimension === dimension)?.dimensionLabel ?? humanizeToken(dimension);
            return (
              <Fragment key={dimension}>
                <div key={`${dimension}-label`} className="flex items-center px-2 text-sm font-semibold text-desktop-text-primary">
                  {rowLabel}
                </div>
                {levels.map((level) => {
                  const cell = cellMap.get(`${dimension}:${level}`);
                  return (
                    <div
                      key={`${dimension}:${level}`}
                      className="rounded-2xl border border-desktop-border px-3 py-3 text-center"
                      style={{ backgroundColor: gridTone(cell?.score ?? 0) }}
                    >
                      <div className="text-lg font-semibold text-desktop-text-primary">{cell ? `${cell.score}%` : "0%"}</div>
                      <div className="mt-1 text-[11px] text-desktop-text-secondary">
                        {cell ? `${cell.passedWeight}/${cell.applicableWeight}` : "0/0"}
                      </div>
                    </div>
                  );
                })}
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function FitnessAnalysisDashboard({ report }: FitnessAnalysisDashboardProps) {
  const { t } = useTranslation();
  const dashboard = t.fitness.dashboard;
  const model = useMemo(() => (report ? buildFitnessDashboardModel(report) : null), [report]);

  if (!report || !model) {
    return (
      <section
        data-testid="fitness-dashboard-empty"
        className="rounded-[28px] border border-dashed border-desktop-border px-4 py-8 text-sm text-desktop-text-secondary"
      >
        {dashboard.noReport}
      </section>
    );
  }

  const overallStatus = toDashboardGateState(model.metrics.overallReadiness);
  const nextStatus = toDashboardGateState(model.metrics.nextUnlockReadiness ?? 0);
  const blockerStatus: DashboardGateState = model.metrics.blockerCount === 0 ? "pass" : model.metrics.blockerCount <= 2 ? "warn" : "fail";
  const passRateStatus = toDashboardGateState(model.metrics.passRate);

  return (
    <section data-testid="fitness-dashboard" className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={dashboard.overallReadiness}
          value={`${model.metrics.overallReadiness}%`}
          hint={`${dashboard.currentLevelHint} ${model.metrics.currentLevelName}`}
          status={overallStatus}
        />
        <MetricCard
          label={dashboard.nextUnlock}
          value={model.metrics.nextUnlockReadiness == null ? dashboard.notAvailable : `${model.metrics.nextUnlockReadiness}%`}
          hint={model.metrics.nextLevelName ? `${dashboard.targetLevelHint} ${model.metrics.nextLevelName}` : dashboard.noNextLevel}
          status={model.metrics.nextUnlockReadiness == null ? overallStatus : nextStatus}
        />
        <MetricCard
          label={dashboard.hardBlockers}
          value={`${model.metrics.blockerCount}`}
          hint={dashboard.hardBlockersHint}
          status={blockerStatus}
        />
        <MetricCard
          label={dashboard.passRate}
          value={`${model.metrics.passRate}%`}
          hint={dashboard.passRateHint}
          status={passRateStatus}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <Section title={dashboard.targetVsCurrent} subtitle={dashboard.targetVsCurrentHint}>
          <TargetRadar
            data={model.radar}
            currentLabel={dashboard.currentLegend}
            targetLabel={dashboard.targetLegend}
            emptyText={dashboard.noReport}
          />
        </Section>

        <div className="grid gap-4">
          <Section title={dashboard.unlockRunway} subtitle={dashboard.unlockRunwayHint}>
            <div className="space-y-4">
              <UnlockRunway
                currentLabel={dashboard.currentLevelBar}
                nextLabel={dashboard.nextLevelBar}
                currentValue={model.metrics.overallReadiness}
                nextValue={model.metrics.nextUnlockReadiness}
                noNextLevel={dashboard.noNextLevel}
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/70 px-3 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">
                    {dashboard.fromLastRun}
                  </div>
                  <div className="mt-2 text-sm font-semibold text-desktop-text-primary">
                    {model.metrics.previousGeneratedAt ? formatTime(model.metrics.previousGeneratedAt) : dashboard.noHistory}
                  </div>
                </div>
                <div className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/70 px-3 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">
                    {dashboard.changedDimensions}
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-desktop-text-primary">{model.metrics.changedDimensions}</div>
                </div>
                <div className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/70 px-3 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">
                    {dashboard.changedCriteria}
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-desktop-text-primary">{model.metrics.changedCriteria}</div>
                </div>
              </div>
            </div>
          </Section>

          <Section title={dashboard.gateStatus} subtitle={dashboard.gateStatusHint}>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <GateSummaryBars
                pass={model.gateSummary.pass}
                warn={model.gateSummary.warn}
                fail={model.gateSummary.fail}
                passLabel={dashboard.gatePass}
                warnLabel={dashboard.gateWarn}
                failLabel={dashboard.gateFail}
              />
              <BlockerHotspots items={model.blockerHotspots.slice(0, 4)} emptyText={dashboard.noBlockers} />
            </div>
          </Section>
        </div>
      </div>

      <Section title={dashboard.heatmap} subtitle={dashboard.heatmapHint}>
        <Heatmap
          levels={model.heatmapLevels}
          dimensions={model.heatmapDimensions}
          cells={model.heatmapCells}
          emptyText={dashboard.noReport}
        />
      </Section>
    </section>
  );
}
