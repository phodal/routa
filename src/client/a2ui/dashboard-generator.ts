/**
 * A2UI Dashboard Generator
 *
 * Converts live workspace data (sessions, agents, tasks, etc.) into
 * A2UI v0.10 protocol messages for dynamic dashboard rendering.
 *
 * Each section of the dashboard is a separate A2UI surface, allowing
 * independent updates and modular composition.
 */

import type { A2UIMessage, A2UIComponent, TextAccent } from "./types";

// ─── Input data types ─────────────────────────────────────────────

export interface DashboardData {
  workspace: {
    id: string;
    title: string;
    status: string;
  };
  sessions: Array<{
    sessionId: string;
    name?: string;
    provider?: string;
    role?: string;
    createdAt: string;
  }>;
  agents: Array<{
    id: string;
    name: string;
    role: string;
    status: string;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    assignedTo?: string;
    createdAt: string;
  }>;
  bgTasks: Array<{
    id: string;
    title: string;
    status: string;
    agentId: string;
    triggerSource?: string;
    createdAt: string;
  }>;
  codebases: Array<{
    id: string;
    label?: string;
    repoPath: string;
    branch?: string;
    isDefault?: boolean;
  }>;
  notes: Array<{
    id: string;
    title: string;
    content: string;
    metadata?: Record<string, unknown>;
    updatedAt: string;
  }>;
  traces: Array<{
    id: string;
    agentName?: string;
    action?: string;
    summary?: string;
    createdAt: string;
  }>;
}

// ─── Stats surface ────────────────────────────────────────────────

