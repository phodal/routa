"use client";

import type { CSSProperties, JSX } from "react";

import { useHostTheme } from "./theme-context";
import { mergeStyle } from "./primitives";

export type ChartTone = "success" | "danger" | "warning" | "info" | "neutral";

export type ChartDataPoint = {
  label: string;
  value: number;
};

export type ChartSeries = {
  name: string;
  data: number[];
  tone?: ChartTone;
};

const CHART_COLORS = [
  "rgba(31, 138, 101, 0.91)",
  "rgba(112, 176, 216, 0.88)",
  "rgba(90, 108, 192, 0.94)",
  "rgba(240, 160, 64, 0.88)",
  "rgba(192, 96, 40, 0.88)",
  "rgba(232, 192, 48, 0.88)",
  "rgba(200, 88, 152, 0.88)",
  "rgba(240, 160, 136, 0.88)",
  "rgba(123, 100, 184, 0.94)",
  "rgba(125, 202, 176, 0.88)",
];

const TONE_COLORS: Record<ChartTone, string> = {
  success: "rgba(31, 138, 101, 0.91)",
  danger: "rgba(252, 107, 131, 0.88)",
  warning: "rgba(240, 160, 64, 0.88)",
  info: "rgba(112, 176, 216, 0.88)",
  neutral: "rgba(136, 136, 153, 0.82)",
};

function seriesColor(series: ChartSeries, index: number): string {
  return series.tone ? TONE_COLORS[series.tone] : CHART_COLORS[index % CHART_COLORS.length];
}

