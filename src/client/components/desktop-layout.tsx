"use client";

/**
 * Desktop Layout — Main layout wrapper for Tauri desktop application.
 *
 * Provides a native desktop app feel with:
 * - Compact title bar with window controls area
 * - Left sidebar navigation (VS Code style)
 * - Main content area
 */

import React from "react";
import Image from "next/image";
import { DesktopSidebar } from "./desktop-sidebar";
import { WorkspaceSwitcher } from "./workspace-switcher";
import type { WorkspaceData } from "@/client/hooks/use-workspaces";

interface DesktopLayoutProps {
  children: React.ReactNode;
  workspaceId: string;
  workspaces: WorkspaceData[];
  workspacesLoading?: boolean;
  onWorkspaceSelect: (wsId: string) => void;
  onWorkspaceCreate: (title: string) => Promise<void>;
  sessionCount?: number;
  taskCount?: number;
  activeTaskCount?: number;
  /** Optional right side content for the title bar */
  titleBarRight?: React.ReactNode;
}

export function DesktopLayout({
  children,
  workspaceId,
  workspaces,
  workspacesLoading,
  onWorkspaceSelect,
  onWorkspaceCreate,
  sessionCount = 0,
  taskCount = 0,
  activeTaskCount = 0,
  titleBarRight,
}: DesktopLayoutProps) {
  return (
    <div className="desktop-theme h-screen flex flex-col overflow-hidden bg-[var(--dt-bg-primary)] text-[var(--dt-text-primary)]">
      {/* Title Bar - compact, native feel */}
      <header className="h-9 shrink-0 flex items-center border-b border-[var(--dt-border-light)] bg-[var(--dt-bg-tertiary)] select-none">
        {/* Drag region for window - macOS traffic lights area */}
        <div className="w-20 h-full app-drag-region" />

        {/* Logo + App Name */}
        <div className="flex items-center gap-2 px-2">
          <Image src="/logo.svg" alt="Routa" width={16} height={16} className="rounded" />
          <span className="text-[11px] font-medium text-[var(--dt-text-primary)]">Routa</span>
        </div>

        {/* Workspace Switcher */}
        <div className="ml-3">
          <WorkspaceSwitcher
            workspaces={workspaces}
            activeWorkspaceId={workspaceId}
            onSelect={onWorkspaceSelect}
            onCreate={onWorkspaceCreate}
            loading={workspacesLoading}
            compact
          />
        </div>

        {/* Spacer */}
        <div className="flex-1 app-drag-region h-full" />

        {/* Right side content */}
        {titleBarRight && (
          <div className="flex items-center gap-1 px-2">
            {titleBarRight}
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-0">
        {/* Left Sidebar Navigation */}
        <DesktopSidebar
          workspaceId={workspaceId}
          sessionCount={sessionCount}
          taskCount={taskCount}
          activeTaskCount={activeTaskCount}
        />

        {/* Content */}
        <main className="flex-1 min-w-0 overflow-hidden bg-[var(--dt-bg-primary)]">
          {children}
        </main>
      </div>
    </div>
  );
}
