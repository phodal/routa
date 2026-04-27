"use client";

import type { CSSProperties, ReactNode, JSX } from "react";

import { useHostTheme } from "./theme-context";
import { canvasRadius, canvasTypography } from "./tokens";
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
  stickyHeader?: boolean;
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
  stickyHeader,
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
        overflowX: "auto",
        overflowY: stickyHeader ? "auto" : "clip",
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

  if (headers.length === 0) {
    return (
      <div
        style={mergeStyle(
          {
            color: tokens.text.secondary,
            fontSize: "14px",
            lineHeight: "20px",
          },
          style,
        )}
      >
        Add at least one header.
      </div>
    );
  }

  const table = (
    <table style={mergeStyle(tableStyle, framed ? undefined : style)}>
      <thead
        style={{
          background: tokens.fill.tertiary,
          position: stickyHeader ? "sticky" : undefined,
          top: stickyHeader ? 0 : undefined,
          zIndex: stickyHeader ? 2 : undefined,
        }}
      >
        <tr>
          {headers.map((h, i) => (
            <th key={i} scope="col" style={thStyle(i)}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td
              colSpan={headers.length}
              style={{
                padding: "16px 12px",
                textAlign: "center",
                color: tokens.text.tertiary,
              }}
            >
              {emptyMessage ?? "No rows."}
            </td>
          </tr>
        ) : (
          rows.map((row, ri) => {
            const tone = rowTone?.[ri];
            const bg = tone
              ? ROW_TONE_BG[tone]
              : striped && ri % 2 === 1
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
                    {row[ci] ?? null}
                  </td>
                ))}
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );

  if (!framed) {
    return table;
  }

  return (
    <div style={mergeStyle(wrapperStyle, style)}>
      {table}
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

export type PillSize = "sm" | "md";

export type PillProps = {
  children?: ReactNode;
  active?: boolean;
  tone?: PillTone;
  size?: PillSize;
  leadingContent?: ReactNode;
  keyboardHint?: string;
  disabled?: boolean;
  title?: string;
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
  size = "md",
  leadingContent,
  keyboardHint,
  disabled,
  title,
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
    borderRadius: canvasRadius.full,
    whiteSpace: "nowrap",
    userSelect: "none",
    fontFamily: "inherit",
    fontWeight: 400,
    fontSize: size === "sm" ? "11px" : "12px",
    lineHeight: size === "sm" ? "13px" : "14px",
    background: active ? `${color}22` : "transparent",
    color,
    border: size === "sm" ? "none" : `1px solid ${color}`,
    padding: size === "sm" ? "2px 6px" : "6px 10px",
    gap: size === "sm" ? "4px" : "6px",
    cursor: disabled ? "not-allowed" : onClick ? "pointer" : "default",
    opacity: disabled ? 0.5 : 1,
  };
  return (
    <span
      style={mergeStyle(base, style)}
      title={title}
      onClick={disabled ? undefined : onClick}
    >
      {leadingContent ? (
        <span style={{ flexShrink: 0, color: "inherit" }}>
          {leadingContent}
        </span>
      ) : null}
      <span style={{ flexShrink: 0, color: "inherit" }}>{children}</span>
      {keyboardHint ? (
        <span style={{ color: tokens.text.tertiary }}>{keyboardHint}</span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Callout
// ---------------------------------------------------------------------------

export type CalloutTone = "info" | "success" | "warning" | "danger" | "neutral";

export type CalloutProps = {
  children?: ReactNode;
  tone?: CalloutTone;
  title?: ReactNode;
  icon?: ReactNode;
  style?: CSSProperties;
};

const CALLOUT_TONE_COLOR: Record<CalloutTone, string> = {
  info: "rgba(112, 176, 216, 0.88)",
  success: "rgba(82, 184, 150, 0.88)",
  warning: "rgba(240, 160, 64, 0.88)",
  danger: "rgba(252, 107, 131, 0.88)",
  neutral: "currentColor",
};

const CALLOUT_TONE_BG: Record<CalloutTone, string> = {
  info: "rgba(112, 176, 216, 0.10)",
  success: "rgba(82, 184, 150, 0.10)",
  warning: "rgba(240, 160, 64, 0.10)",
  danger: "rgba(252, 107, 131, 0.10)",
  neutral: "transparent",
};

export function Callout({
  children,
  tone = "info",
  title,
  icon,
  style,
}: CalloutProps): JSX.Element {
  const { tokens } = useHostTheme();
  const toneColor =
    tone === "neutral" ? tokens.text.secondary : CALLOUT_TONE_COLOR[tone];
  const base: CSSProperties = {
    display: "flex",
    gap: 10,
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    borderRadius: canvasRadius.lg,
    border: `1px solid ${
      tone === "neutral" ? tokens.stroke.tertiary : `${toneColor}55`
    }`,
    background: tone === "neutral" ? tokens.fill.quaternary : CALLOUT_TONE_BG[tone],
    color: tokens.text.secondary,
  };

  return (
    <div style={mergeStyle(base, style)}>
      {icon ? (
        <div style={{ flexShrink: 0, color: toneColor, lineHeight: "20px" }}>
          {icon}
        </div>
      ) : null}
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {title ? (
          <div
            style={{
              ...canvasTypography.small,
              color: toneColor,
              fontWeight: 600,
            }}
          >
            {title}
          </div>
        ) : null}
        <div style={{ ...canvasTypography.body, color: tokens.text.secondary }}>
          {children}
        </div>
      </div>
    </div>
  );
}
