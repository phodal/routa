"use client";

/**
 * Workspace Overview — Desktop-optimized layout with sidebar navigation
 *
 * Route: /workspace/[workspaceId]
 *
 * Features:
 * - VS Code-style sidebar navigation
 * - Compact title bar
 * - Tabs: Overview | Notes (general + task) | Activity (BG tasks)
 */

import React, { useCallback, useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslation } from "@/i18n";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { useAcp } from "@/client/hooks/use-acp";
import { useAgentsRpc } from "@/client/hooks/use-agents-rpc";
import { useNotes } from "@/client/hooks/use-notes";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { AgentInstallPanel } from "@/client/components/agent-install-panel";
import { CompactStat } from "@/client/components/compact-stat";
import { WorkspaceTabBar } from "@/client/components/workspace-tab-bar";
import { WorkspacePageHeader } from "@/client/components/workspace-page-header";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { BackgroundTaskInfo, TaskInfo, SessionInfo, KanbanBoardInfo } from "@/app/workspace/[workspaceId]/types";
import { NoteTasksTab } from "@/app/workspace/[workspaceId]/note-tasks-tab";
import { NotesTab } from "@/app/workspace/[workspaceId]/notes-tab";
import { BgTasksTab } from "@/app/workspace/[workspaceId]/bg-tasks-tab";

