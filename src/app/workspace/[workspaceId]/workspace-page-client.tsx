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
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { AgentInstallPanel } from "@/client/components/agent-install-panel";
import { ProtocolBadge } from "@/app/protocol-badge";
import { A2UIViewer } from "@/client/a2ui/renderer";
import { generateDashboardA2UI, generateTaskKanbanSurface, generateAgentMonitorSurface, generateTimelineSurface, generateWorkspaceSummarySurface } from "@/client/a2ui/dashboard-generator";
import type { A2UIMessage } from "@/client/a2ui/types";
import type { DashboardData } from "@/client/a2ui/dashboard-generator";

// ─── Types ─────────────────────────────────────────────────────────

interface SessionInfo {
  sessionId: string;
  name?: string;
  cwd: string;
  workspaceId: string;
  provider?: string;
  role?: string;
  createdAt: string;
}

interface TaskInfo {
  id: string;
  title: string;
  objective?: string;
  status: string;
  assignedTo?: string;
  sessionId?: string;
  createdAt: string;
}

interface BackgroundTaskInfo {
  id: string;
  title: string;
  prompt: string;
  agentId: string;
  status: string;
  triggerSource?: string;
  priority?: string;
  resultSessionId?: string;
  errorMessage?: string;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  lastActivity?: string;
  currentActivity?: string;
  toolCallCount?: number;
  inputTokens?: number;
  outputTokens?: number;
}

interface TraceInfo {
  id: string;
  agentName?: string;
  agentRole?: string;
  action?: string;
  summary?: string;
  durationMs?: number;
  createdAt: string;
}

// ─── Main Component ────────────────────────────────────────────────

