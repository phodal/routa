"use client";

/**
 * Desktop Sidebar Navigation — VS Code-style left navigation for Tauri app.
 *
 * Provides a compact icon-based navigation with:
 * - Primary navigation icons (Overview, Kanban, Traces)
 * - Secondary actions (Settings)
 * - Workspace indicator
 */

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useTranslation } from "@/i18n";
import { HarnessMark } from "./harness-mark";
import { SettingsPopupMenu } from "./settings-popup-menu";
import { ChevronLeft, CircleUser, Columns2, LayoutGrid, Server, Calendar, Workflow, House, Share2, MonitorUp, Monitor } from "lucide-react";


interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  href: string;
  requiresWorkspace?: boolean;
}

interface SidebarTopAction {
  href: string;
  label: string;
  icon?: React.ReactNode;
}

interface DesktopSidebarProps {
  workspaceId?: string | null;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  topAction?: SidebarTopAction;
}

export function DesktopSidebar({
  workspaceId,
  collapsed = false,
  onToggleCollapse,
  topAction,
}: DesktopSidebarProps) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const normalizedWorkspaceId = workspaceId?.trim() || null;
  const fallbackWorkspaceId = normalizedWorkspaceId || "default";
  const workspaceBaseHref = `/workspace/${fallbackWorkspaceId}`;
  const settingsHarnessHref = normalizedWorkspaceId
    ? `/settings/harness?workspaceId=${encodeURIComponent(normalizedWorkspaceId)}`
    : "/settings/harness";
  const settingsFluencyHref = normalizedWorkspaceId
    ? `/settings/fluency?workspaceId=${encodeURIComponent(normalizedWorkspaceId)}`
    : "/settings/fluency";

  const primaryItems: NavItem[] = [
    {
      id: "home",
      label: t.nav.home,
      href: "/",
      icon: (
        <House className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
      ),
    },
    {
      id: "kanban",
      label: t.nav.kanban,
      href: workspaceBaseHref ? `${workspaceBaseHref}/kanban` : "/",
      requiresWorkspace: true,
      icon: (
        <Columns2 className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
      ),
    },
    {
      id: "overview",
      label: t.nav.overview,
      href: workspaceBaseHref ? `${workspaceBaseHref}/overview` : "/",
      requiresWorkspace: true,
      icon: (
        <LayoutGrid className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
      ),
    },
    {
      id: "team",
      label: t.nav.team,
      href: workspaceBaseHref ? `${workspaceBaseHref}/team` : "/",
      requiresWorkspace: true,
      icon: (
        <Share2 className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}/>
      ),
    },
  ];

  const toolItems: NavItem[] = [
    {
      id: "mcp",
      label: t.nav.mcpServers,
      href: "/settings/mcp",
      icon: (
        <Server className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
      ),
    },
    {
      id: "schedules",
      label: t.nav.schedules,
      href: "/settings/schedules",
      icon: (
        <Calendar className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
      ),
    },
    {
      id: "harness",
      label: t.nav.harness,
      href: settingsHarnessHref,
      icon: <HarnessMark className="h-5 w-5" title="" />,
    },
    {
      id: "fluency",
      label: t.nav.fluency,
      href: settingsFluencyHref,
      icon: (
        <MonitorUp className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
      ),
    },
    {
      id: "workflows",
      label: t.nav.workflows,
      href: "/settings/workflows",
      icon: (
        <Workflow className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
      ),
    },
    {
      id: "specialists",
      label: t.nav.specialists,
      href: "/settings/specialists",
      icon: (
        <CircleUser className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
      ),
    },
  ];

  const secondaryItems: NavItem[] = [
    {
      id: "debug",
      label: t.nav.debug,
      href: "/traces",
      icon: (
        <Monitor className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
      ),
    },
  ];
  const settingsActive = pathname === "/settings" || pathname.startsWith("/settings/");

  const isActive = (href: string) => {
    const hrefPath = href.split("?")[0]?.split("#")[0] ?? href;
    if (hrefPath === "/") return pathname === "/";
    if (hrefPath === workspaceBaseHref) return pathname === hrefPath;
    return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
  };

  const renderNavItem = (item: NavItem) => {
    const active = isActive(item.href);
    const className = `relative flex items-center rounded-xl transition-colors ${
      active
        ? "bg-desktop-bg-active text-desktop-accent"
        : "text-desktop-text-secondary hover:bg-desktop-bg-active/70 hover:text-desktop-text-primary"
    } ${collapsed ? "h-10 w-10 justify-center" : "h-11 w-full gap-3 px-3 text-sm font-medium"}`;

    return (
      <Link
        key={item.id}
        href={item.href}
        className={className}
        title={item.label}
      >
        {active && <div className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-desktop-accent" />}
        {item.icon}
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    );
  };

  return (
    <aside
      className={`h-full shrink-0 flex flex-col border-r border-desktop-border bg-desktop-bg-secondary transition-[width] duration-200 ${
        collapsed ? "w-14" : "w-48"
      }`}
      data-testid="desktop-shell-sidebar"
    >
      <div className={`border-b border-desktop-border px-2 py-2 ${collapsed ? "flex items-center justify-center" : "flex items-center justify-between gap-2"}`}>
        {!collapsed ? (
          <div
            className="flex items-center gap-1.5 rounded-xl px-2 py-1 text-sm font-semibold text-desktop-text-primary"
            title="Routa"
          >
            <Image src="/logo.svg" alt="Routa" width={18} height={18} className="rounded-md" />
            <span>Routa</span>
          </div>
        ) : null}
        <button
          type="button"
          onClick={onToggleCollapse}
          className={`flex items-center rounded-xl text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary ${
            collapsed ? "h-10 w-10 justify-center" : "h-10 w-10 justify-center"
          }`}
          title={collapsed ? t.nav.openSidebar : t.nav.closeSidebar}
          aria-label={collapsed ? t.nav.openSidebar : t.nav.closeSidebar}
        >
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            {collapsed ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 6 12l7.5 7.5M18 4.5 10.5 12 18 19.5" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 4.5 18 12l-7.5 7.5M6 4.5 13.5 12 6 19.5" />
            )}
          </svg>
        </button>
      </div>

      <nav className={`flex-1 py-3 ${collapsed ? "flex flex-col items-center gap-1" : "px-2 space-y-1"}`}>
        {topAction ? (
          <>
            <Link
              href={topAction.href}
              className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary"
              title={topAction.label}
              aria-label={topAction.label}
            >
              {topAction.icon ?? (
                <ChevronLeft className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
              )}
            </Link>
            {!collapsed && <div className="mx-1 mb-2 border-t border-desktop-border" />}
          </>
        ) : null}
        {primaryItems.map(renderNavItem)}
        {!collapsed && <div className="mx-1 my-2 border-t border-desktop-border" />}
        {toolItems.map(renderNavItem)}
      </nav>

      <div className={`${collapsed ? "mx-3" : "mx-2"} border-t border-desktop-border`} />

      <div className={`py-3 ${collapsed ? "flex flex-col items-center gap-1" : "px-2 space-y-1"}`}>
        <SettingsPopupMenu
          position="sidebar"
          showLabel={!collapsed}
          isActive={settingsActive}
          className="w-full"
          buttonClassName={collapsed ? "h-10 w-10 px-0 py-0 justify-center" : "h-11 w-full gap-3 px-3 py-0 text-sm font-medium"}
        />
        {secondaryItems.map(renderNavItem)}
      </div>
    </aside>
  );
}