export function WorkspacePageClient({
  initialTab = "overview",
}: {
  initialTab?: "overview" | "notes" | "activity";
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams();
  const rawWorkspaceId = params.workspaceId as string;
  const workspaceId =
    rawWorkspaceId === "__placeholder__" && typeof window !== "undefined"
      ? (window.location.pathname.match(/^\/workspace\/([^/]+)/)?.[1] ?? rawWorkspaceId)
      : rawWorkspaceId;

  const workspacesHook = useWorkspaces();
  const acp = useAcp();
  const agentsHook = useAgentsRpc(workspaceId);
  const notesHook = useNotes(workspaceId);

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [boards, setBoards] = useState<KanbanBoardInfo[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showAgentInstallPopup, setShowAgentInstallPopup] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "notes" | "activity">(initialTab);
  const [bgTasks, setBgTasks] = useState<BackgroundTaskInfo[]>([]);
  const [notesSubFilter, setNotesSubFilter] = useState<"general" | "tasks">("general");
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [boardsLoaded, setBoardsLoaded] = useState(false);
  const [bgTasksLoaded, setBgTasksLoaded] = useState(false);

  // Auto-connect ACP
  useEffect(() => {
    if (!acp.connected && !acp.loading) {
      acp.connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch sessions
  useEffect(() => {
    let cancelled = false;
    setSessionsLoaded(false);
    (async () => {
      try {
        const res = await fetch(`/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}&limit=100`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
      } catch {
        if (cancelled) return;
        setSessions([]);
      } finally {
        if (!cancelled) {
          setSessionsLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, refreshKey]);

  // Fetch tasks
  useEffect(() => {
    const controller = new AbortController();
    setTasksLoaded(false);
    (async () => {
      try {
        setTasks([]);
        const res = await fetch(`/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        setTasks(Array.isArray(data?.tasks) ? data.tasks : []);
      } catch {
        if (controller.signal.aborted) return;
        setTasks([]);
      } finally {
        if (!controller.signal.aborted) {
          setTasksLoaded(true);
        }
      }
    })();
    return () => controller.abort();
  }, [workspaceId, refreshKey]);

  // Fetch boards
  useEffect(() => {
    const controller = new AbortController();
    setBoardsLoaded(false);
    (async () => {
      try {
        setBoards([]);
        const res = await fetch(`/api/kanban/boards?workspaceId=${encodeURIComponent(workspaceId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        setBoards(Array.isArray(data?.boards) ? data.boards : []);
      } catch {
        if (controller.signal.aborted) return;
        setBoards([]);
      } finally {
        if (!controller.signal.aborted) {
          setBoardsLoaded(true);
        }
      }
    })();
    return () => controller.abort();
  }, [workspaceId, refreshKey]);

  // Fetch background tasks
  useEffect(() => {
    let cancelled = false;
    setBgTasksLoaded(false);
    (async () => {
      try {
        const res = await fetch(`/api/background-tasks?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        setBgTasks(Array.isArray(data?.tasks) ? data.tasks : []);
      } catch {
        if (cancelled) return;
        setBgTasks([]);
      } finally {
        if (!cancelled) {
          setBgTasksLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, refreshKey]);

  const workspace = workspacesHook.workspaces.find((w) => w.id === workspaceId);
  const isDefaultWorkspace = workspaceId === "default";

  useEffect(() => {
    if (!workspacesHook.loading && !workspace && !isDefaultWorkspace) {
      router.push("/");
    }
  }, [workspace, workspacesHook.loading, router, isDefaultWorkspace]);

  const handleWorkspaceSelect = useCallback((wsId: string) => {
    router.push(`/workspace/${wsId}`);
  }, [router]);

  const handleWorkspaceCreate = useCallback(async (title: string) => {
    const ws = await workspacesHook.createWorkspace(title);
    if (ws) router.push(`/workspace/${ws.id}`);
  }, [workspacesHook, router]);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  if (workspacesHook.loading && !isDefaultWorkspace) {
    return (
      <div className="desktop-theme flex h-screen items-center justify-center bg-desktop-bg-primary">
        <div className="flex items-center gap-3 text-desktop-text-secondary">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {t.workspace.loadingWorkspace}
        </div>
      </div>
    );
  }

  if (!workspace && !isDefaultWorkspace) return null;

  const _effectiveWorkspace = workspace ?? {
    id: "default",
    title: t.workspace.defaultWorkspace,
    status: "active" as const,
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const activeAgents = agentsHook.agents.filter((a) => a.status === "ACTIVE");
  const pendingTasks = tasks.filter((t) => t.status === "PENDING" || t.status === "IN_PROGRESS");
  const runningBgTasks = bgTasks.filter((t) => t.status === "RUNNING").length;
  const activeBoard = boards.find((board) => board.isDefault) ?? boards[0];
  const latestSession = sessions[0];
  const recentSessions = sessions.slice(0, 6);
  const generalNotes = notesHook.notes.filter((note) => note.metadata?.type === "general");
  const taskNotes = notesHook.notes.filter((note) => note.metadata?.type === "task");
  const snapshotReady = !workspacesHook.loading
    && !agentsHook.loading
    && !notesHook.loading
    && sessionsLoaded
    && tasksLoaded
    && boardsLoaded
    && bgTasksLoaded
    && Boolean(activeBoard)
    && Boolean(latestSession)
    && tasks.length > 0;

  const handleDeleteAllGeneralNotes = async () => {
    await Promise.all(
      notesHook.notes
        .filter((n) => n.metadata?.type === "general")
        .map((n) =>
          fetch(`/api/notes?noteId=${encodeURIComponent(n.id)}&workspaceId=${encodeURIComponent(workspaceId)}`, { method: "DELETE" })
        )
    );
    handleRefresh();
  };

  const handleDeleteAllTaskNotes = async () => {
    await Promise.all(
      notesHook.notes
        .filter((n) => n.metadata?.type === "task")
        .map((n) =>
          fetch(`/api/notes?noteId=${encodeURIComponent(n.id)}&workspaceId=${encodeURIComponent(workspaceId)}`, { method: "DELETE" })
        )
    );
    handleRefresh();
  };

  const handleUpdateNoteMetadata = async (noteId: string, metadata: Record<string, unknown>) => {
    await notesHook.updateNote(noteId, { metadata });
  };

  const overviewContent = (
    <div className="space-y-5">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <section className="border-b border-desktop-border pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-desktop-text-muted">
                {t.workspace.activeBoard}
              </div>
              <div className="mt-2 truncate text-xl font-semibold tracking-tight text-desktop-text-primary">
                {activeBoard?.name ?? t.workspace.noBoard}
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push(`/workspace/${workspaceId}/kanban`)}
              className="shrink-0 rounded-full border border-desktop-border px-3 py-1.5 text-[11px] font-medium text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary"
            >
              {t.workspace.goToBoard}
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-desktop-text-secondary">
            <span>{boards.length} {t.workspace.boards}</span>
            <span>{pendingTasks.length} {t.workspace.activeTasks}</span>
            <span>{runningBgTasks} {t.workspace.backgroundRuns}</span>
          </div>
        </section>

        <section className="border-b border-desktop-border pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-desktop-text-muted">
                {t.workspace.latestRecoveryPoint}
              </div>
              <div className="mt-2 truncate text-base font-semibold text-desktop-text-primary">
                {latestSession?.name ?? latestSession?.sessionId ?? t.workspace.noRecentSession}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                if (latestSession?.sessionId) {
                  router.push(`/workspace/${workspaceId}/sessions/${latestSession.sessionId}`);
                  return;
                }
                router.push("/");
              }}
              className="shrink-0 rounded-full border border-desktop-border px-3 py-1.5 text-[11px] font-medium text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary"
            >
              {latestSession ? t.workspace.recoverSession : t.workspace.createFromLauncher}
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-desktop-text-secondary">
            <span>{sessions.length} {t.workspace.sessions}</span>
            <span>{notesHook.notes.length} {t.workspace.notes}</span>
            <span>{agentsHook.agents.length} {t.workspace.agents}</span>
          </div>
        </section>
      </div>

      {recentSessions.length > 0 ? (
        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-desktop-text-muted">
              {t.workspace.recentSessions}
            </div>
            <div className="text-[11px] text-desktop-text-secondary">
              Latest {recentSessions.length} of {sessions.length}
            </div>
          </div>
          <div className="divide-y divide-desktop-border border-t border-desktop-border">
            {recentSessions.map((session) => (
              <button
                key={session.sessionId}
                type="button"
                onClick={() => router.push(`/workspace/${workspaceId}/sessions/${session.sessionId}`)}
                className="flex w-full items-center justify-between gap-4 py-3 text-left transition-colors hover:bg-desktop-bg-secondary/40"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-desktop-text-primary">
                    {session.name ?? session.sessionId}
                  </div>
                  <div className="mt-1 truncate text-[11px] text-desktop-text-secondary">
                    {session.provider ?? "unknown provider"}{session.role ? ` · ${session.role}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-[11px] text-desktop-text-secondary">
                  {new Date(session.createdAt).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );

  const notesContent = (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => setNotesSubFilter("general")}
          className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            notesSubFilter === "general"
            ? "bg-desktop-bg-active text-desktop-accent"
            : "text-desktop-text-secondary hover:bg-desktop-bg-active/70 hover:text-desktop-text-primary"
          }`}
        >
          {t.workspace.workspaceNotes}
          {generalNotes.length > 0 && (
            <span className="ml-1 opacity-60">({generalNotes.length})</span>
          )}
        </button>
        <button
          onClick={() => setNotesSubFilter("tasks")}
          className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            notesSubFilter === "tasks"
            ? "bg-desktop-bg-active text-desktop-accent"
            : "text-desktop-text-secondary hover:bg-desktop-bg-active/70 hover:text-desktop-text-primary"
          }`}
        >
          {t.workspace.taskNotes}
          {taskNotes.length > 0 && (
            <span className="ml-1 opacity-60">({taskNotes.length})</span>
          )}
        </button>
      </div>

      {notesSubFilter === "general" && (
        <NotesTab
          notes={generalNotes}
          loading={notesHook.loading}
          workspaceId={workspaceId}
          sessions={sessions}
          onCreateNote={async (title, content, sessionId) => {
            await notesHook.createNote({ title, content, type: "general", sessionId });
          }}
          onUpdateNote={async (noteId, update) => {
            await notesHook.updateNote(noteId, update);
          }}
          onDeleteNote={async (noteId) => {
            await notesHook.deleteNote(noteId);
          }}
          onDeleteAllNotes={handleDeleteAllGeneralNotes}
        />
      )}

      {notesSubFilter === "tasks" && (
        <NoteTasksTab
          notes={notesHook.notes}
          loading={notesHook.loading}
          workspaceId={workspaceId}
          sessions={sessions}
          onDeleteNote={async (noteId) => {
            await notesHook.deleteNote(noteId);
          }}
          onUpdateNoteMetadata={handleUpdateNoteMetadata}
          onDeleteAllTaskNotes={handleDeleteAllTaskNotes}
        />
      )}
    </div>
  );

  const activityContent = (
    <BgTasksTab
      bgTasks={bgTasks}
      workspaceId={workspaceId}
      workspaces={workspacesHook.workspaces}
      onRefresh={handleRefresh}
    />
  );

  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceTitle={workspace?.title ?? (isDefaultWorkspace ? t.workspace.defaultWorkspace : undefined)}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspacesHook.workspaces}
          activeWorkspaceId={workspaceId}
          activeWorkspaceTitle={workspace?.title ?? (isDefaultWorkspace ? "Default Workspace" : undefined)}
          onSelect={handleWorkspaceSelect}
          onCreate={handleWorkspaceCreate}
          loading={workspacesHook.loading}
          compact
          desktop
        />
      )}
    >
      <div
        className="flex h-full flex-col overflow-hidden bg-desktop-bg-primary"
        data-testid="workspace-page-shell"
        data-snapshot-ready={snapshotReady ? "true" : "false"}
      >
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="w-full px-4 py-4">
            <WorkspacePageHeader
              title={workspace?.title ?? (isDefaultWorkspace ? t.workspace.defaultWorkspace : t.workspace.workspaces)}
              workspaceId={workspaceId}
              boardName={activeBoard?.name ?? t.workspace.noBoard}
              latestSessionName={latestSession?.name ?? t.workspace.noRecentSession}
              activeAgentsCount={activeAgents.length}
              pendingTasksCount={pendingTasks.length}
              onRefresh={handleRefresh}
            />

            <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <CompactStat label={t.workspace.sessions} value={sessions.length} color="blue" />
              <CompactStat label={t.workspace.agents} value={agentsHook.agents.length} sub={activeAgents.length > 0 ? `${activeAgents.length} ${t.workspace.active}` : undefined} color="route" />
              <CompactStat label={t.workspace.tasks} value={tasks.length} sub={pendingTasks.length > 0 ? `${pendingTasks.length} ${t.workspace.pending}` : undefined} color="emerald" />
              <CompactStat label={t.workspace.bgTasks} value={bgTasks.length} sub={runningBgTasks > 0 ? `${runningBgTasks} ${t.workspace.running}` : undefined} color="amber" />
            </div>

            <div className="hidden xl:grid xl:grid-cols-12 xl:gap-4">
              <section className="xl:col-span-7">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-desktop-text-muted">{t.workspace.overview}</div>
                </div>
                {overviewContent}
              </section>

              <div className="xl:col-span-5 flex min-h-0 flex-col gap-4">
                <section className="rounded-[24px] border border-desktop-border bg-desktop-bg-secondary p-4">
                  <div className="mb-4 flex items-center justify-between gap-3 border-b border-desktop-border pb-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-desktop-text-muted">{t.workspace.activity}</div>
                      <div className="mt-1 text-sm text-desktop-text-secondary">{t.workspace.activityDescription}</div>
                    </div>
                  </div>
                  {activityContent}
                </section>

                <section className="rounded-[24px] border border-desktop-border bg-desktop-bg-secondary p-4">
                  <div className="mb-4 flex items-center justify-between gap-3 border-b border-desktop-border pb-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-desktop-text-muted">{t.workspace.notes}</div>
                      <div className="mt-1 text-sm text-desktop-text-secondary">{t.workspace.notesDescription}</div>
                    </div>
                  </div>
                  {notesContent}
                </section>
              </div>
            </div>

            <div className="xl:hidden">
              <WorkspaceTabBar
                className="mb-4"
                activeTab={activeTab}
                notesCount={notesHook.notes.length}
                activityCount={bgTasks.length}
                onTabChange={setActiveTab}
              />

              {activeTab === "overview" && overviewContent}
              {activeTab === "notes" && notesContent}
              {activeTab === "activity" && activityContent}
            </div>
          </div>
        </div>
      </div>

      {/* Agent Install Popup */}
      {showAgentInstallPopup && (
        <OverlayModal onClose={() => setShowAgentInstallPopup(false)} title={t.workspace.installAgents}>
          <AgentInstallPanel />
        </OverlayModal>
      )}
    </DesktopAppShell>
  );
}

// ─── Desktop-optimized Sub-components ──────────────────────────────

function OverlayModal({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div
        className="relative h-[80vh] w-full max-w-5xl overflow-hidden rounded border border-desktop-border bg-desktop-bg-secondary shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-9 items-center justify-between border-b border-desktop-border bg-desktop-bg-tertiary px-3">
          <span className="text-[12px] font-medium text-desktop-text-primary">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-accent-text"
            title="Close (Esc)"
            aria-label="Close"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="h-[calc(80vh-36px)]">{children}</div>
      </div>
    </div>
  );
}
