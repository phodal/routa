"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatRelativeTime } from "../ui-components";
import type { BackgroundTaskInfo } from "../types";

interface WorkspaceBackgroundAgent {
  id: string;
  name: string;
  role: string;
  status: string;
  parentId?: string;
}

interface KanbanBgAgentPanelProps {
  workspaceId: string;
}

interface CreateAgentFormState {
  name: string;
  role: string;
  modelTier: string;
}

function normalizeAgentKey(value: string): string {
  return value.trim().toLowerCase();
}

function statusClass(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300",
    PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
    COMPLETED: "bg-gray-100 text-gray-600 dark:bg-[#20242f] dark:text-gray-300",
    ERROR: "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-300",
    CANCELLED: "bg-gray-100 text-gray-500 dark:bg-[#20242f] dark:text-gray-400",
  };
  return map[status.toUpperCase()] ?? map.PENDING;
}

function roleClass(role: string): string {
  const map: Record<string, string> = {
    ROUTA: "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
    DEVELOPER: "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300",
    CRAFTER: "bg-violet-100 text-violet-700 dark:bg-violet-900/20 dark:text-violet-300",
    GATE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300",
  };
  return map[role.toUpperCase()] ?? map.DEVELOPER;
}

export function KanbanBgAgentPanel({ workspaceId }: KanbanBgAgentPanelProps) {
  const [agents, setAgents] = useState<WorkspaceBackgroundAgent[]>([]);
  const [bgTasks, setBgTasks] = useState<BackgroundTaskInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreateAgentFormState>({
    name: "",
    role: "DEVELOPER",
    modelTier: "BALANCED",
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const fetchPanelData = useCallback(async (signal?: AbortSignal) => {
    if (signal?.aborted) return;
    setLoading(true);
    setError(null);
    try {
      const [agentsResponse, bgTasksResponse] = await Promise.all([
        fetch(`/api/agents?workspaceId=${encodeURIComponent(workspaceId)}`, {
          cache: "no-store",
          signal,
        }),
        fetch(`/api/background-tasks?workspaceId=${encodeURIComponent(workspaceId)}`, {
          cache: "no-store",
          signal,
        }),
      ]);

      const [agentsData, bgTasksData] = await Promise.all([
        agentsResponse.json().catch(() => []),
        bgTasksResponse.json().catch(() => ({ tasks: [] })),
      ]);

      if (signal?.aborted) return;

      setAgents(Array.isArray(agentsData) ? agentsData : []);
      setBgTasks(Array.isArray(bgTasksData?.tasks) ? bgTasksData.tasks : []);

      if (!agentsResponse.ok || !bgTasksResponse.ok) {
        setError("Failed to refresh background agent data.");
      }
    } catch (fetchError) {
      if (signal?.aborted) return;
      setError(fetchError instanceof Error ? fetchError.message : "Failed to refresh background agent data.");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchPanelData(controller.signal);
    return () => controller.abort();
  }, [fetchPanelData]);

  const groupedRoutes = useMemo(() => {
    const groups = new Map<string, {
      agentId: string;
      total: number;
      pending: number;
      running: number;
      completed: number;
      failed: number;
      latestTask: BackgroundTaskInfo | null;
    }>();

    for (const task of bgTasks) {
      const key = task.agentId.trim();
      const current = groups.get(key) ?? {
        agentId: key,
        total: 0,
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0,
        latestTask: null,
      };

      current.total += 1;
      if (task.status === "PENDING") current.pending += 1;
      if (task.status === "RUNNING") current.running += 1;
      if (task.status === "COMPLETED") current.completed += 1;
      if (task.status === "FAILED") current.failed += 1;

      const currentLatest = current.latestTask
        ? new Date(current.latestTask.createdAt).getTime()
        : 0;
      const candidateLatest = new Date(task.createdAt).getTime();
      if (!current.latestTask || candidateLatest > currentLatest) {
        current.latestTask = task;
      }

      groups.set(key, current);
    }

    return Array.from(groups.values()).sort((left, right) => right.total - left.total);
  }, [bgTasks]);

  const linkedRouteKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const agent of agents) {
      keys.add(normalizeAgentKey(agent.id));
      keys.add(normalizeAgentKey(agent.name));
    }
    return keys;
  }, [agents]);

  const agentCards = useMemo(() => {
    return agents.map((agent) => {
      const matchedRoutes = groupedRoutes.filter((route) => {
        const normalizedRoute = normalizeAgentKey(route.agentId);
        return normalizedRoute === normalizeAgentKey(agent.id) || normalizedRoute === normalizeAgentKey(agent.name);
      });

      const totals = matchedRoutes.reduce((acc, route) => {
        acc.total += route.total;
        acc.pending += route.pending;
        acc.running += route.running;
        acc.completed += route.completed;
        acc.failed += route.failed;
        if (!acc.latestTask) {
          acc.latestTask = route.latestTask;
          return acc;
        }
        if (
          route.latestTask &&
          (!acc.latestTask || new Date(route.latestTask.createdAt).getTime() > new Date(acc.latestTask.createdAt).getTime())
        ) {
          acc.latestTask = route.latestTask;
        }
        return acc;
      }, {
        total: 0,
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0,
        latestTask: null as BackgroundTaskInfo | null,
      });

      return {
        agent,
        ...totals,
      };
    });
  }, [agents, groupedRoutes]);

  const unlinkedRoutes = useMemo(() => {
    return groupedRoutes.filter((route) => !linkedRouteKeys.has(normalizeAgentKey(route.agentId)));
  }, [groupedRoutes, linkedRouteKeys]);

  const runningRoutes = groupedRoutes.filter((route) => route.running > 0).length;
  const pendingTasks = bgTasks.filter((task) => task.status === "PENDING").length;
  const activeAgents = agents.filter((agent) => agent.status === "ACTIVE").length;

  const handleCreateAgent = useCallback(async () => {
    if (!createForm.name.trim()) {
      setCreateError("Agent name is required.");
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          name: createForm.name.trim(),
          role: createForm.role,
          modelTier: createForm.modelTier,
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to create background agent");
      }

      setShowCreateModal(false);
      setCreateForm({ name: "", role: "DEVELOPER", modelTier: "BALANCED" });
      await fetchPanelData();
    } catch (createAgentError) {
      setCreateError(createAgentError instanceof Error ? createAgentError.message : "Failed to create background agent");
    } finally {
      setCreating(false);
    }
  }, [createForm, fetchPanelData, workspaceId]);

  return (
    <>
      <section
        className="shrink-0 rounded-2xl border border-gray-200/70 bg-white px-4 py-4 dark:border-[#1c1f2e] dark:bg-[#12141c]"
        data-testid="kanban-bg-agent-panel"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                  Workspace
                </span>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Background Agents</h2>
              </div>
              <p className="mt-1 text-[12px] text-gray-500 dark:text-gray-400">
                Visualize this workspace&apos;s dedicated background agents and the queue routes they are driving.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void fetchPanelData()}
                className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-[#191c28]"
              >
                {loading ? "Refreshing…" : "Refresh"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreateError(null);
                  setShowCreateModal(true);
                }}
                data-testid="kanban-bg-agent-add-btn"
                className="rounded-lg bg-amber-500 px-3 py-2 text-[12px] font-medium text-white transition-colors hover:bg-amber-600"
              >
                Add BG Agent
              </button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Workspace Agents", value: agents.length, tone: "text-violet-600 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/20" },
              { label: "Active Agents", value: activeAgents, tone: "text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20" },
              { label: "Queue Routes", value: groupedRoutes.length, tone: "text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20" },
              { label: "Pending Tasks", value: pendingTasks, tone: "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20" },
            ].map((item) => (
              <div key={item.label} className={`rounded-xl px-3 py-2 ${item.tone}`}>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-75">{item.label}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{item.value}</div>
              </div>
            ))}
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-300">
              {error}
            </div>
          )}

          {agents.length === 0 && groupedRoutes.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-center dark:border-[#2a3040] dark:bg-[#0d1018]">
                <div className="text-[13px] font-medium text-gray-700 dark:text-gray-200">No workspace background agents yet</div>
                <p className="mt-1 text-[12px] text-gray-500 dark:text-gray-400">
                  Add a dedicated BG agent for this workspace to keep Kanban automation visible at a glance.
                </p>
              </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[12px] font-semibold text-gray-700 dark:text-gray-300">Workspace background agents</div>
                    <div className="text-[11px] text-gray-400 dark:text-gray-500">
                      {activeAgents} active · {runningRoutes} hot routes
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {agentCards.map(({ agent, total, pending, running, completed, failed, latestTask }) => (
                      <article
                        key={agent.id}
                        data-testid="kanban-bg-agent-card"
                        className="rounded-2xl border border-gray-200/70 bg-gradient-to-br from-white via-white to-gray-50 px-4 py-3 dark:border-[#252838] dark:from-[#151822] dark:via-[#12141c] dark:to-[#0d1018]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="truncate text-[13px] font-semibold text-gray-900 dark:text-gray-100">{agent.name}</div>
                              <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] ${roleClass(agent.role)}`}>
                                {agent.role}
                              </span>
                            </div>
                            <div className="mt-1 truncate font-mono text-[10px] text-gray-400 dark:text-gray-500">{agent.id}</div>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${statusClass(agent.status)}`}>
                            {agent.status}
                          </span>
                        </div>

                        <div className="mt-3 grid grid-cols-4 gap-2">
                            {[
                              { label: "All", value: total },
                              { label: "Pending", value: pending },
                              { label: "Running", value: running },
                              { label: "Finished", value: completed + failed },
                            ].map((item) => (
                            <div key={item.label} className="rounded-xl bg-gray-50 px-2 py-1.5 text-center dark:bg-[#0b0e15]">
                              <div className="text-[9px] uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">{item.label}</div>
                              <div className="mt-1 text-[13px] font-semibold text-gray-800 dark:text-gray-100 tabular-nums">{item.value}</div>
                            </div>
                          ))}
                        </div>

                        <div className="mt-3 rounded-xl border border-dashed border-gray-200 px-3 py-2 text-[11px] text-gray-500 dark:border-[#2a3040] dark:text-gray-400">
                          {latestTask ? (
                            <>
                              <div className="font-medium text-gray-700 dark:text-gray-200">{latestTask.title}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span className="capitalize">{latestTask.status.toLowerCase()}</span>
                                <span>·</span>
                                <span>{formatRelativeTime(latestTask.createdAt)}</span>
                              </div>
                            </>
                          ) : (
                            <span>No background task has been routed to this workspace agent yet.</span>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200/70 bg-gray-50/80 px-4 py-3 dark:border-[#252838] dark:bg-[#0d1018]">
                  <div className="flex items-center justify-between">
                    <div className="text-[12px] font-semibold text-gray-700 dark:text-gray-300">Observed queue targets</div>
                    <div className="text-[11px] text-gray-400 dark:text-gray-500">{groupedRoutes.length} routes</div>
                  </div>
                  <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                    These are the agent ids currently used by background tasks in this workspace.
                  </p>

                  <div className="mt-3 space-y-2">
                    {groupedRoutes.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-gray-200 px-3 py-6 text-center text-[12px] text-gray-400 dark:border-[#2a3040] dark:text-gray-500">
                        No queue activity yet.
                      </div>
                    ) : (
                      groupedRoutes.map((route) => {
                        const linked = !unlinkedRoutes.some((item) => item.agentId === route.agentId);
                        return (
                          <div
                            key={route.agentId}
                            className="rounded-xl border border-gray-200/70 bg-white px-3 py-2 dark:border-[#2a3040] dark:bg-[#12141c]"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate font-mono text-[11px] text-gray-700 dark:text-gray-200">{route.agentId}</div>
                                <div className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                                  {route.latestTask ? `${route.latestTask.title} · ${formatRelativeTime(route.latestTask.createdAt)}` : "No recent task"}
                                </div>
                              </div>
                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${
                                linked
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                                  : "bg-gray-100 text-gray-600 dark:bg-[#20242f] dark:text-gray-300"
                              }`}>
                                {linked ? "linked" : "external"}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600 dark:bg-[#20242f] dark:text-gray-300">
                                {route.total} total
                              </span>
                              {route.pending > 0 && (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                                  {route.pending} pending
                                </span>
                              )}
                              {route.running > 0 && (
                                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
                                  {route.running} running
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowCreateModal(false)} aria-hidden="true" />
          <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Add background agent</h3>
                <p className="mt-1 text-[12px] text-gray-500 dark:text-gray-400">
                  Create a workspace-scoped agent so Kanban keeps the background automation topology visible.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-[#191c28] dark:hover:text-gray-300"
                aria-label="Close background agent modal"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-[12px] font-medium text-gray-600 dark:text-gray-400">Agent name</label>
                <input
                  data-testid="kanban-bg-agent-name-input"
                  type="text"
                  value={createForm.name}
                  onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="e.g. Review Bot"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-[#252838] dark:bg-[#0d1018] dark:text-gray-100 dark:placeholder:text-gray-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-gray-600 dark:text-gray-400">Role</label>
                  <select
                    value={createForm.role}
                    onChange={(event) => setCreateForm((current) => ({ ...current, role: event.target.value }))}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-800 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-[#252838] dark:bg-[#0d1018] dark:text-gray-100"
                  >
                    <option value="DEVELOPER">DEVELOPER</option>
                    <option value="CRAFTER">CRAFTER</option>
                    <option value="GATE">GATE</option>
                    <option value="ROUTA">ROUTA</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-gray-600 dark:text-gray-400">Model tier</label>
                  <select
                    value={createForm.modelTier}
                    onChange={(event) => setCreateForm((current) => ({ ...current, modelTier: event.target.value }))}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-800 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-[#252838] dark:bg-[#0d1018] dark:text-gray-100"
                  >
                    <option value="FAST">FAST</option>
                    <option value="BALANCED">BALANCED</option>
                    <option value="SMART">SMART</option>
                  </select>
                </div>
              </div>

              {createError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-300">
                  {createError}
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg px-3 py-2 text-[12px] font-medium text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-[#191c28]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreateAgent()}
                data-testid="kanban-bg-agent-submit-btn"
                disabled={creating || !createForm.name.trim()}
                className="rounded-lg bg-amber-500 px-3 py-2 text-[12px] font-medium text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? "Creating…" : "Create agent"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
