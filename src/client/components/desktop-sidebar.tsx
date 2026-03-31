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
import { usePathname } from "next/navigation";
import { useTranslation } from "@/i18n";
import { HarnessMark } from "./harness-mark";

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
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
        </svg>
      ),
    },
    {
      id: "kanban",
      label: t.nav.kanban,
      href: workspaceBaseHref ? `${workspaceBaseHref}/kanban` : "/",
      requiresWorkspace: true,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" />
        </svg>
      ),
    },
    {
      id: "overview",
      label: t.nav.overview,
      href: workspaceBaseHref ? `${workspaceBaseHref}/overview` : "/",
      requiresWorkspace: true,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
        </svg>
      ),
    },
    {
      id: "team",
      label: t.nav.team,
      href: workspaceBaseHref ? `${workspaceBaseHref}/team` : "/",
      requiresWorkspace: true,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <circle cx="7.5" cy="8" r="2.25" />
          <circle cx="16.5" cy="8" r="2.25" />
          <circle cx="12" cy="16" r="2.25" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 8h5M8.75 9.9l2 3.55m4.5-3.55-2 3.55" />
        </svg>
      ),
    },
  ];

  const toolItems: NavItem[] = [
    {
      id: "mcp",
      label: t.nav.mcpServers,
      href: "/settings/mcp",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5h10.5M6.75 12h10.5M6.75 16.5h6.75M4.5 4.5h15A2.25 2.25 0 0121.75 6.75v10.5A2.25 2.25 0 0119.5 19.5h-15A2.25 2.25 0 012.25 17.25V6.75A2.25 2.25 0 014.5 4.5z" />
        </svg>
      ),
    },
    {
      id: "schedules",
      label: t.nav.schedules,
      href: "/settings/schedules",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3.75v3m10.5-3v3M4.5 8.25h15m-14.25 9h5.25m-5.25 0V6.75A2.25 2.25 0 016.75 4.5h10.5a2.25 2.25 0 012.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25H6.75a2.25 2.25 0 01-2.25-2.25z" />
        </svg>
      ),
    },
    {
      id: "harness",
      label: t.nav.harness,
      href: settingsHarnessHref,
      icon: <HarnessMark className="h-5 w-5" />,
    },
    {
      id: "fluency",
      label: t.nav.fluency,
      href: settingsFluencyHref,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12a7.5 7.5 0 1115 0m-7.5 0v5.25m0-5.25l3.25-3.25m-3.25 3.25L8.75 8.75" />
        </svg>
      ),
    },
    {
      id: "workflows",
      label: t.nav.workflows,
      href: "/settings/workflows",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 5.25h3.75V9H6V5.25zm8.25 0H18V9h-3.75V5.25zM6 15h3.75v3.75H6V15zm8.25 0H18v3.75h-3.75V15zM9.75 7.125h4.5m-2.25 1.5v5.25m2.25 0h-4.5" />
        </svg>
      ),
    },
    {
      id: "specialists",
      label: t.nav.specialists,
      href: "/settings/specialists",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6.75a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 19.5a7.5 7.5 0 1115 0" />
        </svg>
      ),
    },
  ];

  const secondaryItems: NavItem[] = [
    {
      id: "config",
      label: t.nav.settings,
      href: "/settings",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      id: "debug",
      label: t.nav.debug,
      href: "/traces",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605" />
        </svg>
      ),
    },
  ];

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
      <div className={`border-b border-desktop-border px-2 py-2 ${collapsed ? "flex justify-center" : ""}`}>
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
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
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
        {secondaryItems.map(renderNavItem)}
      </div>
    </aside>
  );
}
