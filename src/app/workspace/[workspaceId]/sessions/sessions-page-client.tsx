"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PieChart } from "lucide-react";

import { HomeInput } from "@/client/components/home-input";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";

import { SessionsOverview } from "../sessions-overview";
import type { SessionInfo } from "../types";
import { formatRelativeTime } from "../ui-components";

const TEAM_LEAD_SPECIALIST_ID = "team-agent-lead";

function isTopLevelTeamRun(session: SessionInfo): boolean {
  if (session.parentSessionId) return false;
  if (session.specialistId === TEAM_LEAD_SPECIALIST_ID) return true;
  if (session.role?.toUpperCase() !== "ROUTA") return false;

  const normalizedName = (session.name ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalizedName) return false;

  return (
    normalizedName.startsWith("team -")
    || normalizedName.startsWith("team run")
    || normalizedName.includes("team lead")
  );
}

function getSessionLabel(session: SessionInfo) {
  if (session.name) return session.name;
  if (session.provider && session.role) return `${session.provider} · ${session.role.toLowerCase()}`;
  if (session.provider) return session.provider;
  return `Session ${session.sessionId.slice(0, 8)}`;
}

export function SessionsPageClient() {
  const { t } = useTranslation();
  const params = useParams();
  const router = useRouter();
  const rawWorkspaceId = params.workspaceId as string;
  const workspaceId =
    rawWorkspaceId === "__placeholder__" && typeof window !== "undefined"
      ? (window.location.pathname.match(/^\/workspace\/([^/]+)/)?.[1] ?? rawWorkspaceId)
      : rawWorkspaceId;

  const workspacesHook = useWorkspaces();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const shouldShowSession = useCallback((session: SessionInfo & { parentSessionId?: string }) => !isTopLevelTeamRun(session), []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await desktopAwareFetch(`/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}&limit=100`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
      } catch {
        if (controller.signal.aborted) return;
        setSessions([]);
      }
    })();
    return () => controller.abort();
  }, [workspaceId, refreshKey]);

  const visibleSessions = useMemo(() => (
    [...sessions]
      .filter(shouldShowSession)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
  ), [sessions, shouldShowSession]);

  const workspace = workspacesHook.workspaces.find((item) => item.id === workspaceId);
  const latestSession = visibleSessions[0] ?? null;
  const liveSessions = visibleSessions.filter((session) => session.acpStatus === "connecting" || session.acpStatus === "ready").length;

  const handleWorkspaceSelect = useCallback((nextWorkspaceId: string) => {
    router.push(`/workspace/${nextWorkspaceId}/sessions`);
  }, [router]);

  const handleWorkspaceCreate = useCallback(async (title: string) => {
    const workspaceResult = await workspacesHook.createWorkspace(title);
    if (workspaceResult) {
      router.push(`/workspace/${workspaceResult.id}/sessions`);
    }
  }, [router, workspacesHook]);

  const handleRefresh = useCallback(() => {
    setRefreshKey((current) => current + 1);
  }, []);

  if (workspacesHook.loading && workspaceId !== "default") {
    return (
      <div className="desktop-theme flex h-screen items-center justify-center bg-desktop-bg-primary">
        <div className="flex items-center gap-3 text-desktop-text-secondary">
          <PieChart className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24" />
          {t.sessions.loadingSessions}
        </div>
      </div>
    );
  }

  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceTitle={workspace?.title ?? (workspaceId === "default" ? t.workspace.defaultWorkspace : workspaceId)}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspacesHook.workspaces}
          activeWorkspaceId={workspaceId}
          activeWorkspaceTitle={workspace?.title ?? (workspaceId === "default" ? t.workspace.defaultWorkspace : workspaceId)}
          onSelect={handleWorkspaceSelect}
          onCreate={handleWorkspaceCreate}
          loading={workspacesHook.loading}
          compact
          desktop
        />
      )}
    >
      <div className="flex h-full min-h-0 bg-[#f6f4ef] dark:bg-[#0c1118]">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-6 py-8 lg:px-10 lg:py-10">
              <section className="flex flex-1 flex-col justify-center">
                <div className="mx-auto w-full max-w-3xl text-center">
                  <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
                    {workspace?.title ?? t.common.workspace}
                  </div>
                  <h1 className="mt-4 font-['Avenir_Next_Condensed','Avenir_Next','Segoe_UI','Helvetica_Neue',sans-serif] text-5xl font-semibold tracking-[-0.05em] text-slate-900 dark:text-slate-100 sm:text-6xl">
                    {t.nav.sessions}
                  </h1>
                  <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-slate-600 dark:text-slate-300">
                    {t.workspace.recoverSession}
                  </p>
                </div>

                <div className="mx-auto mt-8 flex w-full max-w-3xl flex-wrap items-center justify-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                  <div className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-white/75 px-4 py-2 dark:border-white/10 dark:bg-white/5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">{t.workspace.sessions}</span>
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{visibleSessions.length}</span>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-white/75 px-4 py-2 dark:border-white/10 dark:bg-white/5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">{t.workspace.active}</span>
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{liveSessions}</span>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-white/75 px-4 py-2 dark:border-white/10 dark:bg-white/5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">{t.workspace.latestRecoveryPoint}</span>
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {latestSession ? formatRelativeTime(latestSession.createdAt) : t.workspace.noRecentSession}
                    </span>
                  </div>
                </div>
              </section>
            </div>
          </div>

          <div className="border-t border-black/6 bg-[#f3f1eb]/92 px-4 py-4 dark:border-white/8 dark:bg-[#0f141c]/92">
            <div className="mx-auto w-full max-w-4xl">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                    {t.home.modeSessionTitle}
                  </div>
                  <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {t.home.modeSessionDescription}
                  </div>
                </div>
                {latestSession ? (
                  <button
                    type="button"
                    onClick={() => router.push(`/workspace/${workspaceId}/sessions/${latestSession.sessionId}`)}
                    className="rounded-full border border-black/8 bg-white/90 px-3 py-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                  >
                    {getSessionLabel(latestSession)}
                  </button>
                ) : null}
              </div>
              <HomeInput
                workspaceId={workspaceId}
                variant="default"
                launchModes={[{
                  id: "session",
                  label: t.home.modeSessionTitle,
                  description: t.home.modeSessionDescription,
                  placeholder: t.home.modeSessionPlaceholder,
                  defaultAgentRole: "ROUTA",
                  allowRoleSwitch: true,
                  allowCustomSpecialist: true,
                  dispatchMode: "pending-prompt",
                  buildSessionUrl: (nextWorkspaceId, sessionId) =>
                    `/workspace/${nextWorkspaceId ?? workspaceId}/sessions/${sessionId}`,
                }]}
              />
            </div>
          </div>
        </main>

        <aside className="hidden w-90 shrink-0 border-l border-black/6 bg-[#efede6] px-4 py-4 dark:border-white/8 dark:bg-[#11161f] xl:flex xl:flex-col">
          <SessionsOverview
            sessions={visibleSessions}
            workspaceId={workspaceId}
            onNavigate={(targetSessionId) => router.push(`/workspace/${workspaceId}/sessions/${targetSessionId}`)}
            onRefresh={handleRefresh}
            filterSession={shouldShowSession}
          />
        </aside>
      </div>
    </DesktopAppShell>
  );
}