"use client";

import type { CSSProperties, JSX } from "react";

import { useHostTheme } from "./theme-context";
import { mergeStyle } from "./primitives";

// ---------------------------------------------------------------------------
// Color palette for chart series
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// BarChart
// ---------------------------------------------------------------------------

export type BarChartEntry = {
  label: string;
  value: number;
  color?: string;
};

export type BarChartProps = {
  data: BarChartEntry[];
  /** Chart height in px. Default 360. */
  height?: number;
  style?: CSSProperties;
};

export function BarChart({
  data,
  height = 360,
  style,
}: BarChartProps): JSX.Element {
  const { tokens } = useHostTheme();

  if (data.length === 0) {
    return <div style={{ color: tokens.text.tertiary }}>No data</div>;
  }

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const labelWidth = 96;
  const rightPad = 28;

  // SVG dimensions
  const svgWidth = 856;
  const barAreaWidth = svgWidth - labelWidth - rightPad;
  const barHeight = Math.min(
    (height - 36) / data.length - 10,
    24,
  );
  const barGap = (height - 36 - data.length * barHeight) / (data.length + 1);

  // Grid ticks
  const tickCount = Math.min(5, Math.ceil(maxValue));
  const tickStep = maxValue / tickCount;

  return (
    <div style={mergeStyle({ width: "100%", minWidth: 0, position: "relative" }, style)}>
      <svg
        width={svgWidth}
        height={height}
        viewBox={`0 0 ${svgWidth} ${height}`}
        role="img"
        aria-label="Bar chart"
        style={{ display: "block", width: "100%", height: `${height}px` }}
      >
        {/* Grid lines and tick labels */}
        {Array.from({ length: tickCount + 1 }, (_, i) => {
          const val = i * tickStep;
          const x = labelWidth + (val / maxValue) * barAreaWidth;
          return (
            <g key={`tick-${i}`}>
              {i > 0 && (
                <line
                  x1={x}
                  x2={x}
                  y1={12}
                  y2={height - 24}
                  stroke={tokens.stroke.tertiary}
                  strokeWidth={1}
                />
              )}
              <text
                x={x}
                y={height - 4}
                textAnchor="middle"
                fill={tokens.text.tertiary}
                fontFamily="inherit"
                fontSize="12px"
              >
                {formatTickValue(val)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {data.map((entry, i) => {
          const y = barGap + i * (barHeight + barGap);
          const barW = (entry.value / maxValue) * barAreaWidth;
          const color = entry.color ?? CHART_COLORS[i % CHART_COLORS.length];
          const displayLabel =
            entry.label.length > 14
              ? entry.label.slice(0, 12) + "…"
              : entry.label;

          return (
            <g key={entry.label}>
              <text
                x={labelWidth - 8}
                y={y + barHeight / 2}
                textAnchor="end"
                dominantBaseline="middle"
                fill={tokens.text.tertiary}
                fontFamily="inherit"
                fontSize="12px"
              >
                {displayLabel}
              </text>
              <rect
                x={labelWidth}
                y={y}
                width={Math.max(barW, 0)}
                height={barHeight}
                fill={color}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function formatTickValue(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(1);
}

// ---------------------------------------------------------------------------
// PieChart
// ---------------------------------------------------------------------------

export type PieChartEntry = {
  label: string;
  value: number;
  color?: string;
};

export type PieChartProps = {
  data: PieChartEntry[];
  /** Diameter in px. Default 260. */
  size?: number;
  style?: CSSProperties;
};

export function PieChart({
  data,
  size = 260,
  style,
}: PieChartProps): JSX.Element {
  const { tokens } = useHostTheme();

  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return <div style={{ color: tokens.text.tertiary }}>No data</div>;
  }

  const outerR = size / 2 - 8;
  const innerR = outerR * 0.45;
  const cx = size / 2;
  const cy = size / 2;

  // Pre-compute cumulative angles so we avoid mutating during render.
  const angles = data.reduce<number[]>(
    (acc, entry) => {
      const sweep = (entry.value / total) * 2 * Math.PI;
      acc.push(acc[acc.length - 1] + sweep);
      return acc;
    },
    [-Math.PI / 2],
  );

  const paths = data.map((entry, i) => {
    const color = entry.color ?? CHART_COLORS[i % CHART_COLORS.length];
    const path = describeArc(cx, cy, outerR, innerR, angles[i], angles[i + 1]);
    return <path key={entry.label} d={path} fill={color} fillOpacity={1} />;
  });

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
          position: "relative",
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
        {paths}
      </svg>

      {/* Legend */}
      <div
        style={{
          width: "100%",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "8px 12px",
        }}
      >
        {data.map((entry, i) => {
          const color = entry.color ?? CHART_COLORS[i % CHART_COLORS.length];
          const pct = Math.round((entry.value / total) * 100);
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
              <span>
                {entry.label.length > 16
                  ? entry.label.slice(0, 14) + "…"
                  : entry.label}
              </span>
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
  const x3 = cx + innerR * Math.cos(endAngle);
  const y3 = cy + innerR * Math.sin(endAngle);
  const x4 = cx + innerR * Math.cos(startAngle);
  const y4 = cy + innerR * Math.sin(startAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

  return [
    `M ${x1} ${y1}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}
