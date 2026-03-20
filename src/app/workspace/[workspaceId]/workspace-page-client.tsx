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
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { useAcp } from "@/client/hooks/use-acp";
import { useAgentsRpc } from "@/client/hooks/use-agents-rpc";
import { useNotes } from "@/client/hooks/use-notes";
import { DesktopLayout } from "@/client/components/desktop-layout";
import { AgentInstallPanel } from "@/client/components/agent-install-panel";
import { SessionsOverview } from "@/app/workspace/[workspaceId]/sessions-overview";
import { BackgroundTaskInfo, TaskInfo, SessionInfo, KanbanBoardInfo } from "@/app/workspace/[workspaceId]/types";
import { NoteTasksTab } from "@/app/workspace/[workspaceId]/note-tasks-tab";
import { NotesTab } from "@/app/workspace/[workspaceId]/notes-tab";
import { BgTasksTab } from "@/app/workspace/[workspaceId]/bg-tasks-tab";

export function WorkspacePageClient({
  initialTab = "overview",
}: {
  initialTab?: "overview" | "notes" | "activity";
}) {
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

  // Auto-connect ACP
  useEffect(() => {
    if (!acp.connected && !acp.loading) {
      acp.connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch sessions
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}&limit=100`, { cache: "no-store" });
        const data = await res.json();
        setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
      } catch { /* ignore */ }
    })();
  }, [workspaceId, refreshKey]);

  // Fetch tasks
  useEffect(() => {
    const controller = new AbortController();
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
      }
    })();
    return () => controller.abort();
  }, [workspaceId, refreshKey]);

  // Fetch boards
  useEffect(() => {
    const controller = new AbortController();
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
      }
    })();
    return () => controller.abort();
  }, [workspaceId, refreshKey]);

  // Fetch background tasks
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/background-tasks?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
        const data = await res.json();
        setBgTasks(Array.isArray(data?.tasks) ? data.tasks : []);
      } catch { /* ignore */ }
    })();
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
          Loading workspace…
        </div>
      </div>
    );
  }

  if (!workspace && !isDefaultWorkspace) return null;

  const _effectiveWorkspace = workspace ?? {
    id: "default",
    title: "Default Workspace",
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

  return (
    <DesktopLayout
      workspaceId={workspaceId}
      workspaces={workspacesHook.workspaces}
      activeWorkspaceTitle={workspace?.title ?? (isDefaultWorkspace ? "Default Workspace" : undefined)}
      workspacesLoading={workspacesHook.loading}
      onWorkspaceSelect={handleWorkspaceSelect}
      onWorkspaceCreate={handleWorkspaceCreate}
    >
      <div className="flex h-full flex-col overflow-hidden bg-desktop-bg-primary" data-testid="workspace-page-shell">
        {/* Content Area */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-4 py-4">
            {/* Compact Stat Row */}
            <div className="flex items-center gap-4 mb-4 px-1">
              <CompactStat label="Sessions" value={sessions.length} color="blue" />
              <CompactStat label="Agents" value={agentsHook.agents.length} sub={activeAgents.length > 0 ? `${activeAgents.length} active` : undefined} color="violet" />
              <CompactStat label="Tasks" value={tasks.length} sub={pendingTasks.length > 0 ? `${pendingTasks.length} pending` : undefined} color="emerald" />
              <CompactStat label="BG Tasks" value={bgTasks.length} sub={runningBgTasks > 0 ? `${runningBgTasks} running` : undefined} color="amber" />
            </div>

            {/* Tab Bar - VS Code style */}
            <div className="mb-4 flex items-center gap-0 border-b border-desktop-border" data-testid="workspace-tab-bar">
              <DesktopTabButton active={activeTab === "overview"} onClick={() => setActiveTab("overview")}>
                Overview
              </DesktopTabButton>
              <DesktopTabButton active={activeTab === "notes"} onClick={() => setActiveTab("notes")}>
                Notes {notesHook.notes.length > 0 && <span className="ml-1 text-[10px] opacity-60" data-testid="workspace-tab-count">({notesHook.notes.length})</span>}
              </DesktopTabButton>
              <DesktopTabButton active={activeTab === "activity"} onClick={() => setActiveTab("activity")}>
                Activity {bgTasks.length > 0 && <span className="ml-1 text-[10px] opacity-60" data-testid="workspace-tab-count">({bgTasks.length})</span>}
              </DesktopTabButton>
            </div>

            {/* Tab Content */}
            {activeTab === "overview" && (
              <div className="space-y-4">
                <section className="rounded-xl border border-desktop-border bg-desktop-bg-secondary p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="max-w-2xl">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-desktop-text-muted">
                        Workspace overview
                      </div>
                      <h1 className="mt-2 text-xl font-semibold text-desktop-text-primary">
                        {workspace?.title ?? (isDefaultWorkspace ? "Default Workspace" : "Workspace")}
                      </h1>
                      <p className="mt-2 text-sm leading-6 text-desktop-text-secondary">
                        This page now stays focused on context and recovery. Use the dedicated Kanban route as the primary operating surface for active task execution.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => router.push(`/workspace/${workspaceId}/team`)}
                        className="rounded-md border border-amber-300/70 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/15"
                      >
                        Open Team
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push(`/workspace/${workspaceId}/kanban`)}
                        className="rounded-md bg-desktop-accent px-3 py-2 text-[12px] font-medium text-desktop-accent-text transition-colors hover:opacity-90"
                      >
                        Open Kanban
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push("/traces")}
                        className="rounded-md border border-desktop-border px-3 py-2 text-[12px] font-medium text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary"
                      >
                        Open traces
                      </button>
                    </div>
                  </div>
                </section>

                <div className="grid gap-4 lg:grid-cols-2">
                  <OverviewCard
                    eyebrow="Primary surface"
                    title={activeBoard?.name ?? "Kanban board"}
                    description="Kanban is the canonical work surface for routing, queue supervision, and lane-based execution."
                    meta={[
                      `${boards.length} board${boards.length === 1 ? "" : "s"}`,
                      `${pendingTasks.length} active tasks`,
                      `${runningBgTasks} background runs`,
                    ]}
                    actionLabel="Go to board"
                    onAction={() => router.push(`/workspace/${workspaceId}/kanban`)}
                  />
                  <OverviewCard
                    eyebrow="Latest recovery point"
                    title={latestSession?.name ?? latestSession?.sessionId ?? "No recent session"}
                    description={latestSession
                      ? "Recover the latest session from this workspace or continue task execution from the board."
                      : "Create a new requirement from the homepage launcher, then return here for context and recovery."}
                    meta={[
                      `${sessions.length} recent sessions`,
                      `${notesHook.notes.length} notes`,
                      `${agentsHook.agents.length} agents`,
                    ]}
                    actionLabel={latestSession ? "Open latest session" : "Back to launcher"}
                    onAction={() => {
                      if (latestSession?.sessionId) {
                        router.push(`/workspace/${workspaceId}/sessions/${latestSession.sessionId}`);
                        return;
                      }
                      router.push("/");
                    }}
                  />
                </div>

                {sessions.length > 0 && (
                  <section className="rounded-xl border border-desktop-border bg-desktop-bg-secondary p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-desktop-text-muted">
                          Recent sessions
                        </div>
                        <div className="mt-1 text-sm text-desktop-text-secondary">
                          Recover execution context without reopening the Kanban surface.
                        </div>
                      </div>
                    </div>
                    <SessionsOverview
                      sessions={sessions}
                      workspaceId={workspaceId}
                      onNavigate={(sessionId) => router.push(`/workspace/${workspaceId}/sessions/${sessionId}`)}
                      onRefresh={handleRefresh}
                    />
                  </section>
                )}
              </div>
            )}

            {activeTab === "notes" && (
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
                    Workspace Notes
                    {notesHook.notes.filter(n => n.metadata?.type === "general").length > 0 && (
                      <span className="ml-1 opacity-60">({notesHook.notes.filter(n => n.metadata?.type === "general").length})</span>
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
                    Task Notes
                    {notesHook.notes.filter(n => n.metadata?.type === "task").length > 0 && (
                      <span className="ml-1 opacity-60">({notesHook.notes.filter(n => n.metadata?.type === "task").length})</span>
                    )}
                  </button>
                </div>

                {notesSubFilter === "general" && (
                  <NotesTab
                    notes={notesHook.notes.filter(n => n.metadata?.type === "general")}
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
            )}

            {activeTab === "activity" && (
              <BgTasksTab
                bgTasks={bgTasks}
                workspaceId={workspaceId}
                workspaces={workspacesHook.workspaces}
                onRefresh={handleRefresh}
              />
            )}
          </div>
        </div>
      </div>

      {/* Agent Install Popup */}
      {showAgentInstallPopup && (
        <OverlayModal onClose={() => setShowAgentInstallPopup(false)} title="Install Agents">
          <AgentInstallPanel />
        </OverlayModal>
      )}
    </DesktopLayout>
  );
}

// ─── Desktop-optimized Sub-components ──────────────────────────────

function DesktopTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
      <button
      onClick={onClick}
      className={`px-3 py-1.5 text-[12px] font-medium transition-colors ${
        active
          ? "border-b-2 border-b-desktop-accent bg-desktop-bg-active text-desktop-accent"
          : "text-desktop-text-secondary hover:bg-desktop-bg-active/70 hover:text-desktop-text-primary"
      }`}
    >
      {children}
    </button>
  );
}

function CompactStat({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: number;
  sub?: string;
  color: "blue" | "violet" | "emerald" | "amber";
}) {
  const colorMap = {
    blue: "text-blue-400",
    violet: "text-violet-400",
    emerald: "text-emerald-400",
    amber: "text-amber-400",
  };

  return (
    <div className="flex items-center gap-2">
      <span className={`text-sm font-semibold tabular-nums ${colorMap[color]}`}>{value}</span>
      <span className="text-[11px] text-desktop-text-muted">
        {label}
        {sub && <span className="ml-1 text-desktop-text-muted">· {sub}</span>}
      </span>
    </div>
  );
}

function OverviewCard({
  eyebrow,
  title,
  description,
  meta,
  actionLabel,
  onAction,
}: {
  eyebrow: string;
  title: string;
  description: string;
  meta: string[];
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <section className="rounded-xl border border-desktop-border bg-desktop-bg-secondary p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-desktop-text-muted">
        {eyebrow}
      </div>
      <div className="mt-2 text-lg font-semibold text-desktop-text-primary">
        {title}
      </div>
      <div className="mt-2 text-sm leading-6 text-desktop-text-secondary">
        {description}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {meta.map((item) => (
          <span
            key={item}
            className="rounded-full border border-desktop-border px-2 py-1 text-[11px] text-desktop-text-secondary"
          >
            {item}
          </span>
        ))}
      </div>
      <button
        type="button"
        onClick={onAction}
        className="mt-4 rounded-md border border-desktop-border px-3 py-2 text-[12px] font-medium text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary"
      >
        {actionLabel}
      </button>
    </section>
  );
}

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
