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
import Link from "next/link";
import Image from "next/image";
import { HomeInput } from "@/client/components/home-input";
import { useWorkspaces, type WorkspaceData } from "@/client/hooks/use-workspaces";
import { useAcp } from "@/client/hooks/use-acp";
import { useSkills } from "@/client/hooks/use-skills";
import { SettingsPanel } from "@/client/components/settings-panel";
import { NotificationProvider, NotificationBell } from "@/client/components/notification-center";

export default function HomePage() {
  const workspacesHook = useWorkspaces();
  const acp = useAcp();
  const skillsHook = useSkills();

  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"agents" | undefined>(undefined);
  const [showIntegrationsMenu, setShowIntegrationsMenu] = useState(false);
  const [workspaceFilterId, setWorkspaceFilterId] = useState<string | "all">("all");
  const integrationsRef = useRef<HTMLDivElement>(null);

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

  // Auto-select first workspace on load
  useEffect(() => {
    if (!activeWorkspaceId && workspacesHook.workspaces.length > 0) {
      setActiveWorkspaceId(workspacesHook.workspaces[0].id);
    }
  }, [activeWorkspaceId, workspacesHook.workspaces]);

  // Auto-connect on mount
  useEffect(() => {
    if (!acp.connected && !acp.loading) {
      acp.connect();
    }
    // We intentionally exclude 'acp' from deps to avoid re-connecting on every acp change
    // The acp object is stable across renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acp.connected, acp.loading]);

  const handleWorkspaceSelect = useCallback((wsId: string) => {
    setActiveWorkspaceId(wsId);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleWorkspaceCreate = useCallback(async (title: string) => {
    const ws = await workspacesHook.createWorkspace(title);
    if (ws) handleWorkspaceSelect(ws.id);
  }, [workspacesHook, handleWorkspaceSelect]);

  return (
    <NotificationProvider>
    <div className="h-screen flex flex-col bg-[#fafafa] dark:bg-[#0a0c12]">
      {/* ─── Minimal Header ─────────────────────────────────────────── */}
      <header className="h-11 shrink-0 flex items-center px-5 z-10 border-b border-gray-100 dark:border-[#151720]">
        <div className="flex items-center gap-2.5">
          <Image src="/logo.svg" alt="Routa" width={22} height={22} className="rounded-md" />
          <span className="text-[13px] font-semibold text-gray-800 dark:text-gray-200 tracking-tight">
            Routa
          </span>
        </div>

        <div className="flex-1" />

        <nav className="flex items-center gap-0.5">
          {/* Kanban link - quick access to current workspace board */}
          {activeWorkspaceId && (
            <Link
              href={`/workspace/${activeWorkspaceId}/kanban`}
              className="px-2.5 py-1 rounded-md text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#151720] transition-colors"
              title="Open Kanban Board"
            >
              Kanban
            </Link>
          )}

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
                <Link
                  href="/mcp-tools"
                  onClick={() => setShowIntegrationsMenu(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1d2c] transition-colors"
                >
                  <span className="w-4 h-4 rounded bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-[9px] font-bold text-blue-600 dark:text-blue-400">M</span>
                  MCP Tools
                </Link>
                <Link
                  href="/a2a"
                  onClick={() => setShowIntegrationsMenu(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1d2c] transition-colors"
                >
                  <span className="w-4 h-4 rounded bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-[9px] font-bold text-emerald-600 dark:text-emerald-400">A</span>
                  A2A Protocol
                </Link>
              </div>
            )}
          </div>

          <Link
            href="/settings/webhooks"
            className="px-2.5 py-1 rounded-md text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#151720] transition-colors"
          >
            Webhooks
          </Link>
          <Link
            href="/settings/schedules"
            className="px-2.5 py-1 rounded-md text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#151720] transition-colors"
          >
            Schedules
          </Link>

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
          <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-8 px-6 py-8">
            {/* ── Input — centered ──────────────────────────────────── */}
            <div className="flex justify-center mb-8">
              <div className="w-full max-w-2xl">
                <HomeInput
                  workspaceId={activeWorkspaceId ?? undefined}
                  onWorkspaceChange={(wsId) => {
                    setActiveWorkspaceId(wsId);
                    if (workspaceFilterId !== "all" && wsId) {
                      setWorkspaceFilterId(wsId);
                    }
                    setRefreshKey((k) => k + 1);
                  }}
                  onSessionCreated={() => {
                    setRefreshKey((k) => k + 1);
                  }}
                  displaySkills={skillsHook.allSkills}
                />
              </div>
            </div>

            <HomeKanbanPreview
              workspaces={workspacesHook.workspaces}
              workspaceFilterId={workspaceFilterId}
              refreshKey={refreshKey}
              onWorkspaceFilterChange={(nextWorkspaceId) => {
                setWorkspaceFilterId(nextWorkspaceId);
                if (nextWorkspaceId !== "all") {
                  handleWorkspaceSelect(nextWorkspaceId);
                }
              }}
              onWorkspaceCreate={handleWorkspaceCreate}
            />
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

type HomeWorkspaceFilterId = string | "all";
type HomeKanbanColumnId = "backlog" | "todo" | "dev" | "review" | "blocked";

const HOME_KANBAN_COLUMNS: Array<{
  id: HomeKanbanColumnId;
  title: string;
  accentClassName: string;
  emptyCopy: string;
}> = [
  {
    id: "backlog",
    title: "Backlog",
    accentClassName: "bg-slate-500",
    emptyCopy: "No backlog items yet.",
  },
  {
    id: "todo",
    title: "Todo",
    accentClassName: "bg-sky-500",
    emptyCopy: "Nothing queued for execution.",
  },
  {
    id: "dev",
    title: "In Dev",
    accentClassName: "bg-amber-500",
    emptyCopy: "No work is currently in progress.",
  },
  {
    id: "review",
    title: "Review",
    accentClassName: "bg-violet-500",
    emptyCopy: "Nothing is waiting on review.",
  },
  {
    id: "blocked",
    title: "Blocked",
    accentClassName: "bg-rose-500",
    emptyCopy: "No active blockers across the board.",
  },
];

function normalizeHomeTaskColumnId(task: HomeTaskInfo): HomeKanbanColumnId {
  switch ((task.columnId ?? "").toLowerCase()) {
    case "todo":
      return "todo";
    case "dev":
      return "dev";
    case "review":
      return "review";
    case "blocked":
      return "blocked";
    default:
      break;
  }

  switch (task.status.toUpperCase()) {
    case "IN_PROGRESS":
      return "dev";
    case "REVIEW_REQUIRED":
    case "NEEDS_FIX":
      return "review";
    case "BLOCKED":
      return "blocked";
    default:
      return "backlog";
  }
}

function HomeKanbanPreview({
  workspaces,
  workspaceFilterId,
  refreshKey,
  onWorkspaceFilterChange,
  onWorkspaceCreate,
}: {
  workspaces: WorkspaceData[];
  workspaceFilterId: HomeWorkspaceFilterId;
  refreshKey: number;
  onWorkspaceFilterChange: (workspaceId: HomeWorkspaceFilterId) => void;
  onWorkspaceCreate: (title: string) => void;
}) {
  const [tasks, setTasks] = useState<HomeTaskInfo[]>([]);

  useEffect(() => {
    if (workspaces.length === 0) {
      return;
    }

    const controller = new AbortController();

    const fetchTasks = async () => {
      try {
        const query = workspaceFilterId === "all"
          ? "/api/tasks?allWorkspaces=true"
          : `/api/tasks?workspaceId=${encodeURIComponent(workspaceFilterId)}`;
        const res = await fetch(query, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        setTasks(Array.isArray(data?.tasks) ? data.tasks as HomeTaskInfo[] : []);
      } catch {
        if (controller.signal.aborted) return;
        setTasks([]);
      }
    };

    void fetchTasks();
    return () => controller.abort();
  }, [workspaceFilterId, workspaces.length, refreshKey]);

  const activeWorkspace = workspaceFilterId === "all"
    ? null
    : workspaces.find((workspace) => workspace.id === workspaceFilterId) ?? null;
  const workspaceTitleById = new Map(workspaces.map((workspace) => [workspace.id, workspace.title]));
  const visibleTasks = tasks
    .filter((task) => !["COMPLETED", "CANCELLED"].includes(task.status.toUpperCase()))
    .sort((left, right) => {
      const leftTimestamp = new Date(left.updatedAt ?? left.createdAt).getTime();
      const rightTimestamp = new Date(right.updatedAt ?? right.createdAt).getTime();
      return rightTimestamp - leftTimestamp;
    });
  const tasksByColumn = visibleTasks.reduce<Record<HomeKanbanColumnId, HomeTaskInfo[]>>((groups, task) => {
    groups[normalizeHomeTaskColumnId(task)].push(task);
    return groups;
  }, {
    backlog: [],
    todo: [],
    dev: [],
    review: [],
    blocked: [],
  });

  return (
    <section className="rounded-[28px] border border-gray-100 bg-white/90 p-5 shadow-sm dark:border-[#1c1f2e] dark:bg-[#12141c] sm:p-6">
      <div className="flex flex-col gap-4 border-b border-gray-100 pb-5 dark:border-[#1c1f2e] lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-blue-500 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" />
            </svg>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
              Tasks at a glance
            </div>
          </div>
          <h2 className="mt-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
            {activeWorkspace ? `${activeWorkspace.title} board` : "Unified Kanban across workspaces"}
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            See active work immediately and use workspace filters as context instead of a navigation step.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 shadow-xs dark:border-[#2a2d3d] dark:bg-[#0f1118] dark:text-gray-300">
            <span className="text-xs font-medium uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">
              Workspace
            </span>
            <select
              aria-label="Filter workspace tasks"
              value={workspaceFilterId}
              onChange={(event) => onWorkspaceFilterChange(event.target.value as HomeWorkspaceFilterId)}
              className="rounded-md bg-transparent text-sm font-medium text-gray-900 outline-none ring-0 focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-100"
            >
              <option value="all">All workspaces</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.title}
                </option>
              ))}
            </select>
          </label>

          <Link
            href={activeWorkspace ? `/workspace/${activeWorkspace.id}/kanban` : "/workspaces"}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-500 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-600"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" />
            </svg>
            {activeWorkspace ? "Open workspace board" : "Browse workspaces"}
          </Link>
        </div>
      </div>

      <div className="mt-5 flex gap-4 overflow-x-auto pb-2">
        {HOME_KANBAN_COLUMNS.map((column) => {
          const columnTasks = tasksByColumn[column.id].slice(0, 6);
          return (
            <section
              key={column.id}
              className="min-h-[320px] min-w-[260px] flex-1 rounded-2xl border border-gray-100 bg-[#fcfcfc] p-4 dark:border-[#1c1f2e] dark:bg-[#0f1118]"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${column.accentClassName}`} />
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{column.title}</h3>
                </div>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-[#1c1f2e] dark:text-gray-300">
                  {tasksByColumn[column.id].length}
                </span>
              </div>

              {columnTasks.length === 0 ? (
                <div className="flex h-[240px] items-center justify-center rounded-xl border border-dashed border-gray-200 px-4 text-center text-sm text-gray-400 dark:border-[#232737] dark:text-gray-500">
                  {column.emptyCopy}
                </div>
              ) : (
                <div className="space-y-3">
                  {columnTasks.map((task) => (
                    <Link
                      key={task.id}
                      href={`/workspace/${task.workspaceId}/kanban`}
                      className="group block rounded-xl border border-gray-100 bg-white px-3.5 py-3 transition-all hover:border-blue-200 hover:bg-blue-50/60 hover:shadow-sm dark:border-[#1c1f2e] dark:bg-[#12141c] dark:hover:border-blue-800/40 dark:hover:bg-blue-900/5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-gray-800 transition-colors group-hover:text-blue-600 dark:text-gray-100 dark:group-hover:text-blue-400">
                            {task.title}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-[#1c1f2e] dark:text-gray-300">
                              {workspaceTitleById.get(task.workspaceId) ?? task.workspaceId}
                            </span>
                            <span>·</span>
                            <span>{task.assignedProvider ?? "unassigned"}</span>
                          </div>
                        </div>
                        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-600 dark:bg-[#1c1f2e] dark:text-gray-300">
                          {task.priority ?? "medium"}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-5 dark:border-[#1c1f2e]">
        {workspaces.map((workspace) => {
          const isActive = workspaceFilterId === workspace.id;
          return (
            <button
              key={workspace.id}
              type="button"
              onClick={() => onWorkspaceFilterChange(workspace.id)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700/50 dark:bg-amber-900/10 dark:text-amber-300"
                  : "border-gray-200 text-gray-500 hover:border-amber-200 hover:text-amber-600 dark:border-[#2a2d3d] dark:text-gray-400 dark:hover:border-amber-700/50 dark:hover:text-amber-300"
              }`}
            >
              {workspace.title}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => onWorkspaceCreate("New Workspace")}
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:border-amber-300 hover:text-amber-600 dark:border-[#2a2d3d] dark:text-gray-400 dark:hover:border-amber-700/50 dark:hover:text-amber-300"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New workspace
        </button>
      </div>
    </section>
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

interface HomeTaskInfo {
  id: string;
  title: string;
  status: string;
  priority?: string;
  columnId?: string;
  assignedProvider?: string;
  workspaceId: string;
  createdAt: string;
  updatedAt?: string;
}
