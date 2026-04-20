"use client";

/**
 * Home - /
 * Workspace-first landing page for selecting a workspace, connecting providers, and entering recent sessions or team runs.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import type { RepoSelection } from "@/client/components/repo-picker";
import { RepoPicker } from "@/client/components/repo-picker";
import { OnboardingCard } from "@/client/components/home-page-sections";
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
import { collectAccessibleRepoPaths } from "@/client/utils/repo-validation";
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

function isTopLevelTeamRun(session: SessionInfo) {
  if (session.parentSessionId) return false;
  if (session.specialistId === "team-agent-lead") return true;
  if (session.role?.toUpperCase() !== "ROUTA") return false;

  const normalizedName = (session.name ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalizedName) return false;

  return (
    normalizedName.startsWith("team -")
    || normalizedName.startsWith("team run")
    || normalizedName.includes("team lead")
  );
}

function HomePageContent() {
  const router = useRouter();
  const workspacesHook = useWorkspaces();
  const acp = useAcp();
  const { t } = useTranslation();
  const searchParams = useSearchParams();

  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"providers" | "roles" | "specialists" | undefined>(undefined);
  const [preferredMode, setPreferredMode] = useState<OnboardingMode | null>(null);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [workspaceHomeData, setWorkspaceHomeData] = useState<Record<string, WorkspaceHomeData>>({});
  const [_recentSessionsLoading, setRecentSessionsLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const { codebases, fetchCodebases } = useCodebases(activeWorkspaceId ?? "");
  const [showRepoPickerForHome, setShowRepoPickerForHome] = useState(false);
  const [accessibleCodebasePaths, setAccessibleCodebasePaths] = useState<Set<string>>(new Set());

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
    const requestedWorkspaceId = searchParams.get("workspace");
    if (requestedWorkspaceId && workspacesHook.workspaces.some((workspace) => workspace.id === requestedWorkspaceId)) {
      if (activeWorkspaceId !== requestedWorkspaceId) {
        setActiveWorkspaceId(requestedWorkspaceId);
      }
      return;
    }

    if (!activeWorkspaceId && workspacesHook.workspaces.length > 0) {
      setActiveWorkspaceId(workspacesHook.workspaces[0].id);
    }
  }, [activeWorkspaceId, searchParams, workspacesHook.workspaces]);

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

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const nextPaths = await collectAccessibleRepoPaths(codebases.map((codebase) => codebase.repoPath));
      if (!cancelled) {
        setAccessibleCodebasePaths(nextPaths);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [codebases]);

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

  const activeWorkspace = workspacesHook.workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const requestedSurfaceId = searchParams.get("mode");
  const activeData = activeWorkspaceId ? (workspaceHomeData[activeWorkspaceId] ?? EMPTY_HOME_DATA) : EMPTY_HOME_DATA;
  const recentSessions = useMemo(() => (
    [...activeData.sessions]
      .filter((session) => !isTopLevelTeamRun(session))
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 3)
  ), [activeData.sessions]);
  const latestSession = recentSessions[0] ?? null;
  const hasCodebase = codebases.some((codebase) => accessibleCodebasePaths.has(codebase.repoPath));

  const hasWorkspace = workspacesHook.workspaces.length > 0;
  const hasProviderConfig =
    hydrated
      ? hasSavedProviderConfiguration(loadDefaultProviders(), loadProviderConnections(), {
        dockerOpencodeAuthJson: loadDockerOpencodeAuthJson(),
        customProviderCount: loadCustomAcpProviders().length,
        runtimeProviderCount: acp.providers.filter((provider) => provider.status === "available").length,
      })
      : false;
  const availableProviderNames = useMemo(
    () => acp.providers
      .filter((provider) => provider.status === "available")
      .map((provider) => provider.name)
      .slice(0, 3),
    [acp.providers],
  );
  const needsInlineOnboarding =
    hasWorkspace &&
    !onboardingCompleted &&
    (!hasProviderConfig || !hasCodebase || preferredMode === null);

  useEffect(() => {
    if (!activeWorkspaceId || !requestedSurfaceId) return;

    if (requestedSurfaceId === "session") {
      router.replace(`/workspace/${activeWorkspaceId}/sessions`);
      return;
    }

    if (requestedSurfaceId === "team") {
      router.replace(`/workspace/${activeWorkspaceId}/team`);
      return;
    }

    if (requestedSurfaceId === "planning") {
      router.replace(`/workspace/${activeWorkspaceId}/kanban`);
    }
  }, [activeWorkspaceId, requestedSurfaceId, router]);

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
                  availableProviderNames={availableProviderNames}
                  preferredMode={preferredMode}
                  onCreateWorkspace={handleWorkspaceCreate}
                  onOpenProviders={handleOpenProviders}
                  onAddCodebase={handleAddCodebase}
                  onSelectMode={handleModeSelect}
                />
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-6 py-8 lg:px-10 lg:py-10">
                  {workspacesHook.loading ? (
                    <div className="flex flex-1 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                      {t.home.loadingWorkspaces}
                    </div>
                  ) : (
                    <section className="flex flex-1 flex-col justify-center gap-6">
                      {/* Hero */}
                      <div className="text-center">
                        <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
                          {activeWorkspace?.title ?? t.common.workspace}
                        </div>
                        <h1 className="mt-3 font-['Avenir_Next_Condensed','Avenir_Next','Segoe_UI','Helvetica_Neue',sans-serif] text-4xl font-semibold tracking-[-0.04em] text-slate-900 dark:text-slate-100 sm:text-5xl">
                          {t.home.whatToAdvance}
                        </h1>
                        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-500 dark:text-slate-400">
                          {t.home.homePrimaryHint}
                        </p>
                      </div>

                      {/* Onboarding hint (if needed) */}
                      {needsInlineOnboarding && (
                        <OnboardingCard
                          hasWorkspace
                          workspaceTitle={activeWorkspace?.title ?? null}
                          hasProviderConfig={hasProviderConfig}
                          hasCodebase={hasCodebase}
                          availableProviderNames={availableProviderNames}
                          preferredMode={preferredMode}
                          onCreateWorkspace={handleWorkspaceCreate}
                          onOpenProviders={handleOpenProviders}
                          onAddCodebase={handleAddCodebase}
                          onSelectMode={handleModeSelect}
                          onDismiss={handleDismissOnboarding}
                        />
                      )}

                      {activeWorkspaceId ? (
                        <div className="grid gap-4 sm:grid-cols-3">
                          <Link
                            href={`/workspace/${activeWorkspaceId}/sessions`}
                            className="flex h-full flex-col rounded-3xl border border-black/6 bg-white/80 p-5 text-left transition-colors hover:bg-white dark:border-white/8 dark:bg-white/5 dark:hover:bg-white/10"
                          >
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                              {t.home.surfaceLabel}
                            </div>
                            <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                              {t.home.sessionsSurfaceTitle}
                            </div>
                            <div className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                              {t.home.modeSessionDescription}
                            </div>
                            <div className="mt-4 border-t border-black/6 pt-3 dark:border-white/8">
                              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                                {t.home.modeTechnicalLabel}
                              </div>
                              <div className="mt-1 text-xs leading-5 text-slate-400 dark:text-slate-500">
                                {t.home.modeSessionTechnical}
                              </div>
                            </div>
                          </Link>
                          <Link
                            href={`/workspace/${activeWorkspaceId}/kanban`}
                            className="flex h-full flex-col rounded-3xl border border-black/6 bg-white/80 p-5 text-left transition-colors hover:bg-white dark:border-white/8 dark:bg-white/5 dark:hover:bg-white/10"
                          >
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                              {t.home.surfaceLabel}
                            </div>
                            <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                              {t.home.kanbanSurfaceTitle}
                            </div>
                            <div className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                              {t.home.modeKanbanDescription}
                            </div>
                            <div className="mt-4 border-t border-black/6 pt-3 dark:border-white/8">
                              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                                {t.home.modeTechnicalLabel}
                              </div>
                              <div className="mt-1 text-xs leading-5 text-slate-400 dark:text-slate-500">
                                {t.home.modeKanbanTechnical}
                              </div>
                            </div>
                          </Link>
                          <Link
                            href={`/workspace/${activeWorkspaceId}/team`}
                            className="flex h-full flex-col rounded-3xl border border-black/6 bg-white/80 p-5 text-left transition-colors hover:bg-white dark:border-white/8 dark:bg-white/5 dark:hover:bg-white/10"
                          >
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                              {t.home.surfaceLabel}
                            </div>
                            <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                              {t.home.teamSurfaceTitle}
                            </div>
                            <div className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                              {t.home.modeTeamDescription}
                            </div>
                            <div className="mt-4 border-t border-black/6 pt-3 dark:border-white/8">
                              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                                {t.home.modeTechnicalLabel}
                              </div>
                              <div className="mt-1 text-xs leading-5 text-slate-400 dark:text-slate-500">
                                {t.home.modeTeamTechnical}
                              </div>
                            </div>
                          </Link>
                        </div>
                      ) : null}

                      {/* Readiness checklist */}
                      <div className="rounded-[20px] border border-black/6 bg-white/80 px-5 py-4 dark:border-white/8 dark:bg-white/5">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                          {t.home.readinessTitle}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={handleOpenProviders}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                              hasProviderConfig
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-400"
                                : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-400"
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${hasProviderConfig ? "bg-emerald-500" : "bg-amber-400"}`} />
                            {t.home.readinessModel}
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowRepoPickerForHome(true)}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                              hasCodebase
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-400"
                                : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-400"
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${hasCodebase ? "bg-emerald-500" : "bg-amber-400"}`} />
                            {t.home.readinessCodebase}
                          </button>
                          <span
                            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-400"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            {t.home.readinessWorkspace}
                          </span>
                        </div>
                        {showRepoPickerForHome && (
                          <div className="mt-4 border-t border-black/6 pt-4 dark:border-white/8">
                            <div className="mb-2 flex items-center justify-between">
                              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                {t.home.readinessCodebase}
                              </span>
                              <button
                                type="button"
                                onClick={() => setShowRepoPickerForHome(false)}
                                className="text-[11px] text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
                              >
                                {t.common.cancel}
                              </button>
                            </div>
                            <RepoPicker
                              value={null}
                              onChange={async (selection) => {
                                if (selection) {
                                  await handleAddCodebase(selection);
                                  setShowRepoPickerForHome(false);
                                }
                              }}
                            />
                          </div>
                        )}
                      </div>

                      {/* Continue recent work */}
                      {(recentSessions.length > 0 || activeWorkspaceId) && (
                        <div className="rounded-[20px] border border-black/6 bg-white/80 px-5 py-4 dark:border-white/8 dark:bg-white/5">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                            {t.home.continueWork}
                          </div>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {activeWorkspaceId && (
                              <Link
                                href={`/workspace/${activeWorkspaceId}/sessions`}
                                className="flex flex-col rounded-2xl border border-black/6 bg-[#faf9f4] p-4 transition-colors hover:bg-white dark:border-white/8 dark:bg-white/4 dark:hover:bg-white/8"
                              >
                                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                  {t.nav.sessions}
                                </div>
                                <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                  {t.workspace.recoverSession}
                                </div>
                              </Link>
                            )}
                            {activeWorkspaceId && (
                              <Link
                                href={`/workspace/${activeWorkspaceId}/kanban`}
                                className="flex flex-col rounded-2xl border border-black/6 bg-[#faf9f4] p-4 transition-colors hover:bg-white dark:border-white/8 dark:bg-white/4 dark:hover:bg-white/8"
                              >
                                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                  {t.home.continueBoard}
                                </div>
                                <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                  {activeWorkspace?.title ?? t.common.workspace}
                                </div>
                              </Link>
                            )}
                            {latestSession && (
                              <Link
                                href={`/workspace/${latestSession.workspaceId}/sessions/${latestSession.sessionId}`}
                                className="flex flex-col rounded-2xl border border-black/6 bg-[#faf9f4] p-4 transition-colors hover:bg-white dark:border-white/8 dark:bg-white/4 dark:hover:bg-white/8"
                              >
                                <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                  {getSessionLabel(latestSession)}
                                </div>
                                <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                  {formatRelativeTime(latestSession.createdAt, hydrated)}
                                </div>
                              </Link>
                            )}
                          </div>
                        </div>
                      )}
                    </section>
                  )}
                </div>
              </div>
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

export default function HomePage() {
  return (
    <Suspense fallback={(
      <div className="desktop-theme flex h-screen items-center justify-center bg-desktop-bg-primary">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-desktop-accent border-t-transparent" />
          <p className="text-sm text-desktop-text-secondary">Loading...</p>
        </div>
      </div>
    )}>
      <HomePageContent />
    </Suspense>
  );
}
