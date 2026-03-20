"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { useAcp } from "@/client/hooks/use-acp";
import { useCodebases, useWorkspaces } from "@/client/hooks/use-workspaces";
import { storePendingPrompt } from "@/client/utils/pending-prompt";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { formatRelativeTime } from "../ui-components";
import type { SessionInfo } from "../types";

const TEAM_LEAD_SPECIALIST_ID = "team-agent-lead";

interface SpecialistSummary {
  id: string;
  name: string;
  description?: string;
  role?: string;
  defaultProvider?: string;
  model?: string;
}

interface TeamRunSummary {
  session: SessionInfo;
  descendants: number;
  directDelegates: number;
}

const TEAM_MEMBER_DISPLAY_ORDER = [
  TEAM_LEAD_SPECIALIST_ID,
  "team-researcher",
  "team-frontend-dev",
  "team-backend-dev",
  "team-qa",
  "team-code-reviewer",
  "team-ux-designer",
  "team-operations",
  "team-general-engineer",
] as const;

function compareTeamSpecialists(a: SpecialistSummary, b: SpecialistSummary): number {
  const aIndex = TEAM_MEMBER_DISPLAY_ORDER.indexOf(a.id as typeof TEAM_MEMBER_DISPLAY_ORDER[number]);
  const bIndex = TEAM_MEMBER_DISPLAY_ORDER.indexOf(b.id as typeof TEAM_MEMBER_DISPLAY_ORDER[number]);
  const normalizedA = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
  const normalizedB = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
  if (normalizedA !== normalizedB) return normalizedA - normalizedB;
  return a.name.localeCompare(b.name);
}

function buildTeamRunName(requirement: string): string {
  const normalized = requirement.replace(/\s+/g, " ").trim();
  if (!normalized) return "Team run";
  return normalized.length > 56 ? `Team - ${normalized.slice(0, 53)}...` : `Team - ${normalized}`;
}

function getRoleTone(role?: string): string {
  switch (role?.toUpperCase()) {
    case "ROUTA":
      return "border-amber-200/80 bg-amber-50/80 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300";
    case "CRAFTER":
      return "border-cyan-200/80 bg-cyan-50/80 text-cyan-700 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300";
    case "GATE":
      return "border-emerald-200/80 bg-emerald-50/80 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300";
    case "DEVELOPER":
      return "border-violet-200/80 bg-violet-50/80 text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300";
    default:
      return "border-slate-200/80 bg-slate-50/80 text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300";
  }
}

