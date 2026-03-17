"use client";

/**
 * Workspace Dashboard — Desktop-optimized layout with sidebar navigation
 *
 * Route: /workspace/[workspaceId]
 *
 * Features:
 * - VS Code-style sidebar navigation
 * - Compact title bar
 * - Tabs: Kanban (default) | Notes (general + task) | Activity (BG tasks)
 */

import React, { useCallback, useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { HomeInput } from "@/client/components/home-input";
import { useWorkspaces, useCodebases } from "@/client/hooks/use-workspaces";
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
import { KanbanTab } from "@/app/workspace/[workspaceId]/kanban/kanban-tab";

interface SpecialistOption {
  id: string;
  name: string;
  role: string;
}

export function WorkspacePageClient({
  initialTab = "kanban",
}: {
  initialTab?: "kanban" | "notes" | "activity";
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
  const { codebases, fetchCodebases } = useCodebases(workspaceId);
  const agentsHook = useAgentsRpc(workspaceId);
  const notesHook = useNotes(workspaceId);

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [boards, setBoards] = useState<KanbanBoardInfo[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showAgentInstallPopup, setShowAgentInstallPopup] = useState(false);
  const [activeTab, setActiveTab] = useState<"kanban" | "notes" | "activity">(initialTab);
  const [bgTasks, setBgTasks] = useState<BackgroundTaskInfo[]>([]);
  const [specialists, setSpecialists] = useState<SpecialistOption[]>([]);
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

  // Fetch specialists
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/specialists", { cache: "no-store" });
        const data = await res.json();
        setSpecialists(Array.isArray(data?.specialists)
          ? data.specialists.filter((item: { enabled?: boolean }) => item.enabled !== false).map((item: { id: string; name: string; role: string }) => ({
              id: item.id,
              name: item.name,
              role: item.role,
            }))
          : []);
      } catch { /* ignore */ }
    })();
  }, []);

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
    void fetchCodebases();
  }, [fetchCodebases]);

  if (workspacesHook.loading && !isDefaultWorkspace) {
    return (
      <div className="desktop-theme h-screen flex items-center justify-center bg-[var(--dt-bg-primary)]">
        <div className="flex items-center gap-3 text-[var(--dt-text-secondary)]">
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
      workspacesLoading={workspacesHook.loading}
      onWorkspaceSelect={handleWorkspaceSelect}
      onWorkspaceCreate={handleWorkspaceCreate}
    >
      <div className="h-full flex flex-col bg-[var(--dt-bg-primary)] overflow-hidden">
        {/* Content Area */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-4 py-4">
            {/* Quick Input - more compact */}
            <div className="mb-4">
              <HomeInput
                workspaceId={workspaceId}
                onSessionCreated={handleRefresh}
              />
            </div>

            {/* Sessions Overview - compact */}
            {sessions.length > 0 && (
              <div className="mb-4">
                <SessionsOverview
                  sessions={sessions}
                  workspaceId={workspaceId}
                  onNavigate={(sessionId) => router.push(`/workspace/${workspaceId}/sessions/${sessionId}`)}
                  onRefresh={handleRefresh}
                />
              </div>
            )}

            {/* Compact Stat Row */}
            <div className="flex items-center gap-4 mb-4 px-1">
              <CompactStat label="Sessions" value={sessions.length} color="blue" />
              <CompactStat label="Agents" value={agentsHook.agents.length} sub={activeAgents.length > 0 ? `${activeAgents.length} active` : undefined} color="violet" />
              <CompactStat label="Tasks" value={tasks.length} sub={pendingTasks.length > 0 ? `${pendingTasks.length} pending` : undefined} color="emerald" />
              <CompactStat label="BG Tasks" value={bgTasks.length} sub={runningBgTasks > 0 ? `${runningBgTasks} running` : undefined} color="amber" />
            </div>

            {/* Tab Bar - VS Code style */}
            <div className="flex items-center gap-0 mb-4 border-b border-[var(--dt-border)]">
              <DesktopTabButton active={activeTab === "kanban"} onClick={() => setActiveTab("kanban")}>
                Kanban {tasks.length > 0 && <span className="ml-1 text-[10px] opacity-60">({tasks.length})</span>}
              </DesktopTabButton>
              <DesktopTabButton active={activeTab === "notes"} onClick={() => setActiveTab("notes")}>
                Notes {notesHook.notes.length > 0 && <span className="ml-1 text-[10px] opacity-60">({notesHook.notes.length})</span>}
              </DesktopTabButton>
              <DesktopTabButton active={activeTab === "activity"} onClick={() => setActiveTab("activity")}>
                Activity {bgTasks.length > 0 && <span className="ml-1 text-[10px] opacity-60">({bgTasks.length})</span>}
              </DesktopTabButton>
            </div>

            {/* Tab Content */}
            {activeTab === "kanban" && (
              <KanbanTab
                workspaceId={workspaceId}
                boards={boards}
                tasks={tasks}
                sessions={sessions}
                providers={acp.providers}
                specialists={specialists}
                codebases={codebases}
                onRefresh={handleRefresh}
              />
            )}

            {activeTab === "notes" && (
              <div>
            <div className="flex items-center gap-2 mb-3">
                  <button
                    onClick={() => setNotesSubFilter("general")}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                      notesSubFilter === "general"
                      ? "text-[var(--dt-accent)] bg-[var(--dt-bg-active)]"
                      : "text-[var(--dt-text-secondary)] hover:text-[var(--dt-text-primary)] hover:bg-[var(--dt-bg-active)]/70"
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
                      ? "text-[var(--dt-accent)] bg-[var(--dt-bg-active)]"
                      : "text-[var(--dt-text-secondary)] hover:text-[var(--dt-text-primary)] hover:bg-[var(--dt-bg-active)]/70"
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
          ? "text-[var(--dt-accent)] bg-[var(--dt-bg-active)] border-b-2 border-b-[var(--dt-accent)]"
          : "text-[var(--dt-text-secondary)] hover:text-[var(--dt-text-primary)] hover:bg-[var(--dt-bg-active)]/70"
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
      <span className="text-[11px] text-[var(--dt-text-muted)]">
        {label}
        {sub && <span className="ml-1 text-[var(--dt-text-muted)]">· {sub}</span>}
      </span>
    </div>
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
        className="relative w-full max-w-5xl h-[80vh] bg-[var(--dt-bg-secondary)] border border-[var(--dt-border)] rounded shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-9 px-3 border-b border-[var(--dt-border)] flex items-center justify-between bg-[var(--dt-bg-tertiary)]">
          <span className="text-[12px] font-medium text-[var(--dt-text-primary)]">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--dt-bg-active)] text-[var(--dt-text-secondary)] hover:text-[var(--dt-accent-text)] transition-colors"
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
