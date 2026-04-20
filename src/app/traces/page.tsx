"use client";

/**
 * Trace Page - /traces
 *
 * Full-page view for browsing and analyzing Agent Trace records.
 * Sessions are cross-referenced with /api/sessions to show names.
 *
 * Two view modes:
 * - Chat (original TracePanel)
 * - Trace (EventBridge semantic blocks)
 */

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "@/i18n";
import { TracePanel } from "@/client/components/trace-panel";
import { EventBridgeTracePanel } from "@/client/components/event-bridge-trace-panel";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { TracesPageHeader } from "@/client/components/traces-page-header";
import { TracesViewTabs, type TraceViewTab } from "@/client/components/traces-view-tabs";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import type { TraceRecord } from "@/core/trace";
import { FileText } from "lucide-react";
import { desktopAwareFetch } from "@/client/utils/diagnostics";


interface Session {
  sessionId: string;
  workspaceId?: string;
  name?: string;
  provider?: string;
  role?: string;
  parentSessionId?: string;
  count: number;
  firstTimestamp: string;
  lastTimestamp: string;
}

function resolveTraceViewTab(
  value: string | null | undefined,
): TraceViewTab {
  if (value === "trace" || value === "event-bridge") {
    return "event-bridge";
  }
  return "chat";
}

function isTracesSnapshotSelection(value: string | null | undefined): boolean {
  return value === "none" || value === "__none__";
}

