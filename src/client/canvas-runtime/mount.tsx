"use client";

import React, { useLayoutEffect, type ReactNode, type JSX } from "react";

import { CanvasThemeProvider, useHostTheme } from "../canvas-sdk/theme-context";
import { darkTheme, type CanvasTheme } from "../canvas-sdk/tokens";
import {
  installCanvasHostBridge,
  reportCanvasError,
  syncCanvasHostState,
  type CanvasAction,
} from "../canvas-sdk/host-bridge";
import { CanvasErrorBoundary } from "./error-boundary";

const FONT_FAMILY =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/**
 * Shell that applies theme-derived body styles when the canvas mounts.
 */
function CanvasShell({
  children,
  applyBodyTheme,
}: {
  children: ReactNode;
  applyBodyTheme: boolean;
}): JSX.Element {
  const theme = useHostTheme();
  useLayoutEffect(() => {
    if (!applyBodyTheme) return;

    const s = document.body.style;
    const previous = {
      background: s.background,
      color: s.color,
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      margin: s.margin,
      padding: s.padding,
    };
    s.background = theme.tokens.bg.editor;
    s.color = theme.tokens.text.primary;
    s.fontFamily = FONT_FAMILY;
    s.fontSize = "14px";
    s.lineHeight = "20px";
    s.margin = "0";
    s.padding = "24px 32px";

    return () => {
      s.background = previous.background;
      s.color = previous.color;
      s.fontFamily = previous.fontFamily;
      s.fontSize = previous.fontSize;
      s.lineHeight = previous.lineHeight;
      s.margin = previous.margin;
      s.padding = previous.padding;
    };
  }, [applyBodyTheme, theme]);
  return <>{children}</>;
}

function buildHostState(
  theme: CanvasTheme,
  hostState?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    theme: { kind: theme.kind },
    ...hostState,
  };
}

function CanvasHostBridge({
  canvasId,
  theme,
  hostState,
  initialData,
  onAction,
  onError,
  children,
}: {
  canvasId?: string;
  theme: CanvasTheme;
  hostState?: Record<string, unknown>;
  initialData?: Record<string, unknown>;
  onAction?: (action: CanvasAction) => void;
  onError?: (message: string) => void;
  children: ReactNode;
}): JSX.Element {
  const resolvedHostState = buildHostState(theme, hostState);

  installCanvasHostBridge({
    canvasId,
    hostState: resolvedHostState,
    initialData,
    onAction,
    onError,
  });

  useLayoutEffect(() => {
    syncCanvasHostState(resolvedHostState);
  }, [resolvedHostState]);

  return <>{children}</>;
}

export type CanvasHostProps = {
  /** Canvas component to render. */
  children?: ReactNode;
  /** Theme override. Defaults to dark. */
  theme?: CanvasTheme;
  /** Host-scoped canvas id used by state/action bridges. */
  canvasId?: string;
  /** Extra host state channels exposed to canvas hooks. */
  hostState?: Record<string, unknown>;
  /** Initial persistent author state values. */
  initialData?: Record<string, unknown>;
  /** Host action callback for useCanvasAction. */
  onAction?: (action: CanvasAction) => void;
  /** Error callback. */
  onError?: (message: string) => void;
  /** Apply Cursor-style body background/font/padding. Defaults to true. */
  applyBodyTheme?: boolean;
};

/**
 * Canvas host — wraps a canvas component with theme provider, error boundary,
 * and body theme application. Use this as the top-level wrapper for rendering
 * any canvas artifact.
 */
export function CanvasHost({
  children,
  theme = darkTheme,
  canvasId,
  hostState,
  initialData,
  onAction,
  onError,
  applyBodyTheme = true,
}: CanvasHostProps): JSX.Element {
  return (
    <CanvasThemeProvider theme={theme}>
      <CanvasHostBridge
        canvasId={canvasId}
        theme={theme}
        hostState={hostState}
        initialData={initialData}
        onAction={onAction}
        onError={onError}
      >
        <CanvasErrorBoundary onError={reportCanvasError}>
          <CanvasShell applyBodyTheme={applyBodyTheme}>{children}</CanvasShell>
        </CanvasErrorBoundary>
      </CanvasHostBridge>
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
  options?: {
    theme?: CanvasTheme;
    canvasId?: string;
    onError?: (msg: string) => void;
  },
): Promise<void> {
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(rootElement);
  root.render(
    React.createElement(
      CanvasHost,
      {
        theme: options?.theme,
        canvasId: options?.canvasId,
        onError: options?.onError,
      },
      React.createElement(component),
    ),
  );
}
