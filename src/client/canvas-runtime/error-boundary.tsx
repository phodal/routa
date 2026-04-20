"use client";

import React, { type ReactNode } from "react";

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  onError?: (message: string) => void;
}

/**
 * Error boundary for canvas artifacts. Catches render errors and reports
 * them to the host via the optional onError callback.
 */
export class CanvasErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const message = error.message ?? String(error);
    console.error("[CanvasRuntime] Error:", message, info.componentStack);
    this.props.onError?.(message);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}
