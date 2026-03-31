"use client";

import React from "react";
import { Button } from "./button";
import { useTranslation } from "@/i18n";

export type WorkspaceOverviewTab = "overview" | "notes" | "activity";

interface WorkspaceTabBarProps {
  activeTab: WorkspaceOverviewTab;
  notesCount: number;
  activityCount: number;
  onTabChange: (tab: WorkspaceOverviewTab) => void;
  className?: string;
}

export function WorkspaceTabBar({
  activeTab,
  notesCount,
  activityCount,
  onTabChange,
  className,
}: WorkspaceTabBarProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`flex items-center gap-0 border-b border-desktop-border ${className ?? ""}`.trim()}
      data-testid="workspace-tab-bar"
    >
      <WorkspaceTabButton active={activeTab === "overview"} onClick={() => onTabChange("overview")}>
        {t.workspace.overview}
      </WorkspaceTabButton>
      <WorkspaceTabButton active={activeTab === "notes"} onClick={() => onTabChange("notes")}>
        {t.workspace.notes} {notesCount > 0 && <span className="ml-1 text-[10px] opacity-60" data-testid="workspace-tab-count">({notesCount})</span>}
      </WorkspaceTabButton>
      <WorkspaceTabButton active={activeTab === "activity"} onClick={() => onTabChange("activity")}>
        {t.workspace.activity} {activityCount > 0 && <span className="ml-1 text-[10px] opacity-60" data-testid="workspace-tab-count">({activityCount})</span>}
      </WorkspaceTabButton>
    </div>
  );
}

function WorkspaceTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="xs"
      variant="desktop-secondary"
      onClick={onClick}
      className={`rounded-none border-b-2 px-3 py-1.5 text-[12px] ${active
          ? "border-b-desktop-accent bg-desktop-bg-active text-desktop-accent hover:bg-desktop-bg-active"
          : "border-b-transparent bg-transparent text-desktop-text-secondary"
        }`}
    >
      {children}
    </Button>
  );
}