function buildStatsSurface(data: DashboardData): A2UIMessage[] {
  const activeAgents = data.agents.filter((a) => a.status === "ACTIVE").length;
  const inProgressTasks = data.tasks.filter((t) => t.status === "IN_PROGRESS").length;
  const completedTasks = data.tasks.filter((t) => t.status === "COMPLETED").length;
  const runningBg = data.bgTasks.filter((t) => t.status === "RUNNING").length;
  const completedBg = data.bgTasks.filter((t) => t.status === "COMPLETED").length;
  const failedBg = data.bgTasks.filter((t) => t.status === "FAILED").length;

  const components: A2UIComponent[] = [
    { id: "root", component: "Row", children: ["stat_sessions", "stat_agents", "stat_tasks", "stat_bg"], justify: "spaceBetween", align: "stretch", gap: "md" },

    // Sessions card — info accent
    { id: "stat_sessions", component: "Card", child: "stat_sessions_inner", accent: "info", weight: 1 },
    { id: "stat_sessions_inner", component: "Column", children: ["stat_sessions_icon", "stat_sessions_value", "stat_sessions_label"], align: "start", gap: "xs" },
    { id: "stat_sessions_icon", component: "Icon", name: "chat" },
    { id: "stat_sessions_value", component: "Text", text: { path: "/stats/sessions" }, variant: "h2" },
    { id: "stat_sessions_label", component: "Text", text: "Sessions", variant: "caption" },

    // Agents card — violet accent
    { id: "stat_agents", component: "Card", child: "stat_agents_inner", accent: "violet", weight: 1 },
    { id: "stat_agents_inner", component: "Column", children: ["stat_agents_icon", "stat_agents_value", "stat_agents_sub"], align: "start", gap: "xs" },
    { id: "stat_agents_icon", component: "Icon", name: "people" },
    { id: "stat_agents_value", component: "Text", text: { path: "/stats/agents" }, variant: "h2" },
    { id: "stat_agents_sub", component: "Text", text: { path: "/stats/agentsSub" }, variant: "caption", accent: activeAgents > 0 ? "success" : "muted" },

    // Tasks card — success accent
    { id: "stat_tasks", component: "Card", child: "stat_tasks_inner", accent: "success", weight: 1 },
    { id: "stat_tasks_inner", component: "Column", children: ["stat_tasks_icon", "stat_tasks_value", "stat_tasks_sub"], align: "start", gap: "xs" },
    { id: "stat_tasks_icon", component: "Icon", name: "check_circle" },
    { id: "stat_tasks_value", component: "Text", text: { path: "/stats/tasks" }, variant: "h2" },
    { id: "stat_tasks_sub", component: "Text", text: { path: "/stats/tasksSub" }, variant: "caption", accent: inProgressTasks > 0 ? "info" : completedTasks > 0 ? "success" : "muted" },

    // BG Tasks card — dynamic accent based on state
    { id: "stat_bg", component: "Card", child: "stat_bg_inner", accent: runningBg > 0 ? "info" : failedBg > 0 ? "error" : "warning", weight: 1 },
    { id: "stat_bg_inner", component: "Column", children: ["stat_bg_icon", "stat_bg_value", "stat_bg_sub"], align: "start", gap: "xs" },
    { id: "stat_bg_icon", component: "Icon", name: runningBg > 0 ? "bolt" : "schedule" },
    { id: "stat_bg_value", component: "Text", text: { path: "/stats/bgTasks" }, variant: "h2" },
    { id: "stat_bg_sub", component: "Text", text: { path: "/stats/bgTasksSub" }, variant: "caption", accent: runningBg > 0 ? "info" : failedBg > 0 ? "error" : "muted" },
  ];

  return [
    {
      version: "v0.10",
      createSurface: {
        surfaceId: "dashboard_stats",
        catalogId: "https://a2ui.org/specification/v0_10/basic_catalog.json",
        theme: { agentDisplayName: data.workspace.title },
      },
    },
    {
      version: "v0.10",
      updateComponents: { surfaceId: "dashboard_stats", components },
    },
    {
      version: "v0.10",
      updateDataModel: {
        surfaceId: "dashboard_stats",
        value: {
          stats: {
            sessions: String(data.sessions.length),
            agents: String(data.agents.length),
            agentsSub: activeAgents > 0 ? `${activeAgents} active` : "none active",
            tasks: String(data.tasks.length),
            tasksSub: inProgressTasks > 0 ? `${inProgressTasks} in progress` : completedTasks > 0 ? `${completedTasks} done` : "none pending",
            bgTasks: String(data.bgTasks.length),
            bgTasksSub: runningBg > 0
              ? `${runningBg} running${failedBg > 0 ? ` · ${failedBg} failed` : ""}`
              : completedBg > 0
                ? `${completedBg} done${failedBg > 0 ? ` · ${failedBg} failed` : ""}`
                : "none queued",
          },
        },
      },
    },
  ];
}

// ─── Agent roster surface ─────────────────────────────────────────

function buildAgentRosterSurface(data: DashboardData): A2UIMessage[] {
  if (data.agents.length === 0) return [];

  const components: A2UIComponent[] = [
    { id: "root", component: "Card", child: "roster_body", label: "Agent Roster" },
    { id: "roster_body", component: "Column", children: ["agent_list"], align: "stretch", gap: "xs" },
    {
      id: "agent_list",
      component: "List",
      children: { componentId: "agent_row", path: "/agents" },
      direction: "vertical",
    },
    { id: "agent_row", component: "Row", children: ["agent_role_badge", "agent_info", "agent_status_pill"], align: "center", justify: "spaceBetween" },
    { id: "agent_role_badge", component: "Text", text: { path: "roleInitial" }, variant: "caption", accent: "violet", pill: true },
    { id: "agent_info", component: "Column", children: ["agent_name", "agent_role_text"], align: "start", weight: 1, gap: "none" },
    { id: "agent_name", component: "Text", text: { path: "name" }, variant: "h5" },
    { id: "agent_role_text", component: "Text", text: { path: "role" }, variant: "caption", accent: "muted" },
    { id: "agent_status_pill", component: "Text", text: { path: "status" }, variant: "caption", pill: true, accent: { path: "statusAccent" } as never },
  ];

  return [
    {
      version: "v0.10",
      createSurface: {
        surfaceId: "dashboard_agents",
        catalogId: "https://a2ui.org/specification/v0_10/basic_catalog.json",
      },
    },
    {
      version: "v0.10",
      updateComponents: { surfaceId: "dashboard_agents", components },
    },
    {
      version: "v0.10",
      updateDataModel: {
        surfaceId: "dashboard_agents",
        value: {
          agents: data.agents.map((a) => ({
            name: a.name,
            role: a.role.toUpperCase(),
            roleInitial: a.role.charAt(0).toUpperCase(),
            status: a.status.toLowerCase(),
            statusAccent: statusAccent(a.status),
          })),
        },
      },
    },
  ];
}

