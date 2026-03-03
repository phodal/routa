/**
 * A2UI Dashboard Generator
 *
 * Converts live workspace data (sessions, agents, tasks, etc.) into
 * A2UI v0.10 protocol messages for dynamic dashboard rendering.
 *
 * Each section of the dashboard is a separate A2UI surface, allowing
 * independent updates and modular composition.
 */

import type { A2UIMessage, A2UIComponent } from "./types";

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
  const pendingTasks = data.tasks.filter((t) => t.status === "PENDING" || t.status === "IN_PROGRESS").length;
  const runningBg = data.bgTasks.filter((t) => t.status === "RUNNING").length;
  const completedBg = data.bgTasks.filter((t) => t.status === "COMPLETED").length;
  const failedBg = data.bgTasks.filter((t) => t.status === "FAILED").length;

  const components: A2UIComponent[] = [
    { id: "root", component: "Row", children: ["stat_sessions", "stat_agents", "stat_tasks", "stat_bg"], justify: "spaceEvenly", align: "stretch" },

    // Sessions stat
    { id: "stat_sessions", component: "Card", child: "stat_sessions_inner", weight: 1 },
    { id: "stat_sessions_inner", component: "Column", children: ["stat_sessions_icon_row", "stat_sessions_value", "stat_sessions_label"], align: "start" },
    { id: "stat_sessions_icon_row", component: "Row", children: ["stat_sessions_icon"], align: "center" },
    { id: "stat_sessions_icon", component: "Icon", name: "chat" },
    { id: "stat_sessions_value", component: "Text", text: { path: "/stats/sessions" }, variant: "h2" },
    { id: "stat_sessions_label", component: "Text", text: "Sessions", variant: "caption" },

    // Agents stat
    { id: "stat_agents", component: "Card", child: "stat_agents_inner", weight: 1 },
    { id: "stat_agents_inner", component: "Column", children: ["stat_agents_icon_row", "stat_agents_value", "stat_agents_sub"], align: "start" },
    { id: "stat_agents_icon_row", component: "Row", children: ["stat_agents_icon"], align: "center" },
    { id: "stat_agents_icon", component: "Icon", name: "people" },
    { id: "stat_agents_value", component: "Text", text: { path: "/stats/agents" }, variant: "h2" },
    { id: "stat_agents_sub", component: "Text", text: { path: "/stats/agentsSub" }, variant: "caption" },

    // Tasks stat
    { id: "stat_tasks", component: "Card", child: "stat_tasks_inner", weight: 1 },
    { id: "stat_tasks_inner", component: "Column", children: ["stat_tasks_icon_row", "stat_tasks_value", "stat_tasks_sub"], align: "start" },
    { id: "stat_tasks_icon_row", component: "Row", children: ["stat_tasks_icon"], align: "center" },
    { id: "stat_tasks_icon", component: "Icon", name: "check_circle" },
    { id: "stat_tasks_value", component: "Text", text: { path: "/stats/tasks" }, variant: "h2" },
    { id: "stat_tasks_sub", component: "Text", text: { path: "/stats/tasksSub" }, variant: "caption" },

    // BG Tasks stat
    { id: "stat_bg", component: "Card", child: "stat_bg_inner", weight: 1 },
    { id: "stat_bg_inner", component: "Column", children: ["stat_bg_icon_row", "stat_bg_value", "stat_bg_sub"], align: "start" },
    { id: "stat_bg_icon_row", component: "Row", children: ["stat_bg_icon"], align: "center" },
    { id: "stat_bg_icon", component: "Icon", name: "schedule" },
    { id: "stat_bg_value", component: "Text", text: { path: "/stats/bgTasks" }, variant: "h2" },
    { id: "stat_bg_sub", component: "Text", text: { path: "/stats/bgTasksSub" }, variant: "caption" },
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
            tasksSub: pendingTasks > 0 ? `${pendingTasks} in progress` : "none pending",
            bgTasks: String(data.bgTasks.length),
            bgTasksSub: runningBg > 0
              ? `${runningBg} running · ${completedBg} done · ${failedBg} failed`
              : completedBg > 0
                ? `${completedBg} done · ${failedBg} failed`
                : "none",
          },
        },
      },
    },
  ];
}

// ─── Agent roster surface ─────────────────────────────────────────

