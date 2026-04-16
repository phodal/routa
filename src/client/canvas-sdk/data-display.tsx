"use client";

import type { CSSProperties, ReactNode, JSX } from "react";

import { useHostTheme } from "./theme-context";
import { canvasTypography } from "./tokens";
import { mergeStyle } from "./primitives";

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export type TableColumnAlign = "left" | "center" | "right";
export type TableRowTone =
  | "success"
  | "danger"
  | "warning"
  | "info"
  | "neutral";

export type TableProps = {
  headers: ReactNode[];
  rows: ReactNode[][];
  columnAlign?: Array<TableColumnAlign | undefined>;
  rowTone?: Array<TableRowTone | undefined>;
  framed?: boolean;
  striped?: boolean;
  style?: CSSProperties;
  emptyMessage?: ReactNode;
};

const ROW_TONE_BG: Record<TableRowTone, string> = {
  success: "rgba(63, 162, 102, 0.10)",
  danger: "rgba(252, 107, 131, 0.10)",
  warning: "rgba(240, 160, 64, 0.10)",
  info: "rgba(112, 176, 216, 0.10)",
  neutral: "transparent",
};

export function Table({
  headers,
  rows,
  columnAlign,
  rowTone,
  framed = true,
  striped,
  style,
  emptyMessage,
}: TableProps): JSX.Element {
  const { tokens } = useHostTheme();

  const wrapperStyle: CSSProperties = framed
    ? {
        width: "100%",
        minWidth: 0,
        border: `1px solid ${tokens.stroke.tertiary}`,
        borderRadius: 8,
        background: tokens.bg.editor,
        overflow: "auto clip",
      }
    : { width: "100%" };

  const tableStyle: CSSProperties = {
    minWidth: "100%",
    borderCollapse: "collapse",
    tableLayout: "auto",
    fontSize: "14px",
    lineHeight: "20px",
    color: tokens.text.primary,
  };

  const thStyle = (i: number): CSSProperties => ({
    padding: "8px 12px",
    textAlign: columnAlign?.[i] ?? "left",
    fontWeight: 600,
    color: tokens.text.primary,
    borderBottom: `1px solid ${tokens.stroke.secondary}`,
  });

  const tdStyle = (colIdx: number): CSSProperties => ({
    padding: "8px 12px",
    textAlign: columnAlign?.[colIdx] ?? "left",
    verticalAlign: "top",
  });

  return (
    <div style={mergeStyle(wrapperStyle, style)}>
      <table style={tableStyle}>
        <thead style={{ background: tokens.fill.tertiary }}>
          <tr>
            {headers.map((h, i) => (
              <th key={i} scope="col" style={thStyle(i)}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && emptyMessage ? (
            <tr>
              <td
                colSpan={headers.length}
                style={{
                  padding: "16px 12px",
                  textAlign: "center",
                  color: tokens.text.tertiary,
                }}
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, ri) => {
              const tone = rowTone?.[ri];
              const bg = tone
                ? ROW_TONE_BG[tone]
                : striped && ri % 2 === 0
                  ? tokens.fill.quaternary
                  : undefined;
              return (
                <tr
                  key={ri}
                  style={{
                    borderBottom:
                      ri < rows.length - 1
                        ? `1px solid ${tokens.stroke.tertiary}`
                        : undefined,
                    background: bg,
                  }}
                >
                  {headers.map((_, ci) => (
                    <td key={ci} style={tdStyle(ci)}>
                      {row[ci] ?? ""}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat
// ---------------------------------------------------------------------------

export type StatTone = "success" | "danger" | "warning" | "info";

const STAT_TONE_COLOR: Record<string, string> = {
  success: "rgba(82, 184, 150, 0.88)",
  danger: "rgba(252, 107, 131, 0.88)",
  warning: "rgba(240, 160, 64, 0.88)",
  info: "rgba(112, 176, 216, 0.88)",
};

export type StatProps = {
  value: ReactNode;
  label: string;
  tone?: StatTone;
  style?: CSSProperties;
};

export function Stat({ value, label, tone, style }: StatProps): JSX.Element {
  const { tokens } = useHostTheme();
  const base: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "2px",
    padding: "12px 8px",
  };
  const valueColor = tone ? STAT_TONE_COLOR[tone] : tokens.text.primary;
  return (
    <div style={mergeStyle(base, style)}>
      <div
        style={{
          ...canvasTypography.stat,
          fontVariantNumeric: "tabular-nums",
          color: valueColor,
        }}
      >
        {value}
      </div>
      <div style={{ ...canvasTypography.small, color: tokens.text.secondary }}>
        {label}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pill
// ---------------------------------------------------------------------------

export type PillTone =
  | "neutral"
  | "added"
  | "deleted"
  | "renamed"
  | "success"
  | "warning"
  | "info";

export type PillProps = {
  children?: ReactNode;
  active?: boolean;
  tone?: PillTone;
  style?: CSSProperties;
  onClick?: () => void;
};

const PILL_TONE_COLOR: Record<PillTone, string> = {
  neutral: "inherit",
  added: "rgba(63, 162, 102, 0.88)",
  deleted: "rgba(252, 107, 131, 0.88)",
  renamed: "rgba(112, 176, 216, 0.88)",
  success: "rgba(82, 184, 150, 0.88)",
  warning: "rgba(240, 160, 64, 0.88)",
  info: "rgba(112, 176, 216, 0.88)",
};

export function Pill({
  children,
  active,
  tone = "neutral",
  style,
  onClick,
}: PillProps): JSX.Element {
  const { tokens } = useHostTheme();
  const color =
    tone === "neutral" ? tokens.text.secondary : PILL_TONE_COLOR[tone];
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    borderRadius: 9999,
    whiteSpace: "nowrap",
    userSelect: "none",
    fontFamily: "inherit",
    fontWeight: 400,
    fontSize: "12px",
    lineHeight: "14px",
    background: active ? `${color}22` : "transparent",
    color,
    border: `1px solid ${color}`,
    padding: "6px 10px",
    gap: "6px",
    cursor: onClick ? "pointer" : "default",
    opacity: 1,
  };
  return (
    <span style={mergeStyle(base, style)} onClick={onClick}>
      <span style={{ flexShrink: 0, color: "inherit" }}>{children}</span>
    </span>
  );
}