function TracePageContent() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { workspaces, loading: workspacesLoading, createWorkspace } = useWorkspaces();

  const [activeWorkspaceId, setActiveWorkspaceId] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [activeTab, setActiveTab] = useState<TraceViewTab>(() => resolveTraceViewTab(searchParams.get("view")));
  const [sessionTraces, setSessionTraces] = useState<TraceRecord[]>([]);
  const [tracesLoading, setTracesLoading] = useState(false);
  const [sessionTracesLoaded, setSessionTracesLoaded] = useState(false);
  const selectedSessionIdRef = useRef<string | null>(null);
  const fetchSessionsRequestIdRef = useRef(0);

  const selectedSession = sessions.find((session) => session.sessionId === selectedSessionId) ?? null;
  const resolvedWorkspaceId = activeWorkspaceId || selectedSession?.workspaceId || null;
  const activeWorkspace = workspaces.find((workspace) => workspace.id === resolvedWorkspaceId) ?? null;

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    const workspaceIdFromUrl = searchParams.get("workspaceId");
    if ((workspaceIdFromUrl ?? "") !== activeWorkspaceId) {
      setActiveWorkspaceId(workspaceIdFromUrl ?? "");
    }
  }, [activeWorkspaceId, searchParams]);

  useEffect(() => {
    const viewFromUrl = resolveTraceViewTab(searchParams.get("view"));
    if (viewFromUrl !== activeTab) {
      setActiveTab(viewFromUrl);
    }
  }, [activeTab, searchParams]);

  const handleWorkspaceSelect = useCallback((workspaceId: string) => {
    setActiveWorkspaceId(workspaceId);
    const params = new URLSearchParams(searchParams.toString());
    params.set("workspaceId", workspaceId);
    router.push(`/traces?${params.toString()}`);
  }, [router, searchParams]);

  const handleWorkspaceCreate = useCallback(async (title: string) => {
    const workspace = await createWorkspace(title);
    if (workspace?.id) {
      setActiveWorkspaceId(workspace.id);
      const params = new URLSearchParams(searchParams.toString());
      params.set("workspaceId", workspace.id);
      router.push(`/traces?${params.toString()}`);
    }
  }, [createWorkspace, router, searchParams]);

  const handleTabChange = useCallback((tab: TraceViewTab) => {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "event-bridge") {
      params.set("view", "trace");
    } else {
      params.delete("view");
    }
    const next = params.toString();
    router.replace(next ? `/traces?${next}` : "/traces");
  }, [router, searchParams]);

  const workspaceQuery = activeWorkspaceId ? `?workspaceId=${encodeURIComponent(activeWorkspaceId)}` : "";

  const fetchSessions = useCallback(async () => {
    const requestId = ++fetchSessionsRequestIdRef.current;
    setLoading(true);
    try {
      // Fetch traces and session metadata in parallel
      const [tracesRes, sessionsRes] = await Promise.all([
        desktopAwareFetch(`/api/traces${workspaceQuery}`, { cache: "no-store" }),
        desktopAwareFetch(`/api/sessions${workspaceQuery}`, { cache: "no-store" }),
      ]);

      const tracesData = tracesRes.ok ? await tracesRes.json() : { traces: [] };
      const sessionsData = sessionsRes.ok ? await sessionsRes.json() : { sessions: [] };

      const traces = tracesData.traces || [];
      const sessionMeta = new Map<string, { workspaceId?: string; name?: string; provider?: string; role?: string; parentSessionId?: string }>(
        (sessionsData.sessions || []).map((s: { sessionId: string; workspaceId?: string; name?: string; provider?: string; role?: string; parentSessionId?: string }) => [
          s.sessionId,
          { workspaceId: s.workspaceId, name: s.name, provider: s.provider, role: s.role, parentSessionId: s.parentSessionId },
        ])
      );

      // Group traces by session
      const sessionMap = new Map<string, { count: number; first: string; last: string }>();
      for (const trace of traces) {
        const sid = trace.sessionId || "unknown";
        const existing = sessionMap.get(sid);
        if (!existing) {
          sessionMap.set(sid, { count: 1, first: trace.timestamp, last: trace.timestamp });
        } else {
          existing.count++;
          if (trace.timestamp < existing.first) existing.first = trace.timestamp;
          if (trace.timestamp > existing.last) existing.last = trace.timestamp;
        }
      }

      const sessionList = Array.from(sessionMap.entries())
        .map(([sessionId, { count, first, last }]) => ({
          sessionId,
          workspaceId: sessionMeta.get(sessionId)?.workspaceId,
          name: sessionMeta.get(sessionId)?.name,
          provider: sessionMeta.get(sessionId)?.provider,
          role: sessionMeta.get(sessionId)?.role,
          parentSessionId: sessionMeta.get(sessionId)?.parentSessionId,
          count,
          firstTimestamp: first,
          lastTimestamp: last,
        }))
        .sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());

      if (requestId !== fetchSessionsRequestIdRef.current) {
        return;
      }

      setSessions(sessionList);

      const currentSelectedSessionId = selectedSessionIdRef.current;
      if (currentSelectedSessionId && sessionList.some((s) => s.sessionId === currentSelectedSessionId)) {
        return;
      }

      if (sessionList.length > 0) {
        setSelectedSessionId(sessionList[0].sessionId);
      } else {
        setSelectedSessionId(null);
      }
    } catch (err) {
      console.error("[TracePage] Failed to fetch sessions:", err);
    } finally {
      setLoading(false);
    }
  }, [workspaceQuery]);

  useEffect(() => {
    const urlSessionId = searchParams.get("sessionId");
    if (isTracesSnapshotSelection(urlSessionId)) {
      if (selectedSessionId !== null) {
        setSelectedSessionId(null);
      }
      return;
    }

    if (!urlSessionId) {
      return;
    }

    if (sessions.some((session) => session.sessionId === urlSessionId) && selectedSessionId !== urlSessionId) {
      setSelectedSessionId(urlSessionId);
    }
  }, [searchParams, selectedSessionId, sessions]);

  // Fetch traces for the selected session (shared across all view tabs)
  const fetchSessionTraces = useCallback(async () => {
    setSessionTracesLoaded(false);
    if (!selectedSessionId) {
      setSessionTraces([]);
      setSessionTracesLoaded(true);
      return;
    }
    setTracesLoading(true);
    try {
      const params = new URLSearchParams({ sessionId: selectedSessionId });
      if (activeWorkspaceId) {
        params.set("workspaceId", activeWorkspaceId);
      }
      const res = await desktopAwareFetch(`/api/traces?${params}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setSessionTraces(data.traces || []);
      }
    } catch (err) {
      console.error("[TracePage] Failed to fetch traces:", err);
    } finally {
      setTracesLoading(false);
      setSessionTracesLoaded(true);
    }
  }, [activeWorkspaceId, selectedSessionId]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    fetchSessionTraces();
  }, [fetchSessionTraces]);

  // Update URL when session changes
  const handleSessionSelect = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    const params = new URLSearchParams(searchParams.toString());
    params.set("sessionId", sessionId);
    router.push(`/traces?${params.toString()}`);
  };

  // Copy current URL to clipboard
  const copyCurrentUrl = () => {
    if (typeof window !== "undefined" && selectedSessionId) {
      const params = new URLSearchParams({ sessionId: selectedSessionId });
      if (activeWorkspaceId) {
        params.set("workspaceId", activeWorkspaceId);
      }
      const url = `${window.location.origin}/traces?${params.toString()}`;
      navigator.clipboard.writeText(url);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };
  const snapshotReady = !workspacesLoading
    && !loading
    && sessionTracesLoaded
    && !tracesLoading;

  return (
    <DesktopAppShell
      workspaceId={resolvedWorkspaceId}
      workspaceTitle={activeWorkspace?.title}
      workspaceSwitcher={
        <WorkspaceSwitcher
          workspaces={workspaces}
          activeWorkspaceId={resolvedWorkspaceId}
          activeWorkspaceTitle={activeWorkspace?.title}
          onSelect={handleWorkspaceSelect}
          onCreate={handleWorkspaceCreate}
          loading={workspacesLoading}
          compact
          desktop
        />
      }
      titleBarRight={(
        <Link
          href="/"
          className="rounded px-2.5 py-1 text-[11px] text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary"
          title={t.trace.backToHome}
        >
          {t.trace.home}
        </Link>
      )}
    >
      <div
        className="flex h-full flex-col overflow-hidden bg-desktop-bg-primary"
        data-testid="traces-page-shell"
        data-snapshot-ready={snapshotReady ? "true" : "false"}
      >
        <TracesPageHeader
          selectedSessionId={selectedSessionId}
          showSidebar={showSidebar}
          loading={loading}
          onCopyCurrentUrl={copyCurrentUrl}
          onToggleSidebar={() => setShowSidebar((value) => !value)}
          onRefresh={fetchSessions}
        />

        {/* View tab switcher */}
        <TracesViewTabs className="shrink-0 px-4 pt-2" activeTab={activeTab} onTabChange={handleTabChange} />

        {/* Main Content */}
        <div className="flex-1 flex min-h-0">
          {/* Session Sidebar */}
          {showSidebar && (
            <aside className="flex w-80 flex-col border-r border-desktop-border bg-desktop-bg-primary">
              <div className="border-b border-desktop-border px-4 py-3">
                <h2 className="text-xs font-semibold text-desktop-text-primary">
                  {t.trace.sessions}
                </h2>
                <p className="mt-0.5 text-[11px] text-desktop-text-secondary">
                  {sessions.length === 1 ? t.trace.sessionFound : t.trace.sessionsFound.replace("{count}", String(sessions.length))}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto">
                {loading && sessions.length === 0 ? (
                  <div className="p-4 text-center">
                    <p className="text-xs text-desktop-text-secondary">{t.trace.loadingSessions}</p>
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="p-4 text-center">
                    <FileText className="mx-auto mb-3 h-12 w-12 text-desktop-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
                    <p className="text-xs text-desktop-text-secondary">{t.trace.noSessionsFound}</p>
                    <p className="mt-1 text-[10px] text-desktop-text-muted">
                      {t.trace.startConversationHint}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-desktop-border">
                    {(() => {
                      // Separate top-level (parent) sessions from child sessions
                      const parentSessions = sessions.filter((s) => !s.parentSessionId);
                      const childSessionMap = new Map<string, Session[]>();
                      for (const session of sessions) {
                        if (session.parentSessionId) {
                          const children = childSessionMap.get(session.parentSessionId) ?? [];
                          children.push(session);
                          childSessionMap.set(session.parentSessionId, children);
                        }
                      }

                      const renderSession = (session: Session, isChild = false) => {
                        const roleColor: Record<string, string> = {
                          ROUTA: "role-chip-routa",
                          CRAFTER: "role-chip-crafter",
                          GATE: "role-chip-gate",
                          DEVELOPER: "role-chip-developer",
                        };
                        const roleClass = session.role ? (roleColor[session.role] ?? "role-chip-developer") : "";

                        return (
                          <div key={session.sessionId}>
                            <button
                              onClick={() => handleSessionSelect(session.sessionId)}
                              className={`w-full px-4 py-3 text-left transition-colors hover:bg-desktop-bg-active/70 ${
                                isChild ? "pl-8 py-2" : ""
                              } ${
                                selectedSessionId === session.sessionId
                                  ? "border-l-2 border-desktop-accent bg-desktop-bg-active"
                                  : ""
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <span className="truncate text-xs font-medium text-desktop-text-primary">
                                  {session.name || (
                                    <code className="font-mono">
                                      {session.sessionId.slice(0, 8)}…
                                    </code>
                                  )}
                                </span>
                                <span className="shrink-0 text-[10px] font-medium text-desktop-text-secondary">
                                  {session.count}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-desktop-text-secondary">
                                <span>{formatTimestamp(session.lastTimestamp)}</span>
                                {session.role && (
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${roleClass}`}>
                                    {session.role}
                                  </span>
                                )}
                                {session.provider && (
                                  <span className="rounded bg-desktop-bg-secondary px-1.5 py-0.5 text-[10px] text-desktop-text-secondary">
                                    {session.provider}
                                  </span>
                                )}
                              </div>
                            </button>
                            {/* Child sessions indented under parent */}
                            {!isChild && childSessionMap.has(session.sessionId) && (
                              <div className="ml-4 border-l-2 border-desktop-border">
                                {(childSessionMap.get(session.sessionId) ?? []).map((child) => renderSession(child, true))}
                              </div>
                            )}
                          </div>
                        );
                      };

                      return [
                        ...parentSessions.map((session) => renderSession(session, false)),
                        // Any sessions without a recognized parent (orphans) shown at bottom
                        ...sessions
                          .filter((session) => session.parentSessionId && !sessions.some((p) => p.sessionId === session.parentSessionId))
                          .map((session) => renderSession(session, false)),
                      ];
                    })()}
                  </div>
                )}
              </div>
            </aside>
          )}

          {/* Trace Panel */}
          <section className="flex-1 min-w-0 bg-desktop-bg-primary" aria-label="Trace content">
            {selectedSessionId ? (
              <>
                {activeTab === "chat" && (
                  <TracePanel sessionId={selectedSessionId} />
                )}
                {activeTab === "event-bridge" && (
                  <EventBridgeTracePanel sessionId={selectedSessionId} traces={sessionTraces} />
                )}
              </>
            ) : (
              <div className="h-full flex items-center justify-center p-8">
                <div className="text-center">
                  <FileText className="mx-auto mb-4 h-16 w-16 text-desktop-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
                  <p className="mb-2 text-[13px] text-desktop-text-secondary">
                    {t.trace.noSessionSelected}
                  </p>
                  <p className="text-xs text-desktop-text-muted">
                    {t.trace.selectSessionHint}
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </DesktopAppShell>
  );
}

// Default export with Suspense boundary for useSearchParams()
export default function TracePage() {
  return (
    <Suspense fallback={
      <div className="desktop-theme flex h-screen items-center justify-center bg-desktop-bg-primary">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-desktop-accent border-t-transparent" />
          <p className="text-sm text-desktop-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <TracePageContent />
    </Suspense>
  );
}