function formatTickValue(v: number, suffix = ""): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k${suffix}`;
  if (Number.isInteger(v)) return `${v}${suffix}`;
  return `${v.toFixed(1)}${suffix}`;
}

function clampValue(value: number): number {
  return Number.isFinite(value) ? Math.max(value, 0) : 0;
}

export type BarChartEntry = {
  label: string;
  value: number;
  color?: string;
};

export type BarChartProps = {
  categories?: string[];
  series?: ChartSeries[];
  data?: BarChartEntry[];
  height?: number;
  stacked?: boolean;
  horizontal?: boolean;
  normalized?: boolean;
  valueSuffix?: string;
  style?: CSSProperties;
};

function normalizeBarProps({
  categories,
  series,
  data,
}: BarChartProps): { categories: string[]; series: ChartSeries[]; legacyColors: Array<string | undefined> } {
  if (data) {
    return {
      categories: data.map((entry) => entry.label),
      series: [{ name: "Value", data: data.map((entry) => entry.value) }],
      legacyColors: data.map((entry) => entry.color),
    };
  }

  return {
    categories: categories ?? [],
    series: series ?? [],
    legacyColors: [],
  };
}

export function BarChart(props: BarChartProps): JSX.Element {
  const { tokens } = useHostTheme();
  const {
    height = 360,
    stacked,
    horizontal,
    normalized,
    valueSuffix,
    style,
  } = props;
  const normalizedProps = normalizeBarProps(props);
  const categories = normalizedProps.categories;
  const series = normalizedProps.series;

  if (categories.length === 0 || series.length === 0) {
    return <div style={{ color: tokens.text.tertiary }}>No data</div>;
  }

  if (horizontal) {
    return (
      <HorizontalBarChart
        categories={categories}
        series={series}
        legacyColors={normalizedProps.legacyColors}
        height={height}
        valueSuffix={valueSuffix}
        style={style}
      />
    );
  }

  const svgWidth = 856;
  const left = 44;
  const right = 16;
  const top = 16;
  const bottom = 42;
  const plotWidth = svgWidth - left - right;
  const plotHeight = Math.max(height - top - bottom, 80);
  const useStack = Boolean(stacked || normalized);
  const categoryTotals = categories.map((_, categoryIndex) =>
    series.reduce((sum, item) => sum + clampValue(item.data[categoryIndex] ?? 0), 0),
  );
  const maxValue = Math.max(
    1,
    normalized
      ? 100
      : useStack
        ? Math.max(...categoryTotals)
        : Math.max(...series.flatMap((item) => item.data.map(clampValue))),
  );
  const tickCount = 4;
  const categoryWidth = plotWidth / categories.length;
  const groupPadding = Math.min(18, categoryWidth * 0.2);
  const barWidth = useStack
    ? Math.max(categoryWidth - groupPadding, 4)
    : Math.max((categoryWidth - groupPadding) / series.length, 3);

  return (
    <div style={mergeStyle({ width: "100%", minWidth: 0 }, style)}>
      <svg
        width={svgWidth}
        height={height}
        viewBox={`0 0 ${svgWidth} ${height}`}
        role="img"
        aria-label="Bar chart"
        style={{ display: "block", width: "100%", height }}
      >
        {Array.from({ length: tickCount + 1 }, (_, index) => {
          const barTickValue = (maxValue / tickCount) * index;
          const y = top + plotHeight - (barTickValue / maxValue) * plotHeight;
          return (
            <g key={index}>
              <line
                x1={left}
                x2={svgWidth - right}
                y1={y}
                y2={y}
                stroke={tokens.stroke.tertiary}
              />
              <text
                x={left - 8}
                y={y + 4}
                textAnchor="end"
                fill={tokens.text.tertiary}
                fontFamily="inherit"
                fontSize="12px"
              >
                {formatTickValue(barTickValue, normalized ? "%" : valueSuffix)}
              </text>
            </g>
          );
        })}

        {categories.map((category, categoryIndex) => {
          const x0 = left + categoryIndex * categoryWidth + groupPadding / 2;
          let stackedOffset = 0;
          return (
            <g key={category}>
              {series.map((item, seriesIndex) => {
                const rawValue = clampValue(item.data[categoryIndex] ?? 0);
                const barValue = normalized
                  ? categoryTotals[categoryIndex] > 0
                    ? (rawValue / categoryTotals[categoryIndex]) * 100
                    : 0
                  : rawValue;
                const barHeight = (barValue / maxValue) * plotHeight;
                const x = useStack ? x0 : x0 + seriesIndex * barWidth;
                const y = top + plotHeight - barHeight - stackedOffset;
                if (useStack) stackedOffset += barHeight;
                return (
                  <rect
                    key={item.name}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={Math.max(barHeight, 0)}
                    fill={
                      normalizedProps.legacyColors[categoryIndex] ??
                      seriesColor(item, seriesIndex)
                    }
                  />
                );
              })}
              <text
                x={left + categoryIndex * categoryWidth + categoryWidth / 2}
                y={height - 16}
                textAnchor="middle"
                fill={tokens.text.tertiary}
                fontFamily="inherit"
                fontSize="12px"
              >
                {category.length > 12 ? `${category.slice(0, 10)}...` : category}
              </text>
            </g>
          );
        })}
      </svg>
      {series.length > 1 ? <ChartLegend series={series} /> : null}
    </div>
  );
}

function HorizontalBarChart({
  categories,
  series,
  legacyColors,
  height,
  valueSuffix,
  style,
}: {
  categories: string[];
  series: ChartSeries[];
  legacyColors: Array<string | undefined>;
  height: number;
  valueSuffix?: string;
  style?: CSSProperties;
}): JSX.Element {
  const { tokens } = useHostTheme();
  const svgWidth = 856;
  const labelWidth = 104;
  const rightPad = 32;
  const plotWidth = svgWidth - labelWidth - rightPad;
  const firstSeries = series[0];
  const values = categories.map((_, index) => clampValue(firstSeries.data[index] ?? 0));
  const maxValue = Math.max(...values, 1);
  const barHeight = Math.min((height - 36) / categories.length - 10, 24);
  const barGap = (height - 36 - categories.length * barHeight) / (categories.length + 1);
  const tickCount = 4;

  return (
    <div style={mergeStyle({ width: "100%", minWidth: 0 }, style)}>
      <svg
        width={svgWidth}
        height={height}
        viewBox={`0 0 ${svgWidth} ${height}`}
        role="img"
        aria-label="Bar chart"
        style={{ display: "block", width: "100%", height }}
      >
        {Array.from({ length: tickCount + 1 }, (_, index) => {
          const horizontalTickValue = (maxValue / tickCount) * index;
          const x = labelWidth + (horizontalTickValue / maxValue) * plotWidth;
          return (
            <g key={index}>
              {index > 0 ? (
                <line
                  x1={x}
                  x2={x}
                  y1={12}
                  y2={height - 24}
                  stroke={tokens.stroke.tertiary}
                />
              ) : null}
              <text
                x={x}
                y={height - 4}
                textAnchor="middle"
                fill={tokens.text.tertiary}
                fontFamily="inherit"
                fontSize="12px"
              >
                {formatTickValue(horizontalTickValue, valueSuffix)}
              </text>
            </g>
          );
        })}
        {categories.map((category, index) => {
          const y = barGap + index * (barHeight + barGap);
          const width = (values[index] / maxValue) * plotWidth;
          return (
            <g key={category}>
              <text
                x={labelWidth - 8}
                y={y + barHeight / 2}
                textAnchor="end"
                dominantBaseline="middle"
                fill={tokens.text.tertiary}
                fontFamily="inherit"
                fontSize="12px"
              >
                {category.length > 14 ? `${category.slice(0, 12)}...` : category}
              </text>
              <rect
                x={labelWidth}
                y={y}
                width={Math.max(width, 0)}
                height={barHeight}
                fill={legacyColors[index] ?? seriesColor(firstSeries, index)}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export type LineChartProps = {
  categories: string[];
  series: ChartSeries[];
  height?: number;
  fill?: boolean;
  valueSuffix?: string;
  style?: CSSProperties;
};

export function LineChart({
  categories,
  series,
  height = 300,
  fill,
  valueSuffix,
  style,
}: LineChartProps): JSX.Element {
  const { tokens } = useHostTheme();

  if (categories.length === 0 || series.length === 0) {
    return <div style={{ color: tokens.text.tertiary }}>No data</div>;
  }

  const svgWidth = 856;
  const left = 44;
  const right = 16;
  const top = 16;
  const bottom = 42;
  const plotWidth = svgWidth - left - right;
  const plotHeight = Math.max(height - top - bottom, 80);
  const maxValue = Math.max(1, ...series.flatMap((item) => item.data.map(clampValue)));
  const tickCount = 4;
  const xFor = (index: number) =>
    left + (categories.length === 1 ? plotWidth / 2 : (index / (categories.length - 1)) * plotWidth);
  const yFor = (pointValue: number) =>
    top + plotHeight - (clampValue(pointValue) / maxValue) * plotHeight;

  return (
    <div style={mergeStyle({ width: "100%", minWidth: 0 }, style)}>
      <svg
        width={svgWidth}
        height={height}
        viewBox={`0 0 ${svgWidth} ${height}`}
        role="img"
        aria-label="Line chart"
        style={{ display: "block", width: "100%", height }}
      >
        {Array.from({ length: tickCount + 1 }, (_, index) => {
          const lineTickValue = (maxValue / tickCount) * index;
          const y = yFor(lineTickValue);
          return (
            <g key={index}>
              <line
                x1={left}
                x2={svgWidth - right}
                y1={y}
                y2={y}
                stroke={tokens.stroke.tertiary}
              />
              <text
                x={left - 8}
                y={y + 4}
                textAnchor="end"
                fill={tokens.text.tertiary}
                fontFamily="inherit"
                fontSize="12px"
              >
                {formatTickValue(lineTickValue, valueSuffix)}
              </text>
            </g>
          );
        })}
        {series.map((item, seriesIndex) => {
          const color = seriesColor(item, seriesIndex);
          const points = categories
            .map((_, index) => `${xFor(index)},${yFor(item.data[index] ?? 0)}`)
            .join(" ");
          const fillPath = [
            `M ${xFor(0)} ${top + plotHeight}`,
            `L ${points.replaceAll(" ", " L ")}`,
            `L ${xFor(categories.length - 1)} ${top + plotHeight}`,
            "Z",
          ].join(" ");
          return (
            <g key={item.name}>
              {fill ? <path d={fillPath} fill={color} opacity={0.14} /> : null}
              <polyline
                points={points}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {categories.map((_, index) => (
                <circle
                  key={index}
                  cx={xFor(index)}
                  cy={yFor(item.data[index] ?? 0)}
                  r={3}
                  fill={color}
                />
              ))}
            </g>
          );
        })}
        {categories.map((category, index) => (
          <text
            key={category}
            x={xFor(index)}
            y={height - 16}
            textAnchor="middle"
            fill={tokens.text.tertiary}
            fontFamily="inherit"
            fontSize="12px"
          >
            {category.length > 12 ? `${category.slice(0, 10)}...` : category}
          </text>
        ))}
      </svg>
      {series.length > 1 ? <ChartLegend series={series} /> : null}
    </div>
  );
}

function ChartLegend({ series }: { series: ChartSeries[] }): JSX.Element {
  const { tokens } = useHostTheme();
  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: "8px 12px",
      }}
    >
      {series.map((item, index) => (
        <div
          key={item.name}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: tokens.text.secondary,
            fontSize: "12px",
            lineHeight: "16px",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 9999,
              background: seriesColor(item, index),
            }}
          />
          <span>{item.name}</span>
        </div>
      ))}
    </div>
  );
}

export type PieChartEntry = ChartDataPoint & {
  color?: string;
  tone?: ChartTone;
};

export type PieChartProps = {
  data: PieChartEntry[];
  size?: number;
  donut?: boolean;
  style?: CSSProperties;
};

export function PieChart({
  data,
  size = 260,
  donut = true,
  style,
}: PieChartProps): JSX.Element {
  const { tokens } = useHostTheme();

  const total = data.reduce((sum, entry) => sum + clampValue(entry.value), 0);
  if (total === 0) {
    return <div style={{ color: tokens.text.tertiary }}>No data</div>;
  }

  const outerR = size / 2 - 8;
  const innerR = donut ? outerR * 0.45 : 0;
  const cx = size / 2;
  const cy = size / 2;
  const angles = data.reduce<number[]>(
    (acc, entry) => {
      const sweep = (clampValue(entry.value) / total) * 2 * Math.PI;
      acc.push(acc[acc.length - 1] + sweep);
      return acc;
    },
    [-Math.PI / 2],
  );

  return (
    <div
      style={mergeStyle(
        {
          width: "100%",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
        },
        style,
      )}
    >
      <svg
        width={size}
        height={size}
        viewBox={`-4 -4 ${size} ${size}`}
        role="img"
        aria-label="Pie chart"
        style={{ display: "block" }}
      >
        {data.map((entry, index) => (
          <path
            key={entry.label}
            d={describeArc(cx, cy, outerR, innerR, angles[index], angles[index + 1])}
            fill={
              entry.color ??
              (entry.tone ? TONE_COLORS[entry.tone] : CHART_COLORS[index % CHART_COLORS.length])
            }
          />
        ))}
      </svg>
      <div
        style={{
          width: "100%",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "8px 12px",
        }}
      >
        {data.map((entry, index) => {
          const color =
            entry.color ??
            (entry.tone ? TONE_COLORS[entry.tone] : CHART_COLORS[index % CHART_COLORS.length]);
          const pct = Math.round((clampValue(entry.value) / total) * 100);
          return (
            <div
              key={entry.label}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: tokens.text.secondary,
                fontSize: "12px",
                lineHeight: "16px",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 9999,
                  background: color,
                }}
              />
              <span>{entry.label.length > 16 ? `${entry.label.slice(0, 14)}...` : entry.label}</span>
              <span style={{ color: tokens.text.quaternary }}>{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function describeArc(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number,
): string {
  const x1 = cx + outerR * Math.cos(startAngle);
  const y1 = cy + outerR * Math.sin(startAngle);
  const x2 = cx + outerR * Math.cos(endAngle);
  const y2 = cy + outerR * Math.sin(endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

  if (innerR === 0) {
    return [
      `M ${cx} ${cy}`,
      `L ${x1} ${y1}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
      "Z",
    ].join(" ");
  }

  const x3 = cx + innerR * Math.cos(endAngle);
  const y3 = cy + innerR * Math.sin(endAngle);
  const x4 = cx + innerR * Math.cos(startAngle);
  const y4 = cy + innerR * Math.sin(startAngle);

  return [
    `M ${x1} ${y1}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}
