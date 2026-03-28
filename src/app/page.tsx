"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

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
import { useWorkspaces } from "@/client/hooks/use-workspaces";
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
import type { KanbanBoardInfo, SessionInfo, TaskInfo } from "@/app/workspace/[workspaceId]/types";

interface WorkspaceHomeData {
  boards: KanbanBoardInfo[];
  sessions: SessionInfo[];
  tasks: TaskInfo[];
}

const EMPTY_HOME_DATA: WorkspaceHomeData = {
  boards: [],
  sessions: [],
  tasks: [],
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

function getTaskTone(task: TaskInfo) {
  const column = task.columnId?.toLowerCase() ?? "";
  if (column.includes("done") || task.status === "COMPLETED") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300";
  }
  if (column.includes("dev") || column.includes("doing") || task.status === "IN_PROGRESS") {
    return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300";
  }
  return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-300";
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
  const [workspaceHomeLoading, setWorkspaceHomeLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);

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
    setWorkspaceHomeLoading(true);

    (async () => {
      try {
        const [boardsRes, tasksRes, sessionsRes] = await Promise.all([
          desktopAwareFetch(`/api/kanban/boards?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
          desktopAwareFetch(`/api/tasks?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
          desktopAwareFetch(`/api/sessions?workspaceId=${encodeURIComponent(activeWorkspaceId)}&limit=8`, { cache: "no-store" }),
        ]);

        const [boardsData, tasksData, sessionsData] = await Promise.all([
          boardsRes.json().catch(() => ({})),
          tasksRes.json().catch(() => ({})),
          sessionsRes.json().catch(() => ({})),
        ]);

        if (cancelled) return;

        setWorkspaceHomeData((current) => ({
          ...current,
          [activeWorkspaceId]: {
            boards: Array.isArray(boardsData?.boards) ? boardsData.boards : [],
            tasks: Array.isArray(tasksData?.tasks) ? tasksData.tasks : [],
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
          setWorkspaceHomeLoading(false);
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

    return response.ok;
  }, [activeWorkspaceId, workspacesHook.workspaces]);

  const activeWorkspace = workspacesHook.workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const activeData = activeWorkspaceId ? (workspaceHomeData[activeWorkspaceId] ?? EMPTY_HOME_DATA) : EMPTY_HOME_DATA;
  const sortedBoards = useMemo(() => (
    [...activeData.boards].sort((left, right) => {
      const leftDate = left.updatedAt ?? left.createdAt;
      const rightDate = right.updatedAt ?? right.createdAt;
      return new Date(rightDate).getTime() - new Date(leftDate).getTime();
    })
  ), [activeData.boards]);
  const sortedTasks = useMemo(() => (
    [...activeData.tasks].sort((left, right) => {
      const leftDate = left.updatedAt ?? left.createdAt;
      const rightDate = right.updatedAt ?? right.createdAt;
      return new Date(rightDate).getTime() - new Date(leftDate).getTime();
    })
  ), [activeData.tasks]);
  const recentSessions = activeData.sessions.slice(0, 6);

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
                              hasCodebase={sortedBoards.length > 0}
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
                            <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
                              {activeWorkspace?.title ?? "工作区"}
                            </div>
                            <h1 className="mt-4 font-['Avenir_Next_Condensed','Avenir_Next','Segoe_UI','Helvetica_Neue',sans-serif] text-5xl font-semibold tracking-[-0.05em] text-slate-900 dark:text-slate-100 sm:text-6xl">
                              从看板开始，按任务推进。
                            </h1>
                            <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-slate-600 dark:text-slate-300">
                              工作区、看板、卡片和会话放在同一个入口。先决定现在要推进什么，再进入具体执行，不需要先跳进某个会话页。
                            </p>
                          </div>

                          <div className="mx-auto mt-10 grid w-full max-w-4xl gap-4 md:grid-cols-4">
                            <Link
                              href={activeWorkspaceId ? `/workspace/${activeWorkspaceId}/kanban` : "/"}
                              className="rounded-[26px] border border-black/6 bg-white/80 p-5 text-left transition-colors hover:bg-white dark:border-white/8 dark:bg-white/5 dark:hover:bg-white/8"
                            >
                              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                                看板
                              </div>
                              <div className="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
                                打开当前看板
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                查看卡片流转、自动化状态和列配置。
                              </p>
                            </Link>
                            <Link
                              href={activeWorkspaceId ? `/workspace/${activeWorkspaceId}` : "/"}
                              className="rounded-[26px] border border-black/6 bg-white/80 p-5 text-left transition-colors hover:bg-white dark:border-white/8 dark:bg-white/5 dark:hover:bg-white/8"
                            >
                              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                                概览
                              </div>
                              <div className="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
                                查看工作区概览
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                聚合最近运行、任务密度和恢复入口。
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
                                设置
                              </div>
                              <div className="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
                                检查运行环境
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                连接模型、切换角色，确认工作区已经可执行。
                              </p>
                            </button>
                            <Link
                              href="/settings/harness"
                              className="rounded-[26px] border border-black/6 bg-white/80 p-5 text-left transition-colors hover:bg-white dark:border-white/8 dark:bg-white/5 dark:hover:bg-white/8"
                            >
                              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                                Harness
                              </div>
                              <div className="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
                                AI 工程体检
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                运行并对比 Generic 与 Agent Orchestrator 两套 profile。
                              </p>
                            </Link>
                          </div>

                          <section className="mx-auto mt-10 grid w-full max-w-4xl gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                            <div className="rounded-[28px] border border-black/6 bg-white/82 p-5 dark:border-white/8 dark:bg-white/5">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                                    最近看板
                                  </div>
                                  <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                    优先继续已经在推进的看板。
                                  </div>
                                </div>
                                <Link
                                  href={activeWorkspaceId ? `/workspace/${activeWorkspaceId}/kanban` : "/"}
                                  className="text-xs font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                                >
                                  查看全部
                                </Link>
                              </div>

                              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                {workspaceHomeLoading && sortedBoards.length === 0 ? (
                                  Array.from({ length: 2 }).map((_, index) => (
                                    <div key={index} className="h-36 animate-pulse rounded-[22px] border border-black/6 bg-[#f1efe9] dark:border-white/8 dark:bg-white/5" />
                                  ))
                                ) : sortedBoards.length > 0 ? (
                                  sortedBoards.slice(0, 4).map((board) => {
                                    const taskCount = sortedTasks.filter((task) => task.boardId === board.id).length;
                                    const updatedAt = board.updatedAt ?? board.createdAt;

                                    return (
                                      <Link
                                        key={board.id}
                                        href={`/workspace/${board.workspaceId}/kanban`}
                                        className="rounded-[22px] border border-black/6 bg-[#faf9f4] p-4 transition-colors hover:bg-white dark:border-white/8 dark:bg-white/4 dark:hover:bg-white/8"
                                      >
                                        <div className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">
                                          {board.name}
                                        </div>
                                        <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                                          <span>{taskCount} 张卡片</span>
                                          <span>·</span>
                                          <span>{formatRelativeTime(updatedAt, hydrated)}</span>
                                        </div>
                                      </Link>
                                    );
                                  })
                                ) : (
                                  <div className="col-span-full rounded-[22px] border border-dashed border-black/10 px-4 py-8 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                                    还没有看板。先进入看板页创建第一个看板。
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="rounded-[28px] border border-black/6 bg-white/82 p-5 dark:border-white/8 dark:bg-white/5">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                                最近卡片
                              </div>
                              <div className="mt-4 space-y-3">
                                {sortedTasks.slice(0, 4).map((task) => (
                                  <Link
                                    key={task.id}
                                    href={activeWorkspaceId ? `/workspace/${activeWorkspaceId}/kanban` : "/"}
                                    className="block rounded-[20px] border border-black/6 bg-[#faf9f4] p-4 transition-colors hover:bg-white dark:border-white/8 dark:bg-white/4 dark:hover:bg-white/8"
                                  >
                                    <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                      {task.title}
                                    </div>
                                    <div className="mt-2 flex items-center justify-between gap-3">
                                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                        {formatRelativeTime(task.updatedAt ?? task.createdAt, hydrated)}
                                      </div>
                                      <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${getTaskTone(task)}`}>
                                        {task.columnId ?? task.status}
                                      </span>
                                    </div>
                                  </Link>
                                ))}
                                {sortedTasks.length === 0 && (
                                  <div className="rounded-[22px] border border-dashed border-black/10 px-4 py-8 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                                    这个工作区里还没有卡片。
                                  </div>
                                )}
                              </div>
                            </div>
                          </section>
                        </section>
                      </>
                    )}
                  </div>
                </div>

                <div className="border-t border-black/6 bg-[#f3f1eb]/92 px-4 py-4 dark:border-white/8 dark:bg-[#0f141c]/92">
                  <div className="mx-auto w-full max-w-4xl">
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
              </>
            )}
          </main>

          <aside className="hidden w-[320px] shrink-0 border-l border-black/6 bg-[#efede6] dark:border-white/8 dark:bg-[#11161f] xl:flex xl:flex-col">
            <div className="border-b border-black/6 px-5 py-4 dark:border-white/8">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-500">
                工作区
              </div>
              <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                当前空间、最近会话和运行状态集中放在这里。
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              <div className="space-y-2">
                {workspacesHook.workspaces.map((workspace) => {
                  const active = workspace.id === activeWorkspaceId;
                  return (
                    <button
                      key={workspace.id}
                      type="button"
                      onClick={() => setActiveWorkspaceId(workspace.id)}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                        active
                          ? "border-[#9ec88e] bg-[#f6fbf2] text-slate-900 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.35)] dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-slate-100"
                          : "border-black/6 bg-white/70 text-slate-700 hover:bg-white dark:border-white/8 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/8"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{workspace.title}</div>
                          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                            更新于 {formatRelativeTime(workspace.updatedAt, hydrated)}
                          </div>
                        </div>
                        {active && (
                          <span className="rounded-full bg-[#e8f3e1] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#537149] dark:bg-emerald-900/40 dark:text-emerald-200">
                            当前
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              <section className="mt-6">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-500">
                  最近会话
                </div>
                <div className="space-y-2">
                  {recentSessions.length > 0 ? recentSessions.map((session) => (
                    <Link
                      key={session.sessionId}
                      href={`/workspace/${session.workspaceId}/sessions/${session.sessionId}`}
                      className="block rounded-2xl border border-black/6 bg-white/66 px-4 py-3 transition-colors hover:bg-white dark:border-white/8 dark:bg-white/5 dark:hover:bg-white/8"
                    >
                      <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                        {getSessionLabel(session)}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        {formatRelativeTime(session.createdAt, hydrated)}
                      </div>
                    </Link>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-black/10 px-4 py-6 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                      还没有最近会话。先创建一个需求，执行记录会显示在这里。
                    </div>
                  )}
                </div>
              </section>

              <section className="mt-6 rounded-[24px] border border-black/6 bg-white/70 p-4 dark:border-white/8 dark:bg-white/5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-500">
                  运行状态
                </div>
                <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                  <div className="flex items-center justify-between gap-3">
                    <span>运行时</span>
                    <span className={acp.connected ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300"}>
                      {acp.connected ? "在线" : "离线"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>模型配置</span>
                    <span className={hasProviderConfig ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300"}>
                      {hasProviderConfig ? "已就绪" : "待配置"}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleOpenProviders}
                  className="mt-4 inline-flex rounded-full border border-black/8 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700 transition-colors hover:bg-slate-50 dark:border-white/8 dark:bg-white/6 dark:text-slate-200 dark:hover:bg-white/10"
                >
                  打开模型设置
                </button>
              </section>
            </div>
          </aside>
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
