"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { useNotes } from "@/client/hooks/use-notes";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { formatRelativeTime } from "../../ui-components";
import type { SessionInfo } from "../../types";

interface SpecialistSummary {
  id: string;
  name: string;
  description?: string;
  role?: string;
}

interface TeamTaskNode {
  id: string;
  title: string;
  status: string;
  details?: string;
  children: TeamTaskNode[];
}

interface TeamActivityItem {
  id: string;
  type: "plan" | "assign" | "revision" | "finding" | "complete" | "blocked";
  actor: string;
  message: string;
  timestamp: string;
  details?: string;
}

interface DeliverableItem {
  id: string;
  name: string;
  type: string;
  status: "draft" | "review" | "approved";
}

const TEAM_LEAD_SPECIALIST_ID = "team-agent-lead";

function normalizeTaskStatus(status?: string): "not-started" | "in-progress" | "waiting-review" | "done" | "blocked" {
  const normalized = status?.toUpperCase();
  if (normalized === "COMPLETED" || normalized === "DONE") return "done";
  if (normalized === "IN_PROGRESS" || normalized === "RUNNING" || normalized === "CONFIRMED") return "in-progress";
  if (normalized === "REVIEW_REQUIRED" || normalized === "WAITING_REVIEW" || normalized === "NEEDS_REVIEW") return "waiting-review";
  if (normalized === "FAILED" || normalized === "BLOCKED" || normalized === "NEEDS_FIX") return "blocked";
  return "not-started";
}

function statusDotClass(status: "idle" | "working" | "blocked" | "reviewing"): string {
  switch (status) {
    case "working":
      return "bg-cyan-500";
    case "reviewing":
      return "bg-amber-500";
    case "blocked":
      return "bg-rose-500";
    default:
      return "bg-slate-400";
  }
}

function activityTone(type: TeamActivityItem["type"]): string {
  switch (type) {
    case "plan":
      return "bg-violet-100 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300";
    case "assign":
      return "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300";
    case "revision":
      return "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300";
    case "finding":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300";
    case "complete":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300";
    case "blocked":
      return "bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300";
  }
}

function getActorLabel(session: SessionInfo, specialistsById: Map<string, SpecialistSummary>): string {
  return specialistsById.get(session.specialistId ?? "")?.name ?? session.name ?? session.specialistId ?? session.role ?? "Agent";
}

