"use client";

import {
  createContext,
  useContext,
  useState,
  type CSSProperties,
  type ReactNode,
  type JSX,
} from "react";

import { useHostTheme } from "./theme-context";
import { canvasRadius } from "./tokens";
import { mergeStyle } from "./primitives";

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export type CardSize = "base" | "lg";
export type CardVariant = "default" | "borderless";

export type CardProps = {
  children?: ReactNode;
  variant?: CardVariant;
  size?: CardSize;
  stickyHeader?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  style?: CSSProperties;
};

type CardContextValue = {
  collapsible: boolean;
  open: boolean;
  size: CardSize;
  stickyHeader: boolean;
  toggleOpen: () => void;
};

const CardContext = createContext<CardContextValue | null>(null);

export function Card({
  children,
  variant = "default",
  size = "base",
  stickyHeader,
  collapsible,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  style,
}: CardProps): JSX.Element {
  const { tokens } = useHostTheme();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const toggleOpen = () => {
    const next = !open;
    if (controlledOpen === undefined) {
      setUncontrolledOpen(next);
    }
    onOpenChange?.(next);
  };

  const base: CSSProperties = {
    border:
      variant === "borderless"
        ? "none"
        : `1px solid ${tokens.stroke.tertiary}`,
    borderRadius:
      variant === "borderless" ? canvasRadius.none : `${canvasRadius.lg}px`,
    background: tokens.bg.editor,
    overflow: "hidden",
    width: "100%",
  };

  return (
    <div style={mergeStyle(base, style)} data-canvas-card data-open={open}>
      <CardContext.Provider
        value={{
          collapsible: Boolean(collapsible),
          open,
          size,
          stickyHeader: Boolean(stickyHeader),
          toggleOpen,
        }}
      >
        {children}
      </CardContext.Provider>
    </div>
  );
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
  const context = useContext(CardContext);
  const isLarge = context?.size === "lg";
  const base: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    position: context?.stickyHeader ? "sticky" : undefined,
    top: context?.stickyHeader ? 0 : undefined,
    zIndex: context?.stickyHeader ? 1 : undefined,
    padding: isLarge ? "10px 14px" : "8px 12px",
    fontSize: "12px",
    lineHeight: "16px",
    fontWeight: 600,
    color: tokens.text.secondary,
    borderBottom: `1px solid ${tokens.stroke.tertiary}`,
    background: tokens.fill.quaternary,
    gap: 8,
    overflow: "hidden",
    cursor: context?.collapsible ? "pointer" : undefined,
  };
  return (
    <div
      style={mergeStyle(base, style)}
      onClick={context?.collapsible ? context.toggleOpen : undefined}
    >
      {context?.collapsible ? <ChevronIcon expanded={context.open} /> : null}
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
        {children}
      </span>
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

export function CardBody({ children, style }: CardBodyProps): JSX.Element | null {
  const context = useContext(CardContext);
  if (context?.collapsible && !context.open) {
    return null;
  }

  const base: CSSProperties = {
    padding: "12px",
  };
  return <div style={mergeStyle(base, style)}>{children}</div>;
}
