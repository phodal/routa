"use client";

/**
 * Trace Page - /traces
 *
 * Full-page view for browsing and analyzing Agent Trace records.
 * Sessions are cross-referenced with /api/sessions to show names.
 *
 * Three view modes:
 * - Chat (original TracePanel)
 * - Trace (EventBridge semantic blocks)
 * - Trace(AG-UI) (AG-UI protocol events)
 */

import { useCallback, useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { TracePanel } from "@/client/components/trace-panel";
import { EventBridgeTracePanel } from "@/client/components/event-bridge-trace-panel";
import { AGUITracePanel } from "@/client/components/ag-ui-trace-panel";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import type { TraceRecord } from "@/core/trace";

type ViewTab = "chat" | "event-bridge" | "ag-ui";

interface Session {
  sessionId: string;
  name?: string;
  provider?: string;
  role?: string;
  parentSessionId?: string;
  count: number;
  firstTimestamp: string;
  lastTimestamp: string;
}

function TracePageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { workspaces, loading: workspacesLoading, createWorkspace } = useWorkspaces();

  const [activeWorkspaceId, setActiveWorkspaceId] = useState("default");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [activeTab, setActiveTab] = useState<ViewTab>("chat");
  const [sessionTraces, setSessionTraces] = useState<TraceRecord[]>([]);
  const [_tracesLoading, setTracesLoading] = useState(false);

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);

  useEffect(() => {
    if (workspacesLoading) return;
    if (workspaces.length === 0) return;

    if (!workspaces.some((workspace) => workspace.id === activeWorkspaceId)) {
      setActiveWorkspaceId(workspaces[0].id);
    }
  }, [activeWorkspaceId, workspaces, workspacesLoading]);

  const handleWorkspaceSelect = useCallback((workspaceId: string) => {
    setActiveWorkspaceId(workspaceId);
  }, []);

  const handleWorkspaceCreate = useCallback(async (title: string) => {
    const workspace = await createWorkspace(title);
    if (workspace?.id) {
      setActiveWorkspaceId(workspace.id);
    }
  }, [createWorkspace]);

  const workspaceQuery = activeWorkspaceId ? `?workspaceId=${encodeURIComponent(activeWorkspaceId)}` : "";

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch traces and session metadata in parallel
      const [tracesRes, sessionsRes] = await Promise.all([
        fetch(`/api/traces${workspaceQuery}`, { cache: "no-store" }),
        fetch(`/api/sessions${workspaceQuery}`, { cache: "no-store" }),
      ]);

      const tracesData = tracesRes.ok ? await tracesRes.json() : { traces: [] };
      const sessionsData = sessionsRes.ok ? await sessionsRes.json() : { sessions: [] };

      const traces = tracesData.traces || [];
      const sessionMeta = new Map<string, { name?: string; provider?: string; role?: string; parentSessionId?: string }>(
        (sessionsData.sessions || []).map((s: { sessionId: string; name?: string; provider?: string; role?: string; parentSessionId?: string }) => [
          s.sessionId,
          { name: s.name, provider: s.provider, role: s.role, parentSessionId: s.parentSessionId },
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
          name: sessionMeta.get(sessionId)?.name,
          provider: sessionMeta.get(sessionId)?.provider,
          role: sessionMeta.get(sessionId)?.role,
          parentSessionId: sessionMeta.get(sessionId)?.parentSessionId,
          count,
          firstTimestamp: first,
          lastTimestamp: last,
        }))
        .sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());

      setSessions(sessionList);

      // Check URL parameter first, then keep current session if possible, finally fallback
      const urlSessionId = searchParams.get("sessionId");
      if (urlSessionId && sessionList.some((s) => s.sessionId === urlSessionId)) {
        setSelectedSessionId(urlSessionId);
      } else if (selectedSessionId && sessionList.some((s) => s.sessionId === selectedSessionId)) {
        setSelectedSessionId(selectedSessionId);
      } else if (sessionList.length > 0) {
        setSelectedSessionId(sessionList[0].sessionId);
      } else {
        setSelectedSessionId(null);
      }
    } catch (err) {
      console.error("[TracePage] Failed to fetch sessions:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedSessionId, searchParams, workspaceQuery]);

  // Fetch traces for the selected session (shared across all view tabs)
  const fetchSessionTraces = useCallback(async () => {
    if (!selectedSessionId) {
      setSessionTraces([]);
      return;
    }
    setTracesLoading(true);
    try {
      const params = new URLSearchParams({ sessionId: selectedSessionId });
      if (activeWorkspaceId) {
        params.set("workspaceId", activeWorkspaceId);
      }
      const res = await fetch(`/api/traces?${params}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setSessionTraces(data.traces || []);
      }
    } catch (err) {
      console.error("[TracePage] Failed to fetch traces:", err);
    } finally {
      setTracesLoading(false);
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
      const url = `${window.location.origin}/traces?sessionId=${selectedSessionId}`;
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

  return (
    <DesktopAppShell
      workspaceId={activeWorkspaceId}
      workspaceTitle={activeWorkspace?.title}
      workspaceSwitcher={
        <WorkspaceSwitcher
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
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
          className="px-2.5 py-1 rounded text-[11px] text-[var(--dt-text-secondary)] hover:text-[var(--dt-text-primary)] hover:bg-[var(--dt-bg-active)] transition-colors"
          title="Back to Home"
        >
          Home
        </Link>
      )}
    >
      <div className="h-full flex flex-col bg-[var(--dt-bg-primary)] overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-4 py-3 border-b border-[var(--dt-border)] flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <svg className="w-4 h-4 text-[var(--dt-text-secondary)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" />
            </svg>
            <div className="min-w-0">
              <h1 className="text-[13px] font-semibold text-[var(--dt-text-primary)]">
                Agent Trace Viewer
              </h1>
              <p className="text-[11px] text-[var(--dt-text-secondary)]">
                Browse and analyze agent execution traces
              </p>
            </div>
            {selectedSessionId && (
              <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] text-[var(--dt-text-secondary)] border border-[var(--dt-border)]">
                <span>Session:</span>
                <code className="font-mono text-[var(--dt-text-primary)]">{selectedSessionId.slice(0, 8)}…</code>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedSessionId && (
              <button
                onClick={copyCurrentUrl}
                className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] text-[var(--dt-text-secondary)] bg-[var(--dt-bg-secondary)] hover:bg-[var(--dt-bg-active)]/70 transition-colors"
                title="Copy shareable URL"
              >
                <span>Copy link</span>
                <svg className="w-3.5 h-3.5 text-[var(--dt-text-secondary)] group-hover:text-[var(--dt-text-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            )}
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="px-2.5 py-1.5 text-[11px] font-medium rounded-md text-[var(--dt-text-secondary)] bg-[var(--dt-bg-secondary)] hover:bg-[var(--dt-bg-active)]/70 transition-colors"
            >
              {showSidebar ? "Hide Sessions" : "Show Sessions"}
            </button>
            <button
              onClick={fetchSessions}
              disabled={loading}
              className="px-2.5 py-1.5 text-[11px] font-medium rounded-md text-[var(--dt-text-secondary)] bg-[var(--dt-bg-secondary)] hover:bg-[var(--dt-bg-active)]/70 disabled:opacity-50 transition-colors"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>

        {/* View tab switcher */}
        <div className="shrink-0 px-4 pt-2">
          <div className="inline-flex items-center rounded-md border border-[var(--dt-border)] bg-[var(--dt-bg-secondary)] p-0.5">
            {([
              { key: "chat" as ViewTab, label: "Chat", color: "bg-[#0e639c]" },
              { key: "event-bridge" as ViewTab, label: "Trace", color: "bg-[#5a5a5a]" },
              { key: "ag-ui" as ViewTab, label: "Trace(AG-UI)", color: "bg-[#7a5af8]" },
            ]).map(({ key, label, color }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-3 py-1.5 rounded-sm text-[11px] font-semibold tracking-wide transition-all ${
                  activeTab === key
                    ? `${color} text-white`
                    : "text-[var(--dt-text-secondary)] hover:text-[var(--dt-text-primary)] hover:bg-[var(--dt-bg-active)]/70"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex min-h-0">
          {/* Session Sidebar */}
          {showSidebar && (
            <aside className="w-80 border-r border-[var(--dt-border)] bg-[var(--dt-bg-primary)] flex flex-col">
              <div className="px-4 py-3 border-b border-[var(--dt-border)]">
                <h2 className="text-xs font-semibold text-[var(--dt-text-primary)]">
                  Sessions
                </h2>
                <p className="text-[11px] text-[var(--dt-text-secondary)] mt-0.5">
                  {sessions.length} session{sessions.length !== 1 ? "s" : ""} found
                </p>
              </div>

              <div className="flex-1 overflow-y-auto">
                {loading && sessions.length === 0 ? (
                  <div className="p-4 text-center">
                    <p className="text-xs text-[var(--dt-text-secondary)]">Loading sessions...</p>
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="p-4 text-center">
                    <svg
                      className="w-12 h-12 text-[var(--dt-text-primary)] mx-auto mb-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    <p className="text-xs text-[var(--dt-text-secondary)]">No sessions found</p>
                    <p className="text-[10px] text-[var(--dt-text-muted)] mt-1">
                      Start a conversation to create traces
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--dt-border)]">
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
                          ROUTA: "bg-blue-900/30 text-blue-200",
                          CRAFTER: "bg-amber-900/30 text-amber-200",
                          GATE: "bg-green-900/30 text-green-200",
                          DEVELOPER: "bg-purple-900/30 text-purple-200",
                        };
                        const roleClass = session.role ? (roleColor[session.role] ?? "bg-gray-800 text-[var(--dt-text-muted)]") : "";

                        return (
                          <div key={session.sessionId}>
                            <button
                              onClick={() => handleSessionSelect(session.sessionId)}
                              className={`w-full px-4 py-3 text-left hover:bg-[var(--dt-bg-active)]/70 transition-colors ${
                                isChild ? "pl-8 py-2" : ""
                              } ${
                                selectedSessionId === session.sessionId
                                  ? "bg-[var(--dt-bg-active)] border-l-2 border-[var(--dt-accent)]"
                                  : ""
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <span className="text-xs font-medium text-[var(--dt-text-primary)] truncate">
                                  {session.name || (
                                    <code className="font-mono">
                                      {session.sessionId.slice(0, 8)}…
                                    </code>
                                  )}
                                </span>
                                <span className="text-[10px] font-medium text-[var(--dt-text-secondary)] shrink-0">
                                  {session.count}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 text-[10px] text-[var(--dt-text-secondary)] flex-wrap">
                                <span>{formatTimestamp(session.lastTimestamp)}</span>
                                {session.role && (
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${roleClass}`}>
                                    {session.role}
                                  </span>
                                )}
                                {session.provider && (
                                  <span className="px-1.5 py-0.5 rounded bg-[var(--dt-bg-secondary)] text-[var(--dt-text-secondary)] text-[10px]">
                                    {session.provider}
                                  </span>
                                )}
                              </div>
                            </button>
                            {/* Child sessions indented under parent */}
                            {!isChild && childSessionMap.has(session.sessionId) && (
                              <div className="border-l-2 border-[var(--dt-border)] ml-4">
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
          <main className="flex-1 min-w-0 bg-[var(--dt-bg-primary)]">
            {selectedSessionId ? (
              <>
                {activeTab === "chat" && (
                  <TracePanel sessionId={selectedSessionId} />
                )}
                {activeTab === "event-bridge" && (
                  <EventBridgeTracePanel sessionId={selectedSessionId} traces={sessionTraces} />
                )}
                {activeTab === "ag-ui" && (
                  <AGUITracePanel sessionId={selectedSessionId} traces={sessionTraces} />
                )}
              </>
            ) : (
              <div className="h-full flex items-center justify-center p-8">
                <div className="text-center">
                  <svg
                    className="w-16 h-16 text-[var(--dt-text-primary)] mx-auto mb-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <p className="text-[13px] text-[var(--dt-text-secondary)] mb-2">
                    No session selected
                  </p>
                  <p className="text-xs text-[var(--dt-text-muted)]">
                    Select a session from the sidebar to view traces
                  </p>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </DesktopAppShell>
  );
}

// Default export with Suspense boundary for useSearchParams()
export default function TracePage() {
  return (
    <Suspense fallback={
      <div className="desktop-theme h-screen flex items-center justify-center bg-[var(--dt-bg-primary)]">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-[var(--dt-accent)] border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-sm text-[var(--dt-text-secondary)]">Loading...</p>
        </div>
      </div>
    }>
      <TracePageContent />
    </Suspense>
  );
}
