"use client";

import { use, useMemo, useState, type JSX } from "react";

import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { resolveApiPath } from "@/client/config/backend";
import { CanvasHost, compileCanvasTsx } from "@/client/canvas-runtime";
import { darkTheme, lightTheme } from "@/client/canvas-sdk/tokens";
import {
  FitnessOverviewCanvas,
  type FitnessOverviewData,
} from "@/client/canvas-sdk/prebuilt/fitness-overview";
import type { CanvasType, CanvasRenderMode } from "@/core/models/canvas-artifact";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CanvasArtifactResponse {
  id: string;
  renderMode: CanvasRenderMode;
  canvasType?: CanvasType;
  title: string;
  schemaVersion: number;
  generatedAt: string;
  source?: string;
  data?: unknown;
  workspaceId: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Data fetcher — cached promise per canvasId
// ---------------------------------------------------------------------------

const fetchCache = new Map<string, Promise<CanvasArtifactResponse>>();

function fetchCanvasArtifact(canvasId: string): Promise<CanvasArtifactResponse> {
  const existing = fetchCache.get(canvasId);
  if (existing) return existing;

  const promise = (async () => {
    const url = resolveApiPath(`/api/canvas/${canvasId}`);
    const res = await desktopAwareFetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as CanvasArtifactResponse;
  })();

  fetchCache.set(canvasId, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Canvas Viewer
// ---------------------------------------------------------------------------

export type CanvasViewerProps = {
  canvasId: string;
};

export function CanvasViewer({ canvasId }: CanvasViewerProps): JSX.Element {
  const [themeName, setThemeName] = useState<"dark" | "light">("dark");
  const theme = themeName === "dark" ? darkTheme : lightTheme;

  const artifact = use(fetchCanvasArtifact(canvasId));

  return (
    <div style={{ minHeight: "100vh" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 24px",
          borderBottom: `1px solid ${theme.tokens.stroke.tertiary}`,
          background: theme.tokens.bg.chrome,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: theme.tokens.text.primary,
            }}
          >
            {artifact.title}
          </span>
          <span
            style={{
              fontSize: 11,
              padding: "2px 6px",
              borderRadius: 3,
              background: theme.tokens.fill.quaternary,
              color: theme.tokens.text.tertiary,
            }}
          >
            {artifact.renderMode}
          </span>
          <span
            style={{
              fontSize: 12,
              color: theme.tokens.text.tertiary,
            }}
          >
            {artifact.generatedAt}
          </span>
        </div>
        <button
          type="button"
          onClick={() =>
            setThemeName((t) => (t === "dark" ? "light" : "dark"))
          }
          style={{
            padding: "4px 8px",
            fontSize: 12,
            background: "transparent",
            color: theme.tokens.text.secondary,
            border: `1px solid ${theme.tokens.stroke.secondary}`,
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          {themeName === "dark" ? "☀" : "☾"}
        </button>
      </div>

      {/* Canvas content */}
      <CanvasHost theme={theme}>
        <CanvasContent
          renderMode={artifact.renderMode}
          canvasType={artifact.canvasType}
          source={artifact.source}
          data={artifact.data}
        />
      </CanvasHost>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dispatch to the correct rendering path
// ---------------------------------------------------------------------------

function CanvasContent({
  renderMode,
  canvasType,
  source,
  data,
}: {
  renderMode: CanvasRenderMode;
  canvasType?: CanvasType;
  source?: string;
  data?: unknown;
}): JSX.Element {
  if (renderMode === "dynamic" && source) {
    return <DynamicCanvas source={source} />;
  }

  // Prebuilt fallback
  if (canvasType) {
    switch (canvasType) {
      case "fitness_overview":
        return <FitnessOverviewCanvas data={data as FitnessOverviewData} />;
    }
  }

  return (
    <div style={{ padding: 32, color: "#fc6b83" }}>
      Cannot render canvas: missing source (dynamic) or canvasType (prebuilt).
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dynamic canvas — compile TSX source on the client
// ---------------------------------------------------------------------------

function DynamicCanvas({ source }: { source: string }): JSX.Element {
  const result = useMemo(() => compileCanvasTsx(source), [source]);

  if (!result.ok) {
    return (
      <div style={{ padding: 24 }}>
        <div
          style={{
            padding: "12px 16px",
            background: "rgba(252, 107, 131, 0.1)",
            border: "1px solid rgba(252, 107, 131, 0.3)",
            borderRadius: 6,
            color: "#fc6b83",
            fontFamily: "monospace",
            fontSize: 13,
            whiteSpace: "pre-wrap",
          }}
        >
          Canvas compilation error:{"\n"}
          {result.error}
        </div>
      </div>
    );
  }

  const Component = result.Component;
  return <Component />;
}
