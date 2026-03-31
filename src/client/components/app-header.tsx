"use client";

/**
 * Shared top-bar header used across workspace pages.
 *
 * Provides a consistent layout:
 *   Logo | Workspace switcher | [left slot] | spacer | Protocol badges | [right slot]
 */

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "./button";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { ShellHeaderControls } from "@/client/components/shell-header-controls";
import type { WorkspaceData } from "@/client/hooks/use-workspaces";
import { useTranslation } from "@/i18n";

export interface AppHeaderProps {
  /** Current workspace ID (used for logo link and switcher) */
  workspaceId: string;
  /** Workspace title to display (dashboard mode only) */
  workspaceTitle?: string;
  /** All workspaces for the switcher */
  workspaces: WorkspaceData[];
  /** Switcher loading state */
  workspacesLoading?: boolean;
  /** Called when user picks a different workspace */
  onWorkspaceSelect: (wsId: string) => void;
  /** Called when user creates a new workspace */
  onWorkspaceCreate: (title: string) => Promise<void>;

  /**
   * Layout variant:
   * - "session": full switcher, mobile hamburger support
   * - "dashboard": compact switcher with workspace name + breadcrumb
   */
  variant?: "session" | "dashboard";

  /** Mobile sidebar toggle (session variant only) */
  showMobileSidebar?: boolean;
  onToggleMobileSidebar?: () => void;

  /** Content rendered between the workspace switcher and the spacer */
  leftSlot?: React.ReactNode;
  /** Content rendered after protocol badges (right side) */
  rightSlot?: React.ReactNode;
}

export function AppHeader({
  workspaceId,
  workspaceTitle,
  workspaces,
  workspacesLoading,
  onWorkspaceSelect,
  onWorkspaceCreate,
  variant = "session",
  showMobileSidebar,
  onToggleMobileSidebar,
  leftSlot,
  rightSlot,
}: AppHeaderProps) {
  const isDashboard = variant === "dashboard";
  const { t } = useTranslation();

  return (
    <header
      className={
        isDashboard
          ? "h-12 shrink-0 flex items-center px-5 border-b border-gray-200/60 dark:border-[#191c28] bg-white/80 dark:bg-[#0e1019]/80 backdrop-blur-md z-20"
          : "h-[52px] shrink-0 bg-white dark:bg-[#161922] border-b border-gray-200 dark:border-gray-800 flex items-center px-3 md:px-4 gap-2 md:gap-4 z-10"
      }
    >
      {/* ── Mobile hamburger (session variant only) ── */}
      {!isDashboard && onToggleMobileSidebar && (
        <Button
          variant="ghost"
          size="xs"
          onClick={onToggleMobileSidebar}
          aria-label={showMobileSidebar ? t.nav.closeSidebar : t.nav.openSidebar}
          className="md:hidden w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {showMobileSidebar ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </Button>
      )}

      {/* ── Logo ── */}
      {isDashboard ? (
        <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
          <Image src="/logo.svg" alt="Routa" width={24} height={24} className="rounded-md" />
          <span className="text-[13px] font-semibold text-gray-800 dark:text-gray-200 tracking-tight">Routa</span>
        </Link>
      ) : (
        <Link href={`/workspace/${workspaceId}`} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Image src="/logo.svg" alt="Routa" width={28} height={28} className="rounded-lg" />
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 hidden sm:inline">Routa</span>
        </Link>
      )}

      {/* ── Workspace switcher area ── */}
      {isDashboard ? (
        <>
          <svg className="w-4 h-4 mx-2.5 text-gray-300 dark:text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
            <span className="text-[13px] font-medium text-gray-700 dark:text-gray-300 truncate max-w-[180px]">
              {workspaceTitle ?? t.workspace.workspaces}
            </span>
            <WorkspaceSwitcher
              workspaces={workspaces}
              activeWorkspaceId={workspaceId}
              onSelect={onWorkspaceSelect}
              onCreate={onWorkspaceCreate}
              loading={workspacesLoading}
              compact
            />
          </div>
        </>
      ) : (
        <>
          <div className="w-px h-5 bg-gray-200 dark:bg-gray-700" />
          <WorkspaceSwitcher
            workspaces={workspaces}
            activeWorkspaceId={workspaceId}
            onSelect={onWorkspaceSelect}
            onCreate={onWorkspaceCreate}
            loading={workspacesLoading}
          />
        </>
      )}

      {/* ── Left slot (agent selector, etc.) ── */}
      {leftSlot}

      {/* ── Spacer ── */}
      <div className="flex-1" />

      <ShellHeaderControls className={isDashboard ? "mr-3" : "mr-2"} />

      {/* ── Right slot (tool toggle, links, settings, etc.) ── */}
      {rightSlot}
    </header>
  );
}
