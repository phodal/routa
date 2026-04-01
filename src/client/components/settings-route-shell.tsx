"use client";

import type { ReactNode } from "react";

import { DesktopAppShell } from "./desktop-app-shell";


interface SettingsRouteShellProps {
  title: string;
  description: string;
  children: ReactNode;
  workspaceId?: string | null;
  workspaceTitle?: string;
  badgeLabel?: string;
  icon?: ReactNode;
  summary?: Array<{ label: string; value: string }>;
  workspaceSwitcher?: ReactNode;
  contentClassName?: string;
}

export function SettingsRouteShell({
  title,
  description,
  children,
  workspaceId,
  workspaceTitle,
  badgeLabel,
  icon,
  summary = [],
  workspaceSwitcher,
  contentClassName,
}: SettingsRouteShellProps) {
  void badgeLabel;
  void summary;
  void description;
  void title;
  void icon;

  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceTitle={workspaceTitle}
      workspaceSwitcher={workspaceSwitcher}
    >
      <main className="h-full overflow-y-auto bg-desktop-bg-primary text-desktop-text-primary">
        <div className={contentClassName ?? "flex min-h-full w-full flex-col px-8 py-8"}>
          {children}
        </div>
      </main>
    </DesktopAppShell>
  );
}
