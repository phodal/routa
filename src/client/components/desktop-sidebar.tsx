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
  const normalizedWorkspaceId = workspaceId?.trim() || null;
  const workspaceBaseHref = normalizedWorkspaceId ? `/workspace/${normalizedWorkspaceId}` : null;

  const primaryItems: NavItem[] = [
    {
      id: "home",
      label: "Home",
      href: "/",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
        </svg>
      ),
    },
    {
      id: "overview",
      label: "Workspace",
      href: workspaceBaseHref ?? "/",
      requiresWorkspace: true,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
        </svg>
      ),
    },
    {
      id: "kanban",
      label: "Kanban",
      href: workspaceBaseHref ? `${workspaceBaseHref}/kanban` : "/",
      requiresWorkspace: true,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" />
        </svg>
      ),
    },
    {
      id: "team",
      label: "Team",
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
      label: "MCP Servers",
      href: "/settings/mcp",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5h10.5M6.75 12h10.5M6.75 16.5h6.75M4.5 4.5h15A2.25 2.25 0 0121.75 6.75v10.5A2.25 2.25 0 0119.5 19.5h-15A2.25 2.25 0 012.25 17.25V6.75A2.25 2.25 0 014.5 4.5z" />
        </svg>
      ),
    },
    {
      id: "schedules",
      label: "Schedules",
      href: "/settings/schedules",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3.75v3m10.5-3v3M4.5 8.25h15m-14.25 9h5.25m-5.25 0V6.75A2.25 2.25 0 016.75 4.5h10.5a2.25 2.25 0 012.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25H6.75a2.25 2.25 0 01-2.25-2.25z" />
        </svg>
      ),
    },
    {
      id: "workflows",
      label: "Workflows",
      href: "/settings/workflows",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 5.25h3.75V9H6V5.25zm8.25 0H18V9h-3.75V5.25zM6 15h3.75v3.75H6V15zm8.25 0H18v3.75h-3.75V15zM9.75 7.125h4.5m-2.25 1.5v5.25m2.25 0h-4.5" />
        </svg>
      ),
    },
    {
      id: "specialists",
      label: "Specialists",
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
      label: "Config",
      href: "/settings",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 3.75h1.5m-1.5 0a2.25 2.25 0 00-2.25 2.25v.75h6V6a2.25 2.25 0 00-2.25-2.25m-1.5 0v3m-6.75 4.5h15m-15 0V18A2.25 2.25 0 006 20.25h12A2.25 2.25 0 0020.25 18v-6.75m-15 0h15" />
        </svg>
      ),
    },
    {
      id: "debug",
      label: "Debug",
      href: "/traces",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605" />
        </svg>
      ),
    },
  ];

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href === workspaceBaseHref) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const renderNavItem = (item: NavItem) => {
    const disabled = !!item.requiresWorkspace && !workspaceBaseHref;
    const active = isActive(item.href);
    const className = `relative flex items-center rounded-xl transition-colors ${
      disabled
        ? "cursor-default text-desktop-text-secondary/40"
        : active
          ? "bg-desktop-bg-active text-desktop-accent"
          : "text-desktop-text-secondary hover:bg-desktop-bg-active/70 hover:text-desktop-text-primary"
    } ${collapsed ? "h-10 w-10 justify-center" : "h-11 w-full gap-3 px-3 text-sm font-medium"}`;

    return disabled ? (
      <div key={item.id} className={className} title={`${item.label} unavailable`} aria-disabled="true">
        {item.icon}
        {!collapsed && <span className="truncate">{item.label}</span>}
      </div>
    ) : (
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
            collapsed ? "h-10 w-10 justify-center" : "w-full gap-2 px-3 py-2 text-sm"
          }`}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            {collapsed ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 6 12l7.5 7.5M18 4.5 10.5 12 18 19.5" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 4.5 18 12l-7.5 7.5M6 4.5 13.5 12 6 19.5" />
            )}
          </svg>
          {!collapsed && <span>导航</span>}
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