export function TeamRunPageClient() {
  const params = useParams();
  const router = useRouter();
  const rawWorkspaceId = params.workspaceId as string;
  const rawSessionId = params.sessionId as string;
  const workspaceId =
    rawWorkspaceId === "__placeholder__" && typeof window !== "undefined"
      ? (window.location.pathname.match(/^\/workspace\/([^/]+)/)?.[1] ?? rawWorkspaceId)
      : rawWorkspaceId;
  const sessionId =
    rawSessionId === "__placeholder__" && typeof window !== "undefined"
      ? (window.location.pathname.match(/^\/workspace\/[^/]+\/team\/([^/]+)/)?.[1] ?? rawSessionId)
      : rawSessionId;

  const workspacesHook = useWorkspaces();
  const notesHook = useNotes(workspaceId, sessionId);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [workspaceSessions, setWorkspaceSessions] = useState<SessionInfo[]>([]);
  const [specialists, setSpecialists] = useState<SpecialistSummary[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const [sessionRes, sessionsRes, specialistsRes] = await Promise.all([
          desktopAwareFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { cache: "no-store", signal: controller.signal }),
          desktopAwareFetch(`/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}&limit=100`, { cache: "no-store", signal: controller.signal }),
          desktopAwareFetch("/api/specialists", { cache: "no-store", signal: controller.signal }),
        ]);
        const sessionData = await sessionRes.json().catch(() => ({}));
        const sessionsData = await sessionsRes.json().catch(() => ({}));
        const specialistsData = await specialistsRes.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        setSession((sessionData?.session ?? null) as SessionInfo | null);
        setWorkspaceSessions(Array.isArray(sessionsData?.sessions) ? sessionsData.sessions : []);
        setSpecialists(Array.isArray(specialistsData?.specialists) ? specialistsData.specialists : []);
      } catch {
        if (controller.signal.aborted) return;
        setSession(null);
        setWorkspaceSessions([]);
        setSpecialists([]);
      }
    })();
    return () => controller.abort();
  }, [sessionId, workspaceId, refreshKey]);

  const workspace = workspacesHook.workspaces.find((item) => item.id === workspaceId);
  const specialistsById = useMemo(
    () => new Map(specialists.map((specialist) => [specialist.id, specialist])),
    [specialists],
  );

  const descendantSessions = useMemo(() => {
    const childMap = new Map<string, SessionInfo[]>();
    for (const entry of workspaceSessions) {
      if (!entry.parentSessionId) continue;
      const existing = childMap.get(entry.parentSessionId) ?? [];
      existing.push(entry);
      childMap.set(entry.parentSessionId, existing);
    }

    const collect = (rootId: string): SessionInfo[] => {
      const children = childMap.get(rootId) ?? [];
      return children.flatMap((child) => [child, ...collect(child.sessionId)]);
    };

    return collect(sessionId);
  }, [sessionId, workspaceSessions]);

  const taskTree = useMemo<TeamTaskNode[]>(() => {
    const taskNotes = notesHook.notes.filter((note) => note.metadata.type === "task");
    const childrenByParent = new Map<string, typeof taskNotes>();
    const rootNotes: typeof taskNotes = [];

    for (const note of taskNotes) {
      const parentId = note.metadata.parentNoteId;
      if (!parentId) {
        rootNotes.push(note);
        continue;
      }
      const existing = childrenByParent.get(parentId) ?? [];
      existing.push(note);
      childrenByParent.set(parentId, existing);
    }

    const buildNode = (noteId: string): TeamTaskNode | null => {
      const note = taskNotes.find((candidate) => candidate.id === noteId);
      if (!note) return null;
      const children = (childrenByParent.get(note.id) ?? [])
        .map((child) => buildNode(child.id))
        .filter((child): child is TeamTaskNode => Boolean(child));
      return {
        id: note.id,
        title: note.title,
        status: note.metadata.taskStatus ?? "PENDING",
        details: note.content.trim() || undefined,
        children,
      };
    };

    return rootNotes
      .map((note) => buildNode(note.id))
      .filter((node): node is TeamTaskNode => Boolean(node));
  }, [notesHook.notes]);

  const activityItems = useMemo<TeamActivityItem[]>(() => {
    const items: Array<TeamActivityItem & { sortKey: number }> = [];
    const sessionStart = session?.createdAt ? new Date(session.createdAt).getTime() : 0;

    if (session) {
      items.push({
        id: `${session.sessionId}-start`,
        type: "plan",
        actor: specialistsById.get(TEAM_LEAD_SPECIALIST_ID)?.name ?? "Team Lead",
        message: "Started the coordination run",
        timestamp: formatRelativeTime(session.createdAt),
        details: session.name ?? session.specialistId ?? TEAM_LEAD_SPECIALIST_ID,
        sortKey: sessionStart,
      });
    }

    for (const note of notesHook.notes) {
      const noteTime = new Date(note.updatedAt).getTime();
      if (note.metadata.type === "spec") {
        items.push({
          id: `${note.id}-spec`,
          type: "plan",
          actor: specialistsById.get(TEAM_LEAD_SPECIALIST_ID)?.name ?? "Team Lead",
          message: `Updated spec note '${note.title}'`,
          timestamp: formatRelativeTime(note.updatedAt),
          details: note.content.trim().slice(0, 180) || undefined,
          sortKey: noteTime,
        });
        continue;
      }

      if (note.metadata.type === "task") {
        const normalizedStatus = normalizeTaskStatus(note.metadata.taskStatus);
        items.push({
          id: `${note.id}-task`,
          type:
            normalizedStatus === "done"
              ? "complete"
              : normalizedStatus === "blocked"
                ? "blocked"
                : normalizedStatus === "waiting-review"
                  ? "revision"
                  : "finding",
          actor: note.metadata.childSessionId
            ? getActorLabel(
                descendantSessions.find((entry) => entry.sessionId === note.metadata.childSessionId) ?? session ?? {
                  sessionId: "fallback",
                  workspaceId,
                  cwd: "",
                  createdAt: note.updatedAt,
                },
                specialistsById,
              )
            : specialistsById.get(TEAM_LEAD_SPECIALIST_ID)?.name ?? "Team Lead",
          message: `${note.title} is ${normalizedStatus.replace(/-/g, " ")}`,
          timestamp: formatRelativeTime(note.updatedAt),
          details: note.content.trim().slice(0, 180) || undefined,
          sortKey: noteTime,
        });
      }
    }

    for (const child of descendantSessions) {
      const childTime = new Date(child.createdAt).getTime();
      items.push({
        id: `${child.sessionId}-assign`,
        type: child.acpStatus === "error" ? "blocked" : "assign",
        actor: specialistsById.get(TEAM_LEAD_SPECIALIST_ID)?.name ?? "Team Lead",
        message: `Assigned ${getActorLabel(child, specialistsById)}`,
        timestamp: formatRelativeTime(child.createdAt),
        details: child.specialistId ?? child.role ?? child.provider ?? undefined,
        sortKey: childTime,
      });
    }

    return items
      .sort((a, b) => b.sortKey - a.sortKey)
      .slice(0, 18)
      .map(({ sortKey: _sortKey, ...item }) => item);
  }, [descendantSessions, notesHook.notes, session, specialistsById, workspaceId]);

  const teamMembers = useMemo(() => {
    const teamSpecialists = specialists.filter((specialist) => specialist.id.startsWith("team-"));
    return teamSpecialists.map((specialist) => {
      const relatedSessions = descendantSessions
        .filter((entry) => entry.specialistId === specialist.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const latest = relatedSessions[0];
      let status: "idle" | "working" | "blocked" | "reviewing" = "idle";
      if (latest?.acpStatus === "error") {
        status = "blocked";
      } else if (latest?.acpStatus === "connecting" || latest?.acpStatus === "ready") {
        status = "working";
      } else if (relatedSessions.length > 0) {
        status = "reviewing";
      }

      if (specialist.id === TEAM_LEAD_SPECIALIST_ID && session) {
        status = session.acpStatus === "error" ? "blocked" : "working";
      }

      return {
        specialist,
        status,
        latest,
      };
    });
  }, [descendantSessions, session, specialists]);

  const deliverables = useMemo<DeliverableItem[]>(() => {
    return notesHook.notes
      .filter((note) => note.metadata.type === "spec" || note.metadata.type === "task" || note.metadata.type === "general")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 10)
      .map((note) => ({
        id: note.id,
        name: note.title,
        type: note.metadata.type,
        status:
          note.metadata.type === "spec"
            ? "approved"
            : normalizeTaskStatus(note.metadata.taskStatus) === "done"
              ? "approved"
              : normalizeTaskStatus(note.metadata.taskStatus) === "waiting-review"
                ? "review"
                : "draft",
      }));
  }, [notesHook.notes]);

  if (!session) {
    return (
      <div className="desktop-theme flex h-screen items-center justify-center bg-desktop-bg-primary">
        <div className="text-sm text-desktop-text-secondary">Loading Team run...</div>
      </div>
    );
  }

  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceTitle={workspace?.title ?? workspaceId}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspacesHook.workspaces}
          activeWorkspaceId={workspaceId}
          activeWorkspaceTitle={workspace?.title ?? workspaceId}
          onSelect={(nextWorkspaceId) => router.push(`/workspace/${nextWorkspaceId}/team`)}
          onCreate={async (title) => {
            const nextWorkspace = await workspacesHook.createWorkspace(title);
            if (nextWorkspace) {
              router.push(`/workspace/${nextWorkspace.id}/team`);
            }
          }}
          loading={workspacesHook.loading}
          compact
        />
      )}
    >
      <div className="flex h-full flex-col overflow-hidden bg-desktop-bg-primary">
        <header className="shrink-0 border-b border-desktop-border bg-desktop-bg-secondary/95">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <Link
                  href={`/workspace/${workspaceId}/team`}
                  className="inline-flex items-center gap-2 rounded-lg border border-desktop-border px-2.5 py-1.5 text-[12px] font-medium text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                  </svg>
                  Team
                </Link>
                <div className="h-4 w-px bg-desktop-border" />
                <div className="min-w-0">
                  <h1 className="truncate text-sm font-semibold text-desktop-text-primary">
                    {session.name ?? "Team run"}
                  </h1>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-desktop-text-secondary">
                    <span>{formatRelativeTime(session.createdAt)}</span>
                    <span className="opacity-40">/</span>
                    <span>{session.provider ?? "auto"}</span>
                    <span className="opacity-40">/</span>
                    <span>{session.specialistId ?? TEAM_LEAD_SPECIALIST_ID}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRefreshKey((current) => current + 1)}
                className="rounded-lg border border-desktop-border px-3 py-1.5 text-[12px] font-medium text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary"
              >
                Refresh
              </button>
              <Link
                href={`/workspace/${workspaceId}/sessions/${sessionId}`}
                className="rounded-lg bg-desktop-accent px-3 py-1.5 text-[12px] font-medium text-desktop-accent-text transition-colors hover:opacity-90"
              >
                Open raw session
              </Link>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
          <section className="min-h-0 overflow-hidden border-r border-desktop-border bg-desktop-bg-secondary">
            <div className="border-b border-desktop-border px-4 py-3">
              <h2 className="text-sm font-semibold text-desktop-text-primary">Plan / Task Tree</h2>
              <p className="mt-1 text-xs text-desktop-text-secondary">Task notes and execution state for this Team run.</p>
            </div>
            <div className="h-[calc(100%-57px)] overflow-y-auto px-2 py-2">
              {taskTree.length === 0 ? (
                <EmptyPanel message="No task notes yet." />
              ) : (
                taskTree.map((node) => <TaskTreeNode key={node.id} node={node} />)
              )}
            </div>
          </section>

          <section className="min-h-0 overflow-hidden bg-desktop-bg-primary">
            <div className="border-b border-desktop-border px-4 py-3">
              <h2 className="text-sm font-semibold text-desktop-text-primary">Coordination Feed</h2>
              <p className="mt-1 text-xs text-desktop-text-secondary">Session launches, spec updates, and task progression.</p>
            </div>
            <div className="h-[calc(100%-57px)] overflow-y-auto px-4 py-4">
              <div className="space-y-4">
                {activityItems.length === 0 ? (
                  <EmptyPanel message="No coordination events yet." />
                ) : (
                  activityItems.map((item, index) => (
                    <div key={item.id} className="relative">
                      {index < activityItems.length - 1 && (
                        <div className="absolute left-[11px] top-8 bottom-0 w-px bg-desktop-border" />
                      )}
                      <div className="flex gap-3">
                        <div className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${activityTone(item.type)}`}>
                          {item.type[0].toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <div className="min-w-0">
                              <span className="text-sm font-medium text-desktop-text-primary">{item.actor}</span>
                              <span className="ml-2 text-sm text-desktop-text-secondary">{item.message}</span>
                            </div>
                            <span className="shrink-0 text-xs text-desktop-text-muted">{item.timestamp}</span>
                          </div>
                          {item.details && (
                            <div className="mt-2 rounded-xl border border-desktop-border bg-desktop-bg-secondary px-3 py-2 text-sm leading-6 text-desktop-text-secondary">
                              {item.details}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          <section className="min-h-0 overflow-hidden border-l border-desktop-border bg-desktop-bg-secondary">
            <div className="border-b border-desktop-border px-4 py-3">
              <h2 className="text-sm font-semibold text-desktop-text-primary">Team Panel</h2>
            </div>
            <div className="h-[calc(100%-57px)] overflow-y-auto p-4">
              <div className="space-y-5">
                <PanelCard title="Team Members">
                  <div className="space-y-2">
                    {teamMembers.map(({ specialist, status, latest }) => (
                      <div key={specialist.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-desktop-bg-active/80">
                        <div className="relative">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-desktop-bg-active text-xs font-semibold text-desktop-text-primary">
                            {specialist.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-desktop-bg-secondary ${statusDotClass(status)}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-desktop-text-primary">{specialist.name}</div>
                          <div className="truncate text-xs text-desktop-text-secondary">{specialist.id}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[11px] font-medium capitalize text-desktop-text-secondary">{status}</div>
                          {latest?.createdAt && (
                            <div className="text-[10px] text-desktop-text-muted">{formatRelativeTime(latest.createdAt)}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </PanelCard>

                <PanelCard title="Deliverables">
                  <div className="space-y-2">
                    {deliverables.length === 0 ? (
                      <EmptyPanel message="No notes or deliverables yet." />
                    ) : (
                      deliverables.map((item) => (
                        <div key={item.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-desktop-bg-active/80">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-desktop-bg-active text-xs font-semibold text-desktop-text-primary">
                            {item.type.slice(0, 1).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-desktop-text-primary">{item.name}</div>
                            <div className="text-xs capitalize text-desktop-text-secondary">{item.type}</div>
                          </div>
                          <DeliverableBadge status={item.status} />
                        </div>
                      ))
                    )}
                  </div>
                </PanelCard>

                <PanelCard title="Controls">
                  <div className="space-y-2">
                    <Link
                      href={`/workspace/${workspaceId}/sessions/${sessionId}`}
                      className="flex items-center gap-2 rounded-xl border border-desktop-border px-3 py-2 text-sm text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75l6 6 13.5-13.5" />
                      </svg>
                      Continue in raw session
                    </Link>
                    <button
                      type="button"
                      onClick={() => setRefreshKey((current) => current + 1)}
                      className="flex w-full items-center gap-2 rounded-xl border border-desktop-border px-3 py-2 text-sm text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992V4.356m-1.636 9.744a9 9 0 11-2.87-5.814l4.992 4.992" />
                      </svg>
                      Refresh Team view
                    </button>
                  </div>
                </PanelCard>
              </div>
            </div>
          </section>
        </div>
      </div>
    </DesktopAppShell>
  );
}

function TaskTreeNode({
  node,
  level = 0,
}: {
  node: TeamTaskNode;
  level?: number;
}) {
  const normalizedStatus = normalizeTaskStatus(node.status);
  return (
    <div>
      <div
        className="rounded-xl px-3 py-2 transition-colors hover:bg-desktop-bg-active/80"
        style={{ marginLeft: level * 16 }}
      >
        <div className="flex items-start gap-2">
          <TaskStatusGlyph status={normalizedStatus} />
          <div className="min-w-0 flex-1">
            <div className={`text-sm ${normalizedStatus === "done" ? "text-desktop-text-muted line-through" : "text-desktop-text-primary"}`}>
              {node.title}
            </div>
            {node.details && (
              <div className="mt-1 line-clamp-2 text-xs leading-5 text-desktop-text-secondary">
                {node.details}
              </div>
            )}
          </div>
        </div>
      </div>
      {node.children.map((child) => (
        <TaskTreeNode key={child.id} node={child} level={level + 1} />
      ))}
    </div>
  );
}

function TaskStatusGlyph({
  status,
}: {
  status: "not-started" | "in-progress" | "waiting-review" | "done" | "blocked";
}) {
  if (status === "done") {
    return (
      <div className="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>
    );
  }
  if (status === "in-progress") {
    return <div className="mt-0.5 h-4 w-4 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin" />;
  }
  if (status === "waiting-review") {
    return (
      <div className="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12S5.25 6.75 12 6.75 21.75 12 21.75 12 18.75 17.25 12 17.25 2.25 12 2.25 12z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
        </svg>
      </div>
    );
  }
  if (status === "blocked") {
    return (
      <div className="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 4.5h.008v.008H12v-.008z" />
        </svg>
      </div>
    );
  }
  return <div className="mt-0.5 h-4 w-4 rounded-full border-2 border-slate-400" />;
}

function PanelCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-desktop-border bg-desktop-bg-primary">
      <div className="border-b border-desktop-border px-4 py-3 text-sm font-semibold text-desktop-text-primary">
        {title}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function DeliverableBadge({
  status,
}: {
  status: DeliverableItem["status"];
}) {
  const tone =
    status === "approved"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
      : status === "review"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
        : "bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${tone}`}>
      {status}
    </span>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-desktop-border px-4 py-6 text-center text-sm text-desktop-text-secondary">
      {message}
    </div>
  );
}
