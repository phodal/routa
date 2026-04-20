"use client";

/**
 * Desktop App Shell — Shared layout wrapper for all Tauri desktop pages.
 *
 * Provides consistent desktop app experience with:
 * - Compact title bar with window controls area
 * - Left sidebar navigation (VS Code style)
 * - Main content area
 *
 * This is a simpler version of DesktopLayout that doesn't require
 * workspace hooks - it accepts all data as props.
 */

import React, { useCallback, useSyncExternalStore } from "react";
import { DesktopShellHeader } from "./desktop-shell-header";
import { DesktopSidebar } from "./desktop-sidebar";

const DESKTOP_SIDEBAR_COLLAPSED_KEY = "routa.desktop.sidebar-collapsed";
const DESKTOP_SIDEBAR_CHANGE_EVENT = "routa:desktop-sidebar-collapsed";

function hasDesktopSidebarLocalStorageAccess(): boolean {
  return (
    typeof window !== "undefined" &&
    window.localStorage != null &&
    typeof window.localStorage.getItem === "function" &&
    typeof window.localStorage.setItem === "function"
  );
}

function getDesktopSidebarCollapsedSnapshot(): boolean {
  if (!hasDesktopSidebarLocalStorageAccess()) {
    return false;
  }

  return window.localStorage.getItem(DESKTOP_SIDEBAR_COLLAPSED_KEY) === "true";
}

function getDesktopSidebarCollapsedServerSnapshot(): boolean {
  return false;
}

function subscribeToDesktopSidebarCollapsed(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleChange = () => onStoreChange();
  window.addEventListener(DESKTOP_SIDEBAR_CHANGE_EVENT, handleChange as EventListener);
  window.addEventListener("storage", handleChange);

  return () => {
    window.removeEventListener(DESKTOP_SIDEBAR_CHANGE_EVENT, handleChange as EventListener);
    window.removeEventListener("storage", handleChange);
  };
}

interface DesktopAppShellProps {
  children: React.ReactNode;
  workspaceId?: string | null;
  /** Current workspace title for display */
  workspaceTitle?: string;
  /** Optional right side content for the title bar */
  titleBarRight?: React.ReactNode;
  /** Optional workspace switcher component */
  workspaceSwitcher?: React.ReactNode;
  /** Optional icon-only action rendered above the Home item in the sidebar */
  sidebarTopAction?: {
    href: string;
    label: string;
    icon?: React.ReactNode;
  };
}

export function DesktopAppShell({
  children,
  workspaceId,
  workspaceTitle,
  titleBarRight,
  workspaceSwitcher,
  sidebarTopAction,
}: DesktopAppShellProps) {
  const isSidebarCollapsed = useSyncExternalStore(
    subscribeToDesktopSidebarCollapsed,
    getDesktopSidebarCollapsedSnapshot,
    getDesktopSidebarCollapsedServerSnapshot,
  );

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    if (!hasDesktopSidebarLocalStorageAccess()) {
      return;
    }

    window.localStorage.setItem(DESKTOP_SIDEBAR_COLLAPSED_KEY, String(collapsed));
    window.dispatchEvent(
      new CustomEvent(DESKTOP_SIDEBAR_CHANGE_EVENT, {
        detail: { collapsed },
      }),
    );
  }, []);

  return (
    <div
      className="desktop-theme h-screen flex flex-col overflow-hidden bg-desktop-bg-primary"
      data-testid="desktop-shell-root"
    >
      <DesktopShellHeader
        workspaceId={workspaceId}
        workspaceTitle={workspaceTitle}
        workspaceSwitcher={workspaceSwitcher}
        titleBarRight={titleBarRight}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-0" data-testid="desktop-shell-body">
        <DesktopSidebar
          workspaceId={workspaceId}
          collapsed={isSidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!isSidebarCollapsed)}
          topAction={sidebarTopAction}
        />

        {/* Content */}
        <main className="flex-1 min-w-0 overflow-hidden bg-desktop-bg-primary" data-testid="desktop-shell-main">
          {children}
        </main>
      </div>
    </div>
  );
}
