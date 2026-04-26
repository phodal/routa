"use client";

import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";
import { ExternalLink, Monitor, X } from "lucide-react";

import { CanvasViewer } from "@/client/components/canvas-viewer";
import { useTranslation } from "@/i18n";

export interface SessionCanvasPanelArtifact {
  fileName: string;
  filePath: string;
  id: string;
  title: string;
  viewerUrl: string;
}

export interface SessionCanvasPanelProps {
  activeCanvas: SessionCanvasPanelArtifact | null;
  error: string | null;
  isMaterializing: boolean;
  onClose: () => void;
}

interface CanvasPanelBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  resetKey: string | null;
}

interface CanvasPanelBoundaryState {
  hasError: boolean;
}

class CanvasPanelBoundary extends Component<CanvasPanelBoundaryProps, CanvasPanelBoundaryState> {
  state: CanvasPanelBoundaryState = { hasError: false };

  static getDerivedStateFromError(): CanvasPanelBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    // The panel fallback is enough here; the underlying CanvasViewer already
    // reports compilation errors inside the artifact preview.
  }

  componentDidUpdate(previousProps: CanvasPanelBoundaryProps): void {
    if (previousProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function CanvasPanelState({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "danger";
}) {
  return (
    <div className="flex h-full items-center justify-center px-5 text-center">
      <div
        className={
          tone === "danger"
            ? "max-w-sm text-[12px] leading-5 text-red-600 dark:text-red-300"
            : "max-w-sm text-[12px] leading-5 text-[var(--dt-text-secondary)]"
        }
      >
        {children}
      </div>
    </div>
  );
}

export function SessionCanvasPanel({
  activeCanvas,
  error,
  isMaterializing,
  onClose,
}: SessionCanvasPanelProps) {
  const { t } = useTranslation();
  const fallback = (
    <CanvasPanelState tone="danger">
      {t.canvas.livePanelError}
    </CanvasPanelState>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="session-canvas-panel">
      <div className="flex min-h-10 items-center justify-between gap-2 border-b border-[var(--dt-border)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Monitor className="h-3.5 w-3.5 shrink-0 text-[var(--dt-accent)]" aria-hidden="true" />
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-[var(--dt-text-primary)]">
              {activeCanvas?.title ?? t.canvas.livePanelTitle}
            </div>
            {activeCanvas ? (
              <div className="truncate text-[10px] text-[var(--dt-text-secondary)]" title={activeCanvas.filePath}>
                {t.canvas.livePanelDetectedFile}: {activeCanvas.fileName}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {activeCanvas ? (
            <a
              href={activeCanvas.viewerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--dt-text-secondary)] transition-colors hover:bg-[var(--dt-bg-active)] hover:text-[var(--dt-text-primary)]"
              title={t.canvas.livePanelOpen}
              aria-label={t.canvas.livePanelOpen}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--dt-text-secondary)] transition-colors hover:bg-[var(--dt-bg-active)] hover:text-[var(--dt-text-primary)]"
            title={t.canvas.livePanelClose}
            aria-label={t.canvas.livePanelClose}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-[var(--dt-bg-primary)]">
        {error ? (
          <CanvasPanelState tone="danger">
            {t.canvas.livePanelError}: {error}
          </CanvasPanelState>
        ) : activeCanvas ? (
          <CanvasPanelBoundary resetKey={activeCanvas.id} fallback={fallback}>
            <Suspense
              fallback={(
                <CanvasPanelState>
                  {t.canvas.livePanelMaterializing}
                </CanvasPanelState>
              )}
            >
              <CanvasViewer canvasId={activeCanvas.id} />
            </Suspense>
          </CanvasPanelBoundary>
        ) : (
          <CanvasPanelState>
            {isMaterializing ? t.canvas.livePanelMaterializing : t.canvas.livePanelPending}
          </CanvasPanelState>
        )}
      </div>
    </div>
  );
}
