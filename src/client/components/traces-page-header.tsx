"use client";

import React from "react";
import { useTranslation } from "@/i18n";
import { Button } from "./button";
import { Columns2, Copy } from "lucide-react";


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
        <Columns2 className="w-4 h-4 shrink-0 text-desktop-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
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
            title={t.traces.copyShareableUrl}
          >
            <span>{t.traces.copyLink}</span>
            <Copy className="w-3.5 h-3.5 text-desktop-text-secondary group-hover:text-desktop-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
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
