"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";

import { HomeInput } from "@/client/components/home-input";
import { ConnectionDot, OnboardingCard } from "@/client/components/home-page-sections";
import { useAcp } from "@/client/hooks/use-acp";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { SettingsPanel } from "@/client/components/settings-panel";
import { desktopAwareFetch } from "@/client/utils/diagnostics";

interface HomeTaskInfo {
  id: string;
  title: string;
  columnId?: string;
  status?: string;
  createdAt: string;
  priority?: string;
}

/**
 * Session summary rendered in the homepage "Recent work" section.
 * Values are derived from `/api/sessions` and intentionally limited to
 * fields needed for display and navigation.
 */
interface HomeSessionInfo {
  sessionId: string;
  workspaceId?: string;
  name?: string;
  provider?: string;
  role?: string;
  createdAt: string;
  acpStatus?: "connecting" | "ready" | "error";
}

export default function HomePage() {
  const workspacesHook = useWorkspaces();
  const acp = useAcp();

  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"agents" | undefined>(undefined);
  const [workspaceTasks, setWorkspaceTasks] = useState<HomeTaskInfo[]>([]);
  const [workspaceSessions, setWorkspaceSessions] = useState<HomeSessionInfo[]>([]);
  const [isHomeLoading, setIsHomeLoading] = useState(false);

  useEffect(() => {
    if (!activeWorkspaceId && workspacesHook.workspaces.length > 0) {
      setActiveWorkspaceId(workspacesHook.workspaces[0].id);
    }
  }, [activeWorkspaceId, workspacesHook.workspaces]);

  useEffect(() => {
    if (!acp.connected && !acp.loading) {
      acp.connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acp.connected, acp.loading]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setWorkspaceTasks([]);
      setWorkspaceSessions([]);
      return;
    }

    const controller = new AbortController();

    const loadHomepageData = async () => {
      setIsHomeLoading(true);
      try {
        const [tasksRes, sessionsRes] = await Promise.all([
          desktopAwareFetch(`/api/tasks?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
          desktopAwareFetch(`/api/sessions?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);

        const tasksPayload = await tasksRes.json();
        const sessionsPayload = await sessionsRes.json();

        if (controller.signal.aborted) return;

        setWorkspaceTasks(
          Array.isArray(tasksPayload?.tasks)
            ? tasksPayload.tasks
              .filter((task: { id?: string; title?: string; createdAt?: string }) => task?.id && task?.title)
              .map((task: { id: string; title: string; columnId?: string; status?: string; createdAt: string; priority?: string }) => ({
                id: String(task.id),
                title: String(task.title),
                columnId: task.columnId ? String(task.columnId) : undefined,
                status: task.status ? String(task.status) : undefined,
                createdAt: String(task.createdAt ?? new Date(0).toISOString()),
                priority: task.priority ? String(task.priority) : undefined,
              }))
            : [],
        );

        setWorkspaceSessions(
          Array.isArray(sessionsPayload?.sessions)
            ? sessionsPayload.sessions
              .filter((session: { sessionId?: string; createdAt?: string }) => session?.sessionId && session?.createdAt)
              .map((session: {
                sessionId: string;
                workspaceId?: string;
                name?: string;
                provider?: string;
                role?: string;
                createdAt: string;
                acpStatus?: "connecting" | "ready" | "error";
              }) => ({
                sessionId: String(session.sessionId),
                workspaceId: session.workspaceId ? String(session.workspaceId) : undefined,
                name: session.name ? String(session.name) : undefined,
                provider: session.provider ? String(session.provider) : undefined,
                role: session.role ? String(session.role) : undefined,
                createdAt: String(session.createdAt),
                acpStatus: session.acpStatus,
              }))
            : [],
        );
      } catch {
        setWorkspaceTasks([]);
        setWorkspaceSessions([]);
      } finally {
        if (!controller.signal.aborted) {
          setIsHomeLoading(false);
        }
      }
    };

    void loadHomepageData();

    return () => controller.abort();
  }, [activeWorkspaceId, refreshKey]);

  const handleWorkspaceCreate = useCallback(async (title: string) => {
    const workspace = await workspacesHook.createWorkspace(title);
    if (workspace) {
      setActiveWorkspaceId(workspace.id);
      setRefreshKey((value) => value + 1);
    }
  }, [workspacesHook]);

  const activeWorkspace = workspacesHook.workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const workspaceCount = workspacesHook.workspaces.length;

  const activeKanbanHref = activeWorkspaceId ? `/workspace/${activeWorkspaceId}/kanban` : "/";
  const activeWorkspaceHref = activeWorkspaceId ? `/workspace/${activeWorkspaceId}` : "/";
  const recentSessions = useMemo(() => workspaceSessions.slice(0, 3), [workspaceSessions]);
  const totalActiveTasks = workspaceTasks.filter((task) => !isTaskDone(task)).length;
  const runningSessionCount = workspaceSessions.filter(
    (session) => session.acpStatus === "connecting" || session.acpStatus === "ready",
  ).length;

  return (
      <div className="relative flex h-screen min-h-screen flex-col overflow-hidden bg-[#f6f9fd] text-[#081120] dark:bg-[#040913] dark:text-gray-100">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(250,253,255,0.98),rgba(240,245,252,0.94))] dark:bg-[linear-gradient(180deg,rgba(5,10,18,0.98),rgba(4,9,19,0.97))]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(14,90,160,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(14,90,160,0.04)_1px,transparent_1px)] bg-[size:160px_160px] opacity-25 dark:opacity-10" />
        </div>

        <header className="relative z-10 flex h-14 shrink-0 items-center border-b border-sky-200/55 bg-white/55 px-3 backdrop-blur-xl sm:px-5 dark:border-white/6 dark:bg-[#040913]/76">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="rounded-xl border border-sky-200/70 bg-white/80 p-1.5 shadow-[0_10px_30px_-18px_rgba(37,99,235,0.45)] dark:border-white/10 dark:bg-white/5">
              <Image src="/logo.svg" alt="Routa" width={22} height={22} className="rounded-md" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold tracking-[0.02em] text-[#081120] dark:text-gray-100">
                Routa
              </div>
              <div className="hidden text-[10px] uppercase tracking-[0.28em] text-[#4c7ec3] sm:block dark:text-sky-400/70">
                Kanban-First Control Surface
              </div>
            </div>
          </div>

          <div className="flex-1" />

          <nav className="flex items-center gap-2">
            {activeWorkspaceId && (
              <Link
                href={activeKanbanHref}
                className="rounded-full px-3 py-1.5 text-[11px] font-medium text-[#46638b] transition-colors hover:bg-sky-100/70 hover:text-[#081120] dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-100"
                >
                  Kanban
                </Link>
            )}

            <button
              onClick={() => {
                setSettingsInitialTab(undefined);
                setShowSettingsPanel(true);
              }}
              className="rounded-full p-2 text-gray-400 transition-colors hover:bg-black/5 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-white/5 dark:hover:text-gray-300"
              title="Settings"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            <div className="ml-1">
              <ConnectionDot connected={acp.connected} />
            </div>
          </nav>
        </header>

        <main className="relative z-10 flex-1 overflow-y-auto">
          {workspacesHook.loading ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-400 dark:text-slate-500">
              Loading workspaces...
            </div>
          ) : workspacesHook.workspaces.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <OnboardingCard onCreateWorkspace={handleWorkspaceCreate} />
            </div>
          ) : (
            <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
              <section className="overflow-hidden rounded-[32px] border border-sky-200/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(241,247,255,0.95))] p-5 shadow-[0_45px_110px_-90px_rgba(37,99,235,0.55)] dark:border-[#223049] dark:bg-[linear-gradient(180deg,rgba(7,12,21,0.96),rgba(9,15,26,0.98))] sm:p-7">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#4a74a8] dark:text-slate-400">
                  Desktop home
                </p>
                <h1 className="mt-2 max-w-3xl font-['Avenir_Next_Condensed','Avenir_Next','Segoe_UI','Helvetica_Neue',sans-serif] text-[2.3rem] leading-[0.95] font-semibold tracking-[-0.04em] text-[#081120] dark:text-white sm:text-[3rem]">
                  Start with a requirement.
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-[#4d6689] dark:text-slate-300">
                  Keep the desktop homepage focused on one job: choose the workspace, send the task, then jump straight into your latest session or Kanban board when you need more detail.
                </p>

                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  <BoardStat label="Active tasks" value={String(totalActiveTasks)} detail="Cards not in Done" />
                  <BoardStat
                    label="Running sessions"
                    value={String(runningSessionCount)}
                    detail={acp.connected ? "ACP runtime ready" : "ACP runtime offline"}
                  />
                  <BoardStat
                    label="Workspace"
                    value={String(workspaceCount).padStart(2, "0")}
                    detail={activeWorkspace?.title ?? "No workspace selected"}
                  />
                </div>

                <div className="mt-6 rounded-[28px] border border-sky-200/75 bg-white/82 p-3 shadow-[0_30px_100px_-58px_rgba(37,99,235,0.24)] backdrop-blur dark:border-white/10 dark:bg-[#0a1322]/66 sm:p-4">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#356fb0] dark:text-slate-400">
                    Quick start
                  </div>
                  <HomeInput
                    variant="hero"
                    workspaceId={activeWorkspaceId ?? undefined}
                    minimalControls
                    onWorkspaceChange={(workspaceId) => {
                      setActiveWorkspaceId(workspaceId);
                      setRefreshKey((value) => value + 1);
                    }}
                    onSessionCreated={() => {
                      setRefreshKey((value) => value + 1);
                    }}
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href={activeWorkspaceHref}
                    className="inline-flex items-center justify-center rounded-full border border-sky-200/70 bg-white/90 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#2b6fc8] transition-colors hover:bg-white dark:border-white/10 dark:bg-[#1b2232] dark:text-slate-300 dark:hover:bg-[#101826]"
                  >
                    Open workspace
                  </Link>
                  <Link
                    href={activeKanbanHref}
                    className="inline-flex items-center justify-center rounded-full bg-[#0f62d6] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#2a77e4] dark:bg-[#5ee5ff] dark:text-[#04111d] dark:hover:bg-[#87edff]"
                  >
                    Open board
                  </Link>
                </div>

                <div className="mt-7 grid gap-4 lg:grid-cols-[minmax(0,1fr)_250px]">
                  <section className="rounded-[24px] border border-sky-200/70 bg-white/72 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h2 className="text-sm font-semibold text-[#081120] dark:text-white">Recent work</h2>
                        <p className="mt-1 text-xs text-[#577090] dark:text-slate-400">
                          Re-open the latest sessions without leaving the homepage.
                        </p>
                      </div>
                      <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700 dark:bg-sky-950/60 dark:text-sky-200">
                        {workspaceSessions.length} total
                      </span>
                    </div>

                    <div className="mt-4 space-y-2">
                      {isHomeLoading ? (
                        <div className="rounded-2xl border border-sky-100 bg-sky-50/70 px-3 py-4 text-sm text-[#577090] dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                          Loading recent work...
                        </div>
                      ) : recentSessions.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-sky-200/80 bg-sky-50/60 px-3 py-4 text-sm text-[#577090] dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                          Your latest sessions will appear here after you send a prompt.
                        </div>
                      ) : (
                        recentSessions.map((session) => (
                          <Link
                            key={session.sessionId}
                            href={`/workspace/${session.workspaceId ?? activeWorkspaceId ?? ""}/sessions/${session.sessionId}`}
                            className="flex items-center justify-between gap-3 rounded-2xl border border-sky-100/90 bg-white px-3 py-3 transition-colors hover:border-sky-300 hover:bg-sky-50/70 dark:border-white/8 dark:bg-[#0b1424] dark:hover:border-sky-700/40 dark:hover:bg-[#0d182a]"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-[#081120] dark:text-slate-100">
                                {getSessionDisplayName(session)}
                              </div>
                              <div className="mt-1 text-[11px] text-[#577090] dark:text-slate-500">
                                {formatRelativeTime(session.createdAt)}
                              </div>
                            </div>
                            <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] ${session.acpStatus === "error" ? "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-200" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200"}`}>
                              {session.acpStatus === "error" ? "Issue" : session.acpStatus ?? "Ready"}
                            </span>
                          </Link>
                        ))
                      )}
                    </div>
                  </section>

                  <aside className="rounded-[24px] border border-sky-200/70 bg-white/72 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                    <h2 className="text-sm font-semibold text-[#081120] dark:text-white">Shortcuts</h2>
                    <div className="mt-4 space-y-2">
                      <ShortcutHint keys="Enter" detail="Send the current requirement" />
                      <ShortcutHint keys="Shift + Enter" detail="Insert a new line" />
                    </div>
                  </aside>
                </div>
              </section>
            </div>
          )}
        </main>

        <SettingsPanel
          open={showSettingsPanel}
          onClose={() => setShowSettingsPanel(false)}
          providers={acp.providers}
          initialTab={settingsInitialTab}
        />
      </div>
  );
}

const DONE_TASK_STATES = new Set(["done", "completed"]);

function isTaskDone(task: HomeTaskInfo): boolean {
  const lane = (task.columnId ?? task.status ?? "").toLowerCase();
  return DONE_TASK_STATES.has(lane);
}

function getSessionDisplayName(session: HomeSessionInfo): string {
  if (session.name) return session.name;
  if (session.provider && session.role) return `${session.provider} · ${session.role.toLowerCase()}`;
  if (session.provider) return session.provider;
  return `Session ${session.sessionId.slice(0, 6)}`;
}

function formatRelativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function BoardStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[18px] border border-sky-200/75 bg-white/78 px-3 py-3 dark:border-white/12 dark:bg-white/[0.05]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#4b6f98] dark:text-slate-400">{label}</div>
      <div className="mt-1.5 text-[1.35rem] font-semibold tracking-tight text-[#081120] dark:text-white">{value}</div>
      <div className="mt-1 text-[11px] leading-5 text-[#577090] dark:text-slate-500">{detail}</div>
    </div>
  );
}

function ShortcutHint({ keys, detail }: { keys: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-sky-100/90 bg-white px-3 py-3 dark:border-white/8 dark:bg-[#0b1424]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#356fb0] dark:text-sky-300/80">
        {keys}
      </div>
      <div className="mt-1 text-xs text-[#577090] dark:text-slate-400">{detail}</div>
    </div>
  );
}
