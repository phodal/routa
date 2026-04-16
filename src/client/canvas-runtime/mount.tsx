"use client";

import React, { useLayoutEffect, type ReactNode, type JSX } from "react";

import { CanvasThemeProvider, useHostTheme } from "../canvas-sdk/theme-context";
import { darkTheme, type CanvasTheme } from "../canvas-sdk/tokens";
import { CanvasErrorBoundary } from "./error-boundary";

const FONT_FAMILY =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/**
 * Shell that applies theme-derived body styles when the canvas mounts.
 */
function CanvasShell({ children }: { children: ReactNode }): JSX.Element {
  const theme = useHostTheme();
  useLayoutEffect(() => {
    const s = document.body.style;
    s.background = theme.tokens.bg.editor;
    s.color = theme.tokens.text.primary;
    s.fontFamily = FONT_FAMILY;
    s.fontSize = "13px";
    s.lineHeight = "18px";
    s.padding = "24px 32px";
  }, [theme]);
  return <>{children}</>;
}

export type CanvasHostProps = {
  /** Canvas component to render. */
  children?: ReactNode;
  /** Theme override. Defaults to dark. */
  theme?: CanvasTheme;
  /** Error callback. */
  onError?: (message: string) => void;
};

/**
 * Canvas host — wraps a canvas component with theme provider, error boundary,
 * and body theme application. Use this as the top-level wrapper for rendering
 * any canvas artifact.
 */
export function CanvasHost({
  children,
  theme = darkTheme,
  onError,
}: CanvasHostProps): JSX.Element {
  return (
    <CanvasThemeProvider theme={theme}>
      <CanvasErrorBoundary onError={onError}>
        <CanvasShell>{children}</CanvasShell>
      </CanvasErrorBoundary>
    </CanvasThemeProvider>
  );
}

/**
 * Mount a canvas component into a DOM element. Used for standalone canvas
 * rendering (e.g., in an iframe or dedicated page).
 */
export async function mountCanvas(
  rootElement: HTMLElement,
  component: React.ComponentType,
  options?: { theme?: CanvasTheme; onError?: (msg: string) => void },
): Promise<void> {
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(rootElement);
  root.render(
    React.createElement(
      CanvasHost,
      { theme: options?.theme, onError: options?.onError },
      React.createElement(component),
    ),
  );
}
