"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ExternalLink, RefreshCw } from "lucide-react";
import { useTranslation } from "@/i18n";
import type { SessionInfo } from "../../types";

interface TeamRunPageHeaderProps {
  workspaceId: string;
  selectedSessionId: string;
  selectedSessionName: string;
  teamRuns: SessionInfo[];
  isSwitchingTeamRun: boolean;
  backLabel: string;
  refreshLabel: string;
  openLabel: string;
  activeLabel: string;
  waitingLabel: string;
  onRefresh: () => void;
  onSwitchTeamRun: (sessionId: string) => void;
}

export function TeamRunPageHeader({
  workspaceId,
  selectedSessionId,
  selectedSessionName,
  teamRuns,
  isSwitchingTeamRun,
  backLabel,
  refreshLabel,
  openLabel,
  activeLabel,
  waitingLabel,
  onRefresh,
  onSwitchTeamRun,
}: TeamRunPageHeaderProps) {
  const { t } = useTranslation();
  const [showTeamRunMenu, setShowTeamRunMenu] = useState(false);
  const teamRunSwitcherRef = useRef<HTMLDivElement | null>(null);
  const selectedTeamRun = teamRuns.find((run) => run.sessionId === selectedSessionId) ?? teamRuns[0];
  const canSwitchTeamRun = teamRuns.length > 1;

  const normalizedTeamRunTitle = (selectedTeamRun?.name ?? selectedSessionName)
    .replace(/^\s*team\s*run\s*[-:：]?\s*/i, "")
    .replace(/^\s*team\s+[-:：]?\s*/i, "")
    .trim() || t.team.teamRuns;

  useEffect(() => {
    if (!teamRunSwitcherRef.current) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!teamRunSwitcherRef.current?.contains(event.target as Node)) {
        setShowTeamRunMenu(false);
      }
    };

    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="shrink-0 border-b border-desktop-border bg-desktop-bg-tertiary" data-testid="team-run-page-header">
      <div className="flex h-11 w-full items-center justify-between gap-2 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/workspace/${workspaceId}/team`}
            className="inline-flex shrink-0 h-8 w-8 items-center justify-center rounded-md border border-desktop-border bg-desktop-bg-secondary transition-colors hover:bg-desktop-bg-active/70 hover:text-desktop-text-primary"
            title={backLabel}
            aria-label={backLabel}
          >
            <ChevronLeft
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            />
            <span className="sr-only">{backLabel}</span>
          </Link>
          <div ref={teamRunSwitcherRef} className="relative min-w-0">
            <button
              type="button"
              onClick={() => setShowTeamRunMenu((current) => canSwitchTeamRun ? !current : false)}
              className="inline-flex min-w-0 max-w-[52vw] items-center gap-2 rounded-md border border-desktop-border bg-desktop-bg-secondary/80 px-2.5 py-1.5 text-left transition-colors hover:bg-desktop-bg-active/70"
              title={t.team.teamRuns}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[9px] uppercase tracking-[0.16em] text-desktop-text-muted">{t.team.teamRuns}</span>
                <span className="block truncate text-[12px] font-semibold text-desktop-text-primary">{normalizedTeamRunTitle}</span>
              </span>
              {canSwitchTeamRun ? (
                <ChevronDown
                  className={`h-3.5 w-3.5 text-desktop-text-secondary transition-transform ${showTeamRunMenu ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                />
              ) : null}
              {isSwitchingTeamRun ? (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-500" />
              ) : null}
            </button>
            {showTeamRunMenu && canSwitchTeamRun ? (
              <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-80 overflow-y-auto rounded-md border border-desktop-border bg-desktop-bg-secondary p-1 shadow-xl">
                {teamRuns.map((run) => {
                  const isActive = run.sessionId === selectedSessionId;
                  return (
                    <button
                      key={run.sessionId}
                      type="button"
                      onClick={() => {
                        if (run.sessionId !== selectedSessionId) {
                          onSwitchTeamRun(run.sessionId);
                        }
                        setShowTeamRunMenu(false);
                      }}
                      className={`mb-0.5 flex w-full items-center justify-between gap-2 rounded-[10px] px-2.5 py-2 text-left transition ${
                        isActive
                          ? "bg-desktop-bg-active text-desktop-text-primary"
                          : "text-desktop-text-secondary hover:bg-desktop-bg-primary"
                      }`}
                    >
                      <span className="truncate text-[11px] font-medium">{run.name ?? `Team run ${run.sessionId.slice(0, 8)}`}</span>
                      <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-desktop-text-muted">
                        {isActive ? activeLabel : waitingLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1.5 text-[11px] font-medium text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active/70 hover:text-desktop-text-primary"
          >
            <RefreshCw className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} />
            {refreshLabel}
          </button>
          <Link
            href={`/workspace/${workspaceId}/sessions/${selectedSessionId}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-transparent bg-desktop-accent px-2.5 py-1.5 text-[11px] font-medium text-desktop-accent-text transition-colors hover:brightness-110"
          >
            <ExternalLink className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} />
            {openLabel}
          </Link>
        </div>
      </div>
    </header>
  );
}
