"use client";

import { createContext, useContext } from "react";
import type { CSSProperties, ReactNode, JSX } from "react";

import { useHostTheme } from "./theme-context";
import { canvasTypography } from "./tokens";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function mergeStyle(
  base: CSSProperties,
  override?: CSSProperties,
): CSSProperties {
  return override ? { ...base, ...override } : base;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export type StackProps = {
  children?: ReactNode;
  gap?: number;
  style?: CSSProperties;
};

export function Stack({ children, gap = 12, style }: StackProps): JSX.Element {
  const base: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: `${gap}px`,
    width: "100%",
  };
  return <div style={mergeStyle(base, style)}>{children}</div>;
}

export type RowProps = {
  children?: ReactNode;
  gap?: number;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "space-between";
  wrap?: boolean;
  style?: CSSProperties;
};

export function Row({
  children,
  gap = 8,
  align = "center",
  justify,
  wrap,
  style,
}: RowProps): JSX.Element {
  const base: CSSProperties = {
    display: "flex",
    flexDirection: "row",
    gap: `${gap}px`,
    alignItems: align,
    justifyContent: justify,
    flexWrap: wrap ? "wrap" : undefined,
    width: "100%",
  };
  return <div style={mergeStyle(base, style)}>{children}</div>;
}

export type GridProps = {
  children?: ReactNode;
  columns: number | string;
  gap?: number;
  align?: "start" | "center" | "end" | "stretch";
  style?: CSSProperties;
};

export function Grid({
  children,
  columns,
  gap = 12,
  align = "stretch",
  style,
}: GridProps): JSX.Element {
  const base: CSSProperties = {
    display: "grid",
    gridTemplateColumns:
      typeof columns === "number"
        ? `repeat(${columns}, minmax(0, 1fr))`
        : columns,
    gap: `${gap}px`,
    alignItems: align,
    width: "100%",
  };
  return <div style={mergeStyle(base, style)}>{children}</div>;
}

export type DividerProps = { style?: CSSProperties };

export function Divider({ style }: DividerProps): JSX.Element {
  const { tokens } = useHostTheme();
  const base: CSSProperties = {
    width: "100%",
    borderTop: `1px solid ${tokens.stroke.tertiary}`,
    borderRight: "none",
    borderBottom: "none",
    borderLeft: "none",
    margin: 0,
  };
  return <hr style={mergeStyle(base, style)} />;
}

export function Spacer(): JSX.Element {
  return <div style={{ flex: 1 }} />;
}

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export type TextWeight = "normal" | "medium" | "semibold" | "bold";

const fontWeightMap: Record<TextWeight, number> = {
  normal: 400,
  medium: 500,
  semibold: 590,
  bold: 650,
};

const TypographyInlineContext = createContext(false);

export type TextProps = {
  children?: ReactNode;
  tone?: "primary" | "secondary" | "tertiary" | "quaternary";
  size?: "body" | "small";
  as?: "p" | "span";
  weight?: TextWeight;
  italic?: boolean;
  truncate?: boolean | "start" | "end";
  style?: CSSProperties;
};

export function Text({
  children,
  tone = "primary",
  size = "body",
  as,
  weight = "normal",
  italic,
  truncate,
  style,
}: TextProps): JSX.Element {
  const { tokens } = useHostTheme();
  const isInline = useContext(TypographyInlineContext);
  const Tag = as ?? (isInline ? "span" : "p");
  const typo = size === "small" ? canvasTypography.small : canvasTypography.body;
  const truncateMode = truncate === true ? "end" : truncate;
  const base: CSSProperties = {
    margin: 0,
    color: tokens.text[tone],
    fontSize: typo.fontSize,
    lineHeight: typo.lineHeight,
    fontWeight: fontWeightMap[weight],
    fontStyle: italic ? "italic" : undefined,
    overflow: truncateMode ? "hidden" : undefined,
    textOverflow: truncateMode ? "ellipsis" : undefined,
    whiteSpace: truncateMode ? "nowrap" : undefined,
    direction: truncateMode === "start" ? "rtl" : undefined,
    textAlign: truncateMode === "start" ? "left" : undefined,
  };
  return (
    <Tag style={mergeStyle(base, style)}>
      <TypographyInlineContext.Provider value={true}>
        {truncateMode === "start" ? <bdi>{children}</bdi> : children}
      </TypographyInlineContext.Provider>
    </Tag>
  );
}

export type H1Props = { children?: ReactNode; style?: CSSProperties };

export function H1({ children, style }: H1Props): JSX.Element {
  const { tokens } = useHostTheme();
  const base: CSSProperties = {
    margin: 0,
    color: tokens.text.primary,
    ...canvasTypography.h1,
  };
  return (
    <h1 style={mergeStyle(base, style)}>
      <TypographyInlineContext.Provider value={true}>
        {children}
      </TypographyInlineContext.Provider>
    </h1>
  );
}

export type H2Props = { children?: ReactNode; style?: CSSProperties };

export function H2({ children, style }: H2Props): JSX.Element {
  const { tokens } = useHostTheme();
  const base: CSSProperties = {
    margin: 0,
    color: tokens.text.primary,
    ...canvasTypography.h2,
  };
  return (
    <h2 style={mergeStyle(base, style)}>
      <TypographyInlineContext.Provider value={true}>
        {children}
      </TypographyInlineContext.Provider>
    </h2>
  );
}

export type H3Props = { children?: ReactNode; style?: CSSProperties };

export function H3({ children, style }: H3Props): JSX.Element {
  const { tokens } = useHostTheme();
  const base: CSSProperties = {
    margin: 0,
    color: tokens.text.primary,
    ...canvasTypography.h3,
  };
  return (
    <h3 style={mergeStyle(base, style)}>
      <TypographyInlineContext.Provider value={true}>
        {children}
      </TypographyInlineContext.Provider>
    </h3>
  );
}

export type CodeProps = { children?: ReactNode; style?: CSSProperties };

export function Code({ children, style }: CodeProps): JSX.Element {
  const { tokens } = useHostTheme();
  const base: CSSProperties = {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace',
    fontSize: "0.92em",
    background: tokens.fill.quaternary,
    color: tokens.text.primary,
    padding: "2px 5px",
    borderRadius: 4,
  };
  return <code style={mergeStyle(base, style)}>{children}</code>;
}

export type LinkProps = {
  children?: ReactNode;
  href: string;
  style?: CSSProperties;
};

export function Link({ children, href, style }: LinkProps): JSX.Element {
  const { tokens } = useHostTheme();
  const base: CSSProperties = {
    color: tokens.text.link,
    textDecoration: "none",
  };
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={mergeStyle(base, style)}
    >
      {children}
    </a>
  );
}
