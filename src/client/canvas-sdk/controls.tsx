"use client";

import type { CSSProperties, ReactNode, JSX } from "react";

import { useHostTheme } from "./theme-context";
import { canvasRadius } from "./tokens";
import { mergeStyle } from "./primitives";

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "ghost";

export type ButtonProps = {
  children?: ReactNode;
  variant?: ButtonVariant;
  disabled?: boolean;
  style?: CSSProperties;
  onClick?: () => void;
};

export function Button({
  children,
  variant = "secondary",
  disabled,
  style,
  onClick,
}: ButtonProps): JSX.Element {
  const { tokens } = useHostTheme();

  const variantStyles: Record<ButtonVariant, CSSProperties> = {
    primary: {
      background: tokens.accent.control,
      color: tokens.text.onAccent,
      border: "none",
    },
    secondary: {
      background: "transparent",
      color: tokens.text.secondary,
      border: `1px solid ${tokens.stroke.secondary}`,
    },
    ghost: {
      background: "transparent",
      color: tokens.text.secondary,
      border: "none",
    },
  };

  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: "24px",
    padding: "0 8px",
    borderRadius: `${canvasRadius.sm}px`,
    fontSize: "12px",
    lineHeight: "16px",
    fontWeight: 500,
    fontFamily: "inherit",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    whiteSpace: "nowrap",
    gap: 4,
    ...variantStyles[variant],
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      style={mergeStyle(base, style)}
    >
      {children}
    </button>
  );
}