// ─── Tasks surface ────────────────────────────────────────────────

function buildTasksSurface(data: DashboardData): A2UIMessage[] {
  if (data.tasks.length === 0) return [];

  const pending = data.tasks.filter((t) => t.status === "PENDING");
  const inProgress = data.tasks.filter((t) => t.status === "IN_PROGRESS");
  const review = data.tasks.filter((t) => t.status === "REVIEW_REQUIRED" || t.status === "NEEDS_FIX");
  const completed = data.tasks.filter((t) => t.status === "COMPLETED");

  const components: A2UIComponent[] = [
    {
      id: "root",
      component: "Tabs",
      tabs: [
        { title: `Active (${inProgress.length + review.length})`, child: "tasks_active" },
        { title: `Pending (${pending.length})`, child: "tasks_pending" },
        { title: `Done (${completed.length})`, child: "tasks_done" },
      ],
    },
    // Active tab
    { id: "tasks_active", component: "Column", children: ["tasks_active_list"], align: "stretch" },
    { id: "tasks_active_list", component: "List", children: { componentId: "task_active_row", path: "/activeTasks" }, direction: "vertical" },
    { id: "task_active_row", component: "Row", children: ["task_active_info", "task_active_status"], align: "center", justify: "spaceBetween" },
    { id: "task_active_info", component: "Column", children: ["task_active_title", "task_active_time"], align: "start", weight: 1, gap: "none" },
    { id: "task_active_title", component: "Text", text: { path: "title" }, variant: "h5" },
    { id: "task_active_time", component: "Text", text: { path: "time" }, variant: "caption", accent: "muted" },
    { id: "task_active_status", component: "Text", text: { path: "status" }, variant: "caption", pill: true, accent: { path: "statusAccent" } as never },
    // Pending tab
    { id: "tasks_pending", component: "Column", children: ["tasks_pending_list"], align: "stretch" },
    { id: "tasks_pending_list", component: "List", children: { componentId: "task_pending_row", path: "/pendingTasks" }, direction: "vertical" },
    { id: "task_pending_row", component: "Row", children: ["task_pending_title", "task_pending_status"], align: "center", justify: "spaceBetween" },
    { id: "task_pending_title", component: "Text", text: { path: "title" }, variant: "h5", weight: 1 },
    { id: "task_pending_status", component: "Text", text: "PENDING", variant: "caption", pill: true, accent: "warning" },
    // Done tab
    { id: "tasks_done", component: "Column", children: ["tasks_done_list"], align: "stretch" },
    { id: "tasks_done_list", component: "List", children: { componentId: "task_done_row", path: "/doneTasks" }, direction: "vertical" },
    { id: "task_done_row", component: "Row", children: ["task_done_title", "task_done_time"], align: "center", justify: "spaceBetween" },
    { id: "task_done_title", component: "Text", text: { path: "title" }, variant: "h5", weight: 1, accent: "muted" },
    { id: "task_done_time", component: "Text", text: { path: "time" }, variant: "caption", accent: "muted" },
  ];

  return [
    {
      version: "v0.10",
      createSurface: {
        surfaceId: "dashboard_tasks",
        catalogId: "https://a2ui.org/specification/v0_10/basic_catalog.json",
      },
    },
    { version: "v0.10", updateComponents: { surfaceId: "dashboard_tasks", components } },
    {
      version: "v0.10",
      updateDataModel: {
        surfaceId: "dashboard_tasks",
        value: {
          activeTasks: [...inProgress, ...review].map((t) => ({
            title: t.title,
            status: t.status.replace(/_/g, " "),
            statusAccent: statusAccent(t.status),
            time: formatRelative(t.createdAt),
          })),
          pendingTasks: pending.map((t) => ({ title: t.title, time: formatRelative(t.createdAt) })),
          doneTasks: completed.slice(0, 10).map((t) => ({ title: t.title, time: formatRelative(t.createdAt) })),
        },
      },
    },
  ];
}

