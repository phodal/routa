"use client";

import React from "react";
import Link from "next/link";

import { useTranslation } from "@/i18n";
import { ShellHeaderControls } from "./shell-header-controls";
import { Folder } from "lucide-react";


interface DesktopShellHeaderProps {
  workspaceId?: string | null;
  workspaceTitle?: string;
  titleBarRight?: React.ReactNode;
  workspaceSwitcher?: React.ReactNode;
}

export function DesktopShellHeader({
  workspaceId,
  workspaceTitle,
  workspaceSwitcher,
}: DesktopShellHeaderProps) {
  const { t } = useTranslation();
  const normalizedWorkspaceId = workspaceId?.trim() || null;
  const workspaceHref = normalizedWorkspaceId ? `/workspace/${normalizedWorkspaceId}` : null;
  const workspaceLabel = workspaceTitle ?? normalizedWorkspaceId ?? t.workspace.workspaces;

  return (
    <header
      className="h-10 shrink-0 flex items-center border-b border-desktop-border bg-desktop-bg-tertiary backdrop-blur-md select-none"
      data-testid="desktop-shell-header"
    >
      <div className="w-20 h-full app-drag-region" />

      <div className="ml-3">
        {workspaceSwitcher ?? (
          workspaceHref ? (
          <Link
            href={workspaceHref}
            className="flex items-center gap-1.5 rounded-xl border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1.5 text-[11px] text-desktop-text-primary transition-colors hover:bg-desktop-bg-active"
          >
            <Folder className="w-3 h-3 text-desktop-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            <span className="max-w-[120px] truncate">{workspaceLabel}</span>
          </Link>
          ) : (
            <div className="flex items-center gap-1.5 rounded-xl border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1.5 text-[11px] text-desktop-text-secondary">
              <Folder className="w-3 h-3 text-desktop-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
              <span className="max-w-[120px] truncate">{workspaceLabel}</span>
            </div>
          )
        )}
      </div>

      <div className="flex-1 app-drag-region h-full" />

      <ShellHeaderControls className="px-2" showProtocolBadges={false} showSettingsMenu={false} compactStatus />
    </header>
  );
}
