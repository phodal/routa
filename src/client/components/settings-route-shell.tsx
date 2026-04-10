"use client";

import type { ReactNode } from "react";

import { DesktopAppShell } from "./desktop-app-shell";
import { SettingsCenterNav, type SettingsNavItem } from "./settings-center-nav";


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
  activeSettingsItem?: SettingsNavItem;
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
  activeSettingsItem,
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
      <div className="flex h-full min-h-0 bg-desktop-bg-primary text-desktop-text-primary">
        {activeSettingsItem ? <SettingsCenterNav activeItem={activeSettingsItem} /> : null}
        <main className="h-full min-w-0 flex-1 overflow-hidden bg-desktop-bg-primary text-desktop-text-primary">
          <div className={contentClassName ?? "flex min-h-full w-full flex-col px-8 py-8"}>
            {children}
          </div>
        </main>
      </div>
    </DesktopAppShell>
  );
}