// ─── Background tasks surface ─────────────────────────────────────

function buildBgTasksSurface(data: DashboardData): A2UIMessage[] {
  if (data.bgTasks.length === 0) return [];

  const running = data.bgTasks.filter((t) => t.status === "RUNNING");
  const pending = data.bgTasks.filter((t) => t.status === "PENDING");
  const done = data.bgTasks.filter((t) => t.status === "COMPLETED" || t.status === "FAILED" || t.status === "CANCELLED");

  const components: A2UIComponent[] = [
    { id: "root", component: "Card", child: "bg_body", label: "Background Tasks" },
    {
      id: "bg_body",
      component: "Tabs",
      tabs: [
        { title: `Running (${running.length})`, child: "bg_running" },
        { title: `Pending (${pending.length})`, child: "bg_pending" },
        { title: `History (${done.length})`, child: "bg_done" },
      ],
    },
    // Running
    { id: "bg_running", component: "List", children: { componentId: "bg_running_row", path: "/running" }, direction: "vertical" },
    { id: "bg_running_row", component: "Row", children: ["bg_run_icon", "bg_run_info", "bg_run_status"], align: "center", justify: "spaceBetween" },
    { id: "bg_run_icon", component: "Icon", name: "bolt" },
    { id: "bg_run_info", component: "Column", children: ["bg_run_title", "bg_run_source"], align: "start", weight: 1, gap: "none" },
    { id: "bg_run_title", component: "Text", text: { path: "title" }, variant: "h5" },
    { id: "bg_run_source", component: "Text", text: { path: "source" }, variant: "caption", accent: "muted" },
    { id: "bg_run_status", component: "Text", text: "RUNNING", variant: "caption", pill: true, accent: "info" },
    // Pending
    { id: "bg_pending", component: "List", children: { componentId: "bg_pending_row", path: "/pending" }, direction: "vertical" },
    { id: "bg_pending_row", component: "Row", children: ["bg_pend_info", "bg_pend_status"], align: "center", justify: "spaceBetween" },
    { id: "bg_pend_info", component: "Column", children: ["bg_pend_title", "bg_pend_source"], align: "start", weight: 1, gap: "none" },
    { id: "bg_pend_title", component: "Text", text: { path: "title" }, variant: "h5" },
    { id: "bg_pend_source", component: "Text", text: { path: "source" }, variant: "caption", accent: "muted" },
    { id: "bg_pend_status", component: "Text", text: "PENDING", variant: "caption", pill: true, accent: "warning" },
    // History
    { id: "bg_done", component: "List", children: { componentId: "bg_done_row", path: "/history" }, direction: "vertical" },
    { id: "bg_done_row", component: "Row", children: ["bg_done_title", "bg_done_status", "bg_done_time"], align: "center", justify: "spaceBetween" },
    { id: "bg_done_title", component: "Text", text: { path: "title" }, variant: "h5", weight: 1, accent: "muted" },
    { id: "bg_done_status", component: "Text", text: { path: "status" }, variant: "caption", pill: true, accent: { path: "statusAccent" } as never },
    { id: "bg_done_time", component: "Text", text: { path: "time" }, variant: "caption", accent: "muted" },
  ];

  return [
    {
      version: "v0.10",
      createSurface: {
        surfaceId: "dashboard_bg_tasks",
        catalogId: "https://a2ui.org/specification/v0_10/basic_catalog.json",
      },
    },
    { version: "v0.10", updateComponents: { surfaceId: "dashboard_bg_tasks", components } },
    {
      version: "v0.10",
      updateDataModel: {
        surfaceId: "dashboard_bg_tasks",
        value: {
          running: running.map((t) => ({ title: t.title, source: `via ${t.triggerSource ?? "manual"}` })),
          pending: pending.map((t) => ({ title: t.title, source: `via ${t.triggerSource ?? "manual"}` })),
          history: done.slice(0, 10).map((t) => ({
            title: t.title,
            status: t.status.toLowerCase(),
            statusAccent: statusAccent(t.status),
            time: formatRelative(t.createdAt),
          })),
        },
      },
    },
  ];
}

