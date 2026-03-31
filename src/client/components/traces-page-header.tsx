"use client";

import React from "react";
import { useTranslation } from "@/i18n";
import { Button } from "./button";

interface TracesPageHeaderProps {
  selectedSessionId: string | null;
  showSidebar: boolean;
  loading: boolean;
  onCopyCurrentUrl: () => void;
  onToggleSidebar: () => void;
  onRefresh: () => void;
}

export function TracesPageHeader({
  selectedSessionId,
  showSidebar,
  loading,
  onCopyCurrentUrl,
  onToggleSidebar,
  onRefresh,
}: TracesPageHeaderProps) {
  const { t } = useTranslation();
  return (
    <div
      className="shrink-0 flex items-center justify-between border-b border-desktop-border px-4 py-3"
      data-testid="traces-page-header"
    >
      <div className="flex items-center gap-2 min-w-0">
        <svg className="w-4 h-4 shrink-0 text-desktop-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" />
        </svg>
        <div className="min-w-0">
          <h1 className="text-[13px] font-semibold text-desktop-text-primary">
            {t.traces.agentTraceViewer}
          </h1>
          <p className="text-[11px] text-desktop-text-secondary">
            {t.traces.browseTraces}
          </p>
        </div>
        {selectedSessionId && (
          <div
            className="inline-flex items-center gap-1.5 rounded border border-desktop-border px-2 py-1 text-[10px] text-desktop-text-secondary"
            data-testid="traces-selected-session"
          >
            <span>{t.traces.session}:</span>
            <code className="font-mono text-desktop-text-primary">{selectedSessionId.slice(0, 8)}…</code>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        {selectedSessionId && (
          <Button
            type="button"
            size="xs"
            variant="secondary"
            onClick={onCopyCurrentUrl}
            className="group gap-1.5"
            title="Copy shareable URL"
          >
            <span>{t.traces.copyLink}</span>
            <svg className="w-3.5 h-3.5 text-desktop-text-secondary group-hover:text-desktop-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </Button>
        )}
        <Button
          type="button"
          size="xs"
          variant="secondary"
          onClick={onToggleSidebar}
        >
          {showSidebar ? t.traces.hideSessions : t.traces.showSessions}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="secondary"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? t.common.loading : t.common.refresh}
        </Button>
      </div>
    </div>
  );
}