function buildAgentRosterSurface(data: DashboardData): A2UIMessage[] {
  if (data.agents.length === 0) return [];

  const agentComponents: A2UIComponent[] = [
    { id: "root", component: "Column", children: ["roster_title", "roster_divider", "agent_list"], align: "stretch" },
    { id: "roster_title", component: "Row", children: ["roster_icon", "roster_heading", "roster_count"], align: "center", justify: "start" },
    { id: "roster_icon", component: "Icon", name: "people" },
    { id: "roster_heading", component: "Text", text: "Agent Roster", variant: "h3" },
    { id: "roster_count", component: "Text", text: { path: "/agentCount" }, variant: "caption" },
    { id: "roster_divider", component: "Divider" },
    // Dynamic list of agents
    {
      id: "agent_list",
      component: "List",
      children: { componentId: "agent_row", path: "/agents" },
      direction: "vertical",
    },
    // Template for each agent
    { id: "agent_row", component: "Row", children: ["agent_role_badge", "agent_info", "agent_status"], align: "center", justify: "spaceBetween" },
    { id: "agent_role_badge", component: "Text", text: { path: "role" }, variant: "caption" },
    { id: "agent_info", component: "Column", children: ["agent_name", "agent_role_label"], align: "start", weight: 1 },
    { id: "agent_name", component: "Text", text: { path: "name" }, variant: "h5" },
    { id: "agent_role_label", component: "Text", text: { path: "role" }, variant: "caption" },
    { id: "agent_status", component: "Text", text: { path: "status" }, variant: "caption" },
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
      updateComponents: { surfaceId: "dashboard_agents", components: agentComponents },
    },
    {
      version: "v0.10",
      updateDataModel: {
        surfaceId: "dashboard_agents",
        value: {
          agentCount: `${data.agents.length} agents`,
          agents: data.agents.map((a) => ({
            name: a.name,
            role: a.role,
            status: a.status.toLowerCase(),
          })),
        },
      },
    },
  ];
}

// ─── Recent sessions surface ──────────────────────────────────────

function buildSessionsSurface(data: DashboardData): A2UIMessage[] {
  if (data.sessions.length === 0) return [];

  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: ["sessions_header", "sessions_divider", "sessions_list"], align: "stretch" },
    { id: "sessions_header", component: "Row", children: ["sessions_icon", "sessions_title", "sessions_count"], align: "center" },
    { id: "sessions_icon", component: "Icon", name: "chat" },
    { id: "sessions_title", component: "Text", text: "Recent Sessions", variant: "h3" },
    { id: "sessions_count", component: "Text", text: { path: "/sessionCount" }, variant: "caption" },
    { id: "sessions_divider", component: "Divider" },
    {
      id: "sessions_list",
      component: "List",
      children: { componentId: "session_row", path: "/sessions" },
      direction: "vertical",
    },
    { id: "session_row", component: "Row", children: ["session_info", "session_time"], align: "center", justify: "spaceBetween" },
    { id: "session_info", component: "Column", children: ["session_name", "session_meta"], align: "start", weight: 1 },
    { id: "session_name", component: "Text", text: { path: "name" }, variant: "h5" },
    { id: "session_meta", component: "Text", text: { path: "meta" }, variant: "caption" },
    { id: "session_time", component: "Text", text: { path: "time" }, variant: "caption" },
  ];

  return [
    {
      version: "v0.10",
      createSurface: {
        surfaceId: "dashboard_sessions",
        catalogId: "https://a2ui.org/specification/v0_10/basic_catalog.json",
      },
    },
    {
      version: "v0.10",
      updateComponents: { surfaceId: "dashboard_sessions", components },
    },
    {
      version: "v0.10",
      updateDataModel: {
        surfaceId: "dashboard_sessions",
        value: {
          sessionCount: `${data.sessions.length} sessions`,
          sessions: data.sessions.slice(0, 8).map((s) => ({
            name: s.name || s.provider || `Session ${s.sessionId.slice(0, 8)}`,
            meta: [s.role, s.provider].filter(Boolean).join(" · "),
            time: formatRelative(s.createdAt),
            sessionId: s.sessionId,
          })),
        },
      },
    },
  ];
}

// ─── Background tasks surface ─────────────────────────────────────