// ─── Codebases surface ────────────────────────────────────────────

function buildCodebasesSurface(data: DashboardData): A2UIMessage[] {
  if (data.codebases.length === 0) return [];

  const components: A2UIComponent[] = [
    { id: "root", component: "Card", child: "cb_body", label: "Codebases" },
    { id: "cb_body", component: "List", children: { componentId: "cb_row", path: "/codebases" }, direction: "vertical" },
    { id: "cb_row", component: "Row", children: ["cb_icon", "cb_info", "cb_badge"], align: "center", justify: "spaceBetween" },
    { id: "cb_icon", component: "Icon", name: "code" },
    { id: "cb_info", component: "Column", children: ["cb_name", "cb_meta"], align: "start", weight: 1, gap: "none" },
    { id: "cb_name", component: "Text", text: { path: "label" }, variant: "h5" },
    { id: "cb_meta", component: "Text", text: { path: "meta" }, variant: "caption", accent: "muted" },
    { id: "cb_badge", component: "Text", text: { path: "badge" }, variant: "caption", pill: true, accent: { path: "badgeAccent" } as never },
  ];

  return [
    {
      version: "v0.10",
      createSurface: {
        surfaceId: "dashboard_codebases",
        catalogId: "https://a2ui.org/specification/v0_10/basic_catalog.json",
      },
    },
    { version: "v0.10", updateComponents: { surfaceId: "dashboard_codebases", components } },
    {
      version: "v0.10",
      updateDataModel: {
        surfaceId: "dashboard_codebases",
        value: {
          codebases: data.codebases.map((cb) => ({
            label: cb.label || cb.repoPath.split("/").pop() || cb.repoPath,
            meta: `${cb.branch ?? "—"}  ·  ${cb.repoPath}`,
            badge: cb.isDefault ? "Default" : (cb.branch ?? "—"),
            badgeAccent: cb.isDefault ? "primary" : ("muted" as TextAccent),
          })),
        },
      },
    },
  ];
}

// ─── Activity feed surface ────────────────────────────────────────

