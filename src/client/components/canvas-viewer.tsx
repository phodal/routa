"use client";

import { use, useMemo, useState, type JSX } from "react";
import { Moon, Sun } from "lucide-react";

import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { resolveApiPath } from "@/client/config/backend";
import { CanvasHost, compileCanvasTsx } from "@/client/canvas-runtime";
import { useHostTheme } from "@/client/canvas-sdk/theme-context";
import { darkTheme, lightTheme } from "@/client/canvas-sdk/tokens";
import {
  FitnessOverviewCanvas,
  type FitnessOverviewData,
} from "@/client/canvas-sdk/prebuilt/fitness-overview";
import { useTranslation } from "@/i18n/use-translation";
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
  const { locale, t } = useTranslation();
  const [themeName, setThemeName] = useState<"dark" | "light">("dark");
  const theme = themeName === "dark" ? darkTheme : lightTheme;

  const artifact = use(fetchCanvasArtifact(canvasId));
  const generatedAtLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(artifact.generatedAt)),
    [artifact.generatedAt, locale],
  );
  const renderModeLabel =
    artifact.renderMode === "dynamic"
      ? t.canvas.renderModeDynamic
      : t.canvas.renderModePrebuilt;
  const hostState = useMemo(
    () => ({
      artifact: {
        id: artifact.id,
        title: artifact.title,
        renderMode: artifact.renderMode,
        generatedAt: artifact.generatedAt,
        workspaceId: artifact.workspaceId,
      },
    }),
    [artifact],
  );
  const toggleThemeLabel =
    themeName === "dark"
      ? t.canvas.viewerToggleLightTheme
      : t.canvas.viewerToggleDarkTheme;
  const ThemeIcon = themeName === "dark" ? Sun : Moon;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: theme.tokens.bg.editor,
        color: theme.tokens.text.primary,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: 44,
          padding: "8px 16px",
          borderBottom: `1px solid ${theme.tokens.stroke.tertiary}`,
          background: theme.tokens.bg.chrome,
          boxSizing: "border-box",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 14,
              lineHeight: "20px",
              fontWeight: 590,
              color: theme.tokens.text.primary,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {artifact.title}
          </span>
          <span
            style={{
              fontSize: 11,
              lineHeight: "14px",
              padding: "2px 6px 3px",
              borderRadius: 9999,
              background: theme.tokens.fill.quaternary,
              color: theme.tokens.text.tertiary,
              border: `1px solid ${theme.tokens.stroke.tertiary}`,
              whiteSpace: "nowrap",
            }}
          >
            {renderModeLabel}
          </span>
          <span
            style={{
              fontSize: 12,
              lineHeight: "16px",
              color: theme.tokens.text.tertiary,
              whiteSpace: "nowrap",
            }}
          >
            {generatedAtLabel}
          </span>
        </div>
        <button
          type="button"
          title={toggleThemeLabel}
          aria-label={toggleThemeLabel}
          onClick={() =>
            setThemeName((t) => (t === "dark" ? "light" : "dark"))
          }
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            padding: 0,
            background: "transparent",
            color: theme.tokens.text.secondary,
            border: `1px solid ${theme.tokens.stroke.secondary}`,
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          <ThemeIcon size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </header>

      <main
        style={{
          minHeight: "calc(100vh - 44px)",
          padding: "24px 32px",
          boxSizing: "border-box",
        }}
      >
        <CanvasHost
          theme={theme}
          canvasId={artifact.id}
          hostState={hostState}
          applyBodyTheme={false}
        >
          <CanvasContent
            renderMode={artifact.renderMode}
            canvasType={artifact.canvasType}
            source={artifact.source}
            data={artifact.data}
            cannotRenderMessage={t.canvas.viewerCannotRender}
            compilationErrorLabel={t.canvas.viewerCompilationError}
          />
        </CanvasHost>
      </main>
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
  cannotRenderMessage,
  compilationErrorLabel,
}: {
  renderMode: CanvasRenderMode;
  canvasType?: CanvasType;
  source?: string;
  data?: unknown;
  cannotRenderMessage: string;
  compilationErrorLabel: string;
}): JSX.Element {
  if (renderMode === "dynamic" && source) {
    return (
      <DynamicCanvas
        source={source}
        compilationErrorLabel={compilationErrorLabel}
      />
    );
  }

  // Prebuilt fallback
  if (canvasType) {
    switch (canvasType) {
      case "fitness_overview":
        return <FitnessOverviewCanvas data={data as FitnessOverviewData} />;
    }
  }

  return (
    <CanvasErrorNotice message={cannotRenderMessage} />
  );
}

// ---------------------------------------------------------------------------
// Dynamic canvas — compile TSX source on the client
// ---------------------------------------------------------------------------

function DynamicCanvas({
  source,
  compilationErrorLabel,
}: {
  source: string;
  compilationErrorLabel: string;
}): JSX.Element {
  const result = useMemo(() => compileCanvasTsx(source), [source]);

  if (!result.ok) {
    return (
      <CanvasErrorNotice
        message={`${compilationErrorLabel}\n${result.error}`}
      />
    );
  }

  const Component = result.Component;
  return <Component />;
}

function CanvasErrorNotice({ message }: { message: string }): JSX.Element {
  const theme = useHostTheme();
  return (
    <div
      role="alert"
      style={{
        padding: "12px 14px",
        background: theme.tokens.diff.removedLine,
        border: `1px solid ${theme.tokens.diff.stripRemoved}`,
        borderRadius: 8,
        color: theme.tokens.text.primary,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace',
        fontSize: 13,
        lineHeight: "18px",
        whiteSpace: "pre-wrap",
      }}
    >
      {message}
    </div>
  );
}
