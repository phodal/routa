"use client";

import { useState, type CSSProperties, type ReactNode, type JSX } from "react";

import { useHostTheme } from "./theme-context";
import { canvasRadius } from "./tokens";
import { mergeStyle } from "./primitives";

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export type CardProps = {
  children?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  style?: CSSProperties;
};

export function Card({
  children,
  collapsible,
  defaultOpen = true,
  style,
}: CardProps): JSX.Element {
  const { tokens } = useHostTheme();
  const [open, setOpen] = useState(defaultOpen);

  const base: CSSProperties = {
    border: `1px solid ${tokens.stroke.tertiary}`,
    borderRadius: `${canvasRadius.lg}px`,
    background: tokens.bg.editor,
    overflow: "hidden",
    width: "100%",
  };

  return (
    <div style={mergeStyle(base, style)} data-canvas-card data-open={open}>
      {collapsible
        ? applyCollapsible(children, open, setOpen)
        : children}
    </div>
  );
}

function applyCollapsible(
  children: ReactNode,
  open: boolean,
  setOpen: (v: boolean) => void,
): ReactNode {
  const arr = Array.isArray(children) ? children : [children];
  return arr.map((child, i) => {
    if (i === 0 && child && typeof child === "object" && "type" in child) {
      // First child is header — make it clickable
      const headerChild = child as React.ReactElement<{ onClick?: () => void }>;
      return (
        <div
          key={i}
          onClick={() => setOpen(!open)}
          style={{ cursor: "pointer" }}
        >
          <ChevronIcon expanded={open} />
          {headerChild}
        </div>
      );
    }
    // Body children — hide when collapsed
    if (i > 0 && !open) return null;
    return <div key={i}>{child}</div>;
  });
}

function ChevronIcon({ expanded }: { expanded: boolean }): JSX.Element {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 10 10"
      fill="none"
      style={{
        display: "inline-block",
        marginRight: 4,
        transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 120ms",
      }}
    >
      <path
        d="M3 1.5 7 5 3 8.5"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// CardHeader
// ---------------------------------------------------------------------------

export type CardHeaderProps = {
  children?: ReactNode;
  trailing?: ReactNode;
  style?: CSSProperties;
};

export function CardHeader({
  children,
  trailing,
  style,
}: CardHeaderProps): JSX.Element {
  const { tokens } = useHostTheme();
  const base: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
    fontSize: "12px",
    lineHeight: "16px",
    fontWeight: 600,
    color: tokens.text.secondary,
    borderBottom: `1px solid ${tokens.stroke.tertiary}`,
    background: tokens.fill.quaternary,
    gap: 8,
    overflow: "hidden",
  };
  return (
    <div style={mergeStyle(base, style)}>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      {trailing && <span style={{ flexShrink: 0 }}>{trailing}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CardBody
// ---------------------------------------------------------------------------

export type CardBodyProps = {
  children?: ReactNode;
  style?: CSSProperties;
};

export function CardBody({ children, style }: CardBodyProps): JSX.Element {
  const base: CSSProperties = {
    padding: "12px",
  };
  return <div style={mergeStyle(base, style)}>{children}</div>;
}