function buildActivitySurface(data: DashboardData): A2UIMessage[] {
  if (data.traces.length === 0) return [];

  const components: A2UIComponent[] = [
    { id: "root", component: "Card", child: "act_body", label: "Recent Activity" },
    { id: "act_body", component: "List", children: { componentId: "act_row", path: "/traces" }, direction: "vertical" },
    { id: "act_row", component: "Row", children: ["act_info", "act_meta"], align: "start", justify: "spaceBetween" },
    { id: "act_info", component: "Column", children: ["act_summary", "act_agent"], align: "start", weight: 1, gap: "none" },
    { id: "act_summary", component: "Text", text: { path: "summary" }, variant: "body" },
    { id: "act_agent", component: "Text", text: { path: "agent" }, variant: "caption", accent: "violet" },
    { id: "act_meta", component: "Column", children: ["act_time"], align: "end", gap: "none" },
    { id: "act_time", component: "Text", text: { path: "time" }, variant: "caption", accent: "muted" },
  ];

  return [
    {
      version: "v0.10",
      createSurface: {
        surfaceId: "dashboard_activity",
        catalogId: "https://a2ui.org/specification/v0_10/basic_catalog.json",
      },
    },
    { version: "v0.10", updateComponents: { surfaceId: "dashboard_activity", components } },
    {
      version: "v0.10",
      updateDataModel: {
        surfaceId: "dashboard_activity",
        value: {
          traces: data.traces.slice(0, 8).map((t) => ({
            summary: t.summary || t.action || "Agent trace",
            agent: t.agentName ? `↳ ${t.agentName}` : "",
            time: formatRelative(t.createdAt),
          })),
        },
      },
    },
  ];
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Generate a complete set of A2UI messages for a workspace dashboard.
 * Each section is a separate surface for modular rendering.
 */
export function generateDashboardA2UI(data: DashboardData): A2UIMessage[] {
  return [
    ...buildStatsSurface(data),
    ...buildAgentRosterSurface(data),
    ...buildTasksSurface(data),
    ...buildBgTasksSurface(data),
    ...buildCodebasesSurface(data),
    ...buildActivitySurface(data),
  ];
}

/**
 * Generate A2UI messages for a single custom surface.
 * Agents can call this to add custom dashboard panels.
 */
export function generateCustomSurfaceA2UI(
  surfaceId: string,
  components: A2UIComponent[],
  dataModel: Record<string, unknown>,
  theme?: { primaryColor?: string; agentDisplayName?: string; iconUrl?: string },
): A2UIMessage[] {
  return [
    {
      version: "v0.10",
      createSurface: {
        surfaceId,
        catalogId: "https://a2ui.org/specification/v0_10/basic_catalog.json",
        theme,
      },
    },
    {
      version: "v0.10",
      updateComponents: { surfaceId, components },
    },
    {
      version: "v0.10",
      updateDataModel: { surfaceId, value: dataModel },
    },
  ];
}

// ─── Template generators (user-selectable) ────────────────────────────────────

/**
 * Task Kanban — tasks grouped by status using Tabs component.
 */
export function generateTaskKanbanSurface(data: DashboardData): A2UIMessage[] {
  return buildTasksSurface(data).map((m) => {
    if ("createSurface" in m) return { ...m, createSurface: { ...m.createSurface!, surfaceId: "template_kanban" } };
    if ("updateComponents" in m) return { ...m, updateComponents: { ...m.updateComponents!, surfaceId: "template_kanban" } };
    if ("updateDataModel" in m) return { ...m, updateDataModel: { ...m.updateDataModel!, surfaceId: "template_kanban" } };
    return m;
  });
}

/**
 * Agent Monitor — full agent grid showing role + status as cards.
 */
export function generateAgentMonitorSurface(agents: DashboardData["agents"]): A2UIMessage[] {
  if (agents.length === 0) return [];
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: ["am_header", "am_grid"], align: "stretch", gap: "md" },
    { id: "am_header", component: "Row", children: ["am_title", "am_summary"], align: "center", justify: "spaceBetween" },
    { id: "am_title", component: "Text", text: "Agent Monitor", variant: "h3" },
    { id: "am_summary", component: "Text", text: { path: "/summary" }, variant: "caption", accent: "muted" },
    { id: "am_grid", component: "List", children: { componentId: "agent_card", path: "/agents" }, direction: "horizontal" },
    { id: "agent_card", component: "Card", child: "agent_card_body", accent: { path: "statusAccent" } as never },
    { id: "agent_card_body", component: "Column", children: ["agent_initial", "agent_card_name", "agent_card_role", "agent_card_status"], align: "center", gap: "xs" },
    { id: "agent_initial", component: "Text", text: { path: "initial" }, variant: "h2", accent: "violet" },
    { id: "agent_card_name", component: "Text", text: { path: "name" }, variant: "h5" },
    { id: "agent_card_role", component: "Text", text: { path: "role" }, variant: "caption", accent: "muted" },
    { id: "agent_card_status", component: "Text", text: { path: "status" }, variant: "caption", pill: true, accent: { path: "statusAccent" } as never },
  ];
  const activeCount = agents.filter((a) => a.status === "ACTIVE").length;
  return [
    { version: "v0.10", createSurface: { surfaceId: "template_agent_monitor", catalogId: "https://a2ui.org/specification/v0_10/basic_catalog.json", theme: { agentDisplayName: "Agent Monitor" } } },
    { version: "v0.10", updateComponents: { surfaceId: "template_agent_monitor", components } },
    { version: "v0.10", updateDataModel: { surfaceId: "template_agent_monitor", value: {
      summary: `${agents.length} total · ${activeCount} active`,
      agents: agents.map((a) => ({ name: a.name, role: a.role.toUpperCase(), initial: a.name.charAt(0).toUpperCase(), status: a.status.toLowerCase(), statusAccent: statusAccent(a.status) })),
    } } },
  ];
}

