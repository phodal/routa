"use client";

/**
 * Workspace Dashboard
 *
 * A command-center view for a single workspace. Unlike the home page
 * (which is a task-first input), this page surfaces the workspace's
 * operational state at a glance:
 *
 *   - Active agents, tasks, sessions
 *   - Notes and specs
 *   - Codebases linked
 *   - Quick actions: new session, create task, add note
 *   - Trace activity feed
 *
 * Route: /workspace/[workspaceId]
 */

import React, { useCallback, useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { HomeInput } from "@/client/components/home-input";
import { useWorkspaces, useCodebases } from "@/client/hooks/use-workspaces";
import { useAcp } from "@/client/hooks/use-acp";
import { useAgentsRpc } from "@/client/hooks/use-agents-rpc";
import { useNotes, type NoteData } from "@/client/hooks/use-notes";
import { useSkills } from "@/client/hooks/use-skills";
import { AppHeader } from "@/client/components/app-header";
import { AgentInstallPanel } from "@/client/components/agent-install-panel";
import type { A2UIMessage } from "@/client/a2ui/types";
import {SessionsOverview} from "@/app/workspace/[workspaceId]/sessions-overview";
import {BackgroundTaskInfo, TaskInfo, TraceInfo, SessionInfo, KanbanBoardInfo} from "@/app/workspace/[workspaceId]/types";
import {NoteTasksTab} from "@/app/workspace/[workspaceId]/note-tasks-tab";
import {NotesTab} from "@/app/workspace/[workspaceId]/notes-tab";
import {OverviewA2UITab} from "@/app/workspace/[workspaceId]/overview-a2ui-tab";
import {BgTasksTab} from "@/app/workspace/[workspaceId]/bg-tasks-tab";
import {KanbanTab} from "@/app/workspace/[workspaceId]/kanban-tab";

interface SpecialistOption {
  id: string;
  name: string;
  role: string;
}

export function WorkspacePageClient({
  initialTab = "overview",
}: {
  initialTab?: "overview" | "kanban" | "notes" | "note_tasks" | "bg_tasks";
}) {
  const router = useRouter();
  const params = useParams();
  const workspaceId = params.workspaceId as string;

  const workspacesHook = useWorkspaces();
  const acp = useAcp();
  const { codebases } = useCodebases(workspaceId);
  const agentsHook = useAgentsRpc(workspaceId);
  const notesHook = useNotes(workspaceId);
  const skillsHook = useSkills();

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [boards, setBoards] = useState<KanbanBoardInfo[]>([]);
  const [traces, setTraces] = useState<TraceInfo[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showAgentInstallPopup, setShowAgentInstallPopup] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "kanban" | "notes" | "note_tasks" | "bg_tasks">(initialTab);
  const [showA2UISource, setShowA2UISource] = useState(false);
  const [customA2UISurfaces, setCustomA2UISurfaces] = useState<A2UIMessage[]>([]);
  const [bgTasks, setBgTasks] = useState<BackgroundTaskInfo[]>([]);
  const [specialists, setSpecialists] = useState<SpecialistOption[]>([]);
  // Sessions modal state
  const [showSessionsModal, setShowSessionsModal] = useState(false);
  const [sessionsPage, setSessionsPage] = useState(1);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);

  // Auto-connect ACP
  useEffect(() => {
    if (!acp.connected && !acp.loading) {
      acp.connect();
    }
  }, [acp.connected, acp.loading]);

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

  // Fetch all sessions for modal (with pagination)
  useEffect(() => {
    if (!showSessionsModal) return;
    (async () => {
      try {
        const limit = 50;
        const offset = (sessionsPage - 1) * limit;
        const res = await fetch(`/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}&limit=${limit}&offset=${offset}`, { cache: "no-store" });
        const data = await res.json();
        const newSessions = Array.isArray(data?.sessions) ? data.sessions : [];
        setAllSessions(prev => sessionsPage === 1 ? newSessions : [...prev, ...newSessions]);
        setHasMoreSessions(newSessions.length === limit);
      } catch { /* ignore */ }
    })();
  }, [workspaceId, showSessionsModal, sessionsPage]);

  // Fetch tasks
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
        const data = await res.json();
        setTasks(Array.isArray(data?.tasks) ? data.tasks : []);
      } catch { /* ignore */ }
    })();
  }, [workspaceId, refreshKey]);

  // Fetch boards
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/kanban/boards?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
        const data = await res.json();
        setBoards(Array.isArray(data?.boards) ? data.boards : []);
      } catch { /* ignore */ }
    })();
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

  // Fetch specialists for ACP assignment in Kanban
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

  // Fetch traces
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/traces?limit=10`, { cache: "no-store" });
        const data = await res.json();
         
        setTraces(Array.isArray(data?.traces) ? data.traces.slice(0, 8).map((t: any) => ({
          id: t.id,
          agentName: t.contributor?.provider ?? t.agentName ?? undefined,
          action: t.eventType ?? t.action ?? undefined,
          summary: t.conversation?.contentPreview?.slice(0, 100) ?? t.summary ?? undefined,
          createdAt: t.timestamp ?? t.createdAt,
        })) : []);
      } catch { /* ignore */ }
    })();
  }, [workspaceId, refreshKey]);

  // Verify workspace
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

  if (workspacesHook.loading && !isDefaultWorkspace) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#fafafa] dark:bg-[#0a0c12]">
        <div className="flex items-center gap-3 text-gray-400 dark:text-gray-500">
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

  const effectiveWorkspace = workspace ?? {
    id: "default",
    title: "Default Workspace",
    status: "active" as const,
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // ─── Computed stats ──────────────────────────────────────────────
  const activeAgents = agentsHook.agents.filter((a) => a.status === "ACTIVE");
  const pendingTasks = tasks.filter((t) => t.status === "PENDING" || t.status === "IN_PROGRESS");
  const runningBgTasks = bgTasks.filter((t) => t.status === "RUNNING").length;

  const handleCreateTask = async (title: string, objective: string, sessionId?: string) => {
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, objective, workspaceId, sessionId }),
    });
    setRefreshKey((k) => k + 1);
  };

  const handleDeleteTaskEntry = async (taskId: string) => {
    await fetch(`/api/tasks?taskId=${encodeURIComponent(taskId)}`, { method: "DELETE" });
    setRefreshKey((k) => k + 1);
  };

  const handleUpdateTaskStatus = async (taskId: string, status: string) => {
    await fetch(`/api/tasks/${encodeURIComponent(taskId)}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setRefreshKey((k) => k + 1);
  };

  const handleDeleteAllSessions = async () => {
    await Promise.all(
      sessions.map((s) =>
        fetch(`/api/sessions/${encodeURIComponent(s.sessionId)}`, { method: "DELETE" })
      )
    );
    setRefreshKey((k) => k + 1);
  };

  const handleDeleteAllGeneralNotes = async () => {
    await Promise.all(
      notesHook.notes
        .filter((n) => n.metadata?.type === "general")
        .map((n) =>
          fetch(`/api/notes?noteId=${encodeURIComponent(n.id)}&workspaceId=${encodeURIComponent(workspaceId)}`, { method: "DELETE" })
        )
    );
    setRefreshKey((k) => k + 1);
  };

  const handleDeleteAllTaskNotes = async () => {
    await Promise.all(
      notesHook.notes
        .filter((n) => n.metadata?.type === "task")
        .map((n) =>
          fetch(`/api/notes?noteId=${encodeURIComponent(n.id)}&workspaceId=${encodeURIComponent(workspaceId)}`, { method: "DELETE" })
        )
    );
    setRefreshKey((k) => k + 1);
  };

  const handleUpdateNoteMetadata = async (noteId: string, metadata: Record<string, unknown>) => {
    await notesHook.updateNote(noteId, { metadata });
  };

  const handleDeleteAllTasks = async () => {
    await Promise.all(
      tasks.map((t) =>
        fetch(`/api/tasks?taskId=${encodeURIComponent(t.id)}`, { method: "DELETE" })
      )
    );
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="h-screen flex flex-col bg-[#fafafa] dark:bg-[#0a0c12]">
      {/* ─── Top Bar ───────────────────────────────────────────────── */}
      <AppHeader
        workspaceId={workspaceId}
        workspaceTitle={effectiveWorkspace.title}
        workspaces={workspacesHook.workspaces}
        workspacesLoading={workspacesHook.loading}
        onWorkspaceSelect={handleWorkspaceSelect}
        onWorkspaceCreate={handleWorkspaceCreate}
        variant="dashboard"
        rightSlot={
          <>
            <button
              onClick={() => setShowAgentInstallPopup(true)}
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#191c28] transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Agents
            </button>
            <a href="/mcp-tools" className="hidden md:inline-flex px-2.5 py-1.5 rounded-md text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#191c28] transition-colors">
              MCP
            </a>
            <a href="/traces" className="hidden md:inline-flex px-2.5 py-1.5 rounded-md text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#191c28] transition-colors">
              Traces
            </a>
            <a href={`/workspace/${workspaceId}/kanban`} className="hidden md:inline-flex px-2.5 py-1.5 rounded-md text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#191c28] transition-colors">
              Board
            </a>
            <a href="/settings" className="p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#191c28] transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </a>
          </>
        }
      />

      {/* ─── Dashboard Body ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-6">

          {/* Quick Input */}
          <div className="mb-8">
            <HomeInput
              workspaceId={workspaceId}
              onSessionCreated={() => {
                setRefreshKey((k) => k + 1);
              }}
            />
          </div>

          {/* ─── Sessions Overview ────────────────────────────────────── */}
          {sessions.length > 0 && (
            <div className="mb-8">
              <SessionsOverview
                sessions={sessions}
                workspaceId={workspaceId}
                onNavigate={(sessionId) => router.push(`/workspace/${workspaceId}/sessions/${sessionId}`)}
                onRefresh={() => setRefreshKey((k) => k + 1)}
              />
            </div>
          )}

          {/* ─── Stat Cards ──────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            <StatCard
              label="Sessions"
              value={sessions.length}
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
                </svg>
              }
              color="blue"
            />
            <StatCard
              label="Agents"
              value={agentsHook.agents.length}
              sub={activeAgents.length > 0 ? `${activeAgents.length} active` : undefined}
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                </svg>
              }
              color="violet"
            />
            <StatCard
              label="Tasks"
              value={tasks.length}
              sub={pendingTasks.length > 0 ? `${pendingTasks.length} in progress` : undefined}
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
              color="emerald"
            />
            <StatCard
              label="BG Tasks"
              value={bgTasks.length}
              sub={runningBgTasks > 0 ? `${runningBgTasks} running` : undefined}
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
              color="amber"
            />
          </div>

          {/* ─── Tab Bar ─────────────────────────────────────────────── */}
          <div className="flex items-center gap-1 mb-6 border-b border-gray-200/60 dark:border-[#191c28]">
            <TabButton active={activeTab === "overview"} onClick={() => setActiveTab("overview")}>
              Overview
              <span className="ml-1.5 px-1.5 py-0.5 text-[9px] rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-semibold uppercase tracking-wider">
                A2UI
              </span>
            </TabButton>
            <TabButton active={activeTab === "kanban"} onClick={() => setActiveTab("kanban")}>
              Kanban
              {tasks.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full bg-gray-100 dark:bg-[#191c28] text-gray-500 dark:text-gray-400 font-mono">
                  {tasks.length}
                </span>
              )}
            </TabButton>
            <TabButton active={activeTab === "notes"} onClick={() => setActiveTab("notes")}>
              Workspace Notes
              {notesHook.notes.filter(n => n.metadata?.type === "general").length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full bg-gray-100 dark:bg-[#191c28] text-gray-500 dark:text-gray-400 font-mono">
                  {notesHook.notes.filter(n => n.metadata?.type === "general").length}
                </span>
              )}
            </TabButton>
            <TabButton active={activeTab === "note_tasks"} onClick={() => setActiveTab("note_tasks")}>
              Note Tasks
              {notesHook.notes.filter(n => n.metadata?.type === "task").length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full bg-gray-100 dark:bg-[#191c28] text-gray-500 dark:text-gray-400 font-mono">
                  {notesHook.notes.filter(n => n.metadata?.type === "task").length}
                </span>
              )}
            </TabButton>
            <TabButton active={activeTab === "bg_tasks"} onClick={() => setActiveTab("bg_tasks")}>
              Background Tasks
              {bgTasks.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full bg-gray-100 dark:bg-[#191c28] text-gray-500 dark:text-gray-400 font-mono">
                  {bgTasks.length}
                </span>
              )}
            </TabButton>
          </div>

          {/* ─── Tab Content ─────────────────────────────────────────── */}
          {activeTab === "overview" && (
            <OverviewA2UITab
              workspace={effectiveWorkspace}
              sessions={sessions}
              agents={agentsHook.agents}
              tasks={tasks}
              bgTasks={bgTasks}
              codebases={codebases}
              notes={notesHook.notes}
              traces={traces}
              skills={skillsHook.skills}
              customSurfaces={customA2UISurfaces}
              showSource={showA2UISource}
              onToggleSource={() => setShowA2UISource((v) => !v)}
              onAction={(action) => {
                if (action.name === "install_agent") {
                  setShowAgentInstallPopup(true);
                } else if (action.name === "new_session") {
                  // Scroll to top where the chat input is
                  window.scrollTo({ top: 0, behavior: "smooth" });
                } else if (action.name === "view_task") {
                  // Navigate to note-tasks tab
                  setActiveTab("note_tasks");
                } else {
                  console.log("[A2UI Action]", action);
                }
              }}
              onAddCustomSurface={(messages) => {
                setCustomA2UISurfaces((prev) => [...prev, ...messages]);
              }}
              onInstallAgent={() => setShowAgentInstallPopup(true)}
              onDeleteAllSessions={handleDeleteAllSessions}
              onNavigateSession={(sessionId) => router.push(`/workspace/${workspaceId}/sessions/${sessionId}`)}
            />
          )}

          {activeTab === "bg_tasks" && (
            <BgTasksTab
              bgTasks={bgTasks}
              workspaceId={workspaceId}
              workspaces={workspacesHook.workspaces}
              onRefresh={() => setRefreshKey((k) => k + 1)}
            />
          )}

          {activeTab === "kanban" && (
            <KanbanTab
              workspaceId={workspaceId}
              boards={boards}
              tasks={tasks}
              sessions={sessions}
              providers={acp.providers}
              specialists={specialists}
              codebases={codebases}
              onRefresh={() => setRefreshKey((k) => k + 1)}
            />
          )}

          {activeTab === "notes" && (
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

          {activeTab === "note_tasks" && (
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
      </div>

      {/* Agent Install Popup */}
      {showAgentInstallPopup && (
        <OverlayModal onClose={() => setShowAgentInstallPopup(false)} title="Install Agents">
          <AgentInstallPanel />
        </OverlayModal>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-2 text-[13px] font-medium border-b-2 transition-colors ${
        active
          ? "text-gray-900 dark:text-gray-100 border-amber-500"
          : "text-gray-400 dark:text-gray-500 border-transparent hover:text-gray-600 dark:hover:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"
      }`}
    >
      {children}
    </button>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon,
  color,
}: {
  label: string;
  value: number;
  sub?: string;
  icon: React.ReactNode;
  color: "blue" | "violet" | "emerald" | "amber";
}) {
  const bgMap = {
    blue: "bg-blue-50 dark:bg-blue-900/15",
    violet: "bg-violet-50 dark:bg-violet-900/15",
    emerald: "bg-emerald-50 dark:bg-emerald-900/15",
    amber: "bg-amber-50 dark:bg-amber-900/15",
  };
  const textMap = {
    blue: "text-blue-600 dark:text-blue-400",
    violet: "text-violet-600 dark:text-violet-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
  };

  return (
    <div className="flex items-center gap-3 p-4 rounded-xl bg-white dark:bg-[#12141c] border border-gray-200/60 dark:border-[#1c1f2e] hover:shadow-sm transition-shadow">
      <div className={`w-9 h-9 rounded-lg ${bgMap[color]} flex items-center justify-center shrink-0 ${textMap[color]}`}>
        {icon}
      </div>
      <div>
        <div className="text-xl font-bold text-gray-900 dark:text-gray-100 tabular-nums leading-none">{value}</div>
        <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
          {label}
          {sub && <span className="ml-1 text-gray-300 dark:text-gray-600">· {sub}</span>}
        </div>
      </div>
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
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        className="relative w-full max-w-5xl h-[80vh] bg-white dark:bg-[#12141c] border border-gray-200 dark:border-[#1c1f2e] rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-11 px-4 border-b border-gray-100 dark:border-[#191c28] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</span>
            <a
              href="/settings/agents"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              Open in new tab
            </a>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-[#191c28] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="Close (Esc)"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="h-[calc(80vh-44px)]">{children}</div>
      </div>
    </div>
  );
}