function buildBgTasksSurface(data: DashboardData): A2UIMessage[] {
  if (data.bgTasks.length === 0) return [];

  const statusCounts: Record<string, number> = {};
  for (const t of data.bgTasks) {
    statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;
  }
  const statusSummary = Object.entries(statusCounts)
    .map(([k, v]) => `${v} ${k.toLowerCase()}`)
    .join(" · ");

  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: ["bg_header", "bg_status_bar", "bg_divider", "bg_list"], align: "stretch" },
    { id: "bg_header", component: "Row", children: ["bg_icon", "bg_title", "bg_count"], align: "center" },
    { id: "bg_icon", component: "Icon", name: "bolt" },
    { id: "bg_title", component: "Text", text: "Background Tasks", variant: "h3" },
    { id: "bg_count", component: "Text", text: { path: "/bgCount" }, variant: "caption" },
    { id: "bg_status_bar", component: "Text", text: { path: "/bgStatusSummary" }, variant: "caption" },
    { id: "bg_divider", component: "Divider" },
    {
      id: "bg_list",
      component: "List",
      children: { componentId: "bg_row", path: "/bgTasks" },
      direction: "vertical",
    },
    { id: "bg_row", component: "Row", children: ["bg_task_info", "bg_task_agent", "bg_task_status"], align: "center", justify: "spaceBetween" },
    { id: "bg_task_info", component: "Column", children: ["bg_task_title", "bg_task_source"], align: "start", weight: 1 },
    { id: "bg_task_title", component: "Text", text: { path: "title" }, variant: "h5" },
    { id: "bg_task_source", component: "Text", text: { path: "source" }, variant: "caption" },
    { id: "bg_task_agent", component: "Text", text: { path: "agentId" }, variant: "caption" },
    { id: "bg_task_status", component: "Text", text: { path: "status" }, variant: "caption" },
  ];

  return [
    {
      version: "v0.10",
      createSurface: {
        surfaceId: "dashboard_bg_tasks",
        catalogId: "https://a2ui.org/specification/v0_10/basic_catalog.json",
      },
    },
    {
      version: "v0.10",
      updateComponents: { surfaceId: "dashboard_bg_tasks", components },
    },
    {
      version: "v0.10",
      updateDataModel: {
        surfaceId: "dashboard_bg_tasks",
        value: {
          bgCount: `${data.bgTasks.length} tasks`,
          bgStatusSummary: statusSummary,
          bgTasks: data.bgTasks.slice(0, 10).map((t) => ({
            title: t.title,
            source: t.triggerSource || "manual",
            agentId: t.agentId,
            status: t.status.toLowerCase(),
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
    { id: "root", component: "Column", children: ["cb_header", "cb_divider", "cb_list"], align: "stretch" },
    { id: "cb_header", component: "Row", children: ["cb_icon", "cb_title"], align: "center" },
    { id: "cb_icon", component: "Icon", name: "code" },
    { id: "cb_title", component: "Text", text: "Codebases", variant: "h3" },
    { id: "cb_divider", component: "Divider" },
    {
      id: "cb_list",
      component: "List",
      children: { componentId: "cb_row", path: "/codebases" },
      direction: "vertical",
    },
    { id: "cb_row", component: "Row", children: ["cb_info", "cb_branch"], align: "center", justify: "spaceBetween" },
    { id: "cb_info", component: "Column", children: ["cb_name", "cb_path"], align: "start", weight: 1 },
    { id: "cb_name", component: "Text", text: { path: "label" }, variant: "h5" },
    { id: "cb_path", component: "Text", text: { path: "repoPath" }, variant: "caption" },
    { id: "cb_branch", component: "Text", text: { path: "branch" }, variant: "caption" },
  ];

  return [
    {
      version: "v0.10",
      createSurface: {
        surfaceId: "dashboard_codebases",
        catalogId: "https://a2ui.org/specification/v0_10/basic_catalog.json",
      },
    },
    {
      version: "v0.10",
      updateComponents: { surfaceId: "dashboard_codebases", components },
    },
    {
      version: "v0.10",
      updateDataModel: {
        surfaceId: "dashboard_codebases",
        value: {
          codebases: data.codebases.map((cb) => ({
            label: cb.label || cb.repoPath.split("/").pop() || cb.repoPath,
            repoPath: cb.repoPath,
            branch: cb.branch || "—",
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
    { id: "root", component: "Column", children: ["act_header", "act_divider", "act_list"], align: "stretch" },
    { id: "act_header", component: "Row", children: ["act_icon", "act_title"], align: "center" },
    { id: "act_icon", component: "Icon", name: "trending_up" },
    { id: "act_title", component: "Text", text: "Recent Activity", variant: "h3" },
    { id: "act_divider", component: "Divider" },
    {
      id: "act_list",
      component: "List",
      children: { componentId: "act_row", path: "/traces" },
      direction: "vertical",
    },
    { id: "act_row", component: "Row", children: ["act_info", "act_time"], align: "center", justify: "spaceBetween" },
    { id: "act_info", component: "Column", children: ["act_summary", "act_agent"], align: "start", weight: 1 },
    { id: "act_summary", component: "Text", text: { path: "summary" }, variant: "body" },
    { id: "act_agent", component: "Text", text: { path: "agent" }, variant: "caption" },
    { id: "act_time", component: "Text", text: { path: "time" }, variant: "caption" },
  ];

  return [
    {
      version: "v0.10",
      createSurface: {
        surfaceId: "dashboard_activity",
        catalogId: "https://a2ui.org/specification/v0_10/basic_catalog.json",
      },
    },
    {
      version: "v0.10",
      updateComponents: { surfaceId: "dashboard_activity", components },
    },
    {
      version: "v0.10",
      updateDataModel: {
        surfaceId: "dashboard_activity",
        value: {
          traces: data.traces.slice(0, 8).map((t) => ({
            summary: t.summary || t.action || "Agent trace",
            agent: t.agentName || "—",
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
    ...buildSessionsSurface(data),
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
