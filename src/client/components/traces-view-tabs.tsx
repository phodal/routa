"use client";

import React from "react";
import { Button } from "./button";
import { useTranslation } from "@/i18n";

export type TraceViewTab = "chat" | "event-bridge";

interface TracesViewTabsProps {
  activeTab: TraceViewTab;
  onTabChange: (tab: TraceViewTab) => void;
  className?: string;
}

export function TracesViewTabs({ activeTab, onTabChange, className }: TracesViewTabsProps) {
  const { t } = useTranslation();

  const TAB_DEFINITIONS: Array<{ key: TraceViewTab; label: string; color: string }> = [
    { key: "chat", label: t.traces.chatTab, color: "bg-desktop-trace-chat" },
    { key: "event-bridge", label: t.traces.traceTab, color: "bg-desktop-trace-event-bridge" },
  ];

  return (
    <div className={className ?? ""}>
      <div
        className="inline-flex items-center rounded-md border border-desktop-border bg-desktop-bg-secondary p-0.5"
        data-testid="traces-view-tabs"
      >
        {TAB_DEFINITIONS.map(({ key, label, color }) => (
          <Button
            key={key}
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onTabChange(key)}
            className={`rounded-none px-3 py-1.5 text-[11px] font-semibold tracking-wide transition-all ${
              activeTab === key
                ? `${color} text-desktop-accent-text`
                : "text-desktop-text-secondary hover:bg-desktop-bg-active/70 hover:text-desktop-text-primary"
            }`}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}
