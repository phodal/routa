"use client";

import type { ReactNode } from "react";
import { useTranslation } from "@/i18n";

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
}: SettingsRouteShellProps) {
  const { t } = useTranslation();
  void title;
  void description;
  void badgeLabel;
  void icon;
  void summary;

  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceTitle={workspaceTitle}
      workspaceSwitcher={workspaceSwitcher ?? (
        <div className="flex items-center gap-1.5 rounded-xl border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1.5 text-[11px] text-desktop-text-primary">
          <svg className="h-3 w-3 text-desktop-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
          </svg>
          <span>{t.settings.title}</span>
        </div>
      )}
    >
      <main className="h-full overflow-y-auto bg-desktop-bg-primary text-desktop-text-primary">
        <div className="flex min-h-full w-full flex-col px-8 py-8">
          {children}
        </div>
      </main>
    </DesktopAppShell>
  );
}
