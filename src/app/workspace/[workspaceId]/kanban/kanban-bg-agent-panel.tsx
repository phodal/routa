"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/i18n";
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

interface GroupedBgRoute {
  routeKey: string;
  routeLabel: string;
  agentId: string;
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  sourceCounts: Record<string, number>;
  scheduleTriggerIds: string[];
  latestTask: BackgroundTaskInfo | null;
}

interface GroupedWorkspaceAgent {
  key: string;
  name: string;
  role: string;
  status: string;
  count: number;
  ids: string[];
}

function normalizeAgentKey(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeAgentBaseName(value: string): string {
  let normalized = normalizeAgentKey(value);
  normalized = normalized.replace(
    /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "",
  );

  const suffixPattern = /(?:[-_][0-9a-f]{6,})+$/i;
  if (suffixPattern.test(normalized)) {
    normalized = normalized.replace(suffixPattern, "");
  }

  return normalized.replace(/[-_]+$/g, "").trim().toLowerCase();
}

function getAgentGroupKey(name: string, role: string): string {
  return `${normalizeAgentBaseName(name)}:${normalizeAgentKey(role)}`;
}

function getTaskRouteGroup(task: BackgroundTaskInfo): Pick<GroupedBgRoute, "routeKey" | "routeLabel" | "agentId" | "sourceCounts" | "scheduleTriggerIds"> {
  const source = task.triggerSource?.trim().toLowerCase() || "manual";
  const agentId = task.agentId.trim();
  const triggeredBy = task.triggeredBy?.trim();

  return {
    routeKey: `agent:${agentId}`,
    routeLabel: agentId,
    agentId,
    sourceCounts: { [source]: 1 },
    scheduleTriggerIds: source === "schedule" && triggeredBy ? [triggeredBy] : [],
  };
}

function statusClass(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300",
    PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
    COMPLETED: "bg-slate-100 text-slate-600 dark:bg-[#20242f] dark:text-slate-300",
    ERROR: "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-300",
    CANCELLED: "bg-slate-100 text-slate-500 dark:bg-[#20242f] dark:text-slate-400",
  };
  return map[status.toUpperCase()] ?? map.PENDING;
}

function roleClass(role: string): string {
  const map: Record<string, string> = {
    ROUTA: "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300",
    DEVELOPER: "bg-slate-100 text-slate-700 dark:bg-slate-900/20 dark:text-slate-300",
    CRAFTER: "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
    GATE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300",
  };
  return map[role.toUpperCase()] ?? map.DEVELOPER;
}

function aggregateAgentStatus(statuses: string[]): string {
  const normalized = statuses.map((status) => status.toUpperCase());
  if (normalized.includes("ACTIVE")) return "ACTIVE";
  if (normalized.includes("ERROR")) return "ERROR";
  if (normalized.includes("PENDING")) return "PENDING";
  if (normalized.includes("CANCELLED")) return "CANCELLED";
  if (normalized.includes("COMPLETED")) return "COMPLETED";
  return "PENDING";
}

