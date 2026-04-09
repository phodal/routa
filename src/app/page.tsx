"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";

import type { RepoSelection } from "@/client/components/repo-picker";
import { OnboardingCard } from "@/client/components/home-page-sections";
import { HomeInput } from "@/client/components/home-input";
import {
  SettingsPanel,
  loadDefaultProviders,
  loadDockerOpencodeAuthJson,
  loadProviderConnections,
} from "@/client/components/settings-panel";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { useAcp } from "@/client/hooks/use-acp";
import { useCodebases, useWorkspaces } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { loadCustomAcpProviders } from "@/client/utils/custom-acp-providers";
import {
  clearOnboardingState,
  ONBOARDING_COMPLETED_KEY,
  ONBOARDING_MODE_KEY,
  hasSavedProviderConfiguration,
  parseOnboardingMode,
  type OnboardingMode,
} from "@/client/utils/onboarding";
import { useTranslation } from "@/i18n";
import type { SessionInfo } from "@/app/workspace/[workspaceId]/types";

interface WorkspaceHomeData {
  sessions: SessionInfo[];
}

const EMPTY_HOME_DATA: WorkspaceHomeData = {
  sessions: [],
};

function formatRelativeTime(value: string | undefined, hydrated: boolean) {
  if (!value) return "刚刚";
  if (!hydrated) return "刚刚";
  const diffMs = Date.now() - new Date(value).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function getSessionLabel(session: SessionInfo) {
  if (session.name) return session.name;
  if (session.provider && session.role) return `${session.provider} · ${session.role.toLowerCase()}`;
  if (session.provider) return session.provider;
  return `会话 ${session.sessionId.slice(0, 8)}`;
}

export default function HomePage() {
  const workspacesHook = useWorkspaces();
  const acp = useAcp();
  const { t } = useTranslation();

  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"providers" | "roles" | "specialists" | undefined>(undefined);
  const [preferredMode, setPreferredMode] = useState<OnboardingMode | null>(null);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [workspaceHomeData, setWorkspaceHomeData] = useState<Record<string, WorkspaceHomeData>>({});
  const [recentSessionsLoading, setRecentSessionsLoading] = useState(false);
  const [showAdvancedLauncher, setShowAdvancedLauncher] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const { codebases, fetchCodebases } = useCodebases(activeWorkspaceId ?? "");

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!acp.connected && !acp.loading) {
      acp.connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acp.connected, acp.loading]);

  useEffect(() => {
    if (!activeWorkspaceId && workspacesHook.workspaces.length > 0) {
      setActiveWorkspaceId(workspacesHook.workspaces[0].id);
    }
  }, [activeWorkspaceId, workspacesHook.workspaces]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setOnboardingCompleted(window.localStorage.getItem(ONBOARDING_COMPLETED_KEY) === "true");
    setPreferredMode(parseOnboardingMode(window.localStorage.getItem(ONBOARDING_MODE_KEY)));
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId || workspaceHomeData[activeWorkspaceId]) {
      return;
    }

    let cancelled = false;
    setRecentSessionsLoading(true);

    (async () => {
      try {
        const sessionsRes = await desktopAwareFetch(
          `/api/sessions?workspaceId=${encodeURIComponent(activeWorkspaceId)}&limit=6`,
          { cache: "no-store" },
        );

        const sessionsData = await sessionsRes.json().catch(() => ({}));

        if (cancelled) return;

        setWorkspaceHomeData((current) => ({
          ...current,
          [activeWorkspaceId]: {
            sessions: Array.isArray(sessionsData?.sessions) ? sessionsData.sessions : [],
          },
        }));
      } catch {
        if (cancelled) return;
        setWorkspaceHomeData((current) => ({
          ...current,
          [activeWorkspaceId]: EMPTY_HOME_DATA,
        }));
      } finally {
        if (!cancelled) {
          setRecentSessionsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, workspaceHomeData]);

  const handleWorkspaceCreate = useCallback(async (title: string) => {
    const workspace = await workspacesHook.createWorkspace(title);
    if (workspace) {
      setActiveWorkspaceId(workspace.id);
      return true;
    }
    return false;
  }, [workspacesHook]);

  const handleOpenProviders = useCallback(() => {
    setSettingsInitialTab("providers");
    setShowSettingsPanel(true);
  }, []);

  const handleModeSelect = useCallback((mode: OnboardingMode) => {
    setPreferredMode(mode);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ONBOARDING_MODE_KEY, mode);
    }
  }, []);

  const handleDismissOnboarding = useCallback(() => {
    setOnboardingCompleted(true);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
    }
  }, []);

  const handleResetOnboarding = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    clearOnboardingState(window.localStorage);
    setOnboardingCompleted(false);
    setPreferredMode(null);
  }, []);

  const handleAddCodebase = useCallback(async (selection: RepoSelection) => {
    const targetWorkspaceId = activeWorkspaceId ?? workspacesHook.workspaces[0]?.id;
    if (!targetWorkspaceId) {
      return false;
    }

    const response = await desktopAwareFetch(`/api/workspaces/${encodeURIComponent(targetWorkspaceId)}/codebases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoPath: selection.path,
        branch: selection.branch || undefined,
        label: selection.name || undefined,
      }),
    });

    if (response.ok) {
      await fetchCodebases();
      return true;
    }

    return false;
  }, [activeWorkspaceId, fetchCodebases, workspacesHook.workspaces]);

  useEffect(() => {
    setShowAdvancedLauncher(false);
  }, [activeWorkspaceId]);

  const activeWorkspace = workspacesHook.workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const activeData = activeWorkspaceId ? (workspaceHomeData[activeWorkspaceId] ?? EMPTY_HOME_DATA) : EMPTY_HOME_DATA;
  const recentSessions = useMemo(() => (
    [...activeData.sessions].sort((left, right) => (
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    )).slice(0, 3)
  ), [activeData.sessions]);
  const latestSession = recentSessions[0] ?? null;
  const hasCodebase = codebases.length > 0;
  const settingsHarnessHref = activeWorkspaceId
    ? `/settings/harness?workspaceId=${encodeURIComponent(activeWorkspaceId)}`
    : "/settings/harness";
  const settingsFluencyHref = activeWorkspaceId
    ? `/settings/fluency?workspaceId=${encodeURIComponent(activeWorkspaceId)}`
    : "/settings/fluency";
  const teamHref = activeWorkspaceId ? `/workspace/${activeWorkspaceId}/team` : "/";

  const hasWorkspace = workspacesHook.workspaces.length > 0;
  const hasProviderConfig =
    hydrated
      ? hasSavedProviderConfiguration(loadDefaultProviders(), loadProviderConnections(), {
        dockerOpencodeAuthJson: loadDockerOpencodeAuthJson(),
        customProviderCount: loadCustomAcpProviders().length,
      })
      : false;
  const needsInlineOnboarding =
    hasWorkspace &&
    !onboardingCompleted &&
    (!hasProviderConfig || preferredMode === null);

  return (
    <DesktopAppShell
      workspaceId={activeWorkspaceId}
      workspaceTitle={activeWorkspace?.title ?? undefined}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspacesHook.workspaces}
          activeWorkspaceId={activeWorkspaceId}
          activeWorkspaceTitle={activeWorkspace?.title ?? undefined}
          onSelect={setActiveWorkspaceId}
          onCreate={async (title) => {
            await handleWorkspaceCreate(title);
          }}
          loading={workspacesHook.loading}
          compact
          desktop
        />
      )}
    >
        <div className="flex h-full min-h-0 bg-[#f6f4ef] dark:bg-[#0c1118]">
          <main className="flex min-w-0 flex-1 flex-col">
            {!hasWorkspace ? (
              <div className="flex min-h-0 flex-1 items-center justify-center p-6">
                <OnboardingCard
                  hasWorkspace={false}
                  workspaceTitle={null}
                  hasProviderConfig={hasProviderConfig}
                  hasCodebase={false}
                  preferredMode={preferredMode}
                  onCreateWorkspace={handleWorkspaceCreate}
                  onOpenProviders={handleOpenProviders}
                  onAddCodebase={handleAddCodebase}
                  onSelectMode={handleModeSelect}
                />
              </div>
            ) : (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-6 py-8 lg:px-10 lg:py-10">
                    {workspacesHook.loading ? (
                      <div className="flex flex-1 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                        {t.home.loadingWorkspaces}
                      </div>
                    ) : (
                      <>
                        {needsInlineOnboarding && (
                          <div className="mb-6">
                            <OnboardingCard
                              hasWorkspace
                              workspaceTitle={activeWorkspace?.title ?? null}
                              hasProviderConfig={hasProviderConfig}
                              hasCodebase={hasCodebase}
                              preferredMode={preferredMode}
                              onCreateWorkspace={handleWorkspaceCreate}
                              onOpenProviders={handleOpenProviders}
                              onAddCodebase={handleAddCodebase}
                              onSelectMode={handleModeSelect}
                              onDismiss={handleDismissOnboarding}
                            />
                          </div>
                        )}

                        <section className="flex flex-1 flex-col justify-center">
                          <div className="mx-auto w-full max-w-3xl text-center">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                              {t.home.subtitle}
                            </div>
                            <div className="mt-4 text-sm font-medium text-slate-500 dark:text-slate-400">
                              {activeWorkspace?.title ?? t.common.workspace}
                            </div>
                            <h1 className="mt-4 font-['Avenir_Next_Condensed','Avenir_Next','Segoe_UI','Helvetica_Neue',sans-serif] text-5xl font-semibold tracking-[-0.05em] text-slate-900 dark:text-slate-100 sm:text-6xl">
                              {t.home.heroTitle}
                            </h1>
                            <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-slate-600 dark:text-slate-300">
                              {t.home.heroDescription}
                            </p>
                          </div>

                          <div className="mx-auto mt-10 grid w-full max-w-4xl gap-4 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)]">
                            <Link
                              href={activeWorkspaceId ? `/workspace/${activeWorkspaceId}/kanban` : "/"}
                              className="rounded-[28px] border border-[#9ec88e] bg-[#f6fbf2] p-5 text-left shadow-[0_22px_60px_-44px_rgba(15,23,42,0.35)] transition-colors hover:bg-white dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/25"
                            >
                              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                                {t.nav.kanban}
                              </div>
                              <div className="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
                                {t.home.openKanban}
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                {t.home.openKanbanDescription}
                              </p>
                            </Link>
                            <Link
                              href={activeWorkspaceId ? `/workspace/${activeWorkspaceId}/overview` : "/"}
                              className="rounded-[26px] border border-black/6 bg-white/80 p-5 text-left transition-colors hover:bg-white dark:border-white/8 dark:bg-white/5 dark:hover:bg-white/8"
                            >
                              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                                {t.nav.overview}
                              </div>
                              <div className="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
                                {t.home.workspaceOverview}
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                {t.home.workspaceOverviewDescription}
                              </p>
                            </Link>
                            <button
                              type="button"
                              onClick={() => {
                                setSettingsInitialTab(undefined);
                                setShowSettingsPanel(true);
                              }}
                              className="rounded-[26px] border border-black/6 bg-white/80 p-5 text-left transition-colors hover:bg-white dark:border-white/8 dark:bg-white/5 dark:hover:bg-white/8"
                            >
                              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                                {t.settings.title}
                              </div>
                              <div className="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
                                {t.home.checkEnvironment}
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                {t.home.checkEnvironmentDescription}
                              </p>
                            </button>
                          </div>

                          <section className="mx-auto mt-8 w-full max-w-4xl rounded-[28px] border border-black/6 bg-white/82 p-5 dark:border-white/8 dark:bg-white/5">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                                  {t.home.recentWorkTitle}
                                </div>
                                <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                  {t.home.recentWorkDescription}
                                </div>
                              </div>
                              {latestSession ? (
                                <Link
                                  href={`/workspace/${latestSession.workspaceId}/sessions/${latestSession.sessionId}`}
                                  className="inline-flex rounded-full border border-black/8 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700 transition-colors hover:bg-slate-50 dark:border-white/8 dark:bg-white/6 dark:text-slate-200 dark:hover:bg-white/10"
                                >
                                  {t.home.resumeLatestSession}
                                </Link>
                              ) : null}
                            </div>

                            <div className="mt-4 space-y-3">
                              {recentSessionsLoading && recentSessions.length === 0 ? (
                                <div className="rounded-[22px] border border-dashed border-black/10 px-4 py-8 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                                  {t.common.loading}
                                </div>
                              ) : recentSessions.length > 0 ? (
                                recentSessions.map((session) => (
                                  <Link
                                    key={session.sessionId}
                                    href={`/workspace/${session.workspaceId}/sessions/${session.sessionId}`}
                                    className="block rounded-[20px] border border-black/6 bg-[#faf9f4] p-4 transition-colors hover:bg-white dark:border-white/8 dark:bg-white/4 dark:hover:bg-white/8"
                                  >
                                    <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                      {getSessionLabel(session)}
                                    </div>
                                    <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                                      <span>{formatRelativeTime(session.createdAt, hydrated)}</span>
                                      {session.branch ? (
                                        <>
                                          <span>·</span>
                                          <span className="truncate">{session.branch}</span>
                                        </>
                                      ) : null}
                                    </div>
                                  </Link>
                                ))
                              ) : (
                                <div className="rounded-[22px] border border-dashed border-black/10 px-4 py-8 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                                  {t.home.noRecentSessions}
                                </div>
                              )}
                            </div>
                          </section>

                          <section className="mx-auto mt-6 w-full max-w-4xl">
                            <button
                              type="button"
                              onClick={() => setShowAdvancedLauncher((current) => !current)}
                              className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700 transition-colors hover:bg-slate-50 dark:border-white/8 dark:bg-white/6 dark:text-slate-200 dark:hover:bg-white/10"
                            >
                              {showAdvancedLauncher ? t.home.hideAdvancedMode : t.home.showAdvancedMode}
                              {showAdvancedLauncher ? (
                                <ChevronUp className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} />
                              ) : (
                                <ChevronDown className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} />
                              )}
                            </button>

                            {showAdvancedLauncher ? (
                              <div className="mt-4 rounded-[28px] border border-black/6 bg-white/82 p-5 dark:border-white/8 dark:bg-white/5">
                                <div>
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                                    {t.nav.advanced}
                                  </div>
                                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                                    {t.home.advancedModeDescription}
                                  </p>
                                </div>

                                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                                  <Link href={teamHref} className="rounded-[20px] border border-black/6 bg-[#faf9f4] px-4 py-4 text-sm font-semibold text-slate-900 transition-colors hover:bg-white dark:border-white/8 dark:bg-white/4 dark:text-slate-100 dark:hover:bg-white/8">
                                    {t.nav.team}
                                  </Link>
                                  <Link href={settingsHarnessHref} className="rounded-[20px] border border-black/6 bg-[#faf9f4] px-4 py-4 text-sm font-semibold text-slate-900 transition-colors hover:bg-white dark:border-white/8 dark:bg-white/4 dark:text-slate-100 dark:hover:bg-white/8">
                                    {t.nav.harness}
                                  </Link>
                                  <Link href={settingsFluencyHref} className="rounded-[20px] border border-black/6 bg-[#faf9f4] px-4 py-4 text-sm font-semibold text-slate-900 transition-colors hover:bg-white dark:border-white/8 dark:bg-white/4 dark:text-slate-100 dark:hover:bg-white/8">
                                    {t.nav.fluency}
                                  </Link>
                                  <Link href="/settings/workflows" className="rounded-[20px] border border-black/6 bg-[#faf9f4] px-4 py-4 text-sm font-semibold text-slate-900 transition-colors hover:bg-white dark:border-white/8 dark:bg-white/4 dark:text-slate-100 dark:hover:bg-white/8">
                                    {t.nav.workflows}
                                  </Link>
                                  <Link href="/settings/specialists" className="rounded-[20px] border border-black/6 bg-[#faf9f4] px-4 py-4 text-sm font-semibold text-slate-900 transition-colors hover:bg-white dark:border-white/8 dark:bg-white/4 dark:text-slate-100 dark:hover:bg-white/8">
                                    {t.nav.specialists}
                                  </Link>
                                </div>

                                <div className="mt-5 border-t border-black/6 pt-5 dark:border-white/8">
                                  <HomeInput
                                    workspaceId={activeWorkspaceId ?? undefined}
                                    variant="default"
                                    defaultAgentRole={preferredMode === "CRAFTER" ? "CRAFTER" : "ROUTA"}
                                    buildSessionUrl={(nextWorkspaceId, sessionId) =>
                                      `/workspace/${nextWorkspaceId ?? activeWorkspaceId}/sessions/${sessionId}`
                                    }
                                  />
                                </div>
                              </div>
                            ) : null}
                          </section>
                        </section>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </main>
        </div>

        <SettingsPanel
          open={showSettingsPanel}
          onClose={() => setShowSettingsPanel(false)}
          providers={acp.providers}
          initialTab={settingsInitialTab}
          onResetOnboarding={handleResetOnboarding}
        />
      </DesktopAppShell>
  );
}