export function WorkspacePageClient() {
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
  const [traces, setTraces] = useState<TraceInfo[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showAgentInstallPopup, setShowAgentInstallPopup] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "notes" | "note_tasks" | "bg_tasks">("overview");
  const [showA2UISource, setShowA2UISource] = useState(false);
  const [customA2UISurfaces, setCustomA2UISurfaces] = useState<A2UIMessage[]>([]);
  const [bgTasks, setBgTasks] = useState<BackgroundTaskInfo[]>([]);
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [dispatchPrompt, setDispatchPrompt] = useState("");
  const [dispatchAgentId, setDispatchAgentId] = useState("");
  const [dispatchPriority, setDispatchPriority] = useState("NORMAL");
  const [dispatchTitle, setDispatchTitle] = useState("");
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  // BG task management state
  const [bgTaskFilter, setBgTaskFilter] = useState<"all" | "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED">("all");
  const [bgSourceFilter, setBgSourceFilter] = useState<"all" | "manual" | "schedule" | "webhook" | "polling" | "workflow" | "fleet">("all");
  const [editingTask, setEditingTask] = useState<BackgroundTaskInfo | null>(null);
  const [editForm, setEditForm] = useState({ title: "", prompt: "", agentId: "", priority: "NORMAL" });
  const [editLoading, setEditLoading] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [bgAutoRefresh, setBgAutoRefresh] = useState(false);
  // Dispatch modal extras
  const [dispatchWorkspaceId, setDispatchWorkspaceId] = useState(workspaceId);
  const [specialists, setSpecialists] = useState<{ id: string; name: string; description?: string }[]>([]);

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
        const res = await fetch(`/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}&limit=20`, { cache: "no-store" });
        const data = await res.json();
        setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
      } catch { /* ignore */ }
    })();
  }, [workspaceId, refreshKey]);

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

  // Auto-refresh background tasks every 10 s when enabled
  useEffect(() => {
    if (!bgAutoRefresh) return;
    const timer = setInterval(() => setRefreshKey((k) => k + 1), 10_000);
    return () => clearInterval(timer);
  }, [bgAutoRefresh]);

  // Fetch traces
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/traces?limit=10`, { cache: "no-store" });
        const data = await res.json();
        setTraces(Array.isArray(data?.traces) ? data.traces.slice(0, 8) : []);
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

  // Fetch specialists for the dispatch modal agent selector
  useEffect(() => {
    fetch("/api/specialists")
      .then((r) => r.json())
      .then((d) => setSpecialists((d.specialists ?? []).filter((s: { enabled?: boolean }) => s.enabled !== false)))
      .catch(() => {});
  }, []);

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
  const specNotes = notesHook.notes.filter((n) => n.metadata?.type === "spec");
  const runningBgTasks = bgTasks.filter((t) => t.status === "RUNNING").length;

  const handleDispatchTask = async () => {
    if (!dispatchPrompt.trim() || !dispatchAgentId.trim()) return;
    setDispatchLoading(true);
    try {
      await fetch("/api/background-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: dispatchPrompt,
          agentId: dispatchAgentId,
          workspaceId: dispatchWorkspaceId || workspaceId,
          title: dispatchTitle.trim() || dispatchPrompt.slice(0, 80),
          priority: dispatchPriority,
        }),
      });
      setShowDispatchModal(false);
      setDispatchPrompt("");
      setDispatchAgentId("");
      setDispatchTitle("");
      setDispatchPriority("NORMAL");
      setDispatchWorkspaceId(workspaceId);
      setDuplicateWarning(null);
      setRefreshKey((k) => k + 1);
    } finally {
      setDispatchLoading(false);
    }
  };

  const handleRerunTask = async (task: BackgroundTaskInfo) => {
    await fetch("/api/background-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: task.prompt,
        agentId: task.agentId,
        workspaceId,
        title: task.title,
        priority: task.priority ?? "NORMAL",
        triggerSource: "manual",
        triggeredBy: "rerun",
      }),
    });
    setRefreshKey((k) => k + 1);
  };

  const handleCheckDuplicate = (prompt: string, agentId: string) => {
    if (!prompt.trim() || !agentId.trim()) { setDuplicateWarning(null); return; }
    const promptKey = prompt.trim().slice(0, 120).toLowerCase();
    const dupe = bgTasks.find(
      (t) =>
        t.status === "PENDING" &&
        t.agentId === agentId.trim() &&
        t.prompt.slice(0, 120).toLowerCase() === promptKey
    );
    setDuplicateWarning(dupe ? `Duplicate: task "${dupe.title}" is already PENDING.` : null);
  };

  const handleEditTask = async () => {
    if (!editingTask) return;
    setEditLoading(true);
    try {
      await fetch(`/api/background-tasks/${editingTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      setEditingTask(null);
      setRefreshKey((k) => k + 1);
    } finally {
      setEditLoading(false);
    }
  };

  // PENDING tasks: hard delete (they haven't started running)
  // RUNNING tasks: soft cancel → CANCELLED status
  const handleCancelTask = async (taskId: string) => {
    await fetch(`/api/background-tasks/${taskId}`, { method: "DELETE" });
    setRefreshKey((k) => k + 1);
  };

  // Force-fail a stale RUNNING task (session is dead but still marked RUNNING)
  const handleForceFailTask = async (taskId: string) => {
    await fetch(`/api/background-tasks/${taskId}?force=true`, { method: "DELETE" });
    setRefreshKey((k) => k + 1);
  };

  const handleDeleteTask = async (taskId: string) => {
    await fetch(`/api/background-tasks/${taskId}`, { method: "DELETE" });
    setRefreshKey((k) => k + 1);
  };

  const handleClearHistory = async () => {
    setClearingHistory(true);
    try {
      const terminalStatuses = ["COMPLETED", "CANCELLED", "FAILED"];
      const requests: Promise<Response>[] = terminalStatuses.map((status) =>
        fetch("/api/background-tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "deleteByStatus", status, workspaceId }),
        })
      );
      // Clear ALL PENDING tasks (polling backlog, stale scheduled/workflow/webhook queues)
      requests.push(
        fetch("/api/background-tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "deleteByStatus", status: "PENDING", workspaceId }),
        })
      );
      await Promise.all(requests);
      setRefreshKey((k) => k + 1);
    } finally {
      setClearingHistory(false);
    }
  };

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
      <header className="h-12 shrink-0 flex items-center px-5 border-b border-gray-200/60 dark:border-[#191c28] bg-white/80 dark:bg-[#0e1019]/80 backdrop-blur-md z-20">
        <a href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
          <img src="/logo.svg" alt="Routa" width={24} height={24} className="rounded-md" />
          <span className="text-[13px] font-semibold text-gray-800 dark:text-gray-200 tracking-tight">Routa</span>
        </a>

        <svg className="w-4 h-4 mx-2.5 text-gray-300 dark:text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>

        {/* Workspace name + switcher */}
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          <span className="text-[13px] font-medium text-gray-700 dark:text-gray-300 truncate max-w-[180px]">
            {effectiveWorkspace.title}
          </span>
          <WorkspaceSwitcher
            workspaces={workspacesHook.workspaces}
            activeWorkspaceId={workspaceId}
            onSelect={handleWorkspaceSelect}
            onCreate={handleWorkspaceCreate}
            loading={workspacesHook.loading}
            compact
          />
        </div>

        <div className="flex-1" />

        {/* Protocol badges */}
        <div className="hidden lg:flex items-center gap-2 mr-3">
          <ProtocolBadge name="MCP" endpoint="/api/mcp" />
          <ProtocolBadge name="ACP" endpoint="/api/acp" />
        </div>

        <button
          onClick={() => setShowAgentInstallPopup(true)}
          className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#191c28] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Agents
        </button>

        <a
          href="/mcp-tools"
          className="hidden md:inline-flex px-2.5 py-1.5 rounded-md text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#191c28] transition-colors"
        >
          MCP
        </a>
        <a
          href="/traces"
          className="hidden md:inline-flex px-2.5 py-1.5 rounded-md text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#191c28] transition-colors"
        >
          Traces
        </a>
        <a
          href="/settings"
          className="p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#191c28] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </a>
      </header>

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
                console.log("[A2UI Action]", action);
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
            <div className="space-y-4">
              {/* ── Header row ───────────────────────────────────── */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-[14px] font-semibold text-gray-700 dark:text-gray-300">Background Task Queue</h2>
                <div className="flex items-center gap-2">
                  {/* Auto-refresh toggle */}
                  <button
                    onClick={() => setBgAutoRefresh((v) => !v)}
                    title={bgAutoRefresh ? "Auto-refresh ON (10s)" : "Auto-refresh OFF"}
                    className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                      bgAutoRefresh
                        ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                        : "text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-[#191c28]"
                    }`}
                  >
                    <svg className={`w-3.5 h-3.5 ${bgAutoRefresh ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {bgAutoRefresh ? "Live" : "Refresh"}
                  </button>
                  {/* Manual refresh */}
                  <button
                    onClick={() => setRefreshKey((k) => k + 1)}
                    className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#191c28] transition-colors"
                    title="Refresh now"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                  {/* Clear history — clears terminal-state tasks + ALL pending tasks */}
                  {(() => {
                    const clearableCount = bgTasks.filter((t) =>
                      ["COMPLETED", "CANCELLED", "FAILED", "PENDING"].includes(t.status)
                    ).length;
                    if (clearableCount === 0) return null;
                    const hasPending = bgTasks.some((t) => t.status === "PENDING");
                    return (
                      <button
                        onClick={handleClearHistory}
                        disabled={clearingHistory}
                        title={`Clear ${clearableCount} tasks: all PENDING + COMPLETED/CANCELLED/FAILED`}
                        className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        {clearingHistory ? "Clearing…" : `Clear${hasPending ? " All" : " History"} (${clearableCount})`}
                      </button>
                    );
                  })()}
                  {/* Dispatch */}
                  <button
                    data-testid="dispatch-task-btn"
                    onClick={() => setShowDispatchModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-amber-500 hover:bg-amber-600 text-white transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Dispatch Task
                  </button>
                </div>
              </div>

              {/* ── Stats bar ─────────────────────────────────────── */}
              {bgTasks.length > 0 && (() => {
                const counts = { PENDING: 0, RUNNING: 0, COMPLETED: 0, FAILED: 0, CANCELLED: 0 };
                for (const t of bgTasks) { if (t.status in counts) (counts as Record<string, number>)[t.status]++; }
                const srcCounts: Record<string, number> = {};
                for (const t of bgTasks) { srcCounts[t.triggerSource ?? "manual"] = (srcCounts[t.triggerSource ?? "manual"] ?? 0) + 1; }
                return (
                  <div className="space-y-1.5">
                    {/* Status filter */}
                    <div className="flex gap-2 flex-wrap">
                      {(["all", "PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"] as const).map((s) => {
                        const cnt = s === "all" ? bgTasks.length : counts[s];
                        if (s !== "all" && cnt === 0) return null;
                        const active = bgTaskFilter === s;
                        const colorMap: Record<string, string> = {
                          all: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300",
                          PENDING: "bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400",
                          RUNNING: "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
                          COMPLETED: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400",
                          FAILED: "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400",
                          CANCELLED: "bg-gray-100 dark:bg-gray-700/30 text-gray-400",
                        };
                        return (
                          <button
                            key={s}
                            onClick={() => setBgTaskFilter(s)}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border ${
                              active
                                ? "ring-2 ring-amber-400 border-amber-400 " + colorMap[s]
                                : "border-transparent " + colorMap[s] + " hover:opacity-80"
                            }`}
                          >
                            <span className="capitalize">{s === "all" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}</span>
                            <span className="font-bold">{cnt}</span>
                          </button>
                        );
                      })}
                    </div>
                    {/* Source / trigger-type filter */}
                    {Object.keys(srcCounts).length > 1 && (
                      <div className="flex gap-1.5 flex-wrap items-center">
                        <span className="text-[10px] text-gray-400 dark:text-gray-600 mr-0.5">Source:</span>
                        {(["all", "manual", "schedule", "webhook", "polling", "workflow", "fleet"] as const).map((src) => {
                          const cnt = src === "all" ? bgTasks.length : (srcCounts[src] ?? 0);
                          if (src !== "all" && cnt === 0) return null;
                          const active = bgSourceFilter === src;
                          const srcLabel: Record<string, string> = { all: "All", manual: "Manual", schedule: "Scheduled", webhook: "Webhook", polling: "Polling", workflow: "Workflow", fleet: "Fleet" };
                          const srcColor: Record<string, string> = {
                            all: "text-gray-500 dark:text-gray-400",
                            manual: "text-violet-600 dark:text-violet-400",
                            schedule: "text-amber-600 dark:text-amber-400",
                            webhook: "text-blue-600 dark:text-blue-400",
                            polling: "text-teal-600 dark:text-teal-400",
                            workflow: "text-indigo-600 dark:text-indigo-400",
                            fleet: "text-pink-600 dark:text-pink-400",
                          };
                          return (
                            <button
                              key={src}
                              onClick={() => setBgSourceFilter(src)}
                              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-all border ${
                                active
                                  ? "border-amber-400 ring-1 ring-amber-400 " + srcColor[src]
                                  : "border-gray-200 dark:border-[#252838] " + srcColor[src] + " hover:opacity-80"
                              }`}
                            >
                              {srcLabel[src]} <span className="opacity-70">{cnt}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Task list ─────────────────────────────────────── */}
              {(() => {
                let filtered = bgTaskFilter === "all" ? bgTasks : bgTasks.filter((t) => t.status === bgTaskFilter);
                if (bgSourceFilter !== "all") filtered = filtered.filter((t) => (t.triggerSource ?? "manual") === bgSourceFilter);
                if (filtered.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-600">
                      <svg className="w-10 h-10 mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-[13px]">{bgTasks.length === 0 ? "No background tasks yet." : `No ${bgTaskFilter} tasks.`}</p>
                      {bgTasks.length === 0 && <p className="text-[11px] mt-1">Click &ldquo;Dispatch Task&rdquo; to enqueue one.</p>}
                    </div>
                  );
                }
                return (
                  <div className="rounded-xl border border-gray-200/60 dark:border-[#191c28] bg-white dark:bg-[#0e1019] overflow-hidden divide-y divide-gray-100 dark:divide-[#191c28]">
                    {filtered.map((task) => {
                      const isExpanded = expandedTaskId === task.id;
                      return (
                        <div key={task.id} data-testid="bg-task-item">
                          {/* Main row */}
                          <div className="flex items-start gap-3 px-4 py-3">
                            <button
                              onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                              className="mt-0.5 shrink-0 hover:opacity-70 transition-opacity"
                              title={isExpanded ? "Collapse" : "Expand"}
                            >
                              <BgTaskStatusIcon status={task.status} />
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <div className="text-[13px] font-medium text-gray-700 dark:text-gray-300 truncate">{task.title}</div>
                                {task.priority && task.priority !== "NORMAL" && (
                                  <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                    task.priority === "HIGH"
                                      ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                                      : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                                  }`}>
                                    {task.priority}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-gray-400 dark:text-gray-500 flex items-center gap-2 flex-wrap">
                                <span className="font-mono">{task.agentId}</span>
                                {task.triggerSource && <><span>·</span><span className="capitalize">{task.triggerSource}</span></>}
                                {task.status === "RUNNING" && task.toolCallCount !== undefined && task.toolCallCount > 0 && (
                                  <><span>·</span><span className="text-amber-600 dark:text-amber-400">{task.toolCallCount} tools</span></>
                                )}
                                {task.status === "RUNNING" && task.currentActivity && (
                                  <><span>·</span><span className="text-amber-600 dark:text-amber-400 truncate max-w-[200px]">{task.currentActivity}</span></>
                                )}
                                {task.resultSessionId && (
                                  <><span>·</span>
                                  <button
                                    onClick={() => router.push(`/workspace/${workspaceId}/sessions/${task.resultSessionId}`)}
                                    className="text-blue-500 dark:text-blue-400 hover:underline"
                                  >
                                    view session
                                  </button></>
                                )}
                                {task.errorMessage && (
                                  <><span>·</span><span className="text-red-500 dark:text-red-400 truncate max-w-[240px]" title={task.errorMessage}>{task.errorMessage}</span></>
                                )}
                              </div>
                            </div>
                            {/* Right actions */}
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span data-testid="bg-task-status" className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${bgTaskStatusClass(task.status)}`}>
                                {task.status}
                              </span>
                              <span className="text-[10px] text-gray-400 dark:text-gray-600 font-mono w-12 text-right">{formatRelativeTime(task.createdAt)}</span>
                              {/* Edit (PENDING only) */}
                              {task.status === "PENDING" && (
                                <button
                                  onClick={() => {
                                    setEditingTask(task);
                                    setEditForm({ title: task.title, prompt: task.prompt, agentId: task.agentId, priority: task.priority ?? "NORMAL" });
                                  }}
                                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-[#191c28] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                                  title="Edit task"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                                  </svg>
                                </button>
                              )}
                              {/* Rerun — available for any terminal or failed state */}
                              {["COMPLETED", "CANCELLED", "FAILED"].includes(task.status) && (
                                <button
                                  onClick={() => handleRerunTask(task)}
                                  className="text-[10px] font-medium px-2 py-0.5 rounded bg-violet-500 hover:bg-violet-600 text-white transition-colors"
                                  title="Re-dispatch this task with the same prompt and agent"
                                >
                                  ↺ Rerun
                                </button>
                              )}
                              {/* Retry (FAILED) */}
                              {task.status === "FAILED" && task.attempts < task.maxAttempts && (
                                <button
                                  onClick={async () => {
                                    await fetch(`/api/background-tasks/${task.id}/retry`, { method: "POST" });
                                    setRefreshKey((k) => k + 1);
                                  }}
                                  className="text-[10px] font-medium px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-600 text-white transition-colors"
                                  title="Retry (increments attempt counter)"
                                >
                                  Retry
                                </button>
                              )}
                              {/* Cancel (PENDING/RUNNING) */}
                              {(task.status === "PENDING" || task.status === "RUNNING") && (
                                <button
                                  onClick={() => handleCancelTask(task.id)}
                                  className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors"
                                  title="Cancel task"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              )}
                              {/* Delete (terminal states) */}
                              {["COMPLETED", "CANCELLED", "FAILED"].includes(task.status) && (
                                <button
                                  onClick={() => handleDeleteTask(task.id)}
                                  className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors"
                                  title="Delete task"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>
                          {/* Expanded detail row */}
                          {isExpanded && (
                            <div className="px-4 pb-3 pt-0 border-t border-dashed border-gray-100 dark:border-[#252838] bg-gray-50/50 dark:bg-[#0a0c12]/30">
                              <div className="text-[11px] text-gray-500 dark:text-gray-400 space-y-1.5 mt-2">
                                <div><span className="font-semibold text-gray-600 dark:text-gray-300">Prompt:</span> <span className="whitespace-pre-wrap">{task.prompt}</span></div>
                                <div className="flex gap-4 flex-wrap">
                                  <span><span className="font-semibold">ID:</span> <code className="font-mono text-[10px]">{task.id}</code></span>
                                  <span><span className="font-semibold">Attempts:</span> {task.attempts}/{task.maxAttempts}</span>
                                  {task.inputTokens !== undefined && task.inputTokens > 0 && (
                                    <span><span className="font-semibold">Tokens:</span> {task.inputTokens}↑ {task.outputTokens}↓</span>
                                  )}
                                  {task.startedAt && <span><span className="font-semibold">Started:</span> {formatRelativeTime(task.startedAt)}</span>}
                                  {task.completedAt && <span><span className="font-semibold">Completed:</span> {formatRelativeTime(task.completedAt)}</span>}
                                </div>
                                {task.errorMessage && (
                                  <div className="text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded text-[11px]">
                                    <span className="font-semibold">Error:</span> {task.errorMessage}
                                  </div>
                                )}
                                {/* Force Fail — for RUNNING tasks stuck > 30 min (session likely dead) */}
                                {task.status === "RUNNING" && task.startedAt &&
                                  Date.now() - new Date(task.startedAt).getTime() > 30 * 60 * 1000 && (
                                  <div className="pt-1">
                                    <button
                                      onClick={() => handleForceFailTask(task.id)}
                                      className="text-[10px] font-medium px-2 py-1 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800/40 transition-colors"
                                      title="Force-fail this task — use when the session is gone but the task is still marked RUNNING"
                                    >
                                      ⚠ Force Fail (stale)
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* ── Dispatch modal ────────────────────────────────── */}
              {showDispatchModal && (
                <OverlayModal onClose={() => { setShowDispatchModal(false); setDuplicateWarning(null); }} title="Dispatch Background Task">
                  <div className="space-y-3 p-4">
                    {duplicateWarning && (
                      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                        <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                        </svg>
                        <span className="text-[12px] text-amber-700 dark:text-amber-400">{duplicateWarning}</span>
                      </div>
                    )}
                    <div>
                      <label className="block text-[12px] font-medium text-gray-600 dark:text-gray-400 mb-1">Title <span className="text-gray-400">(optional)</span></label>
                      <input
                        type="text"
                        placeholder="Short task title…"
                        value={dispatchTitle}
                        onChange={(e) => setDispatchTitle(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-[#252838] bg-gray-50 dark:bg-[#151720] text-[13px] text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-gray-600 dark:text-gray-400 mb-1">Prompt</label>
                      <textarea
                        data-testid="dispatch-prompt-input"
                        rows={4}
                        placeholder="Enter the task prompt…"
                        value={dispatchPrompt}
                        onChange={(e) => { setDispatchPrompt(e.target.value); handleCheckDuplicate(e.target.value, dispatchAgentId); }}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-[#252838] bg-gray-50 dark:bg-[#151720] text-[13px] text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600 resize-none focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[12px] font-medium text-gray-600 dark:text-gray-400 mb-1">Agent / Provider</label>
                        {specialists.length > 0 ? (
                          <select
                            data-testid="dispatch-agent-input"
                            value={dispatchAgentId}
                            onChange={(e) => { setDispatchAgentId(e.target.value); handleCheckDuplicate(dispatchPrompt, e.target.value); }}
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-[#252838] bg-gray-50 dark:bg-[#151720] text-[13px] text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                          >
                            <option value="">— Select agent —</option>
                            {specialists.map((s) => (
                              <option key={s.id} value={s.id}>{s.name}{s.description ? ` — ${s.description}` : ""}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            data-testid="dispatch-agent-input"
                            type="text"
                            placeholder="e.g. opencode, claude"
                            value={dispatchAgentId}
                            onChange={(e) => { setDispatchAgentId(e.target.value); handleCheckDuplicate(dispatchPrompt, e.target.value); }}
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-[#252838] bg-gray-50 dark:bg-[#151720] text-[13px] text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                          />
                        )}
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-gray-600 dark:text-gray-400 mb-1">Priority</label>
                        <select
                          value={dispatchPriority}
                          onChange={(e) => setDispatchPriority(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-[#252838] bg-gray-50 dark:bg-[#151720] text-[13px] text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                        >
                          <option value="LOW">Low</option>
                          <option value="NORMAL">Normal</option>
                          <option value="HIGH">High</option>
                        </select>
                      </div>
                    </div>
                    {/* Workspace selector */}
                    <div>
                      <label className="block text-[12px] font-medium text-gray-600 dark:text-gray-400 mb-1">Workspace</label>
                      <select
                        value={dispatchWorkspaceId}
                        onChange={(e) => setDispatchWorkspaceId(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-[#252838] bg-gray-50 dark:bg-[#151720] text-[13px] text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                      >
                        {workspacesHook.workspaces.map((w) => (
                          <option key={w.id} value={w.id}>{w.title || w.id}{w.id === workspaceId ? " (current)" : ""}</option>
                        ))}
                        {workspacesHook.workspaces.length === 0 && (
                          <option value={workspaceId}>{workspaceId} (current)</option>
                        )}
                      </select>
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={() => { setShowDispatchModal(false); setDuplicateWarning(null); }}
                        className="px-3 py-1.5 rounded-md text-[12px] font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#191c28] transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        data-testid="dispatch-submit-btn"
                        onClick={handleDispatchTask}
                        disabled={dispatchLoading || !dispatchPrompt.trim() || !dispatchAgentId.trim()}
                        className="px-3 py-1.5 rounded-md text-[12px] font-medium bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white transition-colors"
                      >
                        {dispatchLoading ? "Dispatching…" : "Dispatch"}
                      </button>
                    </div>
                  </div>
                </OverlayModal>
              )}

              {/* ── Edit modal ────────────────────────────────────── */}
              {editingTask && (
                <OverlayModal onClose={() => setEditingTask(null)} title="Edit Task">
                  <div className="space-y-3 p-4">
                    <div>
                      <label className="block text-[12px] font-medium text-gray-600 dark:text-gray-400 mb-1">Title</label>
                      <input
                        type="text"
                        value={editForm.title}
                        onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-[#252838] bg-gray-50 dark:bg-[#151720] text-[13px] text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-gray-600 dark:text-gray-400 mb-1">Prompt</label>
                      <textarea
                        rows={5}
                        value={editForm.prompt}
                        onChange={(e) => setEditForm((f) => ({ ...f, prompt: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-[#252838] bg-gray-50 dark:bg-[#151720] text-[13px] text-gray-700 dark:text-gray-300 resize-none focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[12px] font-medium text-gray-600 dark:text-gray-400 mb-1">Agent</label>
                        {specialists.length > 0 ? (
                          <select
                            value={editForm.agentId}
                            onChange={(e) => setEditForm((f) => ({ ...f, agentId: e.target.value }))}
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-[#252838] bg-gray-50 dark:bg-[#151720] text-[13px] text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                          >
                            <option value="">— Select agent —</option>
                            {specialists.map((s) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={editForm.agentId}
                            onChange={(e) => setEditForm((f) => ({ ...f, agentId: e.target.value }))}
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-[#252838] bg-gray-50 dark:bg-[#151720] text-[13px] text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                          />
                        )}
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-gray-600 dark:text-gray-400 mb-1">Priority</label>
                        <select
                          value={editForm.priority}
                          onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value }))}
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-[#252838] bg-gray-50 dark:bg-[#151720] text-[13px] text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                        >
                          <option value="LOW">Low</option>
                          <option value="NORMAL">Normal</option>
                          <option value="HIGH">High</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={() => setEditingTask(null)}
                        className="px-3 py-1.5 rounded-md text-[12px] font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#191c28] transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleEditTask}
                        disabled={editLoading || !editForm.prompt.trim() || !editForm.agentId.trim()}
                        className="px-3 py-1.5 rounded-md text-[12px] font-medium bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white transition-colors"
                      >
                        {editLoading ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                </OverlayModal>
              )}
            </div>
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

function DashboardCard({
  title,
  count,
  emptyText,
  action,
  children,
}: {
  title: string;
  count?: number;
  emptyText?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const isEmpty = count === 0;

  return (
    <div className="bg-white dark:bg-[#12141c] rounded-xl border border-gray-200/60 dark:border-[#1c1f2e] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-[#191c28]">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-gray-800 dark:text-gray-200">{title}</h3>
          {count !== undefined && count > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-[#191c28] text-[10px] font-mono text-gray-500 dark:text-gray-400">
              {count}
            </span>
          )}
        </div>
        {action}
      </div>
      {isEmpty ? (
        <div className="px-4 py-6 text-center text-[12px] text-gray-400 dark:text-gray-500">{emptyText}</div>
      ) : (
        <div className="divide-y divide-gray-50 dark:divide-[#151720]">{children}</div>
      )}
    </div>
  );
}

function TaskStatusIcon({ status }: { status: string }) {
  const s = status.toUpperCase();
  if (s === "COMPLETED") {
    return (
      <div className="w-7 h-7 rounded-md bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center shrink-0">
        <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>
    );
  }
  if (s === "IN_PROGRESS") {
    return (
      <div className="w-7 h-7 rounded-md bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center shrink-0">
        <div className="w-3 h-3 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
      </div>
    );
  }
  if (s === "BLOCKED" || s === "CANCELLED") {
    return (
      <div className="w-7 h-7 rounded-md bg-red-50 dark:bg-red-900/20 flex items-center justify-center shrink-0">
        <svg className="w-3.5 h-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
      </div>
    );
  }
  return (
    <div className="w-7 h-7 rounded-md bg-gray-100 dark:bg-[#191c28] flex items-center justify-center shrink-0">
      <div className="w-2.5 h-2.5 rounded-full border-2 border-gray-400 dark:border-gray-500" />
    </div>
  );
}

function TaskStatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const map: Record<string, string> = {
    PENDING: "bg-gray-100 dark:bg-gray-800 text-gray-500",
    IN_PROGRESS: "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
    REVIEW_REQUIRED: "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400",
    COMPLETED: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400",
    NEEDS_FIX: "bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400",
    BLOCKED: "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400",
    CANCELLED: "bg-gray-100 dark:bg-gray-800 text-gray-400",
  };

  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${map[s] || map.PENDING}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function AgentRoleIcon({ role }: { role: string }) {
  const r = role.toUpperCase();
  const colorMap: Record<string, string> = {
    ROUTA: "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400",
    DEVELOPER: "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400",
    CRAFTER: "bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400",
    GATE: "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400",
  };
  const cls = colorMap[r] || colorMap.DEVELOPER;

  return (
    <div className={`w-7 h-7 rounded-md ${cls} flex items-center justify-center shrink-0`}>
      <span className="text-[10px] font-bold">{r.charAt(0)}</span>
    </div>
  );
}

function AgentStatusDot({ status }: { status: string }) {
  const s = status.toUpperCase();
  const colorMap: Record<string, string> = {
    ACTIVE: "bg-emerald-500",
    PENDING: "bg-amber-400",
    COMPLETED: "bg-gray-400 dark:bg-gray-500",
    ERROR: "bg-red-500",
    CANCELLED: "bg-gray-300 dark:bg-gray-600",
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${colorMap[s] || colorMap.PENDING}`} />
      <span className="text-[10px] text-gray-400 dark:text-gray-500 capitalize">{status.toLowerCase()}</span>
    </div>
  );
}

// ─── Notes Tab (general notes only) ─────────────────────────────────────────

function NotesTab({
  notes,
  loading,
  workspaceId,
  sessions,
  onCreateNote,
  onUpdateNote,
  onDeleteNote,
  onDeleteAllNotes,
}: {
  notes: NoteData[];
  loading: boolean;
  workspaceId: string;
  sessions: SessionInfo[];
  onCreateNote: (title: string, content: string, sessionId?: string) => Promise<void>;
  onUpdateNote: (noteId: string, update: { title?: string; content?: string }) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onDeleteAllNotes: () => Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newSessionId, setNewSessionId] = useState("");
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: "", content: "" });
  const [editLoading, setEditLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [clearingNotes, setClearingNotes] = useState(false);

  const sortedNotes = [...notes].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const handleSubmit = async () => {
    if (!newTitle.trim()) return;
    setCreateLoading(true);
    try {
      await onCreateNote(newTitle.trim(), newContent.trim(), newSessionId || undefined);
      setNewTitle(""); setNewContent(""); setNewSessionId(""); setShowForm(false);
    } finally { setCreateLoading(false); }
  };

  const handleEdit = async (noteId: string) => {
    if (!editForm.title.trim()) return;
    setEditLoading(true);
    try {
      await onUpdateNote(noteId, { title: editForm.title.trim(), content: editForm.content });
      setEditingNoteId(null);
    } finally { setEditLoading(false); }
  };

  const handleDelete = async (noteId: string) => {
    setDeletingNoteId(noteId);
    try { await onDeleteNote(noteId); }
    finally { setDeletingNoteId(null); }
  };

  const handleClearAll = async () => {
    setClearingNotes(true);
    try { await onDeleteAllNotes(); }
    finally { setClearingNotes(false); }
  };

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Workspace Notes</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Free-form context documents for workspace: <span className="font-mono">{workspaceId}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {notes.length > 0 && (
            <button onClick={handleClearAll} disabled={clearingNotes}
              className="text-[11px] text-red-500 dark:text-red-400 hover:text-red-600 transition-colors disabled:opacity-50">
              {clearingNotes ? "Clearing…" : "Clear all"}
            </button>
          )}
          <button onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-amber-600 dark:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Note
          </button>
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="mb-6 p-4 bg-white dark:bg-[#12141c] rounded-xl border border-gray-200/60 dark:border-[#1c1f2e]">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Note title"
            className="w-full mb-3 px-3 py-2 rounded-lg border border-gray-200 dark:border-[#252838] bg-gray-50 dark:bg-[#0e1019] text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-amber-500/30 transition"
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Write your note… (Markdown supported)"
            rows={4}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-[#252838] bg-gray-50 dark:bg-[#0e1019] text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-amber-500/30 transition resize-none font-mono text-[13px]"
          />
          {sessions.length > 0 && (
            <div className="mt-3">
              <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">
                Bind to session <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <select value={newSessionId} onChange={(e) => setNewSessionId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-[#252838] bg-gray-50 dark:bg-[#0e1019] text-[13px] text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30">
                <option value="">— Workspace-wide —</option>
                {sessions.map((s) => (
                  <option key={s.sessionId} value={s.sessionId}>{s.name || s.provider || s.sessionId.slice(0, 12)}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2 mt-3">
            <button onClick={handleSubmit} disabled={!newTitle.trim() || createLoading}
              className="px-4 py-2 rounded-lg text-[12px] font-medium text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-40 transition-colors shadow-sm">
              {createLoading ? "Creating…" : "Create Note"}
            </button>
            <button onClick={() => { setShowForm(false); setNewTitle(""); setNewContent(""); setNewSessionId(""); }}
              className="px-4 py-2 rounded-lg text-[12px] font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Notes list */}
      {loading ? (
        <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">Loading notes…</div>
      ) : sortedNotes.length === 0 ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          <svg className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <p className="text-sm font-medium">No workspace notes yet</p>
          <p className="text-[12px] mt-1">Create free-form context documents for this workspace.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedNotes.map((note) => {
            const isExpanded = expandedNote === note.id;
            const isEditing = editingNoteId === note.id;
            return (
              <div key={note.id} className="bg-white dark:bg-[#12141c] rounded-xl border border-gray-200/60 dark:border-[#1c1f2e] overflow-hidden hover:shadow-sm transition-shadow">
                <div className="flex items-center gap-3 px-4 py-3">
                  <button onClick={() => setExpandedNote(isExpanded ? null : note.id)} className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                    <svg className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                  <span className="flex-1 text-[13px] font-medium text-gray-700 dark:text-gray-300 truncate">{note.title}</span>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-gray-100 dark:bg-gray-800 text-gray-500 shrink-0">Note</span>
                  {note.sessionId && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono shrink-0 truncate max-w-[80px]" title={note.sessionId}>
                      {note.sessionId.slice(0, 8)}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400 dark:text-gray-600 font-mono shrink-0 w-12 text-right">{formatRelativeTime(note.updatedAt)}</span>
                  <button onClick={() => { setEditingNoteId(note.id); setEditForm({ title: note.title, content: note.content }); setExpandedNote(note.id); }}
                    className="p-1 rounded hover:bg-gray-100 dark:hover:bg-[#191c28] text-gray-400 hover:text-gray-600 transition-colors shrink-0">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                    </svg>
                  </button>
                  <button onClick={() => handleDelete(note.id)} disabled={deletingNoteId === note.id}
                    className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50 shrink-0">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-gray-100 dark:border-[#191c28]">
                    {isEditing ? (
                      <div className="mt-3 space-y-2">
                        <input type="text" value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-[#252838] bg-gray-50 dark:bg-[#0e1019] text-sm text-gray-800 dark:text-gray-200 outline-none focus:ring-2 focus:ring-amber-500/30" />
                        <textarea rows={8} value={editForm.content} onChange={(e) => setEditForm((f) => ({ ...f, content: e.target.value }))}
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-[#252838] bg-gray-50 dark:bg-[#0e1019] text-[13px] text-gray-800 dark:text-gray-200 outline-none focus:ring-2 focus:ring-amber-500/30 resize-none font-mono" />
                        <div className="flex gap-2">
                          <button onClick={() => handleEdit(note.id)} disabled={editLoading || !editForm.title.trim()}
                            className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-40 transition-colors">
                            {editLoading ? "Saving…" : "Save"}
                          </button>
                          <button onClick={() => setEditingNoteId(null)}
                            className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <pre className="mt-3 text-[12px] text-gray-600 dark:text-gray-400 whitespace-pre-wrap font-mono leading-relaxed max-h-56 overflow-y-auto">
                        {note.content || "(empty)"}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Note Tasks Tab ───────────────────────────────────────────────────────────
// Shows spec notes (as parent context) + task-type notes derived from @@@task blocks.
// Task notes have metadata.parentNoteId → spec note, metadata.taskStatus, metadata.linkedTaskId.

function NoteTasksTab({
  notes,
  loading,
  sessions: _sessions,
  onDeleteNote,
  onUpdateNoteMetadata,
  onDeleteAllTaskNotes,
}: {
  notes: NoteData[];
  loading: boolean;
  workspaceId: string;
  sessions: SessionInfo[];
  onDeleteNote: (noteId: string) => Promise<void>;
  onUpdateNoteMetadata: (noteId: string, metadata: Record<string, unknown>) => Promise<void>;
  onDeleteAllTaskNotes: () => Promise<void>;
}) {
  const specNotes = notes.filter(n => n.metadata?.type === "spec").sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const taskNotes = notes.filter(n => n.metadata?.type === "task").sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  // Group task notes by parentNoteId
  const tasksByParent = new Map<string, NoteData[]>();
  for (const task of taskNotes) {
    const parentId = task.metadata?.parentNoteId ?? "__orphan__";
    tasksByParent.set(parentId, [...(tasksByParent.get(parentId) ?? []), task]);
  }

  const [expandedSpec, setExpandedSpec] = useState<string | null>(null);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [updatingNoteId, setUpdatingNoteId] = useState<string | null>(null);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  const TASK_STATUSES = ["PENDING", "IN_PROGRESS", "REVIEW_REQUIRED", "NEEDS_FIX", "COMPLETED", "BLOCKED", "CANCELLED"];

  const filteredTaskNotes = statusFilter === "all"
    ? taskNotes
    : taskNotes.filter(n => (n.metadata?.taskStatus ?? "PENDING").toUpperCase() === statusFilter);

  const statusColor = (status: string) => {
    const s = (status ?? "PENDING").toUpperCase();
    const map: Record<string, string> = {
      PENDING: "bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400",
      IN_PROGRESS: "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
      REVIEW_REQUIRED: "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400",
      NEEDS_FIX: "bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400",
      COMPLETED: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400",
      BLOCKED: "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400",
      CANCELLED: "bg-gray-100 dark:bg-gray-700/30 text-gray-400",
    };
    return map[s] ?? map.PENDING;
  };

  const handleStatusChange = async (noteId: string, newStatus: string) => {
    setUpdatingNoteId(noteId);
    try { await onUpdateNoteMetadata(noteId, { taskStatus: newStatus }); }
    finally { setUpdatingNoteId(null); }
  };

  const handleDelete = async (noteId: string) => {
    setDeletingNoteId(noteId);
    try { await onDeleteNote(noteId); }
    finally { setDeletingNoteId(null); }
  };

  const handleClearAll = async () => {
    setClearingAll(true);
    try { await onDeleteAllTaskNotes(); }
    finally { setClearingAll(false); }
  };

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Note Tasks</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Spec notes and their derived tasks — created from <code className="font-mono text-[10px]">@@@task</code> blocks
          </p>
        </div>
        {taskNotes.length > 0 && (
          <button onClick={handleClearAll} disabled={clearingAll}
            className="text-[11px] text-red-500 dark:text-red-400 hover:text-red-600 transition-colors disabled:opacity-50">
            {clearingAll ? "Clearing…" : "Clear task notes"}
          </button>
        )}
      </div>

      {/* ── Spec Notes ── */}
      {specNotes.length > 0 && (
        <div className="mb-8">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 flex items-center gap-2">
            <span>Source Specs</span>
            <span className="font-mono text-gray-300 dark:text-gray-600">{specNotes.length}</span>
          </div>
          <div className="space-y-2">
            {specNotes.map((spec) => {
              const childTasks = tasksByParent.get(spec.id) ?? [];
              const isExpanded = expandedSpec === spec.id;
              const doneCount = childTasks.filter(t => (t.metadata?.taskStatus ?? "").toUpperCase() === "COMPLETED").length;
              return (
                <div key={spec.id} className="bg-white dark:bg-[#12141c] rounded-xl border border-violet-200/60 dark:border-violet-800/30 overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-violet-50/40 dark:hover:bg-violet-900/10 transition-colors"
                    onClick={() => setExpandedSpec(isExpanded ? null : spec.id)}>
                    <svg className="w-4 h-4 text-violet-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
                    </svg>
                    <span className="flex-1 text-[13px] font-medium text-gray-700 dark:text-gray-300 truncate">{spec.title}</span>
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400">Spec</span>
                    {childTasks.length > 0 && (
                      <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">
                        {doneCount}/{childTasks.length} done
                      </span>
                    )}
                    <span className="text-[10px] text-gray-400 dark:text-gray-600 font-mono shrink-0">{formatRelativeTime(spec.updatedAt)}</span>
                    <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </div>
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-violet-100 dark:border-violet-800/20">
                      {spec.content ? (
                        <pre className="mt-3 text-[11px] text-gray-500 dark:text-gray-400 font-mono whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">
                          {spec.content.slice(0, 2000)}{spec.content.length > 2000 ? "\n…" : ""}
                        </pre>
                      ) : (
                        <p className="mt-3 text-[11px] text-gray-400 italic">(empty spec)</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Task Notes ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 flex items-center gap-2">
            <span>Task Notes</span>
            <span className="font-mono text-gray-300 dark:text-gray-600">{taskNotes.length}</span>
          </div>
        </div>

        {/* Status filter */}
        {taskNotes.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mb-4">
            {(["all", ...TASK_STATUSES] as const).map((s) => {
              const cnt = s === "all" ? taskNotes.length : taskNotes.filter(n => (n.metadata?.taskStatus ?? "PENDING").toUpperCase() === s).length;
              if (s !== "all" && cnt === 0) return null;
              const active = statusFilter === s;
              return (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border ${
                    active
                      ? `ring-2 ring-emerald-400 border-emerald-400 ${statusColor(s)}`
                      : `border-transparent ${statusColor(s)} hover:opacity-80`
                  }`}>
                  <span>{s === "all" ? "All" : s.replace(/_/g, " ")}</span>
                  <span className="font-bold ml-0.5">{cnt}</span>
                </button>
              );
            })}
          </div>
        )}

        {loading ? (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">Loading…</div>
        ) : filteredTaskNotes.length === 0 ? (
          <div className="text-center py-12 text-gray-400 dark:text-gray-500">
            <svg className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-medium">{taskNotes.length === 0 ? "No task notes yet" : `No ${statusFilter.replace(/_/g, " ")} tasks`}</p>
            {taskNotes.length === 0 && (
              <p className="text-[12px] mt-1">Add <code className="font-mono text-[10px]">@@@task</code> blocks to a spec note, then save it to generate tasks.</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredTaskNotes.map((task) => {
              const isExpanded = expandedTask === task.id;
              const parentSpec = specNotes.find(s => s.id === task.metadata?.parentNoteId);
              const status = task.metadata?.taskStatus ?? "PENDING";
              return (
                <div key={task.id} className="bg-white dark:bg-[#12141c] rounded-xl border border-gray-200/60 dark:border-[#1c1f2e] overflow-hidden hover:shadow-sm transition-shadow">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button onClick={() => setExpandedTask(isExpanded ? null : task.id)} className="shrink-0">
                      <TaskStatusIcon status={status} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <span className="text-[13px] font-medium text-gray-700 dark:text-gray-300 truncate block">{task.title}</span>
                      {parentSpec && (
                        <span className="text-[10px] text-violet-500 dark:text-violet-400 truncate block">↳ {parentSpec.title}</span>
                      )}
                    </div>
                    <span className={`shrink-0 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${statusColor(status)}`}>
                      {status.replace(/_/g, " ")}
                    </span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-600 font-mono shrink-0">{formatRelativeTime(task.updatedAt)}</span>
                    <select
                      value={status}
                      disabled={updatingNoteId === task.id}
                      onChange={(e) => handleStatusChange(task.id, e.target.value)}
                      className="text-[10px] border border-gray-200 dark:border-[#252838] bg-gray-50 dark:bg-[#0e1019] text-gray-600 dark:text-gray-400 rounded-md px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-50"
                    >
                      {TASK_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                    </select>
                    <button onClick={() => handleDelete(task.id)} disabled={deletingNoteId === task.id}
                      className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50 shrink-0">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                    <button onClick={() => setExpandedTask(isExpanded ? null : task.id)} className="shrink-0">
                      <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-100 dark:border-[#191c28]">
                      <div className="mt-3 space-y-2 text-[12px] text-gray-600 dark:text-gray-400">
                        <div><span className="font-semibold">Note ID:</span> <code className="font-mono text-[11px]">{task.id}</code></div>
                        {task.metadata?.linkedTaskId && (
                          <div><span className="font-semibold">Task Record:</span> <code className="font-mono text-[11px]">{task.metadata.linkedTaskId}</code></div>
                        )}
                        {task.metadata?.parentNoteId && (
                          <div><span className="font-semibold">Parent Spec:</span> <code className="font-mono text-[11px]">{task.metadata.parentNoteId}</code></div>
                        )}
                        {task.metadata?.assignedAgentIds && task.metadata.assignedAgentIds.length > 0 && (
                          <div><span className="font-semibold">Assigned:</span> {task.metadata.assignedAgentIds.join(", ")}</div>
                        )}
                        {task.sessionId && <div><span className="font-semibold">Session:</span> <code className="font-mono text-[11px]">{task.sessionId}</code></div>}
                        <div><span className="font-semibold">Created:</span> {new Date(task.createdAt).toLocaleString()}</div>
                        {task.content && (
                          <div className="mt-2 p-3 bg-gray-50 dark:bg-[#0a0c12] rounded-lg">
                            <div className="text-[11px] font-semibold mb-1 text-gray-500 dark:text-gray-400">Task Spec Content</div>
                            <pre className="text-[11px] whitespace-pre-wrap font-mono text-gray-500 dark:text-gray-400 max-h-48 overflow-y-auto">{task.content}</pre>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Overview Tab (A2UI-powered) ──────────────────────────────────────────────
// The Overview is dynamically generated via A2UI v0.10 protocol.
// Agents can inject custom surfaces, and users can import/export the JSON.

function OverviewA2UITab({
  workspace,
  sessions,
  agents,
  tasks,
  bgTasks,
  codebases,
  notes,
  traces,
  skills,
  customSurfaces,
  showSource,
  onToggleSource,
  onAction,
  onAddCustomSurface,
  onInstallAgent,
  onDeleteAllSessions,
  onNavigateSession,
}: {
  workspace: { id: string; title: string; status: string };
  sessions: SessionInfo[];
  agents: Array<{ id: string; name: string; role: string; status: string }>;
  tasks: TaskInfo[];
  bgTasks: BackgroundTaskInfo[];
  codebases: Array<{ id: string; label?: string; repoPath: string; branch?: string; isDefault?: boolean }>;
  notes: NoteData[];
  traces: TraceInfo[];
  skills: Array<{ name: string }>;
  customSurfaces: A2UIMessage[];
  showSource: boolean;
  onToggleSource: () => void;
  onAction: (action: { name: string; surfaceId: string; context?: Record<string, unknown> }) => void;
  onAddCustomSurface: (messages: A2UIMessage[]) => void;
  onInstallAgent: () => void;
  onDeleteAllSessions: () => void;
  onNavigateSession: (sessionId: string) => void;
}) {
  const [showJsonPanel, setShowJsonPanel] = useState(false);
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);
  const [customJsonInput, setCustomJsonInput] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Build dashboard data from workspace state
  const dashboardData: DashboardData = {
    workspace,
    sessions: sessions.map((s) => ({
      sessionId: s.sessionId,
      name: s.name,
      provider: s.provider,
      role: s.role,
      createdAt: s.createdAt,
    })),
    agents,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      assignedTo: t.assignedTo,
      createdAt: t.createdAt,
    })),
    bgTasks: bgTasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      agentId: t.agentId,
      triggerSource: t.triggerSource,
      createdAt: t.createdAt,
    })),
    codebases,
    notes: notes.map((n) => ({
      id: n.id,
      title: n.title,
      content: n.content,
      metadata: n.metadata,
      updatedAt: n.updatedAt,
    })),
    traces: traces.map((t) => ({
      id: t.id,
      agentName: t.agentName,
      action: t.action,
      summary: t.summary,
      createdAt: t.createdAt,
    })),
  };

  // Generate A2UI messages
  const a2uiMessages = React.useMemo(
    () => [...generateDashboardA2UI(dashboardData), ...customSurfaces],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(dashboardData), customSurfaces]
  );

  const exportJson = () => {
    const json = JSON.stringify(a2uiMessages, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `a2ui-dashboard-${workspace.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = () => {
    try {
      const parsed = JSON.parse(customJsonInput);
      const messages: A2UIMessage[] = Array.isArray(parsed) ? parsed : [parsed];
      for (const msg of messages) {
        if (!msg.version || msg.version !== "v0.10") {
          throw new Error("Each message must have version: \"v0.10\"");
        }
        if (!("createSurface" in msg || "updateComponents" in msg || "updateDataModel" in msg || "deleteSurface" in msg)) {
          throw new Error("Each message must contain one of: createSurface, updateComponents, updateDataModel, deleteSurface");
        }
      }
      onAddCustomSurface(messages);
      setCustomJsonInput("");
      setJsonError(null);
      setShowJsonPanel(false);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  const sampleJson = `[
  {
    "version": "v0.10",
    "createSurface": {
      "surfaceId": "custom_widget",
      "catalogId": "https://a2ui.org/specification/v0_10/basic_catalog.json",
      "theme": { "agentDisplayName": "My Agent" }
    }
  },
  {
    "version": "v0.10",
    "updateComponents": {
      "surfaceId": "custom_widget",
      "components": [
        { "id": "root", "component": "Card", "child": "content" },
        { "id": "content", "component": "Column", "children": ["title", "body"] },
        { "id": "title", "component": "Text", "text": "Custom Widget", "variant": "h3" },
        { "id": "body", "component": "Text", "text": { "path": "/message" }, "variant": "body" }
      ]
    }
  },
  {
    "version": "v0.10",
    "updateDataModel": {
      "surfaceId": "custom_widget",
      "value": { "message": "This is a custom A2UI surface rendered in your dashboard!" }
    }
  }
]`;

  return (
    <div className="space-y-6">
      {/* ─── A2UI-Rendered Dashboard ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2/3: A2UI dynamic surfaces */}
        <div className="lg:col-span-2 space-y-4">
          <A2UIViewer
            messages={a2uiMessages}
            onAction={onAction}
          />
        </div>

        {/* Right 1/3: Native interactive sidebar */}
        <div className="space-y-6">
          {/* Recent Sessions (native — needs click navigation) */}
          <DashboardCard
            title="Recent Sessions"
            count={sessions.length}
            emptyText="No sessions yet. Start one above."
            action={
              sessions.length > 0 ? (
                <button
                  onClick={onDeleteAllSessions}
                  className="text-[11px] text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors"
                >
                  Clear all
                </button>
              ) : undefined
            }
          >
            {sessions.slice(0, 6).map((s) => (
              <button
                key={s.sessionId}
                onClick={() => onNavigateSession(s.sessionId)}
                className="group w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-[#151720] transition-colors text-left"
              >
                <div className="w-7 h-7 rounded-md bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center shrink-0">
                  <svg className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-gray-700 dark:text-gray-300 truncate group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors">
                    {s.name || s.provider || `Session ${s.sessionId.slice(0, 8)}`}
                  </div>
                  <div className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                    {s.role && <span className="capitalize">{s.role.toLowerCase()}</span>}
                    {s.role && s.provider && <span className="mx-1">·</span>}
                    {s.provider && <span>{s.provider}</span>}
                  </div>
                </div>
                <span className="text-[10px] text-gray-400 dark:text-gray-600 font-mono shrink-0">
                  {formatRelativeTime(s.createdAt)}
                </span>
                <svg className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            ))}
          </DashboardCard>

          {/* Agents */}
          <DashboardCard
            title="Agents"
            count={agents.length}
            emptyText="No agents spawned."
            action={
              <button
                onClick={onInstallAgent}
                className="text-[11px] text-amber-600 dark:text-amber-500 hover:text-amber-700 dark:hover:text-amber-400 transition-colors"
              >
                + Install
              </button>
            }
          >
            {agents.slice(0, 6).map((agent) => (
              <div key={agent.id} className="flex items-center gap-3 px-3.5 py-2 rounded-lg">
                <AgentRoleIcon role={agent.role} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium text-gray-700 dark:text-gray-300 truncate">{agent.name}</div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">{agent.role}</div>
                </div>
                <AgentStatusDot status={agent.status} />
              </div>
            ))}
          </DashboardCard>

          {/* Skills */}
          {skills.length > 0 && (
            <DashboardCard title="Skills" count={skills.length}>
              <div className="flex flex-wrap gap-1.5 px-3 py-2">
                {skills.slice(0, 12).map((sk) => (
                  <span
                    key={sk.name}
                    className="inline-flex items-center px-2 py-1 rounded-md bg-gray-100 dark:bg-[#191c28] text-[11px] font-medium text-gray-600 dark:text-gray-400 border border-gray-200/50 dark:border-[#252838]"
                  >
                    /{sk.name}
                  </span>
                ))}
              </div>
            </DashboardCard>
          )}
        </div>
      </div>

      {/* ─── A2UI Toolbar ─────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-200/40 dark:border-[#191c28]">
        <div className="flex items-center gap-3 text-[10px] text-gray-400 dark:text-gray-600">
          <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#191c28] font-mono">A2UI v0.10</span>
          <span>{a2uiMessages.length} messages</span>
          <span>·</span>
          <span>{a2uiMessages.filter(m => "createSurface" in m).length} surfaces</span>
          <span>·</span>
          <a href="https://a2ui.org/specification/" target="_blank" rel="noopener noreferrer"
            className="text-amber-500 hover:text-amber-600 transition-colors">
            Protocol docs
          </a>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => { setShowTemplateGallery(!showTemplateGallery); setShowJsonPanel(false); }}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
              showTemplateGallery
                ? "bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400"
                : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#191c28]"
            }`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            </svg>
            Templates
          </button>
          <button
            onClick={() => { setShowJsonPanel(!showJsonPanel); setShowTemplateGallery(false); }}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#191c28] transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Import
          </button>
          <button
            onClick={exportJson}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#191c28] transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Export
          </button>
          <button
            onClick={onToggleSource}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
              showSource
                ? "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
                : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#191c28]"
            }`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
            </svg>
            Source
          </button>
        </div>
      </div>

      {/* ─── Template Gallery ─────────────────────────────────── */}
      {showTemplateGallery && (
        <div className="bg-white dark:bg-[#12141c] rounded-xl border border-gray-200/60 dark:border-[#1c1f2e] p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300">Surface Templates</h3>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Add pre-built surfaces to your dashboard</p>
            </div>
            <button onClick={() => setShowTemplateGallery(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                id: "kanban",
                title: "Task Board",
                description: "Kanban-style view: Active, Pending, and Done tasks",
                icon: (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" />
                  </svg>
                ),
                accent: "text-blue-500 dark:text-blue-400",
                bg: "bg-blue-50 dark:bg-blue-900/20",
                generate: () => generateTaskKanbanSurface(dashboardData),
              },
              {
                id: "agents",
                title: "Agent Monitor",
                description: "Live agent status with role badges and health indicators",
                icon: (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                ),
                accent: "text-violet-500 dark:text-violet-400",
                bg: "bg-violet-50 dark:bg-violet-900/20",
                generate: () => generateAgentMonitorSurface(dashboardData.agents),
              },
              {
                id: "timeline",
                title: "Timeline",
                description: "Chronological activity feed across tasks and traces",
                icon: (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605" />
                  </svg>
                ),
                accent: "text-emerald-500 dark:text-emerald-400",
                bg: "bg-emerald-50 dark:bg-emerald-900/20",
                generate: () => generateTimelineSurface(dashboardData),
              },
              {
                id: "summary",
                title: "Workspace Summary",
                description: "High-level metrics: tasks, agents, BG jobs, and codebases",
                icon: (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
                  </svg>
                ),
                accent: "text-amber-500 dark:text-amber-400",
                bg: "bg-amber-50 dark:bg-amber-900/20",
                generate: () => generateWorkspaceSummarySurface(dashboardData),
              },
            ].map((tpl) => (
              <div
                key={tpl.id}
                className="group flex flex-col gap-3 p-3 rounded-lg border border-gray-200/60 dark:border-[#252838] bg-gray-50 dark:bg-[#0e1019] hover:border-gray-300 dark:hover:border-[#2e3248] transition-colors"
              >
                <div className={`w-9 h-9 rounded-lg ${tpl.bg} flex items-center justify-center ${tpl.accent}`}>
                  {tpl.icon}
                </div>
                <div className="flex-1">
                  <div className="text-[12px] font-semibold text-gray-700 dark:text-gray-300">{tpl.title}</div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed mt-0.5">{tpl.description}</div>
                </div>
                <button
                  onClick={() => {
                    onAddCustomSurface(tpl.generate());
                    setShowTemplateGallery(false);
                  }}
                  className={`w-full py-1.5 rounded-md text-[11px] font-medium transition-colors border ${tpl.bg} ${tpl.accent} border-current/20 hover:opacity-80`}
                >
                  Add Surface
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Source View ──────────────────────────────────────── */}
      {showSource && (
        <div className="bg-gray-50 dark:bg-[#0a0c12] rounded-xl border border-gray-200/60 dark:border-[#1c1f2e] p-4 overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">A2UI Protocol Messages (JSON)</h3>
            <button
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(a2uiMessages, null, 2));
              }}
              className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              Copy
            </button>
          </div>
          <pre className="text-[11px] text-gray-600 dark:text-gray-400 font-mono whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
            {JSON.stringify(a2uiMessages, null, 2)}
          </pre>
        </div>
      )}

      {/* ─── Import Panel ─────────────────────────────────────── */}
      {showJsonPanel && (
        <div className="bg-white dark:bg-[#12141c] rounded-xl border border-gray-200/60 dark:border-[#1c1f2e] p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300">Import Custom A2UI Surface</h3>
            <button onClick={() => { setShowJsonPanel(false); setJsonError(null); }}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <textarea
            value={customJsonInput}
            onChange={(e) => { setCustomJsonInput(e.target.value); setJsonError(null); }}
            placeholder={sampleJson}
            rows={10}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-[#252838] bg-gray-50 dark:bg-[#0e1019] text-[12px] text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600 outline-none focus:ring-2 focus:ring-amber-500/30 resize-none font-mono leading-relaxed"
          />
          {jsonError && (
            <div className="mt-2 text-[11px] text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md">
              {jsonError}
            </div>
          )}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={handleImportJson}
              disabled={!customJsonInput.trim()}
              className="px-4 py-2 rounded-lg text-[12px] font-medium text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-40 transition-colors shadow-sm"
            >
              Render Surface
            </button>
            <button
              onClick={() => setCustomJsonInput(sampleJson)}
              className="px-3 py-2 rounded-lg text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              Load Example
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Overlay Modal ─────────────────────────────────────────────────────────────

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

// ─── BG Task Helpers ───────────────────────────────────────────────

function bgTaskStatusClass(status: string): string {
  switch (status) {
    case "PENDING":   return "bg-gray-100 dark:bg-gray-700/40 text-gray-500 dark:text-gray-400";
    case "RUNNING":   return "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400";
    case "COMPLETED": return "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400";
    case "FAILED":    return "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400";
    case "CANCELLED": return "bg-gray-100 dark:bg-gray-700/40 text-gray-400 dark:text-gray-500";
    default:          return "bg-gray-100 dark:bg-gray-700/40 text-gray-500 dark:text-gray-400";
  }
}

function BgTaskStatusIcon({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    PENDING: "text-gray-400",
    RUNNING: "text-blue-500 animate-spin",
    COMPLETED: "text-emerald-500",
    FAILED: "text-red-500",
    CANCELLED: "text-gray-400",
  };
  const cls = colorMap[status] ?? "text-gray-400";
  if (status === "COMPLETED") {
    return (
      <svg className={`w-4 h-4 ${cls} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  if (status === "FAILED" || status === "CANCELLED") {
    return (
      <svg className={`w-4 h-4 ${cls} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  return (
    <svg className={`w-4 h-4 ${cls} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}