export function KanbanBgAgentPanel({ workspaceId }: KanbanBgAgentPanelProps) {
  const { t } = useTranslation();
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
        agentsResponse.json().catch(() => null),
        bgTasksResponse.json().catch(() => null),
      ]);

      if (signal?.aborted) return;

      setAgents(Array.isArray(agentsData) ? agentsData : Array.isArray(agentsData?.agents) ? agentsData.agents : []);
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
    const groups = new Map<string, GroupedBgRoute>();

    for (const task of bgTasks) {
      const {
        routeKey,
        routeLabel,
        agentId,
        sourceCounts,
        scheduleTriggerIds,
      } = getTaskRouteGroup(task);
      const current = groups.get(routeKey) ?? {
        routeKey,
        routeLabel,
        agentId,
        total: 0,
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0,
        sourceCounts,
        scheduleTriggerIds,
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
      for (const [source, count] of Object.entries(sourceCounts)) {
        current.sourceCounts[source] = (current.sourceCounts[source] ?? 0) + count;
      }
      for (const triggerId of scheduleTriggerIds) {
        if (!current.scheduleTriggerIds.includes(triggerId)) {
          current.scheduleTriggerIds.push(triggerId);
        }
      }

      groups.set(routeKey, current);
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

  const groupedAgents = useMemo(() => {
    const grouped = new Map<string, GroupedWorkspaceAgent & { statusStack: string[] }>();

    for (const agent of agents) {
      const groupKey = getAgentGroupKey(agent.name, agent.role);
      const displayName = normalizeAgentBaseName(agent.name);
      const current = grouped.get(groupKey) ?? {
        key: groupKey,
        name: displayName,
        role: agent.role,
        status: agent.status,
        count: 0,
        ids: [],
        statusStack: [],
      };

      current.count += 1;
      current.ids.push(agent.id);
      current.statusStack.push(agent.status);
      current.status = aggregateAgentStatus(current.statusStack);
      grouped.set(groupKey, current);
    }

    return Array.from(grouped.values());
  }, [agents]);

  const agentCards = useMemo(() => {
    return groupedAgents.map((agent) => {
      const matchedRoutes = groupedRoutes.filter((route) =>
        agent.ids.some((id) => normalizeAgentKey(route.agentId) === normalizeAgentKey(id)),
      );

      const totals = matchedRoutes.reduce((acc, route) => {
        acc.total += route.total;
        acc.pending += route.pending;
        acc.running += route.running;
        acc.completed += route.completed;
        acc.failed += route.failed;
        if (!route.latestTask) return acc;
        if (!acc.latestTask || new Date(route.latestTask.createdAt).getTime() > new Date(acc.latestTask.createdAt).getTime()) {
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
  }, [groupedRoutes, groupedAgents]);

  const unlinkedRoutes = useMemo(() => {
    return groupedRoutes.filter((route) => !linkedRouteKeys.has(normalizeAgentKey(route.agentId)));
  }, [groupedRoutes, linkedRouteKeys]);

  const activeAgents = groupedAgents.filter((agent) => agent.status === "ACTIVE").length;
  const runningRoutes = groupedRoutes.filter((route) => route.running > 0).length;
  const pendingTasks = bgTasks.filter((task) => task.status === "PENDING").length;

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
        className="shrink-0 rounded-2xl border border-slate-200/70 bg-white px-4 py-4 dark:border-[#1c1f2e] dark:bg-[#12141c]"
        data-testid="kanban-bg-agent-panel"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                  {t.common.workspace}
                </span>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.kanbanBgAgent.backgroundAgents}</h2>
              </div>
              <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
                {t.kanbanBgAgent.bgAgentDesc}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void fetchPanelData()}
                className="rounded-lg border border-slate-200 px-3 py-2 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-[#191c28]"
              >
                {loading ? t.common.loading : t.common.refresh}
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
                {t.kanbanBgAgent.addBgAgent}
              </button>
            </div>
          </div>

          <div data-testid="kanban-bg-agent-content" className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: t.kanbanBgAgent.workspaceAgents, value: groupedAgents.length, tone: "text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20" },
                { label: t.kanbanBgAgent.activeAgents, value: activeAgents, tone: "text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20" },
                { label: t.kanbanBgAgent.queueRoutes, value: groupedRoutes.length, tone: "text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20" },
                { label: t.kanbanBgAgent.pendingTasks, value: pendingTasks, tone: "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20" },
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
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center dark:border-[#2a3040] dark:bg-[#0d1018]">
                <div className="text-[13px] font-medium text-slate-700 dark:text-slate-200">{t.kanbanBgAgent.noAgentsYet}</div>
                <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
                  {t.kanbanBgAgent.noAgentsHint}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 px-4 py-3 dark:border-[#252838] dark:bg-[#0d1018]">
                    <div className="flex items-center justify-between">
                      <div className="text-[12px] font-semibold text-slate-700 dark:text-slate-300">{t.kanbanBgAgent.observedTargets}</div>
                      <div className="text-[11px] text-slate-400 dark:text-slate-500">{groupedRoutes.length} {t.kanbanBgAgent.routesCount}</div>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      {t.kanbanBgAgent.observedTargetsDesc}
                    </p>

                    <div className="mt-3 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                      {groupedRoutes.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-[12px] text-slate-400 dark:border-[#2a3040] dark:text-slate-500">
                          {t.kanbanBgAgent.noQueueActivity}
                        </div>
                      ) : (
                        groupedRoutes.map((route) => {
                          const linked = !unlinkedRoutes.some((item) => item.agentId === route.agentId);
                          return (
                            <article
                              key={route.routeKey}
                              className="rounded-2xl border border-slate-200/70 bg-gradient-to-br from-white via-white to-slate-50 px-4 py-3 dark:border-[#252838] dark:from-[#151822] dark:via-[#12141c] dark:to-[#0d1018]"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate font-mono text-[11px] text-slate-700 dark:text-slate-200">
                                    {route.routeLabel}
                                  </div>
                                  {route.scheduleTriggerIds.length > 0 && (
                                    <div className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                                      {t.kanbanBgAgent.scheduleTriggers}: {route.scheduleTriggerIds.length}
                                    </div>
                                  )}
                                </div>
                                <span
                                  className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${linked
                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                                    : "bg-slate-100 text-slate-600 dark:bg-[#20242f] dark:text-slate-300"
                                    }`}
                                >
                                  {linked ? t.kanbanBgAgent.linked : t.kanbanBgAgent.external}
                                </span>
                              </div>
                              <div className="mt-3 grid grid-cols-3 gap-2">
                                {[
                                  { label: t.kanbanBgAgent.all, value: route.total },
                                  { label: t.kanbanBgAgent.pending, value: route.pending },
                                  { label: t.kanbanBgAgent.running, value: route.running },
                                ].map((item) => (
                                  <div key={item.label} className="rounded-xl bg-slate-50 px-2 py-1.5 text-center dark:bg-[#0b0e15]">
                                    <div className="text-[9px] uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">{item.label}</div>
                                    <div className="mt-1 text-[13px] font-semibold text-slate-800 dark:text-slate-100 tabular-nums">{item.value}</div>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-3 rounded-xl border border-dashed border-slate-200 px-3 py-2 text-[11px] text-slate-500 dark:border-[#2a3040] dark:text-slate-400">
                                <span className="font-medium text-slate-700 dark:text-slate-200">{t.kanbanBgAgent.latestTask}</span>
                                <div className="mt-1">
                                  {route.latestTask ? `${route.latestTask.title} · ${formatRelativeTime(route.latestTask.createdAt)}` : t.kanbanBgAgent.noRecentTask}
                                </div>
                              </div>
                            </article>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[12px] font-semibold text-slate-700 dark:text-slate-300">{t.kanbanBgAgent.workspaceBgAgents}</div>
                      <div className="text-[11px] text-slate-400 dark:text-slate-500">
                        {activeAgents} {t.kanbanBgAgent.activeHotRoutes.replace('{hotRoutes}', String(runningRoutes))}
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                      {agentCards.map(({ agent, total, pending, running, completed, failed, latestTask }) => {
                        const displayId = agent.ids[0] ?? "";
                        const extra = Math.max(agent.count - 1, 0);
                        return (
                          <article
                            key={agent.key}
                            data-testid="kanban-bg-agent-card"
                            className="rounded-2xl border border-slate-200/70 bg-gradient-to-br from-white via-white to-slate-50 px-4 py-3 dark:border-[#252838] dark:from-[#151822] dark:via-[#12141c] dark:to-[#0d1018]"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">{agent.name}</div>
                                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] ${roleClass(agent.role)}`}>
                                    {agent.role}
                                  </span>
                                </div>
                                <div className="mt-1 truncate font-mono text-[10px] text-slate-400 dark:text-slate-500">
                                  {displayId}
                                  {extra > 0 && ` +${extra} more`}
                                </div>
                              </div>
                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${statusClass(agent.status)}`}>
                                {agent.status}
                              </span>
                            </div>

                            <div className="mt-3 grid grid-cols-4 gap-2">
                              {[
                                { label: t.kanbanBgAgent.all, value: total },
                                { label: t.kanbanBgAgent.pending, value: pending },
                                { label: t.kanbanBgAgent.running, value: running },
                                { label: t.kanbanBgAgent.finished, value: completed + failed },
                              ].map((item) => (
                                <div key={item.label} className="rounded-xl bg-slate-50 px-2 py-1.5 text-center dark:bg-[#0b0e15]">
                                  <div className="text-[9px] uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">{item.label}</div>
                                  <div className="mt-1 text-[13px] font-semibold text-slate-800 dark:text-slate-100 tabular-nums">{item.value}</div>
                                </div>
                              ))}
                            </div>

                            <div className="mt-3 rounded-xl border border-dashed border-slate-200 px-3 py-2 text-[11px] text-slate-500 dark:border-[#2a3040] dark:text-slate-400">
                              {latestTask ? (
                                <>
                                  <div className="font-medium text-slate-700 dark:text-slate-200">{latestTask.title}</div>
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                    <span className="capitalize">{latestTask.status.toLowerCase()}</span>
                                    <span>·</span>
                                    <span>{formatRelativeTime(latestTask.createdAt)}</span>
                                  </div>
                                </>
                              ) : (
                                <span>{t.kanbanBgAgent.noTaskRouted}</span>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowCreateModal(false)} aria-hidden="true" />
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t.kanbanBgAgent.addBgAgentTitle}</h3>
                <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
                  {t.kanbanBgAgent.addBgAgentDesc}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-[#191c28] dark:hover:text-slate-300"
                aria-label="Close background agent modal"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-[12px] font-medium text-slate-600 dark:text-slate-400">{t.kanbanBgAgent.agentName}</label>
                <input
                  data-testid="kanban-bg-agent-name-input"
                  type="text"
                  value={createForm.name}
                  onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder={t.kanbanBgAgent.agentNamePlaceholder}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-[#252838] dark:bg-[#0d1018] dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-slate-600 dark:text-slate-400">{t.kanbanBgAgent.role}</label>
                  <select
                    value={createForm.role}
                    onChange={(event) => setCreateForm((current) => ({ ...current, role: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-[#252838] dark:bg-[#0d1018] dark:text-slate-100"
                  >
                    <option value="DEVELOPER">DEVELOPER</option>
                    <option value="CRAFTER">CRAFTER</option>
                    <option value="GATE">GATE</option>
                    <option value="ROUTA">ROUTA</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-slate-600 dark:text-slate-400">{t.kanbanBgAgent.modelTier}</label>
                  <select
                    value={createForm.modelTier}
                    onChange={(event) => setCreateForm((current) => ({ ...current, modelTier: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-[#252838] dark:bg-[#0d1018] dark:text-slate-100"
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
                className="rounded-lg px-3 py-2 text-[12px] font-medium text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-[#191c28]"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={() => void handleCreateAgent()}
                disabled={creating}
                data-testid="kanban-bg-agent-submit-btn"
                className="rounded-lg bg-amber-500 px-3 py-2 text-[12px] font-medium text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creating ? t.kanbanBgAgent.creating : t.kanbanBgAgent.createAgent}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
