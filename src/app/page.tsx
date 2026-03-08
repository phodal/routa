"use client";

/**
 * Routa JS - Home Page
 *
 * Task-first, operational layout:
 * - Input dominates the viewport — type immediately
 * - Agent selection is lightweight (dropdown in control bar)
 * - Context (Workspace / Repo) structured in input's bottom bar
 * - Skills shown as scannable grid cards
 * - Recent sessions as compact inline pills
 */

import { useCallback, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { HomeInput } from "@/client/components/home-input";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { useAcp } from "@/client/hooks/use-acp";
import { useSkills } from "@/client/hooks/use-skills";
import { SettingsPanel } from "@/client/components/settings-panel";
import { NotificationProvider, NotificationBell } from "@/client/components/notification-center";

export default function HomePage() {
  const router = useRouter();
  const workspacesHook = useWorkspaces();
  const acp = useAcp();
  const skillsHook = useSkills();

  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"agents" | undefined>(undefined);
  const [showIntegrationsMenu, setShowIntegrationsMenu] = useState(false);
  const [showWorkspacesMenu, setShowWorkspacesMenu] = useState(false);
  const integrationsRef = useRef<HTMLDivElement>(null);
  const workspacesMenuRef = useRef<HTMLDivElement>(null);

  // Close integrations dropdown on outside click
  useEffect(() => {
    if (!showIntegrationsMenu) return;
    const handler = (e: MouseEvent) => {
      if (integrationsRef.current && !integrationsRef.current.contains(e.target as Node)) {
        setShowIntegrationsMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showIntegrationsMenu]);

  // Close workspaces menu on outside click
  useEffect(() => {
    if (!showWorkspacesMenu) return;
    const handler = (e: MouseEvent) => {
      if (workspacesMenuRef.current && !workspacesMenuRef.current.contains(e.target as Node)) {
        setShowWorkspacesMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showWorkspacesMenu]);

  // Auto-select first workspace on load
  useEffect(() => {
    if (!activeWorkspaceId && workspacesHook.workspaces.length > 0) {
      setActiveWorkspaceId(workspacesHook.workspaces[0].id);
    }
  }, [workspacesHook.workspaces, activeWorkspaceId]);

  // Auto-connect on mount
  useEffect(() => {
    if (!acp.connected && !acp.loading) {
      acp.connect();
    }
  }, [acp.connected, acp.loading]);

  const handleWorkspaceSelect = useCallback((wsId: string) => {
    setActiveWorkspaceId(wsId);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleWorkspaceCreate = useCallback(async (title: string) => {
    const ws = await workspacesHook.createWorkspace(title);
    if (ws) handleWorkspaceSelect(ws.id);
  }, [workspacesHook, handleWorkspaceSelect]);

  const handleSessionClick = useCallback((sessionId: string) => {
    if (activeWorkspaceId) {
      router.push(`/workspace/${activeWorkspaceId}/sessions/${sessionId}`);
    } else {
      router.push(`/workspace/${sessionId}`);
    }
  }, [activeWorkspaceId, router]);

  return (
    <NotificationProvider>
    <div className="h-screen flex flex-col bg-[#fafafa] dark:bg-[#0a0c12]">
      {/* ─── Minimal Header ─────────────────────────────────────────── */}
      <header className="h-11 shrink-0 flex items-center px-5 z-10 border-b border-gray-100 dark:border-[#151720]">
        <div className="flex items-center gap-2.5">
          <img src="/logo.svg" alt="Routa" width={22} height={22} className="rounded-md" />
          <span className="text-[13px] font-semibold text-gray-800 dark:text-gray-200 tracking-tight">
            Routa
          </span>
        </div>

        <div className="flex-1" />

        <nav className="flex items-center gap-0.5">
          {/* Integrations dropdown — merges MCP + A2A */}
          <div className="relative" ref={integrationsRef}>
            <button
              onClick={() => setShowIntegrationsMenu((v) => !v)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${showIntegrationsMenu ? "text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-[#151720]" : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#151720]"}`}
            >
              Integrations
              <svg className="w-2.5 h-2.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showIntegrationsMenu && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-[#12141c] border border-gray-100 dark:border-[#1c1f2e] rounded-lg shadow-lg z-50 py-1 overflow-hidden">
                <a
                  href="/mcp-tools"
                  onClick={() => setShowIntegrationsMenu(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1d2c] transition-colors"
                >
                  <span className="w-4 h-4 rounded bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-[9px] font-bold text-blue-600 dark:text-blue-400">M</span>
                  MCP Tools
                </a>
                <a
                  href="/a2a"
                  onClick={() => setShowIntegrationsMenu(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1d2c] transition-colors"
                >
                  <span className="w-4 h-4 rounded bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-[9px] font-bold text-emerald-600 dark:text-emerald-400">A</span>
                  A2A Protocol
                </a>
              </div>
            )}
          </div>

          <a
            href="/settings/webhooks"
            className="px-2.5 py-1 rounded-md text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#151720] transition-colors"
          >
            Webhooks
          </a>
          <a
            href="/settings/schedules"
            className="px-2.5 py-1 rounded-md text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#151720] transition-colors"
          >
            Schedules
          </a>

          <NotificationBell />

          {/* Settings — with Agents accessible via initialTab */}
          <button
            onClick={() => { setSettingsInitialTab(undefined); setShowSettingsPanel(true); }}
            className="p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#151720] transition-colors"
            title="Settings"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          {/* Single combined status indicator */}
          <div className="ml-2 pl-3 border-l border-gray-200 dark:border-[#1f2233]">
            <ConnectionDot connected={acp.connected} />
          </div>
        </nav>
      </header>

      {/* ─── Main Content ─────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        {!workspacesHook.loading && workspacesHook.workspaces.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <OnboardingCard onCreateWorkspace={handleWorkspaceCreate} />
          </div>
        ) : (
          <div className="min-h-full flex flex-col justify-center px-6 py-8">
            {/* ── Input — centered ──────────────────────────────────── */}
            <div className="flex justify-center mb-8">
              <div className="w-full max-w-2xl">
                <HomeInput
                  workspaceId={activeWorkspaceId ?? undefined}
                  onWorkspaceChange={(wsId) => {
                    setActiveWorkspaceId(wsId);
                    setRefreshKey((k) => k + 1);
                  }}
                  onSessionCreated={() => {
                    setRefreshKey((k) => k + 1);
                  }}
                  displaySkills={skillsHook.allSkills}
                />
              </div>
            </div>

            {/* ── Workspace Cards — below input ─────────────────────── */}
            <div className="max-w-4xl mx-auto">
              <WorkspaceCards
                workspaceId={activeWorkspaceId}
                refreshKey={refreshKey}
                onWorkspaceSelect={handleWorkspaceSelect}
                onWorkspaceCreate={handleWorkspaceCreate}
                onSessionClick={handleSessionClick}
                showWorkspacesMenu={showWorkspacesMenu}
                setShowWorkspacesMenu={setShowWorkspacesMenu}
                workspacesMenuRef={workspacesMenuRef}
              />
              <HomeTodoPreview workspaceId={activeWorkspaceId} refreshKey={refreshKey} />
            </div>
          </div>
        )}
      </main>

      {/* ─── Settings Panel ────────────────────────────────────────── */}
      <SettingsPanel
        open={showSettingsPanel}
        onClose={() => setShowSettingsPanel(false)}
        providers={acp.providers}
        initialTab={settingsInitialTab}
      />
    </div>
    </NotificationProvider>
  );
}

// ─── Connection Dot (single indicator, replaces MCP+ACP dots) ────────

function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-1.5" title={connected ? "Connected" : "Disconnected"}>
      <span className={`w-1.5 h-1.5 rounded-full ring-2 transition-colors ${connected ? "bg-emerald-500 ring-emerald-500/20" : "bg-amber-400 ring-amber-400/20"}`} />
      <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500">{connected ? "Connected" : "Offline"}</span>
    </div>
  );
}

function HomeTodoPreview({
  workspaceId,
  refreshKey,
}: {
  workspaceId: string | null;
  refreshKey: number;
}) {
  const [tasks, setTasks] = useState<HomeTaskInfo[]>([]);

  useEffect(() => {
    if (!workspaceId) {
      setTasks([]);
      return;
    }

    const fetchTasks = async () => {
      try {
        const res = await fetch(`/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
        const data = await res.json();
        const nextTasks = Array.isArray(data?.tasks) ? data.tasks as HomeTaskInfo[] : [];
        setTasks(
          nextTasks
            .filter((task) => !["COMPLETED", "CANCELLED"].includes(task.status))
            .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
            .slice(0, 4),
        );
      } catch {
        setTasks([]);
      }
    };

    void fetchTasks();
  }, [workspaceId, refreshKey]);

  if (!workspaceId || tasks.length === 0) {
    return null;
  }

  return (
    <div className="mt-5 rounded-2xl border border-gray-100 bg-white/90 p-4 dark:border-[#1c1f2e] dark:bg-[#12141c]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
            Current Todos
          </div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            A quick slice of the active board.
          </div>
        </div>
        <a
          href={`/workspace/${workspaceId}/kanban`}
          className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-[#191c28]"
        >
          Open Kanban
        </a>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {tasks.map((task) => (
          <a
            key={task.id}
            href={`/workspace/${workspaceId}/kanban`}
            className="rounded-xl border border-gray-100 bg-[#fcfcfc] px-3 py-3 transition-colors hover:border-amber-200 hover:bg-amber-50/60 dark:border-[#1c1f2e] dark:bg-[#0f1118] dark:hover:border-amber-800/40 dark:hover:bg-amber-900/5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{task.title}</div>
                <div className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                  {(task.columnId ?? "backlog").toUpperCase()} · {task.assignedProvider ?? "unassigned"}
                </div>
              </div>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-600 dark:bg-[#1c1f2e] dark:text-gray-300">
                {task.priority ?? "medium"}
              </span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

// ─── Onboarding Card ──────────────────────────────────────────────────

function OnboardingCard({ onCreateWorkspace }: { onCreateWorkspace: (title: string) => void }) {
  return (
    <div className="w-full max-w-sm text-center">
      <div className="w-12 h-12 rounded-xl bg-linear-to-br from-amber-400 to-orange-500 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-amber-500/20">
        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1.5">
        Create a workspace
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Organize your sessions and projects in one place.
      </p>
      <button
        type="button"
        onClick={() => onCreateWorkspace("My Workspace")}
        className="px-6 py-2.5 text-sm font-medium text-white bg-linear-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 rounded-xl transition-all shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40"
      >
        Get Started
      </button>
    </div>
  );
}

// ─── WorkspaceCards — left panel ─────────────────────────────────────

interface SessionInfo {
  sessionId: string;
  name?: string;
  cwd: string;
  workspaceId: string;
  provider?: string;
  role?: string;
  createdAt: string;
}

interface WorkspaceCardSession {
  sessionId: string;
  displayName: string;
  createdAt: string;
}

interface HomeTaskInfo {
  id: string;
  title: string;
  status: string;
  priority?: string;
  columnId?: string;
  assignedProvider?: string;
  createdAt: string;
}

interface WorkspaceCardData {
  id: string;
  title: string;
  updatedAt: string;
  recentSessions: WorkspaceCardSession[] | [];
}

function WorkspaceCards({
  workspaceId,
  refreshKey,
  onWorkspaceSelect,
  onWorkspaceCreate,
  onSessionClick,
  showWorkspacesMenu,
  setShowWorkspacesMenu,
  workspacesMenuRef,
}: {
  workspaceId: string | null;
  refreshKey: number;
  onWorkspaceSelect: (id: string) => void;
  onWorkspaceCreate: (title: string) => void;
  onSessionClick: (id: string) => void;
  showWorkspacesMenu: boolean;
  setShowWorkspacesMenu: (v: boolean) => void;
  workspacesMenuRef: React.RefObject<HTMLDivElement | null>;
}) {
  const workspacesHook = useWorkspaces();
  const [cardData, setCardData] = useState<WorkspaceCardData[]>([]);

  const formatTime = (dateStr: string) => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const getDisplayName = (s: SessionInfo) => {
    if (s.name) return s.name;
    if (s.provider && s.role) return `${s.provider} · ${s.role.toLowerCase()}`;
    if (s.provider) return s.provider;
    return `Session ${s.sessionId.slice(0, 6)}`;
  };

  useEffect(() => {
    const fetchAll = async () => {
      const workspaces = workspacesHook.workspaces;
      if (workspaces.length === 0) return;

      const cards: WorkspaceCardData[] = await Promise.all(
        workspaces.slice(0, 9).map(async (ws) => {
          try {
            const res = await fetch(
              `/api/sessions?workspaceId=${encodeURIComponent(ws.id)}&limit=3`,
              { cache: "no-store" }
            );
            const data = await res.json();
            const sessions: SessionInfo[] = Array.isArray(data?.sessions) ? data.sessions : [];
            const recentSessions: WorkspaceCardSession[] = sessions.slice(0, 3).map(s => ({
              sessionId: s.sessionId,
              displayName: getDisplayName(s),
              createdAt: s.createdAt,
            }));
            return {
              id: ws.id,
              title: ws.title,
              updatedAt: ws.updatedAt,
              recentSessions,
            };
          } catch {
            return { id: ws.id, title: ws.title, updatedAt: ws.updatedAt, recentSessions: [] };
          }
        })
      );

      // Sort by most recent session activity
      cards.sort((a, b) => {
        const aDate = a.recentSessions[0]?.createdAt ?? a.updatedAt;
        const bDate = b.recentSessions[0]?.createdAt ?? b.updatedAt;
        return new Date(bDate).getTime() - new Date(aDate).getTime();
      });

      setCardData(cards);
    };
    fetchAll();
  }, [workspacesHook.workspaces, refreshKey]);

  if (workspacesHook.loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-sm text-gray-400 dark:text-gray-500">Loading…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Recent Workspaces
        </h2>
        <div className="relative" ref={workspacesMenuRef}>
          <button
            onClick={() => setShowWorkspacesMenu(!showWorkspacesMenu)}
            className="text-[11px] text-amber-600 dark:text-amber-500 hover:text-amber-700 dark:hover:text-amber-400 transition-colors flex items-center gap-1"
          >
            View all
            <svg className={`w-2.5 h-2.5 transition-transform ${showWorkspacesMenu ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showWorkspacesMenu && (
            <div className="absolute right-0 top-full mt-1 w-40 bg-white dark:bg-[#12141c] border border-gray-100 dark:border-[#1c1f2e] rounded-lg shadow-lg z-50 py-1 overflow-hidden">
              <a
                href="/workspaces"
                onClick={() => setShowWorkspacesMenu(false)}
                className="flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1d2c] transition-colors"
              >
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
                </svg>
                All Workspaces
              </a>
              <a
                href="/sessions"
                onClick={() => setShowWorkspacesMenu(false)}
                className="flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1d2c] transition-colors"
              >
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-3 3v-3z" />
                </svg>
                All Sessions
              </a>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cardData.map((ws) => {
          const isActive = ws.id === workspaceId;
          return (
            <button
              key={ws.id}
              onClick={() => onWorkspaceSelect(ws.id)}
              className={`group text-left rounded-xl border p-4 transition-all hover:shadow-sm ${
                isActive
                  ? "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-700/50"
                  : "bg-white dark:bg-[#12141c] border-gray-100 dark:border-[#1c1f2e] hover:border-amber-200 dark:hover:border-amber-700/40"
              }`}
            >
              {/* Workspace header */}
              <div className="flex items-start justify-between gap-2 mb-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 transition-colors ${isActive ? "bg-amber-500" : "bg-emerald-500 group-hover:bg-amber-400"}`} />
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate leading-tight">
                    {ws.title}
                  </span>
                </div>
                <a
                  href={`/workspace/${ws.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  title="Open workspace"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </a>
              </div>

              {/* Recent sessions */}
              {ws.recentSessions.length > 0 ? (
                <div className="space-y-1">
                  {ws.recentSessions.map((session, idx) => (
                    <div
                      key={session.sessionId}
                      className="flex items-center gap-1.5 cursor-pointer group/session"
                      onClick={(e) => { e.stopPropagation(); onSessionClick(session.sessionId); }}
                    >
                      <svg className="w-3 h-3 shrink-0 text-blue-400 dark:text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-3 3v-3z" />
                      </svg>
                      <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate flex-1 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                        {session.displayName}
                      </span>
                      <span className="text-[9px] text-gray-300 dark:text-gray-600 font-mono shrink-0">
                        {formatTime(session.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-[10px] text-gray-300 dark:text-gray-600 italic">No sessions yet</span>
              )}
            </button>
          );
        })}

        {/* New workspace card */}
        <button
          onClick={() => onWorkspaceCreate("New Workspace")}
          className="text-left rounded-xl border border-dashed border-gray-200 dark:border-[#1c1f2e] p-4 transition-all hover:border-amber-300 dark:hover:border-amber-700/50 hover:bg-amber-50/50 dark:hover:bg-amber-900/5 group"
        >
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-md bg-gray-100 dark:bg-[#1a1d2c] flex items-center justify-center group-hover:bg-amber-100 dark:group-hover:bg-amber-900/30 transition-colors">
              <svg className="w-3 h-3 text-gray-400 dark:text-gray-500 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
              New workspace
            </span>
          </div>
        </button>
      </div>
    </div>
  );
}