export function TeamPageClient() {
  const params = useParams();
  const router = useRouter();
  const rawWorkspaceId = params.workspaceId as string;
  const workspaceId =
    rawWorkspaceId === "__placeholder__" && typeof window !== "undefined"
      ? (window.location.pathname.match(/^\/workspace\/([^/]+)/)?.[1] ?? rawWorkspaceId)
      : rawWorkspaceId;

  const acp = useAcp();
  const workspacesHook = useWorkspaces();
  const { codebases } = useCodebases(workspaceId);
  const {
    connected: acpConnected,
    loading: acpLoading,
    selectedProvider: acpSelectedProvider,
    providers: acpProviders,
    createSession,
    connect: connectAcp,
  } = acp;

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [specialists, setSpecialists] = useState<SpecialistSummary[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [requirement, setRequirement] = useState("");
  const [launching, setLaunching] = useState(false);
  const [selectedCodebaseId, setSelectedCodebaseId] = useState<string>("");
  const [selectedProvider, setSelectedProvider] = useState<string>("");

  useEffect(() => {
    if (!acpConnected && !acpLoading) {
      void connectAcp();
    }
  }, [acpConnected, acpLoading, connectAcp]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await desktopAwareFetch(`/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}&limit=100`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
      } catch {
        if (controller.signal.aborted) return;
        setSessions([]);
      }
    })();
    return () => controller.abort();
  }, [workspaceId, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await desktopAwareFetch("/api/specialists", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        setSpecialists(Array.isArray(data?.specialists) ? data.specialists : []);
      } catch {
        if (controller.signal.aborted) return;
        setSpecialists([]);
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (selectedCodebaseId || codebases.length === 0) return;
    const defaultCodebase = codebases.find((codebase) => codebase.isDefault) ?? codebases[0];
    if (defaultCodebase) {
      setSelectedCodebaseId(defaultCodebase.id);
    }
  }, [codebases, selectedCodebaseId]);

  const teamSpecialists = useMemo(
    () => specialists.filter((specialist) => specialist.id.startsWith("team-")).sort(compareTeamSpecialists),
    [specialists],
  );
  const leadSpecialist = useMemo(
    () => teamSpecialists.find((specialist) => specialist.id === TEAM_LEAD_SPECIALIST_ID),
    [teamSpecialists],
  );

  useEffect(() => {
    if (selectedProvider) return;
    const providerId = leadSpecialist?.defaultProvider ?? acpSelectedProvider;
    if (providerId) {
      setSelectedProvider(providerId);
    }
  }, [leadSpecialist?.defaultProvider, acpSelectedProvider, selectedProvider]);

  const providerOptions = useMemo(
    () => acpProviders.filter((provider) => provider.status !== "unavailable"),
    [acpProviders],
  );

  const selectedCodebase = useMemo(() => {
    if (codebases.length === 0) return null;
    return codebases.find((codebase) => codebase.id === selectedCodebaseId) ?? codebases[0];
  }, [codebases, selectedCodebaseId]);

  const teamRuns = useMemo<TeamRunSummary[]>(() => {
    const childMap = new Map<string, SessionInfo[]>();
    for (const session of sessions) {
      if (!session.parentSessionId) continue;
      const existing = childMap.get(session.parentSessionId) ?? [];
      existing.push(session);
      childMap.set(session.parentSessionId, existing);
    }

    const countDescendants = (sessionId: string): number => {
      const children = childMap.get(sessionId) ?? [];
      return children.reduce((total, child) => total + 1 + countDescendants(child.sessionId), 0);
    };

    return sessions
      .filter((session) => session.specialistId === TEAM_LEAD_SPECIALIST_ID && !session.parentSessionId)
      .map((session) => ({
        session,
        descendants: countDescendants(session.sessionId),
        directDelegates: (childMap.get(session.sessionId) ?? []).length,
      }));
  }, [sessions]);

  const workspace = workspacesHook.workspaces.find((item) => item.id === workspaceId);
  const activeRuns = teamRuns.filter((run) => run.session.acpStatus === "connecting" || run.session.acpStatus === "ready").length;
  const availableMembers = Math.max(teamSpecialists.length - (leadSpecialist ? 1 : 0), 0);

  const handleWorkspaceSelect = useCallback((nextWorkspaceId: string) => {
    router.push(`/workspace/${nextWorkspaceId}/team`);
  }, [router]);

  const handleWorkspaceCreate = useCallback(async (title: string) => {
    const workspaceResult = await workspacesHook.createWorkspace(title);
    if (workspaceResult) {
      router.push(`/workspace/${workspaceResult.id}/team`);
    }
  }, [router, workspacesHook]);

  const handleRefresh = useCallback(() => {
    setRefreshKey((current) => current + 1);
  }, []);

  const handleLaunch = useCallback(async () => {
    const prompt = requirement.trim();
    if (!prompt || launching) return;

    setLaunching(true);
    try {
      const effectiveProvider = selectedProvider || leadSpecialist?.defaultProvider || acpSelectedProvider;
      const result = await createSession(
        selectedCodebase?.repoPath,
        effectiveProvider,
        undefined,
        leadSpecialist?.role ?? "ROUTA",
        workspaceId,
        leadSpecialist?.model,
        `team-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        TEAM_LEAD_SPECIALIST_ID,
        undefined,
        undefined,
        undefined,
        selectedCodebase?.branch,
      );

      if (!result?.sessionId) {
        return;
      }

      await desktopAwareFetch(`/api/sessions/${encodeURIComponent(result.sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: buildTeamRunName(prompt) }),
      }).catch(() => {});

      storePendingPrompt(result.sessionId, prompt);
      setRequirement("");
      setRefreshKey((current) => current + 1);
      router.push(`/workspace/${workspaceId}/team/${result.sessionId}`);
    } finally {
      setLaunching(false);
    }
  }, [
    acpSelectedProvider,
    createSession,
    launching,
    leadSpecialist?.defaultProvider,
    leadSpecialist?.model,
    leadSpecialist?.role,
    requirement,
    router,
    selectedCodebase?.branch,
    selectedCodebase?.repoPath,
    selectedProvider,
    workspaceId,
  ]);

  if (workspacesHook.loading && workspaceId !== "default") {
    return (
      <div className="desktop-theme flex h-screen items-center justify-center bg-desktop-bg-primary">
        <div className="flex items-center gap-3 text-desktop-text-secondary">
          <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading workspace...
        </div>
      </div>
    );
  }

  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceTitle={workspace?.title ?? (workspaceId === "default" ? "Default Workspace" : workspaceId)}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspacesHook.workspaces}
          activeWorkspaceId={workspaceId}
          activeWorkspaceTitle={workspace?.title ?? (workspaceId === "default" ? "Default Workspace" : workspaceId)}
          onSelect={handleWorkspaceSelect}
          onCreate={handleWorkspaceCreate}
          loading={workspacesHook.loading}
          compact
        />
      )}
    >
      <div className="flex h-full flex-col overflow-hidden bg-desktop-bg-primary">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4">
            <section className="rounded-[26px] border border-desktop-border bg-desktop-bg-secondary p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-desktop-text-muted">
                    Team Runs
                  </div>
                  <h1 className="mt-2 text-2xl font-semibold text-desktop-text-primary">
                    Run a lead session and keep the list in the same surface.
                  </h1>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-semibold text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                    {teamRuns.length} runs
                  </span>
                  <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 font-semibold text-cyan-700 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300">
                    {activeRuns} active
                  </span>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
                    {availableMembers} members
                  </span>
                </div>
              </div>

              <div className="mt-4 rounded-[22px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.98))] p-3 dark:border-slate-800 dark:bg-slate-950/30">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-desktop-text-muted">
                      New Run
                    </div>
                    <h2 className="mt-2 text-xl font-semibold text-desktop-text-primary">Put the requirement here.</h2>
                  </div>
                  <button
                    type="button"
                    onClick={handleLaunch}
                    disabled={!requirement.trim() || launching || !acpConnected}
                    className="inline-flex items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#f59e0b,#f97316)] px-4 py-2 text-[12px] font-semibold text-white shadow-[0_14px_30px_-18px_rgba(249,115,22,0.7)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {launching ? "Launching..." : "Launch Team Lead"}
                  </button>
                </div>

                <textarea
                  value={requirement}
                  onChange={(event) => setRequirement(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void handleLaunch();
                    }
                  }}
                  rows={6}
                  placeholder="Describe the deliverable, constraints, verification expectations, and anything the lead should coordinate across frontend/backend/QA."
                  className="mt-4 min-h-[160px] w-full resize-y rounded-[18px] border border-slate-200 bg-white/90 px-4 py-3 text-sm leading-7 text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-100"
                />

                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.7fr)_auto]">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Codebase
                    </span>
                    <select
                      value={selectedCodebase?.id ?? ""}
                      onChange={(event) => setSelectedCodebaseId(event.target.value)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-cyan-400 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                    >
                      {codebases.length === 0 && <option value="">No codebase linked</option>}
                      {codebases.map((codebase) => (
                        <option key={codebase.id} value={codebase.id}>
                          {codebase.label ?? codebase.repoPath}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Provider
                    </span>
                    <select
                      value={selectedProvider}
                      onChange={(event) => setSelectedProvider(event.target.value)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-cyan-400 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                    >
                      {providerOptions.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex flex-wrap items-end gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-semibold text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                      {leadSpecialist?.name ?? "team-agent-lead"}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 dark:border-slate-700 dark:bg-slate-900/70">
                      {acpConnected ? "ACP connected" : "Connecting ACP"}
                    </span>
                  </div>
                </div>

                <div className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
                  Press `Ctrl/Cmd + Enter` to launch. New runs open directly into the Team run view.
                </div>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_320px]">
              <div className="rounded-[26px] border border-desktop-border bg-desktop-bg-secondary p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-desktop-text-muted">
                      Team Runs
                    </div>
                    <h2 className="mt-2 text-xl font-semibold text-desktop-text-primary">Top-level lead sessions only.</h2>
                    <p className="mt-1 text-sm text-desktop-text-secondary">
                      Open any run to inspect the task tree, coordination feed, and team panel.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRefresh}
                    className="rounded-xl border border-desktop-border px-3 py-2 text-[12px] font-medium text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary"
                  >
                    Refresh
                  </button>
                </div>

                {teamRuns.length === 0 ? (
                  <div className="mt-4 rounded-[22px] border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center dark:border-slate-700 dark:bg-slate-900/40">
                    <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      No Team runs yet.
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                      Launch a lead session above.
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 grid gap-3 xl:grid-cols-2">
                    {teamRuns.map((run) => (
                      <button
                        key={run.session.sessionId}
                        type="button"
                        onClick={() => router.push(`/workspace/${workspaceId}/team/${run.session.sessionId}`)}
                        className="group rounded-[22px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.98))] p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-[0_18px_45px_-30px_rgba(14,116,144,0.38)] dark:border-slate-800 dark:bg-slate-950/30 dark:hover:border-cyan-800"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-lg font-semibold text-slate-900 transition-colors group-hover:text-cyan-700 dark:text-slate-100 dark:group-hover:text-cyan-300">
                              {run.session.name ?? "Unnamed Team run"}
                            </div>
                            <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                              {formatRelativeTime(run.session.createdAt)}
                            </div>
                          </div>
                          <StatusPill status={run.session.acpStatus} />
                        </div>

                        <div className="mt-4 grid gap-2 sm:grid-cols-3">
                          <RunMetric label="Direct delegates" value={run.directDelegates} />
                          <RunMetric label="Total sub-sessions" value={run.descendants} />
                          <RunMetric label="Provider" value={run.session.provider ?? "auto"} />
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-semibold text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                            {run.session.specialistId ?? TEAM_LEAD_SPECIALIST_ID}
                          </span>
                          {run.session.branch && (
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 dark:border-slate-700 dark:bg-slate-900/70">
                              {run.session.branch}
                            </span>
                          )}
                          <span className="truncate rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 dark:border-slate-700 dark:bg-slate-900/70" title={run.session.cwd}>
                            {run.session.cwd}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-[26px] border border-desktop-border bg-desktop-bg-secondary p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-desktop-text-muted">
                      Team Roster
                    </div>
                    <h2 className="mt-2 text-lg font-semibold text-desktop-text-primary">Compact member list.</h2>
                  </div>
                  <div className="rounded-full border border-desktop-border bg-desktop-bg-active px-2.5 py-1 text-[11px] font-semibold text-desktop-text-secondary">
                    {teamSpecialists.length}
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {teamSpecialists.map((specialist) => (
                    <div
                      key={specialist.id}
                      className="rounded-2xl border border-slate-200/80 bg-white/90 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/30"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {specialist.name}
                          </div>
                          <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                            {specialist.description ?? specialist.id}
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${getRoleTone(specialist.role)}`}>
                          {specialist.role ?? "agent"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </DesktopAppShell>
  );
}

function StatusPill({ status }: { status?: SessionInfo["acpStatus"] }) {
  if (status === "error") {
    return <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">error</span>;
  }
  if (status === "connecting") {
    return <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">connecting</span>;
  }
  return <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">ready</span>;
}

function RunMetric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/80 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
        {value}
      </div>
    </div>
  );
}