/**
 * Activity Timeline — chronological list of traces + sessions.
 */
export function generateTimelineSurface(data: DashboardData): A2UIMessage[] {
  type TLItem = { ts: number; time: string; label: string; meta: string; kind: "session" | "trace" };
  const items: TLItem[] = [
    ...data.traces.map((t) => ({ ts: new Date(t.createdAt).getTime(), time: formatRelative(t.createdAt), label: t.summary || t.action || "Agent trace", meta: t.agentName ? `Agent: ${t.agentName}` : "", kind: "trace" as const })),
    ...data.sessions.map((s) => ({ ts: new Date(s.createdAt).getTime(), time: formatRelative(s.createdAt), label: s.name || s.provider || `Session ${s.sessionId.slice(0, 8)}`, meta: [s.role, s.provider].filter(Boolean).join(" · "), kind: "session" as const })),
  ].sort((a, b) => b.ts - a.ts).slice(0, 20);

  const components: A2UIComponent[] = [
    { id: "root", component: "Card", child: "tl_body", label: "Activity Timeline" },
    { id: "tl_body", component: "List", children: { componentId: "tl_row", path: "/items" }, direction: "vertical" },
    { id: "tl_row", component: "Row", children: ["tl_dot", "tl_info", "tl_time"], align: "start", justify: "spaceBetween" },
    { id: "tl_dot", component: "Text", text: { path: "kind" }, variant: "caption", pill: true, accent: { path: "kindAccent" } as never },
    { id: "tl_info", component: "Column", children: ["tl_label", "tl_meta"], align: "start", weight: 1, gap: "none" },
    { id: "tl_label", component: "Text", text: { path: "label" }, variant: "h5" },
    { id: "tl_meta", component: "Text", text: { path: "meta" }, variant: "caption", accent: "muted" },
    { id: "tl_time", component: "Text", text: { path: "time" }, variant: "caption", accent: "muted" },
  ];
  return [
    { version: "v0.10", createSurface: { surfaceId: "template_timeline", catalogId: "https://a2ui.org/specification/v0_10/basic_catalog.json", theme: { agentDisplayName: "Timeline" } } },
    { version: "v0.10", updateComponents: { surfaceId: "template_timeline", components } },
    { version: "v0.10", updateDataModel: { surfaceId: "template_timeline", value: { items: items.map((i) => ({ ...i, kindAccent: i.kind === "session" ? "info" : "violet" })) } } },
  ];
}

/**
 * Workspace Summary — compact health + key counts panel.
 */
