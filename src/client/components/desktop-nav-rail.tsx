"use client";

/**
 * Desktop Navigation Rail — Minimal vertical icon bar for Tauri app.
 *
 * A slim navigation rail that can be added to any page layout.
 * Provides consistent navigation across all desktop app pages.
 */

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "@/i18n";
import { Columns2, House, ScrollText, Settings, Share2 } from "lucide-react";


interface DesktopNavRailProps {
  workspaceId: string;
}

export function DesktopNavRail({
  workspaceId,
}: DesktopNavRailProps) {
  const pathname = usePathname();
  const { t } = useTranslation();

  const navItems = [
    {
      id: "home",
      label: t.nav.home,
      href: "/",
      icon: (
        <House className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
      ),
    },
    {
      id: "sessions",
      label: t.nav.sessions,
      href: `/workspace/${workspaceId}/sessions`,
      icon: (
        <ScrollText className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
      ),
    },
    {
      id: "kanban",
      label: t.nav.kanban,
      href: `/workspace/${workspaceId}/kanban`,
      icon: (
        <Columns2 className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
      ),
    },
    {
      id: "team",
      label: t.nav.team,
      href: `/workspace/${workspaceId}/team`,
      icon: (
        <Share2 className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}/>
      ),
    },
    {
      id: "settings",
      label: t.settings.title,
      href: "/settings",
      exactMatch: true,
      icon: (
        <Settings className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}/>
      ),
    },
  ];

  const isActive = (href: string, exactMatch = false) => {
    if (href === "/") return pathname === "/";
    if (exactMatch) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <aside
      className="desktop-theme h-full w-12 shrink-0 flex flex-col border-r border-desktop-border bg-desktop-bg-secondary"
      data-testid="desktop-nav-rail"
    >
      <nav className="flex-1 flex flex-col items-center py-2 gap-0.5">
        {navItems.map((item) => {
          const active = isActive(item.href, "exactMatch" in item ? Boolean(item.exactMatch) : false);
          return (
            <Link
              key={item.id}
              href={item.href}
              className={`
                relative w-10 h-10 flex items-center justify-center rounded-md transition-colors
              ${active
                  ? "bg-desktop-bg-active text-desktop-accent"
                  : "text-desktop-text-secondary hover:bg-desktop-bg-active/70 hover:text-desktop-text-primary"
                }
              `}
              title={item.label}
            >
              {active && (
                <div className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-desktop-accent" />
              )}
              {item.icon}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