export function generateWorkspaceSummarySurface(data: DashboardData): A2UIMessage[] {
  const failedBg = data.bgTasks.filter((t) => t.status === "FAILED").length;
  const totalBg = data.bgTasks.length;
  let score = 100;
  if (totalBg > 0) score -= Math.round((failedBg / totalBg) * 40);
  if (data.agents.length === 0) score -= 10;
  if (data.sessions.length === 0) score -= 10;
  score = Math.max(0, score);
  const healthAccent: TextAccent = score >= 80 ? "success" : score >= 50 ? "warning" : "error";
  const healthLabel = score >= 80 ? "Healthy" : score >= 50 ? "Degraded" : "Unhealthy";

  const components: A2UIComponent[] = [
    { id: "root", component: "Card", child: "ws_body", label: `Workspace: ${data.workspace.title}` },
    { id: "ws_body", component: "Column", children: ["ws_health", "ws_divider", "ws_rows"], align: "stretch", gap: "md" },
    { id: "ws_health", component: "Row", children: ["ws_health_label", "ws_health_pill"], align: "center", justify: "spaceBetween" },
    { id: "ws_health_label", component: "Text", text: "Status", variant: "h5" },
    { id: "ws_health_pill", component: "Text", text: { path: "/health/label" }, variant: "caption", pill: true, accent: healthAccent },
    { id: "ws_divider", component: "Divider" },
    { id: "ws_rows", component: "Column", children: ["ws_row1", "ws_row2", "ws_row3", "ws_row4"], align: "stretch", gap: "xs" },
    { id: "ws_row1", component: "Row", children: ["ws_r1_label", "ws_r1_val"], align: "center", justify: "spaceBetween" },
    { id: "ws_r1_label", component: "Text", text: "Sessions", variant: "body" },
    { id: "ws_r1_val", component: "Text", text: { path: "/counts/sessions" }, variant: "h5", accent: "info" },
    { id: "ws_row2", component: "Row", children: ["ws_r2_label", "ws_r2_val"], align: "center", justify: "spaceBetween" },
    { id: "ws_r2_label", component: "Text", text: "Agents", variant: "body" },
    { id: "ws_r2_val", component: "Text", text: { path: "/counts/agents" }, variant: "h5", accent: "violet" },
    { id: "ws_row3", component: "Row", children: ["ws_r3_label", "ws_r3_val"], align: "center", justify: "spaceBetween" },
    { id: "ws_r3_label", component: "Text", text: "Tasks", variant: "body" },
    { id: "ws_r3_val", component: "Text", text: { path: "/counts/tasks" }, variant: "h5", accent: "success" },
    { id: "ws_row4", component: "Row", children: ["ws_r4_label", "ws_r4_val"], align: "center", justify: "spaceBetween" },
    { id: "ws_r4_label", component: "Text", text: "BG Tasks", variant: "body" },
    { id: "ws_r4_val", component: "Text", text: { path: "/counts/bgTasks" }, variant: "h5", accent: "warning" },
  ];
  const activeAgents = data.agents.filter((a) => a.status === "ACTIVE").length;
  const runningBg = data.bgTasks.filter((t) => t.status === "RUNNING").length;
  return [
    { version: "v0.10", createSurface: { surfaceId: "template_ws_summary", catalogId: "https://a2ui.org/specification/v0_10/basic_catalog.json", theme: { agentDisplayName: "Workspace Summary" } } },
    { version: "v0.10", updateComponents: { surfaceId: "template_ws_summary", components } },
    { version: "v0.10", updateDataModel: { surfaceId: "template_ws_summary", value: {
      health: { label: healthLabel },
      counts: {
        sessions: `${data.sessions.length}`,
        agents: `${data.agents.length} (${activeAgents} active)`,
        tasks: `${data.tasks.length} (${data.tasks.filter((t) => t.status === "IN_PROGRESS").length} active)`,
        bgTasks: `${data.bgTasks.length} (${runningBg} running)`,
      },
    } } },
  ];
}

// ─── Helpers ──────────────────────────────────────────────────────

function formatRelative(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

function statusAccent(status: string): TextAccent {
  const s = status.toUpperCase();
  if (s === "ACTIVE" || s === "COMPLETED") return "success";
  if (s === "RUNNING" || s === "IN_PROGRESS") return "info";
  if (s === "FAILED" || s === "ERROR" || s === "BLOCKED") return "error";
  if (s === "PENDING" || s === "REVIEW_REQUIRED" || s === "NEEDS_FIX") return "warning";
  if (s === "CANCELLED") return "muted";
  return "muted";
}
